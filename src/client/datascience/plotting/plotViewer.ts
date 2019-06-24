// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Event, EventEmitter, ViewColumn } from 'vscode';

import { traceInfo } from '../../../client/common/logger';
import { createDeferred } from '../../../client/common/utils/async';
import { IApplicationShell, IWebPanelProvider, IWorkspaceService } from '../../common/application/types';
import { EXTENSION_ROOT_DIR } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IConfigurationService, IDisposable } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { ICodeCssGenerator, IPlotViewer, IThemeFinder } from '../types';
import { WebViewHost } from '../webViewHost';
import { PlotViewerMessageListener } from './plotViewerMessageListener';
import { IExportPlotRequest, IPlotViewerMapping, PlotViewerMessages } from './types';

@injectable()
export class PlotViewer extends WebViewHost<IPlotViewerMapping> implements IPlotViewer, IDisposable {
    private disposed: boolean = false;
    private closedEvent: EventEmitter<IPlotViewer> = new EventEmitter<IPlotViewer>();
    private removedEvent: EventEmitter<number> = new EventEmitter<number>();

    constructor(
        @inject(IWebPanelProvider) provider: IWebPanelProvider,
        @inject(IConfigurationService) configuration: IConfigurationService,
        @inject(ICodeCssGenerator) cssGenerator: ICodeCssGenerator,
        @inject(IThemeFinder) themeFinder: IThemeFinder,
        @inject(IWorkspaceService) workspaceService: IWorkspaceService,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IFileSystem) private fileSystem: IFileSystem
        ) {
        super(
            configuration,
            provider,
            cssGenerator,
            themeFinder,
            workspaceService,
            (c, v, d) => new PlotViewerMessageListener(c, v, d),
            path.join(EXTENSION_ROOT_DIR, 'out', 'datascience-ui', 'plot', 'index_bundle.js'),
            localize.DataScience.plotViewerTitle(),
            ViewColumn.One);
    }

    public get closed(): Event<IPlotViewer> {
        return this.closedEvent.event;
    }

    public get removed(): Event<number> {
        return this.removedEvent.event;
    }

    public async show(): Promise<void> {
        if (!this.disposed) {
            // Then show our web panel.
            return super.show(true);
        }
    }

    public addPlot = async (imageHtml: string) : Promise<void> => {
        if (!this.disposed) {
            // Make sure we're shown
            await super.show(false);

            // Send a message with our data
            this.postMessage(PlotViewerMessages.SendPlot, imageHtml).ignoreErrors();
        }
    }

    public dispose() {
        if (!this.disposed) {
            this.disposed = true;
            super.dispose();
            if (this.closedEvent) {
                this.closedEvent.fire(this);
            }
        }
    }

    //tslint:disable-next-line:no-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case PlotViewerMessages.CopyPlot:
                this.copyPlot(payload.toString()).ignoreErrors();
                break;

            case PlotViewerMessages.ExportPlot:
                this.exportPlot(payload).ignoreErrors();
                break;

            case PlotViewerMessages.RemovePlot:
                this.removePlot(payload);
                break;

            default:
                break;
        }

        super.onMessage(message, payload);
    }

    private removePlot(payload: number) {
        this.removedEvent.fire(payload);
    }

    private copyPlot(_svg: string) : Promise<void> {
        // This should be handled actually in the web view. Leaving
        // this here for now in case need node to handle it.
        return Promise.resolve();
    }

    private async exportPlot(payload: IExportPlotRequest) : Promise<void> {
        traceInfo('exporting plot...');
        const filtersObject: Record<string, string[]> = {};
        filtersObject[localize.DataScience.pdfFilter()] = ['pdf'];
        filtersObject[localize.DataScience.pngFilter()] = ['png'];
        filtersObject[localize.DataScience.svgFilter()] = ['svg'];

        // Ask the user what file to save to
        const file = await this.applicationShell.showSaveDialog({
            saveLabel: localize.DataScience.exportPlotTitle(),
            filters: filtersObject
        });
        try {
            if (file) {
                const ext = path.extname(file.fsPath);
                switch (ext.toLowerCase()) {
                    case '.pdf':
                        traceInfo('Attempting pdf write...');
                        // Import here since pdfkit is so huge.
                        // tslint:disable-next-line: no-require-imports
                        const SVGtoPDF = require('svg-to-pdfkit');
                        const deferred = createDeferred<void>();
                        // tslint:disable-next-line: no-require-imports
                        const pdfkit = require('pdfkit');
                        const doc = new pdfkit();
                        const ws = this.fileSystem.createWriteStream(file.fsPath);
                        traceInfo(`Writing pdf to ${file.fsPath}`);
                        ws.on('finish', () => deferred.resolve);
                        SVGtoPDF(doc, payload.svg, 0, 0);
                        doc.pipe(ws);
                        doc.end();
                        traceInfo(`Finishing pdf to ${file.fsPath}`);
                        await deferred.promise;
                        traceInfo(`Completed pdf to ${file.fsPath}`);
                        break;

                    case '.png':
                        const buffer = new Buffer(payload.png.replace('data:image/png;base64', ''), 'base64');
                        await this.fileSystem.writeFile(file.fsPath, buffer);
                        break;

                    default:
                    case '.svg':
                        // This is the easy one:
                        await this.fileSystem.writeFile(file.fsPath, payload.svg);
                        break;
                }

            }

        } catch (e) {
            traceError(e);
            this.applicationShell.showErrorMessage(localize.DataScience.exportImageFailed().format(e));
        }
    }

}
