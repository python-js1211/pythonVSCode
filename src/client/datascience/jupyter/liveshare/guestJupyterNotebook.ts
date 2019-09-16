// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { Observable } from 'rxjs/Observable';
import { Uri } from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import * as vsls from 'vsls/vscode';

import { ILiveShareApi } from '../../../common/application/types';
import { CancellationError } from '../../../common/cancellation';
import { traceInfo } from '../../../common/logger';
import { IConfigurationService, IDisposableRegistry } from '../../../common/types';
import { createDeferred } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { LiveShare, LiveShareCommands } from '../../constants';
import { ICell, INotebook, INotebookCompletion, INotebookServer, InterruptResult } from '../../types';
import { LiveShareParticipantDefault, LiveShareParticipantGuest } from './liveShareParticipantMixin';
import { ResponseQueue } from './responseQueue';
import { IExecuteObservableResponse, ILiveShareParticipant, IServerResponse } from './types';

export class GuestJupyterNotebook
    extends LiveShareParticipantGuest(LiveShareParticipantDefault, LiveShare.JupyterNotebookSharedService)
    implements INotebook, ILiveShareParticipant {
    private responseQueue: ResponseQueue = new ResponseQueue();
    constructor(
        liveShare: ILiveShareApi,
        private disposableRegistry: IDisposableRegistry,
        private configService: IConfigurationService,
        private _resource: Uri,
        private _owner: INotebookServer,
        private startTime: number

    ) {
        super(liveShare);
    }

    public get resource(): Uri {
        return this._resource;
    }

    public get server(): INotebookServer {
        return this._owner;
    }

    public shutdown(): Promise<void> {
        return Promise.resolve();
    }

    public dispose(): Promise<void> {
        return this.shutdown();
    }

    public waitForIdle(): Promise<void> {
        return Promise.resolve();
    }

    public clear(_id: string): void {
        // We don't do anything as we don't cache results in this class.
        noop();
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

    public async setMatplotLibStyle(_useDark: boolean): Promise<void> {
        // Guest can't change the style. Maybe output a warning here?
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

    public async waitForServiceName(): Promise<string> {
        // Use our base name plus our id. This means one unique server per notebook
        // Live share will not accept a '.' in the name so remove any
        const uriString = this.resource.toString();
        return Promise.resolve(`${LiveShare.JupyterNotebookSharedService}${uriString}`);
    }

    public async getSysInfo(): Promise<ICell | undefined> {
        // This is a special case. Ask the shared server
        const service = await this.waitForService();
        if (service) {
            const result = await service.request(LiveShareCommands.getSysInfo, []);
            return (result as ICell);
        }
    }

    public async getCompletion(_cellCode: string, _offsetInCode: number, _cancelToken?: CancellationToken): Promise<INotebookCompletion> {
        return Promise.resolve({
            matches: [],
            cursor: {
                start: 0,
                end: 0
            },
            metadata: {}
        });
    }

    public async onAttach(api: vsls.LiveShare | null): Promise<void> {
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
                service.notify(LiveShareCommands.catchupRequest, { since: this.startTime });
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
    private async sendRequest(command: string, args: any[]): Promise<any> {
        const service = await this.waitForService();
        if (service) {
            return service.request(command, args);
        }
    }

}
