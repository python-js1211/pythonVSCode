// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/**
 * Test utilities for testing the TestViewTreeProvider class.
 */

import { join, parse as path_parse } from 'path';
import * as typemoq from 'typemoq';
import { Uri, WorkspaceFolder } from 'vscode';
import {
    IApplicationShell, ICommandManager, IWorkspaceService
} from '../../../client/common/application/types';
import {
    IDisposable, IDisposableRegistry
} from '../../../client/common/types';
import { IServiceContainer } from '../../../client/ioc/types';
import { TestsHelper } from '../../../client/unittests/common/testUtils';
import {
    TestFlatteningVisitor
} from '../../../client/unittests/common/testVisitors/flatteningVisitor';
import {
    ITestCollectionStorageService, TestFile,
    TestFolder, TestFunction, Tests, TestSuite
} from '../../../client/unittests/common/types';
import {
    TestTreeViewProvider
} from '../../../client/unittests/explorer/testTreeViewProvider';
import { IUnitTestManagementService } from '../../../client/unittests/types';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';

/**
 * Disposable class that doesn't do anything, help for event-registration against
 * IUnitTestManagementService.
 */
export class ExplorerTestsDisposable implements IDisposable {
    // tslint:disable-next-line:no-empty
    public dispose() { }
}

export function getMockTestFolder(folderPath: string, testFiles: TestFile[] = []): TestFolder {

    // tslint:disable-next-line:no-unnecessary-local-variable
    const folder: TestFolder = {
        folders: [],
        name: folderPath,
        nameToRun: folderPath,
        testFiles: testFiles,
        time: 0
    };

    return folder;
}

export function getMockTestFile(filePath: string, testSuites: TestSuite[] = [], testFunctions: TestFunction[] = []): TestFile {

    // tslint:disable-next-line:no-unnecessary-local-variable
    const testFile: TestFile = {
        name: (path_parse(filePath)).base,
        nameToRun: filePath,
        time: 0,
        fullPath: join(__dirname, filePath),
        functions: testFunctions,
        suites: testSuites,
        xmlName: filePath.replace(/\//g, '.')
    };

    return testFile;
}

export function getMockTestSuite(
    suiteNameToRun: string,
    testFunctions: TestFunction[] = [],
    subSuites: TestSuite[] = [],
    instance: boolean = true,
    unitTest: boolean = true
): TestSuite {
    const suiteNameChunks = suiteNameToRun.split('::');
    const suiteName = suiteNameChunks[suiteNameChunks.length - 1];

    // tslint:disable-next-line:no-unnecessary-local-variable
    const testSuite: TestSuite = {
        functions: testFunctions,
        isInstance: instance,
        isUnitTest: unitTest,
        name: suiteName,
        nameToRun: suiteNameToRun,
        suites: subSuites,
        time: 0,
        xmlName: suiteNameToRun.replace(/\//g, '.').replace(/\:\:/g, ':')
    };
    return testSuite;
}

export function getMockTestFunction(fnNameToRun: string): TestFunction {

    const fnNameChunks = fnNameToRun.split('::');
    const fnName = fnNameChunks[fnNameChunks.length - 1];

    // tslint:disable-next-line:no-unnecessary-local-variable
    const fn: TestFunction = {
        name: fnName,
        nameToRun: fnNameToRun,
        time: 0
    };

    return fn;
}

/**
 * Return a basic hierarchy of test data items for use in testing.
 *
 * @returns Array containing the items broken out from the hierarchy (all items are linked to one another)
 */
export function getTestExplorerViewItemData(): [TestFolder, TestFile, TestFunction, TestSuite, TestFunction] {

    let testFolder: TestFolder;
    let testFile: TestFile;
    let testSuite: TestSuite;
    let testFunction: TestFunction;
    let testSuiteFunction: TestFunction;

    testSuiteFunction = getMockTestFunction('workspace/test_folder/test_file.py::test_suite::test_suite_function');
    testSuite = getMockTestSuite('workspace/test_folder/test_file.py::test_suite', [testSuiteFunction]);
    testFunction = getMockTestFunction('workspace/test_folder/test_file.py::test_function');
    testFile = getMockTestFile('workspace/test_folder/test_file.py', [testSuite], [testFunction]);
    testFolder = getMockTestFolder('workspace/test_folder', [testFile]);

    return [testFolder, testFile, testFunction, testSuite, testSuiteFunction];
}

/**
 * Return an instance of `TestsHelper` that can be used in a unit test scenario.
 *
 * @returns An instance of `TestsHelper` class with mocked AppShell & ICommandManager members.
 */
export function getTestHelperInstance(): TestsHelper {

    const appShellMoq = typemoq.Mock.ofType<IApplicationShell>();
    const commMgrMoq = typemoq.Mock.ofType<ICommandManager>();
    const serviceContainerMoq = typemoq.Mock.ofType<IServiceContainer>();

    serviceContainerMoq.setup(a => a.get(typemoq.It.isValue(IApplicationShell), typemoq.It.isAny()))
        .returns(() => appShellMoq.object);
    serviceContainerMoq.setup(a => a.get(typemoq.It.isValue(ICommandManager), typemoq.It.isAny()))
        .returns(() => commMgrMoq.object);

    return new TestsHelper(new TestFlatteningVisitor(), serviceContainerMoq.object);
}

/**
 * Creates mock `Tests` data suitable for testing the TestTreeViewProvider with.
 */
export function createMockTestsData(testData?: TestFile[]): Tests {
    if (testData === undefined) {
        let testFolder: TestFolder;
        let testFile: TestFile;
        let testFunction: TestFunction;
        let testSuite: TestSuite;
        let testSuiteFn: TestFunction;

        [testFolder,
            testFile,
            testFunction,
            testSuite,
            testSuiteFn] = getTestExplorerViewItemData();

        testData = [testFile];
    }

    const testHelper = getTestHelperInstance();
    return testHelper.flattenTestFiles(testData, __dirname);
}

export function createMockTestStorageService(testData?: Tests): typemoq.IMock<ITestCollectionStorageService> {
    const testStoreMoq = typemoq.Mock.ofType<ITestCollectionStorageService>();

    if (!testData) {
        testData = createMockTestsData();
    }

    testStoreMoq.setup(t => t.getTests(typemoq.It.isAny())).returns(() => testData);

    return testStoreMoq;
}

/**
 * Create an IUnitTestManagementService that will work for the TeestTreeViewProvider in a unit test scenario.
 *
 * Provider an 'onDidStatusChange' hook that can be called, but that does nothing.
 */
export function createMockUnitTestMgmtService(): typemoq.IMock<IUnitTestManagementService> {
    const unitTestMgmtSrvMoq = typemoq.Mock.ofType<IUnitTestManagementService>();
    unitTestMgmtSrvMoq.setup(u => u.onDidStatusChange(typemoq.It.isAny()))
        .returns(() => new ExplorerTestsDisposable());
    return unitTestMgmtSrvMoq;
}

/**
 * Create an IWorkspaceService mock that will work with the TestTreeViewProvider class.
 *
 * @param workspaceFolderPath Optional, the path to use as the current Resource-path for
 * the tests within the TestTree. Defaults to EXTENSION_ROOT_DIR_FOR_TESTS.
 */
export function createMockWorkspaceService(
    workspaceFolderPath: string = EXTENSION_ROOT_DIR_FOR_TESTS
): typemoq.IMock<IWorkspaceService> {
    const workspcSrvMoq = typemoq.Mock.ofType<IWorkspaceService>();
    class ExplorerTestsWorkspaceFolder implements WorkspaceFolder {
        public get uri(): Uri {
            return Uri.parse(workspaceFolderPath);
        }
        public get name(): string {
            return (path_parse(this.uri.fsPath)).base;
        }
        public get index(): number {
            return 0;
        }
    }
    workspcSrvMoq.setup(w => w.workspaceFolders)
        .returns(() => [new ExplorerTestsWorkspaceFolder()]);
    return workspcSrvMoq;
}

/**
 * Create a testable mocked up version of the TestExplorerViewProvider. Creates any
 * mocked dependencies not provided in the parameters.
 *
 * @param testStore Test storage service, provides access to the Tests structure that the view is built from.
 * @param unitTestMgmtService Unit test management service that provides the 'onTestStatusUpdated' event.
 * @param workspaceService Workspace service used to determine the current workspace that the test view is showing.
 * @param disposableReg Disposable registry used to dispose of items in the view.
 */
export function createMockTestExplorer(
    testStore?: ITestCollectionStorageService,
    testsData?: Tests,
    unitTestMgmtService?: IUnitTestManagementService,
    workspaceService?: IWorkspaceService
): TestTreeViewProvider {

    if (!testStore) {
        testStore = createMockTestStorageService(testsData).object;
    }

    if (!unitTestMgmtService) {
        unitTestMgmtService = createMockUnitTestMgmtService().object;
    }

    if (!workspaceService) {
        workspaceService = createMockWorkspaceService().object;
    }

    const dispRegMoq = typemoq.Mock.ofType<IDisposableRegistry>();
    dispRegMoq.setup(d => d.push(typemoq.It.isAny()));

    // tslint:disable-next-line:no-unnecessary-local-variable
    const viewProvider: TestTreeViewProvider =
        new TestTreeViewProvider(
            testStore, unitTestMgmtService, workspaceService, dispRegMoq.object
        );

    return viewProvider;
}
