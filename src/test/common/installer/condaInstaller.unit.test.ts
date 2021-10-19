// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as assert from 'assert';
import { instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { PythonSettings } from '../../../client/common/configSettings';
import { ConfigurationService } from '../../../client/common/configuration/service';
import { DiscoveryVariants } from '../../../client/common/experiments/groups';
import { CondaInstaller } from '../../../client/common/installer/condaInstaller';
import { InterpreterUri } from '../../../client/common/installer/types';
import {
    ExecutionInfo,
    IConfigurationService,
    IExperimentService,
    IPythonSettings,
} from '../../../client/common/types';
import { ICondaService, IComponentAdapter } from '../../../client/interpreter/contracts';
import { ServiceContainer } from '../../../client/ioc/container';
import { IServiceContainer } from '../../../client/ioc/types';
import { CondaEnvironmentInfo } from '../../../client/pythonEnvironments/common/environmentManagers/conda';
import { CondaService } from '../../../client/pythonEnvironments/discovery/locators/services/condaService';

suite('Common - Conda Installer', () => {
    let installer: CondaInstallerTest;
    let serviceContainer: IServiceContainer;
    let condaService: ICondaService;
    let condaLocatorService: IComponentAdapter;
    let configService: IConfigurationService;
    let experimentService: IExperimentService;
    class CondaInstallerTest extends CondaInstaller {
        public async getExecutionInfo(moduleName: string, resource?: InterpreterUri): Promise<ExecutionInfo> {
            return super.getExecutionInfo(moduleName, resource);
        }
    }
    setup(() => {
        serviceContainer = mock(ServiceContainer);
        condaService = mock(CondaService);
        experimentService = mock<IExperimentService>();
        condaLocatorService = mock<IComponentAdapter>();
        when(experimentService.inExperiment(DiscoveryVariants.discoverWithFileWatching)).thenResolve(false);
        configService = mock(ConfigurationService);
        when(serviceContainer.get<ICondaService>(ICondaService)).thenReturn(instance(condaService));
        when(serviceContainer.get<IComponentAdapter>(IComponentAdapter)).thenReturn(instance(condaLocatorService));
        when(serviceContainer.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
        when(serviceContainer.get<IExperimentService>(IExperimentService)).thenReturn(instance(experimentService));
        installer = new CondaInstallerTest(instance(serviceContainer));
    });
    test('Name and priority', async () => {
        assert.equal(installer.displayName, 'Conda');
        assert.equal(installer.name, 'Conda');
        assert.equal(installer.priority, 0);
    });
    test('Installer is not supported when conda is available variable is set to false', async () => {
        const uri = Uri.file(__filename);
        installer._isCondaAvailable = false;

        const supported = await installer.isSupported(uri);

        assert.equal(supported, false);
    });
    test('Installer is not supported when conda is not available', async () => {
        const uri = Uri.file(__filename);
        when(condaService.isCondaAvailable()).thenResolve(false);

        const supported = await installer.isSupported(uri);

        assert.equal(supported, false);
    });
    test('Installer is not supported when current env is not a conda env', async () => {
        const uri = Uri.file(__filename);
        const settings: IPythonSettings = mock(PythonSettings);
        const pythonPath = 'my py path';

        when(settings.pythonPath).thenReturn(pythonPath);
        when(condaService.isCondaAvailable()).thenResolve(true);
        when(configService.getSettings(uri)).thenReturn(instance(settings));
        when(condaLocatorService.isCondaEnvironment(pythonPath)).thenResolve(false);

        const supported = await installer.isSupported(uri);

        assert.equal(supported, false);
    });
    test('Installer is supported when current env is a conda env', async () => {
        const uri = Uri.file(__filename);
        const settings: IPythonSettings = mock(PythonSettings);
        const pythonPath = 'my py path';

        when(settings.pythonPath).thenReturn(pythonPath);
        when(condaService.isCondaAvailable()).thenResolve(true);
        when(configService.getSettings(uri)).thenReturn(instance(settings));
        when(condaLocatorService.isCondaEnvironment(pythonPath)).thenResolve(true);

        const supported = await installer.isSupported(uri);

        assert.equal(supported, true);
    });
    test('Include name of environment', async () => {
        const uri = Uri.file(__filename);
        const settings: IPythonSettings = mock(PythonSettings);
        const pythonPath = 'my py path';
        const condaPath = 'some Conda Path';
        const condaEnv: CondaEnvironmentInfo = {
            name: 'Hello',
            path: 'Some Path',
        };

        when(configService.getSettings(uri)).thenReturn(instance(settings));
        when(settings.pythonPath).thenReturn(pythonPath);
        when(condaService.getCondaFile()).thenResolve(condaPath);
        when(condaLocatorService.getCondaEnvironment(pythonPath)).thenResolve(condaEnv);

        const execInfo = await installer.getExecutionInfo('abc', uri);

        assert.deepEqual(execInfo, { args: ['install', '--name', condaEnv.name, 'abc', '-y'], execPath: condaPath });
    });
    test('Include path of environment', async () => {
        const uri = Uri.file(__filename);
        const settings: IPythonSettings = mock(PythonSettings);
        const pythonPath = 'my py path';
        const condaPath = 'some Conda Path';
        const condaEnv: CondaEnvironmentInfo = {
            name: '',
            path: 'Some Path',
        };

        when(configService.getSettings(uri)).thenReturn(instance(settings));
        when(settings.pythonPath).thenReturn(pythonPath);
        when(condaService.getCondaFile()).thenResolve(condaPath);
        when(condaLocatorService.getCondaEnvironment(pythonPath)).thenResolve(condaEnv);

        const execInfo = await installer.getExecutionInfo('abc', uri);

        assert.deepEqual(execInfo, {
            args: ['install', '--prefix', condaEnv.path.fileToCommandArgument(), 'abc', '-y'],
            execPath: condaPath,
        });
    });
});
