// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { ICommandManager, IVSCodeNotebook } from '../../../client/common/application/types';
import { IDisposable } from '../../../client/common/types';
import { NotebookEditor } from '../../../client/datascience/notebook/notebookEditor';
import { INotebookEditorProvider } from '../../../client/datascience/types';
import { createEventHandler, IExtensionTestApi } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import { closeActiveWindows, initialize } from '../../initialize';
import {
    canRunTests,
    closeNotebooksAndCleanUpAfterTests,
    createTemporaryNotebook,
    swallowSavingOfNotebooks
} from './helper';

suite('DataScience - VSCode Notebook', function () {
    // tslint:disable: no-invalid-this no-any
    this.timeout(5_000);

    let api: IExtensionTestApi;
    let vscodeNotebook: IVSCodeNotebook;
    let editorProvider: INotebookEditorProvider;
    let commandManager: ICommandManager;
    const templateIPynb = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'test', 'datascience', 'test.ipynb');
    let testIPynb: Uri;
    const disposables: IDisposable[] = [];
    suiteSetup(async function () {
        api = await initialize();
        if (!(await canRunTests())) {
            return this.skip();
        }
        vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
        editorProvider = api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider);
        commandManager = api.serviceContainer.get<ICommandManager>(ICommandManager);
    });
    setup(async () => {
        sinon.restore();
        await swallowSavingOfNotebooks();

        // Don't use same file (due to dirty handling, we might save in dirty.)
        // Cuz we won't save to file, hence extension will backup in dirty file and when u re-open it will open from dirty.
        testIPynb = Uri.file(await createTemporaryNotebook(templateIPynb, disposables));
    });
    teardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    suiteTeardown(closeActiveWindows);

    test('Create empty notebook', async () => {
        const editor = await editorProvider.createNew();

        assert.isOk(editor);
        assert.instanceOf(editor, NotebookEditor);
        assert.isOk(vscodeNotebook.activeNotebookEditor);
    });
    test('Create empty notebook using command', async () => {
        await commandManager.executeCommand('python.datascience.createnewnotebook');

        assert.isOk(vscodeNotebook.activeNotebookEditor);
    });
    test('Create empty notebook and we have active editor', async () => {
        assert.isUndefined(editorProvider.activeEditor);
        assert.equal(editorProvider.editors.length, 0);

        const editor = await editorProvider.createNew();

        assert.equal(editorProvider.editors.length, 1);
        assert.isOk(editor);
        assert.isOk(vscodeNotebook.activeNotebookEditor);
        assert.isOk(editorProvider.activeEditor);
        assert.equal(
            vscodeNotebook.activeNotebookEditor?.document.uri.fsPath.toLowerCase(),
            editor.file.fsPath.toLowerCase()
        );
        assert.equal(editorProvider.activeEditor?.file.fsPath.toLowerCase(), editor.file.fsPath.toLowerCase());
    });

    test('Create empty notebook will fire necessary events', async () => {
        const notebookOpened = createEventHandler(editorProvider, 'onDidChangeActiveNotebookEditor', disposables);
        const activeNotebookChanged = createEventHandler(editorProvider, 'onDidOpenNotebookEditor', disposables);

        await editorProvider.createNew();

        await notebookOpened.assertFired();
        await activeNotebookChanged.assertFired();
    });
    test('Closing a notebook will fire necessary events and clear state', async () => {
        const notebookClosed = createEventHandler(editorProvider, 'onDidCloseNotebookEditor', disposables);

        await editorProvider.createNew();
        await closeActiveWindows();

        assert.isUndefined(editorProvider.activeEditor);
        assert.equal(editorProvider.editors.length, 0);
        await notebookClosed.assertFired();
    });
    test('Open a notebook using our API', async () => {
        const editor = await editorProvider.open(testIPynb);

        assert.isOk(editor);
    });
    test('Open a notebook using our API and we will have an active editor', async () => {
        assert.isUndefined(editorProvider.activeEditor);
        assert.equal(editorProvider.editors.length, 0);

        const editor = await editorProvider.open(testIPynb);

        assert.equal(editorProvider.editors.length, 1);
        assert.isOk(editor);
        assert.isOk(vscodeNotebook.activeNotebookEditor);
        assert.isOk(editorProvider.activeEditor);
        assert.equal(
            vscodeNotebook.activeNotebookEditor?.document.uri.fsPath.toLowerCase(),
            editor.file.fsPath.toLowerCase()
        );
        assert.equal(editorProvider.activeEditor?.file.fsPath.toLowerCase(), editor.file.fsPath.toLowerCase());
    });
    test('Open a notebook using our API will fire necessary events', async () => {
        const notebookOpened = createEventHandler(editorProvider, 'onDidChangeActiveNotebookEditor', disposables);
        const activeNotebookChanged = createEventHandler(editorProvider, 'onDidOpenNotebookEditor', disposables);

        await editorProvider.open(testIPynb);

        await notebookOpened.assertFired();
        await activeNotebookChanged.assertFired();
    });
    test('Open a notebook using VS Code API', async () => {
        assert.isUndefined(editorProvider.activeEditor);
        assert.equal(editorProvider.editors.length, 0);

        await commandManager.executeCommand('vscode.open', testIPynb);

        assert.equal(editorProvider.editors.length, 1);
        assert.isOk(vscodeNotebook.activeNotebookEditor);
        assert.isOk(editorProvider.activeEditor);
        assert.equal(editorProvider.activeEditor?.file.fsPath.toLowerCase(), testIPynb.fsPath.toLowerCase());
    });
    test('Open a notebook using VSC API then ours yields the same editor', async () => {
        assert.isUndefined(editorProvider.activeEditor);
        assert.equal(editorProvider.editors.length, 0);

        await commandManager.executeCommand('vscode.open', testIPynb);

        assert.equal(editorProvider.editors.length, 1);
        assert.isOk(vscodeNotebook.activeNotebookEditor);
        assert.equal(
            vscodeNotebook.activeNotebookEditor?.document.uri.fsPath.toLowerCase(),
            testIPynb.fsPath.toLowerCase()
        );
        assert.equal(editorProvider.activeEditor?.file.fsPath.toLowerCase(), testIPynb.fsPath.toLowerCase());

        // Opening again with our will do nothing (it will return the existing editor).
        const editor = await editorProvider.open(testIPynb);

        assert.equal(editorProvider.editors.length, 1);
        assert.equal(editor.file.fsPath.toLowerCase(), testIPynb.fsPath.toLowerCase());
    });
    test('Active notebook points to the currently active editor', async () => {
        const editor1 = await editorProvider.createNew();

        assert.isOk(vscodeNotebook.activeNotebookEditor);
        assert.equal(
            vscodeNotebook.activeNotebookEditor?.document.uri.fsPath.toLowerCase(),
            editor1.file.fsPath.toLowerCase()
        );
        assert.equal(
            vscodeNotebook.activeNotebookEditor?.document.uri.fsPath.toLowerCase(),
            editorProvider.activeEditor?.file.fsPath.toLowerCase()
        );

        const editor2 = await editorProvider.createNew();
        assert.equal(editorProvider.activeEditor?.file.fsPath.toLowerCase(), editor2.file.fsPath.toLowerCase());
    });
    test('Create two blank notebooks', async () => {
        const editor1 = await editorProvider.createNew();

        assert.equal(editor1.file.scheme, 'untitled');
        assert.equal(
            vscodeNotebook.activeNotebookEditor?.document.uri.fsPath.toLowerCase(),
            editor1.file.fsPath.toLowerCase()
        );

        const editor2 = await editorProvider.createNew();

        assert.equal(editor2.file.scheme, 'untitled');
        assert.equal(
            vscodeNotebook.activeNotebookEditor?.document.uri.fsPath.toLowerCase(),
            editor2.file.fsPath.toLowerCase()
        );
        assert.notEqual(
            vscodeNotebook.activeNotebookEditor?.document.uri.fsPath.toLowerCase(),
            editor1.file.fsPath.toLowerCase()
        );
    });
    test('Active Notebook Editor event gets fired when opening multiple notebooks', async () => {
        const notebookOpened = createEventHandler(editorProvider, 'onDidChangeActiveNotebookEditor', disposables);
        const activeNotebookChanged = createEventHandler(editorProvider, 'onDidOpenNotebookEditor', disposables);

        await editorProvider.createNew();

        await notebookOpened.assertFiredExactly(1);
        await activeNotebookChanged.assertFiredExactly(1);

        // Open another notebook.
        await commandManager.executeCommand('vscode.open', testIPynb);

        await notebookOpened.assertFiredExactly(2);
        await activeNotebookChanged.assertFiredExactly(2);
    });
});
