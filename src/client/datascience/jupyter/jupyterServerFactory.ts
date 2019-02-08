// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';
import { Observable } from 'rxjs/Observable';
import { CancellationToken } from 'vscode-jsonrpc';

import { ILiveShareApi } from '../../common/application/types';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry, ILogger } from '../../common/types';
import {
    ICell,
    IConnection,
    IDataScience,
    IJupyterKernelSpec,
    IJupyterSessionManager,
    INotebookServer,
    InterruptResult
} from '../types';
import { JupyterServerBase } from './jupyterServer';
import { GuestJupyterServer } from './liveshare/guestJupyterServer';
import { HostJupyterServer } from './liveshare/hostJupyterServer';
import { RoleBasedFactory } from './liveshare/roleBasedFactory';

type JupyterServerClassType = {
    new(liveShare: ILiveShareApi,
        dataScience: IDataScience,
        logger: ILogger,
        disposableRegistry: IDisposableRegistry,
        asyncRegistry: IAsyncDisposableRegistry,
        configService: IConfigurationService,
        sessionManager: IJupyterSessionManager): INotebookServer;
};

@injectable()
export class JupyterServer implements INotebookServer {
    private serverFactory: RoleBasedFactory<INotebookServer, JupyterServerClassType>;

    private connInfo : IConnection | undefined;

    constructor(
        @inject(ILiveShareApi) liveShare: ILiveShareApi,
        @inject(IDataScience) dataScience: IDataScience,
        @inject(ILogger) logger: ILogger,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IConfigurationService) configService: IConfigurationService,
        @inject(IJupyterSessionManager) sessionManager: IJupyterSessionManager) {
        this.serverFactory = new RoleBasedFactory<INotebookServer, JupyterServerClassType>(
            liveShare,
            JupyterServerBase,
            HostJupyterServer,
            GuestJupyterServer,
            liveShare,
            dataScience,
            logger,
            disposableRegistry,
            asyncRegistry,
            configService,
            sessionManager
        );
    }

    public async connect(connInfo: IConnection, kernelSpec: IJupyterKernelSpec | undefined, usingDarkTheme: boolean, cancelToken?: CancellationToken, workingDir?: string): Promise<void> {
        this.connInfo = connInfo;
        const server = await this.serverFactory.get();
        return server.connect(connInfo, kernelSpec, usingDarkTheme, cancelToken, workingDir);
    }

    public async shutdown(): Promise<void> {
        const server = await this.serverFactory.get();
        return server.shutdown();
    }

    public async dispose(): Promise<void> {
        const server = await this.serverFactory.get();
        return server.dispose();
    }

    public async waitForIdle(): Promise<void> {
        const server = await this.serverFactory.get();
        return server.waitForIdle();
    }

    public async execute(code: string, file: string, line: number, cancelToken?: CancellationToken): Promise<ICell[]> {
        const server = await this.serverFactory.get();
        return server.execute(code, file, line, cancelToken);
    }

    public async setInitialDirectory(directory: string): Promise<void> {
        const server = await this.serverFactory.get();
        return server.setInitialDirectory(directory);
    }

    public executeObservable(code: string, file: string, line: number, id?: string): Observable<ICell[]> {
        // Create a wrapper observable around the actual server (because we have to wait for a promise)
        return new Observable<ICell[]>(subscriber => {
            this.serverFactory.get().then(s => {
                s.executeObservable(code, file, line, id)
                    .forEach(n => subscriber.next(n), Promise)
                    .then(f => subscriber.complete())
                    .catch(e => subscriber.error(e));
            },
            r => {
                subscriber.error(r);
                subscriber.complete();
            });
        });
    }

    public async executeSilently(code: string, cancelToken?: CancellationToken): Promise<void> {
        const server = await this.serverFactory.get();
        return server.dispose();
    }

    public async restartKernel(): Promise<void> {
        const server = await this.serverFactory.get();
        return server.restartKernel();
    }

    public async interruptKernel(timeoutMs: number): Promise<InterruptResult> {
        const server = await this.serverFactory.get();
        return server.interruptKernel(timeoutMs);
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IConnection | undefined {
        return this.connInfo;
    }

    public async getSysInfo() : Promise<ICell | undefined> {
        const server = await this.serverFactory.get();
        return server.getSysInfo();
    }
}
