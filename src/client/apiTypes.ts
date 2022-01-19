// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Event, Uri } from 'vscode';
import { Resource } from './common/types';
import { IDataViewerDataProvider, IJupyterUriProvider } from './jupyter/types';

/*
 * Do not introduce any breaking changes to this API.
 * This is the public API for other extensions to interact with this extension.
 */

export interface IExtensionApi {
    /**
     * Promise indicating whether all parts of the extension have completed loading or not.
     * @type {Promise<void>}
     * @memberof IExtensionApi
     */
    ready: Promise<void>;
    jupyter: {
        registerHooks(): void;
    };
    debug: {
        /**
         * Generate an array of strings for commands to pass to the Python executable to launch the debugger for remote debugging.
         * Users can append another array of strings of what they want to execute along with relevant arguments to Python.
         * E.g `['/Users/..../pythonVSCode/pythonFiles/lib/python/debugpy', '--listen', 'localhost:57039', '--wait-for-client']`
         * @param {string} host
         * @param {number} port
         * @param {boolean} [waitUntilDebuggerAttaches=true]
         * @returns {Promise<string[]>}
         */
        getRemoteLauncherCommand(host: string, port: number, waitUntilDebuggerAttaches: boolean): Promise<string[]>;

        /**
         * Gets the path to the debugger package used by the extension.
         * @returns {Promise<string>}
         */
        getDebuggerPackagePath(): Promise<string | undefined>;
    };
    /**
     * Return internal settings within the extension which are stored in VSCode storage
     */
    settings: {
        /**
         * An event that is emitted when execution details (for a resource) change. For instance, when interpreter configuration changes.
         */
        readonly onDidChangeExecutionDetails: Event<Uri | undefined>;
        /**
         * Returns all the details the consumer needs to execute code within the selected environment,
         * corresponding to the specified resource taking into account any workspace-specific settings
         * for the workspace to which this resource belongs.
         * @param {Resource} [resource] A resource for which the setting is asked for.
         * * When no resource is provided, the setting scoped to the first workspace folder is returned.
         * * If no folder is present, it returns the global setting.
         * @returns {({ execCommand: string[] | undefined })}
         */
        getExecutionDetails(
            resource?: Resource,
        ): {
            /**
             * E.g of execution commands returned could be,
             * * `['<path to the interpreter set in settings>']`
             * * `['<path to the interpreter selected by the extension when setting is not set>']`
             * * `['conda', 'run', 'python']` which is used to run from within Conda environments.
             * or something similar for some other Python environments.
             *
             * @type {(string[] | undefined)} When return value is `undefined`, it means no interpreter is set.
             * Otherwise, join the items returned using space to construct the full execution command.
             */
            execCommand: string[] | undefined;
        };
    };

    datascience: {
        /**
         * Launches Data Viewer component.
         * @param {IDataViewerDataProvider} dataProvider Instance that will be used by the Data Viewer component to fetch data.
         * @param {string} title Data Viewer title
         */
        showDataViewer(dataProvider: IDataViewerDataProvider, title: string): Promise<void>;
        /**
         * Registers a remote server provider component that's used to pick remote jupyter server URIs
         * @param serverProvider object called back when picking jupyter server URI
         */
        registerRemoteServerProvider(serverProvider: IJupyterUriProvider): void;
    };
}

export interface InterpreterDetailsOptions {
    useCache: boolean;
}

export interface InterpreterDetails {
    path: string;
    version: string[];
    environmentType: string[];
    metadata: Record<string, unknown>;
}

export interface InterpretersChangedParams {
    path?: string;
    type: 'add' | 'remove' | 'update' | 'clear-all';
}

export interface ActiveInterpreterChangedParams {
    interpreterPath?: string;
    resource?: Uri;
}

export interface RefreshInterpretersOptions {
    clearCache?: boolean;
}

export interface IProposedExtensionAPI {
    environment: {
        /**
         * Returns the path to the python binary selected by the user or as in the settings.
         * This is just the path to the python binary, this does not provide activation or any
         * other activation command. The `resource` if provided will be used to determine the
         * python binary in a multi-root scenario. If resource is `undefined` then the API
         * returns what ever is set for the workspace.
         * @param resource : Uri of a file or workspace
         */
        getActiveInterpreterPath(resource?: Resource): Promise<string | undefined>;
        /**
         * Returns details for the given interpreter. Details such as absolute interpreter path,
         * version, type (conda, pyenv, etc). Metadata such as `sysPrefix` can be found under
         * metadata field.
         * @param interpreterPath : Path of the interpreter whose details you need.
         * @param options : [optional]
         *     * useCache : When true, cache is checked first for any data, returns even if there
         *                  is partial data.
         */
        getInterpreterDetails(
            interpreterPath: string,
            options?: InterpreterDetailsOptions,
        ): Promise<InterpreterDetails | undefined>;
        /**
         * Returns paths to interpreters found by the extension at the time of calling. This API
         * will *not* trigger a refresh. If a refresh is going on it will *not* wait for the refresh
         * to finish. This will return what is known so far. To get complete list `await` on promise
         * returned by `getRefreshPromise()`.
         */
        getInterpreterPaths(): Promise<string[] | undefined>;
        /**
         * Sets the active interpreter path for the python extension. Configuration target will
         * always be the workspace.
         * @param interpreterPath : Interpreter path to set for a given workspace.
         * @param resource : [optional] Uri of a file ro workspace to scope to a particular workspace
         *                   folder.
         */
        setActiveInterpreter(interpreterPath: string, resource?: Resource): Promise<void>;
        /**
         * This API will re-trigger environment discovery. Extensions can wait on the returned
         * promise to get the updated interpreters list. If there is a refresh already going on
         * then it returns the promise for that refresh.
         * @param options : [optional]
         *     * clearCache : When true, this will clear the cache before interpreter refresh
         *                    is triggered.
         */
        refreshInterpreters(options?: RefreshInterpretersOptions): Promise<string[] | undefined>;
        /**
         * Returns a promise for the ongoing refresh. Returns `undefined` if there are no active
         * refreshes going on.
         */
        getRefreshPromise(): Promise<void> | undefined;
        /**
         * This event is triggered when the known interpreters list changes, like when a interpreter
         * is found, existing interpreter is removed, or some details changed on an interpreter.
         */
        onDidInterpretersChanged: Event<InterpretersChangedParams[]>;
        /**
         * This event is triggered when the active interpreter changes.
         */
        onDidActiveInterpreterChanged: Event<ActiveInterpreterChangedParams>;
    };
}
