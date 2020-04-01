// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { shims } from '@jupyter-widgets/base';
import * as jupyterlab from '@jupyter-widgets/jupyterlab-manager';
import { RenderMimeRegistry, standardRendererFactories } from '@jupyterlab/rendermime';
import { Kernel } from '@jupyterlab/services';
import { Widget } from '@phosphor/widgets';
import { DocumentContext } from './documentContext';
import { requireLoader } from './widgetLoader';

export const WIDGET_MIMETYPE = 'application/vnd.jupyter.widget-view+json';

// tslint:disable: no-any
// Source borrowed from https://github.com/jupyter-widgets/ipywidgets/blob/master/examples/web3/src/manager.ts

export class WidgetManager extends jupyterlab.WidgetManager {
    public kernel: Kernel.IKernelConnection;
    public el: HTMLElement;

    constructor(
        kernel: Kernel.IKernelConnection,
        el: HTMLElement,
        private loadErrorHandler: (className: string, moduleName: string, moduleVersion: string, error: any) => void
    ) {
        super(
            new DocumentContext(kernel),
            new RenderMimeRegistry({
                initialFactories: standardRendererFactories
            }),
            { saveState: false }
        );
        this.kernel = kernel;
        this.el = el;
        this.rendermime.addFactory(
            {
                safe: false,
                mimeTypes: [WIDGET_MIMETYPE],
                createRenderer: (options) => new jupyterlab.WidgetRenderer(options, this)
            },
            0
        );

        kernel.registerCommTarget(this.comm_target_name, async (comm, msg) => {
            const oldComm = new shims.services.Comm(comm);
            return this.handle_comm_open(oldComm, msg) as Promise<any>;
        });
    }

    /**
     * Create a comm.
     */
    public async _create_comm(
        target_name: string,
        model_id: string,
        data?: any,
        metadata?: any
    ): Promise<shims.services.Comm> {
        const comm = this.kernel.connectToComm(target_name, model_id);
        if (data || metadata) {
            comm.open(data, metadata);
        }
        return Promise.resolve(new shims.services.Comm(comm));
    }

    /**
     * Get the currently-registered comms.
     */
    public _get_comm_info(): Promise<any> {
        return this.kernel
            .requestCommInfo({ target: this.comm_target_name })
            .then((reply) => (reply.content as any).comms);
    }
    public async display_view(msg: any, view: Backbone.View<Backbone.Model>, options: any): Promise<Widget> {
        const widget = await super.display_view(msg, view, options);
        const element = options.node ? (options.node as HTMLElement) : this.el;
        // When do we detach?
        if (element) {
            Widget.attach(widget, element);
        }
        return widget;
    }
    public async restoreWidgets(): Promise<void> {
        // Disabled for now.
        // This throws errors if enabled, can be added later.
    }
    protected async loadClass(className: string, moduleName: string, moduleVersion: string): Promise<any> {
        // Call the base class to try and load. If that fails, look locally
        window.console.log(`WidgetManager: Loading class ${className}:${moduleName}:${moduleVersion}`);
        // tslint:disable-next-line: no-unnecessary-local-variable
        const result = await super.loadClass(className, moduleName, moduleVersion).catch(async (x) => {
            try {
                const m = await requireLoader(moduleName, moduleVersion);
                if (m && m[className]) {
                    return m[className];
                }
                throw x;
            } catch (ex) {
                this.loadErrorHandler(className, moduleName, moduleVersion, x);
                throw x;
            }
        });

        return result;
    }
}
