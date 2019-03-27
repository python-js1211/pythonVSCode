// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';

import { IPythonExecutionFactory } from '../../common/process/types';
import { IAsyncDisposable, IAsyncDisposableRegistry } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { IDataExplorer, IDataExplorerProvider, IJupyterVariables } from '../types';

@injectable()
export class DataExplorerProvider implements IDataExplorerProvider, IAsyncDisposable {

    private activeExplorers: IDataExplorer[] = [];
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry : IAsyncDisposableRegistry,
        @inject(IJupyterVariables) private variables: IJupyterVariables,
        @inject(IPythonExecutionFactory) private pythonFactory : IPythonExecutionFactory,
        @inject(IInterpreterService) private interpreterService: IInterpreterService
        ) {
        asyncRegistry.push(this);
    }

    public async dispose() {
        await Promise.all(this.activeExplorers.map(d => d.dispose()));
    }

    public async create(variable: string) : Promise<IDataExplorer>{
        // Make sure this is a valid variable
        const variables = await this.variables.getVariables();
        const index = variables.findIndex(v => v && v.name === variable);
        if (index >= 0) {
            const dataExplorer = this.serviceContainer.get<IDataExplorer>(IDataExplorer);
            this.activeExplorers.push(dataExplorer);
            await dataExplorer.show(variables[index]);
            return dataExplorer;
        }

        throw new Error(localize.DataScience.dataExplorerInvalidVariableFormat().format(variable));
    }

    public async getPandasVersion() : Promise<{major: number; minor: number; build: number} | undefined> {
        const interpreter = await this.interpreterService.getActiveInterpreter();
        const launcher = await this.pythonFactory.createActivatedEnvironment({ resource: undefined, interpreter, allowEnvironmentFetchExceptions: true });
        try {
            const result = await launcher.exec(['-c', 'import pandas;print(pandas.__version__)'], {throwOnStdErr: true});
            const versionMatch = /^\s*(\d+)\.(\d+)\.(\d+)\s*$/.exec(result.stdout);
            if (versionMatch && versionMatch.length > 2) {
                const major = parseInt(versionMatch[1], 10);
                const minor = parseInt(versionMatch[2], 10);
                const build = parseInt(versionMatch[3], 10);
                return {major, minor, build};
            }
        } catch {
            noop();
        }
    }
}
