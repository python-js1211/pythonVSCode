// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { TerminalShellType } from '../common/terminal/types';
import { InterpreterType } from '../interpreter/contracts';
import { LinterId } from '../linters/types';
import { PlatformErrors } from './constants';

export type EditorLoadTelemetry = {
    condaVersion: string | undefined;
    terminal: TerminalShellType;
};
export type FormatTelemetry = {
    tool: 'autopep8' | 'black' | 'yapf';
    hasCustomArgs: boolean;
    formatSelection: boolean;
};

export type LanguageServerVersionTelemetry = {
    success: boolean;
    lsVersion?: string;
};

export type LanguageServerErrorTelemetry = {
    error: string;
};

export type LanguageServePlatformSupported = {
    supported: boolean;
    failureType?: 'UnknownError';
};

export type LinterTrigger = 'auto' | 'save';

export type LintingTelemetry = {
    tool: LinterId;
    hasCustomArgs: boolean;
    trigger: LinterTrigger;
    executableSpecified: boolean;
};
export type PythonInterpreterTelemetry = {
    trigger: 'ui' | 'shebang' | 'load';
    failed: boolean;
    pythonVersion?: string;
    pipVersion?: string;
};
export type CodeExecutionTelemetry = {
    scope: 'file' | 'selection';
};
export type DebuggerTelemetry = {
    trigger: 'launch' | 'attach';
    console?: 'none' | 'integratedTerminal' | 'externalTerminal';
    hasEnvVars: boolean;
    hasArgs: boolean;
    django: boolean;
    flask: boolean;
    jinja: boolean;
    isLocalhost: boolean;
    isModule: boolean;
    isSudo: boolean;
    stopOnEntry: boolean;
    showReturnValue: boolean;
    pyramid: boolean;
    subProcess: boolean;
};
export type DebuggerPerformanceTelemetry = {
    duration: number;
    action: 'stepIn' | 'stepOut' | 'continue' | 'next' | 'launch';
};
export type TestRunTelemetry = {
    tool: 'nosetest' | 'pytest' | 'unittest';
    scope: 'currentFile' | 'all' | 'file' | 'class' | 'function' | 'failed';
    debugging: boolean;
    triggeredBy: 'ui' | 'codelens' | 'commandpalette' | 'auto';
    failed: boolean;
};
export type TestDiscoverytTelemetry = {
    tool: 'nosetest' | 'pytest' | 'unittest';
    trigger: 'ui' | 'commandpalette';
    failed: boolean;
};
export type FeedbackTelemetry = {
    action: 'accepted' | 'dismissed' | 'doNotShowAgain';
};
export type SettingsTelemetry = {
    enabled: boolean;
};
export type TerminalTelemetry = {
    terminal?: TerminalShellType;
    triggeredBy?: 'commandpalette';
    pythonVersion?: string;
    interpreterType?: InterpreterType;
};
export type DiagnosticsAction = {
    /**
     * Diagnostics command executed.
     * @type {string}
     */
    commandName?: string;
    /**
     * Diagnostisc code ignored (message will not be seen again).
     * @type {string}
     */
    ignoreCode?: string;
    /**
     * Url of web page launched in browser.
     * @type {string}
     */
    url?: string;
    /**
     * Custom actions performed.
     * @type {'switchToCommandPrompt'}
     */
    action?: 'switchToCommandPrompt';
};
export type DiagnosticsMessages = {
    /**
     * Code of diagnostics message detected and displayed.
     * @type {string}
     */
    code: string;
};
export type ImportNotebook = {
    scope: 'command';
};

export type Platform = {
    failureType?: PlatformErrors;
    osVersion?: string;
};

export type TelemetryProperties = FormatTelemetry
    | LanguageServerVersionTelemetry
    | LanguageServerErrorTelemetry
    | LintingTelemetry
    | EditorLoadTelemetry
    | PythonInterpreterTelemetry
    | CodeExecutionTelemetry
    | TestRunTelemetry
    | TestDiscoverytTelemetry
    | FeedbackTelemetry
    | TerminalTelemetry
    | DebuggerTelemetry
    | SettingsTelemetry
    | DiagnosticsAction
    | DiagnosticsMessages
    | ImportNotebook
    | Platform
    | LanguageServePlatformSupported;
