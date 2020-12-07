// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import '../../common/extensions';

import { inject, injectable } from 'inversify';
import { Disposable, LanguageClient, LanguageClientOptions, State } from 'vscode-languageclient/node';

import { traceDecorators, traceError } from '../../common/logger';
import { IConfigurationService, Resource } from '../../common/types';
import { createDeferred, Deferred, sleep } from '../../common/utils/async';
import { swallowExceptions } from '../../common/utils/decorators';
import { noop } from '../../common/utils/misc';
import { LanguageServerSymbolProvider } from '../../providers/symbolProvider';
import { PythonEnvironment } from '../../pythonEnvironments/info';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { ITestManagementService } from '../../testing/types';
import { ProgressReporting } from '../progress';
import { ILanguageClientFactory, ILanguageServerProxy } from '../types';

@injectable()
export class DotNetLanguageServerProxy implements ILanguageServerProxy {
    public languageClient: LanguageClient | undefined;
    private startupCompleted: Deferred<void>;
    private readonly disposables: Disposable[] = [];
    private extensionLoadedArgs = new Set<{}>();
    private disposed: boolean = false;

    constructor(
        @inject(ILanguageClientFactory) private readonly factory: ILanguageClientFactory,
        @inject(ITestManagementService) private readonly testManager: ITestManagementService,
        @inject(IConfigurationService) private readonly configurationService: IConfigurationService
    ) {
        this.startupCompleted = createDeferred<void>();
    }
    @traceDecorators.verbose('Stopping language server')
    public dispose() {
        if (this.languageClient) {
            // Do not await on this.
            this.languageClient.stop().then(noop, (ex) => traceError('Stopping language client failed', ex));
            this.languageClient = undefined;
        }
        while (this.disposables.length > 0) {
            const d = this.disposables.shift()!;
            d.dispose();
        }
        if (this.startupCompleted.completed) {
            this.startupCompleted.reject(new Error('Disposed language server'));
            this.startupCompleted = createDeferred<void>();
        }
        this.disposed = true;
    }

    @traceDecorators.error('Failed to start language server')
    @captureTelemetry(EventName.PYTHON_LANGUAGE_SERVER_ENABLED, undefined, true)
    public async start(
        resource: Resource,
        interpreter: PythonEnvironment | undefined,
        options: LanguageClientOptions
    ): Promise<void> {
        if (!this.languageClient) {
            this.languageClient = await this.factory.createLanguageClient(resource, interpreter, options);

            this.languageClient.onDidChangeState((e) => {
                // The client's on* methods must be called after the client has started, but if called too
                // late the server may have already sent a message (which leads to failures). Register
                // these on the state change to running to ensure they are ready soon enough.
                if (e.newState === State.Running) {
                    this.registerHandlers(resource);
                }
            });

            this.disposables.push(this.languageClient.start());
            await this.serverReady();

            if (this.disposed) {
                // Check if it got disposed in the interim.
                return;
            }

            await this.registerTestServices();
        } else {
            await this.startupCompleted.promise;
        }
    }
    @traceDecorators.error('Failed to load language server extension')
    public loadExtension(args?: {}) {
        if (this.extensionLoadedArgs.has(args || '')) {
            return;
        }
        this.extensionLoadedArgs.add(args || '');
        this.startupCompleted.promise
            .then(() =>
                this.languageClient!.sendRequest('python/loadExtension', args).then(noop, (ex) =>
                    traceError('Request python/loadExtension failed', ex)
                )
            )
            .ignoreErrors();
    }
    @captureTelemetry(EventName.PYTHON_LANGUAGE_SERVER_READY, undefined, true)
    protected async serverReady(): Promise<void> {
        // languageClient can be disposed in awaits.
        while (this.languageClient && !this.languageClient.initializeResult) {
            await sleep(100);
        }
        if (this.languageClient) {
            await this.languageClient.onReady();
        }
        this.startupCompleted.resolve();
    }
    @swallowExceptions('Activating Unit Tests Manager for Microsoft Python Language Server')
    protected async registerTestServices() {
        if (!this.languageClient) {
            throw new Error('languageClient not initialized');
        }
        await this.testManager.activate(new LanguageServerSymbolProvider(this.languageClient!));
    }

    private registerHandlers(resource: Resource) {
        if (this.disposed) {
            // Check if it got disposed in the interim.
            return;
        }

        const progressReporting = new ProgressReporting(this.languageClient!);
        this.disposables.push(progressReporting);

        const settings = this.configurationService.getSettings(resource);
        if (settings.downloadLanguageServer) {
            this.languageClient!.onTelemetry((telemetryEvent) => {
                const eventName = telemetryEvent.EventName || EventName.PYTHON_LANGUAGE_SERVER_TELEMETRY;
                const formattedProperties = {
                    ...telemetryEvent.Properties,
                    // Replace all slashes in the method name so it doesn't get scrubbed by vscode-extension-telemetry.
                    method: telemetryEvent.Properties.method?.replace(/\//g, '.')
                };
                sendTelemetryEvent(eventName, telemetryEvent.Measurements, formattedProperties);
            });
        }
    }
}
