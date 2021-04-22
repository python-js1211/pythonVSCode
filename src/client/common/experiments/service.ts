// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable, named } from 'inversify';
import { Memento } from 'vscode';
import { getExperimentationService, IExperimentationService, TargetPopulation } from 'vscode-tas-client';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { IApplicationEnvironment, IWorkspaceService } from '../application/types';
import { PVSC_EXTENSION_ID, STANDARD_OUTPUT_CHANNEL } from '../constants';
import { GLOBAL_MEMENTO, IExperimentService, IMemento, IOutputChannel } from '../types';
import { Experiments } from '../utils/localize';
import { ExperimentationTelemetry } from './telemetry';

const EXP_MEMENTO_KEY = 'VSCode.ABExp.FeatureData';

@injectable()
export class ExperimentService implements IExperimentService {
    /**
     * Experiments the user requested to opt into manually.
     */
    public _optInto: string[] = [];

    /**
     * Experiments the user requested to opt out from manually.
     */
    public _optOutFrom: string[] = [];

    private readonly enabled: boolean;

    private readonly experimentationService?: IExperimentationService;

    constructor(
        @inject(IWorkspaceService) readonly workspaceService: IWorkspaceService,
        @inject(IApplicationEnvironment) private readonly appEnvironment: IApplicationEnvironment,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly output: IOutputChannel,
    ) {
        const settings = this.workspaceService.getConfiguration('python');
        // Users can only opt in or out of experiment groups, not control groups.
        const optInto = settings.get<string[]>('experiments.optInto') || [];
        const optOutFrom = settings.get<string[]>('experiments.optOutFrom') || [];
        this._optInto = optInto.filter((exp) => !exp.endsWith('control'));
        this._optOutFrom = optOutFrom.filter((exp) => !exp.endsWith('control'));

        // If users opt out of all experiments we treat it as disabling them.
        // The `experiments.enabled` setting also needs to be explicitly disabled, default to true otherwise.
        if (this._optOutFrom.includes('All') || settings.get<boolean>('experiments.enabled') === false) {
            this.enabled = false;
        } else {
            this.enabled = true;
        }

        if (!this.enabled) {
            return;
        }

        let targetPopulation: TargetPopulation;

        if (this.appEnvironment.extensionChannel === 'insiders') {
            targetPopulation = TargetPopulation.Insiders;
        } else {
            targetPopulation = TargetPopulation.Public;
        }

        const telemetryReporter = new ExperimentationTelemetry();

        this.experimentationService = getExperimentationService(
            PVSC_EXTENSION_ID,
            this.appEnvironment.packageJson.version!,
            targetPopulation,
            telemetryReporter,
            this.globalState,
        );

        this.logExperiments();
    }

    public async activate(): Promise<void> {
        if (this.experimentationService) {
            await this.experimentationService.initializePromise;
            await this.experimentationService.initialFetch;
        }
        sendOptInOptOutTelemetry(this._optInto, this._optOutFrom, this.appEnvironment.packageJson);
    }

    public async inExperiment(experiment: string): Promise<boolean> {
        if (!this.experimentationService) {
            return false;
        }

        // Currently the service doesn't support opting in and out of experiments.
        // so we need to perform these checks manually.
        if (this._optOutFrom.includes('All') || this._optOutFrom.includes(experiment)) {
            return false;
        }

        if (this._optInto.includes('All') || this._optInto.includes(experiment)) {
            // Check if the user was already in the experiment server-side. We need to do
            // this to ensure the experiment service is ready and internal states are fully
            // synced with the experiment server.
            await this.experimentationService.isCachedFlightEnabled(experiment);
            return true;
        }

        return this.experimentationService.isCachedFlightEnabled(experiment);
    }

    public async getExperimentValue<T extends boolean | number | string>(experiment: string): Promise<T | undefined> {
        if (!this.experimentationService || this._optOutFrom.includes('All') || this._optOutFrom.includes(experiment)) {
            return undefined;
        }

        return this.experimentationService.getTreatmentVariableAsync('vscode', experiment, true);
    }

    private logExperiments() {
        if (this._optOutFrom.includes('All')) {
            // We prioritize opt out first
            this.output.appendLine(Experiments.optedOutOf().format('All'));

            // Since we are in the Opt Out all case, this means when checking for experiment we
            // short circuit and return. So, printing out additional experiment info might cause
            // confusion. So skip printing out any specific experiment details to the log.
            return;
        }
        if (this._optInto.includes('All')) {
            // Only if 'All' is not in optOut then check if it is in Opt In.
            this.output.appendLine(Experiments.inGroup().format('All'));

            // Similar to the opt out case. If user is opting into to all experiments we short
            // circuit the experiment checks. So, skip printing any additional details to the logs.
            return;
        }

        const experiments = this.globalState.get<{ features: string[] }>(EXP_MEMENTO_KEY, { features: [] });

        // Log experiments that users manually opt out, these are experiments which are added using the exp framework.
        this._optOutFrom
            .filter((exp) => exp !== 'All' && exp.toLowerCase().startsWith('python'))
            .forEach((exp) => {
                this.output.appendLine(Experiments.optedOutOf().format(exp));
            });

        // Log experiments that users manually opt into, these are experiments which are added using the exp framework.
        this._optInto
            .filter((exp) => exp !== 'All' && exp.toLowerCase().startsWith('python'))
            .forEach((exp) => {
                this.output.appendLine(Experiments.inGroup().format(exp));
            });

        // Log experiments that users are added to by the exp framework
        experiments.features.forEach((exp) => {
            // Filter out experiment groups that are not from the Python extension.
            // Filter out experiment groups that are not already opted out or opted into.
            if (
                exp.toLowerCase().startsWith('python') &&
                !this._optOutFrom.includes(exp) &&
                !this._optInto.includes(exp)
            ) {
                this.output.appendLine(Experiments.inGroup().format(exp));
            }
        });
    }
}

/**
 * Read accepted experiment settings values from the extension's package.json.
 * This function assumes that the `setting` argument is a string array that has a specific set of accepted values.
 *
 * Accessing the values is done via these keys:
 * <root> -> "contributes" -> "configuration" -> "properties" -> <setting name> -> "items" -> "enum"
 *
 * @param setting The setting we want to read the values of.
 * @param packageJson The content of `package.json`, as a JSON object.
 *
 * @returns An array containing all accepted values for the setting, or [] if there were none.
 */
function readEnumValues(setting: string, packageJson: Record<string, unknown>): string[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settingProperties = (packageJson.contributes as any).configuration.properties[setting];

    if (settingProperties) {
        return settingProperties.items.enum ?? [];
    }

    return [];
}

/**
 * Send telemetry on experiments that have been manually opted into or opted-out from.
 * The telemetry will only contain values that are present in the list of accepted values for these settings.
 *
 * @param optedIn The list of experiments opted into.
 * @param optedOut The list of experiments opted out from.
 * @param packageJson The content of `package.json`, as a JSON object.
 */
function sendOptInOptOutTelemetry(optedIn: string[], optedOut: string[], packageJson: Record<string, unknown>): void {
    const optedInEnumValues = readEnumValues('python.experiments.optInto', packageJson);
    const optedOutEnumValues = readEnumValues('python.experiments.optOutFrom', packageJson);

    const sanitizedOptedIn = optedIn.filter((exp) => optedInEnumValues.includes(exp));
    const sanitizedOptedOut = optedOut.filter((exp) => optedOutEnumValues.includes(exp));

    sendTelemetryEvent(EventName.PYTHON_EXPERIMENTS_OPT_IN_OPT_OUT_SETTINGS, undefined, {
        optedInto: sanitizedOptedIn,
        optedOutFrom: sanitizedOptedOut,
    });
}
