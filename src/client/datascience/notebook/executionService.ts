// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import { inject, injectable } from 'inversify';
import { Subscription } from 'rxjs';
import { CancellationToken, CancellationTokenSource } from 'vscode';
import type { NotebookCell, NotebookDocument } from 'vscode-proposed';
import { ICommandManager } from '../../common/application/types';
import { wrapCancellationTokens } from '../../common/cancellation';
import '../../common/extensions';
import { IDisposable } from '../../common/types';
import { createDeferred } from '../../common/utils/async';
import { noop } from '../../common/utils/misc';
import { StopWatch } from '../../common/utils/stopWatch';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { Commands, Telemetry } from '../constants';
import { INotebookStorageProvider } from '../interactive-ipynb/notebookStorageProvider';
import { IDataScienceErrorHandler, INotebook, INotebookModel, INotebookProvider } from '../types';
import { findMappedNotebookCellModel } from './helpers/cellMappers';
import {
    handleUpdateDisplayDataMessage,
    hasTransientOutputForAnotherCell,
    updateCellExecutionCount,
    updateCellExecutionTimes,
    updateCellOutput,
    updateCellWithErrorStatus
} from './helpers/executionHelpers';
import { getCellStatusMessageBasedOnFirstErrorOutput, updateVSCNotebookCellMetadata } from './helpers/helpers';
import { INotebookExecutionService } from './types';
// tslint:disable-next-line: no-var-requires no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

/**
 * VSC will use this class to execute cells in a notebook.
 * This is where we hookup Jupyter with a Notebook in VSCode.
 */
@injectable()
export class NotebookExecutionService implements INotebookExecutionService {
    private readonly registeredIOPubListeners = new WeakSet<INotebook>();
    private _notebookProvider?: INotebookProvider;
    private readonly pendingExecutionCancellations = new Map<string, CancellationTokenSource[]>();
    private readonly tokensInterrupted = new WeakSet<CancellationToken>();
    private sentExecuteCellTelemetry: boolean = false;
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
    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    public async executeCell(document: NotebookDocument, cell: NotebookCell, token: CancellationToken): Promise<void> {
        const stopWatch = new StopWatch();
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
        await this.executeIndividualCell(model, document, cell, nb, token, stopWatch);
    }
    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, true)
    public async executeAllCells(document: NotebookDocument, token: CancellationToken): Promise<void> {
        const stopWatch = new StopWatch();
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
            document.cells.map((cellToExecute) =>
                this.executeIndividualCell(model, document, cellToExecute, nb, token, stopWatch)
            )
        );
    }
    public cancelPendingExecutions(document: NotebookDocument): void {
        this.pendingExecutionCancellations.get(document.uri.fsPath)?.forEach((cancellation) => cancellation.cancel()); // NOSONAR
    }
    private sendPerceivedCellExecute(runningStopWatch: StopWatch) {
        const props = { notebook: true };
        if (!this.sentExecuteCellTelemetry) {
            this.sentExecuteCellTelemetry = true;
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, runningStopWatch.elapsedTime, props);
        } else {
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, runningStopWatch.elapsedTime, props);
        }
    }

    private async executeIndividualCell(
        model: INotebookModel,
        document: NotebookDocument,
        cell: NotebookCell,
        nb: INotebook,
        token: CancellationToken,
        stopWatch: StopWatch
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
        const executionStopWatch = new StopWatch();

        wrappedToken.onCancellationRequested(() => {
            if (deferred.completed) {
                return;
            }

            // Interrupt kernel only if original cancellation was cancelled.
            // I.e. interrupt kernel only if user attempts to stop the execution by clicking stop button.
            if (token.isCancellationRequested && !this.tokensInterrupted.has(token)) {
                this.tokensInterrupted.add(token);
                this.commandManager.executeCommand(Commands.NotebookEditorInterruptKernel).then(noop, noop);
            }
        });

        cell.metadata.runStartTime = new Date().getTime();
        cell.metadata.runState = vscodeNotebookEnums.NotebookCellRunState.Running;

        let subscription: Subscription | undefined;
        let modelClearedEventHandler: IDisposable | undefined;
        try {
            nb.clear(cell.uri.fsPath); // NOSONAR
            const observable = nb.executeObservable(
                cell.document.getText(),
                document.fileName,
                0,
                cell.uri.fsPath,
                false
            );
            subscription = observable?.subscribe(
                (cells) => {
                    if (!modelClearedEventHandler) {
                        modelClearedEventHandler = model.changed((e) => {
                            if (e.kind === 'clear') {
                                // If cell output has been cleared, then clear the output in the observed executable cell.
                                // Else if user clears output while execuitng a cell, we add it back.
                                cells.forEach((c) => (c.data.outputs = []));
                            }
                        });
                    }
                    const rawCellOutput = cells
                        .filter((item) => item.id === cell.uri.fsPath)
                        .flatMap((item) => (item.data.outputs as unknown) as nbformat.IOutput[])
                        .filter((output) => !hasTransientOutputForAnotherCell(output));

                    const notebookCellModel = findMappedNotebookCellModel(cell, model.cells);

                    // Set execution count, all messages should have it
                    if (
                        cells.length &&
                        'execution_count' in cells[0].data &&
                        typeof cells[0].data.execution_count === 'number'
                    ) {
                        const executionCount = cells[0].data.execution_count as number;
                        updateCellExecutionCount(cell, notebookCellModel, executionCount);
                    }

                    updateCellOutput(cell, notebookCellModel, rawCellOutput);
                },
                (error: Partial<Error>) => {
                    updateCellWithErrorStatus(cell, error);
                    deferred.resolve();
                    this.errorHandler.handleError((error as unknown) as Error).ignoreErrors();
                },
                () => {
                    cell.metadata.lastRunDuration = executionStopWatch.elapsedTime;
                    cell.metadata.runState = wrappedToken.isCancellationRequested
                        ? vscodeNotebookEnums.NotebookCellRunState.Idle
                        : vscodeNotebookEnums.NotebookCellRunState.Success;
                    cell.metadata.statusMessage = '';

                    // Update metadata in our model.
                    const notebookCellModel = findMappedNotebookCellModel(cell, model.cells);
                    updateCellExecutionTimes(
                        notebookCellModel,
                        cell.metadata.runStartTime,
                        cell.metadata.lastRunDuration
                    );

                    // If there are any errors in the cell, then change status to error.
                    if (cell.outputs.some((output) => output.outputKind === vscodeNotebookEnums.CellOutputKind.Error)) {
                        cell.metadata.runState = vscodeNotebookEnums.NotebookCellRunState.Error;
                        cell.metadata.statusMessage = getCellStatusMessageBasedOnFirstErrorOutput(
                            // tslint:disable-next-line: no-any
                            notebookCellModel.data.outputs as any
                        );
                    }

                    updateVSCNotebookCellMetadata(cell.metadata, notebookCellModel);
                    deferred.resolve();
                }
            );
            await deferred.promise;
        } catch (ex) {
            updateCellWithErrorStatus(cell, ex);
            this.errorHandler.handleError(ex).ignoreErrors();
        } finally {
            this.sendPerceivedCellExecute(stopWatch);
            modelClearedEventHandler?.dispose(); // NOSONAR
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
