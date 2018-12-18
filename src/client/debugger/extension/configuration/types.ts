// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { CancellationToken, DebugConfiguration, Uri, WorkspaceFolder } from 'vscode';

export const IConfigurationProviderUtils = Symbol('IConfigurationProviderUtils');

export interface IConfigurationProviderUtils {
    getPyramidStartupScriptFilePath(resource?: Uri): Promise<string | undefined>;
}

export const IDebugConfigurationResolver = Symbol('IDebugConfigurationResolver');
export interface IDebugConfigurationResolver<T extends DebugConfiguration> {
    resolveDebugConfiguration(folder: WorkspaceFolder | undefined, debugConfiguration: T, token?: CancellationToken): Promise<T | undefined>;
}
