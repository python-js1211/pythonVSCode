// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { expect } from 'chai';
import { Container } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import * as TypeMoq from 'typemoq';
import {
    CancellationTokenSource,
    DiagnosticSeverity,
    TextDocument,
    Uri,
    WorkspaceConfiguration,
    WorkspaceFolder,
} from 'vscode';
import { LanguageServerType } from '../../client/activation/types';
import { IWorkspaceService } from '../../client/common/application/types';
import { IFileSystem, IPlatformService } from '../../client/common/platform/types';
import { IPythonToolExecutionService } from '../../client/common/process/types';
import { IConfigurationService, IInstaller, IPythonSettings } from '../../client/common/types';
import {
    IInterpreterAutoSelectionService,
    IInterpreterAutoSelectionProxyService,
} from '../../client/interpreter/autoSelection/types';
import { ServiceContainer } from '../../client/ioc/container';
import { ServiceManager } from '../../client/ioc/serviceManager';
import { LinterManager } from '../../client/linters/linterManager';
import { Pylint } from '../../client/linters/pylint';
import { ILinterManager } from '../../client/linters/types';
import { MockLintingSettings } from '../mockClasses';
import { MockAutoSelectionService } from '../mocks/autoSelector';

suite('Linting - Pylint', () => {
    let fileSystem: TypeMoq.IMock<IFileSystem>;
    let platformService: TypeMoq.IMock<IPlatformService>;
    let workspace: TypeMoq.IMock<IWorkspaceService>;
    let execService: TypeMoq.IMock<IPythonToolExecutionService>;
    let config: TypeMoq.IMock<IConfigurationService>;
    let workspaceConfig: TypeMoq.IMock<WorkspaceConfiguration>;
    let pythonSettings: TypeMoq.IMock<IPythonSettings>;
    let serviceContainer: ServiceContainer;

    setup(() => {
        fileSystem = TypeMoq.Mock.ofType<IFileSystem>();
        fileSystem
            .setup((x) => x.arePathsSame(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyString()))
            .returns((a, b) => a === b);

        platformService = TypeMoq.Mock.ofType<IPlatformService>();
        platformService.setup((x) => x.isWindows).returns(() => false);

        workspace = TypeMoq.Mock.ofType<IWorkspaceService>();
        execService = TypeMoq.Mock.ofType<IPythonToolExecutionService>();

        const cont = new Container();
        const serviceManager = new ServiceManager(cont);
        serviceContainer = new ServiceContainer(cont);

        serviceManager.addSingletonInstance<IFileSystem>(IFileSystem, fileSystem.object);
        serviceManager.addSingletonInstance<IWorkspaceService>(IWorkspaceService, workspace.object);
        serviceManager.addSingletonInstance<IPythonToolExecutionService>(
            IPythonToolExecutionService,
            execService.object,
        );
        serviceManager.addSingletonInstance<IPlatformService>(IPlatformService, platformService.object);
        serviceManager.addSingleton<IInterpreterAutoSelectionService>(
            IInterpreterAutoSelectionService,
            MockAutoSelectionService,
        );
        serviceManager.addSingleton<IInterpreterAutoSelectionProxyService>(
            IInterpreterAutoSelectionProxyService,
            MockAutoSelectionService,
        );

        pythonSettings = TypeMoq.Mock.ofType<IPythonSettings>();
        pythonSettings.setup((p) => p.languageServer).returns(() => LanguageServerType.Jedi);

        config = TypeMoq.Mock.ofType<IConfigurationService>();
        config.setup((c) => c.getSettings()).returns(() => pythonSettings.object);

        workspaceConfig = TypeMoq.Mock.ofType<WorkspaceConfiguration>();
        workspace.setup((w) => w.getConfiguration('python')).returns(() => workspaceConfig.object);

        serviceManager.addSingletonInstance<IConfigurationService>(IConfigurationService, config.object);
        const linterManager = new LinterManager(config.object);
        serviceManager.addSingletonInstance<ILinterManager>(ILinterManager, linterManager);
        const installer = TypeMoq.Mock.ofType<IInstaller>();
        serviceManager.addSingletonInstance<IInstaller>(IInstaller, installer.object);
    });

    test('Negative column numbers should be treated 0', async () => {
        const fileFolder = '/user/a/b/c';
        const pylinter = new Pylint(serviceContainer);

        const document = TypeMoq.Mock.ofType<TextDocument>();
        document.setup((x) => x.uri).returns(() => Uri.file(path.join(fileFolder, 'test.py')));

        const wsf = TypeMoq.Mock.ofType<WorkspaceFolder>();
        wsf.setup((x) => x.uri).returns(() => Uri.file(fileFolder));

        workspace.setup((x) => x.getWorkspaceFolder(TypeMoq.It.isAny())).returns(() => wsf.object);

        const linterOutput = [
            'No config file found, using default configuration',
            '************* Module test',
            '1,1,convention,C0111:Missing module docstring',
            '3,-1,error,E1305:Too many arguments for format string',
        ].join(os.EOL);
        execService
            .setup((x) => x.exec(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve({ stdout: linterOutput, stderr: '' }));

        const lintSettings = new MockLintingSettings();
        lintSettings.maxNumberOfProblems = 1000;
        lintSettings.pylintPath = 'pyLint';
        lintSettings.pylintEnabled = true;
        lintSettings.pylintCategorySeverity = {
            convention: DiagnosticSeverity.Hint,
            error: DiagnosticSeverity.Error,
            fatal: DiagnosticSeverity.Error,
            refactor: DiagnosticSeverity.Hint,
            warning: DiagnosticSeverity.Warning,
        };

        const settings = TypeMoq.Mock.ofType<IPythonSettings>();
        settings.setup((x) => x.linting).returns(() => lintSettings);
        settings.setup((x) => x.languageServer).returns(() => LanguageServerType.Jedi);
        config.setup((x) => x.getSettings(TypeMoq.It.isAny())).returns(() => settings.object);

        const messages = await pylinter.lint(document.object, new CancellationTokenSource().token);
        expect(messages).to.be.lengthOf(2);
        expect(messages[0].column).to.be.equal(1);
        expect(messages[1].column).to.be.equal(0);
    });
});
