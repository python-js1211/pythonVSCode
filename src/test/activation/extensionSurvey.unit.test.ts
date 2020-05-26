// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert, expect } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { ExtensionSurveyPrompt, extensionSurveyStateKeys } from '../../client/activation/extensionSurvey';
import { IApplicationEnvironment, IApplicationShell } from '../../client/common/application/types';
import { ShowExtensionSurveyPrompt } from '../../client/common/experiments/groups';
import { PersistentStateFactory } from '../../client/common/persistentState';
import { IPlatformService } from '../../client/common/platform/types';
import {
    IBrowserService,
    IExperimentsManager,
    IPersistentState,
    IPersistentStateFactory,
    IRandom
} from '../../client/common/types';
import { createDeferred } from '../../client/common/utils/async';
import { Common, ExtensionSurveyBanner, LanguageService } from '../../client/common/utils/localize';
import { OSType } from '../../client/common/utils/platform';
import { sleep } from '../core';

// tslint:disable:no-any

// tslint:disable-next-line:max-func-body-length
suite('Extension survey prompt - shouldShowBanner()', () => {
    let appShell: TypeMoq.IMock<IApplicationShell>;
    let browserService: TypeMoq.IMock<IBrowserService>;
    let random: TypeMoq.IMock<IRandom>;
    let persistentStateFactory: IPersistentStateFactory;
    let experiments: TypeMoq.IMock<IExperimentsManager>;
    let platformService: TypeMoq.IMock<IPlatformService>;
    let appEnvironment: TypeMoq.IMock<IApplicationEnvironment>;
    let disableSurveyForTime: TypeMoq.IMock<IPersistentState<any>>;
    let doNotShowAgain: TypeMoq.IMock<IPersistentState<any>>;
    let extensionSurveyPrompt: ExtensionSurveyPrompt;
    setup(() => {
        experiments = TypeMoq.Mock.ofType<IExperimentsManager>();
        appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        browserService = TypeMoq.Mock.ofType<IBrowserService>();
        random = TypeMoq.Mock.ofType<IRandom>();
        persistentStateFactory = mock(PersistentStateFactory);
        disableSurveyForTime = TypeMoq.Mock.ofType<IPersistentState<any>>();
        doNotShowAgain = TypeMoq.Mock.ofType<IPersistentState<any>>();
        platformService = TypeMoq.Mock.ofType<IPlatformService>();
        appEnvironment = TypeMoq.Mock.ofType<IApplicationEnvironment>();
        when(
            persistentStateFactory.createGlobalPersistentState(
                extensionSurveyStateKeys.disableSurveyForTime,
                false,
                anything()
            )
        ).thenReturn(disableSurveyForTime.object);
        when(
            persistentStateFactory.createGlobalPersistentState(extensionSurveyStateKeys.doNotShowAgain, false)
        ).thenReturn(doNotShowAgain.object);
        extensionSurveyPrompt = new ExtensionSurveyPrompt(
            appShell.object,
            browserService.object,
            instance(persistentStateFactory),
            random.object,
            experiments.object,
            appEnvironment.object,
            platformService.object,
            10
        );
    });
    test('Returns false if do not show again is clicked', async () => {
        random
            .setup((r) => r.getRandomInt(0, 100))
            .returns(() => 10)
            .verifiable(TypeMoq.Times.never());
        doNotShowAgain.setup((d) => d.value).returns(() => true);

        const result = extensionSurveyPrompt.shouldShowBanner();

        expect(result).to.equal(false, 'Banner should not be shown');
        verify(
            persistentStateFactory.createGlobalPersistentState(
                extensionSurveyStateKeys.disableSurveyForTime,
                false,
                anything()
            )
        ).never();
        verify(
            persistentStateFactory.createGlobalPersistentState(extensionSurveyStateKeys.doNotShowAgain, false)
        ).once();
        random.verifyAll();
    });
    test('Returns false if prompt is disabled for a while', async () => {
        random
            .setup((r) => r.getRandomInt(0, 100))
            .returns(() => 10)
            .verifiable(TypeMoq.Times.never());
        disableSurveyForTime.setup((d) => d.value).returns(() => true);
        doNotShowAgain.setup((d) => d.value).returns(() => false);

        const result = extensionSurveyPrompt.shouldShowBanner();

        expect(result).to.equal(false, 'Banner should not be shown');
        verify(
            persistentStateFactory.createGlobalPersistentState(
                extensionSurveyStateKeys.disableSurveyForTime,
                false,
                anything()
            )
        ).once();
        verify(
            persistentStateFactory.createGlobalPersistentState(extensionSurveyStateKeys.doNotShowAgain, false)
        ).once();
        random.verifyAll();
    });
    test('Returns false if user is not in the random sampling', async () => {
        disableSurveyForTime.setup((d) => d.value).returns(() => false);
        doNotShowAgain.setup((d) => d.value).returns(() => false);
        // Default sample size is 10
        for (let i = 10; i < 100; i = i + 1) {
            random.setup((r) => r.getRandomInt(0, 100)).returns(() => i);
            const result = extensionSurveyPrompt.shouldShowBanner();
            expect(result).to.equal(false, 'Banner should not be shown');
        }
        random.verifyAll();
    });
    test('Returns true if user is in the random sampling', async () => {
        disableSurveyForTime.setup((d) => d.value).returns(() => false);
        doNotShowAgain.setup((d) => d.value).returns(() => false);
        // Default sample size is 10
        for (let i = 0; i < 10; i = i + 1) {
            random.setup((r) => r.getRandomInt(0, 100)).returns(() => i);
            const result = extensionSurveyPrompt.shouldShowBanner();
            expect(result).to.equal(true, 'Banner should be shown');
        }
    });

    test('Always return true if sample size is 100', async () => {
        extensionSurveyPrompt = new ExtensionSurveyPrompt(
            appShell.object,
            browserService.object,
            instance(persistentStateFactory),
            random.object,
            experiments.object,
            appEnvironment.object,
            platformService.object,
            100
        );
        disableSurveyForTime.setup((d) => d.value).returns(() => false);
        doNotShowAgain.setup((d) => d.value).returns(() => false);
        for (let i = 0; i < 100; i = i + 1) {
            random.setup((r) => r.getRandomInt(0, 100)).returns(() => i);
            const result = extensionSurveyPrompt.shouldShowBanner();
            expect(result).to.equal(true, 'Banner should be shown');
        }
    });

    test('Always return false if sample size is 0', async () => {
        extensionSurveyPrompt = new ExtensionSurveyPrompt(
            appShell.object,
            browserService.object,
            instance(persistentStateFactory),
            random.object,
            experiments.object,
            appEnvironment.object,
            platformService.object,
            0
        );
        disableSurveyForTime.setup((d) => d.value).returns(() => false);
        doNotShowAgain.setup((d) => d.value).returns(() => false);
        for (let i = 0; i < 100; i = i + 1) {
            random.setup((r) => r.getRandomInt(0, 100)).returns(() => i);
            const result = extensionSurveyPrompt.shouldShowBanner();
            expect(result).to.equal(false, 'Banner should not be shown');
        }
        random.verifyAll();
    });
});

// tslint:disable-next-line: max-func-body-length
suite('Extension survey prompt - showSurvey()', () => {
    let experiments: TypeMoq.IMock<IExperimentsManager>;
    let appShell: TypeMoq.IMock<IApplicationShell>;
    let browserService: TypeMoq.IMock<IBrowserService>;
    let random: TypeMoq.IMock<IRandom>;
    let persistentStateFactory: IPersistentStateFactory;
    let disableSurveyForTime: TypeMoq.IMock<IPersistentState<any>>;
    let doNotShowAgain: TypeMoq.IMock<IPersistentState<any>>;
    let platformService: TypeMoq.IMock<IPlatformService>;
    let appEnvironment: TypeMoq.IMock<IApplicationEnvironment>;
    let extensionSurveyPrompt: ExtensionSurveyPrompt;
    setup(() => {
        appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        browserService = TypeMoq.Mock.ofType<IBrowserService>();
        random = TypeMoq.Mock.ofType<IRandom>();
        persistentStateFactory = mock(PersistentStateFactory);
        disableSurveyForTime = TypeMoq.Mock.ofType<IPersistentState<any>>();
        doNotShowAgain = TypeMoq.Mock.ofType<IPersistentState<any>>();
        platformService = TypeMoq.Mock.ofType<IPlatformService>();
        appEnvironment = TypeMoq.Mock.ofType<IApplicationEnvironment>();
        when(
            persistentStateFactory.createGlobalPersistentState(
                extensionSurveyStateKeys.disableSurveyForTime,
                false,
                anything()
            )
        ).thenReturn(disableSurveyForTime.object);
        when(
            persistentStateFactory.createGlobalPersistentState(extensionSurveyStateKeys.doNotShowAgain, false)
        ).thenReturn(doNotShowAgain.object);
        experiments = TypeMoq.Mock.ofType<IExperimentsManager>();
        extensionSurveyPrompt = new ExtensionSurveyPrompt(
            appShell.object,
            browserService.object,
            instance(persistentStateFactory),
            random.object,
            experiments.object,
            appEnvironment.object,
            platformService.object,
            10
        );
    });

    test("Launch survey if 'Yes' option is clicked", async () => {
        const packageJson = {
            version: 'extensionVersion'
        };
        const prompts = [LanguageService.bannerLabelYes(), ExtensionSurveyBanner.maybeLater(), Common.doNotShowAgain()];
        const expectedUrl = `https://aka.ms/AA5rjx5?o=Windows&v=vscodeVersion&e=extensionVersion&m=sessionId`;
        appEnvironment
            .setup((a) => a.packageJson)
            .returns(() => packageJson)
            .verifiable(TypeMoq.Times.once());
        appEnvironment
            .setup((a) => a.vscodeVersion)
            .returns(() => 'vscodeVersion')
            .verifiable(TypeMoq.Times.once());
        appEnvironment
            .setup((a) => a.sessionId)
            .returns(() => 'sessionId')
            .verifiable(TypeMoq.Times.once());
        platformService
            .setup((a) => a.osType)
            .returns(() => OSType.Windows)
            .verifiable(TypeMoq.Times.once());
        appShell
            .setup((a) => a.showInformationMessage(ExtensionSurveyBanner.bannerMessage(), ...prompts))
            .returns(() => Promise.resolve(LanguageService.bannerLabelYes()))
            .verifiable(TypeMoq.Times.once());
        browserService
            .setup((s) => s.launch(expectedUrl))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.once());
        disableSurveyForTime
            .setup((d) => d.updateValue(true))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.once());
        doNotShowAgain
            .setup((d) => d.updateValue(true))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());

        await extensionSurveyPrompt.showSurvey();

        verify(
            persistentStateFactory.createGlobalPersistentState(
                extensionSurveyStateKeys.disableSurveyForTime,
                false,
                anything()
            )
        ).once();
        verify(
            persistentStateFactory.createGlobalPersistentState(extensionSurveyStateKeys.doNotShowAgain, false)
        ).never();
        appShell.verifyAll();
        browserService.verifyAll();
        disableSurveyForTime.verifyAll();
        doNotShowAgain.verifyAll();
        appEnvironment.verifyAll();
        platformService.verifyAll();
    });

    test("Do nothing if 'Maybe later' option is clicked", async () => {
        const prompts = [LanguageService.bannerLabelYes(), ExtensionSurveyBanner.maybeLater(), Common.doNotShowAgain()];
        platformService.setup((p) => p.osType).verifiable(TypeMoq.Times.never());
        appShell
            .setup((a) => a.showInformationMessage(ExtensionSurveyBanner.bannerMessage(), ...prompts))
            .returns(() => Promise.resolve(ExtensionSurveyBanner.maybeLater()))
            .verifiable(TypeMoq.Times.once());
        browserService
            .setup((s) => s.launch(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());
        disableSurveyForTime
            .setup((d) => d.updateValue(true))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());
        doNotShowAgain
            .setup((d) => d.updateValue(true))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());

        await extensionSurveyPrompt.showSurvey();

        verify(
            persistentStateFactory.createGlobalPersistentState(
                extensionSurveyStateKeys.disableSurveyForTime,
                false,
                anything()
            )
        ).never();
        verify(
            persistentStateFactory.createGlobalPersistentState(extensionSurveyStateKeys.doNotShowAgain, false)
        ).never();
        appShell.verifyAll();
        browserService.verifyAll();
        disableSurveyForTime.verifyAll();
        doNotShowAgain.verifyAll();
        platformService.verifyAll();
    });

    test('Do nothing if no option is clicked', async () => {
        const prompts = [LanguageService.bannerLabelYes(), ExtensionSurveyBanner.maybeLater(), Common.doNotShowAgain()];
        platformService.setup((p) => p.osType).verifiable(TypeMoq.Times.never());
        appShell
            .setup((a) => a.showInformationMessage(ExtensionSurveyBanner.bannerMessage(), ...prompts))
            .returns(() => Promise.resolve(undefined))
            .verifiable(TypeMoq.Times.once());
        browserService
            .setup((s) => s.launch(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());
        disableSurveyForTime
            .setup((d) => d.updateValue(true))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());
        doNotShowAgain
            .setup((d) => d.updateValue(true))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());

        await extensionSurveyPrompt.showSurvey();

        verify(
            persistentStateFactory.createGlobalPersistentState(
                extensionSurveyStateKeys.disableSurveyForTime,
                false,
                anything()
            )
        ).never();
        verify(
            persistentStateFactory.createGlobalPersistentState(extensionSurveyStateKeys.doNotShowAgain, false)
        ).never();
        appShell.verifyAll();
        browserService.verifyAll();
        disableSurveyForTime.verifyAll();
        doNotShowAgain.verifyAll();
        platformService.verifyAll();
    });

    test("Disable prompt if 'Do not show again' option is clicked", async () => {
        const prompts = [LanguageService.bannerLabelYes(), ExtensionSurveyBanner.maybeLater(), Common.doNotShowAgain()];
        platformService.setup((p) => p.osType).verifiable(TypeMoq.Times.never());
        appShell
            .setup((a) => a.showInformationMessage(ExtensionSurveyBanner.bannerMessage(), ...prompts))
            .returns(() => Promise.resolve(Common.doNotShowAgain()))
            .verifiable(TypeMoq.Times.once());
        browserService
            .setup((s) => s.launch(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());
        disableSurveyForTime
            .setup((d) => d.updateValue(true))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.never());
        doNotShowAgain
            .setup((d) => d.updateValue(true))
            .returns(() => Promise.resolve())
            .verifiable(TypeMoq.Times.once());

        await extensionSurveyPrompt.showSurvey();

        verify(
            persistentStateFactory.createGlobalPersistentState(
                extensionSurveyStateKeys.disableSurveyForTime,
                false,
                anything()
            )
        ).never();
        verify(
            persistentStateFactory.createGlobalPersistentState(extensionSurveyStateKeys.doNotShowAgain, false)
        ).once();
        appShell.verifyAll();
        browserService.verifyAll();
        disableSurveyForTime.verifyAll();
        doNotShowAgain.verifyAll();
        platformService.verifyAll();
    });
});

// tslint:disable-next-line: max-func-body-length
suite('Extension survey prompt - activate()', () => {
    let appShell: TypeMoq.IMock<IApplicationShell>;
    let browserService: TypeMoq.IMock<IBrowserService>;
    let random: TypeMoq.IMock<IRandom>;
    let persistentStateFactory: IPersistentStateFactory;
    let shouldShowBanner: sinon.SinonStub<any>;
    let showSurvey: sinon.SinonStub<any>;
    let experiments: TypeMoq.IMock<IExperimentsManager>;
    let extensionSurveyPrompt: ExtensionSurveyPrompt;
    let platformService: TypeMoq.IMock<IPlatformService>;
    let appEnvironment: TypeMoq.IMock<IApplicationEnvironment>;
    setup(() => {
        appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        browserService = TypeMoq.Mock.ofType<IBrowserService>();
        random = TypeMoq.Mock.ofType<IRandom>();
        persistentStateFactory = mock(PersistentStateFactory);
        experiments = TypeMoq.Mock.ofType<IExperimentsManager>();
        platformService = TypeMoq.Mock.ofType<IPlatformService>();
        appEnvironment = TypeMoq.Mock.ofType<IApplicationEnvironment>();
    });

    teardown(() => {
        sinon.restore();
    });

    test("If user is not in 'ShowExtensionPrompt' experiment, send telemetry if in control group & return", async () => {
        shouldShowBanner = sinon.stub(ExtensionSurveyPrompt.prototype, 'shouldShowBanner');
        shouldShowBanner.callsFake(() => false);
        showSurvey = sinon.stub(ExtensionSurveyPrompt.prototype, 'showSurvey');
        extensionSurveyPrompt = new ExtensionSurveyPrompt(
            appShell.object,
            browserService.object,
            instance(persistentStateFactory),
            random.object,
            experiments.object,
            appEnvironment.object,
            platformService.object,
            10
        );
        experiments
            .setup((exp) => exp.inExperiment(ShowExtensionSurveyPrompt.enabled))
            .returns(() => false)
            .verifiable(TypeMoq.Times.once());
        experiments
            .setup((exp) => exp.sendTelemetryIfInExperiment(ShowExtensionSurveyPrompt.control))
            .returns(() => undefined)
            .verifiable(TypeMoq.Times.once());
        await extensionSurveyPrompt.activate();
        assert.ok(shouldShowBanner.notCalled);
        experiments.verifyAll();
    });

    test("No survey is shown if shouldShowBanner() returns false and user is in 'ShowExtensionPrompt' experiment", async () => {
        const deferred = createDeferred<true>();
        shouldShowBanner = sinon.stub(ExtensionSurveyPrompt.prototype, 'shouldShowBanner');
        shouldShowBanner.callsFake(() => false);
        showSurvey = sinon.stub(ExtensionSurveyPrompt.prototype, 'showSurvey');
        showSurvey.callsFake(() => {
            deferred.resolve(true);
            return Promise.resolve();
        });
        // waitTimeToShowSurvey = 50 ms
        extensionSurveyPrompt = new ExtensionSurveyPrompt(
            appShell.object,
            browserService.object,
            instance(persistentStateFactory),
            random.object,
            experiments.object,
            appEnvironment.object,
            platformService.object,
            10,
            50
        );
        experiments
            .setup((exp) => exp.inExperiment(ShowExtensionSurveyPrompt.enabled))
            .returns(() => true)
            .verifiable(TypeMoq.Times.once());
        experiments
            .setup((exp) => exp.sendTelemetryIfInExperiment(TypeMoq.It.isAny()))
            .returns(() => undefined)
            .verifiable(TypeMoq.Times.never());
        await extensionSurveyPrompt.activate();
        assert.ok(shouldShowBanner.calledOnce);

        const doesSurveyShowUp = await Promise.race([deferred.promise, sleep(100).then(() => false)]);
        assert.ok(showSurvey.notCalled);
        expect(doesSurveyShowUp).to.equal(false, 'Survey should not appear');
        experiments.verifyAll();
    });

    test("Survey is shown after waitTimeToShowSurvey if shouldShowBanner() returns true and user is in 'ShowExtensionPrompt' experiment", async () => {
        const deferred = createDeferred<true>();
        shouldShowBanner = sinon.stub(ExtensionSurveyPrompt.prototype, 'shouldShowBanner');
        shouldShowBanner.callsFake(() => true);
        showSurvey = sinon.stub(ExtensionSurveyPrompt.prototype, 'showSurvey');
        showSurvey.callsFake(() => {
            deferred.resolve(true);
            return Promise.resolve();
        });
        // waitTimeToShowSurvey = 50 ms
        extensionSurveyPrompt = new ExtensionSurveyPrompt(
            appShell.object,
            browserService.object,
            instance(persistentStateFactory),
            random.object,
            experiments.object,
            appEnvironment.object,
            platformService.object,
            10,
            50
        );
        experiments
            .setup((exp) => exp.inExperiment(ShowExtensionSurveyPrompt.enabled))
            .returns(() => true)
            .verifiable(TypeMoq.Times.once());
        experiments
            .setup((exp) => exp.sendTelemetryIfInExperiment(TypeMoq.It.isAny()))
            .returns(() => undefined)
            .verifiable(TypeMoq.Times.never());
        await extensionSurveyPrompt.activate();
        assert.ok(shouldShowBanner.calledOnce);

        const doesSurveyShowUp = await Promise.race([deferred.promise, sleep(200).then(() => false)]);
        expect(doesSurveyShowUp).to.equal(true, 'Survey should appear');
        assert.ok(showSurvey.calledOnce);
        experiments.verifyAll();
    });
});
