// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { injectable } from 'inversify';
import { DebugConfigurationPrompts, localize } from '../../../../common/utils/localize';
import { InputStep, MultiStepInput } from '../../../../common/utils/multiStepInput';
import { sendTelemetryEvent } from '../../../../telemetry';
import { DEBUGGER_CONFIGURATION_PROMPTS } from '../../../../telemetry/constants';
import { DebuggerTypeName } from '../../../constants';
import { AttachRequestArguments } from '../../../types';
import { DebugConfigurationState, DebugConfigurationType, IDebugConfigurationProvider } from '../../types';

const defaultHost = 'localhost';
const defaultPort = 5678;

@injectable()
export class RemoteAttachDebugConfigurationProvider implements IDebugConfigurationProvider {
    public async buildConfiguration(input: MultiStepInput<DebugConfigurationState>, state: DebugConfigurationState): Promise<InputStep<DebugConfigurationState> | void> {
        const config: Partial<AttachRequestArguments> = {
            name: localize('python.snippet.launch.attach.label', 'Python: Attach')(),
            type: DebuggerTypeName,
            request: 'attach',
            port: defaultPort,
            host: defaultHost
        };

        config.host = await input.showInputBox({
            title: DebugConfigurationPrompts.attachRemoteHostTitle(),
            step: 1,
            totalSteps: 2,
            value: config.host || defaultHost,
            prompt: DebugConfigurationPrompts.attachRemoteHostPrompt(),
            validate: value => Promise.resolve((value && value.trim().length > 0) ? undefined : DebugConfigurationPrompts.attachRemoteHostValidationError())
        });
        if (!config.host) {
            config.host = defaultHost;
        }

        sendTelemetryEvent(DEBUGGER_CONFIGURATION_PROMPTS, undefined, { configurationType: DebugConfigurationType.remoteAttach, manuallyEnteredAValue: config.host !== defaultHost });
        Object.assign(state.config, config);
        return _ => this.configurePort(input, state.config);
    }
    protected async configurePort(input: MultiStepInput<DebugConfigurationState>, config: Partial<AttachRequestArguments>) {
        const port = await input.showInputBox({
            title: DebugConfigurationPrompts.attachRemotePortTitle(),
            step: 2,
            totalSteps: 2,
            value: (config.port || defaultPort).toString(),
            prompt: DebugConfigurationPrompts.attachRemotePortPrompt(),
            validate: value => Promise.resolve((value && /^\d+$/.test(value.trim())) ? undefined : DebugConfigurationPrompts.attachRemotePortValidationError())
        });
        if (port && /^\d+$/.test(port.trim())) {
            config.port = parseInt(port, 10);
        }
        if (!config.port) {
            config.port = defaultPort;
        }
        sendTelemetryEvent(DEBUGGER_CONFIGURATION_PROMPTS, undefined, { configurationType: DebugConfigurationType.remoteAttach, manuallyEnteredAValue: config.port !== defaultPort });
    }
}
