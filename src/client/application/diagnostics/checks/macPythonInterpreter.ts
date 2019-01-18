// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { ConfigurationChangeEvent, DiagnosticSeverity, Uri } from 'vscode';
import { IWorkspaceService } from '../../../common/application/types';
import '../../../common/extensions';
import { IPlatformService } from '../../../common/platform/types';
import { IConfigurationService, IDisposableRegistry, Resource } from '../../../common/types';
import { IInterpreterHelper, IInterpreterService, InterpreterType } from '../../../interpreter/contracts';
import { IServiceContainer } from '../../../ioc/types';
import { BaseDiagnostic, BaseDiagnosticsService } from '../base';
import { IDiagnosticsCommandFactory } from '../commands/types';
import { DiagnosticCodes } from '../constants';
import { DiagnosticCommandPromptHandlerServiceId, MessageCommandPrompt } from '../promptHandler';
import { DiagnosticScope, IDiagnostic, IDiagnosticCommand, IDiagnosticHandlerService } from '../types';

const messages = {
    [DiagnosticCodes.MacInterpreterSelectedAndHaveOtherInterpretersDiagnostic]:
        'You have selected the macOS system install of Python, which is not recommended for use with the Python extension. Some functionality will be limited, please select a different interpreter.',
    [DiagnosticCodes.MacInterpreterSelectedAndNoOtherInterpretersDiagnostic]:
        'The macOS system install of Python is not recommended, some functionality in the extension will be limited. Install another version of Python for the best experience.'
};

export class InvalidMacPythonInterpreterDiagnostic extends BaseDiagnostic {
    constructor(code: DiagnosticCodes.MacInterpreterSelectedAndNoOtherInterpretersDiagnostic | DiagnosticCodes.MacInterpreterSelectedAndHaveOtherInterpretersDiagnostic, resource: Resource) {
        super(code, messages[code], DiagnosticSeverity.Error, DiagnosticScope.WorkspaceFolder, resource);
    }
}

export const InvalidMacPythonInterpreterServiceId = 'InvalidMacPythonInterpreterServiceId';

@injectable()
export class InvalidMacPythonInterpreterService extends BaseDiagnosticsService {
    protected changeThrottleTimeout = 1000;
    private timeOut?: NodeJS.Timer;
    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(IPlatformService) private readonly platform: IPlatformService,
        @inject(IInterpreterHelper) private readonly helper: IInterpreterHelper
    ) {
        super(
            [
                DiagnosticCodes.MacInterpreterSelectedAndHaveOtherInterpretersDiagnostic,
                DiagnosticCodes.MacInterpreterSelectedAndNoOtherInterpretersDiagnostic
            ],
            serviceContainer
        );
        this.addPythonPathChangedHandler();
    }
    public async diagnose(resource: Resource): Promise<IDiagnostic[]> {
        if (!this.platform.isMac) {
            return [];
        }
        const configurationService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
        const settings = configurationService.getSettings(resource);
        if (settings.disableInstallationChecks === true) {
            return [];
        }

        const hasInterpreters = await this.interpreterService.hasInterpreters;
        if (!hasInterpreters) {
            return [];
        }

        const currentInterpreter = await this.interpreterService.getActiveInterpreter(resource);
        if (!currentInterpreter) {
            return [];
        }

        if (!this.helper.isMacDefaultPythonPath(settings.pythonPath)) {
            return [];
        }
        if (!currentInterpreter || currentInterpreter.type !== InterpreterType.Unknown) {
            return [];
        }

        const interpreters = await this.interpreterService.getInterpreters(resource);
        if (interpreters.filter(i => !this.helper.isMacDefaultPythonPath(i.path)).length === 0) {
            return [
                new InvalidMacPythonInterpreterDiagnostic(
                    DiagnosticCodes.MacInterpreterSelectedAndNoOtherInterpretersDiagnostic,
                    resource
                )
            ];
        }

        return [
            new InvalidMacPythonInterpreterDiagnostic(
                DiagnosticCodes.MacInterpreterSelectedAndHaveOtherInterpretersDiagnostic,
                resource
            )
        ];
    }
    public async handle(diagnostics: IDiagnostic[]): Promise<void> {
        if (diagnostics.length === 0) {
            return;
        }
        const messageService = this.serviceContainer.get<IDiagnosticHandlerService<MessageCommandPrompt>>(
            IDiagnosticHandlerService,
            DiagnosticCommandPromptHandlerServiceId
        );
        await Promise.all(
            diagnostics.map(async diagnostic => {
                if (!this.canHandle(diagnostic)) {
                    return;
                }
                const commandPrompts = this.getCommandPrompts(diagnostic);
                return messageService.handle(diagnostic, { commandPrompts, message: diagnostic.message });
            })
        );
    }
    protected addPythonPathChangedHandler() {
        const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        const disposables = this.serviceContainer.get<IDisposableRegistry>(IDisposableRegistry);
        disposables.push(workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this)));
    }
    protected async onDidChangeConfiguration(event: ConfigurationChangeEvent) {
        const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        const workspacesUris: (Uri | undefined)[] = workspaceService.hasWorkspaceFolders
            ? workspaceService.workspaceFolders!.map(workspace => workspace.uri)
            : [undefined];
        const workspaceUriIndex = workspacesUris.findIndex(uri => event.affectsConfiguration('python.pythonPath', uri));
        if (workspaceUriIndex === -1) {
            return;
        }
        // Lets wait, for more changes, dirty simple throttling.
        if (this.timeOut) {
            clearTimeout(this.timeOut);
            this.timeOut = undefined;
        }
        this.timeOut = setTimeout(() => {
            this.timeOut = undefined;
            this.diagnose(workspacesUris[workspaceUriIndex])
                .then(diagnostics => this.handle(diagnostics))
                .ignoreErrors();
        }, this.changeThrottleTimeout);
    }
    private getCommandPrompts(diagnostic: IDiagnostic): { prompt: string; command?: IDiagnosticCommand }[] {
        const commandFactory = this.serviceContainer.get<IDiagnosticsCommandFactory>(IDiagnosticsCommandFactory);
        switch (diagnostic.code) {
            case DiagnosticCodes.MacInterpreterSelectedAndHaveOtherInterpretersDiagnostic: {
                return [
                    {
                        prompt: 'Select Python Interpreter',
                        command: commandFactory.createCommand(diagnostic, {
                            type: 'executeVSCCommand',
                            options: 'python.setInterpreter'
                        })
                    }
                ];
            }
            case DiagnosticCodes.MacInterpreterSelectedAndNoOtherInterpretersDiagnostic: {
                return [
                    {
                        prompt: 'Learn more',
                        command: commandFactory.createCommand(diagnostic, {
                            type: 'launch',
                            options: 'https://code.visualstudio.com/docs/python/python-tutorial#_prerequisites'
                        })
                    },
                    {
                        prompt: 'Download',
                        command: commandFactory.createCommand(diagnostic, {
                            type: 'launch',
                            options: 'https://www.python.org/downloads'
                        })
                    }
                ];
            }
            default: {
                throw new Error('Invalid diagnostic for \'InvalidMacPythonInterpreterService\'');
            }
        }
    }
}
