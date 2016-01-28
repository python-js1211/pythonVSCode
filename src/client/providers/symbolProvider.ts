/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as proxy from './jediProxy';

function parseData(data: proxy.ISymbolResult): vscode.SymbolInformation[] {
    if (data) {
        var symbols = data.definitions.map(sym=> {
            var symbol = sym.kind;
            var range = new vscode.Range(sym.lineIndex, sym.columnIndex, sym.lineIndex, sym.columnIndex);
            return new vscode.SymbolInformation(sym.text, symbol, range, vscode.Uri.file(sym.fileName));
        });

        return symbols;
    }
    return;
}

export class PythonSymbolProvider implements vscode.DocumentSymbolProvider {
    private jediProxyHandler: proxy.JediProxyHandler<proxy.ISymbolResult, vscode.SymbolInformation[]>;

    public constructor(context: vscode.ExtensionContext) {
        this.jediProxyHandler = new proxy.JediProxyHandler(context, null, parseData);
    }

    public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
        return new Promise<vscode.SymbolInformation[]>((resolve, reject) => {
            var filename = document.fileName;

            var source = document.getText();
            var cmd: proxy.ICommand<proxy.ISymbolResult> = {
                command: proxy.CommandType.Symbols,
                fileName: filename,
                columnIndex: 0,
                lineIndex: 0,
                source: source
            };
            this.jediProxyHandler.sendCommand(cmd, resolve, token);
        });
    }
}
