/* eslint-disable global-require */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import TelemetryReporter from 'vscode-extension-telemetry/lib/telemetryReporter';

import { LanguageServerType } from '../activation/types';
import { DiagnosticCodes } from '../application/diagnostics/constants';
import { IWorkspaceService } from '../common/application/types';
import { AppinsightsKey, isTestExecution, isUnitTestExecution, PVSC_EXTENSION_ID } from '../common/constants';
import { traceError, traceInfo } from '../common/logger';
import { Telemetry } from '../common/startPage/constants';
import type { TerminalShellType } from '../common/terminal/types';
import { StopWatch } from '../common/utils/stopWatch';
import { isPromise } from '../common/utils/async';
import { DebugConfigurationType } from '../debugger/extension/types';
import { ConsoleType, TriggerType } from '../debugger/types';
import { AutoSelectionRule } from '../interpreter/autoSelection/types';
import { LinterId } from '../linters/types';
import { EnvironmentType } from '../pythonEnvironments/info';
import {
    TensorBoardPromptSelection,
    TensorBoardEntrypointTrigger,
    TensorBoardSessionStartResult,
    TensorBoardEntrypoint,
} from '../tensorBoard/constants';
import { TestProvider } from '../testing/types';
import { EventName, PlatformErrors } from './constants';
import type { LinterTrigger, TestTool } from './types';

/**
 * Checks whether telemetry is supported.
 * Its possible this function gets called within Debug Adapter, vscode isn't available in there.
 * Within DA, there's a completely different way to send telemetry.
 * @returns {boolean}
 */
function isTelemetrySupported(): boolean {
    try {
        const vsc = require('vscode');
        const reporter = require('vscode-extension-telemetry');

        return vsc !== undefined && reporter !== undefined;
    } catch {
        return false;
    }
}

/**
 * Checks if the telemetry is disabled in user settings
 * @returns {boolean}
 */
export function isTelemetryDisabled(workspaceService: IWorkspaceService): boolean {
    const settings = workspaceService.getConfiguration('telemetry').inspect<boolean>('enableTelemetry')!;
    return settings.globalValue === false;
}

const sharedProperties: Record<string, unknown> = {};
/**
 * Set shared properties for all telemetry events.
 */
export function setSharedProperty<P extends ISharedPropertyMapping, E extends keyof P>(name: E, value?: P[E]): void {
    const propertyName = name as string;
    // Ignore such shared telemetry during unit tests.
    if (isUnitTestExecution() && propertyName.startsWith('ds_')) {
        return;
    }
    if (value === undefined) {
        delete sharedProperties[propertyName];
    } else {
        sharedProperties[propertyName] = value;
    }
}

/**
 * Reset shared properties for testing purposes.
 */
export function _resetSharedProperties(): void {
    for (const key of Object.keys(sharedProperties)) {
        delete sharedProperties[key];
    }
}

let telemetryReporter: TelemetryReporter | undefined;
function getTelemetryReporter() {
    if (!isTestExecution() && telemetryReporter) {
        return telemetryReporter;
    }
    const extensionId = PVSC_EXTENSION_ID;

    const { extensions } = require('vscode') as typeof import('vscode');
    const extension = extensions.getExtension(extensionId)!;
    const extensionVersion = extension.packageJSON.version;

    const Reporter = require('vscode-extension-telemetry').default as typeof TelemetryReporter;
    telemetryReporter = new Reporter(extensionId, extensionVersion, AppinsightsKey, true);

    return telemetryReporter;
}

export function clearTelemetryReporter(): void {
    telemetryReporter = undefined;
}

export function sendTelemetryEvent<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    measuresOrDurationMs?: Record<string, number> | number,
    properties?: P[E],
    ex?: Error,
): void {
    if (isTestExecution() || !isTelemetrySupported()) {
        return;
    }
    const reporter = getTelemetryReporter();
    const measures =
        typeof measuresOrDurationMs === 'number'
            ? { duration: measuresOrDurationMs }
            : measuresOrDurationMs || undefined;
    const customProperties: Record<string, string> = {};
    const eventNameSent = eventName as string;

    if (properties) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = properties as any;
        Object.getOwnPropertyNames(data).forEach((prop) => {
            if (data[prop] === undefined || data[prop] === null) {
                return;
            }
            try {
                // If there are any errors in serializing one property, ignore that and move on.
                // Else nothing will be sent.
                switch (typeof data[prop]) {
                    case 'string':
                        customProperties[prop] = data[prop];
                        break;
                    case 'object':
                        customProperties[prop] = 'object';
                        break;
                    default:
                        customProperties[prop] = data[prop].toString();
                        break;
                }
            } catch (exception) {
                traceError(`Failed to serialize ${prop} for ${eventName}`, exception);
            }
        });
    }

    // Add shared properties to telemetry props (we may overwrite existing ones).
    Object.assign(customProperties, sharedProperties);

    if (ex) {
        const errorProps = {
            errorName: ex.name,
            errorMessage: ex.message,
            errorStack: ex.stack ?? '',
        };
        Object.assign(customProperties, errorProps);

        // To avoid hardcoding the names and forgetting to update later.
        const errorPropNames = Object.getOwnPropertyNames(errorProps);
        reporter.sendTelemetryErrorEvent(eventNameSent, customProperties, measures, errorPropNames);
    } else {
        reporter.sendTelemetryEvent(eventNameSent, customProperties, measures);
    }

    if (process.env && process.env.VSC_PYTHON_LOG_TELEMETRY) {
        traceInfo(
            `Telemetry Event : ${eventNameSent} Measures: ${JSON.stringify(measures)} Props: ${JSON.stringify(
                customProperties,
            )} `,
        );
    }
}

// Type-parameterized form of MethodDecorator in lib.es5.d.ts.
type TypedMethodDescriptor<T> = (
    target: unknown,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
) => TypedPropertyDescriptor<T> | void;

// The following code uses "any" in many places, as TS does not have rich support
// for typing decorators. Specifically, while it is possible to write types which
// encode the signature of the wrapped function, TS fails to actually infer the
// type of "this" and the signature at call sites, instead choosing to infer
// based on other hints (like the closure parameters), which ends up making it
// no safer than "any" (and sometimes misleading enough to be more unsafe).

/**
 * Decorates a method, sending a telemetry event with the given properties.
 * @param eventName The event name to send.
 * @param properties Properties to send with the event; must be valid for the event.
 * @param captureDuration True if the method's execution duration should be captured.
 * @param failureEventName If the decorated method returns a Promise and fails, send this event instead of eventName.
 * @param lazyProperties A static function on the decorated class which returns extra properties to add to the event.
 * This can be used to provide properties which are only known at runtime (after the decorator has executed).
 * @param lazyMeasures A static function on the decorated class which returns extra measures to add to the event.
 * This can be used to provide measures which are only known at runtime (after the decorator has executed).
 */
export function captureTelemetry<This, P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    properties?: P[E],
    captureDuration = true,
    failureEventName?: E,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lazyProperties?: (obj: This, result?: any) => P[E],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lazyMeasures?: (obj: This, result?: any) => Record<string, number>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): TypedMethodDescriptor<(this: This, ...args: any[]) => any> {
    return function (
        _target: unknown,
        _propertyKey: string | symbol,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        descriptor: TypedPropertyDescriptor<(this: This, ...args: any[]) => any>,
    ) {
        const originalMethod = descriptor.value!;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        descriptor.value = function (this: This, ...args: any[]) {
            // Legacy case; fast path that sends event before method executes.
            // Does not set "failed" if the result is a Promise and throws an exception.
            if (!captureDuration && !lazyProperties && !lazyMeasures) {
                sendTelemetryEvent(eventName, undefined, properties);

                return originalMethod.apply(this, args);
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const getProps = (result?: any) => {
                if (lazyProperties) {
                    return { ...properties, ...lazyProperties(this, result) };
                }
                return properties;
            };

            const stopWatch = captureDuration ? new StopWatch() : undefined;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const getMeasures = (result?: any) => {
                const measures = stopWatch ? { duration: stopWatch.elapsedTime } : undefined;
                if (lazyMeasures) {
                    return { ...measures, ...lazyMeasures(this, result) };
                }
                return measures;
            };

            const result = originalMethod.apply(this, args);

            // If method being wrapped returns a promise then wait for it.
            if (result && isPromise(result)) {
                result
                    .then((data) => {
                        sendTelemetryEvent(eventName, getMeasures(data), getProps(data));
                        return data;
                    })
                    .catch((ex) => {
                        const failedProps: P[E] = { ...getProps(), failed: true } as P[E] & FailedEventType;
                        sendTelemetryEvent(failureEventName || eventName, getMeasures(), failedProps, ex);
                    });
            } else {
                sendTelemetryEvent(eventName, getMeasures(result), getProps(result));
            }

            return result;
        };

        return descriptor;
    };
}

// function sendTelemetryWhenDone<T extends IDSMappings, K extends keyof T>(eventName: K, properties?: T[K]);
export function sendTelemetryWhenDone<P extends IEventNamePropertyMapping, E extends keyof P>(
    eventName: E,
    promise: Promise<unknown> | Thenable<unknown>,
    stopWatch?: StopWatch,
    properties?: P[E],
): void {
    stopWatch = stopWatch || new StopWatch();
    if (typeof promise.then === 'function') {
        (promise as Promise<unknown>).then(
            (data) => {
                sendTelemetryEvent(eventName, stopWatch!.elapsedTime, properties);
                return data;
            },
            (ex) => {
                sendTelemetryEvent(eventName, stopWatch!.elapsedTime, properties, ex);
                return Promise.reject(ex);
            },
        );
    } else {
        throw new Error('Method is neither a Promise nor a Theneable');
    }
}

/**
 * Map all shared properties to their data types.
 */
export interface ISharedPropertyMapping {
    /**
     * For every DS telemetry we would like to know the type of Notebook Editor used when doing something.
     */
    ['ds_notebookeditor']: undefined | 'old' | 'custom' | 'native';

    /**
     * For every telemetry event from the extension we want to make sure we can associate it with install
     * source. We took this approach to work around very limiting query performance issues.
     */
    ['installSource']: undefined | 'marketPlace' | 'pythonCodingPack';
}

type FailedEventType = { failed: true };

// Map all events to their properties
export interface IEventNamePropertyMapping {
    /**
     * Telemetry event sent when providing completion items for the given position and document.
     *
     * This event also has a measure, "resultLength", which records the number of completions provided.
     */
    [EventName.COMPLETION]: never | undefined;
    /**
     * Telemetry event sent with details 'python.autoComplete.addBrackets' setting
     */
    [EventName.COMPLETION_ADD_BRACKETS]: {
        /**
         * Carries boolean `true` if 'python.autoComplete.addBrackets' is set to true, `false` otherwise
         */
        enabled: boolean;
    };
    /**
     * Telemetry event captured when debug adapter executable is created
     */
    [EventName.DEBUG_ADAPTER_USING_WHEELS_PATH]: {
        /**
         * Carries boolean
         * - `true` if path used for the adapter is the debugger with wheels.
         * - `false` if path used for the adapter is the source only version of the debugger.
         */
        usingWheels: boolean;
    };
    /**
     * Telemetry captured before starting debug session.
     */
    [EventName.DEBUG_SESSION_START]: {
        /**
         * Trigger for starting the debugger.
         * - `launch`: Launch/start new code and debug it.
         * - `attach`: Attach to an exiting python process (remote debugging).
         * - `test`: Debugging python tests.
         *
         * @type {TriggerType}
         */
        trigger: TriggerType;
        /**
         * Type of console used.
         *  -`internalConsole`: Use VS Code debug console (no shells/terminals).
         * - `integratedTerminal`: Use VS Code terminal.
         * - `externalTerminal`: Use an External terminal.
         *
         * @type {ConsoleType}
         */
        console?: ConsoleType;
    };
    /**
     * Telemetry captured when debug session runs into an error.
     */
    [EventName.DEBUG_SESSION_ERROR]: {
        /**
         * Trigger for starting the debugger.
         * - `launch`: Launch/start new code and debug it.
         * - `attach`: Attach to an exiting python process (remote debugging).
         * - `test`: Debugging python tests.
         *
         * @type {TriggerType}
         */
        trigger: TriggerType;
        /**
         * Type of console used.
         *  -`internalConsole`: Use VS Code debug console (no shells/terminals).
         * - `integratedTerminal`: Use VS Code terminal.
         * - `externalTerminal`: Use an External terminal.
         *
         * @type {ConsoleType}
         */
        console?: ConsoleType;
    };
    /**
     * Telemetry captured after stopping debug session.
     */
    [EventName.DEBUG_SESSION_STOP]: {
        /**
         * Trigger for starting the debugger.
         * - `launch`: Launch/start new code and debug it.
         * - `attach`: Attach to an exiting python process (remote debugging).
         * - `test`: Debugging python tests.
         *
         * @type {TriggerType}
         */
        trigger: TriggerType;
        /**
         * Type of console used.
         *  -`internalConsole`: Use VS Code debug console (no shells/terminals).
         * - `integratedTerminal`: Use VS Code terminal.
         * - `externalTerminal`: Use an External terminal.
         *
         * @type {ConsoleType}
         */
        console?: ConsoleType;
    };
    /**
     * Telemetry captured when user code starts running after loading the debugger.
     */
    [EventName.DEBUG_SESSION_USER_CODE_RUNNING]: {
        /**
         * Trigger for starting the debugger.
         * - `launch`: Launch/start new code and debug it.
         * - `attach`: Attach to an exiting python process (remote debugging).
         * - `test`: Debugging python tests.
         *
         * @type {TriggerType}
         */
        trigger: TriggerType;
        /**
         * Type of console used.
         *  -`internalConsole`: Use VS Code debug console (no shells/terminals).
         * - `integratedTerminal`: Use VS Code terminal.
         * - `externalTerminal`: Use an External terminal.
         *
         * @type {ConsoleType}
         */
        console?: ConsoleType;
    };
    /**
     * Telemetry captured when starting the debugger.
     */
    [EventName.DEBUGGER]: {
        /**
         * Trigger for starting the debugger.
         * - `launch`: Launch/start new code and debug it.
         * - `attach`: Attach to an exiting python process (remote debugging).
         * - `test`: Debugging python tests.
         *
         * @type {TriggerType}
         */
        trigger: TriggerType;
        /**
         * Type of console used.
         *  -`internalConsole`: Use VS Code debug console (no shells/terminals).
         * - `integratedTerminal`: Use VS Code terminal.
         * - `externalTerminal`: Use an External terminal.
         *
         * @type {ConsoleType}
         */
        console?: ConsoleType;
        /**
         * Whether user has defined environment variables.
         * Could have been defined in launch.json or the env file (defined in `settings.json`).
         * Default `env file` is `.env` in the workspace folder.
         *
         * @type {boolean}
         */
        hasEnvVars: boolean;
        /**
         * Whether there are any CLI arguments that need to be passed into the program being debugged.
         *
         * @type {boolean}
         */
        hasArgs: boolean;
        /**
         * Whether the user is debugging `django`.
         *
         * @type {boolean}
         */
        django: boolean;
        /**
         * Whether the user is debugging `fastapi`.
         *
         * @type {boolean}
         */
        fastapi: boolean;
        /**
         * Whether the user is debugging `flask`.
         *
         * @type {boolean}
         */
        flask: boolean;
        /**
         * Whether the user is debugging `jinja` templates.
         *
         * @type {boolean}
         */
        jinja: boolean;
        /**
         * Whether user is attaching to a local python program (attach scenario).
         *
         * @type {boolean}
         */
        isLocalhost: boolean;
        /**
         * Whether debugging a module.
         *
         * @type {boolean}
         */
        isModule: boolean;
        /**
         * Whether debugging with `sudo`.
         *
         * @type {boolean}
         */
        isSudo: boolean;
        /**
         * Whether required to stop upon entry.
         *
         * @type {boolean}
         */
        stopOnEntry: boolean;
        /**
         * Whether required to display return types in debugger.
         *
         * @type {boolean}
         */
        showReturnValue: boolean;
        /**
         * Whether debugging `pyramid`.
         *
         * @type {boolean}
         */
        pyramid: boolean;
        /**
         * Whether debugging a subprocess.
         *
         * @type {boolean}
         */
        subProcess: boolean;
        /**
         * Whether debugging `watson`.
         *
         * @type {boolean}
         */
        watson: boolean;
        /**
         * Whether degbugging `pyspark`.
         *
         * @type {boolean}
         */
        pyspark: boolean;
        /**
         * Whether using `gevent` when debugging.
         *
         * @type {boolean}
         */
        gevent: boolean;
        /**
         * Whether debugging `scrapy`.
         *
         * @type {boolean}
         */
        scrapy: boolean;
    };
    /**
     * Telemetry event sent when attaching to child process
     */
    [EventName.DEBUGGER_ATTACH_TO_CHILD_PROCESS]: never | undefined;
    /**
     * Telemetry event sent when attaching to a local process.
     */
    [EventName.DEBUGGER_ATTACH_TO_LOCAL_PROCESS]: never | undefined;
    /**
     * Telemetry sent after building configuration for debugger
     */
    [EventName.DEBUGGER_CONFIGURATION_PROMPTS]: {
        /**
         * The type of debug configuration to build configuration for
         *
         * @type {DebugConfigurationType}
         */
        configurationType: DebugConfigurationType;
        /**
         * Carries `true` if we are able to auto-detect manage.py path for Django, `false` otherwise
         *
         * @type {boolean}
         */
        autoDetectedDjangoManagePyPath?: boolean;
        /**
         * Carries `true` if we are able to auto-detect .ini file path for Pyramid, `false` otherwise
         *
         * @type {boolean}
         */
        autoDetectedPyramidIniPath?: boolean;
        /**
         * Carries `true` if we are able to auto-detect main.py path for FastAPI, `false` otherwise
         *
         * @type {boolean}
         */
        autoDetectedFastAPIMainPyPath?: boolean;
        /**
         * Carries `true` if we are able to auto-detect app.py path for Flask, `false` otherwise
         *
         * @type {boolean}
         */
        autoDetectedFlaskAppPyPath?: boolean;
        /**
         * Carries `true` if user manually entered the required path for the app
         * (path to `manage.py` for Django, path to `.ini` for Pyramid, path to `app.py` for Flask), `false` otherwise
         *
         * @type {boolean}
         */
        manuallyEnteredAValue?: boolean;
    };
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST]: never | undefined;
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR]: never | undefined;
    [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS]: never | undefined;
    /**
     * Telemetry event sent when providing completion provider in launch.json. It is sent just *after* inserting the completion.
     */
    [EventName.DEBUGGER_CONFIGURATION_PROMPTS_IN_LAUNCH_JSON]: never | undefined;
    /**
     * Telemetry is sent when providing definitions for python code, particularly when [go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition)
     * and peek definition features are used.
     */
    [EventName.DEFINITION]: never | undefined;
    /**
     * Telemetry event sent with details of actions when invoking a diagnostic command
     */
    [EventName.DIAGNOSTICS_ACTION]: {
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
    /**
     * Telemetry event sent when we are checking if we can handle the diagnostic code
     */
    [EventName.DIAGNOSTICS_MESSAGE]: {
        /**
         * Code of diagnostics message detected and displayed.
         * @type {string}
         */
        code: DiagnosticCodes;
    };
    /**
     * Telemetry event sent with details just after editor loads
     */
    [EventName.EDITOR_LOAD]: {
        /**
         * The conda version if selected
         */
        condaVersion: string | undefined;
        /**
         * The python interpreter version if selected
         */
        pythonVersion: string | undefined;
        /**
         * The type of interpreter (conda, virtualenv, pipenv etc.)
         */
        interpreterType: EnvironmentType | undefined;
        /**
         * The type of terminal shell created: powershell, cmd, zsh, bash etc.
         *
         * @type {TerminalShellType}
         */
        terminal: TerminalShellType;
        /**
         * Number of workspace folders opened
         */
        workspaceFolderCount: number;
        /**
         * If interpreters found for the main workspace contains a python3 interpreter
         */
        hasPython3: boolean;
        /**
         * If user has defined an interpreter in settings.json
         */
        usingUserDefinedInterpreter: boolean;
        /**
         * If interpreter is auto selected for the workspace
         */
        usingAutoSelectedWorkspaceInterpreter: boolean;
        /**
         * If global interpreter is being used
         */
        usingGlobalInterpreter: boolean;
    };
    /**
     * Telemetry event sent when substituting Environment variables to calculate value of variables
     */
    [EventName.ENVFILE_VARIABLE_SUBSTITUTION]: never | undefined;
    /**
     * Telemetry event sent when an environment file is detected in the workspace.
     */
    [EventName.ENVFILE_WORKSPACE]: {
        /**
         * If there's a custom path specified in the python.envFile workspace settings.
         */
        hasCustomEnvPath: boolean;
    };
    /**
     * Telemetry Event sent when user sends code to be executed in the terminal.
     *
     */
    [EventName.EXECUTION_CODE]: {
        /**
         * Whether the user executed a file in the terminal or just the selected text.
         *
         * @type {('file' | 'selection')}
         */
        scope: 'file' | 'selection';
        /**
         * How was the code executed (through the command or by clicking the `Run File` icon).
         *
         * @type {('command' | 'icon')}
         */
        trigger?: 'command' | 'icon';
    };
    /**
     * Telemetry Event sent when user executes code against Django Shell.
     * Values sent:
     * scope
     *
     */
    [EventName.EXECUTION_DJANGO]: {
        /**
         * If `file`, then the file was executed in the django shell.
         * If `selection`, then the selected text was sent to the django shell.
         *
         * @type {('file' | 'selection')}
         */
        scope: 'file' | 'selection';
    };
    /**
     * Telemetry event sent with details when formatting a document
     */
    [EventName.FORMAT]: {
        /**
         * Tool being used to format
         */
        tool: 'autopep8' | 'black' | 'yapf';
        /**
         * If arguments for formatter is provided in resource settings
         */
        hasCustomArgs: boolean;
        /**
         * Carries `true` when formatting a selection of text, `false` otherwise
         */
        formatSelection: boolean;
    };
    /**
     * Telemetry event sent with the value of setting 'Format on type'
     */
    [EventName.FORMAT_ON_TYPE]: {
        /**
         * Carries `true` if format on type is enabled, `false` otherwise
         *
         * @type {boolean}
         */
        enabled: boolean;
    };
    /**
     * Telemetry event sent when sorting imports using formatter
     */
    [EventName.FORMAT_SORT_IMPORTS]: never | undefined;
    /**
     * Telemetry event sent when Go to Python object command is executed
     */
    [EventName.GO_TO_OBJECT_DEFINITION]: never | undefined;
    /**
     * Telemetry event sent when providing a hover for the given position and document for interactive window using Jedi.
     */
    [EventName.HOVER_DEFINITION]: never | undefined;
    /**
     * Telemetry event sent with details when tracking imports
     */
    [EventName.HASHED_PACKAGE_NAME]: {
        /**
         * Hash of the package name
         *
         * @type {string}
         */
        hashedName: string;
    };
    [EventName.HASHED_PACKAGE_PERF]: never | undefined;

    /**
     * Telemetry event sent when installing modules
     */
    [EventName.PYTHON_INSTALL_PACKAGE]: {
        /**
         * The name of the module. (pipenv, Conda etc.)
         *
         * @type {string}
         */
        installer: string;
    };
    /**
     * Telemetry sent with details immediately after linting a document completes
     */
    [EventName.LINTING]: {
        /**
         * Name of the linter being used
         *
         * @type {LinterId}
         */
        tool: LinterId;
        /**
         * If custom arguments for linter is provided in settings.json
         *
         * @type {boolean}
         */
        hasCustomArgs: boolean;
        /**
         * Carries the source which triggered configuration of tests
         *
         * @type {LinterTrigger}
         */
        trigger: LinterTrigger;
        /**
         * Carries `true` if linter executable is specified, `false` otherwise
         *
         * @type {boolean}
         */
        executableSpecified: boolean;
    };
    /**
     * Telemetry event sent after fetching the OS version
     */
    [EventName.PLATFORM_INFO]: {
        /**
         * If fetching OS version fails, list the failure type
         *
         * @type {PlatformErrors}
         */
        failureType?: PlatformErrors;
        /**
         * The OS version of the platform
         *
         * @type {string}
         */
        osVersion?: string;
    };
    /**
     * Telemetry event sent when 'Select Interpreter' command is invoked.
     */
    [EventName.SELECT_INTERPRETER]: never | undefined;
    /**
     * Telemetry event sent when 'Enter interpreter path' button is clicked.
     */
    [EventName.SELECT_INTERPRETER_ENTER_BUTTON]: never | undefined;
    /**
     * Telemetry event sent with details about what choice user made to input the interpreter path.
     */
    [EventName.SELECT_INTERPRETER_ENTER_CHOICE]: {
        /**
         * Carries 'enter' if user chose to enter the path to executable.
         * Carries 'browse' if user chose to browse for the path to the executable.
         */
        choice: 'enter' | 'browse';
    };
    /**
     * Telemetry event sent after an action has been taken while the interpreter quickpick was displayed,
     * and if the action was not 'Enter interpreter path'.
     */
    [EventName.SELECT_INTERPRETER_SELECTED]: {
        /**
         * 'escape' if the quickpick was dismissed.
         * 'selected' if an interpreter was selected.
         */
        action: 'escape' | 'selected';
    };
    /**
     * Telemetry event sent when the user select to either enter or find the interpreter from the quickpick.
     */
    [EventName.SELECT_INTERPRETER_ENTER_OR_FIND]: never | undefined;
    /**
     * Telemetry event sent after the user entered an interpreter path, or found it by browsing the filesystem.
     */
    [EventName.SELECT_INTERPRETER_ENTERED_EXISTS]: {
        /**
         * Carries `true` if the interpreter that was selected had already been discovered earlier (exists in the cache).
         */
        discovered: boolean;
    };
    /**
     * Telemetry event sent with details after updating the python interpreter
     */
    [EventName.PYTHON_INTERPRETER]: {
        /**
         * Carries the source which triggered the update
         *
         * @type {('ui' | 'shebang' | 'load')}
         */
        trigger: 'ui' | 'shebang' | 'load';
        /**
         * Carries `true` if updating python interpreter failed
         *
         * @type {boolean}
         */
        failed: boolean;
        /**
         * The python version of the interpreter
         *
         * @type {string}
         */
        pythonVersion?: string;
    };
    [EventName.PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES]: {
        /**
         * Carries `true` if environment variables are present, `false` otherwise
         *
         * @type {boolean}
         */
        hasEnvVars?: boolean;
        /**
         * Carries `true` if fetching environment variables failed, `false` otherwise
         *
         * @type {boolean}
         */
        failed?: boolean;
    };
    /**
     * Telemetry event sent when getting activation commands for active interpreter
     */
    [EventName.PYTHON_INTERPRETER_ACTIVATION_FOR_RUNNING_CODE]: {
        /**
         * Carries `true` if activation commands exists for interpreter, `false` otherwise
         *
         * @type {boolean}
         */
        hasCommands?: boolean;
        /**
         * Carries `true` if fetching activation commands for interpreter failed, `false` otherwise
         *
         * @type {boolean}
         */
        failed?: boolean;
        /**
         * The type of terminal shell to activate
         *
         * @type {TerminalShellType}
         */
        terminal: TerminalShellType;
        /**
         * The Python interpreter version of the active interpreter for the resource
         *
         * @type {string}
         */
        pythonVersion?: string;
        /**
         * The type of the interpreter used
         *
         * @type {EnvironmentType}
         */
        interpreterType: EnvironmentType;
    };
    /**
     * Telemetry event sent when getting activation commands for terminal when interpreter is not specified
     */
    [EventName.PYTHON_INTERPRETER_ACTIVATION_FOR_TERMINAL]: {
        /**
         * Carries `true` if activation commands exists for terminal, `false` otherwise
         *
         * @type {boolean}
         */
        hasCommands?: boolean;
        /**
         * Carries `true` if fetching activation commands for terminal failed, `false` otherwise
         *
         * @type {boolean}
         */
        failed?: boolean;
        /**
         * The type of terminal shell to activate
         *
         * @type {TerminalShellType}
         */
        terminal: TerminalShellType;
        /**
         * The Python interpreter version of the interpreter for the resource
         *
         * @type {string}
         */
        pythonVersion?: string;
        /**
         * The type of the interpreter used
         *
         * @type {EnvironmentType}
         */
        interpreterType: EnvironmentType;
    };
    [EventName.PYTHON_INTERPRETER_AUTO_SELECTION]: {
        /**
         * The rule used to auto-select the interpreter
         *
         * @type {AutoSelectionRule}
         */
        rule?: AutoSelectionRule;
        /**
         * If cached interpreter no longer exists or is invalid
         *
         * @type {boolean}
         */
        interpreterMissing?: boolean;
        /**
         * Carries `true` if next rule is identified for autoselecting interpreter
         *
         * @type {boolean}
         */
        identified?: boolean;
        /**
         * Carries `true` if cached interpreter is updated to use the current interpreter, `false` otherwise
         *
         * @type {boolean}
         */
        updated?: boolean;
    };
    /**
     * Sends information regarding discovered python environments (virtualenv, conda, pipenv etc.)
     */
    [EventName.PYTHON_INTERPRETER_DISCOVERY]: {
        /**
         * Name of the locator
         */
        locator: string;
        /**
         * The number of the interpreters returned by locator
         */
        interpreters?: number;
    };
    /**
     * Telemetry event sent when pipenv interpreter discovery is executed.
     */
    [EventName.PIPENV_INTERPRETER_DISCOVERY]: never | undefined;
    /**
     * Telemetry event sent with details when user clicks the prompt with the following message
     * `Prompt message` :- 'We noticed you're using a conda environment. If you are experiencing issues with this environment in the integrated terminal, we suggest the "terminal.integrated.inheritEnv" setting to be changed to false. Would you like to update this setting?'
     */
    [EventName.CONDA_INHERIT_ENV_PROMPT]: {
        /**
         * `Yes` When 'Yes' option is selected
         * `No` When 'No' option is selected
         * `More info` When 'More Info' option is selected
         */
        selection: 'Yes' | 'No' | 'More Info' | undefined;
    };
    /**
     * Telemetry event sent with details when user clicks the prompt with the following message
     * `Prompt message` :- 'We found a Python environment in this workspace. Do you want to select it to start up the features in the Python extension? Only accept if you trust this environment.'
     */
    [EventName.UNSAFE_INTERPRETER_PROMPT]: {
        /**
         * `Yes` When 'Yes' option is selected
         * `No` When 'No' option is selected
         * `Learn more` When 'More Info' option is selected
         * `Do not show again` When 'Do not show again' option is selected
         */
        selection: 'Yes' | 'No' | 'Learn more' | 'Do not show again' | undefined;
    };
    /**
     * Telemetry event sent with details when user clicks a button in the virtual environment prompt.
     * `Prompt message` :- 'We noticed a new virtual environment has been created. Do you want to select it for the workspace folder?'
     */
    [EventName.PYTHON_INTERPRETER_ACTIVATE_ENVIRONMENT_PROMPT]: {
        /**
         * `Yes` When 'Yes' option is selected
         * `No` When 'No' option is selected
         * `Ignore` When 'Do not show again' option is clicked
         *
         * @type {('Yes' | 'No' | 'Ignore' | undefined)}
         */
        selection: 'Yes' | 'No' | 'Ignore' | undefined;
    };
    /**
     * Telemetry event sent with details when the user clicks a button in the "Python is not installed" prompt.
     * * `Prompt message` :- 'Python is not installed. Please download and install Python before using the extension.'
     */
    [EventName.PYTHON_NOT_INSTALLED_PROMPT]: {
        /**
         * `Download` When the 'Download' option is clicked
         * `Ignore` When the prompt is dismissed
         *
         * @type {('Download' | 'Ignore' | undefined)}
         */
        selection: 'Download' | 'Ignore' | undefined;
    };

    /**
     * Telemetry event sent with details when user clicks a button in the following prompt
     * `Prompt message` :- 'We noticed you are using Visual Studio Code Insiders. Would you like to use the Insiders build of the Python extension?'
     */
    [EventName.INSIDERS_PROMPT]: {
        /**
         * `Yes, weekly` When user selects to use "weekly" as extension channel in insiders prompt
         * `Yes, daily` When user selects to use "daily" as extension channel in insiders prompt
         * `No, thanks` When user decides to keep using the same extension channel as before
         */
        selection: 'Yes, weekly' | 'Yes, daily' | 'No, thanks' | undefined;
    };
    /**
     * Telemetry event sent with details when user clicks a button in the 'Reload to install insiders prompt'.
     * `Prompt message` :- 'Please reload Visual Studio Code to use the insiders build of the extension'
     */
    [EventName.INSIDERS_RELOAD_PROMPT]: {
        /**
         * `Reload` When 'Reload' option is clicked
         * `undefined` When prompt is closed
         *
         * @type {('Reload' | undefined)}
         */
        selection: 'Reload' | undefined;
    };
    /**
     * Telemetry sent with details about the current selection of language server
     */
    [EventName.PYTHON_LANGUAGE_SERVER_CURRENT_SELECTION]: {
        /**
         * The startup value of the language server setting
         */
        lsStartup?: LanguageServerType;
        /**
         * Used to track switch between language servers. Carries the final state after the switch.
         */
        switchTo?: LanguageServerType;
    };
    /**
     * Telemetry event sent with details after attempting to download LS
     */
    [EventName.PYTHON_LANGUAGE_SERVER_DOWNLOADED]: {
        /**
         * Whether LS downloading succeeds
         */
        success: boolean;
        /**
         * Version of LS downloaded
         */
        lsVersion?: string;
        /**
         * Whether download uri starts with `https:` or not
         */
        usedSSL?: boolean;

        /**
         * Name of LS downloaded
         */
        lsName?: string;
    };
    /**
     * Telemetry event sent when LS is started for workspace (workspace folder in case of multi-root)
     */
    [EventName.PYTHON_LANGUAGE_SERVER_ENABLED]: {
        lsVersion?: string;
    };
    /**
     * Telemetry event sent with details when downloading or extracting LS fails
     */
    [EventName.PYTHON_LANGUAGE_SERVER_ERROR]: {
        /**
         * The error associated with initializing language server
         */
        error: string;
    };
    /**
     * Telemetry event sent with details after attempting to extract LS
     */
    [EventName.PYTHON_LANGUAGE_SERVER_EXTRACTED]: {
        /**
         * Whether LS extracting succeeds
         */
        success: boolean;
        /**
         * Version of LS extracted
         */
        lsVersion?: string;
        /**
         * Whether download uri starts with `https:` or not
         */
        usedSSL?: boolean;
        /**
         * Package name of LS extracted
         */
        lsName?: string;
    };
    /**
     * Telemetry event sent if azure blob packages are being listed
     */
    [EventName.PYTHON_LANGUAGE_SERVER_LIST_BLOB_STORE_PACKAGES]: never | undefined;
    /**
     * Tracks if LS is supported on platform or not
     */
    [EventName.PYTHON_LANGUAGE_SERVER_PLATFORM_SUPPORTED]: {
        /**
         * Carries `true` if LS is supported, `false` otherwise
         *
         * @type {boolean}
         */
        supported: boolean;
        /**
         * If checking support for LS failed
         *
         * @type {'UnknownError'}
         */
        failureType?: 'UnknownError';
    };
    /**
     * Telemetry event sent when LS is ready to start
     */
    [EventName.PYTHON_LANGUAGE_SERVER_READY]: {
        lsVersion?: string;
    };
    /**
     * Telemetry event sent when starting LS
     */
    [EventName.PYTHON_LANGUAGE_SERVER_STARTUP]: {
        lsVersion?: string;
    };
    /**
     * Telemetry sent from language server (details of telemetry sent can be provided by LS team)
     */
    [EventName.PYTHON_LANGUAGE_SERVER_TELEMETRY]: unknown;
    /**
     * Telemetry sent when the client makes a request to the language server
     *
     * This event also has a measure, "resultLength", which records the number of completions provided.
     */
    [EventName.PYTHON_LANGUAGE_SERVER_REQUEST]: unknown;
    /**
     * Telemetry event sent with details when inExperiment() API is called
     */
    [EventName.PYTHON_EXPERIMENTS]: {
        /**
         * Name of the experiment group the user is in
         * @type {string}
         */
        expName?: string;
    };
    /**
     * Telemetry event sent when Experiments have been disabled.
     */
    [EventName.PYTHON_EXPERIMENTS_DISABLED]: never | undefined;
    /**
     * Telemetry event sent with details when doing best effort to download the experiments within timeout and using it in the current session only
     */
    [EventName.PYTHON_EXPERIMENTS_DOWNLOAD_SUCCESS_RATE]: {
        /**
         * Carries `true` if downloading experiments successfully finishes within timeout, `false` otherwise
         * @type {boolean}
         */
        success?: boolean;
        /**
         * Carries an error string if downloading experiments fails with error
         * @type {string}
         */
        error?: string;
    };
    /**
     * Telemetry event sent when LS is started for workspace (workspace folder in case of multi-root)
     */
    [EventName.LANGUAGE_SERVER_ENABLED]: {
        lsVersion?: string;
    };
    /**
     * Telemetry event sent when Node.js server is ready to start
     */
    [EventName.LANGUAGE_SERVER_READY]: {
        lsVersion?: string;
    };
    /**
     * Telemetry event sent when starting Node.js server
     */
    [EventName.LANGUAGE_SERVER_STARTUP]: {
        lsVersion?: string;
    };
    /**
     * Telemetry sent from Node.js server (details of telemetry sent can be provided by LS team)
     */
    [EventName.LANGUAGE_SERVER_TELEMETRY]: unknown;
    /**
     * Telemetry sent when the client makes a request to the Node.js server
     *
     * This event also has a measure, "resultLength", which records the number of completions provided.
     */
    [EventName.LANGUAGE_SERVER_REQUEST]: unknown;
    /**
     * Telemetry sent on user response to 'Try Pylance' prompt.
     */
    [EventName.LANGUAGE_SERVER_TRY_PYLANCE]: {
        /**
         * User response to the prompt.
         * @type {string}
         */
        userAction: string;
    };
    /**
     * Telemetry event sent when we fallback from JediLSP to Jedi in cases where JediLSP is
     * not supported.
     */
    [EventName.JEDI_FALLBACK]: unknown;
    /**
     * Telemetry event sent when Jedi Language Server is started for workspace (workspace folder in case of multi-root)
     */
    [EventName.JEDI_LANGUAGE_SERVER_ENABLED]: {
        lsVersion?: string;
    };
    /**
     * Telemetry event sent when Jedi Language Server server is ready to receive messages
     */
    [EventName.JEDI_LANGUAGE_SERVER_READY]: {
        lsVersion?: string;
    };
    /**
     * Telemetry event sent when starting Node.js server
     */
    [EventName.JEDI_LANGUAGE_SERVER_STARTUP]: {
        lsVersion?: string;
    };
    /**
     * Telemetry sent from Node.js server (details of telemetry sent can be provided by LS team)
     */
    [EventName.JEDI_LANGUAGE_SERVER_TELEMETRY]: unknown;
    /**
     * Telemetry sent when the client makes a request to the Node.js server
     *
     * This event also has a measure, "resultLength", which records the number of completions provided.
     */
    [EventName.JEDI_LANGUAGE_SERVER_REQUEST]: unknown;
    /**
     * Telemetry captured for enabling reload.
     */
    [EventName.PYTHON_WEB_APP_RELOAD]: {
        /**
         * Carries value indicating if the experiment modified `subProcess` field in debug config:
         * - `true` if reload experiment modified the `subProcess` field.
         * - `false` if user provided debug configuration was not changed (already setup for reload)
         */
        subProcessModified?: boolean;
        /**
         * Carries value indicating if the experiment modified `args` field in debug config:
         * - `true` if reload experiment modified the `args` field.
         * - `false` if user provided debug configuration was not changed (already setup for reload)
         */
        argsModified?: boolean;
    };
    /**
     * When user clicks a button in the python extension survey prompt, this telemetry event is sent with details
     */
    [EventName.EXTENSION_SURVEY_PROMPT]: {
        /**
         * Carries the selection of user when they are asked to take the extension survey
         */
        selection: 'Yes' | 'Maybe later' | 'Do not show again' | undefined;
    };
    /**
     * Telemetry event sent when the Python interpreter tip is shown on activation for new users.
     */
    [EventName.ACTIVATION_TIP_PROMPT]: never | undefined;
    /**
     * Telemetry event sent when the feedback survey prompt is shown on activation for new users, and they click on the survey link.
     */
    [EventName.ACTIVATION_SURVEY_PROMPT]: never | undefined;
    /**
     * Telemetry sent back when join mailing list prompt is shown.
     */
    [EventName.JOIN_MAILING_LIST_PROMPT_DISPLAYED]: never | undefined;
    /**
     * Telemetry sent back when user selects an option from join mailing list prompt.
     */
    [EventName.JOIN_MAILING_LIST_PROMPT]: {
        /**
         * Carries the selection of user when they are asked to join the mailing list.
         */
        selection: 'Yes' | 'No' | undefined;
    };
    /**
     * Telemetry event sent when 'Extract Method' command is invoked
     */
    [EventName.REFACTOR_EXTRACT_FUNCTION]: never | undefined;
    /**
     * Telemetry event sent when 'Extract Variable' command is invoked
     */
    [EventName.REFACTOR_EXTRACT_VAR]: never | undefined;
    /**
     * Telemetry event sent when providing an edit that describes changes to rename a symbol to a different name
     */
    [EventName.REFACTOR_RENAME]: never | undefined;
    /**
     * Telemetry event sent when providing a set of project-wide references for the given position and document
     */
    [EventName.REFERENCE]: never | undefined;
    /**
     * Telemetry event sent when starting REPL
     */
    [EventName.REPL]: never | undefined;
    /**
     * Telemetry event sent with details of linter selected in quickpick of linter list.
     */
    [EventName.SELECT_LINTER]: {
        /**
         * The name of the linter
         */
        tool?: LinterId;
        /**
         * Carries `true` if linter is enabled, `false` otherwise
         */
        enabled: boolean;
    };
    /**
     * Telemetry event sent with details when clicking the prompt with the following message,
     * `Prompt message` :- 'You have a pylintrc file in your workspace. Do you want to enable pylint?'
     */
    [EventName.CONFIGURE_AVAILABLE_LINTER_PROMPT]: {
        /**
         * Name of the linter tool
         *
         * @type {LinterId}
         */
        tool: LinterId;
        /**
         * `enable` When 'Enable [linter name]' option is clicked
         * `ignore` When 'Not now' option is clicked
         * `disablePrompt` When 'Do not show again` option is clicked
         *
         * @type {('enable' | 'ignore' | 'disablePrompt' | undefined)}
         */
        action: 'enable' | 'ignore' | 'disablePrompt' | undefined;
    };
    /**
     * Telemetry event sent when providing help for the signature at the given position and document.
     */
    [EventName.SIGNATURE]: never | undefined;
    /**
     * Telemetry event sent when providing document symbol information for Jedi autocomplete intellisense
     */
    [EventName.SYMBOL]: never | undefined;
    /**
     * Telemetry event sent if and when user configure tests command. This command can be trigerred from multiple places in the extension. (Command palette, prompt etc.)
     */
    [EventName.UNITTEST_CONFIGURE]: never | undefined;
    /**
     * Telemetry event sent when user chooses a test framework in the Quickpick displayed for enabling and configuring test framework
     */
    [EventName.UNITTEST_CONFIGURING]: {
        /**
         * Name of the test framework to configure
         */
        tool?: TestTool;
        /**
         * Carries the source which triggered configuration of tests
         *
         * @type {('ui' | 'commandpalette')}
         */
        trigger: 'ui' | 'commandpalette';
        /**
         * Carries `true` if configuring test framework failed, `false` otherwise
         *
         * @type {boolean}
         */
        failed: boolean;
    };
    /**
     * Telemetry event sent when the extension is activated, if an active terminal is present and
     * the `python.terminal.activateEnvInCurrentTerminal` setting is set to `true`.
     */
    [EventName.ACTIVATE_ENV_IN_CURRENT_TERMINAL]: {
        /**
         * Carries boolean `true` if an active terminal is present (terminal is visible), `false` otherwise
         */
        isTerminalVisible?: boolean;
    };
    /**
     * Telemetry event sent with details when a terminal is created
     */
    [EventName.TERMINAL_CREATE]: {
        /**
         * The type of terminal shell created: powershell, cmd, zsh, bash etc.
         *
         * @type {TerminalShellType}
         */
        terminal?: TerminalShellType;
        /**
         * The source which triggered creation of terminal
         *
         * @type {'commandpalette'}
         */
        triggeredBy?: 'commandpalette';
        /**
         * The default Python interpreter version to be used in terminal, inferred from resource's 'settings.json'
         *
         * @type {string}
         */
        pythonVersion?: string;
        /**
         * The Python interpreter type: Conda, Virtualenv, Venv, Pipenv etc.
         *
         * @type {EnvironmentType}
         */
        interpreterType?: EnvironmentType;
    };
    /**
     * Telemetry event sent with details about discovering tests
     */
    [EventName.UNITTEST_DISCOVER]: {
        /**
         * The test framework used to discover tests
         *
         * @type {TestTool}
         */
        tool: TestTool;
        /**
         * Carries the source which triggered discovering of tests
         *
         * @type {('ui' | 'commandpalette')}
         */
        trigger: 'ui' | 'commandpalette';
        /**
         * Carries `true` if discovering tests failed, `false` otherwise
         *
         * @type {boolean}
         */
        failed: boolean;
    };
    /**
     * Telemetry event is sent if we are doing test discovery using python code
     */
    [EventName.UNITTEST_DISCOVER_WITH_PYCODE]: never | undefined;
    /**
     * Telemetry event sent when user clicks a file, function, or suite in test explorer.
     */
    [EventName.UNITTEST_NAVIGATE]: {
        /**
         * Carries `true` if user clicks a file, `false` otherwise
         *
         * @type {boolean}
         */
        byFile?: boolean;
        /**
         * Carries `true` if user clicks a function, `false` otherwise
         *
         * @type {boolean}
         */
        byFunction?: boolean;
        /**
         * Carries `true` if user clicks a suite, `false` otherwise
         *
         * @type {boolean}
         */
        bySuite?: boolean;
        /**
         * Carries `true` if we are changing focus to the suite/file/function, `false` otherwise
         *
         * @type {boolean}
         */
        focusCode?: boolean;
    };
    /**
     * Tracks number of workspace folders shown in test explorer
     */
    [EventName.UNITTEST_EXPLORER_WORK_SPACE_COUNT]: { count: number };
    /**
     * Telemetry event sent with details about running the tests, what is being run, what framework is being used etc.
     */
    [EventName.UNITTEST_RUN]: {
        /**
         * Framework being used to run tests
         */
        tool: TestTool;
        /**
         * Carries info what is being run
         */
        scope: 'currentFile' | 'all' | 'file' | 'class' | 'function' | 'failed';
        /**
         * Carries `true` if debugging, `false` otherwise
         */
        debugging: boolean;
        /**
         * Carries what triggered the execution of the tests
         */
        triggerSource: 'ui' | 'codelens' | 'commandpalette' | 'auto' | 'testExplorer';
        /**
         * Carries `true` if running tests failed, `false` otherwise
         */
        failed: boolean;
    };
    /**
     * Telemetry event sent when cancelling running or discovering tests
     */
    [EventName.UNITTEST_STOP]: never | undefined;
    /**
     * Telemetry event sent when disabling all test frameworks
     */
    [EventName.UNITTEST_DISABLE]: never | undefined;
    /**
     * Telemetry event sent when viewing Python test log output
     */
    [EventName.UNITTEST_VIEW_OUTPUT]: never | undefined;
    /**
     * Tracks which testing framework has been enabled by the user.
     * Telemetry is sent when settings have been modified by the user.
     * Values sent include:
     * unittest -   If this value is `true`, then unittest has been enabled by the user.
     * pytest   -   If this value is `true`, then pytest has been enabled by the user.
     * nosetest -   If this value is `true`, then nose has been enabled by the user.
     * @type {(never | undefined)}
     * @memberof IEventNamePropertyMapping
     */
    [EventName.UNITTEST_ENABLED]: Partial<Record<TestProvider, undefined | boolean>>;
    /**
     * Telemetry sent when building workspace symbols
     */
    [EventName.WORKSPACE_SYMBOLS_BUILD]: never | undefined;
    /**
     * Telemetry sent when providing workspace symbols doing Project-wide search for a symbol matching the given query string
     */
    [EventName.WORKSPACE_SYMBOLS_GO_TO]: never | undefined;
    /*
    Telemetry event sent with details of Jedi Memory usage.
    memUse - Memory usage of Process in kb.
    limit - Upper bound for memory usage of Jedi process.
    isUserDefinedLimit - Whether the user has configfured the upper bound limit.
    restart - Whether to restart the Jedi Process (i.e. memory > limit).
    */
    [EventName.JEDI_MEMORY]: { memUse: number; limit: number; isUserDefinedLimit: boolean; restart: boolean };
    /*
    Telemetry event sent to provide information on whether we have successfully identify the type of shell used.
    This information is useful in determining how well we identify shells on users machines.
    This impacts executing code in terminals and activation of environments in terminal.
    So, the better this works, the better it is for the user.
    failed - If true, indicates we have failed to identify the shell. Note this impacts impacts ability to activate environments in the terminal & code.
    shellIdentificationSource - How was the shell identified. One of 'terminalName' | 'settings' | 'environment' | 'default'
                                If terminalName, then this means we identified the type of the shell based on the name of the terminal.
                                If settings, then this means we identified the type of the shell based on user settings in VS Code.
                                If environment, then this means we identified the type of the shell based on their environment (env variables, etc).
                                    I.e. their default OS Shell.
                                If default, then we reverted to OS defaults (cmd on windows, and bash on the rest).
                                    This is the worst case scenario.
                                    I.e. we could not identify the shell at all.
    terminalProvided - If true, we used the terminal provided to detec the shell. If not provided, we use the default shell on user machine.
    hasCustomShell - If undefined (not set), we didn't check.
                     If true, user has customzied their shell in VSC Settings.
    hasShellInEnv - If undefined (not set), we didn't check.
                    If true, user has a shell in their environment.
                    If false, user does not have a shell in their environment.
    */
    [EventName.TERMINAL_SHELL_IDENTIFICATION]: {
        failed: boolean;
        terminalProvided: boolean;
        shellIdentificationSource: 'terminalName' | 'settings' | 'environment' | 'default' | 'vscode';
        hasCustomShell: undefined | boolean;
        hasShellInEnv: undefined | boolean;
    };
    /**
     * Telemetry event sent when getting environment variables for an activated environment has failed.
     *
     * @type {(undefined | never)}
     * @memberof IEventNamePropertyMapping
     */
    [EventName.ACTIVATE_ENV_TO_GET_ENV_VARS_FAILED]: {
        /**
         * Whether the activation commands contain the name `conda`.
         *
         * @type {boolean}
         */
        isPossiblyCondaEnv: boolean;
        /**
         * The type of terminal shell created: powershell, cmd, zsh, bash etc.
         *
         * @type {TerminalShellType}
         */
        terminal: TerminalShellType;
    };

    [Telemetry.WebviewStyleUpdate]: never | undefined;
    [Telemetry.WebviewMonacoStyleUpdate]: never | undefined;
    [Telemetry.WebviewStartup]: { type: string };
    [Telemetry.EnableInteractiveShiftEnter]: never | undefined;
    [Telemetry.DisableInteractiveShiftEnter]: never | undefined;
    [Telemetry.ShiftEnterBannerShown]: never | undefined;

    // Start Page Events
    [Telemetry.StartPageViewed]: never | undefined;
    [Telemetry.StartPageOpenedFromCommandPalette]: never | undefined;
    [Telemetry.StartPageOpenedFromNewInstall]: never | undefined;
    [Telemetry.StartPageOpenedFromNewUpdate]: never | undefined;
    [Telemetry.StartPageWebViewError]: never | undefined;
    [Telemetry.StartPageTime]: never | undefined;
    [Telemetry.StartPageClickedDontShowAgain]: never | undefined;
    [Telemetry.StartPageClosedWithoutAction]: never | undefined;
    [Telemetry.StartPageUsedAnActionOnFirstTime]: never | undefined;
    [Telemetry.StartPageOpenBlankNotebook]: never | undefined;
    [Telemetry.StartPageOpenBlankPythonFile]: never | undefined;
    [Telemetry.StartPageOpenInteractiveWindow]: never | undefined;
    [Telemetry.StartPageOpenCommandPalette]: never | undefined;
    [Telemetry.StartPageOpenCommandPaletteWithOpenNBSelected]: never | undefined;
    [Telemetry.StartPageOpenSampleNotebook]: never | undefined;
    [Telemetry.StartPageOpenFileBrowser]: never | undefined;
    [Telemetry.StartPageOpenFolder]: never | undefined;
    [Telemetry.StartPageOpenWorkspace]: never | undefined;

    // TensorBoard integration events
    /**
     * Telemetry event sent after the user has clicked on an option in the prompt we display
     * asking them if they want to launch an integrated TensorBoard session.
     * `selection` is one of 'yes', 'no', or 'do not ask again'.
     */
    [EventName.TENSORBOARD_LAUNCH_PROMPT_SELECTION]: {
        selection: TensorBoardPromptSelection;
    };
    /**
     * Telemetry event sent after the python.launchTensorBoard command has been executed.
     * The `entrypoint` property indicates whether the command was executed directly by the
     * user from the command palette or from a codelens or the user clicking 'yes'
     * on the launch prompt we display.
     * The `trigger` property indicates whether the entrypoint was triggered by the user
     * importing tensorboard, using tensorboard in a notebook, detected tfevent files in
     * the workspace. For the palette entrypoint, the trigger is also 'palette'.
     */
    [EventName.TENSORBOARD_SESSION_LAUNCH]: {
        entrypoint: TensorBoardEntrypoint;
        trigger: TensorBoardEntrypointTrigger;
    };
    /**
     * Telemetry event sent after we have attempted to create a tensorboard program instance
     * by spawning a daemon to run the tensorboard_launcher.py script. The event is sent with
     * `durationMs` which should never exceed 60_000ms. Depending on the value of `result`, `durationMs` means:
     * 1. 'success' --> the total amount of time taken for the execObservable daemon to report successful TB session launch
     * 2. 'canceled' --> the total amount of time that the user waited for the daemon to start before canceling launch
     * 3. 'error' --> 60_000ms, i.e. we timed out waiting for the daemon to launch
     * In the first two cases durationMs should not be more than 60_000ms.
     */
    [EventName.TENSORBOARD_SESSION_DAEMON_STARTUP_DURATION]: {
        result: TensorBoardSessionStartResult;
    };
    /**
     * Telemetry event sent after the webview framing the TensorBoard website has been successfully shown.
     * This event is sent with `durationMs` which represents the total time to create a TensorBoardSession.
     * Note that this event is only sent if an integrated TensorBoard session is successfully created in full.
     * This includes checking whether the tensorboard package is installed and installing it if it's not already
     * installed, requesting the user to select a log directory, starting the tensorboard
     * program instance in a daemon, and showing the TensorBoard UI in a webpanel, in that order.
     */
    [EventName.TENSORBOARD_SESSION_E2E_STARTUP_DURATION]: never | undefined;
    /**
     * Telemetry event sent after the user has closed a TensorBoard webview panel. This event is
     * sent with `durationMs` specifying the total duration of time that the TensorBoard session
     * ran for before the user terminated the session.
     */
    [EventName.TENSORBOARD_SESSION_DURATION]: never | undefined;
    /**
     * Telemetry event sent when an entrypoint is displayed to the user. This event is sent once
     * per entrypoint per session to minimize redundant events since codelenses
     * can be displayed multiple times per file.
     * The `entrypoint` property indicates whether the command was executed directly by the
     * user from the command palette or from a codelens or the user clicking 'yes'
     * on the launch prompt we display.
     * The `trigger` property indicates whether the entrypoint was triggered by the user
     * importing tensorboard, using tensorboard in a notebook, detected tfevent files in
     * the workspace. For the palette entrypoint, the trigger is also 'palette'.
     */
    [EventName.TENSORBOARD_ENTRYPOINT_SHOWN]: {
        entrypoint: TensorBoardEntrypoint;
        trigger: TensorBoardEntrypointTrigger;
    };
    /**
     * Telemetry event sent when the user is prompted to install Python packages that are
     * dependencies for launching an integrated TensorBoard session.
     */
    [EventName.TENSORBOARD_INSTALL_PROMPT_SHOWN]: never | undefined;
    /**
     * Telemetry event sent after the user has clicked on an option in the prompt we display
     * asking them if they want to install Python packages for launching an integrated TensorBoard session.
     * `selection` is one of 'yes' or 'no'.
     */
    [EventName.TENSORBOARD_INSTALL_PROMPT_SELECTION]: {
        selection: TensorBoardPromptSelection;
        operationType: 'install' | 'upgrade';
    };
    /**
     * Telemetry event sent when we find an active integrated terminal running tensorboard.
     */
    [EventName.TENSORBOARD_DETECTED_IN_INTEGRATED_TERMINAL]: never | undefined;
    /**
     * Telemetry event sent after attempting to install TensorBoard session dependencies.
     * Note, this is only sent if install was attempted. It is not sent if the user opted
     * not to install, or if all dependencies were already installed.
     */
    [EventName.TENSORBOARD_PACKAGE_INSTALL_RESULT]: {
        wasProfilerPluginAttempted: boolean;
        wasTensorBoardAttempted: boolean;
        wasProfilerPluginInstalled: boolean;
        wasTensorBoardInstalled: boolean;
    };
    /**
     * Telemetry event sent when the user's files contain a PyTorch profiler module
     * import. Files are checked for matching imports when they are opened or saved.
     * Matches cover import statements of the form `import torch.profiler` and
     * `from torch import profiler`.
     */
    [EventName.TENSORBOARD_TORCH_PROFILER_IMPORT]: never | undefined;
}
