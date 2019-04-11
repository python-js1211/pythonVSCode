// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as assert from 'assert';
import * as path from 'path';
import { deepEqual, instance, mock, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { CancellationTokenSource, Uri } from 'vscode';
import { PythonExecutionFactory } from '../../../../client/common/process/pythonExecutionFactory';
import { ExecutionFactoryCreateWithEnvironmentOptions, IPythonExecutionFactory, IPythonExecutionService, SpawnOptions } from '../../../../client/common/process/types';
import { EXTENSION_ROOT_DIR } from '../../../../client/constants';
import { TestDiscoveredTestParser } from '../../../../client/unittests/common/services/discoveredTestParser';
import { TestsDiscoveryService } from '../../../../client/unittests/common/services/discovery';
import { DiscoveredTests, ITestDiscoveredTestParser } from '../../../../client/unittests/common/services/types';
import { TestDiscoveryOptions, Tests } from '../../../../client/unittests/common/types';
import { MockOutputChannel } from '../../../mockClasses';

// tslint:disable:no-unnecessary-override no-any
suite('Unit Tests - Common Discovery', () => {
    let discovery: TestsDiscoveryService;
    let executionFactory: IPythonExecutionFactory;
    let parser: ITestDiscoveredTestParser;
    setup(() => {
        executionFactory = mock(PythonExecutionFactory);
        parser = mock(TestDiscoveredTestParser);
        discovery = new TestsDiscoveryService(instance(executionFactory), instance(parser));
    });
    test('Use parser to parse results', async () => {
        const options: TestDiscoveryOptions = {
            args: [], cwd: __dirname, workspaceFolder: Uri.file(__dirname),
            ignoreCache: false, token: new CancellationTokenSource().token,
            outChannel: new MockOutputChannel('Test')
        };
        const discoveredTests: DiscoveredTests[] = [{ hello: 1 } as any];
        const parsedResult = { done: true } as any as Tests;
        const json = JSON.stringify(discoveredTests);
        discovery.exec = () => Promise.resolve({ stdout: json });
        when(parser.parse(options.workspaceFolder, deepEqual(discoveredTests))).thenResolve(parsedResult as any);

        const tests = await discovery.discoverTests(options);

        assert.deepEqual(tests, parsedResult);
    });
    test('Invoke Python Code to discover tests', async () => {
        const options: TestDiscoveryOptions = {
            args: ['1', '2', '3'], cwd: __dirname, workspaceFolder: Uri.file(__dirname),
            ignoreCache: false, token: new CancellationTokenSource().token,
            outChannel: new MockOutputChannel('Test')
        };
        const discoveredTests = '[1]';
        const execService = typemoq.Mock.ofType<IPythonExecutionService>();
        execService.setup((e: any) => e.then).returns(() => undefined);
        const creationOptions: ExecutionFactoryCreateWithEnvironmentOptions = {
            allowEnvironmentFetchExceptions: false,
            resource: options.workspaceFolder
        };
        const pythonFile = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'testing_tools', 'run_adapter.py');
        const spawnOptions: SpawnOptions = {
            token: options.token,
            cwd: options.cwd,
            throwOnStdErr: true
        };

        when(executionFactory.createActivatedEnvironment(deepEqual(creationOptions))).thenResolve(execService.object);
        const executionResult = { stdout: discoveredTests };
        execService.setup(e => e.exec(typemoq.It.isValue([pythonFile, ...options.args]), typemoq.It.isValue(spawnOptions))).returns(() => Promise.resolve(executionResult));

        const result = await discovery.exec(options);

        execService.verifyAll();
        assert.deepEqual(result, executionResult);
    });
});
