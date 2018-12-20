// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { Debug, localize } from '../../../../common/utils/localize';
import { MultiStepInput } from '../../../../common/utils/multiStepInput';
import { sendTelemetryEvent } from '../../../../telemetry';
import { DEBUGGER_CONFIGURATION_PROMPTS } from '../../../../telemetry/constants';
import { DebuggerTypeName } from '../../../constants';
import { LaunchRequestArguments } from '../../../types';
import { DebugConfigurationState, DebugConfigurationType, IDebugConfigurationProvider } from '../../types';

@injectable()
export class ModuleLaunchDebugConfigurationProvider implements IDebugConfigurationProvider {
    public async buildConfiguration(input: MultiStepInput<DebugConfigurationState>, state: DebugConfigurationState) {
        let manuallyEnteredAValue: boolean | undefined;
        const config: Partial<LaunchRequestArguments> = {
            name: localize('python.snippet.launch.module.label', 'Python: Module')(),
            type: DebuggerTypeName,
            request: 'launch',
            module: 'enter-your-module-name-here'
        };
        const selectedModule = await input.showInputBox({
            title: Debug.moduleEnterModuleTitle(),
            value: config.module || 'enter-your-module-name-here',
            prompt: Debug.moduleEnterModulePrompt(),
            validate: value => Promise.resolve((value && value.trim().length > 0) ? undefined : Debug.moduleEnterModuleInvalidNameError())
        });
        if (selectedModule) {
            manuallyEnteredAValue = true;
            config.module = selectedModule;
        }

        sendTelemetryEvent(DEBUGGER_CONFIGURATION_PROMPTS, undefined, { configurationType: DebugConfigurationType.launchModule, manuallyEnteredAValue });
        Object.assign(state.config, config);
    }
}
