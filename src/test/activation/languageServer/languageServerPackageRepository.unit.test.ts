// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import * as typeMoq from 'typemoq';
import { LanguageServerDownloadChannel } from '../../../client/activation/common/packageRepository';
import {
    BetaDotNetLanguageServerPackageRepository,
    DailyDotNetLanguageServerPackageRepository,
    StableDotNetLanguageServerPackageRepository
} from '../../../client/activation/languageServer/languageServerPackageRepository';
import { IServiceContainer } from '../../../client/ioc/types';

suite('Language Server Download Channels', () => {
    let serviceContainer: typeMoq.IMock<IServiceContainer>;
    setup(() => {
        serviceContainer = typeMoq.Mock.ofType<IServiceContainer>();
    });

    function getPackageInfo(channel: LanguageServerDownloadChannel) {
        let classToCreate = StableDotNetLanguageServerPackageRepository;
        switch (channel) {
            case LanguageServerDownloadChannel.stable: {
                classToCreate = StableDotNetLanguageServerPackageRepository;
                break;
            }
            case LanguageServerDownloadChannel.beta: {
                classToCreate = BetaDotNetLanguageServerPackageRepository;
                break;
            }
            case LanguageServerDownloadChannel.daily: {
                classToCreate = DailyDotNetLanguageServerPackageRepository;
                break;
            }
            default: {
                throw new Error('Unknown download channel');
            }
        }
        const instance = new (class extends classToCreate {
            constructor() {
                super(serviceContainer.object);
            }
            public get storageAccount() {
                return this.azureCDNBlobStorageAccount;
            }
            public get storageContainer() {
                return this.azureBlobStorageContainer;
            }
        })();

        return [instance.storageAccount, instance.storageContainer];
    }
    test('Stable', () => {
        expect(getPackageInfo(LanguageServerDownloadChannel.stable)).to.be.deep.equal([
            'https://pvsc.azureedge.net',
            'python-language-server-stable'
        ]);
    });
    test('Beta', () => {
        expect(getPackageInfo(LanguageServerDownloadChannel.beta)).to.be.deep.equal([
            'https://pvsc.azureedge.net',
            'python-language-server-beta'
        ]);
    });
    test('Daily', () => {
        expect(getPackageInfo(LanguageServerDownloadChannel.daily)).to.be.deep.equal([
            'https://pvsc.azureedge.net',
            'python-language-server-daily'
        ]);
    });
});
