'use strict';

import * as vscode from 'vscode';
import { PythonCompletionItemProvider } from './providers/completionProvider';
import { PythonHoverProvider } from './providers/hoverProvider';
import { PythonDefinitionProvider } from './providers/definitionProvider';
import { PythonReferenceProvider } from './providers/referenceProvider';
import { PythonRenameProvider } from './providers/renameProvider';
import { PythonFormattingEditProvider } from './providers/formatProvider';
import * as sortImports from './sortImports';
import { LintProvider } from './providers/lintProvider';
import { PythonSymbolProvider } from './providers/symbolProvider';
import { PythonSignatureProvider } from './providers/signatureProvider';
import * as settings from './common/configSettings';
import * as telemetryHelper from './common/telemetry';
import * as telemetryContracts from './common/telemetryContracts';
import { PythonCodeActionsProvider } from './providers/codeActionProvider';
import { activateSimplePythonRefactorProvider } from './providers/simpleRefactorProvider';
import { activateSetInterpreterProvider } from './providers/setInterpreterProvider';
import { activateExecInTerminalProvider } from './providers/execInTerminalProvider';
import * as tests from './unittests/main';
import * as jup from './jupyter/main';
import { HelpProvider } from './helpProvider';
import { Documentation } from './common/constants';

const PYTHON: vscode.DocumentFilter = { language: 'python', scheme: 'file' };
let unitTestOutChannel: vscode.OutputChannel;
let formatOutChannel: vscode.OutputChannel;
let lintingOutChannel: vscode.OutputChannel;
let jupMain: jup.Jupyter;

export function activate(context: vscode.ExtensionContext) {
    let pythonSettings = settings.PythonSettings.getInstance();
    telemetryHelper.sendTelemetryEvent(telemetryContracts.EVENT_LOAD, {
        CodeComplete_Has_ExtraPaths: pythonSettings.autoComplete.extraPaths.length > 0 ? 'true' : 'false',
        Format_Has_Custom_Python_Path: pythonSettings.pythonPath.length !== 'python'.length ? 'true' : 'false'
    });
    lintingOutChannel = vscode.window.createOutputChannel(pythonSettings.linting.outputWindow);
    formatOutChannel = lintingOutChannel;
    if (pythonSettings.linting.outputWindow !== pythonSettings.formatting.outputWindow) {
        formatOutChannel = vscode.window.createOutputChannel(pythonSettings.formatting.outputWindow);
        formatOutChannel.clear();
    }
    if (pythonSettings.linting.outputWindow !== pythonSettings.unitTest.outputWindow) {
        unitTestOutChannel = vscode.window.createOutputChannel(pythonSettings.unitTest.outputWindow);
        unitTestOutChannel.clear();
    }

    sortImports.activate(context, formatOutChannel);
    context.subscriptions.push(activateSetInterpreterProvider());
    context.subscriptions.push(...activateExecInTerminalProvider());
    activateSimplePythonRefactorProvider(context, formatOutChannel);

    // Enable indentAction
    vscode.languages.setLanguageConfiguration(PYTHON.language, {
        onEnterRules: [
            {
                beforeText: /^\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async).*?:\s*$/,
                action: { indentAction: vscode.IndentAction.Indent }
            }
        ]
    });

    context.subscriptions.push(vscode.languages.registerRenameProvider(PYTHON, new PythonRenameProvider()));
    context.subscriptions.push(vscode.languages.registerHoverProvider(PYTHON, new PythonHoverProvider(context)));
    const definitionProvider = new PythonDefinitionProvider(context);
    const jediProx = definitionProvider.JediProxy;
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(PYTHON, definitionProvider));
    context.subscriptions.push(vscode.languages.registerReferenceProvider(PYTHON, new PythonReferenceProvider(context, jediProx)));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(PYTHON, new PythonCompletionItemProvider(context), '.'));

    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(PYTHON, new PythonSymbolProvider(context, jediProx)));
    if (pythonSettings.devOptions.indexOf('DISABLE_SIGNATURE') === -1) {
        context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(PYTHON, new PythonSignatureProvider(context, jediProx), '(', ','));
    }
    const formatProvider = new PythonFormattingEditProvider(context, formatOutChannel, pythonSettings, vscode.workspace.rootPath);
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(PYTHON, formatProvider));
    context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider(PYTHON, formatProvider));


    jupMain = new jup.Jupyter(lintingOutChannel);
    const documentHasJupyterCodeCells = jupMain.hasCodeCells.bind(jupMain);
    jupMain.activate(null);
    context.subscriptions.push(jupMain);

    context.subscriptions.push(new LintProvider(context, lintingOutChannel, vscode.workspace.rootPath, documentHasJupyterCodeCells));
    context.subscriptions.push(vscode.languages.registerCodeActionsProvider(PYTHON, new PythonCodeActionsProvider(context)));
    tests.activate(context, unitTestOutChannel);

    // Possible this extension loads before the others, so lets wait for 5 seconds
    setTimeout(disableOtherDocumentSymbolsProvider, 5000);

    const hepProvider = new HelpProvider();
    context.subscriptions.push(hepProvider);

    // Check for old outdated settings
    const pySettings = vscode.workspace.getConfiguration('python');
    if (pySettings.get('formatting.formatOnSave') === true) {
        vscode.window.showInformationMessage(`'python.formatting.formatOnSave' has been deprecated. Please use 'editor.formatOnSave' instead`, 'Help').then(item => {
            if (item === 'Help') {
                vscode.commands.executeCommand('python.displayHelp', Documentation.Formatting.FormatOnSave);
            }
        });
    }
}

function disableOtherDocumentSymbolsProvider() {
    const symbolsExt = vscode.extensions.getExtension('donjayamanne.language-symbols');
    if (symbolsExt && symbolsExt.isActive) {
        symbolsExt.exports.disableDocumentSymbolProvider(PYTHON);
    }
}

// this method is called when your extension is deactivated
export function deactivate() {
}