import { inject, injectable } from 'inversify';
import * as path from 'path';
import { ConfigurationTarget, Uri, window } from 'vscode';
import { inDiscoveryExperiment } from '../../common/experiments/helpers';
import { traceError } from '../../common/logger';
import { IPythonExecutionFactory } from '../../common/process/types';
import { IExperimentService } from '../../common/types';
import { StopWatch } from '../../common/utils/stopWatch';
import { InterpreterInformation } from '../../pythonEnvironments/info';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { PythonInterpreterTelemetry } from '../../telemetry/types';
import { IComponentAdapter } from '../contracts';
import { IPythonPathUpdaterServiceFactory, IPythonPathUpdaterServiceManager } from './types';

@injectable()
export class PythonPathUpdaterService implements IPythonPathUpdaterServiceManager {
    constructor(
        @inject(IPythonExecutionFactory)
        private readonly pythonPathSettingsUpdaterFactory: IPythonPathUpdaterServiceFactory,
        @inject(IPythonExecutionFactory) private readonly executionFactory: IPythonExecutionFactory,
        @inject(IComponentAdapter) private readonly pyenvs: IComponentAdapter,
        @inject(IExperimentService) private readonly experimentService: IExperimentService,
    ) {}

    public async updatePythonPath(
        pythonPath: string | undefined,
        configTarget: ConfigurationTarget,
        trigger: 'ui' | 'shebang' | 'load',
        wkspace?: Uri,
    ): Promise<void> {
        const stopWatch = new StopWatch();
        const pythonPathUpdater = this.getPythonUpdaterService(configTarget, wkspace);
        let failed = false;
        try {
            await pythonPathUpdater.updatePythonPath(pythonPath ? path.normalize(pythonPath) : undefined);
        } catch (reason) {
            failed = true;

            const message = reason && typeof reason.message === 'string' ? (reason.message as string) : '';
            window.showErrorMessage(`Failed to set 'pythonPath'. Error: ${message}`);
            traceError(reason);
        }
        // do not wait for this to complete
        this.sendTelemetry(stopWatch.elapsedTime, failed, trigger, pythonPath).catch((ex) =>
            traceError('Python Extension: sendTelemetry', ex),
        );
    }

    private async sendTelemetry(
        duration: number,
        failed: boolean,
        trigger: 'ui' | 'shebang' | 'load',
        pythonPath: string | undefined,
    ) {
        const telemetryProperties: PythonInterpreterTelemetry = {
            failed,
            trigger,
        };
        if (!failed && pythonPath) {
            if (await inDiscoveryExperiment(this.experimentService)) {
                const interpreterInfo = await this.pyenvs.getInterpreterInformation(pythonPath);
                if (interpreterInfo) {
                    telemetryProperties.pythonVersion = interpreterInfo.version?.raw;
                }
            } else {
                const processService = await this.executionFactory.create({ pythonPath });
                const info = await processService
                    .getInterpreterInformation()
                    .catch<InterpreterInformation | undefined>(() => undefined);

                if (info && info.version) {
                    telemetryProperties.pythonVersion = info.version.raw;
                }
            }
        }

        sendTelemetryEvent(EventName.PYTHON_INTERPRETER, duration, telemetryProperties);
    }

    private getPythonUpdaterService(configTarget: ConfigurationTarget, wkspace?: Uri) {
        switch (configTarget) {
            case ConfigurationTarget.Global: {
                return this.pythonPathSettingsUpdaterFactory.getGlobalPythonPathConfigurationService();
            }
            case ConfigurationTarget.Workspace: {
                if (!wkspace) {
                    throw new Error('Workspace Uri not defined');
                }

                return this.pythonPathSettingsUpdaterFactory.getWorkspacePythonPathConfigurationService(wkspace!);
            }
            default: {
                if (!wkspace) {
                    throw new Error('Workspace Uri not defined');
                }

                return this.pythonPathSettingsUpdaterFactory.getWorkspaceFolderPythonPathConfigurationService(wkspace!);
            }
        }
    }
}
