// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import {
    CancellationToken,
    Event,
    TestController,
    TestItem,
    TestRun,
    TestRunProfileKind,
    Uri,
    WorkspaceFolder,
} from 'vscode';
import { TestDiscoveryOptions } from '../../common/types';

export type TestRunInstanceOptions = TestRunOptions & {
    exclude?: readonly TestItem[];
    debug: boolean;
};

export enum TestDataKinds {
    Workspace,
    FolderOrFile,
    Collection,
    Case,
}

export interface TestData {
    rawId: string;
    runId: string;
    id: string;
    uri: Uri;
    parentId?: string;
    kind: TestDataKinds;
}

export const ITestDiscoveryHelper = Symbol('ITestDiscoveryHelper');
export interface ITestDiscoveryHelper {
    runTestDiscovery(options: TestDiscoveryOptions): Promise<RawDiscoveredTests[]>;
}

export type TestRefreshOptions = { forceRefresh: boolean };

export const ITestController = Symbol('ITestController');
export interface ITestController {
    refreshTestData(resource?: Uri, options?: TestRefreshOptions): Promise<void>;
    stopRefreshing(): void;
    onRefreshingCompleted: Event<void>;
    onRefreshingStarted: Event<void>;
    onRunWithoutConfiguration: Event<WorkspaceFolder[]>;
}

export interface ITestRun {
    includes: readonly TestItem[];
    excludes: readonly TestItem[];
    runKind: TestRunProfileKind;
    runInstance: TestRun;
}

export const ITestFrameworkController = Symbol('ITestFrameworkController');
export interface ITestFrameworkController {
    resolveChildren(testController: TestController, item: TestItem, token?: CancellationToken): Promise<void>;
    refreshTestData(testController: TestController, resource?: Uri, token?: CancellationToken): Promise<void>;
    runTests(
        testRun: ITestRun,
        workspace: WorkspaceFolder,
        token: CancellationToken,
        testController?: TestController,
    ): Promise<void>;
}

export const ITestsRunner = Symbol('ITestsRunner');
export interface ITestsRunner {
    runTests(
        testRun: ITestRun,
        options: TestRunOptions,
        idToRawData: Map<string, TestData>,
        testController?: TestController,
    ): Promise<void>;
}

export type TestRunOptions = {
    workspaceFolder: Uri;
    cwd: string;
    args: string[];
    token: CancellationToken;
};

// We expose these here as a convenience and to cut down on churn
// elsewhere in the code.
type RawTestNode = {
    id: string;
    name: string;
    parentid: string;
};
export type RawTestParent = RawTestNode & {
    kind: 'folder' | 'file' | 'suite' | 'function' | 'workspace';
};
type RawTestFSNode = RawTestParent & {
    kind: 'folder' | 'file';
    relpath: string;
};
export type RawTestFolder = RawTestFSNode & {
    kind: 'folder';
};
export type RawTestFile = RawTestFSNode & {
    kind: 'file';
};
export type RawTestSuite = RawTestParent & {
    kind: 'suite';
};
// function-as-a-container is for parameterized ("sub") tests.
export type RawTestFunction = RawTestParent & {
    kind: 'function';
};
export type RawTest = RawTestNode & {
    source: string;
};
export type RawDiscoveredTests = {
    rootid: string;
    root: string;
    parents: RawTestParent[];
    tests: RawTest[];
};
