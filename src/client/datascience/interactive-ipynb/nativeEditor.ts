// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import * as fastDeepEqual from 'fast-deep-equal';
import { inject, injectable, multiInject } from 'inversify';
import * as path from 'path';
import { Event, EventEmitter, Uri, ViewColumn } from 'vscode';

import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    ILiveShareApi,
    IWebPanelProvider,
    IWorkspaceService
} from '../../common/application/types';
import { ContextKey } from '../../common/contextKey';
import { traceError } from '../../common/logger';
import { IFileSystem, TemporaryFile } from '../../common/platform/types';
import { IConfigurationService, IDisposableRegistry } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { StopWatch } from '../../common/utils/stopWatch';
import { EXTENSION_ROOT_DIR } from '../../constants';
import { IInterpreterService } from '../../interpreter/contracts';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { concatMultilineString } from '../common';
import {
    EditorContexts,
    Identifiers,
    NativeKeyboardCommandTelemetryLookup,
    NativeMouseCommandTelemetryLookup,
    Telemetry
} from '../constants';
import { InteractiveBase } from '../interactive-common/interactiveBase';
import {
    IEditCell,
    INativeCommand,
    InteractiveWindowMessages,
    ISaveAll,
    ISubmitNewCell,
    SysInfoReason
} from '../interactive-common/interactiveWindowTypes';
import {
    ICell,
    ICodeCssGenerator,
    IDataScienceErrorHandler,
    IDataViewerProvider,
    IInteractiveWindowInfo,
    IInteractiveWindowListener,
    IJupyterDebugger,
    IJupyterExecution,
    IJupyterVariables,
    INotebookEditor,
    INotebookEditorProvider,
    INotebookExporter,
    INotebookImporter,
    INotebookServerOptions,
    IStatusProvider,
    IThemeFinder
} from '../types';

@injectable()
export class NativeEditor extends InteractiveBase implements INotebookEditor {
    private closedEvent: EventEmitter<INotebookEditor> = new EventEmitter<INotebookEditor>();
    private executedEvent: EventEmitter<INotebookEditor> = new EventEmitter<INotebookEditor>();
    private modifiedEvent: EventEmitter<INotebookEditor> = new EventEmitter<INotebookEditor>();
    private loadedPromise: Deferred<void> = createDeferred<void>();
    private _file: Uri = Uri.file('');
    private _dirty: boolean = false;
    private visibleCells: ICell[] = [];
    private startupTimer: StopWatch = new StopWatch();
    private loadedAllCells: boolean = false;

    constructor(
        @multiInject(IInteractiveWindowListener) listeners: IInteractiveWindowListener[],
        @inject(ILiveShareApi) liveShare: ILiveShareApi,
        @inject(IApplicationShell) applicationShell: IApplicationShell,
        @inject(IDocumentManager) documentManager: IDocumentManager,
        @inject(IInterpreterService) interpreterService: IInterpreterService,
        @inject(IWebPanelProvider) provider: IWebPanelProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(ICodeCssGenerator) cssGenerator: ICodeCssGenerator,
        @inject(IThemeFinder) themeFinder: IThemeFinder,
        @inject(IStatusProvider) statusProvider: IStatusProvider,
        @inject(IJupyterExecution) jupyterExecution: IJupyterExecution,
        @inject(IFileSystem) fileSystem: IFileSystem,
        @inject(IConfigurationService) configuration: IConfigurationService,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(INotebookExporter) jupyterExporter: INotebookExporter,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(INotebookEditorProvider) editorProvider: INotebookEditorProvider,
        @inject(IDataViewerProvider) dataExplorerProvider: IDataViewerProvider,
        @inject(IJupyterVariables) jupyterVariables: IJupyterVariables,
        @inject(IJupyterDebugger) jupyterDebugger: IJupyterDebugger,
        @inject(INotebookImporter) private importer: INotebookImporter,
        @inject(IDataScienceErrorHandler) errorHandler: IDataScienceErrorHandler
    ) {
        super(
            listeners,
            liveShare,
            applicationShell,
            documentManager,
            interpreterService,
            provider,
            disposables,
            cssGenerator,
            themeFinder,
            statusProvider,
            jupyterExecution,
            fileSystem,
            configuration,
            jupyterExporter,
            workspaceService,
            dataExplorerProvider,
            jupyterVariables,
            jupyterDebugger,
            editorProvider,
            errorHandler,
            path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'native-editor', 'index_bundle.js'),
            localize.DataScience.nativeEditorTitle(),
            ViewColumn.Active);
    }

    public get visible(): boolean {
        return this.viewState.visible;
    }

    public get active(): boolean {
        return this.viewState.active;
    }

    public get file(): Uri {
        return this._file;
    }

    public dispose(): void {
        let allowClose = true;
        const close = () => {
            super.dispose();
            if (this.closedEvent) {
                this.closedEvent.fire(this);
            }
        };

        // Ask user if they want to save if hotExit is not enabled.
        if (this._dirty) {
            const files = this.workspaceService.getConfiguration('files', undefined);
            const hotExit = files ? files.get('hotExit') : 'off';
            if (hotExit === 'off') {
                const message1 = localize.DataScience.dirtyNotebookMessage1().format(`${path.basename(this.file.fsPath)}`);
                const message2 = localize.DataScience.dirtyNotebookMessage2();
                const yes = localize.DataScience.dirtyNotebookYes();
                const no = localize.DataScience.dirtyNotebookNo();
                allowClose = false;
                // tslint:disable-next-line: messages-must-be-localized
                this.applicationShell.showInformationMessage(`${message1}\n${message2}`, { modal: true }, yes, no).then(v => {
                    // Check message to see if we're really closing or not.
                    allowClose = true;

                    if (v === yes) {
                        this.saveContents(false, false).ignoreErrors();
                    } else if (v === undefined) {
                        // We don't want to close, reopen
                        allowClose = false;
                        this.reopen(this.visibleCells).ignoreErrors();
                    }

                    // Reapply close since we waited for a promise.
                    if (allowClose) {
                        close();
                    }
                });
            } else {
                this.saveContents(false, false).ignoreErrors();
            }
        }
        if (allowClose) {
            close();
        }
    }

    public async load(content: string, file: Uri): Promise<void> {
        // Save our uri
        this._file = file;

        // Indicate we have our identity
        this.loadedPromise.resolve();

        // Update our title to match
        this.setTitle(path.basename(file.fsPath));

        // Show ourselves
        await this.show();

        // Load the contents of this notebook into our cells.
        const cells = content ? await this.importer.importCells(content) : [];
        this.visibleCells = cells;

        // If that works, send the cells to the web view
        return this.postMessage(InteractiveWindowMessages.LoadAllCells, { cells });
    }

    public save(): Promise<void> {
        return this.saveContents(false, true);
    }

    public get closed(): Event<INotebookEditor> {
        return this.closedEvent.event;
    }

    public get executed(): Event<INotebookEditor> {
        return this.executedEvent.event;
    }

    public get modified(): Event<INotebookEditor> {
        return this.modifiedEvent.event;
    }

    // tslint:disable-next-line: no-any
    public onMessage(message: string, payload: any) {
        super.onMessage(message, payload);
        switch (message) {
            case InteractiveWindowMessages.ReExecuteCell:
                this.executedEvent.fire(this);
                break;

            case InteractiveWindowMessages.SaveAll:
                this.dispatchMessage(message, payload, this.saveAll);
                break;

            case InteractiveWindowMessages.Export:
                this.dispatchMessage(message, payload, this.export);
                break;

            case InteractiveWindowMessages.EditCell:
                this.dispatchMessage(message, payload, this.editCell);
                break;

            case InteractiveWindowMessages.NativeCommand:
                this.dispatchMessage(message, payload, this.logNativeCommand);
                break;

            // call this to update the whole document for intellisense
            case InteractiveWindowMessages.LoadAllCellsComplete:
                this.dispatchMessage(message, payload, this.loadCellsComplete);
                break;

            default:
                break;
        }
    }

    public async getNotebookOptions(): Promise<INotebookServerOptions> {
        return this.ipynbProvider.getNotebookOptions();
    }

    protected async reopen(cells: ICell[]): Promise<void> {
        try {
            super.reload();
            await this.show();

            // Indicate we have our identity
            this.loadedPromise.resolve();

            // Update our title to match
            if (this._dirty) {
                this._dirty = false;
                this.setDirty();
            } else {
                this.setTitle(path.basename(this._file.fsPath));
            }

            // If that works, send the cells to the web view
            return this.postMessage(InteractiveWindowMessages.LoadAllCells, { cells });
        } catch (e) {
            this.errorHandler.handleError(e).ignoreErrors();
        }
    }

    @captureTelemetry(Telemetry.SubmitCellThroughInput, undefined, false)
    // tslint:disable-next-line:no-any
    protected submitNewCell(info: ISubmitNewCell) {
        // If there's any payload, it has the code and the id
        if (info && info.code && info.id) {
            // Update dirtiness
            this.setDirty();

            // Send to ourselves.
            this.submitCode(info.code, Identifiers.EmptyFileName, 0, info.id).ignoreErrors();

            // Activate the other side, and send as if came from a file
            this.ipynbProvider.show(this.file).then(_v => {
                this.shareMessage(InteractiveWindowMessages.RemoteAddCode, { code: info.code, file: Identifiers.EmptyFileName, line: 0, id: info.id, originator: this.id, debug: false });
            }).ignoreErrors();
        }
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, false)
    // tslint:disable-next-line:no-any
    protected async reexecuteCell(info: ISubmitNewCell): Promise<void> {
        // If there's any payload, it has the code and the id
        if (info && info.code && info.id) {
            // Update dirtiness
            this.setDirty();

            // Clear the result if we've run before
            await this.clearResult(info.id);

            // Send to ourselves.
            this.submitCode(info.code, Identifiers.EmptyFileName, 0, info.id).ignoreErrors();

            // Activate the other side, and send as if came from a file
            await this.ipynbProvider.show(this.file);
            this.shareMessage(InteractiveWindowMessages.RemoteReexecuteCode, { code: info.code, file: Identifiers.EmptyFileName, line: 0, id: info.id, originator: this.id, debug: false });
        }
    }

    protected async getNotebookIdentity(): Promise<Uri> {
        await this.loadedPromise.promise;

        // File should be set now
        return this._file;
    }

    protected updateContexts(info: IInteractiveWindowInfo | undefined) {
        // This should be called by the python interactive window every
        // time state changes. We use this opportunity to update our
        // extension contexts
        if (this.commandManager && this.commandManager.executeCommand) {
            const interactiveContext = new ContextKey(EditorContexts.HaveNative, this.commandManager);
            interactiveContext.set(!this.isDisposed).catch();
            const interactiveCellsContext = new ContextKey(EditorContexts.HaveNativeCells, this.commandManager);
            const redoableContext = new ContextKey(EditorContexts.HaveNativeRedoableCells, this.commandManager);
            if (info) {
                interactiveCellsContext.set(info.cellCount > 0).catch();
                redoableContext.set(info.redoCount > 0).catch();
            } else {
                interactiveCellsContext.set(false).catch();
                redoableContext.set(false).catch();
            }
        }

        // Also keep track of our visible cells. We use this to save to the file when we close
        if (info && 'visibleCells' in info && this.loadedAllCells) {
            const isDirty = !fastDeepEqual(this.visibleCells, info.visibleCells);
            this.visibleCells = info.visibleCells;
            if (isDirty) {
                this.setDirty();
            }
        }
    }

    protected async onViewStateChanged(visible: boolean, active: boolean) {
        await super.onViewStateChanged(visible, active);

        // Update our contexts
        const interactiveContext = new ContextKey(EditorContexts.HaveNative, this.commandManager);
        interactiveContext.set(visible && active).catch();
    }

    protected async closeBecauseOfFailure(_exc: Error): Promise<void> {
        // Actually don't close, just let the error bubble out
    }

    protected addSysInfo(_reason: SysInfoReason): Promise<void> {
        // No sys info in the native editor
        return Promise.resolve();
    }

    private editCell(request: IEditCell) {
        // Apply the changes to the visible cell list. We won't get an update until
        // submission otherwise
        if (request.changes && request.changes.length) {
            const change = request.changes[0];
            const normalized = change.text.replace(/\r/g, '');

            // Figure out which cell we're editing.
            const cell = this.visibleCells.find(c => c.id === request.id);
            if (cell) {
                // This is an actual edit.
                const contents = concatMultilineString(cell.data.source);
                const before = contents.substr(0, change.rangeOffset);
                const after = contents.substr(change.rangeOffset + change.rangeLength);
                const newContents = `${before}${normalized}${after}`;
                if (contents !== newContents) {
                    cell.data.source = newContents;
                    this.setDirty();
                }
            }
        }
    }

    private setDirty(): void {
        if (!this._dirty) {
            this._dirty = true;
            this.setTitle(`${path.basename(this.file.fsPath)}*`);
            this.postMessage(InteractiveWindowMessages.NotebookDirty).ignoreErrors();
            this.modifiedEvent.fire(this);
        }
    }

    private setClean(): void {
        if (this._dirty) {
            this._dirty = false;
            this.setTitle(`${path.basename(this.file.fsPath)}`);
            this.postMessage(InteractiveWindowMessages.NotebookClean).ignoreErrors();
        }
    }

    @captureTelemetry(Telemetry.ConvertToPythonFile, undefined, false)
    private async export(cells: ICell[]): Promise<void> {
        const status = this.setStatus(localize.DataScience.convertingToPythonFile());
        // First generate a temporary notebook with these cells.
        let tempFile: TemporaryFile | undefined;
        try {
            tempFile = await this.fileSystem.createTemporaryFile('.ipynb');

            // Translate the cells into a notebook
            const notebook = await this.jupyterExporter.translateToNotebook(cells, undefined);

            // Write the cells to this file
            await this.fileSystem.writeFile(tempFile.filePath, JSON.stringify(notebook), { encoding: 'utf-8' });

            // Import this file and show it
            const contents = await this.importer.importFromFile(tempFile.filePath);
            if (contents) {
                await this.viewDocument(contents);
            }

        } catch (e) {
            await this.errorHandler.handleError(e);
        } finally {
            if (tempFile) {
                tempFile.dispose();
            }
            status.dispose();
        }
    }

    private async viewDocument(contents: string): Promise<void> {
        const doc = await this.documentManager.openTextDocument({ language: 'python', content: contents });
        await this.documentManager.showTextDocument(doc, ViewColumn.One);
    }

    private async saveContents(forceAsk: boolean, skipUI: boolean): Promise<void> {
        try {
            let fileToSaveTo: Uri | undefined = this.file;
            let isDirty = this._dirty;

            // Ask user for a save as dialog if no title
            const baseName = path.basename(this.file.fsPath);
            const isUntitled = baseName.includes(localize.DataScience.untitledNotebookFileName());
            if (!skipUI && (isUntitled || forceAsk)) {
                const filtersKey = localize.DataScience.dirtyNotebookDialogFilter();
                const filtersObject: { [name: string]: string[] } = {};
                filtersObject[filtersKey] = ['ipynb'];
                isDirty = true;

                fileToSaveTo = await this.applicationShell.showSaveDialog({
                    saveLabel: localize.DataScience.dirtyNotebookDialogTitle(),
                    filters: filtersObject,
                    defaultUri: isUntitled ? undefined : this.file
                });
            }

            if (fileToSaveTo && isDirty) {
                // Save our visible cells into the file
                const notebook = await this.jupyterExporter.translateToNotebook(this.visibleCells, undefined);
                await this.fileSystem.writeFile(fileToSaveTo.fsPath, JSON.stringify(notebook));
                this.setClean();
            }

        } catch (e) {
            traceError(e);
        }
    }

    private saveAll(args: ISaveAll) {
        this.visibleCells = args.cells;
        this.saveContents(false, false).ignoreErrors();
    }

    private logNativeCommand(args: INativeCommand) {
        const telemetryEvent = args.source === 'mouse' ? NativeMouseCommandTelemetryLookup[args.command] : NativeKeyboardCommandTelemetryLookup[args.command];
        sendTelemetryEvent(telemetryEvent);
    }

    private loadCellsComplete() {
        if (!this.loadedAllCells) {
            this.loadedAllCells = true;
            sendTelemetryEvent(Telemetry.NotebookOpenTime, this.startupTimer.elapsedTime);
        }
    }
}
