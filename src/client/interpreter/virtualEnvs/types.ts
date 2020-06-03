// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Uri } from 'vscode';
import { InterpreterType } from '../../pythonEnvironments/discovery/types';
export const IVirtualEnvironmentManager = Symbol('VirtualEnvironmentManager');
export interface IVirtualEnvironmentManager {
    getEnvironmentName(pythonPath: string, resource?: Uri): Promise<string>;
    getEnvironmentType(pythonPath: string, resource?: Uri): Promise<InterpreterType>;
    getPyEnvRoot(resource?: Uri): Promise<string | undefined>;
}
