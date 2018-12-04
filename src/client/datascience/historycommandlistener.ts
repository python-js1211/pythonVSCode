// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../common/extensions';

import { inject, injectable } from 'inversify';
import { Position, Range, TextDocument, Uri, ViewColumn } from 'vscode';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';

import { IApplicationShell, ICommandManager, IDocumentManager } from '../common/application/types';
import { CancellationError } from '../common/cancellation';
import { PYTHON_LANGUAGE } from '../common/constants';
import { IFileSystem } from '../common/platform/types';
import { IConfigurationService, IDisposableRegistry, ILogger } from '../common/types';
import * as localize from '../common/utils/localize';
import { captureTelemetry } from '../telemetry';
import { CommandSource } from '../unittests/common/constants';
import { generateCellRanges, generateCellsFromDocument } from './cellFactory';
import { Commands, Telemetry } from './constants';
import {
    IDataScienceCommandListener,
    IHistoryProvider,
    IJupyterExecution,
    INotebookExporter,
    INotebookImporter,
    INotebookServer,
    IStatusProvider
} from './types';

@injectable()
export class HistoryCommandListener implements IDataScienceCommandListener {
    constructor(
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IHistoryProvider) private historyProvider: IHistoryProvider,
        @inject(INotebookImporter) private jupyterImporter: INotebookImporter,
        @inject(INotebookExporter) private jupyterExporter: INotebookExporter,
        @inject(IJupyterExecution) private jupyterExecution: IJupyterExecution,
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(ILogger) private logger: ILogger,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(IStatusProvider) private statusProvider : IStatusProvider)
    {
        // Listen to document open commands. We want to ask the user if they want to import.
        const disposable = this.documentManager.onDidOpenTextDocument(this.onOpenedDocument);
        this.disposableRegistry.push(disposable);
    }

    public register(commandManager: ICommandManager): void {
        let disposable = commandManager.registerCommand(Commands.ShowHistoryPane, () => this.showHistoryPane());
        this.disposableRegistry.push(disposable);
        disposable = commandManager.registerCommand(Commands.ImportNotebook, async (file: Uri, cmdSource: CommandSource = CommandSource.commandPalette) => {
            await this.listenForErrors(async () => {
                if (file && file.fsPath) {
                    await this.importNotebookOnFile(file.fsPath);
                } else {
                    await this.importNotebook();
                }
            });
        });
        this.disposableRegistry.push(disposable);
        disposable = commandManager.registerCommand(Commands.ExportFileAsNotebook, async (file: Uri, cmdSource: CommandSource = CommandSource.commandPalette) => {
            await this.listenForErrors(async () => {
                if (file && file.fsPath) {
                    await this.exportFile(file.fsPath);
                } else {
                    const activeEditor = this.documentManager.activeTextEditor;
                    if (activeEditor && activeEditor.document.languageId === PYTHON_LANGUAGE) {
                        await this.exportFile(activeEditor.document.fileName);
                    }
                }
            });
        });
        this.disposableRegistry.push(disposable);
        disposable = commandManager.registerCommand(Commands.ExportFileAndOutputAsNotebook, async (file: Uri, cmdSource: CommandSource = CommandSource.commandPalette) => {
            await this.listenForErrors(async () => {
                if (file && file.fsPath) {
                    await this.exportFileAndOutput(file.fsPath);
                } else {
                    const activeEditor = this.documentManager.activeTextEditor;
                    if (activeEditor && activeEditor.document.languageId === PYTHON_LANGUAGE) {
                        await this.exportFileAndOutput(activeEditor.document.fileName);
                    }
                }
            });
        });
        this.disposableRegistry.push(disposable);
        this.disposableRegistry.push(commandManager.registerCommand(Commands.UndoCells, () => this.undoCells()));
        this.disposableRegistry.push(commandManager.registerCommand(Commands.RedoCells, () => this.redoCells()));
        this.disposableRegistry.push(commandManager.registerCommand(Commands.RemoveAllCells, () => this.removeAllCells()));
        this.disposableRegistry.push(commandManager.registerCommand(Commands.InterruptKernel, () => this.interruptKernel()));
        this.disposableRegistry.push(commandManager.registerCommand(Commands.RestartKernel, () => this.restartKernel()));
        this.disposableRegistry.push(commandManager.registerCommand(Commands.ExpandAllCells, () => this.expandAllCells()));
        this.disposableRegistry.push(commandManager.registerCommand(Commands.CollapseAllCells, () => this.collapseAllCells()));
        this.disposableRegistry.push(commandManager.registerCommand(Commands.ExportOutputAsNotebook, () => this.exportCells()));
    }

    private async listenForErrors(promise: () => Promise<void>) : Promise<void> {
        try {
            await promise();
        } catch (err) {
            if (!(err instanceof CancellationError)) {
                if (err.message) {
                    this.logger.logError(err.message);
                    this.applicationShell.showErrorMessage(err.message);
                } else {
                    this.logger.logError(err.toString());
                    this.applicationShell.showErrorMessage(err.toString());
                }
            } else {
                this.logger.logInformation('Canceled');
            }
        }
    }

    @captureTelemetry(Telemetry.ExportPythonFile, {}, false)
    private async exportFile(file: string): Promise<void> {
        if (file && file.length > 0) {
            // If the current file is the active editor, then generate cells from the document.
            const activeEditor = this.documentManager.activeTextEditor;
            if (activeEditor && this.fileSystem.arePathsSame(activeEditor.document.fileName, file)) {
                const cells = generateCellsFromDocument(activeEditor.document);
                if (cells) {
                    const filtersKey = localize.DataScience.exportDialogFilter();
                    const filtersObject = {};
                    filtersObject[filtersKey] = ['ipynb'];

                    // Bring up the save file dialog box
                    const uri = await this.applicationShell.showSaveDialog({
                        saveLabel: localize.DataScience.exportDialogTitle(),
                        filters: filtersObject
                    });

                    await this.waitForStatus(async () => {
                        if (uri) {
                            const notebook = await this.jupyterExporter.translateToNotebook(cells);
                            await this.fileSystem.writeFile(uri.fsPath, JSON.stringify(notebook));
                        }
                    }, localize.DataScience.exportingFormat(), file);
                }
            }
        }
    }

    @captureTelemetry(Telemetry.ExportPythonFileAndOutput, {}, false)
    private async exportFileAndOutput(file: string): Promise<void> {
        if (file && file.length > 0 && this.jupyterExecution.isNotebookSupported()) {
            // If the current file is the active editor, then generate cells from the document.
            const activeEditor = this.documentManager.activeTextEditor;
            if (activeEditor && this.fileSystem.arePathsSame(activeEditor.document.fileName, file)) {
                const ranges = generateCellRanges(activeEditor.document);
                if (ranges.length > 0) {
                    // Ask user for path
                    const output = await this.showExportDialog();

                    // If that worked, we need to start a jupyter server to get our output values.
                    // In the future we could potentially only update changed cells.
                    if (output) {
                        // Create a cancellation source so we can cancel starting the jupyter server if necessary
                        const cancelSource = new CancellationTokenSource();

                        // Then wait with status that lets the user cancel
                        await this.waitForStatus(() => {
                            try {
                                return this.exportCellsWithOutput(ranges, activeEditor.document, output, cancelSource.token);
                            } catch (err) {
                                if (!(err instanceof CancellationError)) {
                                    this.applicationShell.showInformationMessage(localize.DataScience.exportDialogFailed().format(err));
                                }
                            }
                            return Promise.resolve();
                        }, localize.DataScience.exportingFormat(), file, () => {
                            cancelSource.cancel();
                        });

                        // When all done, show a notice that it completed.
                        const openQuestion = localize.DataScience.exportOpenQuestion();
                        this.applicationShell.showInformationMessage(localize.DataScience.exportDialogComplete().format(output), openQuestion).then((str: string | undefined) => {
                            if (str === openQuestion && output) {
                                // If the user wants to, open the notebook they just generated.
                                this.jupyterExecution.spawnNotebook(output).ignoreErrors();
                            }
                        });

                    }
                }
            }
        } else {
            this.applicationShell.showErrorMessage(localize.DataScience.jupyterNotSupported());
        }
    }

    private async exportCellsWithOutput(ranges: {range: Range; title: string}[], document: TextDocument, file: string, cancelToken: CancellationToken) : Promise<void> {
        let server: INotebookServer | undefined;
        try {
            // Try starting a server.
            server = await this.jupyterExecution.connectToNotebookServer(undefined, cancelToken);

            // If that works, then execute all of the cells.
            const cells = Array.prototype.concat(... await Promise.all(ranges.map(r => {
                    const code = document.getText(r.range);
                    return server ? server.execute(code, document.fileName, r.range.start.line, cancelToken) : [];
                })));

            // Then save them to the file
            const notebook = await this.jupyterExporter.translateToNotebook(cells);
            await this.fileSystem.writeFile(file, JSON.stringify(notebook));

        } finally {
            if (server) {
                server.dispose();
            }
        }
    }

    private async showExportDialog() : Promise<string | undefined> {
        const filtersKey = localize.DataScience.exportDialogFilter();
        const filtersObject = {};
        filtersObject[filtersKey] = ['ipynb'];

        // Bring up the save file dialog box
        const uri = await this.applicationShell.showSaveDialog({
            saveLabel: localize.DataScience.exportDialogTitle(),
            filters: filtersObject
        });

        return uri ? uri.fsPath : undefined;
    }

    private undoCells() {
        this.historyProvider.getActive()!.undoCells();
    }

    private redoCells() {
        this.historyProvider.getActive()!.redoCells();
    }

    private removeAllCells() {
        this.historyProvider.getActive()!.removeAllCells();
    }

    private interruptKernel() {
        this.historyProvider.getActive()!.interruptKernel();
    }

    private restartKernel() {
        this.historyProvider.getActive()!.restartKernel();
    }

    private expandAllCells() {
        this.historyProvider.getActive()!.expandAllCells();
    }

    private collapseAllCells() {
        this.historyProvider.getActive()!.collapseAllCells();
    }

    private exportCells() {
        this.historyProvider.getActive()!.exportCells();
    }

    private canImportFromOpenedFile = () => {
        const settings = this.configuration.getSettings();
        return settings && (!settings.datascience || settings.datascience.allowImportFromNotebook);
    }

    private disableImportOnOpenedFile = () => {
        const settings = this.configuration.getSettings();
        if (settings && settings.datascience) {
            settings.datascience.allowImportFromNotebook = false;
        }
    }

    private onOpenedDocument = async (document: TextDocument) => {
        if (document.fileName.endsWith('.ipynb') && this.canImportFromOpenedFile()) {
            const yes = localize.DataScience.notebookCheckForImportYes();
            const no = localize.DataScience.notebookCheckForImportNo();
            const dontAskAgain = localize.DataScience.notebookCheckForImportDontAskAgain();

            const answer = await this.applicationShell.showInformationMessage(
                localize.DataScience.notebookCheckForImportTitle(),
                yes, no, dontAskAgain);

            try {
                if (answer === yes) {
                    await this.importNotebookOnFile(document.fileName);
                } else if (answer === dontAskAgain) {
                    this.disableImportOnOpenedFile();
                }
            } catch (err) {
                this.applicationShell.showErrorMessage(err);
            }
        }

    }

    @captureTelemetry(Telemetry.ShowHistoryPane, {}, false)
    private showHistoryPane() : Promise<void>{
        const active = this.historyProvider.getOrCreateActive();
        return active.show();
    }

    private waitForStatus<T>(promise: () => Promise<T>, format: string, file?: string, canceled?: () => void) : Promise<T> {
        const message = file ? format.format(file) : format;
        return this.statusProvider.waitWithStatus(promise, message, undefined, undefined, canceled);
    }

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'command' }, false)
    private async importNotebook() : Promise<void> {

        const filtersKey = localize.DataScience.importDialogFilter();
        const filtersObject = {};
        filtersObject[filtersKey] = ['ipynb'];

        const uris = await this.applicationShell.showOpenDialog(
            {
                openLabel: localize.DataScience.importDialogTitle(),
                filters: filtersObject
            });

        if (uris && uris.length > 0) {
            // Don't call the other overload as we'll end up with double telemetry.
            await this.waitForStatus(async () => {
                const contents = await this.jupyterImporter.importFromFile(uris[0].fsPath);
                await this.viewDocument(contents);
            }, localize.DataScience.importingFormat(), uris[0].fsPath);
        }
    }

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'file' }, false)
    private async importNotebookOnFile(file: string) : Promise<void> {
        if (file && file.length > 0) {
            await this.waitForStatus(async () => {
                const contents = await this.jupyterImporter.importFromFile(file);
                await this.viewDocument(contents);
            }, localize.DataScience.importingFormat(), file);
        }
    }

    private viewDocument = async (contents: string) : Promise<void> => {
        const doc = await this.documentManager.openTextDocument({language: 'python', content: contents});
        const editor = await this.documentManager.showTextDocument(doc, ViewColumn.One);

        // Edit the document so that it is dirty (add a space at the end)
        editor.edit((editBuilder) => {
            editBuilder.insert(new Position(editor.document.lineCount, 0), '\n');
        });

    }
}
