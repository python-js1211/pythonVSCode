// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Refer to A/B testing wiki for more details: https://en.wikipedia.org/wiki/A/B_testing

'use strict';

import { inject, injectable, named } from 'inversify';
import { parse } from 'jsonc-parser';
import * as path from 'path';
import { IHttpClient } from '../common/types';
import { isTelemetryDisabled, sendTelemetryEvent } from '../telemetry';
import { EventName } from '../telemetry/constants';
import { IApplicationEnvironment, IWorkspaceService } from './application/types';
import { EXTENSION_ROOT_DIR, STANDARD_OUTPUT_CHANNEL } from './constants';
import { traceDecorators, traceError } from './logger';
import { IFileSystem } from './platform/types';
import { ABExperiments, ICryptoUtils, IExperimentsManager, IOutputChannel, IPersistentState, IPersistentStateFactory } from './types';
import { swallowExceptions } from './utils/decorators';
import { Experiments } from './utils/localize';

const EXPIRY_DURATION_MS = 30 * 60 * 1000;
export const isDownloadedStorageValidKey = 'IS_EXPERIMENTS_STORAGE_VALID_KEY';
export const experimentStorageKey = 'EXPERIMENT_STORAGE_KEY';
export const downloadedExperimentStorageKey = 'DOWNLOADED_EXPERIMENTS_STORAGE_KEY';
/**
 * Local experiments config file. We have this to ensure that experiments are used in the first session itself,
 * as about 40% of the users never come back for the second session.
 */
const configFile = path.join(EXTENSION_ROOT_DIR, 'experiments.json');
export const configUri = 'https://raw.githubusercontent.com/microsoft/vscode-python/master/experiments.json';

/**
 * Manages and stores experiments, implements the AB testing functionality
 */
@injectable()
export class ExperimentsManager implements IExperimentsManager {
    /**
     * Keeps track of the list of experiments user is in
     */
    public userExperiments: ABExperiments = [];
    /**
     * Keeps track of the downloaded experiments in the previous sessions
     */
    private experimentStorage: IPersistentState<ABExperiments | undefined>;
    /**
     * Keeps track of the downloaded experiments in the current session, to be used in the next startup
     * Note experiments downloaded in the current session has to be distinguished
     * from the experiments download in the previous session (experimentsStorage contains that), reason being the following
     *
     * THE REASON TO WHY WE NEED TWO STATE STORES USED TO STORE EXPERIMENTS:
     * We do not intend to change experiments mid-session. To implement this, we should make sure that we do not replace
     * the experiments used in the current session by the newly downloaded experiments. That's why we have a separate
     * storage(downloadedExperimentsStorage) to store experiments downloaded in the current session.
     * Function updateExperimentStorage() makes sure these are used in the next session.
     */
    private downloadedExperimentsStorage: IPersistentState<ABExperiments | undefined>;
    /**
     * Keeps track if the storage needs updating or not.
     * Note this has to be separate from the actual storage as
     * download storages by itself should not have an Expiry (so that it can be used in the next session even when download fails in the current session)
     */
    private isDownloadedStorageValid: IPersistentState<boolean>;
    private activatedOnce: boolean = false;
    constructor(
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IHttpClient) private readonly httpClient: IHttpClient,
        @inject(ICryptoUtils) private readonly crypto: ICryptoUtils,
        @inject(IApplicationEnvironment) private readonly appEnvironment: IApplicationEnvironment,
        @inject(IOutputChannel) @named(STANDARD_OUTPUT_CHANNEL) private readonly output: IOutputChannel,
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {
        this.isDownloadedStorageValid = this.persistentStateFactory.createGlobalPersistentState<boolean>(isDownloadedStorageValidKey, false, EXPIRY_DURATION_MS);
        this.experimentStorage = this.persistentStateFactory.createGlobalPersistentState<ABExperiments | undefined>(experimentStorageKey, undefined);
        this.downloadedExperimentsStorage = this.persistentStateFactory.createGlobalPersistentState<ABExperiments | undefined>(downloadedExperimentStorageKey, undefined);
    }

    @swallowExceptions('Failed to activate experiments')
    public async activate(): Promise<void> {
        if (this.activatedOnce) {
            return;
        }
        this.activatedOnce = true;
        await this.updateExperimentStorage();
        this.populateUserExperiments();
        for (const exp of this.userExperiments || []) {
            // We need to know whether an experiment influences the logs we observe in github issues, so log the experiment group
            this.output.appendLine(Experiments.inGroup().format(exp.name));
        }
        this.initializeInBackground().ignoreErrors();
    }

    public inExperiment(experimentName: string): boolean {
        this.sendTelemetryIfInExperiment(experimentName);
        return this.userExperiments.find(exp => exp.name === experimentName) ? true : false;
    }

    /**
     * Populates list of experiments user is in
     */
    @traceDecorators.error('Failed to populate user experiments')
    public populateUserExperiments(): void {
        if (Array.isArray(this.experimentStorage.value)) {
            for (const experiment of this.experimentStorage.value) {
                try {
                    if (this.isUserInRange(experiment.min, experiment.max, experiment.salt)) {
                        this.userExperiments.push(experiment);
                    }
                } catch (ex) {
                    traceError(`Failed to populate experiment list for experiment '${experiment.name}'`, ex);
                }
            }
        }
    }

    public sendTelemetryIfInExperiment(experimentName: string): void {
        if (this.userExperiments.find(exp => exp.name === experimentName)) {
            sendTelemetryEvent(EventName.PYTHON_EXPERIMENTS, undefined, { expName: experimentName });
        }
    }

    /**
     * Downloads experiments and updates storage given following conditions are met
     * * Telemetry is not disabled
     * * Previously downloaded experiments are no longer valid
     */
    @traceDecorators.error('Failed to initialize experiments')
    public async initializeInBackground() {
        if (isTelemetryDisabled(this.workspaceService) || this.isDownloadedStorageValid.value) {
            return;
        }
        const downloadedExperiments = await this.httpClient.getJSON<ABExperiments>(configUri, false);
        if (!this.areExperimentsValid(downloadedExperiments)) {
            return;
        }
        await this.downloadedExperimentsStorage.updateValue(downloadedExperiments);
        await this.isDownloadedStorageValid.updateValue(true);
    }

    /**
     * Checks if user falls between the range of the experiment
     * @param min The lower limit
     * @param max The upper limit
     * @param salt The experiment salt value
     */
    public isUserInRange(min: number, max: number, salt: string): boolean {
        if (typeof (this.appEnvironment.machineId) !== 'string') {
            throw new Error('Machine ID should be a string');
        }
        const hash = this.crypto.createHash(`${this.appEnvironment.machineId}+${salt}`, 'hex', 'number');
        return hash % 100 >= min && hash % 100 < max;
    }

    /**
     * Updates experiment storage using local data if available.
     * Local data could be:
     * * Experiments downloaded in the last session
     *   - The function makes sure these are used in the current session
     * * A default experiments file shipped with the extension
     *   - Note this file is only used the first time the extension loads, and then is deleted.
     *   - We have this local file to ensure that experiments are used in the first session itself,
     *     as about 40% of the users never come back for the second session.
     */
    @swallowExceptions('Failed to update experiment storage')
    public async updateExperimentStorage(): Promise<void> {
        // Step 1. Update experiment storage using downloaded experiments in the last session if any
        if (Array.isArray(this.downloadedExperimentsStorage.value)) {
            await this.experimentStorage.updateValue(this.downloadedExperimentsStorage.value);
            await this.downloadedExperimentsStorage.updateValue(undefined);
            return;
        }

        // Step 2. Update experiment storage using local experiments file if available
        if (await this.fs.fileExists(configFile)) {
            const content = await this.fs.readFile(configFile);
            try {
                const experiments = parse(content, [], { allowTrailingComma: true, disallowComments: false });
                if (!this.areExperimentsValid(experiments)) {
                    throw new Error('Parsed experiments are not valid');
                }
                await this.experimentStorage.updateValue(experiments);
            } catch (ex) {
                traceError('Failed to parse experiments configuration file to update storage', ex);
                return;
            }
            await this.fs.deleteFile(configFile);
        }
    }

    /**
     * Checks that experiments are not invalid or incomplete
     * @param experiments Local or downloaded experiments
     * @returns `true` if type of experiments equals `ABExperiments` type, `false` otherwise
     */
    public areExperimentsValid(experiments: ABExperiments): boolean {
        if (!Array.isArray(experiments)) {
            traceError('Experiments are not of array type');
            return false;
        }
        for (const exp of experiments) {
            if (exp.name === undefined || exp.salt === undefined || exp.min === undefined || exp.max === undefined) {
                traceError('Experiments are missing fields from ABExperiments type');
                return false;
            }
        }
        return true;
    }
}
