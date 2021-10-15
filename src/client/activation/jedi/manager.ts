// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as fs from 'fs-extra';
import * as path from 'path';
import '../../common/extensions';

import { inject, injectable, named } from 'inversify';

import { ICommandManager } from '../../common/application/types';
import { traceDecorators, traceVerbose } from '../../common/logger';
import { IDisposable, Resource } from '../../common/types';
import { debounceSync } from '../../common/utils/decorators';
import { EXTENSION_ROOT_DIR } from '../../constants';
import { IServiceContainer } from '../../ioc/types';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { Commands } from '../commands';
import { LanguageClientMiddleware } from '../languageClientMiddleware';
import {
    ILanguageServerAnalysisOptions,
    ILanguageServerManager,
    ILanguageServerProxy,
    LanguageServerType,
} from '../types';

@injectable()
export class JediLanguageServerManager implements ILanguageServerManager {
    private languageServerProxy?: ILanguageServerProxy;

    private resource!: Resource;

    private interpreter: PythonEnvironment | undefined;

    private middleware: LanguageClientMiddleware | undefined;

    private disposables: IDisposable[] = [];

    private static commandDispose: IDisposable;

    private connected = false;

    private lsVersion: string | undefined;

    constructor(
        @inject(IServiceContainer) private readonly serviceContainer: IServiceContainer,
        @inject(ILanguageServerAnalysisOptions)
        @named(LanguageServerType.Jedi)
        private readonly analysisOptions: ILanguageServerAnalysisOptions,
        @inject(ICommandManager) commandManager: ICommandManager,
    ) {
        if (JediLanguageServerManager.commandDispose) {
            JediLanguageServerManager.commandDispose.dispose();
        }
        JediLanguageServerManager.commandDispose = commandManager.registerCommand(Commands.RestartLS, () => {
            this.restartLanguageServer().ignoreErrors();
        });
    }

    private static versionTelemetryProps(instance: JediLanguageServerManager) {
        return {
            lsVersion: instance.lsVersion,
        };
    }

    public dispose(): void {
        if (this.languageProxy) {
            this.languageProxy.dispose();
        }
        JediLanguageServerManager.commandDispose.dispose();
        this.disposables.forEach((d) => d.dispose());
    }

    public get languageProxy(): ILanguageServerProxy | undefined {
        return this.languageServerProxy;
    }

    @traceDecorators.error('Failed to start language server')
    public async start(resource: Resource, interpreter: PythonEnvironment | undefined): Promise<void> {
        if (this.languageProxy) {
            throw new Error('Language server already started');
        }
        this.resource = resource;
        this.interpreter = interpreter;
        this.analysisOptions.onDidChange(this.restartLanguageServerDebounced, this, this.disposables);

        try {
            // Version is actually hardcoded in our requirements.txt.
            const requirementsTxt = await fs.readFile(
                path.join(EXTENSION_ROOT_DIR, 'jedils_requirements.txt'),
                'utf-8',
            );

            // Search using a regex in the text
            const match = /jedi-language-server==([0-9\.]*)/.exec(requirementsTxt);
            if (match && match.length === 2) {
                [, this.lsVersion] = match;
            }
        } catch (ex) {
            // Getting version here is best effort and does not affect how LS works and
            // failing to get version should not stop LS from working.
            traceVerbose('Failed to get jedi-language-server version: ', ex);
        }

        await this.analysisOptions.initialize(resource, interpreter);
        await this.startLanguageServer();
    }

    public connect(): void {
        this.connected = true;
        this.middleware?.connect();
    }

    public disconnect(): void {
        this.connected = false;
        this.middleware?.disconnect();
    }

    @debounceSync(1000)
    protected restartLanguageServerDebounced(): void {
        this.restartLanguageServer().ignoreErrors();
    }

    @traceDecorators.error('Failed to restart language server')
    @traceDecorators.verbose('Restarting language server')
    protected async restartLanguageServer(): Promise<void> {
        if (this.languageProxy) {
            this.languageProxy.dispose();
        }
        await this.startLanguageServer();
    }

    @captureTelemetry(
        EventName.JEDI_LANGUAGE_SERVER_STARTUP,
        undefined,
        true,
        undefined,
        JediLanguageServerManager.versionTelemetryProps,
    )
    @traceDecorators.verbose('Starting language server')
    protected async startLanguageServer(): Promise<void> {
        this.languageServerProxy = this.serviceContainer.get<ILanguageServerProxy>(ILanguageServerProxy);

        const options = await this.analysisOptions.getAnalysisOptions();
        this.middleware = new LanguageClientMiddleware(this.serviceContainer, LanguageServerType.Jedi, this.lsVersion);
        options.middleware = this.middleware;

        // Make sure the middleware is connected if we restart and we we're already connected.
        if (this.connected) {
            this.middleware.connect();
        }

        // Then use this middleware to start a new language client.
        await this.languageServerProxy.start(this.resource, this.interpreter, options);
    }
}
