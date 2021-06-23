/* eslint-disable no-new */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import * as tasClient from 'vscode-tas-client';
import { ApplicationEnvironment } from '../../../client/common/application/applicationEnvironment';
import { IApplicationEnvironment, IWorkspaceService } from '../../../client/common/application/types';
import { WorkspaceService } from '../../../client/common/application/workspace';
import { Channel } from '../../../client/common/constants';
import { ExperimentService } from '../../../client/common/experiments/service';
import { Experiments } from '../../../client/common/utils/localize';
import * as Telemetry from '../../../client/telemetry';
import { EventName } from '../../../client/telemetry/constants';
import { PVSC_EXTENSION_ID_FOR_TESTS } from '../../constants';
import { MockOutputChannel } from '../../mockClasses';
import { MockMemento } from '../../mocks/mementos';

suite('Experimentation service', () => {
    const extensionVersion = '1.2.3';

    let workspaceService: IWorkspaceService;
    let appEnvironment: IApplicationEnvironment;
    let globalMemento: MockMemento;
    let outputChannel: MockOutputChannel;

    setup(() => {
        appEnvironment = mock(ApplicationEnvironment);
        workspaceService = mock(WorkspaceService);
        globalMemento = new MockMemento();
        outputChannel = new MockOutputChannel('');
    });

    teardown(() => {
        sinon.restore();
        Telemetry._resetSharedProperties();
    });

    function configureSettings(enabled: boolean, optInto: string[], optOutFrom: string[]) {
        when(workspaceService.getConfiguration('python')).thenReturn({
            get: (key: string) => {
                if (key === 'experiments.enabled') {
                    return enabled;
                }
                if (key === 'experiments.optInto') {
                    return optInto;
                }
                if (key === 'experiments.optOutFrom') {
                    return optOutFrom;
                }
                return undefined;
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    function configureApplicationEnvironment(channel: Channel, version: string, contributes?: Record<string, unknown>) {
        when(appEnvironment.extensionChannel).thenReturn(channel);
        when(appEnvironment.extensionName).thenReturn(PVSC_EXTENSION_ID_FOR_TESTS);
        when(appEnvironment.packageJson).thenReturn({ version, contributes });
    }

    suite('Initialization', () => {
        test('Users with a release version of the extension should be in the Public target population', () => {
            const getExperimentationServiceStub = sinon.stub(tasClient, 'getExperimentationService');

            configureSettings(true, [], []);
            configureApplicationEnvironment('stable', extensionVersion);

            // eslint-disable-next-line no-new
            new ExperimentService(instance(workspaceService), instance(appEnvironment), globalMemento, outputChannel);

            sinon.assert.calledWithExactly(
                getExperimentationServiceStub,
                PVSC_EXTENSION_ID_FOR_TESTS,
                extensionVersion,
                tasClient.TargetPopulation.Public,
                sinon.match.any,
                globalMemento,
            );
        });

        test('Users with an Insiders version of the extension should be the Insiders target population', () => {
            const getExperimentationServiceStub = sinon.stub(tasClient, 'getExperimentationService');

            configureSettings(true, [], []);
            configureApplicationEnvironment('insiders', extensionVersion);

            // eslint-disable-next-line no-new
            new ExperimentService(instance(workspaceService), instance(appEnvironment), globalMemento, outputChannel);

            sinon.assert.calledWithExactly(
                getExperimentationServiceStub,
                PVSC_EXTENSION_ID_FOR_TESTS,
                extensionVersion,
                tasClient.TargetPopulation.Insiders,
                sinon.match.any,
                globalMemento,
            );
        });

        test('Users can only opt into experiment groups', () => {
            sinon.stub(tasClient, 'getExperimentationService');

            configureSettings(true, ['Foo - experiment', 'Bar - control'], []);
            configureApplicationEnvironment('stable', extensionVersion);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );

            assert.deepEqual(experimentService._optInto, ['Foo - experiment']);
        });

        test('Users can only opt out of experiment groups', () => {
            sinon.stub(tasClient, 'getExperimentationService');
            configureSettings(true, [], ['Foo - experiment', 'Bar - control']);
            configureApplicationEnvironment('stable', extensionVersion);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );

            assert.deepEqual(experimentService._optOutFrom, ['Foo - experiment']);
        });

        test('Experiment data in Memento storage should be logged if it starts with "python"', () => {
            const experiments = ['ExperimentOne', 'pythonExperiment'];
            globalMemento = mock(MockMemento);
            configureSettings(true, [], []);
            configureApplicationEnvironment('stable', extensionVersion);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            when(globalMemento.get(anything(), anything())).thenReturn({ features: experiments } as any);

            new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                instance(globalMemento),
                outputChannel,
            );
            const output = `${Experiments.inGroup().format('pythonExperiment')}\n`;

            assert.strictEqual(outputChannel.output, output);
        });
    });

    suite('In-experiment check', () => {
        const experiment = 'Test Experiment - experiment';
        let telemetryEvents: { eventName: string; properties: Record<string, unknown> }[] = [];
        let getTreatmentVariableAsyncStub: sinon.SinonStub;
        let sendTelemetryEventStub: sinon.SinonStub;

        setup(() => {
            sendTelemetryEventStub = sinon
                .stub(Telemetry, 'sendTelemetryEvent')
                .callsFake((eventName: string, _, properties: Record<string, unknown>) => {
                    const telemetry = { eventName, properties };
                    telemetryEvents.push(telemetry);
                });

            getTreatmentVariableAsyncStub = sinon.stub().returns(Promise.resolve(true));
            sinon.stub(tasClient, 'getExperimentationService').returns(({
                getTreatmentVariableAsync: getTreatmentVariableAsyncStub,
            } as unknown) as tasClient.IExperimentationService);

            configureApplicationEnvironment('stable', extensionVersion);
        });

        teardown(() => {
            telemetryEvents = [];
        });

        test('If the opt-in and opt-out arrays are empty, return the value from the experimentation framework for a given experiment', async () => {
            configureSettings(true, [], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isTrue(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.calledOnce(getTreatmentVariableAsyncStub);
        });

        test('If the experiment setting is disabled, inExperiment should return false', async () => {
            configureSettings(false, [], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.notCalled(getTreatmentVariableAsyncStub);
        });

        test('If the opt-in setting contains "All", inExperiment should return true', async () => {
            configureSettings(true, ['All'], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isTrue(result);
            assert.strictEqual(telemetryEvents.length, 0);
        });

        test('If the opt-in setting contains `All`, inExperiment should check the value cached by the experiment service', async () => {
            configureSettings(true, ['All'], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isTrue(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.calledOnce(getTreatmentVariableAsyncStub);
        });

        test('If the opt-in setting contains `All` and the experiment setting is disabled, inExperiment should return false', async () => {
            configureSettings(false, ['All'], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.notCalled(getTreatmentVariableAsyncStub);
        });

        test('If the opt-in setting contains the experiment name, inExperiment should return true', async () => {
            configureSettings(true, [experiment], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isTrue(result);
            assert.strictEqual(telemetryEvents.length, 0);
            sinon.assert.calledOnce(getTreatmentVariableAsyncStub);
        });

        test('If the opt-out setting contains "All", inExperiment should return false', async () => {
            configureSettings(true, [], ['All']);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.notCalled(getTreatmentVariableAsyncStub);
        });

        test('If the opt-out setting contains "All" and the experiment setting is enabled, inExperiment should return false', async () => {
            configureSettings(true, [], ['All']);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.notCalled(getTreatmentVariableAsyncStub);
        });

        test('If the opt-out setting contains the experiment name, inExperiment should return false', async () => {
            configureSettings(true, [], [experiment]);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isFalse(result);
            assert.strictEqual(telemetryEvents.length, 0);
            sinon.assert.notCalled(getTreatmentVariableAsyncStub);
        });
    });

    suite('In-experiment-sync check', () => {
        const experiment = 'Test Experiment - experiment';
        let telemetryEvents: { eventName: string; properties: Record<string, unknown> }[] = [];
        let getTreatmentVariable: sinon.SinonStub;
        let sendTelemetryEventStub: sinon.SinonStub;

        setup(() => {
            sendTelemetryEventStub = sinon
                .stub(Telemetry, 'sendTelemetryEvent')
                .callsFake((eventName: string, _, properties: Record<string, unknown>) => {
                    const telemetry = { eventName, properties };
                    telemetryEvents.push(telemetry);
                });

            getTreatmentVariable = sinon.stub().returns(Promise.resolve(true));
            sinon.stub(tasClient, 'getExperimentationService').returns(({
                getTreatmentVariable,
            } as unknown) as tasClient.IExperimentationService);

            configureApplicationEnvironment('stable', extensionVersion);
        });

        teardown(() => {
            telemetryEvents = [];
        });

        test('If the opt-in and opt-out arrays are empty, return the value from the experimentation framework for a given experiment', async () => {
            configureSettings(true, [], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isTrue(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.calledOnce(getTreatmentVariable);
        });

        test('If the experiment setting is disabled, inExperiment should return false', async () => {
            configureSettings(false, [], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.notCalled(getTreatmentVariable);
        });

        test('If the opt-in setting contains "All", inExperiment should return true', async () => {
            configureSettings(true, ['All'], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isTrue(result);
            assert.strictEqual(telemetryEvents.length, 0);
        });

        test('If the opt-in setting contains `All`, inExperiment should check the value cached by the experiment service', async () => {
            configureSettings(true, ['All'], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isTrue(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.calledOnce(getTreatmentVariable);
        });

        test('If the opt-in setting contains `All` and the experiment setting is disabled, inExperiment should return false', async () => {
            configureSettings(false, ['All'], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.notCalled(getTreatmentVariable);
        });

        test('If the opt-in setting contains the experiment name, inExperiment should return true', async () => {
            configureSettings(true, [experiment], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isTrue(result);
            assert.strictEqual(telemetryEvents.length, 0);
            sinon.assert.calledOnce(getTreatmentVariable);
        });

        test('If the opt-out setting contains "All", inExperiment should return false', async () => {
            configureSettings(true, [], ['All']);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.notCalled(getTreatmentVariable);
        });

        test('If the opt-out setting contains "All" and the experiment setting is enabled, inExperiment should return false', async () => {
            configureSettings(true, [], ['All']);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
            sinon.assert.notCalled(getTreatmentVariable);
        });

        test('If the opt-out setting contains the experiment name, inExperiment should return false', async () => {
            configureSettings(true, [], [experiment]);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = experimentService.inExperimentSync(experiment);

            assert.isFalse(result);
            assert.strictEqual(telemetryEvents.length, 0);
            sinon.assert.notCalled(getTreatmentVariable);
        });
    });

    suite('Experiment value retrieval', () => {
        const experiment = 'Test Experiment - experiment';
        let getTreatmentVariableAsyncStub: sinon.SinonStub;

        setup(() => {
            getTreatmentVariableAsyncStub = sinon.stub().returns(Promise.resolve('value'));
            sinon.stub(tasClient, 'getExperimentationService').returns(({
                getTreatmentVariableAsync: getTreatmentVariableAsyncStub,
            } as unknown) as tasClient.IExperimentationService);

            configureApplicationEnvironment('stable', extensionVersion);
        });

        test('If the service is enabled and the opt-out array is empty,return the value from the experimentation framework for a given experiment', async () => {
            configureSettings(true, [], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.getExperimentValue(experiment);

            assert.strictEqual(result, 'value');
            sinon.assert.calledOnce(getTreatmentVariableAsyncStub);
        });

        test('If the experiment setting is disabled, getExperimentValue should return undefined', async () => {
            configureSettings(false, [], []);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.getExperimentValue(experiment);

            assert.isUndefined(result);
            sinon.assert.notCalled(getTreatmentVariableAsyncStub);
        });

        test('If the opt-out setting contains "All", getExperimentValue should return undefined', async () => {
            configureSettings(true, [], ['All']);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.getExperimentValue(experiment);

            assert.isUndefined(result);
            sinon.assert.notCalled(getTreatmentVariableAsyncStub);
        });

        test('If the opt-out setting contains the experiment name, igetExperimentValue should return undefined', async () => {
            configureSettings(true, [], [experiment]);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );
            const result = await experimentService.getExperimentValue(experiment);

            assert.isUndefined(result);
            sinon.assert.notCalled(getTreatmentVariableAsyncStub);
        });
    });

    suite('Opt-in/out telemetry', () => {
        let telemetryEvents: { eventName: string; properties: Record<string, unknown> }[] = [];
        let sendTelemetryEventStub: sinon.SinonStub;

        setup(() => {
            sendTelemetryEventStub = sinon
                .stub(Telemetry, 'sendTelemetryEvent')
                .callsFake((eventName: string, _, properties: Record<string, unknown>) => {
                    const telemetry = { eventName, properties };
                    telemetryEvents.push(telemetry);
                });

            configureApplicationEnvironment('stable', extensionVersion);
        });

        teardown(() => {
            telemetryEvents = [];
        });

        test('Telemetry should be sent when activating the ExperimentService instance', async () => {
            configureSettings(true, [], []);
            configureApplicationEnvironment('stable', extensionVersion, { configuration: { properties: {} } });

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );

            await experimentService.activate();

            assert.strictEqual(telemetryEvents.length, 1);
            assert.strictEqual(telemetryEvents[0].eventName, EventName.PYTHON_EXPERIMENTS_OPT_IN_OPT_OUT_SETTINGS);
            sinon.assert.calledOnce(sendTelemetryEventStub);
        });

        test('The telemetry event properties should only be populated with valid experiment values', async () => {
            const contributes = {
                configuration: {
                    properties: {
                        'python.experiments.optInto': {
                            items: {
                                enum: ['foo', 'bar'],
                            },
                        },
                        'python.experiments.optOutFrom': {
                            items: {
                                enum: ['foo', 'bar'],
                            },
                        },
                    },
                },
            };
            configureSettings(true, ['foo', 'baz'], ['bar', 'invalid']);
            configureApplicationEnvironment('stable', extensionVersion, contributes);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );

            await experimentService.activate();

            const { properties } = telemetryEvents[0];
            assert.deepStrictEqual(properties, { optedInto: ['foo'], optedOutFrom: ['bar'] });
        });

        test('Set telemetry properties to empty arrays if no experiments have been opted into or out from', async () => {
            const contributes = {
                configuration: {
                    properties: {
                        'python.experiments.optInto': {
                            items: {
                                enum: ['foo', 'bar'],
                            },
                        },
                        'python.experiments.optOutFrom': {
                            items: {
                                enum: ['foo', 'bar'],
                            },
                        },
                    },
                },
            };
            configureSettings(true, [], []);
            configureApplicationEnvironment('stable', extensionVersion, contributes);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );

            await experimentService.activate();

            const { properties } = telemetryEvents[0];
            assert.deepStrictEqual(properties, { optedInto: [], optedOutFrom: [] });
        });

        test('If the entered value for a setting contains "All", do not expand it to be a list of all experiments, and pass it as-is', async () => {
            const contributes = {
                configuration: {
                    properties: {
                        'python.experiments.optInto': {
                            items: {
                                enum: ['foo', 'bar', 'All'],
                            },
                        },
                        'python.experiments.optOutFrom': {
                            items: {
                                enum: ['foo', 'bar', 'All'],
                            },
                        },
                    },
                },
            };
            configureSettings(true, ['All'], ['All']);
            configureApplicationEnvironment('stable', extensionVersion, contributes);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );

            await experimentService.activate();

            const { properties } = telemetryEvents[0];
            assert.deepStrictEqual(properties, { optedInto: ['All'], optedOutFrom: ['All'] });
        });

        // This is an unlikely scenario.
        test('If a setting is not in package.json, set the corresponding telemetry property to an empty array', async () => {
            const contributes = {
                configuration: {
                    properties: {},
                },
            };
            configureSettings(true, ['something'], ['another']);
            configureApplicationEnvironment('stable', extensionVersion, contributes);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );

            await experimentService.activate();

            const { properties } = telemetryEvents[0];
            assert.deepStrictEqual(properties, { optedInto: [], optedOutFrom: [] });
        });

        // This is also an unlikely scenario.
        test('If a setting does not have an enum of valid values, set the corresponding telemetry property to an empty array', async () => {
            const contributes = {
                configuration: {
                    properties: {
                        'python.experiments.optInto': {
                            items: {},
                        },
                        'python.experiments.optOutFrom': {
                            items: {
                                enum: ['foo', 'bar', 'All'],
                            },
                        },
                    },
                },
            };
            configureSettings(true, ['something'], []);
            configureApplicationEnvironment('stable', extensionVersion, contributes);

            const experimentService = new ExperimentService(
                instance(workspaceService),
                instance(appEnvironment),
                globalMemento,
                outputChannel,
            );

            await experimentService.activate();

            const { properties } = telemetryEvents[0];
            assert.deepStrictEqual(properties, { optedInto: [], optedOutFrom: [] });
        });
    });
});
