// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter, Uri } from 'vscode';
import {
    ILoadIPyWidgetClassFailureAction,
    LoadIPyWidgetClassLoadAction
} from '../../../datascience-ui/interactive-common/redux/reducers/types';
import { EnableIPyWidgets } from '../../common/experimentGroups';
import { traceError } from '../../common/logger';
import { IDisposableRegistry, IExperimentsManager } from '../../common/types';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { INotebookIdentity, InteractiveWindowMessages } from '../interactive-common/interactiveWindowTypes';
import { IInteractiveWindowListener, INotebookProvider } from '../types';
import { IPyWidgetMessageDispatcherFactory } from './ipyWidgetMessageDispatcherFactory';
import { IIPyWidgetMessageDispatcher } from './types';

/**
 * This class handles all of the ipywidgets communication with the notebook
 */
@injectable()
//
export class IPyWidgetHandler implements IInteractiveWindowListener {
    // tslint:disable-next-line: no-any
    public get postMessage(): Event<{ message: string; payload: any }> {
        return this.postEmitter.event;
    }
    private ipyWidgetMessageDispatcher?: IIPyWidgetMessageDispatcher;
    private notebookIdentity: Uri | undefined;
    // tslint:disable-next-line: no-any
    private postEmitter: EventEmitter<{ message: string; payload: any }> = new EventEmitter<{
        message: string;
        // tslint:disable-next-line: no-any
        payload: any;
    }>();
    // tslint:disable-next-line: no-require-imports
    private hashFn = require('hash.js').sha256;
    private enabled = false;

    constructor(
        @inject(INotebookProvider) notebookProvider: INotebookProvider,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPyWidgetMessageDispatcherFactory)
        private readonly widgetMessageDispatcherFactory: IPyWidgetMessageDispatcherFactory,
        @inject(IExperimentsManager) readonly experimentsManager: IExperimentsManager
    ) {
        disposables.push(
            notebookProvider.onNotebookCreated(async (e) => {
                if (e.identity.toString() === this.notebookIdentity?.toString()) {
                    await this.initialize();
                }
            })
        );

        this.enabled = experimentsManager.inExperiment(EnableIPyWidgets.experiment);
    }

    public dispose() {
        this.ipyWidgetMessageDispatcher?.dispose(); // NOSONAR
    }

    // tslint:disable-next-line: no-any
    public onMessage(message: string, payload?: any): void {
        if (message === InteractiveWindowMessages.NotebookIdentity) {
            this.saveIdentity(payload).catch((ex) => traceError('Failed to initialize ipywidgetHandler', ex));
        } else if (message === InteractiveWindowMessages.IPyWidgetLoadSuccess) {
            this.sendLoadSucceededTelemetry(payload);
        } else if (message === InteractiveWindowMessages.IPyWidgetLoadFailure) {
            this.sendLoadFailureTelemetry(payload);
        } else if (message === InteractiveWindowMessages.IPyWidgetRenderFailure) {
            this.sendRenderFailureTelemetry(payload);
        }
        // tslint:disable-next-line: no-any
        this.getIPyWidgetMessageDispatcher()?.receiveMessage({ message: message as any, payload }); // NOSONAR
    }

    private hash(s: string): string {
        return this.hashFn().update(s).digest('hex');
    }

    private sendLoadSucceededTelemetry(payload: LoadIPyWidgetClassLoadAction) {
        try {
            sendTelemetryEvent(Telemetry.IPyWidgetLoadSuccess, 0, {
                moduleHash: this.hash(payload.moduleName),
                moduleVersion: payload.moduleVersion
            });
        } catch {
            // do nothing on failure
        }
    }

    private sendLoadFailureTelemetry(payload: ILoadIPyWidgetClassFailureAction) {
        try {
            sendTelemetryEvent(Telemetry.IPyWidgetLoadFailure, 0, {
                isOnline: payload.isOnline,
                moduleHash: this.hash(payload.moduleName),
                moduleVersion: payload.moduleVersion
            });
        } catch {
            // do nothing on failure
        }
    }
    private sendRenderFailureTelemetry(payload: Error) {
        try {
            traceError('Error rendering a widget: ', payload);
            sendTelemetryEvent(Telemetry.IPyWidgetRenderFailure);
        } catch {
            // Do nothing on a failure
        }
    }
    private getIPyWidgetMessageDispatcher() {
        if (!this.notebookIdentity || !this.enabled) {
            return;
        }
        this.ipyWidgetMessageDispatcher = this.widgetMessageDispatcherFactory.create(this.notebookIdentity);
        return this.ipyWidgetMessageDispatcher;
    }

    private async saveIdentity(args: INotebookIdentity) {
        this.notebookIdentity = args.resource;

        const dispatcher = this.getIPyWidgetMessageDispatcher();
        if (dispatcher) {
            this.disposables.push(dispatcher.postMessage((msg) => this.postEmitter.fire(msg)));
        }

        await this.initialize();
    }

    private async initialize() {
        if (!this.notebookIdentity) {
            return;
        }
        const dispatcher = this.getIPyWidgetMessageDispatcher();
        if (dispatcher) {
            await dispatcher.initialize();
        }
    }
}
