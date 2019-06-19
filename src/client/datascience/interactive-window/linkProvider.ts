// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../common/extensions';

import { inject, injectable } from 'inversify';
import { Event, EventEmitter } from 'vscode';

import { IApplicationShell } from '../../common/application/types';
import { noop } from '../../common/utils/misc';
import { IInteractiveWindowListener } from '../types';
import { InteractiveWindowMessages } from './interactiveWindowTypes';

// tslint:disable: no-any
@injectable()
export class LinkProvider implements IInteractiveWindowListener {
    private postEmitter: EventEmitter<{message: string; payload: any}> = new EventEmitter<{message: string; payload: any}>();
    constructor(@inject(IApplicationShell) private applicationShell: IApplicationShell) {
        noop();
    }

    public get postMessage(): Event<{ message: string; payload: any }> {
        return this.postEmitter.event;
    }

    public onMessage(message: string, payload?: any): void {
        switch (message) {
            case InteractiveWindowMessages.OpenLink:
                if (payload) {
                    this.applicationShell.openUrl(payload.toString());
                }
                break;
            default:
                break;
        }
    }
    public dispose(): void | undefined {
        noop();
    }
}
