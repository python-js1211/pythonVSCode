// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';

import untildify = require('untildify');
import { WorkspaceConfiguration } from 'vscode';
import { LanguageServerType } from '../../../client/activation/types';
import { PythonSettings } from '../../../client/common/configSettings';
import {
    IAnalysisSettings,
    IAutoCompleteSettings,
    IExperiments,
    IFormattingSettings,
    ILintingSettings,
    ILoggingSettings,
    ISortImportSettings,
    ITerminalSettings,
    IWorkspaceSymbolSettings,
} from '../../../client/common/types';
import { noop } from '../../../client/common/utils/misc';
import * as EnvFileTelemetry from '../../../client/telemetry/envFileTelemetry';
import { ITestingSettings } from '../../../client/testing/configuration/types';
import { MockAutoSelectionService } from '../../mocks/autoSelector';

suite('Python Settings', async () => {
    class CustomPythonSettings extends PythonSettings {
        public update(pythonSettings: WorkspaceConfiguration) {
            return super.update(pythonSettings);
        }
        public initialize() {
            noop();
        }
    }
    let config: TypeMoq.IMock<WorkspaceConfiguration>;
    let expected: CustomPythonSettings;
    let settings: CustomPythonSettings;
    setup(() => {
        sinon.stub(EnvFileTelemetry, 'sendSettingTelemetry').returns();
        config = TypeMoq.Mock.ofType<WorkspaceConfiguration>(undefined, TypeMoq.MockBehavior.Loose);
        expected = new CustomPythonSettings(undefined, new MockAutoSelectionService());
        settings = new CustomPythonSettings(undefined, new MockAutoSelectionService());
        expected.defaultInterpreterPath = 'python';
    });

    teardown(() => {
        sinon.restore();
    });

    function initializeConfig(sourceSettings: PythonSettings) {
        // string settings
        for (const name of [
            'pythonPath',
            'venvPath',
            'condaPath',
            'pipenvPath',
            'envFile',
            'poetryPath',
            'insidersChannel',
            'defaultInterpreterPath',
            'jediPath',
        ]) {
            config
                .setup((c) => c.get<string>(name))

                .returns(() => (sourceSettings as any)[name]);
        }
        for (const name of ['venvFolders']) {
            config
                .setup((c) => c.get<string[]>(name))

                .returns(() => (sourceSettings as any)[name]);
        }

        // boolean settings
        for (const name of ['downloadLanguageServer', 'autoUpdateLanguageServer']) {
            config
                .setup((c) => c.get<boolean>(name, true))

                .returns(() => (sourceSettings as any)[name]);
        }
        for (const name of ['disableInstallationCheck', 'globalModuleInstallation']) {
            config
                .setup((c) => c.get<boolean>(name))

                .returns(() => (sourceSettings as any)[name]);
        }

        // number settings
        config.setup((c) => c.get<number>('jediMemoryLimit')).returns(() => sourceSettings.jediMemoryLimit);
        // Language server type settings
        config.setup((c) => c.get<LanguageServerType>('languageServer')).returns(() => sourceSettings.languageServer);

        // "any" settings

        config.setup((c) => c.get<any[]>('devOptions')).returns(() => sourceSettings.devOptions);

        // complex settings
        config.setup((c) => c.get<ILoggingSettings>('logging')).returns(() => sourceSettings.logging);
        config.setup((c) => c.get<ILintingSettings>('linting')).returns(() => sourceSettings.linting);
        config.setup((c) => c.get<IAnalysisSettings>('analysis')).returns(() => sourceSettings.analysis);
        config.setup((c) => c.get<ISortImportSettings>('sortImports')).returns(() => sourceSettings.sortImports);
        config.setup((c) => c.get<IFormattingSettings>('formatting')).returns(() => sourceSettings.formatting);
        config.setup((c) => c.get<IAutoCompleteSettings>('autoComplete')).returns(() => sourceSettings.autoComplete);
        config
            .setup((c) => c.get<IWorkspaceSymbolSettings>('workspaceSymbols'))
            .returns(() => sourceSettings.workspaceSymbols);
        config.setup((c) => c.get<ITestingSettings>('testing')).returns(() => sourceSettings.testing);
        config.setup((c) => c.get<ITerminalSettings>('terminal')).returns(() => sourceSettings.terminal);
        config.setup((c) => c.get<IExperiments>('experiments')).returns(() => sourceSettings.experiments);
    }

    function testIfValueIsUpdated(settingName: string, value: any) {
        test(`${settingName} updated`, async () => {
            expected.pythonPath = 'python3';
            (expected as any)[settingName] = value;
            initializeConfig(expected);

            settings.update(config.object);

            expect((settings as any)[settingName]).to.be.equal((expected as any)[settingName]);
            config.verifyAll();
        });
    }

    suite('String settings', async () => {
        [
            'pythonPath',
            'venvPath',
            'condaPath',
            'pipenvPath',
            'envFile',
            'poetryPath',
            'insidersChannel',
            'defaultInterpreterPath',
        ].forEach(async (settingName) => {
            testIfValueIsUpdated(settingName, 'stringValue');
        });
    });

    suite('Boolean settings', async () => {
        ['downloadLanguageServer', 'autoUpdateLanguageServer', 'globalModuleInstallation'].forEach(
            async (settingName) => {
                testIfValueIsUpdated(settingName, true);
            },
        );
    });

    suite('Number settings', async () => {
        ['jediMemoryLimit'].forEach(async (settingName) => {
            testIfValueIsUpdated(settingName, 1001);
        });
    });

    test('condaPath updated', () => {
        expected.pythonPath = 'python3';
        expected.condaPath = 'spam';
        initializeConfig(expected);
        config
            .setup((c) => c.get<string>('condaPath'))
            .returns(() => expected.condaPath)
            .verifiable(TypeMoq.Times.once());

        settings.update(config.object);

        expect(settings.condaPath).to.be.equal(expected.condaPath);
        config.verifyAll();
    });

    test('condaPath (relative to home) updated', async () => {
        expected.pythonPath = 'python3';
        expected.condaPath = path.join('~', 'anaconda3', 'bin', 'conda');
        initializeConfig(expected);
        config
            .setup((c) => c.get<string>('condaPath'))
            .returns(() => expected.condaPath)
            .verifiable(TypeMoq.Times.once());

        settings.update(config.object);

        expect(settings.condaPath).to.be.equal(untildify(expected.condaPath));
        config.verifyAll();
    });

    function testLanguageServer(
        languageServer: LanguageServerType,
        expectedValue: LanguageServerType,
        isDefault: boolean,
    ) {
        test(languageServer, () => {
            expected.pythonPath = 'python3';
            expected.languageServer = languageServer;
            initializeConfig(expected);
            config
                .setup((c) => c.get<LanguageServerType>('languageServer'))
                .returns(() => expected.languageServer)
                .verifiable(TypeMoq.Times.once());

            settings.update(config.object);

            expect(settings.languageServer).to.be.equal(expectedValue);
            expect(settings.languageServerIsDefault).to.be.equal(isDefault);
            config.verifyAll();
        });
    }

    suite('languageServer settings', async () => {
        Object.values(LanguageServerType).forEach(async (languageServer) => {
            testLanguageServer(languageServer, languageServer, false);
        });

        testLanguageServer('invalid' as LanguageServerType, LanguageServerType.Jedi, true);
    });

    function testExperiments(enabled: boolean) {
        expected.pythonPath = 'python3';

        expected.experiments = {
            enabled,
            optInto: [],
            optOutFrom: [],
        };
        initializeConfig(expected);
        config
            .setup((c) => c.get<IExperiments>('experiments'))
            .returns(() => expected.experiments)
            .verifiable(TypeMoq.Times.once());

        settings.update(config.object);

        for (const key of Object.keys(expected.experiments)) {
            expect((settings.experiments as any)[key]).to.be.deep.equal((expected.experiments as any)[key]);
        }
        config.verifyAll();
    }
    test('Experiments (not enabled)', () => testExperiments(false));

    test('Experiments (enabled)', () => testExperiments(true));

    test('Formatter Paths and args', () => {
        expected.pythonPath = 'python3';

        expected.formatting = {
            autopep8Args: ['1', '2'],
            autopep8Path: 'one',
            blackArgs: ['3', '4'],
            blackPath: 'two',
            yapfArgs: ['5', '6'],
            yapfPath: 'three',
            provider: '',
        };
        expected.formatting.blackPath = 'spam';
        initializeConfig(expected);
        config
            .setup((c) => c.get<IFormattingSettings>('formatting'))
            .returns(() => expected.formatting)
            .verifiable(TypeMoq.Times.once());

        settings.update(config.object);

        for (const key of Object.keys(expected.formatting)) {
            expect((settings.formatting as any)[key]).to.be.deep.equal((expected.formatting as any)[key]);
        }
        config.verifyAll();
    });
    test('Formatter Paths (paths relative to home)', () => {
        expected.pythonPath = 'python3';

        expected.formatting = {
            autopep8Args: [],
            autopep8Path: path.join('~', 'one'),
            blackArgs: [],
            blackPath: path.join('~', 'two'),
            yapfArgs: [],
            yapfPath: path.join('~', 'three'),
            provider: '',
        };
        expected.formatting.blackPath = 'spam';
        initializeConfig(expected);
        config
            .setup((c) => c.get<IFormattingSettings>('formatting'))
            .returns(() => expected.formatting)
            .verifiable(TypeMoq.Times.once());

        settings.update(config.object);

        for (const key of Object.keys(expected.formatting)) {
            if (!key.endsWith('path')) {
                continue;
            }

            const expectedPath = untildify((expected.formatting as any)[key]);

            expect((settings.formatting as any)[key]).to.be.equal(expectedPath);
        }
        config.verifyAll();
    });
});
