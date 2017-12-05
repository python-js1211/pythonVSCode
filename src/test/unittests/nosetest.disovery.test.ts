// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IProcessService } from '../../client/common/process/types';
import { CommandSource } from '../../client/unittests/common/constants';
import { ITestManagerFactory, Tests } from '../../client/unittests/common/types';
import { rootWorkspaceUri, updateSetting } from '../common';
import { MockProcessService } from '../mocks/proc';
import { initialize, initializeTest, IS_MULTI_ROOT_TEST } from './../initialize';
import { UnitTestIocContainer } from './serviceRegistry';

const PYTHON_FILES_PATH = path.join(__dirname, '..', '..', '..', 'src', 'test', 'pythonFiles');
const UNITTEST_TEST_FILES_PATH = path.join(__dirname, '..', '..', '..', 'src', 'test', 'pythonFiles', 'testFiles', 'noseFiles');
const UNITTEST_SINGLE_TEST_FILE_PATH = path.join(__dirname, '..', '..', '..', 'src', 'test', 'pythonFiles', 'testFiles', 'single');
const filesToDelete = [
    path.join(UNITTEST_TEST_FILES_PATH, '.noseids'),
    path.join(UNITTEST_SINGLE_TEST_FILE_PATH, '.noseids')
];

// tslint:disable-next-line:max-func-body-length
suite('Unit Tests - nose - discovery with mocked process output', () => {
    let ioc: UnitTestIocContainer;
    const configTarget = IS_MULTI_ROOT_TEST ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;

    suiteSetup(async () => {
        filesToDelete.forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        });
        await updateSetting('unitTest.nosetestArgs', [], rootWorkspaceUri, configTarget);
        await initialize();
    });
    suiteTeardown(async () => {
        await updateSetting('unitTest.nosetestArgs', [], rootWorkspaceUri, configTarget);
        filesToDelete.forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        });
    });
    setup(async () => {
        await initializeTest();
        initializeDI();
    });
    teardown(async () => {
        ioc.dispose();
        await updateSetting('unitTest.nosetestArgs', [], rootWorkspaceUri, configTarget);
    });

    function initializeDI() {
        ioc = new UnitTestIocContainer();
        ioc.registerCommonTypes();
        ioc.registerUnitTestTypes();
        ioc.registerVariableTypes();

        ioc.registerMockProcessTypes();
    }

    function injectTestDiscoveryOutput(outputFileName: string) {
        const procService = ioc.serviceContainer.get<MockProcessService>(IProcessService);
        procService.onExecObservable((file, args, options, callback) => {
            if (args.indexOf('--collect-only') >= 0) {
                let out = fs.readFileSync(path.join(UNITTEST_TEST_FILES_PATH, outputFileName), 'utf8');
                // Value in the test files.
                out = out.replace(/\/Users\/donjayamanne\/.vscode\/extensions\/pythonVSCode\/src\/test\/pythonFiles/g, PYTHON_FILES_PATH);
                callback({
                    out,
                    source: 'stdout'
                });
            }
        });
    }

    test('Discover Tests (single test file)', async () => {
        injectTestDiscoveryOutput('one.output');
        const factory = ioc.serviceContainer.get<ITestManagerFactory>(ITestManagerFactory);
        const testManager = factory('nosetest', rootWorkspaceUri, UNITTEST_SINGLE_TEST_FILE_PATH);
        const tests = await testManager.discoverTests(CommandSource.ui, true, true);
        assert.equal(tests.testFiles.length, 2, 'Incorrect number of test files');
        assert.equal(tests.testFunctions.length, 6, 'Incorrect number of test functions');
        assert.equal(tests.testSuites.length, 2, 'Incorrect number of test suites');
        assert.equal(tests.testFiles.some(t => t.name === path.join('tests', 'test_one.py') && t.nameToRun === t.name), true, 'Test File not found');
    });

    test('Check that nameToRun in testSuites has class name after : (single test file)', async () => {
        injectTestDiscoveryOutput('two.output');
        const factory = ioc.serviceContainer.get<ITestManagerFactory>(ITestManagerFactory);
        const testManager = factory('nosetest', rootWorkspaceUri, UNITTEST_SINGLE_TEST_FILE_PATH);
        const tests = await testManager.discoverTests(CommandSource.ui, true, true);
        assert.equal(tests.testFiles.length, 2, 'Incorrect number of test files');
        assert.equal(tests.testFunctions.length, 6, 'Incorrect number of test functions');
        assert.equal(tests.testSuites.length, 2, 'Incorrect number of test suites');
        assert.equal(tests.testSuites.every(t => t.testSuite.name === t.testSuite.nameToRun.split(':')[1]), true, 'Suite name does not match class name');
    });

    function lookForTestFile(tests: Tests, testFile: string) {
        const found = tests.testFiles.some(t => t.name === testFile && t.nameToRun === t.name);
        assert.equal(found, true, `Test File not found '${testFile}'`);
    }
    test('Discover Tests (-m=test)', async () => {
        injectTestDiscoveryOutput('three.output');
        await updateSetting('unitTest.nosetestArgs', ['-m', 'test'], rootWorkspaceUri, configTarget);
        const factory = ioc.serviceContainer.get<ITestManagerFactory>(ITestManagerFactory);
        const testManager = factory('nosetest', rootWorkspaceUri, UNITTEST_TEST_FILES_PATH);
        const tests = await testManager.discoverTests(CommandSource.ui, true, true);
        assert.equal(tests.testFiles.length, 5, 'Incorrect number of test files');
        assert.equal(tests.testFunctions.length, 16, 'Incorrect number of test functions');
        assert.equal(tests.testSuites.length, 6, 'Incorrect number of test suites');
        lookForTestFile(tests, path.join('tests', 'test_unittest_one.py'));
        lookForTestFile(tests, path.join('tests', 'test_unittest_two.py'));
        lookForTestFile(tests, path.join('tests', 'unittest_three_test.py'));
        lookForTestFile(tests, path.join('tests', 'test4.py'));
        lookForTestFile(tests, 'test_root.py');
    });

    test('Discover Tests (-w=specific -m=tst)', async () => {
        injectTestDiscoveryOutput('four.output');
        await updateSetting('unitTest.nosetestArgs', ['-w', 'specific', '-m', 'tst'], rootWorkspaceUri, configTarget);
        const factory = ioc.serviceContainer.get<ITestManagerFactory>(ITestManagerFactory);
        const testManager = factory('nosetest', rootWorkspaceUri, UNITTEST_TEST_FILES_PATH);
        const tests = await testManager.discoverTests(CommandSource.ui, true, true);
        assert.equal(tests.testFiles.length, 2, 'Incorrect number of test files');
        assert.equal(tests.testFunctions.length, 6, 'Incorrect number of test functions');
        assert.equal(tests.testSuites.length, 2, 'Incorrect number of test suites');
        lookForTestFile(tests, path.join('specific', 'tst_unittest_one.py'));
        lookForTestFile(tests, path.join('specific', 'tst_unittest_two.py'));
    });

    test('Discover Tests (-m=test_)', async () => {
        injectTestDiscoveryOutput('five.output');
        await updateSetting('unitTest.nosetestArgs', ['-m', 'test_'], rootWorkspaceUri, configTarget);
        const factory = ioc.serviceContainer.get<ITestManagerFactory>(ITestManagerFactory);
        const testManager = factory('nosetest', rootWorkspaceUri, UNITTEST_TEST_FILES_PATH);
        const tests = await testManager.discoverTests(CommandSource.ui, true, true);
        assert.equal(tests.testFiles.length, 1, 'Incorrect number of test files');
        assert.equal(tests.testFunctions.length, 3, 'Incorrect number of test functions');
        assert.equal(tests.testSuites.length, 1, 'Incorrect number of test suites');
        lookForTestFile(tests, 'test_root.py');
    });
});
