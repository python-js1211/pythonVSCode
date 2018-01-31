// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { ICondaService, IInterpreterService, InterpreterType } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { ExecutionInfo, IConfigurationService } from '../types';
import { ModuleInstaller } from './moduleInstaller';
import { IModuleInstaller } from './types';

@injectable()
export class CondaInstaller extends ModuleInstaller implements IModuleInstaller {
    private isCondaAvailable: boolean | undefined;
    public get displayName() {
        return 'Conda';
    }
    constructor( @inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }
    /**
     * Checks whether we can use Conda as module installer for a given resource.
     * We need to perform two checks:
     * 1. Ensure we have conda.
     * 2. Check if the current environment is a conda environment.
     * @param {Uri} [resource=] Resource used to identify the workspace.
     * @returns {Promise<boolean>} Whether conda is supported as a module installer or not.
     */
    public async isSupported(resource?: Uri): Promise<boolean> {
        if (typeof this.isCondaAvailable === 'boolean') {
            return this.isCondaAvailable!;
        }
        const condaLocator = this.serviceContainer.get<ICondaService>(ICondaService);
        const available = await condaLocator.isCondaAvailable();

        if (!available) {
            return false;
        }

        // Now we need to check if the current environment is a conda environment or not.
        return this.isCurrentEnvironmentACondaEnvironment(resource);
    }
    protected async getExecutionInfo(moduleName: string, resource?: Uri): Promise<ExecutionInfo> {
        const condaService = this.serviceContainer.get<ICondaService>(ICondaService);
        const condaFile = await condaService.getCondaFile();

        const pythonPath = this.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings(resource).pythonPath;
        const info = await condaService.getCondaEnvironment(pythonPath);
        const args = ['install'];

        if (info.name) {
            // If we have the name of the conda environment, then use that.
            args.push('--name');
            args.push(info.name!);
        } else if (info.path) {
            // Else provide the full path to the environment path.
            args.push('--prefix');
            args.push(info.path);
        }
        args.push(moduleName);
        return {
            args,
            execPath: condaFile,
            moduleName: ''
        };
    }
    private async isCurrentEnvironmentACondaEnvironment(resource?: Uri): Promise<boolean> {
        const condaService = this.serviceContainer.get<ICondaService>(ICondaService);
        const pythonPath = this.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings(resource).pythonPath;
        return condaService.isCondaEnvironment(pythonPath);
    }
}
