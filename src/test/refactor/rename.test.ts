// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import { EOL } from 'os';
import * as path from 'path';
import { anything, instance, mock, when } from 'ts-mockito';
import * as typeMoq from 'typemoq';
import {
    Range,
    TextEditorCursorStyle,
    TextEditorLineNumbersStyle,
    TextEditorOptions,
    Uri,
    window,
    workspace,
} from 'vscode';
import { EXTENSION_ROOT_DIR } from '../../client/common/constants';
import { DiscoveryVariants } from '../../client/common/experiments/groups';
import '../../client/common/extensions';
import { BufferDecoder } from '../../client/common/process/decoder';
import { ProcessService } from '../../client/common/process/proc';
import { PythonExecutionFactory } from '../../client/common/process/pythonExecutionFactory';
import {
    IProcessLogger,
    IProcessServiceFactory,
    IPythonExecutionFactory,
    IPythonExecutionService,
} from '../../client/common/process/types';
import {
    IConfigurationService,
    IExperimentService,
    IInterpreterPathProxyService,
    IPythonSettings,
} from '../../client/common/types';
import { IEnvironmentActivationService } from '../../client/interpreter/activation/types';
import { IInterpreterAutoSelectionService } from '../../client/interpreter/autoSelection/types';
import { IComponentAdapter, ICondaService, IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { RefactorProxy } from '../../client/refactor/proxy';
import { PYTHON_PATH } from '../common';
import { closeActiveWindows, initialize, initializeTest } from '../initialize';

type RenameResponse = {
    results: [{ diff: string }];
};

suite('Refactor Rename', () => {
    const options: TextEditorOptions = {
        cursorStyle: TextEditorCursorStyle.Line,
        insertSpaces: true,
        lineNumbers: TextEditorLineNumbersStyle.Off,
        tabSize: 4,
    };
    let pythonSettings: typeMoq.IMock<IPythonSettings>;
    let serviceContainer: typeMoq.IMock<IServiceContainer>;
    suiteSetup(initialize);
    setup(async () => {
        pythonSettings = typeMoq.Mock.ofType<IPythonSettings>();
        pythonSettings.setup((p) => p.pythonPath).returns(() => PYTHON_PATH);
        const configService = typeMoq.Mock.ofType<IConfigurationService>();
        configService.setup((c) => c.getSettings(typeMoq.It.isAny())).returns(() => pythonSettings.object);
        const condaService = typeMoq.Mock.ofType<ICondaService>();
        const experimentService = typeMoq.Mock.ofType<IExperimentService>();
        const processServiceFactory = typeMoq.Mock.ofType<IProcessServiceFactory>();
        processServiceFactory
            .setup((p) => p.create(typeMoq.It.isAny()))
            .returns(() => Promise.resolve(new ProcessService(new BufferDecoder())));
        const interpreterService = typeMoq.Mock.ofType<IInterpreterService>();
        interpreterService.setup((i) => i.hasInterpreters()).returns(() => Promise.resolve(true));
        const envActivationService = typeMoq.Mock.ofType<IEnvironmentActivationService>();
        envActivationService
            .setup((e) => e.getActivatedEnvironmentVariables(typeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        envActivationService
            .setup((e) => e.getActivatedEnvironmentVariables(typeMoq.It.isAny(), typeMoq.It.isAny()))
            .returns(() => Promise.resolve(undefined));
        envActivationService
            .setup((e) =>
                e.getActivatedEnvironmentVariables(typeMoq.It.isAny(), typeMoq.It.isAny(), typeMoq.It.isAny()),
            )
            .returns(() => Promise.resolve(undefined));
        serviceContainer = typeMoq.Mock.ofType<IServiceContainer>();
        serviceContainer
            .setup((s) => s.get(typeMoq.It.isValue(IConfigurationService), typeMoq.It.isAny()))
            .returns(() => configService.object);
        serviceContainer
            .setup((s) => s.get(typeMoq.It.isValue(IProcessServiceFactory), typeMoq.It.isAny()))
            .returns(() => processServiceFactory.object);
        serviceContainer
            .setup((s) => s.get(typeMoq.It.isValue(IInterpreterService), typeMoq.It.isAny()))
            .returns(() => interpreterService.object);
        serviceContainer
            .setup((s) => s.get(typeMoq.It.isValue(IEnvironmentActivationService), typeMoq.It.isAny()))
            .returns(() => envActivationService.object);

        const pyenvs: IComponentAdapter = mock<IComponentAdapter>();

        experimentService
            .setup((e) => e.inExperiment(DiscoveryVariants.discoverWithFileWatching))
            .returns(() => Promise.resolve(false));

        const autoSelection = mock<IInterpreterAutoSelectionService>();
        const interpreterPathExpHelper = mock<IInterpreterPathProxyService>();
        when(interpreterPathExpHelper.get(anything())).thenReturn('selected interpreter path');

        serviceContainer
            .setup((s) => s.get(typeMoq.It.isValue(IPythonExecutionFactory), typeMoq.It.isAny()))
            .returns(
                () =>
                    new PythonExecutionFactory(
                        serviceContainer.object,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        undefined as any,
                        processServiceFactory.object,
                        configService.object,
                        condaService.object,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        undefined as any,
                        instance(pyenvs),
                        experimentService.object,
                        instance(autoSelection),
                        instance(interpreterPathExpHelper),
                    ),
            );
        const processLogger = typeMoq.Mock.ofType<IProcessLogger>();
        processLogger
            .setup((p) => p.logProcess(typeMoq.It.isAny(), typeMoq.It.isAny(), typeMoq.It.isAny()))
            .returns(() => {
                /** No body */
            });
        serviceContainer
            .setup((s) => s.get(typeMoq.It.isValue(IProcessLogger), typeMoq.It.isAny()))
            .returns(() => processLogger.object);
        await initializeTest();
    });
    teardown(closeActiveWindows);
    suiteTeardown(closeActiveWindows);
    function createPythonExecGetter(workspaceRoot: string): () => Promise<IPythonExecutionService> {
        return async () => {
            const factory = serviceContainer.object.get<IPythonExecutionFactory>(IPythonExecutionFactory);
            return factory.create({ resource: Uri.file(workspaceRoot) });
        };
    }

    test('Rename function in source without a trailing empty line', async () => {
        const sourceFile = path.join(
            EXTENSION_ROOT_DIR,
            'src',
            'test',
            'pythonFiles',
            'refactoring',
            'source folder',
            'without empty line.py',
        );
        const expectedDiff = `--- a/${path.basename(sourceFile)}${EOL}+++ b/${path.basename(
            sourceFile,
        )}${EOL}@@ -1,8 +1,8 @@${EOL} import os${EOL} ${EOL}-def one():${EOL}+def three():${EOL}     return True${EOL} ${EOL} def two():${EOL}-    if one():${EOL}-        print(\"A\" + one())${EOL}+    if three():${EOL}+        print(\"A\" + three())${EOL}`.splitLines(
            { removeEmptyEntries: false, trim: false },
        );
        const workspaceRoot = path.dirname(sourceFile);

        const proxy = new RefactorProxy(workspaceRoot, createPythonExecGetter(workspaceRoot));
        const textDocument = await workspace.openTextDocument(sourceFile);
        await window.showTextDocument(textDocument);

        const response = await proxy.rename<RenameResponse>(
            textDocument,
            'three',
            sourceFile,
            new Range(7, 20, 7, 23),
            options,
        );
        expect(response.results).to.be.lengthOf(1);
        expect(response.results[0].diff.splitLines({ removeEmptyEntries: false, trim: false })).to.be.deep.equal(
            expectedDiff,
        );
    });
    test('Rename function in source with a trailing empty line', async () => {
        const sourceFile = path.join(
            EXTENSION_ROOT_DIR,
            'src',
            'test',
            'pythonFiles',
            'refactoring',
            'source folder',
            'with empty line.py',
        );
        const expectedDiff = `--- a/${path.basename(sourceFile)}${EOL}+++ b/${path.basename(
            sourceFile,
        )}${EOL}@@ -1,8 +1,8 @@${EOL} import os${EOL} ${EOL}-def one():${EOL}+def three():${EOL}     return True${EOL} ${EOL} def two():${EOL}-    if one():${EOL}-        print(\"A\" + one())${EOL}+    if three():${EOL}+        print(\"A\" + three())${EOL}`.splitLines(
            { removeEmptyEntries: false, trim: false },
        );
        const workspaceRoot = path.dirname(sourceFile);

        const proxy = new RefactorProxy(workspaceRoot, createPythonExecGetter(workspaceRoot));
        const textDocument = await workspace.openTextDocument(sourceFile);
        await window.showTextDocument(textDocument);

        const response = await proxy.rename<RenameResponse>(
            textDocument,
            'three',
            sourceFile,
            new Range(7, 20, 7, 23),
            options,
        );
        expect(response.results).to.be.lengthOf(1);
        expect(response.results[0].diff.splitLines({ removeEmptyEntries: false, trim: false })).to.be.deep.equal(
            expectedDiff,
        );
    });
});
