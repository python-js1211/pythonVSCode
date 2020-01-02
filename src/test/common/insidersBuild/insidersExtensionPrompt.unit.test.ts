// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-any

import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { ApplicationShell } from '../../../client/common/application/applicationShell';
import { CommandManager } from '../../../client/common/application/commandManager';
import { IApplicationShell, ICommandManager } from '../../../client/common/application/types';
import { ExtensionChannelService } from '../../../client/common/insidersBuild/downloadChannelService';
import { InsidersExtensionPrompt, insidersPromptStateKey, optIntoInsidersPromptAgainStateKey } from '../../../client/common/insidersBuild/insidersExtensionPrompt';
import { ExtensionChannel, IExtensionChannelService } from '../../../client/common/insidersBuild/types';
import { PersistentStateFactory } from '../../../client/common/persistentState';
import { IPersistentState, IPersistentStateFactory } from '../../../client/common/types';
import { Common, DataScienceSurveyBanner, ExtensionChannels } from '../../../client/common/utils/localize';

// tslint:disable-next-line: max-func-body-length
suite('Insiders Extension prompt', () => {
    let appShell: IApplicationShell;
    let extensionChannelService: IExtensionChannelService;
    let cmdManager: ICommandManager;
    let persistentState: IPersistentStateFactory;
    let hasUserBeenNotifiedState: TypeMoq.IMock<IPersistentState<boolean>>;
    let hasUserBeenAskedToOptInAgain: TypeMoq.IMock<IPersistentState<boolean>>;
    let insidersPrompt: InsidersExtensionPrompt;
    setup(() => {
        extensionChannelService = mock(ExtensionChannelService);
        appShell = mock(ApplicationShell);
        persistentState = mock(PersistentStateFactory);
        cmdManager = mock(CommandManager);
        hasUserBeenNotifiedState = TypeMoq.Mock.ofType<IPersistentState<boolean>>();
        when(persistentState.createGlobalPersistentState(insidersPromptStateKey, false)).thenReturn(hasUserBeenNotifiedState.object);
        hasUserBeenAskedToOptInAgain = TypeMoq.Mock.ofType<IPersistentState<boolean>>();
        when(persistentState.createGlobalPersistentState(optIntoInsidersPromptAgainStateKey, false)).thenReturn(hasUserBeenAskedToOptInAgain.object);
        insidersPrompt = new InsidersExtensionPrompt(instance(appShell), instance(extensionChannelService), instance(cmdManager), instance(persistentState));
    });

    // tslint:disable-next-line: max-func-body-length
    suite('Notify to use insiders prompt', async () => {
        test("Channel is set to 'daily' if 'Yes, daily' option is selected", async () => {
            const prompts = [ExtensionChannels.yesWeekly(), ExtensionChannels.yesDaily(), DataScienceSurveyBanner.bannerLabelNo()];
            when(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).thenResolve(ExtensionChannels.yesDaily() as any);
            when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
            when(extensionChannelService.updateChannel(ExtensionChannel.daily)).thenResolve();
            hasUserBeenNotifiedState
                .setup(u => u.updateValue(true))
                .returns(() => Promise.resolve(undefined))
                .verifiable(TypeMoq.Times.once());
            await insidersPrompt.promptToInstallInsiders();
            verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).once();
            verify(extensionChannelService.updateChannel(ExtensionChannel.daily)).once();
            hasUserBeenNotifiedState.verifyAll();
            verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
        });

        test("Channel is set to 'weekly' if 'Yes, weekly' option is selected", async () => {
            const prompts = [ExtensionChannels.yesWeekly(), ExtensionChannels.yesDaily(), DataScienceSurveyBanner.bannerLabelNo()];
            when(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).thenResolve(ExtensionChannels.yesWeekly() as any);
            when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
            when(extensionChannelService.updateChannel(ExtensionChannel.weekly)).thenResolve();
            hasUserBeenNotifiedState
                .setup(u => u.updateValue(true))
                .returns(() => Promise.resolve(undefined))
                .verifiable(TypeMoq.Times.once());
            await insidersPrompt.promptToInstallInsiders();
            verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).once();
            verify(extensionChannelService.updateChannel(ExtensionChannel.weekly)).once();
            hasUserBeenNotifiedState.verifyAll();
            verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
        });

        test("No channel is set if 'No, thanks' option is selected", async () => {
            const prompts = [ExtensionChannels.yesWeekly(), ExtensionChannels.yesDaily(), DataScienceSurveyBanner.bannerLabelNo()];
            when(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).thenResolve(DataScienceSurveyBanner.bannerLabelNo() as any);
            when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
            when(extensionChannelService.updateChannel(anything())).thenResolve();
            hasUserBeenNotifiedState
                .setup(u => u.updateValue(true))
                .returns(() => Promise.resolve(undefined))
                .verifiable(TypeMoq.Times.once());
            await insidersPrompt.promptToInstallInsiders();
            verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).once();
            verify(extensionChannelService.updateChannel(anything())).never();
            hasUserBeenNotifiedState.verifyAll();
            verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
        });

        test('No channel is set if no option is selected', async () => {
            const prompts = [ExtensionChannels.yesWeekly(), ExtensionChannels.yesDaily(), DataScienceSurveyBanner.bannerLabelNo()];
            when(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).thenResolve(undefined as any);
            when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
            when(extensionChannelService.updateChannel(anything())).thenResolve();
            hasUserBeenNotifiedState
                .setup(u => u.updateValue(true))
                .returns(() => Promise.resolve(undefined))
                .verifiable(TypeMoq.Times.once());
            await insidersPrompt.promptToInstallInsiders();
            verify(appShell.showInformationMessage(ExtensionChannels.promptMessage(), ...prompts)).once();
            verify(extensionChannelService.updateChannel(anything())).never();
            hasUserBeenNotifiedState.verifyAll();
            verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
        });
    });

    // tslint:disable-next-line: max-func-body-length
    suite('Opt into insiders program again prompt', async () => {
        test("Channel is set to 'daily' if 'Yes, daily' option is selected", async () => {
            const prompts = [ExtensionChannels.yesWeekly(), ExtensionChannels.yesDaily(), DataScienceSurveyBanner.bannerLabelNo()];
            when(appShell.showInformationMessage(ExtensionChannels.optIntoProgramAgainMessage(), ...prompts)).thenResolve(ExtensionChannels.yesDaily() as any);
            when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
            when(extensionChannelService.updateChannel(ExtensionChannel.daily)).thenResolve();
            hasUserBeenAskedToOptInAgain
                .setup(u => u.updateValue(true))
                .returns(() => Promise.resolve(undefined))
                .verifiable(TypeMoq.Times.once());
            await insidersPrompt.promptToEnrollBackToInsiders();
            verify(appShell.showInformationMessage(ExtensionChannels.optIntoProgramAgainMessage(), ...prompts)).once();
            verify(extensionChannelService.updateChannel(ExtensionChannel.daily)).once();
            hasUserBeenAskedToOptInAgain.verifyAll();
            verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
        });

        test("Channel is set to 'weekly' if 'Yes, weekly' option is selected", async () => {
            const prompts = [ExtensionChannels.yesWeekly(), ExtensionChannels.yesDaily(), DataScienceSurveyBanner.bannerLabelNo()];
            when(appShell.showInformationMessage(ExtensionChannels.optIntoProgramAgainMessage(), ...prompts)).thenResolve(ExtensionChannels.yesWeekly() as any);
            when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
            when(extensionChannelService.updateChannel(ExtensionChannel.weekly)).thenResolve();
            hasUserBeenAskedToOptInAgain
                .setup(u => u.updateValue(true))
                .returns(() => Promise.resolve(undefined))
                .verifiable(TypeMoq.Times.once());
            await insidersPrompt.promptToEnrollBackToInsiders();
            verify(appShell.showInformationMessage(ExtensionChannels.optIntoProgramAgainMessage(), ...prompts)).once();
            verify(extensionChannelService.updateChannel(ExtensionChannel.weekly)).once();
            hasUserBeenAskedToOptInAgain.verifyAll();
            verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
        });

        test("No channel is set if 'No, thanks' option is selected", async () => {
            const prompts = [ExtensionChannels.yesWeekly(), ExtensionChannels.yesDaily(), DataScienceSurveyBanner.bannerLabelNo()];
            when(appShell.showInformationMessage(ExtensionChannels.optIntoProgramAgainMessage(), ...prompts)).thenResolve(DataScienceSurveyBanner.bannerLabelNo() as any);
            when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
            when(extensionChannelService.updateChannel(anything())).thenResolve();
            hasUserBeenAskedToOptInAgain
                .setup(u => u.updateValue(true))
                .returns(() => Promise.resolve(undefined))
                .verifiable(TypeMoq.Times.once());
            await insidersPrompt.promptToEnrollBackToInsiders();
            verify(appShell.showInformationMessage(ExtensionChannels.optIntoProgramAgainMessage(), ...prompts)).once();
            verify(extensionChannelService.updateChannel(anything())).never();
            hasUserBeenAskedToOptInAgain.verifyAll();
            verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
        });

        test('No channel is set if no option is selected', async () => {
            const prompts = [ExtensionChannels.yesWeekly(), ExtensionChannels.yesDaily(), DataScienceSurveyBanner.bannerLabelNo()];
            when(appShell.showInformationMessage(ExtensionChannels.optIntoProgramAgainMessage(), ...prompts)).thenResolve(undefined as any);
            when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
            when(extensionChannelService.updateChannel(anything())).thenResolve();
            hasUserBeenAskedToOptInAgain
                .setup(u => u.updateValue(true))
                .returns(() => Promise.resolve(undefined))
                .verifiable(TypeMoq.Times.once());
            await insidersPrompt.promptToEnrollBackToInsiders();
            verify(appShell.showInformationMessage(ExtensionChannels.optIntoProgramAgainMessage(), ...prompts)).once();
            verify(extensionChannelService.updateChannel(anything())).never();
            hasUserBeenAskedToOptInAgain.verifyAll();
            verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
        });
    });

    test('Do not do anything if no option is selected in the reload prompt', async () => {
        when(appShell.showInformationMessage(ExtensionChannels.reloadToUseInsidersMessage(), Common.reload())).thenResolve(undefined);
        when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
        await insidersPrompt.promptToReload();
        verify(appShell.showInformationMessage(ExtensionChannels.reloadToUseInsidersMessage(), Common.reload())).once();
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).never();
    });

    test("Reload windows if 'Reload' option is selected in the reload prompt", async () => {
        when(appShell.showInformationMessage(ExtensionChannels.reloadToUseInsidersMessage(), Common.reload())).thenResolve(Common.reload() as any);
        when(cmdManager.executeCommand('workbench.action.reloadWindow')).thenResolve();
        await insidersPrompt.promptToReload();
        verify(appShell.showInformationMessage(ExtensionChannels.reloadToUseInsidersMessage(), Common.reload())).once();
        verify(cmdManager.executeCommand('workbench.action.reloadWindow')).once();
    });
});
