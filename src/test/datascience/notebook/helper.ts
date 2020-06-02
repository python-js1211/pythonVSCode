// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// tslint:disable: no-var-requires no-require-imports no-invalid-this no-any

import { nbformat } from '@jupyterlab/coreutils';
import { assert, expect } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import * as tmp from 'tmp';
import { commands } from 'vscode';
import { NotebookCell } from '../../../../types/vscode-proposed';
import { IApplicationEnvironment, IVSCodeNotebook } from '../../../client/common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
import { IDisposable } from '../../../client/common/types';
import { noop, swallowExceptions } from '../../../client/common/utils/misc';
import { NotebookContentProvider } from '../../../client/datascience/notebook/contentProvider';
import { ICell, INotebookEditorProvider, INotebookProvider } from '../../../client/datascience/types';
import { waitForCondition } from '../../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants';
import { closeActiveWindows, initialize } from '../../initialize';
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

async function getServices() {
    const api = await initialize();
    return {
        contentProvider: api.serviceContainer.get<NotebookContentProvider>(NotebookContentProvider),
        vscodeNotebook: api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook),
        editorProvider: api.serviceContainer.get<INotebookEditorProvider>(INotebookEditorProvider)
    };
}

export async function insertMarkdownCell(source: string, index: number = 0) {
    const { vscodeNotebook, editorProvider } = await getServices();
    const vscEditor = vscodeNotebook.activeNotebookEditor;
    const nbEditor = editorProvider.activeEditor;
    const cellCount = nbEditor?.model?.cells.length ?? 0;
    await new Promise((resolve) =>
        vscEditor?.edit((builder) => {
            builder.insert(index, source, MARKDOWN_LANGUAGE, vscodeNotebookEnums.CellKind.Markdown, [], undefined);
            resolve();
        })
    );

    return {
        waitForCellToGetAdded: () =>
            waitForCondition(async () => nbEditor?.model?.cells.length === cellCount + 1, 1_000, 'Cell not inserted')
    };
}
export async function insertPythonCell(source: string, index: number = 0) {
    const { vscodeNotebook, editorProvider } = await getServices();
    const vscEditor = vscodeNotebook.activeNotebookEditor;
    const nbEditor = editorProvider.activeEditor;
    const oldCellCount = vscEditor?.document.cells.length ?? 0;
    await new Promise((resolve) =>
        vscEditor?.edit((builder) => {
            builder.insert(index, source, PYTHON_LANGUAGE, vscodeNotebookEnums.CellKind.Code, [], undefined);
            resolve();
        })
    );

    // When a cell is added we need to wait for it to get added in our INotebookModel.
    // We also need to wait for it to get assigned a cell id.
    return {
        waitForCellToGetAdded: async () => {
            await waitForCondition(
                async () =>
                    nbEditor?.model?.cells.length === oldCellCount + 1 &&
                    nbEditor?.model?.cells.length === vscEditor?.document.cells.length,
                1_000,
                'Cell not inserted'
            );
            // All cells must have same cell id as in INotebookModel.
            await waitForCondition(
                async () =>
                    vscEditor?.document.cells.map((cell) => cell.metadata.custom?.cellId || '').join('') ===
                    nbEditor?.model?.cells.map((cell) => cell.id).join(''),
                1_000,
                'Cell not assigned a cell Id'
            );
        }
    };
}
export async function insertPythonCellAndWait(source: string, index: number = 0) {
    await (await insertPythonCell(source, index)).waitForCellToGetAdded();
}
export async function deleteCell(index: number = 0) {
    const { vscodeNotebook } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    await new Promise((resolve) =>
        activeEditor?.edit((builder) => {
            builder.delete(index);
            resolve();
        })
    );
}
export async function deleteAllCellsAndWait(index: number = 0) {
    const { vscodeNotebook, editorProvider } = await getServices();
    const activeEditor = vscodeNotebook.activeNotebookEditor;
    const vscCells = activeEditor?.document.cells!;
    const modelCells = editorProvider.activeEditor?.model?.cells!;
    let previousCellOut = vscCells.length;
    while (previousCellOut) {
        await new Promise((resolve) =>
            activeEditor?.edit((builder) => {
                builder.delete(index);
                resolve();
            })
        );
        // Wait for cell to get deleted.
        await waitForCondition(async () => vscCells.length === previousCellOut - 1, 1_000, 'Cell not deleted');
        previousCellOut = vscCells.length;
    }
    await waitForCondition(
        async () => vscCells.length === modelCells.length && vscCells.length === 0,
        5_000,
        'All cells were not deleted'
    );
}

export async function createTemporaryFile(options: {
    templateFile: string;
    dir: string;
}): Promise<{ file: string } & IDisposable> {
    const extension = path.extname(options.templateFile);
    const tempFile = tmp.tmpNameSync({ postfix: extension, dir: options.dir });
    await fs.copyFile(options.templateFile, tempFile);
    return { file: tempFile, dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) };
}

export async function createTemporaryNotebook(templateFile: string, disposables: IDisposable[]): Promise<string> {
    const extension = path.extname(templateFile);
    const tempFile = tmp.tmpNameSync({ postfix: extension, dir: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'tmp') });
    await fs.copyFile(templateFile, tempFile);
    disposables.push({ dispose: () => swallowExceptions(() => fs.unlinkSync(tempFile)) });
    return tempFile;
}

export function disposeAllDisposables(disposables: IDisposable[]) {
    while (disposables.length) {
        disposables.pop()?.dispose(); // NOSONAR;
    }
}

export async function canRunTests() {
    const api = await initialize();
    const appEnv = api.serviceContainer.get<IApplicationEnvironment>(IApplicationEnvironment);
    return appEnv.extensionChannel !== 'stable';
}

/**
 * We will be editing notebooks, to close notebooks them we need to ensure changes are saved.
 * Else when we close notebooks as part of teardown in tests, things will not work as nbs are dirty.
 * Solution - swallow saves this way when VSC fires save, we resolve and VSC thinks nb got saved and marked as not dirty.
 */
export async function swallowSavingOfNotebooks() {
    const api = await initialize();
    // We will be editing notebooks, to close notebooks them we need to ensure changes are saved.
    const contentProvider = api.serviceContainer.get<NotebookContentProvider>(NotebookContentProvider);
    sinon.stub(contentProvider, 'saveNotebook').callsFake(noop as any);
    sinon.stub(contentProvider, 'saveNotebookAs').callsFake(noop as any);
}

export async function shutdownAllNotebooks() {
    const api = await initialize();
    const notebookProvider = api.serviceContainer.get<INotebookProvider>(INotebookProvider);
    await Promise.all(notebookProvider.activeNotebooks.map(async (item) => (await item).dispose()));
}
export async function closeNotebooksAndCleanUpAfterTests(disposables: IDisposable[] = []) {
    // We cannot close notebooks if there are any uncommitted changes (UI could hang with prompts etc).
    await commands.executeCommand('workbench.action.files.saveAll');
    await closeActiveWindows();
    disposeAllDisposables(disposables);
    await shutdownAllNotebooks();
    sinon.restore();
}

export async function startJupyter() {
    const { contentProvider, editorProvider } = await getServices();
    // We cannot close notebooks if there are any uncommitted changes (UI could hang with prompts etc).
    await commands.executeCommand('workbench.action.files.saveAll');
    await closeActiveWindows();

    // Create a new nb, add a python cell and execute it.
    // Doing that will start jupyter.
    await editorProvider.createNew();
    await (await insertPythonCell('print("Hello World")', 0)).waitForCellToGetAdded();
    const model = editorProvider.activeEditor?.model;
    editorProvider.activeEditor?.runAllCells();
    // Wait for 15s for Jupyter to start.
    await waitForCondition(async () => (model?.cells[0].data.outputs as []).length > 0, 15_000, 'Cell not executed');

    const saveStub = sinon.stub(contentProvider, 'saveNotebook');
    const saveAsStub = sinon.stub(contentProvider, 'saveNotebookAs');
    try {
        // We cannot close notebooks if there are any uncommitted changes (UI could hang with prompts etc).
        saveStub.callsFake(noop as any);
        saveAsStub.callsFake(noop as any);
        await commands.executeCommand('workbench.action.files.saveAll');
        await closeActiveWindows();
    } finally {
        saveStub.restore();
        saveAsStub.restore();
    }
}

export function assertHasExecutionCompletedSuccessfully(cell: NotebookCell) {
    return (
        (cell.metadata.executionOrder ?? 0) > 0 &&
        cell.metadata.runState === vscodeNotebookEnums.NotebookCellRunState.Success
    );
}
export function hasOutputInVSCode(cell: NotebookCell) {
    assert.ok(cell.outputs.length, 'No output');
}
export function hasOutputInICell(cell: ICell) {
    assert.ok((cell.data.outputs as nbformat.IOutput[]).length, 'No output');
}
export function assertHasTextOutputInVSCode(cell: NotebookCell, text: string, index: number, isExactMatch = true) {
    const cellOutputs = cell.outputs;
    assert.ok(cellOutputs, 'No output');
    assert.equal(cellOutputs[index].outputKind, vscodeNotebookEnums.CellOutputKind.Text, 'Incorrect output kind');
    const outputText = (cellOutputs[index] as any).text.trim();
    if (isExactMatch) {
        assert.equal(outputText, text, 'Incorrect output');
    } else {
        expect(outputText).to.include(text, 'Output does not contain provided text');
    }
}
export function assertHasTextOutputInICell(cell: ICell, text: string, index: number) {
    const cellOutputs = cell.data.outputs as nbformat.IOutput[];
    assert.ok(cellOutputs, 'No output');
    assert.equal((cellOutputs[index].text as string).trim(), text, 'Incorrect output');
}
export function assertVSCCellIsRunning(cell: NotebookCell) {
    assert.equal(cell.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Running);
    return true;
}
export function assertVSCCellIsIdle(cell: NotebookCell) {
    assert.equal(cell.metadata.runState, vscodeNotebookEnums.NotebookCellRunState.Idle);
    return true;
}
