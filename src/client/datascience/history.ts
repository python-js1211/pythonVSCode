// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../common/extensions';

import * as fs from 'fs-extra';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Event, EventEmitter, Position, Range, Selection, TextEditor, Uri, ViewColumn } from 'vscode';
import { Disposable } from 'vscode-jsonrpc';

import {
    IApplicationShell,
    ICommandManager,
    IDocumentManager,
    ILiveShareApi,
    IWebPanel,
    IWebPanelProvider,
    IWorkspaceService
} from '../common/application/types';
import { CancellationError } from '../common/cancellation';
import { EXTENSION_ROOT_DIR } from '../common/constants';
import { ContextKey } from '../common/contextKey';
import { IFileSystem } from '../common/platform/types';
import { IConfigurationService, IDisposable, IDisposableRegistry, ILogger } from '../common/types';
import { createDeferred } from '../common/utils/async';
import * as localize from '../common/utils/localize';
import { IInterpreterService } from '../interpreter/contracts';
import { captureTelemetry, sendTelemetryEvent } from '../telemetry';
import { EditorContexts, HistoryMessages, Identifiers, Telemetry } from './constants';
import { HistoryMessageListener } from './historyMessageListener';
import { JupyterInstallError } from './jupyter/jupyterInstallError';
import {
    CellState,
    ICell,
    ICodeCssGenerator,
    IConnection,
    IDataScienceExtraSettings,
    IHistory,
    IHistoryInfo,
    IJupyterExecution,
    INotebookExporter,
    INotebookServer,
    INotebookServerManager,
    InterruptResult,
    IStatusProvider
} from './types';

export enum SysInfoReason {
    Start,
    Restart,
    Interrupt
}

@injectable()
export class History implements IHistory {
    private disposed: boolean = false;
    private webPanel: IWebPanel | undefined;
    private loadPromise: Promise<void>;
    private interpreterChangedDisposable: Disposable;
    private closedEvent: EventEmitter<IHistory>;
    private unfinishedCells: ICell[] = [];
    private restartingKernel: boolean = false;
    private potentiallyUnfinishedStatus: Disposable[] = [];
    private addedSysInfo: boolean = false;
    private waitingForExportCells: boolean = false;
    private jupyterServer: INotebookServer | undefined;
    private changeHandler: IDisposable | undefined;
    private messageListener : HistoryMessageListener;

    constructor(
        @inject(ILiveShareApi) liveShare : ILiveShareApi,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IInterpreterService) private interpreterService: IInterpreterService,
        @inject(IWebPanelProvider) private provider: IWebPanelProvider,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(ICodeCssGenerator) private cssGenerator: ICodeCssGenerator,
        @inject(ILogger) private logger: ILogger,
        @inject(IStatusProvider) private statusProvider: IStatusProvider,
        @inject(IJupyterExecution) private jupyterExecution: IJupyterExecution,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(INotebookExporter) private jupyterExporter: INotebookExporter,
        @inject(INotebookServerManager) private jupyterServerManager: INotebookServerManager,
        @inject(IWorkspaceService) private workspaceService: IWorkspaceService) {

        // Sign up for configuration changes
        this.interpreterChangedDisposable = this.interpreterService.onDidChangeInterpreter(this.onInterpreterChanged);
        this.changeHandler = this.configuration.getSettings().onDidChange(this.onSettingsChanged.bind(this));

        // Create our event emitter
        this.closedEvent = new EventEmitter<IHistory>();
        this.disposables.push(this.closedEvent);

        // Create a history message listener to listen to messages from our webpanel (or remote session)
        this.messageListener = new HistoryMessageListener(liveShare, this.onMessage, this.dispose);

        // Load on a background thread.
        this.loadPromise = this.load();
    }

    public async show(): Promise<void> {
        if (!this.disposed) {
            // Make sure we're loaded first
            await this.loadPromise;

            // Make sure we have at least the initial sys info
            await this.addSysInfo(SysInfoReason.Start);

            // Then show our web panel.
            if (this.webPanel && this.jupyterServer) {
                await this.webPanel.show();
            }
        }
    }

    public get closed(): Event<IHistory> {
        return this.closedEvent.event;
    }

    public addCode(code: string, file: string, line: number, editor?: TextEditor) : Promise<void> {
        // Call the internal method.
        return this.submitCode(code, file, line, editor);
    }

    // tslint:disable-next-line: no-any no-empty
    public postMessage(type: string, payload?: any) {
        if (this.webPanel) {
            this.webPanel.postMessage({ type: type, payload: payload });
        }
    }

    // tslint:disable-next-line: no-any no-empty
    public onMessage = (message: string, payload: any) => {
        switch (message) {
            case HistoryMessages.GotoCodeCell:
                this.gotoCode(payload.file, payload.line);
                break;

            case HistoryMessages.RestartKernel:
                this.restartKernel();
                break;

            case HistoryMessages.ReturnAllCells:
                this.handleReturnAllCells(payload);
                break;

            case HistoryMessages.Interrupt:
                this.interruptKernel();
                break;

            case HistoryMessages.Export:
                this.export(payload);
                break;

            case HistoryMessages.SendInfo:
                this.updateContexts(payload);
                break;

            case HistoryMessages.SubmitNewCell:
                this.submitNewCell(payload);
                break;

            case HistoryMessages.DeleteAllCells:
                this.logTelemetry(Telemetry.DeleteAllCells);
                break;

            case HistoryMessages.DeleteCell:
                this.logTelemetry(Telemetry.DeleteCell);
                break;

            case HistoryMessages.Undo:
                this.logTelemetry(Telemetry.Undo);
                break;

            case HistoryMessages.Redo:
                this.logTelemetry(Telemetry.Redo);
                break;

            case HistoryMessages.ExpandAll:
                this.logTelemetry(Telemetry.ExpandAll);
                break;

            case HistoryMessages.CollapseAll:
                this.logTelemetry(Telemetry.CollapseAll);
                break;

            default:
                break;
        }
    }

    public dispose = async () => {
        if (!this.disposed) {
            this.disposed = true;
            if (this.interpreterChangedDisposable) {
                this.interpreterChangedDisposable.dispose();
            }
            if (this.closedEvent) {
                this.closedEvent.fire(this);
            }
            this.updateContexts();
        }
        if (this.changeHandler) {
            this.changeHandler.dispose();
            this.changeHandler = undefined;
        }
    }

    @captureTelemetry(Telemetry.Undo)
    public undoCells() {
        this.postMessage(HistoryMessages.Undo);
    }

    @captureTelemetry(Telemetry.Redo)
    public redoCells() {
        this.postMessage(HistoryMessages.Redo);
    }

    @captureTelemetry(Telemetry.DeleteAllCells)
    public removeAllCells() {
        this.postMessage(HistoryMessages.DeleteAllCells);
    }

    @captureTelemetry(Telemetry.ExpandAll)
    public expandAllCells() {
        this.postMessage(HistoryMessages.ExpandAll);
    }

    @captureTelemetry(Telemetry.CollapseAll)
    public collapseAllCells() {
        this.postMessage(HistoryMessages.CollapseAll);
    }

    public exportCells() {
        // First ask for all cells. Set state to indicate waiting for result
        this.waitingForExportCells = true;

        // Telemetry will fire when the export function is called.
        this.postMessage(HistoryMessages.GetAllCells);
    }

    @captureTelemetry(Telemetry.RestartKernel)
    public restartKernel() {
        if (this.jupyterServer && !this.restartingKernel) {
            // Ask the user if they want us to restart or not.
            const message = localize.DataScience.restartKernelMessage();
            const yes = localize.DataScience.restartKernelMessageYes();
            const no = localize.DataScience.restartKernelMessageNo();

            this.applicationShell.showInformationMessage(message, yes, no).then(v => {
                if (v === yes) {
                    this.restartKernelInternal().catch(e => {
                        this.applicationShell.showErrorMessage(e);
                        this.logger.logError(e);
                    });
                }
            });
        }
    }

    @captureTelemetry(Telemetry.Interrupt)
    public interruptKernel() {
        if (this.jupyterServer && !this.restartingKernel) {
            const status = this.statusProvider.set(localize.DataScience.interruptKernelStatus());

            const settings = this.configuration.getSettings();
            const interruptTimeout = settings.datascience.jupyterInterruptTimeout;

            this.jupyterServer.interruptKernel(interruptTimeout)
                .then(result => {
                    status.dispose();
                    if (result === InterruptResult.TimedOut) {
                        const message = localize.DataScience.restartKernelAfterInterruptMessage();
                        const yes = localize.DataScience.restartKernelMessageYes();
                        const no = localize.DataScience.restartKernelMessageNo();

                        this.applicationShell.showInformationMessage(message, yes, no).then(v => {
                            if (v === yes) {
                                this.restartKernelInternal().catch(e => {
                                    this.applicationShell.showErrorMessage(e);
                                    this.logger.logError(e);
                                });
                            }
                        });
                    } else if (result === InterruptResult.Restarted) {
                        // Uh-oh, keyboard interrupt crashed the kernel.
                        this.addSysInfo(SysInfoReason.Interrupt).ignoreErrors();
                    }
                })
                .catch(err => {
                    status.dispose();
                    this.logger.logError(err);
                    this.applicationShell.showErrorMessage(err);
                });
        }
    }

    private async restartKernelInternal(): Promise<void> {
        this.restartingKernel = true;

        // First we need to finish all outstanding cells.
        this.unfinishedCells.forEach(c => {
            c.state = CellState.error;
            if (this.webPanel) {
                this.webPanel.postMessage({ type: HistoryMessages.FinishCell, payload: c });
            }
        });
        this.unfinishedCells = [];
        this.potentiallyUnfinishedStatus.forEach(s => s.dispose());
        this.potentiallyUnfinishedStatus = [];

        // Set our status
        const status = this.statusProvider.set(localize.DataScience.restartingKernelStatus());

        try {
            if (this.jupyterServer) {
                await this.jupyterServer.restartKernel();
                await this.addSysInfo(SysInfoReason.Restart);
            }
        } finally {
            status.dispose();
            this.restartingKernel = false;
        }
    }

    // tslint:disable-next-line:no-any
    private handleReturnAllCells = (payload: any) => {
        // See what we're waiting for.
        if (this.waitingForExportCells) {
            this.export(payload);
        }
    }

    // tslint:disable-next-line:no-any
    private updateContexts = (payload?: any) => {
        // This should be called by the python interactive window every
        // time state changes. We use this opportunity to update our
        // extension contexts
        const interactiveContext = new ContextKey(EditorContexts.HaveInteractive, this.commandManager);
        interactiveContext.set(!this.disposed).catch();
        const interactiveCellsContext = new ContextKey(EditorContexts.HaveInteractiveCells, this.commandManager);
        const redoableContext = new ContextKey(EditorContexts.HaveRedoableCells, this.commandManager);
        if (payload && payload.info) {
            const info = payload.info as IHistoryInfo;
            if (info) {
                interactiveCellsContext.set(info.cellCount > 0).catch();
                redoableContext.set(info.redoCount > 0).catch();
            } else {
                interactiveCellsContext.set(false).catch();
                redoableContext.set(false).catch();
            }
        } else {
            interactiveCellsContext.set(false).catch();
            redoableContext.set(false).catch();
        }
    }

    @captureTelemetry(Telemetry.SubmitCellThroughInput, undefined, false)
    // tslint:disable-next-line:no-any
    private submitNewCell(payload?: any) {
        // If there's any payload, it has the code and the id
        if (payload && payload.code && payload.id) {
            this.submitCode(payload.code, Identifiers.EmptyFileName, 0, undefined, payload.id).ignoreErrors();
        }
    }

    private async submitCode(code: string, file: string, line: number, editor?: TextEditor, id?: string) : Promise<void> {
        // Start a status item
        const status = this.setStatus(localize.DataScience.executingCode());

        // Create a deferred object that will wait until the status is disposed
        const finishedAddingCode = createDeferred<void>();
        const actualDispose = status.dispose;
        status.dispose = () => {
            finishedAddingCode.resolve();
            actualDispose();
        };

        try {

            // Make sure we're loaded first.
            const statusLoad = this.setStatus(localize.DataScience.startingJupyter());
            try {
                await this.loadPromise;
            } catch (exc) {
                // We should dispose ourselvs if the load fails. Othewise the user
                // updates their install and we just fail again because the load promise is the same.
                await this.dispose();

                throw exc;
            } finally {
                statusLoad.dispose();
            }

            // Then show our webpanel
            await this.show();

            // Add our sys info if necessary
            if (file !== Identifiers.EmptyFileName) {
                await this.addSysInfo(SysInfoReason.Start);
            }

            if (this.jupyterServer) {
                // Before we try to execute code make sure that we have an initial directory set
                // Normally set via the workspace, but we might not have one here if loading a single loose file
                if (file !== Identifiers.EmptyFileName) {
                    await this.jupyterServer.setInitialDirectory(path.dirname(file));
                }

                // Attempt to evaluate this cell in the jupyter notebook
                const observable = this.jupyterServer.executeObservable(code, file, line, id);

                // Sign up for cell changes
                observable.subscribe(
                    (cells: ICell[]) => {
                        this.onAddCodeEvent(cells, undefined);
                    },
                    (error) => {
                        status.dispose();
                        if (!(error instanceof CancellationError)) {
                            this.applicationShell.showErrorMessage(error);
                        }
                    },
                    () => {
                        // Indicate executing until this cell is done.
                        status.dispose();
                    });

                // Wait for the cell to finish
                await finishedAddingCode.promise;
            }
        } catch (err) {
            status.dispose();

            const message = localize.DataScience.executingCodeFailure().format(err);
            this.applicationShell.showErrorMessage(message);
        }
    }

    private setStatus = (message: string): Disposable => {
        const result = this.statusProvider.set(message);
        this.potentiallyUnfinishedStatus.push(result);
        return result;
    }

    private logTelemetry = (event : Telemetry) => {
        sendTelemetryEvent(event);
    }

    private sendCell(cell: ICell, message: string) {
        if (this.webPanel) {
            this.webPanel.postMessage({ type: message, payload: cell });
        }
    }

    private onAddCodeEvent = (cells: ICell[], editor?: TextEditor) => {
        // Send each cell to the other side
        cells.forEach((cell: ICell) => {
            if (this.webPanel) {
                switch (cell.state) {
                    case CellState.init:
                        // Tell the react controls we have a new cell
                        this.sendCell(cell, HistoryMessages.StartCell);

                        // Keep track of this unfinished cell so if we restart we can finish right away.
                        this.unfinishedCells.push(cell);
                        break;

                    case CellState.executing:
                        // Tell the react controls we have an update
                        this.sendCell(cell, HistoryMessages.UpdateCell);
                        break;

                    case CellState.error:
                    case CellState.finished:
                        // Tell the react controls we're done
                        this.sendCell(cell, HistoryMessages.FinishCell);

                        // Remove from the list of unfinished cells
                        this.unfinishedCells = this.unfinishedCells.filter(c => c.id !== cell.id);
                        break;

                    default:
                        break; // might want to do a progress bar or something
                }
            }
        });

        // If we have more than one cell, the second one should be a code cell. After it finishes, we need to inject a new cell entry
        if (cells.length > 1 && cells[1].state === CellState.finished) {
            // If we have an active editor, do the edit there so that the user can undo it, otherwise don't bother
            if (editor) {
                editor.edit((editBuilder) => {
                    editBuilder.insert(new Position(cells[1].line, 0), '#%%\n');
                });
            }
        }
    }

    // Post a message to our webpanel and update our new datascience settings
    private onSettingsChanged = () => {
        // Stringify our settings to send over to the panel
        const dsSettings = JSON.stringify(this.generateDataScienceExtraSettings());

        if (this.webPanel) {
            this.webPanel.postMessage({ type: HistoryMessages.UpdateSettings, payload: dsSettings });
        }
    }

    private onInterpreterChanged = async () => {
        // Update our load promise. We need to restart the jupyter server
        if (this.loadPromise) {
            await this.loadPromise;
            if (this.jupyterServer) {
                await this.jupyterServer.shutdown();
            }
        }
        this.loadPromise = this.load();
    }

    @captureTelemetry(Telemetry.GotoSourceCode, undefined, false)
    private gotoCode(file: string, line: number) {
        this.gotoCodeInternal(file, line).catch(err => {
            this.applicationShell.showErrorMessage(err);
        });
    }

    private async gotoCodeInternal(file: string, line: number) {
        let editor: TextEditor | undefined;

        if (await fs.pathExists(file)) {
            editor = await this.documentManager.showTextDocument(Uri.file(file), { viewColumn: ViewColumn.One });
        } else {
            // File URI isn't going to work. Look through the active text documents
            editor = this.documentManager.visibleTextEditors.find(te => te.document.fileName === file);
            if (editor) {
                editor.show();
            }
        }

        // If we found the editor change its selection
        if (editor) {
            editor.revealRange(new Range(line, 0, line, 0));
            editor.selection = new Selection(new Position(line, 0), new Position(line, 0));
        }
    }

    @captureTelemetry(Telemetry.ExportNotebook, undefined, false)
    // tslint:disable-next-line: no-any no-empty
    private export(payload: any) {
        if (payload.contents) {
            // Should be an array of cells
            const cells = payload.contents as ICell[];
            if (cells && this.applicationShell) {

                const filtersKey = localize.DataScience.exportDialogFilter();
                const filtersObject: Record<string, string[]> = {};
                filtersObject[filtersKey] = ['ipynb'];

                // Bring up the open file dialog box
                this.applicationShell.showSaveDialog(
                    {
                        saveLabel: localize.DataScience.exportDialogTitle(),
                        filters: filtersObject
                    }).then(async (uri: Uri | undefined) => {
                        if (uri) {
                            await this.exportToFile(cells, uri.fsPath);
                        }
                    });
            }
        }
    }

    private exportToFile = async (cells: ICell[], file: string) => {
        // Take the list of cells, convert them to a notebook json format and write to disk
        if (this.jupyterServer) {
            let directoryChange;
            const settings = this.configuration.getSettings();
            if (settings.datascience.changeDirOnImportExport) {
                directoryChange = file;
            }

            const notebook = await this.jupyterExporter.translateToNotebook(cells, directoryChange);

            try {
                // tslint:disable-next-line: no-any
                await this.fileSystem.writeFile(file, JSON.stringify(notebook), { encoding: 'utf8', flag: 'w' });
                this.applicationShell.showInformationMessage(localize.DataScience.exportDialogComplete().format(file), localize.DataScience.exportOpenQuestion()).then((str: string | undefined) => {
                    if (str && this.jupyterServer) {
                        // If the user wants to, open the notebook they just generated.
                        this.jupyterExecution.spawnNotebook(file).ignoreErrors();
                    }
                });
            } catch (exc) {
                this.logger.logError('Error in exporting notebook file');
                this.applicationShell.showInformationMessage(localize.DataScience.exportDialogFailed().format(exc));
            }
        }
    }

    private async loadJupyterServer(restart?: boolean): Promise<void> {
        this.jupyterServer = await this.jupyterServerManager.getOrCreateServer();
    }

    private generateSysInfoCell = async (reason: SysInfoReason): Promise<ICell | undefined> => {
        // Execute the code 'import sys\r\nsys.version' and 'import sys\r\nsys.executable' to get our
        // version and executable
        if (this.jupyterServer) {
            const message = await this.generateSysInfoMessage(reason);

            // The server handles getting this data.
            const sysInfo = await this.jupyterServer.getSysInfo();
            if (sysInfo) {
                // Connection string only for our initial start, not restart or interrupt
                let connectionString: string = '';
                if (reason === SysInfoReason.Start) {
                    connectionString = this.generateConnectionInfoString(this.jupyterServer.getConnectionInfo());
                }

                // Update our sys info with our locally applied data.
                sysInfo.data.message = message;
                sysInfo.data.connection = connectionString;

                return sysInfo;
            }
        }
    }

    private async generateSysInfoMessage(reason: SysInfoReason): Promise<string> {
        switch (reason) {
            case SysInfoReason.Start:
                // Message depends upon if ipykernel is supported or not.
                if (!(await this.jupyterExecution.isKernelCreateSupported())) {
                    return localize.DataScience.pythonVersionHeaderNoPyKernel();
                }
                return localize.DataScience.pythonVersionHeader();
                break;
            case SysInfoReason.Restart:
                return localize.DataScience.pythonRestartHeader();
                break;
            case SysInfoReason.Interrupt:
                return localize.DataScience.pythonInterruptFailedHeader();
                break;
            default:
                this.logger.logError('Invalid SysInfoReason');
                return '';
                break;
        }
    }

    private generateConnectionInfoString(connInfo: IConnection | undefined): string {
        if (!connInfo) {
            return '';
        }

        const tokenString = connInfo.token.length > 0 ? `?token=${connInfo.token}` : '';
        const urlString = `${connInfo.baseUrl}${tokenString}`;

        return `${localize.DataScience.sysInfoURILabel()}${urlString}`;
    }

    private addSysInfo = async (reason: SysInfoReason): Promise<void> => {
        if (!this.addedSysInfo || reason === SysInfoReason.Interrupt || reason === SysInfoReason.Restart) {
            this.addedSysInfo = true;

            // Generate a new sys info cell and send it to the web panel.
            const sysInfo = await this.generateSysInfoCell(reason);
            if (sysInfo) {
                this.onAddCodeEvent([sysInfo]);
            }
        }
    }

    private generateDataScienceExtraSettings() : IDataScienceExtraSettings {
        const terminal = this.workspaceService.getConfiguration('terminal');
        const terminalCursor = terminal ? terminal.get<string>('integrated.cursorStyle', 'block') : 'block';
        return {
            ...this.configuration.getSettings().datascience,
            extraSettings: {
                terminalCursor: terminalCursor
            }
        };
    }

    private loadWebPanel = async (): Promise<void> => {
        // Create our web panel (it's the UI that shows up for the history)
        if (this.webPanel === undefined) {
            // Figure out the name of our main bundle. Should be in our output directory
            const mainScriptPath = path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'history-react', 'index_bundle.js');

            // Generate a css to put into the webpanel for viewing code
            const css = await this.cssGenerator.generateThemeCss();

            // Get our settings to pass along to the react control
            const settings = this.generateDataScienceExtraSettings();

            // Use this script to create our web view panel. It should contain all of the necessary
            // script to communicate with this class.
            this.webPanel = this.provider.create(this.messageListener, localize.DataScience.historyTitle(), mainScriptPath, css, settings);
        }
    }

    private load = async (): Promise<void> => {
        const status = this.setStatus(localize.DataScience.startingJupyter());

        // Check to see if we support ipykernel or not
        try {
            const usableInterpreter = await this.jupyterExecution.getUsableJupyterPython();
            if (!usableInterpreter) {
                // Not loading anymore
                status.dispose();

                // Nobody is useable, throw an exception
                throw new JupyterInstallError(localize.DataScience.jupyterNotSupported(), localize.DataScience.pythonInteractiveHelpLink());
            } else {
                // See if the usable interpreter is not our active one. If so, show a warning
                const active = await this.interpreterService.getActiveInterpreter();
                const activeDisplayName = active ? active.displayName : undefined;
                const activePath = active ? active.path : undefined;
                const usableDisplayName = usableInterpreter ? usableInterpreter.displayName : undefined;
                const usablePath = usableInterpreter ? usableInterpreter.path : undefined;
                if (activePath && usablePath && !this.fileSystem.arePathsSame(activePath, usablePath) && activeDisplayName && usableDisplayName) {
                    this.applicationShell.showWarningMessage(localize.DataScience.jupyterKernelNotSupportedOnActive().format(activeDisplayName, usableDisplayName));
                }
            }

            // Get the web panel to show first
            await this.loadWebPanel();

            // Then load the jupyter server
            return this.loadJupyterServer();

        } finally {
            status.dispose();
        }
    }
}
