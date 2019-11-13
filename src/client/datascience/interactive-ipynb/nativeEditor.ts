// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils/lib/nbformat';
import * as detectIndent from 'detect-indent';
import { inject, injectable, multiInject, named } from 'inversify';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { Event, EventEmitter, Memento, TextEditor, Uri, ViewColumn } from 'vscode';
import { IApplicationShell, ICommandManager, IDocumentManager, ILiveShareApi, IWebPanelProvider, IWorkspaceService } from '../../common/application/types';
import { ContextKey } from '../../common/contextKey';
import '../../common/extensions';
import { traceError } from '../../common/logger';
import { IFileSystem, TemporaryFile } from '../../common/platform/types';
import { GLOBAL_MEMENTO, IConfigurationService, IDisposableRegistry, IMemento, WORKSPACE_MEMENTO } from '../../common/types';
import { createDeferred, Deferred } from '../../common/utils/async';
import * as localize from '../../common/utils/localize';
import { StopWatch } from '../../common/utils/stopWatch';
import { EXTENSION_ROOT_DIR } from '../../constants';
import { IInterpreterService } from '../../interpreter/contracts';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { concatMultilineStringInput, splitMultilineString } from '../common';
import { EditorContexts, Identifiers, NativeKeyboardCommandTelemetryLookup, NativeMouseCommandTelemetryLookup, Telemetry } from '../constants';
import { InteractiveBase } from '../interactive-common/interactiveBase';
import { IEditCell, IInsertCell, INativeCommand, InteractiveWindowMessages, IRemoveCell, ISaveAll, ISubmitNewCell, ISwapCells } from '../interactive-common/interactiveWindowTypes';
import { InvalidNotebookFileError } from '../jupyter/invalidNotebookFileError';
import { CellState, ICell, ICodeCssGenerator, IDataScienceErrorHandler, IDataViewerProvider, IInteractiveWindowInfo, IInteractiveWindowListener, IJupyterDebugger, IJupyterExecution, IJupyterVariables, INotebookEditor, INotebookEditorProvider, INotebookExporter, INotebookImporter, INotebookServerOptions, IStatusProvider, IThemeFinder } from '../types';

enum AskForSaveResult {
    Yes,
    No,
    Cancel
}

@injectable()
export class NativeEditor extends InteractiveBase implements INotebookEditor {
    private closedEvent: EventEmitter<INotebookEditor> = new EventEmitter<INotebookEditor>();
    private executedEvent: EventEmitter<INotebookEditor> = new EventEmitter<INotebookEditor>();
    private modifiedEvent: EventEmitter<INotebookEditor> = new EventEmitter<INotebookEditor>();
    private savedEvent: EventEmitter<INotebookEditor> = new EventEmitter<INotebookEditor>();
    private loadedPromise: Deferred<void> = createDeferred<void>();
    private _file: Uri = Uri.file('');
    private _dirty: boolean = false;
    private visibleCells: ICell[] = [];
    private startupTimer: StopWatch = new StopWatch();
    private loadedAllCells: boolean = false;
    private indentAmount: string = ' ';
    private notebookJson: Partial<nbformat.INotebookContent> = {};

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
        @inject(IDataScienceErrorHandler) errorHandler: IDataScienceErrorHandler,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private globalStorage: Memento,
        @inject(IMemento) @named(WORKSPACE_MEMENTO) private localStorage: Memento
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
            ViewColumn.Active
        );
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

    public get isUntitled(): boolean {
        const baseName = path.basename(this.file.fsPath);
        return baseName.includes(localize.DataScience.untitledNotebookFileName());
    }
    public dispose(): Promise<void> {
        super.dispose();
        return this.close();
    }

    public get contents(): string {
        return this.generateNotebookContent(this.visibleCells);
    }

    public get cells(): ICell[] {
        return this.visibleCells;
    }

    public async load(contents: string, file: Uri): Promise<void> {
        // Save our uri
        this._file = file;

        // Indicate we have our identity
        this.loadedPromise.resolve();

        // Update our title to match
        this.setTitle(path.basename(file.fsPath));

        // Show ourselves
        await this.show();

        // See if this file was stored in storage prior to shutdown
        const dirtyContents = await this.getStoredContents();
        if (dirtyContents) {
            // This means we're dirty. Indicate dirty and load from this content
            return this.loadContents(dirtyContents, true);
        } else {
            // Load without setting dirty
            return this.loadContents(contents, false);
        }
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

    public get saved(): Event<INotebookEditor> {
        return this.savedEvent.event;
    }

    public get isDirty(): boolean {
        return this._dirty;
    }

    // tslint:disable-next-line: no-any
    public onMessage(message: string, payload: any) {
        super.onMessage(message, payload);
        switch (message) {
            case InteractiveWindowMessages.ReExecuteCell:
                this.executedEvent.fire(this);
                break;

            case InteractiveWindowMessages.SaveAll:
                this.handleMessage(message, payload, this.saveAll);
                break;

            case InteractiveWindowMessages.Export:
                this.handleMessage(message, payload, this.export);
                break;

            case InteractiveWindowMessages.EditCell:
                this.handleMessage(message, payload, this.editCell);
                break;

            case InteractiveWindowMessages.InsertCell:
                this.handleMessage(message, payload, this.insertCell);
                break;

            case InteractiveWindowMessages.RemoveCell:
                this.handleMessage(message, payload, this.removeCell);
                break;

            case InteractiveWindowMessages.SwapCells:
                this.handleMessage(message, payload, this.swapCells);
                break;

            case InteractiveWindowMessages.DeleteAllCells:
                this.handleMessage(message, payload, this.removeAllCells);
                break;

            case InteractiveWindowMessages.NativeCommand:
                this.handleMessage(message, payload, this.logNativeCommand);
                break;

            // call this to update the whole document for intellisense
            case InteractiveWindowMessages.LoadAllCellsComplete:
                this.handleMessage(message, payload, this.loadCellsComplete);
                break;

            case InteractiveWindowMessages.ClearAllOutputs:
                this.handleMessage(message, payload, this.clearAllOutputs);
                break;

            default:
                break;
        }
    }

    public async getNotebookOptions(): Promise<INotebookServerOptions> {
        return this.ipynbProvider.getNotebookOptions();
    }

    public runAllCells() {
        this.postMessage(InteractiveWindowMessages.NotebookRunAllCells).ignoreErrors();
    }

    public runSelectedCell() {
        this.postMessage(InteractiveWindowMessages.NotebookRunSelectedCell).ignoreErrors();
    }

    public addCellBelow() {
        this.postMessage(InteractiveWindowMessages.NotebookAddCellBelow).ignoreErrors();
    }

    public async removeAllCells(): Promise<void> {
        super.removeAllCells();
        // Clear our visible cells
        this.visibleCells = [];
        return this.setDirty();
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
                await this.setDirty();
            } else {
                this.setTitle(path.basename(this._file.fsPath));
            }

            // If that works, send the cells to the web view
            return this.postMessage(InteractiveWindowMessages.LoadAllCells, { cells });
        } catch (e) {
            return this.errorHandler.handleError(e);
        }
    }

    protected submitCode(code: string, file: string, line: number, id?: string, editor?: TextEditor, debug?: boolean): Promise<boolean> {
        // When code is executed, update the version number in the metadata.
        this.updateVersionInfoInNotebook().ignoreErrors();
        return super.submitCode(code, file, line, id, editor, debug);
    }

    @captureTelemetry(Telemetry.SubmitCellThroughInput, undefined, false)
    // tslint:disable-next-line:no-any
    protected submitNewCell(info: ISubmitNewCell) {
        // If there's any payload, it has the code and the id
        if (info && info.code && info.id) {
            // Send to ourselves.
            this.submitCode(info.code, Identifiers.EmptyFileName, 0, info.id).ignoreErrors();

            // Activate the other side, and send as if came from a file
            this.ipynbProvider
                .show(this.file)
                .then(_v => {
                    this.shareMessage(InteractiveWindowMessages.RemoteAddCode, {
                        code: info.code,
                        file: Identifiers.EmptyFileName,
                        line: 0,
                        id: info.id,
                        originator: this.id,
                        debug: false
                    });
                })
                .ignoreErrors();
        }
    }

    @captureTelemetry(Telemetry.ExecuteNativeCell, undefined, false)
    // tslint:disable-next-line:no-any
    protected async reexecuteCell(info: ISubmitNewCell): Promise<void> {
        try {
            // If there's any payload, it has the code and the id
            if (info && info.code && info.id) {
                // Clear the result if we've run before
                await this.clearResult(info.id);

                // Send to ourselves.
                this.submitCode(info.code, Identifiers.EmptyFileName, 0, info.id).ignoreErrors();

                // Activate the other side, and send as if came from a file
                await this.ipynbProvider.show(this.file);
                this.shareMessage(InteractiveWindowMessages.RemoteReexecuteCode, {
                    code: info.code,
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    id: info.id,
                    originator: this.id,
                    debug: false
                });
            }
        } catch (exc) {
            // Make this error our cell output
            this.sendCellsToWebView([
                {
                    data: {
                        source: info.code,
                        cell_type: 'code',
                        outputs: [
                            {
                                output_type: 'error',
                                evalue: exc.toString()
                            }
                        ],
                        metadata: {},
                        execution_count: null
                    },
                    id: info.id,
                    file: Identifiers.EmptyFileName,
                    line: 0,
                    state: CellState.error
                }
            ]);

            // Tell the other side we restarted the kernel. This will stop all executions
            this.postMessage(InteractiveWindowMessages.RestartKernel).ignoreErrors();

            // Handle an error
            await this.errorHandler.handleError(exc);
        }
    }

    protected async getNotebookIdentity(): Promise<Uri> {
        await this.loadedPromise.promise;

        // File should be set now
        return this._file;
    }

    protected async setLaunchingFile(_file: string): Promise<void> {
        // For the native editor, use our own file as the path
        const notebook = this.getNotebook();
        if (this.fileSystem.fileExists(this.file.fsPath) && notebook) {
            await notebook.setLaunchingFile(this.file.fsPath);
        }
    }

    protected sendCellsToWebView(cells: ICell[]) {
        // Filter out sysinfo messages. Don't want to show those
        const filtered = cells.filter(c => c.data.cell_type !== 'messages');

        // Update these cells in our list
        cells.forEach(c => {
            const index = this.visibleCells.findIndex(v => v.id === c.id);
            this.visibleCells[index] = c;
        });

        // Indicate dirty
        this.setDirty().ignoreErrors();

        // Send onto the webview.
        super.sendCellsToWebView(filtered);
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
            const hasCellSelectedContext = new ContextKey(EditorContexts.HaveCellSelected, this.commandManager);
            if (info) {
                interactiveCellsContext.set(info.cellCount > 0).catch();
                redoableContext.set(info.redoCount > 0).catch();
                hasCellSelectedContext.set(info.selectedCell ? true : false).catch();
            } else {
                hasCellSelectedContext.set(false).catch();
                interactiveCellsContext.set(false).catch();
                redoableContext.set(false).catch();
            }
        }
    }

    protected async onViewStateChanged(visible: boolean, active: boolean) {
        super.onViewStateChanged(visible, active);

        // Update our contexts
        const interactiveContext = new ContextKey(EditorContexts.HaveNative, this.commandManager);
        interactiveContext.set(visible && active).catch();
    }

    protected async closeBecauseOfFailure(_exc: Error): Promise<void> {
        // Actually don't close, just let the error bubble out
    }

    /**
     * Update the Python Version number in the notebook data.
     *
     * @private
     * @memberof NativeEditor
     */
    private async updateVersionInfoInNotebook(): Promise<void> {
        // Use the active interpreter
        const usableInterpreter = await this.jupyterExecution.getUsableJupyterPython();
        if (usableInterpreter && usableInterpreter.version && this.notebookJson.metadata && this.notebookJson.metadata.language_info) {
            this.notebookJson.metadata.language_info.version = `${usableInterpreter.version.major}.${usableInterpreter.version.minor}.${usableInterpreter.version.patch}`;
        }
    }

    private async loadContents(contents: string | undefined, forceDirty: boolean): Promise<void> {
        // tslint:disable-next-line: no-any
        const json = contents ? JSON.parse(contents) as any : undefined;

        // Double check json (if we have any)
        if (json && !json.cells) {
            throw new InvalidNotebookFileError(this.file.fsPath);
        }

        // Then compute indent. It's computed from the contents
        if (contents) {
            this.indentAmount = detectIndent(contents).indent;
        }

        // Then save the contents. We'll stick our cells back into this format when we save
        if (json) {
            this.notebookJson = json;
        } else {
            const pythonNumber = await this.extractPythonMainVersion(this.notebookJson);
            // Use this to build our metadata object
            // Use these as the defaults unless we have been given some in the options.
            const metadata: nbformat.INotebookMetadata = {
                language_info: {
                    name: 'python',
                    codemirror_mode: {
                        name: 'ipython',
                        version: pythonNumber
                    }
                },
                orig_nbformat: 2,
                file_extension: '.py',
                mimetype: 'text/x-python',
                name: 'python',
                npconvert_exporter: 'python',
                pygments_lexer: `ipython${pythonNumber}`,
                version: pythonNumber
            };

            // Default notebook data.
            this.notebookJson = {
                nbformat: 4,
                nbformat_minor: 2,
                metadata: metadata
            };
        }

        // Extract cells from the json
        const cells = contents ? json.cells as (nbformat.ICodeCell | nbformat.IRawCell | nbformat.IMarkdownCell)[] : [];

        // Then parse the cells
        return this.loadCells(cells.map((c, index) => {
            return {
                id: `NotebookImport#${index}`,
                file: Identifiers.EmptyFileName,
                line: 0,
                state: CellState.finished,
                data: c
            };
        }), forceDirty);

    }

    private async loadCells(cells: ICell[], forceDirty: boolean): Promise<void> {
        // Make sure cells have at least 1
        if (cells.length === 0) {
            const defaultCell: ICell = {
                id: uuid(),
                line: 0,
                file: Identifiers.EmptyFileName,
                state: CellState.finished,
                data: {
                    cell_type: 'code',
                    outputs: [],
                    source: [],
                    metadata: {},
                    execution_count: null
                }
            };
            cells.splice(0, 0, defaultCell);
            forceDirty = true;
        }

        // Save as our visible list
        this.visibleCells = cells;

        // Make dirty if necessary
        if (forceDirty) {
            await this.setDirty();
        }
        sendTelemetryEvent(Telemetry.CellCount, undefined, { count: cells.length });
        return this.postMessage(InteractiveWindowMessages.LoadAllCells, { cells });
    }

    private getStorageKey(): string {
        return `notebook-storage-${this._file.toString()}`;
    }
    /**
     * Gets any unsaved changes to the notebook file.
     * If the file has been modified since the uncommitted changes were stored, then ignore the uncommitted changes.
     *
     * @private
     * @returns {(Promise<string | undefined>)}
     * @memberof NativeEditor
     */
    private async getStoredContents(): Promise<string | undefined> {
        const key = this.getStorageKey();
        const data = this.globalStorage.get<{ contents?: string; lastModifiedTimeMs?: number }>(key);
        // Check whether the file has been modified since the last time the contents were saved.
        if (data && data.lastModifiedTimeMs && !this.isUntitled && this.file.scheme === 'file') {
            const stat = await this.fileSystem.stat(this.file.fsPath);
            if (stat.mtime > data.lastModifiedTimeMs) {
                return;
            }
        }
        if (data && !this.isUntitled && data.contents) {
            return data.contents;
        }

        const workspaceData = this.localStorage.get<string>(key);
        if (workspaceData && !this.isUntitled) {
            // Make sure to clear so we don't use this again.
            this.localStorage.update(key, undefined);

            // Transfer this to global storage so we use that next time instead
            const stat = await this.fileSystem.stat(this.file.fsPath);
            this.globalStorage.update(key, { contents: workspaceData, lastModifiedTimeMs: stat ? stat.mtime : undefined });

            return workspaceData;
        }
    }

    /**
     * Stores the uncommitted notebook changes into a temporary location.
     * Also keep track of the current time. This way we can check whether changes were
     * made to the file since the last time uncommitted changes were stored.
     *
     * @private
     * @param {string} [contents]
     * @returns {Promise<void>}
     * @memberof NativeEditor
     */
    private async storeContents(contents?: string): Promise<void> {
        const key = this.getStorageKey();
        // Keep track of the time when this data was saved.
        // This way when we retrieve the data we can compare it against last modified date of the file.
        await this.globalStorage.update(key, contents ? { contents, lastModifiedTimeMs: Date.now() } : undefined);
    }

    private async close(): Promise<void> {
        const actuallyClose = async () => {
            // Tell listeners.
            this.closedEvent.fire(this);

            // Restart our kernel so that execution counts are reset
            let oldAsk: boolean | undefined = false;
            const settings = this.configuration.getSettings();
            if (settings && settings.datascience) {
                oldAsk = settings.datascience.askForKernelRestart;
                settings.datascience.askForKernelRestart = false;
            }
            await this.restartKernel();
            if (oldAsk && settings && settings.datascience) {
                settings.datascience.askForKernelRestart = true;
            }
        };

        // Ask user if they want to save. It seems hotExit has no bearing on
        // whether or not we should ask
        if (this._dirty) {
            const askResult = await this.askForSave();
            switch (askResult) {
                case AskForSaveResult.Yes:
                    // Save the file
                    await this.saveToDisk();

                    // Close it
                    await actuallyClose();
                    break;

                case AskForSaveResult.No:
                    // Mark as not dirty, so we update our storage
                    await this.setClean();

                    // Close it
                    await actuallyClose();
                    break;

                default:
                    // Reopen
                    await this.reopen(this.visibleCells);
                    break;
            }
        } else {
            // Not dirty, just close normally.
            return actuallyClose();
        }
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
                const contents = concatMultilineStringInput(cell.data.source);
                const before = contents.substr(0, change.rangeOffset);
                const after = contents.substr(change.rangeOffset + change.rangeLength);
                const newContents = `${before}${normalized}${after}`;
                if (contents !== newContents) {
                    cell.data.source = newContents;
                    this.setDirty().ignoreErrors();
                }
            }
        }
    }

    private async insertCell(request: IInsertCell): Promise<void> {
        // Insert a cell into our visible list based on the index. They should be in sync
        this.visibleCells.splice(request.index, 0, request.cell);

        return this.setDirty();
    }

    private async removeCell(request: IRemoveCell): Promise<void> {
        // Filter our list
        this.visibleCells = this.visibleCells.filter(v => v.id !== request.id);
        return this.setDirty();
    }

    private async swapCells(request: ISwapCells): Promise<void> {
        // Swap two cells in our list
        const first = this.visibleCells.findIndex(v => v.id === request.firstCellId);
        const second = this.visibleCells.findIndex(v => v.id === request.secondCellId);
        if (first >= 0 && second >= 0) {
            const temp = { ...this.visibleCells[first] };
            this.visibleCells[first] = this.visibleCells[second];
            this.visibleCells[second] = temp;
            return this.setDirty();
        }
    }

    private async askForSave(): Promise<AskForSaveResult> {
        const message1 = localize.DataScience.dirtyNotebookMessage1().format(`${path.basename(this.file.fsPath)}`);
        const message2 = localize.DataScience.dirtyNotebookMessage2();
        const yes = localize.DataScience.dirtyNotebookYes();
        const no = localize.DataScience.dirtyNotebookNo();
        // tslint:disable-next-line: messages-must-be-localized
        const result = await this.applicationShell.showInformationMessage(`${message1}\n${message2}`, { modal: true }, yes, no);
        switch (result) {
            case yes:
                return AskForSaveResult.Yes;

            case no:
                return AskForSaveResult.No;

            default:
                return AskForSaveResult.Cancel;
        }
    }

    private async setDirty(): Promise<void> {
        // Always update storage. Don't wait for results.
        this.storeContents(this.generateNotebookContent(this.visibleCells))
            .catch(ex => traceError('Failed to generate notebook content to store in state', ex));

        // Then update dirty flag.
        if (!this._dirty) {
            this._dirty = true;
            this.setTitle(`${path.basename(this.file.fsPath)}*`);

            // Tell the webview we're dirty
            await this.postMessage(InteractiveWindowMessages.NotebookDirty);

            // Tell listeners we're dirty
            this.modifiedEvent.fire(this);
        }
    }

    private async setClean(): Promise<void> {
        // Always update storage
        this.storeContents(undefined)
            .catch(ex => traceError('Failed to clear notebook store', ex));

        if (this._dirty) {
            this._dirty = false;
            this.setTitle(`${path.basename(this.file.fsPath)}`);
            await this.postMessage(InteractiveWindowMessages.NotebookClean);
        }
    }

    @captureTelemetry(Telemetry.ConvertToPythonFile, undefined, false)
    private async export(cells: ICell[]): Promise<void> {
        const status = this.setStatus(localize.DataScience.convertingToPythonFile(), false);
        // First generate a temporary notebook with these cells.
        let tempFile: TemporaryFile | undefined;
        try {
            tempFile = await this.fileSystem.createTemporaryFile('.ipynb');

            // Translate the cells into a notebook
            await this.fileSystem.writeFile(tempFile.filePath, this.generateNotebookContent(cells), { encoding: 'utf-8' });

            // Import this file and show it
            const contents = await this.importer.importFromFile(tempFile.filePath, this.file.fsPath);
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

    private fixupCell(cell: nbformat.ICell): nbformat.ICell {
        // Source is usually a single string on input. Convert back to an array
        return ({
            ...cell,
            source: splitMultilineString(cell.source)
            // tslint:disable-next-line: no-any
        } as any) as nbformat.ICell; // nyc (code coverage) barfs on this so just trick it.
    }

    private async extractPythonMainVersion(notebookData: Partial<nbformat.INotebookContent>): Promise<number> {
        if (notebookData && notebookData.metadata &&
            notebookData.metadata.language_info &&
            notebookData.metadata.language_info.codemirror_mode &&
            // tslint:disable-next-line: no-any
            typeof (notebookData.metadata.language_info.codemirror_mode as any).version === 'number') {

            // tslint:disable-next-line: no-any
            return (notebookData.metadata.language_info.codemirror_mode as any).version;
        }
        // Use the active interpreter
        const usableInterpreter = await this.jupyterExecution.getUsableJupyterPython();
        return usableInterpreter && usableInterpreter.version ? usableInterpreter.version.major : 3;
    }

    private generateNotebookContent(cells: ICell[]): string {
        // Reuse our original json except for the cells.
        const json = {
            ...(this.notebookJson as nbformat.INotebookContent),
            cells: cells.map(c => this.fixupCell(c.data))
        };
        return JSON.stringify(json, null, this.indentAmount);
    }

    @captureTelemetry(Telemetry.Save, undefined, true)
    private async saveToDisk(): Promise<void> {
        try {
            let fileToSaveTo: Uri | undefined = this.file;
            let isDirty = this._dirty;

            // Ask user for a save as dialog if no title
            if (this.isUntitled) {
                const filtersKey = localize.DataScience.dirtyNotebookDialogFilter();
                const filtersObject: { [name: string]: string[] } = {};
                filtersObject[filtersKey] = ['ipynb'];
                isDirty = true;

                fileToSaveTo = await this.applicationShell.showSaveDialog({
                    saveLabel: localize.DataScience.dirtyNotebookDialogTitle(),
                    filters: filtersObject
                });
            }

            if (fileToSaveTo && isDirty) {
                // Write out our visible cells
                await this.fileSystem.writeFile(fileToSaveTo.fsPath, this.generateNotebookContent(this.visibleCells));

                // Update our file name and dirty state
                this._file = fileToSaveTo;
                await this.setClean();
                this.savedEvent.fire(this);
            }
        } catch (e) {
            traceError(e);
        }
    }

    private saveAll(args: ISaveAll) {
        this.visibleCells = args.cells;
        this.saveToDisk().ignoreErrors();
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

    private async clearAllOutputs() {
        this.visibleCells.forEach(cell => {
            cell.data.execution_count = null;
            cell.data.outputs = [];
        });

        await this.setDirty();
    }
}
