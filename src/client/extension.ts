"use strict";

import * as vscode from "vscode";
import {PythonCompletionItemProvider} from "./providers/completionProvider";
import {PythonHoverProvider} from "./providers/hoverProvider";
import {PythonDefinitionProvider} from "./providers/definitionProvider";
import {PythonReferenceProvider} from "./providers/referenceProvider";
import {PythonRenameProvider} from "./providers/renameProvider";
import {PythonFormattingEditProvider} from "./providers/formatProvider";
import * as sortImports from "./sortImports";
import {LintProvider} from "./providers/lintProvider";
import {PythonSymbolProvider} from "./providers/symbolProvider";
import {activateFormatOnSaveProvider} from "./providers/formatOnSaveProvider";
import * as path from "path";
import * as settings from "./common/configSettings";
import {activateUnitTestProvider} from "./providers/testProvider";
import * as telemetryHelper from "./common/telemetry";
import * as telemetryContracts from "./common/telemetryContracts";

const PYTHON: vscode.DocumentFilter = { language: "python", scheme: "file" };
let unitTestOutChannel: vscode.OutputChannel;
let formatOutChannel: vscode.OutputChannel;
let lintingOutChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    let rootDir = context.asAbsolutePath(".");
    let pythonSettings = settings.PythonSettings.getInstance();
    telemetryHelper.sendTelemetryEvent(telemetryContracts.EVENT_LOAD, {
        CodeComplete_Has_ExtraPaths: pythonSettings.autoComplete.extraPaths.length > 0 ? "true" : "false",
        Format_Has_Custom_Python_Path: pythonSettings.pythonPath.length !== "python".length ? "true" : "false"
    });
    unitTestOutChannel = vscode.window.createOutputChannel(pythonSettings.unitTest.outputWindow);
    unitTestOutChannel.clear();
    formatOutChannel = unitTestOutChannel;
    lintingOutChannel = unitTestOutChannel;
    if (pythonSettings.unitTest.outputWindow !== pythonSettings.formatting.outputWindow) {
        formatOutChannel = vscode.window.createOutputChannel(pythonSettings.formatting.outputWindow);
        formatOutChannel.clear();
    }
    if (pythonSettings.unitTest.outputWindow !== pythonSettings.linting.outputWindow) {
        lintingOutChannel = vscode.window.createOutputChannel(pythonSettings.linting.outputWindow);
        lintingOutChannel.clear();
    }

    sortImports.activate(context, formatOutChannel);
    activateUnitTestProvider(context, pythonSettings, unitTestOutChannel);
    context.subscriptions.push(activateFormatOnSaveProvider(PYTHON, pythonSettings, formatOutChannel, vscode.workspace.rootPath));

    // Enable indentAction
    vscode.languages.setLanguageConfiguration(PYTHON.language, {
        onEnterRules: [
            {
                beforeText: /^\s*(?:def|class|for|if|elif|else|while|try|with|finally).*?:\s*$/,
                action: { indentAction: vscode.IndentAction.Indent }
            }
        ]
    });

    context.subscriptions.push(vscode.languages.registerRenameProvider(PYTHON, new PythonRenameProvider(context)));
    context.subscriptions.push(vscode.languages.registerHoverProvider(PYTHON, new PythonHoverProvider(context)));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(PYTHON, new PythonDefinitionProvider(context)));
    context.subscriptions.push(vscode.languages.registerReferenceProvider(PYTHON, new PythonReferenceProvider(context)));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(PYTHON, new PythonCompletionItemProvider(context), "."));
    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(PYTHON, new PythonSymbolProvider(context)));

    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(PYTHON, new PythonFormattingEditProvider(context, formatOutChannel, pythonSettings, vscode.workspace.rootPath)));
    context.subscriptions.push(new LintProvider(context, lintingOutChannel, vscode.workspace.rootPath));
}

// this method is called when your extension is deactivated
export function deactivate() {
}