// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as cors from 'cors';
import * as express from 'express';
import * as http from 'http';
import { IDisposable } from 'monaco-editor';
import * as socketIO from 'socket.io';
import { env, EventEmitter, Uri, WebviewOptions, WebviewPanel, window } from 'vscode';
import { IWebPanel, IWebPanelOptions } from '../../../client/common/application/types';
import { IDisposableRegistry } from '../../../client/common/types';
import { createDeferred } from '../../../client/common/utils/async';
import { noop } from '../../../client/common/utils/misc';

// tslint:disable: no-any no-console no-require-imports no-var-requires
const nocache = require('nocache');

export class WebServer implements IDisposable {
    public get onDidReceiveMessage() {
        return this._onDidReceiveMessage.event;
    }
    private app?: express.Express;
    private io?: socketIO.Server;
    private server?: http.Server;
    private disposed: boolean = false;
    private readonly socketPromise = createDeferred<socketIO.Socket>();
    private readonly _onDidReceiveMessage = new EventEmitter<any>();
    private socket?: socketIO.Socket;

    public dispose() {
        this.server?.close();
        this.io?.close();
        this.disposed = true;
        this.socketPromise.promise.then(s => s.disconnect()).catch(noop);
    }
    public postMessage(message: {}) {
        if (this.disposed) {
            return;
        }
        this.socketPromise.promise
            .then(() => {
                this.socket?.emit('fromServer', message);
            })
            .catch(ex => {
                console.error('Failed to connect to socket', ex);
            });
    }

    /**
     * Starts a WebServer, and optionally displays a Message when server is ready.
     * Used only for debugging and testing purposes.
     */
    public async launchServer(cwd: string, resourcesRoot: string, port: number = 0): Promise<number> {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIO(this.server);
        this.app.use(express.static(resourcesRoot, { cacheControl: false, etag: false }));
        this.app.use(express.static(cwd));
        this.app.use(cors());
        // Ensure browser does'nt cache anything (for UI tests/debugging).
        this.app.use(nocache());
        this.app.disable('view cache');

        this.io.on('connection', socket => {
            // Possible we close browser and reconnect, or hit refresh button.
            this.socket = socket;
            this.socketPromise.resolve(socket);
            socket.on('fromClient', data => {
                this._onDidReceiveMessage.fire(data);
            });
        });

        port = await new Promise<number>((resolve, reject) => {
            this.server?.listen(port, () => {
                const address = this.server?.address();
                if (address && typeof address !== 'string' && 'port' in address) {
                    resolve(address.port);
                } else {
                    reject(new Error('Address not available'));
                }
            });
        });

        // Display a message if this env variable is set (used when debugging).
        // tslint:disable-next-line: no-http-string
        const url = `http:///localhost:${port}/index.html`;
        if (process.env.VSC_PYTHON_DS_UI_PROMPT) {
            window
                // tslint:disable-next-line: messages-must-be-localized
                .showInformationMessage(`Open browser to '${url}'`, 'Copy')
                .then(selection => {
                    if (selection === 'Copy') {
                        env.clipboard.writeText(url).then(noop, noop);
                    }
                }, noop);
        }

        return port;
    }

    public async waitForConnection(): Promise<void> {
        await this.socketPromise.promise;
    }
}
/**
 * Instead of displaying the UI in VS Code WebViews, we'll display in a browser.
 * Ensure environment variable `VSC_PYTHON_DS_UI_PORT` is set to a port number.
 * Also, if you set `VSC_PYTHON_DS_UI_PROMPT`, you'll be presented with a VS Code messagebox when URL/endpoint is ready.
 */
export class WebBrowserPanel implements IWebPanel, IDisposable {
    private panel?: WebviewPanel;
    private server?: WebServer;
    constructor(private readonly disposableRegistry: IDisposableRegistry, private readonly options: IWebPanelOptions) {
        this.disposableRegistry.push(this);
        const webViewOptions: WebviewOptions = {
            enableScripts: true,
            localResourceRoots: [Uri.file(this.options.rootPath), Uri.file(this.options.cwd)]
        };
        if (options.webViewPanel) {
            this.panel = options.webViewPanel;
            this.panel.webview.options = webViewOptions;
        } else {
            this.panel = window.createWebviewPanel(
                options.title.toLowerCase().replace(' ', ''),
                options.title,
                { viewColumn: options.viewColumn, preserveFocus: true },
                {
                    retainContextWhenHidden: true,
                    enableFindWidget: true,
                    ...webViewOptions
                }
            );
        }

        this.panel.webview.html = '<!DOCTYPE html><html><html><body><h1>Loading</h1></body>';
        // Reset when the current panel is closed
        this.disposableRegistry.push(
            this.panel.onDidDispose(() => {
                this.panel = undefined;
                this.options.listener.dispose().ignoreErrors();
            })
        );

        this.launchServer(this.options.cwd, this.options.rootPath).catch(ex =>
            // tslint:disable-next-line: no-console
            console.error('Failed to start Web Browser Panel', ex)
        );
    }
    public setTitle(newTitle: string): void {
        if (this.panel) {
            this.panel.title = newTitle;
        }
    }
    public async show(preserveFocus: boolean): Promise<void> {
        this.panel?.reveal(this.panel?.viewColumn, preserveFocus);
    }
    public isVisible(): boolean {
        return this.panel?.visible === true;
    }
    public close(): void {
        this.dispose();
    }
    public isActive(): boolean {
        return this.panel?.active === true;
    }
    public updateCwd(_cwd: string): void {
        // Noop
    }
    public dispose() {
        this.server?.dispose();
        this.panel?.dispose();
    }

    public postMessage(message: any) {
        this.server?.postMessage(message);
    }

    /**
     * Starts a WebServer, and optionally displays a Message when server is ready.
     * Used only for debugging and testing purposes.
     */
    public async launchServer(cwd: string, resourcesRoot: string): Promise<void> {
        // If no port is provided, use a random port.
        const dsUIPort = parseInt(process.env.VSC_PYTHON_DS_UI_PORT || '', 10);
        const portToUse = isNaN(dsUIPort) ? 0 : dsUIPort;

        this.server = new WebServer();
        this.server.onDidReceiveMessage(data => {
            this.options.listener.onMessage(data.type, data.payload);
        });

        const port = await this.server.launchServer(cwd, resourcesRoot, portToUse);
        if (this.panel?.webview) {
            // tslint:disable-next-line: no-http-string
            const url = `http:///localhost:${port}/index.html`;
            this.panel.webview.html = `<!DOCTYPE html><html><html><body><h1>${url}</h1></body>`;
        }
        await this.server.waitForConnection();
    }
}
