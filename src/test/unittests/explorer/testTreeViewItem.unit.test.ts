// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import { Uri } from 'vscode';
import {
    Commands
} from '../../../client/common/constants';
import {
    TestFile, TestFolder,
    TestFunction, TestSuite, TestType
} from '../../../client/unittests/common/types';
import {
    TestTreeItem
} from '../../../client/unittests/explorer/testTreeViewItem';
import {
    createMockTestDataItem, createSubtestParent
} from '../common/testUtils.unit.test';
import { getTestExplorerViewItemData } from './explorerTestData';

suite('Unit Tests Test Explorer View Items', () => {
    let testFolder: TestFolder;
    let testFile: TestFile;
    let testSuite: TestSuite;
    let testFunction: TestFunction;
    let testSuiteFunction: TestFunction;
    const resource = Uri.file(__filename);
    setup(() => {
        [testFolder, testFile, testFunction, testSuite, testSuiteFunction] = getTestExplorerViewItemData();
    });

    test('Test root folder created into test view item', () => {
        const viewItem = new TestTreeItem(resource, testFolder);
        expect(viewItem.contextValue).is.equal('testFolder');
    });

    test('Test file created into test view item', () => {
        const viewItem = new TestTreeItem(resource, testFile);
        expect(viewItem.contextValue).is.equal('testFile');
    });

    test('Test suite created into test view item', () => {
        const viewItem = new TestTreeItem(resource, testSuite);
        expect(viewItem.contextValue).is.equal('testSuite');
    });

    test('Test function created into test view item', () => {
        const viewItem = new TestTreeItem(resource, testFunction);
        expect(viewItem.contextValue).is.equal('testFunction');
    });

    test('Test suite function created into test view item', () => {
        const viewItem = new TestTreeItem(resource, testSuiteFunction);
        expect(viewItem.contextValue).is.equal('testFunction');
    });

    test('Test subtest parent created into test view item', () => {
        const subtestParent = createSubtestParent([
            createMockTestDataItem<TestFunction>(TestType.testFunction, 'test_x'),
            createMockTestDataItem<TestFunction>(TestType.testFunction, 'test_y')
        ]);

        const viewItem = new TestTreeItem(resource, subtestParent.asSuite);

        expect(viewItem.contextValue).is.equal('testSuite');
        expect(viewItem.command!.command).is.equal(Commands.navigateToTestFunction);
    });

    test('Test subtest created into test view item', () => {
        createSubtestParent([testFunction]);  // sets testFunction.subtestParent

        const viewItem = new TestTreeItem(resource, testFunction);

        expect(viewItem.contextValue).is.equal('testFunction');
    });
});
