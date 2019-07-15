// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

// tslint:disable-next-line: no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import * as os from 'os';
import { Observable } from 'rxjs/Observable';
import * as vscode from 'vscode';
import { CancellationToken } from 'vscode-jsonrpc';
import * as vsls from 'vsls/vscode';

import { ILiveShareApi } from '../../../common/application/types';
import { traceError } from '../../../common/logger';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry, ILogger } from '../../../common/types';
import { createDeferred } from '../../../common/utils/async';
import * as localize from '../../../common/utils/localize';
import { Identifiers, LiveShare, LiveShareCommands, RegExpValues } from '../../constants';
import { IExecuteInfo } from '../../interactive-window/interactiveWindowTypes';
import {
    ICell,
    IDataScience,
    IJupyterSessionManager,
    INotebookExecutionLogger,
    INotebookServer,
    INotebookServerLaunchInfo,
    InterruptResult
} from '../../types';
import { JupyterServerBase } from '../jupyterServer';
import { LiveShareParticipantHost } from './liveShareParticipantMixin';
import { ResponseQueue } from './responseQueue';
import { IRoleBasedObject } from './roleBasedFactory';
import { IExecuteObservableResponse, IResponseMapping, IServerResponse, ServerResponseType } from './types';

// tslint:disable:no-any

export class HostJupyterServer
    extends LiveShareParticipantHost(JupyterServerBase, LiveShare.JupyterServerSharedService)
    implements IRoleBasedObject, INotebookServer {
    private catchupResponses: ResponseQueue = new ResponseQueue();
    private localResponses: ResponseQueue = new ResponseQueue();
    private requestLog: Map<string, number> = new Map<string, number>();
    private catchupPendingCount: number = 0;
    private disposed = false;
    private portToForward = 0;
    private sharedPort: vscode.Disposable | undefined;
    constructor(
        liveShare: ILiveShareApi,
        dataScience: IDataScience,
        logger: ILogger,
        disposableRegistry: IDisposableRegistry,
        asyncRegistry: IAsyncDisposableRegistry,
        configService: IConfigurationService,
        sessionManager: IJupyterSessionManager,
        loggers: INotebookExecutionLogger[]) {
        super(liveShare, dataScience, logger, disposableRegistry, asyncRegistry, configService, sessionManager, loggers);
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            await super.dispose();
            const api = await this.api;
            return this.onDetach(api);
        }
    }

    public async connect(launchInfo: INotebookServerLaunchInfo, cancelToken?: CancellationToken): Promise<void> {
        if (launchInfo.connectionInfo && launchInfo.connectionInfo.localLaunch) {
            const portMatch = RegExpValues.ExtractPortRegex.exec(launchInfo.connectionInfo.baseUrl);
            if (portMatch && portMatch.length > 1) {
                const port = parseInt(portMatch[1], 10);
                await this.attemptToForwardPort(this.finishedApi, port);
            }
        }
        return super.connect(launchInfo, cancelToken);
    }

    public async onAttach(api: vsls.LiveShare | null): Promise<void> {
        await super.onAttach(api);

        if (api && !this.disposed) {
            const service = await this.waitForService();

            // Attach event handlers to different requests
            if (service) {
                // Requests return arrays
                service.onRequest(LiveShareCommands.syncRequest, (_args: any[], _cancellation: CancellationToken) => this.onSync());
                service.onRequest(LiveShareCommands.getSysInfo, (_args: any[], cancellation: CancellationToken) => this.onGetSysInfoRequest(cancellation));
                service.onRequest(LiveShareCommands.restart, (args: any[], cancellation: CancellationToken) => this.onRestartRequest(args.length > 0 ? args[0] as number : LiveShare.InterruptDefaultTimeout, cancellation));
                service.onRequest(LiveShareCommands.interrupt, (args: any[], cancellation: CancellationToken) => this.onInterruptRequest(args.length > 0 ? args[0] as number : LiveShare.InterruptDefaultTimeout, cancellation));
                service.onRequest(LiveShareCommands.disposeServer, (_args: any[], _cancellation: CancellationToken) => this.dispose());

                // Notifications are always objects.
                service.onNotify(LiveShareCommands.catchupRequest, (args: object) => this.onCatchupRequest(args));
                service.onNotify(LiveShareCommands.executeObservable, (args: object) => this.onExecuteObservableRequest(args));

                // See if we need to forward the port
                await this.attemptToForwardPort(api, this.portToForward);
            }
        }
    }

    public async onDetach(api: vsls.LiveShare | null): Promise<void> {
        await super.onDetach(api);

        // Make sure to unshare our port
        if (api && this.sharedPort) {
            this.sharedPort.dispose();
            this.sharedPort = undefined;
        }
    }

    public async waitForServiceName(): Promise<string> {
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

    public async onPeerChange(ev: vsls.PeersChangeEvent): Promise<void> {
        await super.onPeerChange(ev);

        // Keep track of the number of guests that need to do a catchup request
        this.catchupPendingCount +=
            ev.added.filter(e => e.role === vsls.Role.Guest).length -
            ev.removed.filter(e => e.role === vsls.Role.Guest).length;
    }

    public executeObservable(code: string, file: string, line: number, id: string, silent?: boolean): Observable<ICell[]> {
        // See if this has already been asked for not
        if (this.requestLog.has(id)) {
            // This must be a local call that occurred after a guest call. Just
            // use the local responses to return the results.
            return this.localResponses.waitForObservable(code, id);
        } else {
            // Otherwise make a new request and save response in the catchup list. THis is a
            // a request that came directly from the host so the host will be listening to the observable returned
            // and we don't need to save the response in the local queue.
            return this.makeObservableRequest(code, file, line, id, silent, [this.catchupResponses]);
        }
    }

    public async restartKernel(timeoutMs: number): Promise<void> {
        try {
            await super.restartKernel(timeoutMs);
        } catch (exc) {
            this.postException(exc, []);
            throw exc;
        }
    }

    public async interruptKernel(timeoutMs: number): Promise<InterruptResult> {
        try {
            return super.interruptKernel(timeoutMs);
        } catch (exc) {
            this.postException(exc, []);
            throw exc;
        }
    }

    private makeRequest(code: string, file: string, line: number, id: string, silent: boolean | undefined, responseQueues: ResponseQueue[]): Promise<ICell[]> {
        // Create a deferred that we'll fire when we're done
        const deferred = createDeferred<ICell[]>();

        // Attempt to evaluate this cell in the jupyter notebook
        const observable = this.makeObservableRequest(code, file, line, id, silent, responseQueues);
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

        // Wait for the execution to finish
        return deferred.promise;
    }

    private makeObservableRequest(code: string, file: string, line: number, id: string, silent: boolean | undefined, responseQueues: ResponseQueue[]): Observable<ICell[]> {
        try {
            this.requestLog.set(id, Date.now());
            const inner = super.executeObservable(code, file, line, id, silent);

            // Cleanup old requests
            const now = Date.now();
            for (const [k, val] of this.requestLog) {
                if (now - val > LiveShare.ResponseLifetime) {
                    this.requestLog.delete(k);
                }
            }

            // Wrap the observable returned to send the responses to the guest(s) too.
            return this.postObservableResult(code, inner, id, responseQueues);
        } catch (exc) {
            this.postException(exc, responseQueues);
            throw exc;
        }

    }

    private async attemptToForwardPort(api: vsls.LiveShare | null | undefined, port: number): Promise<void> {
        if (port !== 0 && api && api.session && api.session.role === vsls.Role.Host) {
            this.portToForward = 0;
            this.sharedPort = await api.shareServer({ port, displayName: localize.DataScience.liveShareHostFormat().format(os.hostname()) });
        } else {
            this.portToForward = port;
        }
    }

    private translateCellForGuest(cell: ICell): ICell {
        const copy = { ...cell };
        if (this.role === vsls.Role.Host && this.finishedApi && copy.file !== Identifiers.EmptyFileName) {
            copy.file = this.finishedApi.convertLocalUriToShared(vscode.Uri.file(copy.file)).fsPath;
        }
        return copy;
    }

    private onSync(): Promise<any> {
        return Promise.resolve(true);
    }

    private onGetSysInfoRequest(_cancellation: CancellationToken): Promise<any> {
        // Get the sys info from our local server
        return super.getSysInfo();
    }

    private onRestartRequest(timeout: number, _cancellation: CancellationToken): Promise<any> {
        // Just call the base
        return super.restartKernel(timeout);
    }
    private onInterruptRequest(timeout: number, _cancellation: CancellationToken): Promise<any> {
        // Just call the base
        return super.interruptKernel(timeout);
    }

    private async onCatchupRequest(args: object): Promise<void> {
        if (args.hasOwnProperty('since')) {
            const service = await this.waitForService();
            if (service) {
                // Send results for all responses that are left.
                this.catchupResponses.send(service, this.translateForGuest.bind(this));

                // Eliminate old responses if possible.
                this.catchupPendingCount -= 1;
                if (this.catchupPendingCount <= 0) {
                    this.catchupResponses.clear();
                }
            }
        }
    }

    private onExecuteObservableRequest(args: object) {
        // See if we started this execute or not already.
        if (args.hasOwnProperty('code')) {
            const obj = args as IExecuteInfo;
            if (!this.requestLog.has(obj.id)) {
                try {
                    // Convert the file name if necessary
                    const uri = vscode.Uri.parse(`vsls:${obj.file}`);
                    const file = this.finishedApi && obj.file !== Identifiers.EmptyFileName ? this.finishedApi.convertSharedUriToLocal(uri).fsPath : obj.file;

                    // We need the results of this execute to end up in both the guest responses and the local responses
                    this.makeRequest(obj.code, file, obj.line, obj.id, false, [this.localResponses, this.catchupResponses]).ignoreErrors();
                } catch (e) {
                    this.logger.logError(e);
                }
            }
        }
    }

    private postObservableResult(code: string, observable: Observable<ICell[]>, id: string, responseQueues: ResponseQueue[]): Observable<ICell[]> {
        return new Observable(subscriber => {
            let pos = 0;

            // Listen to all of the events on the observable passed in.
            observable.subscribe(cells => {
                // Forward to the next listener
                subscriber.next(cells);

                // Send across to the guest side
                try {
                    this.postObservableNext(code, pos, cells, id, responseQueues);
                    pos += 1;
                } catch (e) {
                    subscriber.error(e);
                    this.postException(e, responseQueues);
                }
            },
                e => {
                    subscriber.error(e);
                    this.postException(e, responseQueues);
                },
                () => {
                    subscriber.complete();
                    this.postObservableComplete(code, pos, id, responseQueues);
                });
        });
    }

    private translateForGuest = (r: IServerResponse): IServerResponse => {
        // Remap the cell paths
        const er = r as IExecuteObservableResponse;
        if (er && er.cells) {
            return { cells: er.cells.map(this.translateCellForGuest, this), ...er };
        }
        return r;
    }

    private postObservableNext(code: string, pos: number, cells: ICell[], id: string, responseQueues: ResponseQueue[]) {
        this.postResult(
            ServerResponseType.ExecuteObservable,
            { code, pos, type: ServerResponseType.ExecuteObservable, cells, id, time: Date.now() },
            this.translateForGuest,
            responseQueues);
    }

    private postObservableComplete(code: string, pos: number, id: string, responseQueues: ResponseQueue[]) {
        this.postResult(
            ServerResponseType.ExecuteObservable,
            { code, pos, type: ServerResponseType.ExecuteObservable, cells: undefined, id, time: Date.now() },
            this.translateForGuest,
            responseQueues);
    }

    private postException(exc: any, responseQueues: ResponseQueue[]) {
        this.postResult(
            ServerResponseType.Exception,
            { type: ServerResponseType.Exception, time: Date.now(), message: exc.toString() },
            r => r,
            responseQueues);
    }

    private postResult<R extends IResponseMapping, T extends keyof R>(
        _type: T,
        result: R[T],
        guestTranslator: (r: IServerResponse) => IServerResponse,
        responseQueues: ResponseQueue[]): void {
        const typedResult = ((result as any) as IServerResponse);
        if (typedResult) {
            try {
                // Make a deep copy before we send. Don't want local copies being modified
                const deepCopy = cloneDeep(typedResult);
                this.waitForService().then(s => {
                    if (s) {
                        s.notify(LiveShareCommands.serverResponse, guestTranslator(deepCopy));
                    }
                }).ignoreErrors();

                // Need to also save in memory for those guests that are in the middle of starting up
                responseQueues.forEach(r => r.push(deepCopy));
            } catch (exc) {
                traceError(exc);
            }
        }
    }
}
