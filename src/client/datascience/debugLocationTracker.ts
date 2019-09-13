// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { injectable } from 'inversify';
import { DebugSession, Event, EventEmitter } from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';

import { StopWatch } from '../common/utils/stopWatch';
import { AttachRequestArguments, ConsoleType, LaunchRequestArguments, TriggerType } from '../debugger/types';
import { sendTelemetryEvent } from '../telemetry';
import { EventName } from '../telemetry/constants';
import { IDebugLocation, IDebugLocationTracker } from './types';

// When a python debugging session is active keep track of the current debug location
@injectable()
export class DebugLocationTracker implements IDebugLocationTracker {
    private waitingForStackTrace: boolean = false;
    private _debugLocation: IDebugLocation | undefined;
    private debugLocationUpdatedEvent: EventEmitter<void> = new EventEmitter<void>();
    private trigger: TriggerType = 'launch';
    private console: ConsoleType | undefined;
    private timer = new StopWatch();

    public setDebugSession(targetSession: DebugSession) {
        this.DebugLocation = undefined;
        this.waitingForStackTrace = false;
        this.trigger = targetSession.configuration.type as TriggerType;
        const debugConfiguration = targetSession.configuration as Partial<LaunchRequestArguments & AttachRequestArguments>;
        this.console = debugConfiguration.console;
    }

    public get debugLocationUpdated(): Event<void> {
        return this.debugLocationUpdatedEvent.event;
    }

    public get debugLocation(): IDebugLocation | undefined {
        return this._debugLocation;
    }

    public onWillStartSession() {
        this.sendTelemetry(EventName.DEBUG_SESSION_START);
    }

    // tslint:disable-next-line:no-any
    public onDidSendMessage(message: DebugProtocol.ProtocolMessage) {
        if (message.type === 'response') {
            const response = message as DebugProtocol.Response;
            if (response.command === 'configurationDone') {
                // "configurationDone" response is sent immediately after user code starts running.
                this.sendTelemetry(EventName.DEBUG_SESSION_USER_CODE_RUNNING);
            }
        }

        if (this.isStopEvent(message)) {
            // Some type of stop, wait to see our next stack trace to find our location
            this.waitingForStackTrace = true;
        }

        if (this.isContinueEvent(message)) {
            // Running, clear the location
            this.DebugLocation = undefined;
            this.waitingForStackTrace = false;
        }

        if (this.waitingForStackTrace) {
            // If we are waiting for a stack track, check our messages for one
            const debugLoc = this.getStackTrace(message);
            if (debugLoc) {
                this.DebugLocation = debugLoc;
                this.waitingForStackTrace = false;
            }
        }

    }

    public onWillStopSession() {
        this.sendTelemetry(EventName.DEBUG_SESSION_STOP);
    }

    public onError?(_error: Error) {
        this.sendTelemetry(EventName.DEBUG_SESSION_ERROR);
    }

    // Set our new location and fire our debug event
    private set DebugLocation(newLocation: IDebugLocation | undefined) {
        const oldLocation = this._debugLocation;
        this._debugLocation = newLocation;

        if (this._debugLocation !== oldLocation) {
            this.debugLocationUpdatedEvent.fire();
        }
    }

    // tslint:disable-next-line:no-any
    private isStopEvent(message: DebugProtocol.ProtocolMessage) {
        if (message.type === 'event') {
            const eventMessage = message as DebugProtocol.Event;
            if (eventMessage.event === 'stopped') {
                return true;
            }
        }

        return false;
    }

    // tslint:disable-next-line:no-any
    private getStackTrace(message: DebugProtocol.ProtocolMessage): IDebugLocation | undefined {
        if (message.type === 'response') {
            const responseMessage = message as DebugProtocol.Response;
            if (responseMessage.command === 'stackTrace') {
                const messageBody = responseMessage.body;
                if (messageBody.stackFrames.length > 0) {
                    const lineNumber = messageBody.stackFrames[0].line;
                    const fileName = this.normalizeFilePath(messageBody.stackFrames[0].source.path);
                    const column = messageBody.stackFrames[0].column;
                    return { lineNumber, fileName, column };
                }
            }
        }

        return undefined;
    }

    private normalizeFilePath(path: string): string {
        // Make the path match the os. Debugger seems to return
        // invalid path chars on linux/darwin
        if (process.platform !== 'win32') {
            return path.replace(/\\/g, '/');
        }
        return path;
    }

    // tslint:disable-next-line:no-any
    private isContinueEvent(message: DebugProtocol.ProtocolMessage): boolean {
        if (message.type === 'event') {
            const eventMessage = message as DebugProtocol.Event;
            if (eventMessage.event === 'continue') {
                return true;
            }
        } else if (message.type === 'response') {
            const responseMessage = message as DebugProtocol.Response;
            if (responseMessage.command === 'continue') {
                return true;
            }
        }

        return false;
    }

    private sendTelemetry(eventName: EventName) {
        if (eventName === EventName.DEBUG_SESSION_START) {
            this.timer.reset();
        }
        const telemetryProps = {
            trigger: this.trigger,
            console: this.console
        };
        sendTelemetryEvent(eventName, this.timer.elapsedTime, telemetryProps);
    }
}
