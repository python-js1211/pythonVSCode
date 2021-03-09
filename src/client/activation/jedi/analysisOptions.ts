// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { WorkspaceFolder } from 'vscode';
import { IWorkspaceService } from '../../common/application/types';
import { IConfigurationService, Resource } from '../../common/types';

import { IEnvironmentVariablesProvider } from '../../common/variables/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { LanguageServerAnalysisOptionsWithEnv } from '../common/analysisOptions';
import { ILanguageServerOutputChannel } from '../types';

/* eslint-disable @typescript-eslint/explicit-module-boundary-types, class-methods-use-this */

@injectable()
export class JediLanguageServerAnalysisOptions extends LanguageServerAnalysisOptionsWithEnv {
    private resource: Resource | undefined;

    constructor(
        @inject(IEnvironmentVariablesProvider) envVarsProvider: IEnvironmentVariablesProvider,
        @inject(ILanguageServerOutputChannel) lsOutputChannel: ILanguageServerOutputChannel,
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
    ) {
        super(envVarsProvider, lsOutputChannel);
        this.resource = undefined;
    }

    public async initialize(resource: Resource, interpreter: PythonEnvironment | undefined) {
        this.resource = resource;
        return super.initialize(resource, interpreter);
    }

    protected getWorkspaceFolder(): WorkspaceFolder | undefined {
        return this.workspace.getWorkspaceFolder(this.resource);
    }

    protected async getInitializationOptions() {
        const pythonSettings = this.configurationService.getSettings(this.resource);
        const workspacePath = this.getWorkspaceFolder()?.uri.fsPath;
        const extraPaths = pythonSettings.autoComplete
            ? pythonSettings.autoComplete.extraPaths.map((extraPath) => {
                  if (path.isAbsolute(extraPath)) {
                      return extraPath;
                  }
                  return workspacePath ? path.join(workspacePath, extraPath) : '';
              })
            : [];

        if (workspacePath) {
            extraPaths.unshift(workspacePath);
        }

        const distinctExtraPaths = extraPaths
            .filter((value) => value.length > 0)
            .filter((value, index, self) => self.indexOf(value) === index);

        return {
            markupKindPreferred: 'markdown',
            completion: {
                resolveEagerly: false,
                disableSnippets: false,
            },
            diagnostics: {
                enable: true,
                didOpen: true,
                didSave: true,
                didChange: true,
            },
            workspace: {
                extraPaths: distinctExtraPaths,
                symbols: {
                    // 0 means remove limit on number of workspace symbols returned
                    maxSymbols: 0,
                },
            },
        };
    }
}
