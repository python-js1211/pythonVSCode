// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import '@jupyter-widgets/controls/css/labvariables.css';

import type { Kernel, KernelMessage } from '@jupyterlab/services';
import type { nbformat } from '@jupyterlab/services/node_modules/@jupyterlab/coreutils';
import * as fastDeepEqual from 'fast-deep-equal';
import 'rxjs/add/operator/concatMap';
import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';
import { IDisposable } from '../../client/common/types';
import { createDeferred, Deferred } from '../../client/common/utils/async';
import { noop } from '../../client/common/utils/misc';
import { deserializeDataViews, serializeDataViews } from '../../client/common/utils/serializers';
import {
    IInteractiveWindowMapping,
    IPyWidgetMessages
} from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { KernelSocketOptions } from '../../client/datascience/types';
import { AllowedIPyWidgetMessages } from '../interactive-common/redux/postOffice';
import { PostOffice } from '../react-common/postOffice';
import { create as createKernel, IKernelSocket } from './kernel';
import { IIPyWidgetManager, IJupyterLabWidgetManager, IJupyterLabWidgetManagerCtor } from './types';

// tslint:disable: no-any

export class WidgetManager implements IIPyWidgetManager {
    public static get instance(): Observable<WidgetManager | undefined> {
        return WidgetManager._instance;
    }
    private static _instance = new ReplaySubject<WidgetManager | undefined>();
    private manager?: IJupyterLabWidgetManager;
    private proxyKernel?: Kernel.IKernel;
    private options?: KernelSocketOptions;
    private readonly kernelSocket: IKernelSocket;
    /**
     * Contains promises related to model_ids that need to be displayed.
     * When we receive a message from the kernel of type = `display_data` for a widget (`application/vnd.jupyter.widget-view+json`),
     * then its time to display this.
     * We need to keep track of this. A boolean is sufficient, but we're using a promise so we can be notified when it is ready.
     *
     * @private
     * @memberof WidgetManager
     */
    private modelIdsToBeDisplayed = new Map<string, Deferred<void>>();
    /**
     * Create an observable to ensure we have messages stored until ready to be processed and ensure they are processed in sync,
     * event with async code.
     */
    private readonly messages: ReplaySubject<{ type: string; payload?: any }>;
    private startedProcessingMessages = false;
    constructor(
        private readonly widgetContainer: HTMLElement,
        private readonly postOffice: PostOffice,
        private readonly scriptLoader: {
            loadWidgetScriptsFromThirdPartySource: boolean;
            // tslint:disable-next-line: no-any
            errorHandler(className: string, moduleName: string, moduleVersion: string, error: any): void;
        }
    ) {
        // Create an observable with list of messages to be processed by the kernel in ipywidgets.
        // Use an observable so that messages are buffered until it is ready to process them.
        // tslint:disable-next-line: no-any
        this.messages = new ReplaySubject<{ type: string; payload?: any }>();
        this.postOffice.addHandler({
            handleMessage: (message: string, payload?: any) => {
                if (message === IPyWidgetMessages.IPyWidgets_kernelOptions) {
                    this.initializeKernelAndWidgetManager(payload);
                    // } else if (message === IPyWidgetMessages.IPyWidgets_onRestartKernel) {
                    //     // Kernel was restarted.
                    //     this.manager?.dispose();
                    //     this.manager = undefined;
                    //     this.proxyKernel?.dispose();
                    //     this.proxyKernel = undefined;
                    //     WidgetManager._instance.next(undefined);
                } else if (AllowedIPyWidgetMessages.find((k) => k === message)) {
                    this.messages.next({ type: message, payload });
                }
                return true;
            }
        });

        // Dummy socket.
        this.kernelSocket = {
            onMessage: noop,
            postMessage: (data: string) => {
                // Do this only if we have a valid kernel & manager.
                // E.g. if they have been disposed, then ignore all messages from then on.
                if (!this.manager || !this.proxyKernel) {
                    return;
                }
                if (typeof data === 'string') {
                    this.postOffice.sendMessage<IInteractiveWindowMapping>(IPyWidgetMessages.IPyWidgets_msg, data);
                } else {
                    // Serialize binary data properly before sending to extension.
                    this.postOffice.sendMessage<IInteractiveWindowMapping>(
                        IPyWidgetMessages.IPyWidgets_binary_msg,
                        serializeDataViews([data])
                    );
                }
            }
        };

        // Handshake.
        this.postOffice.sendMessage<IInteractiveWindowMapping>(IPyWidgetMessages.IPyWidgets_Ready);
    }
    public dispose(): void {
        this.proxyKernel?.dispose(); // NOSONAR
    }
    public async clear(): Promise<void> {
        await this.manager?.clear_state();
    }
    /**
     * Renders a widget and returns a disposable (to remove the widget).
     *
     * @param {(nbformat.IMimeBundle & {model_id: string; version_major: number})} data
     * @param {HTMLElement} ele
     * @returns {Promise<{ dispose: Function }>}
     * @memberof WidgetManager
     */
    public async renderWidget(
        data: nbformat.IMimeBundle & { model_id: string; version_major: number },
        ele: HTMLElement
    ): Promise<IDisposable> {
        if (!data) {
            throw new Error(
                "application/vnd.jupyter.widget-view+json not in msg.content.data, as msg.content.data is 'undefined'."
            );
        }
        if (!this.manager) {
            throw new Error('DS IPyWidgetManager not initialized.');
        }

        if (!data || data.version_major !== 2) {
            console.warn('Widget data not avaialble to render an ipywidget');
            return { dispose: noop };
        }

        const modelId = data.model_id as string;
        // Check if we have processed the data for this model.
        // If not wait.
        if (!this.modelIdsToBeDisplayed.has(modelId)) {
            this.modelIdsToBeDisplayed.set(modelId, createDeferred());
        }
        // Wait until it is flagged as ready to be processed.
        // This widget manager must have recieved this message and performed all operations before this.
        // Once all messages prior to this have been processed in sequence and this message is receievd,
        // then, and only then are we ready to render the widget.
        // I.e. this is a way of synchronzing the render with the processing of the messages.
        await this.modelIdsToBeDisplayed.get(modelId)!.promise;

        const modelPromise = this.manager.get_model(data.model_id);
        if (!modelPromise) {
            console.warn('Widget model not avaialble to render an ipywidget');
            return { dispose: noop };
        }

        // ipywdigets may not have completed creating the model.
        // ipywidgets have a promise, as the model may get created by a 3rd party library.
        // That 3rd party library may not be available and may have to be downloaded.
        // Hence the promise to wait until it has been created.
        const model = await modelPromise;
        const view = await this.manager.create_view(model, { el: ele });
        // tslint:disable-next-line: no-any
        return this.manager.display_view(data, view, { node: ele });
    }
    private initializeKernelAndWidgetManager(options: KernelSocketOptions) {
        if (this.proxyKernel && fastDeepEqual(options, this.options)) {
            return;
        }
        this.proxyKernel?.dispose(); // NOSONAR
        this.proxyKernel = createKernel(this.kernelSocket, options);

        // When a comm target has been regisered, we need to register this in the real kernel in extension side.
        // Hence send that message to extension.
        const originalRegisterCommTarget = this.proxyKernel.registerCommTarget.bind(this.proxyKernel);
        this.proxyKernel.registerCommTarget = (
            targetName: string,
            callback: (comm: Kernel.IComm, msg: KernelMessage.ICommOpenMsg) => void | PromiseLike<void>
        ) => {
            this.postOffice.sendMessage<IInteractiveWindowMapping>(
                IPyWidgetMessages.IPyWidgets_registerCommTarget,
                targetName
            );
            return originalRegisterCommTarget(targetName, callback);
        };

        // Dispose any existing managers.
        this.manager?.dispose(); // NOSONAR
        try {
            // The JupyterLabWidgetManager will be exposed in the global variable `window.ipywidgets.main` (check webpack config - src/ipywidgets/webpack.config.js).
            // tslint:disable-next-line: no-any
            const JupyterLabWidgetManager = (window as any).vscIPyWidgets.WidgetManager as IJupyterLabWidgetManagerCtor;
            if (!JupyterLabWidgetManager) {
                throw new Error('JupyterLabWidgetManadger not defined. Please include/check ipywidgets.js file');
            }
            // When ever there is a display data message, ensure we build the model.
            this.proxyKernel.iopubMessage.connect(this.handleDisplayDataMessage.bind(this));

            this.manager = new JupyterLabWidgetManager(this.proxyKernel, this.widgetContainer, this.scriptLoader);
            WidgetManager._instance.next(this);
        } catch (ex) {
            // tslint:disable-next-line: no-console
            console.error('Failed to initialize WidgetManager', ex);
        }
        this.startProcessingMessages();
    }
    private startProcessingMessages(): void {
        if (this.startedProcessingMessages) {
            return;
        }
        this.startedProcessingMessages = true;
        // Process all messages sequentially.
        this.messages
            .concatMap(async (msg) => {
                try {
                    if (!this.kernelSocket.onMessage) {
                        return;
                    }
                    if (msg.type === IPyWidgetMessages.IPyWidgets_kernelOptions) {
                        return;
                    } else if (msg.type === IPyWidgetMessages.IPyWidgets_msg) {
                        this.kernelSocket.onMessage(new MessageEvent('', { data: msg.payload }));
                    } else if (msg.type === IPyWidgetMessages.IPyWidgets_binary_msg) {
                        const payload = deserializeDataViews(msg.payload)![0];
                        this.kernelSocket.onMessage(new MessageEvent('', { data: payload }));
                    }
                } catch (ex) {
                    // tslint:disable-next-line: no-console
                    console.error('Failed to handle Widget message', ex);
                }
            })
            .subscribe();
    }
    /**
     * Ensure we create the model for the display data.
     */
    private async handleDisplayDataMessage(_sender: any, payload: KernelMessage.IIOPubMessage): Promise<void> {
        // tslint:disable-next-line:no-require-imports
        const jupyterLab = require('@jupyterlab/services') as typeof import('@jupyterlab/services'); // NOSONAR

        if (!jupyterLab.KernelMessage.isDisplayDataMsg(payload)) {
            return;
        }
        // tslint:disable-next-line: no-any
        let msgChain = (this.proxyKernel as any)._msgChain as Promise<void>;
        const handleDisplayData = async () => {
            const displayMsg = payload as KernelMessage.IDisplayDataMsg;

            if (
                displayMsg.content &&
                displayMsg.content.data &&
                displayMsg.content.data['application/vnd.jupyter.widget-view+json']
            ) {
                // tslint:disable-next-line: no-any
                const data = displayMsg.content.data['application/vnd.jupyter.widget-view+json'] as any;
                const modelId = data.model_id;

                if (!this.modelIdsToBeDisplayed.has(modelId)) {
                    this.modelIdsToBeDisplayed.set(modelId, createDeferred());
                }
                if (!this.manager) {
                    throw new Error('DS IPyWidgetManager not initialized');
                }
                const modelPromise = this.manager.get_model(data.model_id);
                if (modelPromise) {
                    await modelPromise;
                }
                // Mark it as completed (i.e. ready to display).
                this.modelIdsToBeDisplayed.get(modelId)!.resolve();
            }
        };

        if (msgChain) {
            msgChain = msgChain.then(handleDisplayData);
            // tslint:disable-next-line: no-any
            (this.proxyKernel as any)._msgChain = msgChain;
        } else {
            await handleDisplayData();
        }
    }
}
