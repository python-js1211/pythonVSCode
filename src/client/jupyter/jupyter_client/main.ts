"use strict";

import { JupyterSocketClient } from './jupyterSocketClient';
import { SocketServer } from '../../common/comms/socketServer';
import * as child_process from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { createDeferred, Deferred } from '../../common/helpers';
import { KernelspecMetadata, Kernelspec, ParsedIOMessage } from '../contracts';
import { IJupyterClient } from './contracts';
import { KernelCommand } from './contracts';
import { PythonSettings } from '../../common/configSettings';
import * as Rx from 'rx';
import { EventEmitter } from 'events';
import { formatErrorForLogging } from '../../common/utils';

export class JupyterClient extends EventEmitter implements IJupyterClient {
    constructor(private outputChannel: vscode.OutputChannel, private rootDir: string) {
        super();
    }

    private process: child_process.ChildProcess;
    private socketServer: SocketServer;
    private ipythonAdapter: JupyterSocketClient;

    private startDef: Deferred<any>;
    public start(): Promise<any> {
        if (this.startDef) {
            return this.startDef.promise;
        }

        this.startDef = createDeferred<any>();
        const pyFile = path.join(__dirname, '..', '..', '..', '..', 'pythonFiles', 'PythonTools', 'ipythonServer.py');

        this.startSocketServer().then(port => {
            const def = createDeferred<any>();
            // const newEnv = { "DEBUG_DJAYAMANNE_IPYTHON": "1" };
            // Object.assign(newEnv, process.env);
            //const options = { env: newEnv, cwd: this.rootDir }
            const options = { cwd: this.rootDir };
            this.process = child_process.spawn(PythonSettings.getInstance().pythonPath, [pyFile, port.toString()], options);
            this.process.stdout.setEncoding('utf8');
            this.process.stderr.setEncoding('utf8');

            let processStarted = false;
            let handshakeDone = false;
            let isInTestRun = process.env['PYTHON_DONJAYAMANNE_TEST'] === "1";
            const testDef = createDeferred<any>();
            const promiseToResolve = isInTestRun ? testDef.resolve.bind(testDef) : def.resolve.bind(def);

            this.process.stdout.on('data', (data: string) => {
                if (data.split(/\r?\n/g).some(line => line === 'Started')) {
                    processStarted = true;
                    if (processStarted && handshakeDone) {
                        promiseToResolve();
                    }
                    return;
                }
                this.outputChannel.append(data);
            });
            this.process.stderr.on('data', (data: string) => {
                this.outputChannel.append(data);
            });

            this.ipythonAdapter.on('handshake', () => {
                handshakeDone = true;
                if (processStarted && handshakeDone) {
                    promiseToResolve();
                }
            });

            // If we're testing, then test the ping and the pong
            if (isInTestRun) {
                testDef.promise.then(() => {
                    // Ok everything has started, now test ping
                    const msg1 = 'Hello world from Type Script - Функция проверки ИНН и КПП - 长城!1';
                    const msg2 = 'Hello world from Type Script - Функция проверки ИНН и КПП - 长城!2';
                    Promise.all<string>([this.ipythonAdapter.ping(msg1), this.ipythonAdapter.ping(msg2)]).then(msgs => {
                        if (msgs.indexOf(msg1) === -1 || msgs.indexOf(msg2) === -1) {
                            def.reject('msg1 or msg2 not returned');
                        }
                        else {
                            def.resolve();
                        }
                    }).catch(reason => def.reject(reason));
                });
            }

            return def.promise;
        }).then(() => {
            this.startDef.resolve();
        }).catch(reason => {
            this.startDef.reject(reason);
        });

        return this.startDef.promise;
    }
    private startSocketServer(): Promise<number> {
        this.socketServer = new SocketServer();
        this.ipythonAdapter = new JupyterSocketClient(this.socketServer);
        this.ipythonAdapter.on('status', status => {
            this.emit('status', status);
        });
        this.ipythonAdapter.on('commanderror', (commandError: { command: string, id: string, trace: string }) => {
            this.outputChannel.appendLine(`Unhandled command Error from Jupyter. '${JSON.stringify(commandError)}'`);
        });
        this.ipythonAdapter.on('iopubmessagepareerror', (error, jsonResult) => {
            const errorToLog = formatErrorForLogging(error);
            this.outputChannel.appendLine(`Error in handling IO message. ${errorToLog}, JSON Message = ${jsonResult}`);
        });
        this.ipythonAdapter.on('shellmessagepareerror', (error, jsonResult) => {
            const errorToLog = formatErrorForLogging(error);
            this.outputChannel.appendLine(`Error in handling Shell message. ${errorToLog}, JSON Message = ${jsonResult}`);
        });
        return this.socketServer.Start();
    }

    public getAllKernelSpecs(): Promise<{ [key: string]: Kernelspec }> {
        return this.start().then(() => this.ipythonAdapter.listKernelSpecs());
    }
    public startKernel(kernelSpec: KernelspecMetadata): Promise<[string, any, string]> {
        return this.start().then(() => this.getAllKernelSpecs()).then(specks => {
            // ok given the specks, find the name of the kernelspec
            const kernelSpecName = Object.keys(specks).find(kernelSpecName => {
                const spec = specks[kernelSpecName];
                return spec.spec.display_name === kernelSpec.display_name;
            });
            return this.ipythonAdapter.startKernel(kernelSpecName);
        });
    }
    public shutdownkernel(kernelUUID: string): Promise<any> {
        return this.start().then(() => this.ipythonAdapter.sendKernelCommand(kernelUUID, KernelCommand.shutdown));
    }
    public interruptKernel(kernelUUID: string): Promise<any> {
        return this.start().then(() => this.ipythonAdapter.sendKernelCommand(kernelUUID, KernelCommand.interrupt));
    }
    public restartKernel(kernelUUID: string): Promise<any> {
        return this.start().then(() => this.ipythonAdapter.sendKernelCommand(kernelUUID, KernelCommand.restart));
    }
    public runCode(code: string): Rx.IObservable<ParsedIOMessage> {
        const subject = new Rx.Subject<ParsedIOMessage>();
        this.start().then(() => {
            const runnerObservable = this.ipythonAdapter.runCode(code);
            runnerObservable.subscribe(data => {
                subject.onNext(data);
            }, reason => {
                subject.onError(reason);
            }, () => {
                subject.onCompleted();
            });
        }).catch(reason => {
            subject.onError(reason);
        });

        return subject;
    }
}