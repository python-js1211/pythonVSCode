'use strict';

//import {Variable, DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Thread, StackFrame, Scope, Source, Handles} from 'vscode-debugadapter';
import {DebugSession, OutputEvent} from 'vscode-debugadapter';
import {IPythonProcess, IDebugServer} from '../Common/Contracts';
import * as net from 'net';
import {BaseDebugServer} from './BaseDebugServer';

export class LocalDebugServer extends BaseDebugServer {
    private debugSocketServer: net.Server = null;

    constructor(debugSession: DebugSession, pythonProcess: IPythonProcess) {
        super(debugSession, pythonProcess);
    }

    public Stop() {
        if (this.debugSocketServer === null) return;
        try {
            this.debugSocketServer.close();
        }
        catch (ex) { }
        this.debugSocketServer = null;
    }

    public Start(): Promise<IDebugServer> {
        return new Promise<IDebugServer>((resolve, reject) => {
            var that = this;
            this.debugSocketServer = net.createServer(c => { //'connection' listener
                var connected = false;
                console.log('client connected');
                c.on('end', (ex) => { 
                    var msg = "Debugger client disconneced, " + ex;
                    //that.debugSession.sendEvent(new OutputEvent(msg + "\n", "stderr"));
                    console.log(msg);
                });
                c.on("data", (buffer: Buffer) => {
                    if (!connected) {
                        connected = true;
                        that.pythonProcess.Connect(buffer, c, false);
                    }
                    else {
                        that.pythonProcess.HandleIncomingData(buffer)
                        that.isRunning = true;
                    }
                });
                c.on("close", d=> {
                    var msg = "Debugger client closed, " + d;
                    console.log(msg);
                    that.emit("detach", d);
                });
                c.on("error", d=> {
                    // var msg = "Debugger client error, " + d;
                    // that.sendEvent(new OutputEvent(msg + "\n", "Python"));
                    // console.log(msg);
                    // // that.onDetachDebugger();
                });
                c.on("timeout", d=> {
                    var msg = "Debugger client timedout, " + d;
                    that.debugSession.sendEvent(new OutputEvent(msg + "\n", "stderr"));
                    console.log(msg);
                });
            });
            this.debugSocketServer.on("error", ex=> {
                var exMessage = JSON.stringify(ex);
                var msg = "";
                if (ex.code === "EADDRINUSE") {
                    msg = `The port used for debugging is in use, please try again or try restarting Visual Studio Code, Error = ${exMessage}`;
                }
                else {
                    msg = `There was an error in starting the debug server. Error = ${exMessage}`;
                }
                that.debugSession.sendEvent(new OutputEvent(msg + "\n", "stderr"));
                console.log(msg);
                reject(msg);
            });

            this.debugSocketServer.listen(0, () => {
                var server = that.debugSocketServer.address();
                console.log(`Debug server started, listening on port ${server.port}`);
                resolve({ port: server.port });
            });
        });
    }
}