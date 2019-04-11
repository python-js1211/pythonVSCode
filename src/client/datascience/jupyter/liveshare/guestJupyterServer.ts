// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { Observable } from 'rxjs/Observable';
import { CancellationToken } from 'vscode-jsonrpc';
import * as vsls from 'vsls/vscode';

import { ILiveShareApi } from '../../../common/application/types';
import { CancellationError } from '../../../common/cancellation';
import { traceInfo } from '../../../common/logger';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry, ILogger } from '../../../common/types';
import { createDeferred, Deferred } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { LiveShare, LiveShareCommands } from '../../constants';
import {
    ICell,
    IConnection,
    IDataScience,
    IJupyterSessionManager,
    INotebookServer,
    INotebookServerLaunchInfo,
    InterruptResult
} from '../../types';
import { LiveShareParticipantDefault, LiveShareParticipantGuest } from './liveShareParticipantMixin';
import { ResponseQueue } from './responseQueue';
import { IExecuteObservableResponse, ILiveShareParticipant, IServerResponse } from './types';

export class GuestJupyterServer
    extends LiveShareParticipantGuest(LiveShareParticipantDefault, LiveShare.JupyterServerSharedService)
    implements INotebookServer, ILiveShareParticipant {
    private launchInfo : INotebookServerLaunchInfo | undefined;
    private responseQueue : ResponseQueue = new ResponseQueue();
    private connectPromise: Deferred<INotebookServerLaunchInfo> = createDeferred<INotebookServerLaunchInfo>();

    constructor(
        liveShare: ILiveShareApi,
        private dataScience: IDataScience,
        _logger: ILogger,
        private disposableRegistry: IDisposableRegistry,
        _asyncRegistry: IAsyncDisposableRegistry,
        private configService: IConfigurationService,
        _sessionManager: IJupyterSessionManager
    ) {
        super(liveShare);
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, _cancelToken?: CancellationToken): Promise<void> {
        this.launchInfo = launchInfo;
        this.connectPromise.resolve(launchInfo);
        return Promise.resolve();
    }

    public async shutdown(): Promise<void> {
        // Send this across to the other side. Otherwise the host server will remain running (like during an export)
        const service = await this.waitForService();
        if (service) {
            await service.request(LiveShareCommands.disposeServer, []);
        }
    }

    public dispose(): Promise<void> {
        return this.shutdown();
    }

    public waitForIdle(): Promise<void> {
        return Promise.resolve();
    }

    public async execute(code: string, file: string, line: number, id: string, cancelToken?: CancellationToken): Promise<ICell[]> {
        // Create a deferred that we'll fire when we're done
        const deferred = createDeferred<ICell[]>();

        // Attempt to evaluate this cell in the jupyter notebook
        const observable = this.executeObservable(code, file, line, id);
        let output: ICell[];

        observable.subscribe(
            (cells: ICell[]) => {
                output = cells;
            },
            (error) => {
                deferred.reject(error);
            },
            () => {
                deferred.resolve(output);
            });

        if (cancelToken) {
            this.disposableRegistry.push(cancelToken.onCancellationRequested(() => deferred.reject(new CancellationError())));
        }

        // Wait for the execution to finish
        return deferred.promise;
    }

    public setInitialDirectory(_directory: string): Promise<void> {
        // Ignore this command on this side
        return Promise.resolve();
    }

    public executeObservable(code: string, file: string, line: number, id: string): Observable<ICell[]> {
        // Mimic this to the other side and then wait for a response
        this.waitForService().then(s => {
            if (s) {
                s.notify(LiveShareCommands.executeObservable, { code, file, line, id });
            }
        }).ignoreErrors();
        return this.responseQueue.waitForObservable(code, id);
    }

    public async restartKernel(): Promise<void> {
        // We need to force a restart on the host side
        return this.sendRequest(LiveShareCommands.restart, []);
    }

    public async interruptKernel(_timeoutMs: number): Promise<InterruptResult> {
        const settings = this.configService.getSettings();
        const interruptTimeout = settings.datascience.jupyterInterruptTimeout;

        const response = await this.sendRequest(LiveShareCommands.interrupt, [interruptTimeout]);
        return (response as InterruptResult);
    }

    // Return a copy of the connection information that this server used to connect with
    public getConnectionInfo(): IConnection | undefined {
        if (this.launchInfo) {
            return this.launchInfo.connectionInfo;
        }

        return undefined;
    }

    public waitForConnect(): Promise<INotebookServerLaunchInfo | undefined> {
        return this.connectPromise.promise;
    }

    public async waitForServiceName() : Promise<string> {
        // First wait for connect to occur
        const launchInfo = await this.waitForConnect();

        // Use our base name plus our purpose. This means one unique server per purpose
        if (!launchInfo) {
            return LiveShare.JupyterServerSharedService;
        }
        // tslint:disable-next-line:no-suspicious-comment
        // TODO: Should there be some separator in the name?
        return `${LiveShare.JupyterServerSharedService}${launchInfo.purpose}`;
    }

    public async getSysInfo() : Promise<ICell | undefined> {
        // This is a special case. Ask the shared server
        const service = await this.waitForService();
        if (service) {
            const result = await service.request(LiveShareCommands.getSysInfo, []);
            return (result as ICell);
        }
    }

    public async onAttach(api: vsls.LiveShare | null) : Promise<void> {
        await super.onAttach(api);

        if (api) {
            const service = await this.waitForService();

            // Wait for sync up
            const synced = service ? await service.request(LiveShareCommands.syncRequest, []) : undefined;
            if (!synced && api.session && api.session.role !== vsls.Role.None) {
                throw new Error(localize.DataScience.liveShareSyncFailure());
            }

            if (service) {
                // Listen to responses
                service.onNotify(LiveShareCommands.serverResponse, this.onServerResponse);

                // Request all of the responses since this guest was started. We likely missed a bunch
                service.notify(LiveShareCommands.catchupRequest, { since: this.dataScience.activationStartTime });
            }
        }
    }

    private onServerResponse = (args: Object) => {
        const er = args as IExecuteObservableResponse;
        traceInfo(`Guest serverResponse ${er.pos} ${er.id}`);
        // Args should be of type ServerResponse. Stick in our queue if so.
        if (args.hasOwnProperty('type')) {
            this.responseQueue.push(args as IServerResponse);
        }
    }

    // tslint:disable-next-line:no-any
    private async sendRequest(command: string, args: any[]) : Promise<any> {
        const service = await this.waitForService();
        if (service) {
            return service.request(command, args);
        }
    }

}
