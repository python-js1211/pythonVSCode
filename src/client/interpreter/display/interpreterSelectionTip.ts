// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../activation/types';
import { IApplicationShell } from '../../common/application/types';
import { SurveyAndInterpreterTipNotification } from '../../common/experiments/groups';
import { IBrowserService, IExperimentService, IPersistentState, IPersistentStateFactory } from '../../common/types';
import { swallowExceptions } from '../../common/utils/decorators';
import { Common } from '../../common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';

enum NotificationType {
    Tip,
    Survey,
    NoPrompt
}

@injectable()
export class InterpreterSelectionTip implements IExtensionSingleActivationService {
    private readonly storage: IPersistentState<boolean>;
    private notificationType: NotificationType;
    private notificationContent: string | undefined;

    constructor(
        @inject(IApplicationShell) private readonly shell: IApplicationShell,
        @inject(IPersistentStateFactory) factory: IPersistentStateFactory,
        @inject(IExperimentService) private readonly experiments: IExperimentService,
        @inject(IBrowserService) private browserService: IBrowserService
    ) {
        this.storage = factory.createGlobalPersistentState('InterpreterSelectionTip', false);
        this.notificationType = NotificationType.NoPrompt;
    }

    public async activate(): Promise<void> {
        // Only show the prompt if we have never shown it before. True here, means we have
        // shown the prompt before.
        if (this.storage.value) {
            return;
        }

        if (await this.experiments.inExperiment(SurveyAndInterpreterTipNotification.surveyExperiment)) {
            this.notificationType = NotificationType.Survey;
            this.notificationContent = await this.experiments.getExperimentValue(
                SurveyAndInterpreterTipNotification.surveyExperiment
            );
        } else if (await this.experiments.inExperiment(SurveyAndInterpreterTipNotification.tipExperiment)) {
            this.notificationType = NotificationType.Tip;
            this.notificationContent = await this.experiments.getExperimentValue(
                SurveyAndInterpreterTipNotification.tipExperiment
            );
        }

        this.showTip().ignoreErrors();

        // We will disable this prompt for all users even if they are not
        // in any experiment. The idea is that people should get either the
        // tip or survey or nothing, on first load. If we are here then that
        // means we are done with this prompt (even if it was not shown).
        await this.storage.updateValue(true);
    }
    @swallowExceptions('Failed to display tip')
    private async showTip() {
        if (this.notificationType === NotificationType.Tip) {
            await this.shell.showInformationMessage(this.notificationContent!, Common.gotIt());
            sendTelemetryEvent(EventName.ACTIVATION_TIP_PROMPT, undefined);
        } else if (this.notificationType === NotificationType.Survey) {
            const selection = await this.shell.showInformationMessage(
                this.notificationContent!,
                Common.bannerLabelYes(),
                Common.bannerLabelNo()
            );

            if (selection === Common.bannerLabelYes()) {
                sendTelemetryEvent(EventName.ACTIVATION_SURVEY_PROMPT, undefined);
                this.browserService.launch('https://aka.ms/mailingListSurvey');
            }
        }
    }
}
