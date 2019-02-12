// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as vsls from 'vsls/vscode';

import { noop } from '../../../../test/core';
import { ILiveShareApi } from '../../../common/application/types';
import { IAsyncDisposable } from '../../../common/types';
import { ClassType } from '../../../ioc/types';
import { ILiveShareParticipant } from './types';
import { waitForGuestService, waitForHostService } from './utils';

// tslint:disable:no-any

export class LiveShareParticipantDefault implements IAsyncDisposable {
    constructor(...rest: any[]) {
        noop();
    }

    public async dispose() : Promise<void> {
        noop();
    }
}

export function LiveShareParticipantGuest<T extends ClassType<IAsyncDisposable>>(SuperClass: T, serviceName: string) {
    return LiveShareParticipantMixin<T, vsls.SharedServiceProxy | null>(SuperClass, vsls.Role.Guest, serviceName, waitForGuestService);
}

export function LiveShareParticipantHost<T extends ClassType<IAsyncDisposable>>(SuperClass: T, serviceName: string) {
    return LiveShareParticipantMixin<T, vsls.SharedService | null>(SuperClass, vsls.Role.Host, serviceName, waitForHostService);
}

/**
 * This is called a mixin class in TypeScript.
 * Allows us to have different base classes but inherit behavior (workaround for not allowing multiple inheritance).
 * Essentially it sticks a temp class in between the base class and the class you're writing.
 * Something like this:
 *
 * class Base {
 *    doStuff() {
 *
 *    }
 * }
 *
 * function Mixin = (SuperClass) {
 *   return class extends SuperClass {
 *      doExtraStuff() {
 *          super.doStuff();
 *      }
 *   }
 * }
 *
 * function SubClass extends Mixin(Base) {
 *    doBar() : {
 *        super.doExtraStuff();
 *    }
 * }
 *
 */
function LiveShareParticipantMixin<T extends ClassType<IAsyncDisposable>, S>(
    SuperClass: T,
    expectedRole: vsls.Role,
    serviceName: string,
    serviceWaiter: (api: vsls.LiveShare, name: string) => Promise<S>) {
    return class extends SuperClass implements ILiveShareParticipant {
        protected finishedApi: vsls.LiveShare | null | undefined;
        protected api: Promise<vsls.LiveShare | null>;
        private actualRole = vsls.Role.None;
        private wantedRole = expectedRole;
        private servicePromise: Promise<S | undefined> | undefined;

        constructor(...rest: any[]) {
            super(...rest);
            // First argument should be our live share api
            if (rest.length > 0) {
                const liveShare = rest[0] as ILiveShareApi;
                this.api = liveShare.getApi();
                this.api.then(a => {
                    this.finishedApi = a;
                    this.onSessionChange(a).ignoreErrors();
                }).ignoreErrors();
            } else {
                this.api = Promise.resolve(null);
            }
        }

        public get role() {
            return this.actualRole;
        }

        public async onPeerChange(ev: vsls.PeersChangeEvent) : Promise<void> {
            noop();
        }

        public async onAttach(api: vsls.LiveShare | null) : Promise<void> {
            noop();
        }

        public async onDetach(api: vsls.LiveShare | null) : Promise<void> {
            noop();
        }

        public async onSessionChange(api: vsls.LiveShare | null) : Promise<void> {
            this.servicePromise = undefined;
            const newRole = api !== null && api.session ?
                api.session.role : vsls.Role.None;
            if (newRole !== this.actualRole) {
                this.actualRole = newRole;
                if (newRole === this.wantedRole) {
                    this.onAttach(api).ignoreErrors();
                } else {
                    this.onDetach(api).ignoreErrors();
                }
            }
        }

        public async waitForService() : Promise<S | undefined> {
            if (this.servicePromise) {
                return this.servicePromise;
            }
            const api = await this.api;
            if (!api || (api.session.role !== this.wantedRole)) {
                this.servicePromise = Promise.resolve(undefined);
            } else {
                this.servicePromise = serviceWaiter(api, serviceName);
            }

            return this.servicePromise;
        }
    };
}
