// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import { Subscription } from 'rxjs';
import { CancellationToken, NotebookCell, NotebookCellRunState, NotebookDocument } from 'vscode';
import { CancellationTokenSource } from 'vscode-jsonrpc';
import { ICommandManager } from '../../common/application/types';
import { wrapCancellationTokens } from '../../common/cancellation';
import '../../common/extensions';
import { createDeferred } from '../../common/utils/async';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { IServiceContainer } from '../../ioc/types';
import { Commands } from '../constants';
import { INotebookStorageProvider } from '../interactive-ipynb/notebookStorageProvider';
import { IDataScienceErrorHandler, INotebook, INotebookModel, INotebookProvider } from '../types';
import { findMappedNotebookCellModel } from './cellUpdateHelpers';
import {
    handleUpdateDisplayDataMessage,
    hasTransientOutputForAnotherCell,
    updateCellOutput,
    updateCellWithErrorStatus
} from './executionHelpers';
import { INotebookExecutionService } from './types';

/**
 * VSC will use this class to execute cells in a notebook.
 * This is where we hookup Jupyter with a Notebook in VSCode.
 */
@injectable()
export class NotebookExecutionService implements INotebookExecutionService {
    private registeredIOPubListeners = new WeakSet<INotebook>();
    private _notebookProvider?: INotebookProvider;
    private pendingExecutionCancellations = new Map<string, CancellationTokenSource[]>();
    private get notebookProvider(): INotebookProvider {
        this._notebookProvider =
            this._notebookProvider || this.serviceContainer.get<INotebookProvider>(INotebookProvider);
        return this._notebookProvider!;
    }
    constructor(
        @inject(INotebookStorageProvider) private readonly notebookStorage: INotebookStorageProvider,
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler
    ) {}
    public async executeCell(document: NotebookDocument, cell: NotebookCell, token: CancellationToken): Promise<void> {
        const model = await this.notebookStorage.load(document.uri);
        if (token.isCancellationRequested) {
            return;
        }
        const nb = await this.notebookProvider.getOrCreateNotebook({
            identity: document.uri,
            resource: document.uri,
            metadata: model.metadata,
            disableUI: false,
            getOnly: false
        });
        if (token.isCancellationRequested) {
            return;
        }
        if (!nb) {
            throw new Error('Unable to get Notebook object to run cell');
        }
        await this.executeIndividualCell(model, document, cell, nb, token);
    }
    public async executeAllCells(document: NotebookDocument, token: CancellationToken): Promise<void> {
        const model = await this.notebookStorage.load(document.uri);
        if (token.isCancellationRequested) {
            return;
        }
        const nb = await this.notebookProvider.getOrCreateNotebook({
            identity: document.uri,
            resource: document.uri,
            metadata: model.metadata,
            disableUI: false,
            getOnly: false
        });
        if (token.isCancellationRequested) {
            return;
        }
        if (!nb) {
            throw new Error('Unable to get Notebook object to run cell');
        }
        await Promise.all(
            document.cells.map((cellToExecute) => this.executeIndividualCell(model, document, cellToExecute, nb, token))
        );
    }
    public cancelPendingExecutions(document: NotebookDocument): void {
        this.pendingExecutionCancellations.get(document.uri.fsPath)?.forEach((cancellation) => cancellation.cancel()); // NOSONAR
    }
    private async executeIndividualCell(
        model: INotebookModel,
        document: NotebookDocument,
        cell: NotebookCell,
        nb: INotebook,
        token: CancellationToken
    ): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        // If we need to cancel this execution (from our code, due to kernel restarts or similar, then cancel).
        const cancelExecution = new CancellationTokenSource();
        if (!this.pendingExecutionCancellations.has(document.uri.fsPath)) {
            this.pendingExecutionCancellations.set(document.uri.fsPath, []);
        }
        // If kernel is restarted while executing, then abort execution.
        const cancelExecutionCancellation = new CancellationTokenSource();
        this.pendingExecutionCancellations.get(document.uri.fsPath)?.push(cancelExecutionCancellation); // NOSONAR

        // Replace token with a wrapped cancellation, which will wrap cancellation due to restarts.
        const wrappedToken = wrapCancellationTokens(token, cancelExecutionCancellation.token, cancelExecution.token);
        const disposable = nb?.onKernelRestarted(() => {
            cancelExecutionCancellation.cancel();
            disposable.dispose();
        });

        // tslint:disable-next-line: no-suspicious-comment
        // TODO: How can nb be null?
        // We should throw an exception or change return type to be non-nullable.
        // Else in places where it shouldn't be null we'd end up treating it as null (i.e. ignoring error conditions, like this).

        this.handleDisplayDataMessages(model, document, nb);

        const deferred = createDeferred();
        const stopWatch = new StopWatch();

        wrappedToken.onCancellationRequested(() => {
            // tslint:disable-next-line: no-suspicious-comment
            // TODO: Is this the right thing to do?
            // I think it is, as we have a stop button.
            // If we're busy executing, then interrupt the execution.
            if (deferred.completed) {
                return;
            }
            deferred.resolve();
            cell.metadata.runState = NotebookCellRunState.Idle;

            // Interrupt kernel only if original cancellation was cancelled.
            if (token.isCancellationRequested) {
                this.commandManager.executeCommand(Commands.NotebookEditorInterruptKernel).then(noop, noop);
            }
        });

        cell.metadata.runStartTime = new Date().getTime();
        cell.metadata.runState = NotebookCellRunState.Running;

        if (!findMappedNotebookCellModel(cell, model.cells)) {
            // tslint:disable-next-line: no-suspicious-comment
            // TODO: Possible it was added as we didn't get to know about it.
            // We need to handle these.
            // Basically if there's a new cell, we need to first add it into our model,
            // Similarly we might want to handle deletions.
            throw new Error('Unable to find corresonding Cell in Model');
        }
        let subscription: Subscription | undefined;
        try {
            nb.clear(cell.uri.fsPath); // NOSONAR
            const observable = nb.executeObservable(cell.source, document.fileName, 0, cell.uri.fsPath, false);
            subscription = observable?.subscribe(
                (cells) => {
                    if (wrappedToken.isCancellationRequested) {
                        return;
                    }
                    const rawCellOutput = cells
                        .filter((item) => item.id === cell.uri.fsPath)
                        .flatMap((item) => (item.data.outputs as unknown) as nbformat.IOutput[])
                        .filter((output) => !hasTransientOutputForAnotherCell(output));

                    const notebookCellModel = findMappedNotebookCellModel(cell, model.cells);
                    updateCellOutput(notebookCellModel, rawCellOutput, model);
                },
                (error: Partial<Error>) => {
                    updateCellWithErrorStatus(cell, error);
                    deferred.resolve();
                    this.errorHandler.handleError((error as unknown) as Error).ignoreErrors();
                },
                () => {
                    cell.metadata.runState = wrappedToken.isCancellationRequested
                        ? NotebookCellRunState.Idle
                        : NotebookCellRunState.Success;
                    cell.metadata.lastRunDuration = stopWatch.elapsedTime;
                    cell.metadata.statusMessage = '';
                    deferred.resolve();
                }
            );
            await deferred.promise;
        } catch (ex) {
            updateCellWithErrorStatus(cell, ex);
            this.errorHandler.handleError(ex).ignoreErrors();
        } finally {
            subscription?.unsubscribe(); // NOSONAR
            // Ensure we remove the cancellation.
            const cancellations = this.pendingExecutionCancellations.get(document.uri.fsPath);
            const index = cancellations?.indexOf(cancelExecutionCancellation) ?? -1;
            if (cancellations && index >= 0) {
                cancellations.splice(index, 1);
            }
        }
    }
    /**
     * Ensure we handle display data messages that can result in updates to other cells.
     */
    private handleDisplayDataMessages(model: INotebookModel, document: NotebookDocument, nb?: INotebook) {
        if (nb && !this.registeredIOPubListeners.has(nb)) {
            this.registeredIOPubListeners.add(nb);
            //tslint:disable-next-line:no-require-imports
            const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services');
            nb.registerIOPubListener(async (msg) => {
                if (jupyterLab.KernelMessage.isUpdateDisplayDataMsg(msg)) {
                    handleUpdateDisplayDataMessage(msg, model, document);
                }
            });
        }
    }
}
