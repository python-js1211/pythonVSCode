// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable, Event, EventEmitter, GlobPattern, TextDocument, window } from 'vscode';
import type {
    notebook,
    NotebookCellsChangeEvent as VSCNotebookCellsChangeEvent,
    NotebookContentProvider,
    NotebookDocument,
    NotebookEditor,
    NotebookKernel,
    NotebookOutputRenderer,
    NotebookOutputSelector
} from 'vscode-proposed';
import { UseProposedApi } from '../constants';
import { IDisposableRegistry } from '../types';
import {
    IVSCodeNotebook,
    NotebookCellLanguageChangeEvent,
    NotebookCellOutputsChangeEvent,
    NotebookCellsChangeEvent
} from './types';

@injectable()
export class VSCodeNotebook implements IVSCodeNotebook {
    public get onDidChangeActiveNotebookEditor(): Event<NotebookEditor | undefined> {
        return this.notebook.onDidChangeActiveNotebookEditor;
    }
    public get onDidOpenNotebookDocument(): Event<NotebookDocument> {
        return this.notebook.onDidOpenNotebookDocument;
    }
    public get onDidCloseNotebookDocument(): Event<NotebookDocument> {
        return this.notebook.onDidCloseNotebookDocument;
    }
    public get notebookEditors() {
        return this.notebook.visibleNotebookEditors;
    }
    public get onDidChangeNotebookDocument(): Event<
        NotebookCellsChangeEvent | NotebookCellOutputsChangeEvent | NotebookCellLanguageChangeEvent
    > {
        return this._onDidChangeNotebookDocument.event;
    }
    public get activeNotebookEditor(): NotebookEditor | undefined {
        if (!this.useProposedApi) {
            return;
        }
        // Temporary, currently VSC API doesn't work well.
        // `notebook.activeNotebookEditor`  is not reset when opening another file.
        if (!this.notebook.activeNotebookEditor) {
            return;
        }
        // If we have a text editor opened and it is not a cell, then we know for certain a notebook is not open.
        if (window.activeTextEditor && !this.isCell(window.activeTextEditor.document)) {
            return;
        }
        // Temporary until VSC API stabilizes.
        if (Array.isArray(this.notebook.visibleNotebookEditors)) {
            return this.notebook.visibleNotebookEditors.find((item) => item.active && item.visible);
        }
        return this.notebook.activeNotebookEditor;
    }
    private get notebook() {
        if (!this._notebook) {
            // tslint:disable-next-line: no-require-imports
            this._notebook = require('vscode').notebook;
        }
        return this._notebook!;
    }
    private readonly _onDidChangeNotebookDocument = new EventEmitter<
        NotebookCellsChangeEvent | NotebookCellOutputsChangeEvent | NotebookCellLanguageChangeEvent
    >();
    private addedEventHandlers?: boolean;
    private _notebook?: typeof notebook;
    private readonly handledCellChanges = new WeakSet<VSCNotebookCellsChangeEvent>();
    constructor(
        @inject(UseProposedApi) private readonly useProposedApi: boolean,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {
        if (this.useProposedApi) {
            this.addEventHandlers();
        }
    }
    public registerNotebookContentProvider(notebookType: string, provider: NotebookContentProvider): Disposable {
        return this.notebook.registerNotebookContentProvider(notebookType, provider);
    }
    public registerNotebookKernel(id: string, selectors: GlobPattern[], kernel: NotebookKernel): Disposable {
        return this.notebook.registerNotebookKernel(id, selectors, kernel);
    }
    public registerNotebookOutputRenderer(
        id: string,
        outputSelector: NotebookOutputSelector,
        renderer: NotebookOutputRenderer
    ): Disposable {
        return this.notebook.registerNotebookOutputRenderer(id, outputSelector, renderer);
    }
    public isCell(textDocument: TextDocument) {
        return (
            (textDocument.uri.fsPath.toLowerCase().includes('.ipynb') &&
                textDocument.uri.query.includes('notebook') &&
                textDocument.uri.query.includes('cell')) ||
            textDocument.uri.scheme.includes('vscode-notebook-cell')
        );
    }
    private addEventHandlers() {
        if (this.addedEventHandlers) {
            return;
        }
        this.addedEventHandlers = true;
        this.disposables.push(
            ...[
                this.notebook.onDidChangeCellLanguage((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCellLanguage' })
                ),
                this.notebook.onDidChangeCellOutputs((e) =>
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCellOutputs' })
                ),
                this.notebook.onDidChangeNotebookCells((e) => {
                    if (this.handledCellChanges.has(e)) {
                        return;
                    }
                    this.handledCellChanges.add(e);
                    this._onDidChangeNotebookDocument.fire({ ...e, type: 'changeCells' });
                })
            ]
        );
    }
}
