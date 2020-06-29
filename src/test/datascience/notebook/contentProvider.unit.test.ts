// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';
// tslint:disable-next-line: no-var-requires no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');
import type { NotebookContentProvider as VSCodeNotebookContentProvider } from 'vscode-proposed';
import { NotebookCellData } from '../../../../typings/vscode-proposed';
import { ICommandManager } from '../../../client/common/application/types';
import { MARKDOWN_LANGUAGE, PYTHON_LANGUAGE } from '../../../client/common/constants';
import { INotebookStorageProvider } from '../../../client/datascience/interactive-ipynb/notebookStorageProvider';
import { NotebookContentProvider } from '../../../client/datascience/notebook/contentProvider';
import { NotebookEditorCompatibilitySupport } from '../../../client/datascience/notebook/notebookEditorCompatibilitySupport';
import { CellState, INotebookModel } from '../../../client/datascience/types';
// tslint:disable: no-any
suite('Data Science - NativeNotebook ContentProvider', () => {
    let storageProvider: INotebookStorageProvider;
    let contentProvider: VSCodeNotebookContentProvider;
    const fileUri = Uri.file('a.ipynb');
    setup(async () => {
        storageProvider = mock<INotebookStorageProvider>();
        const commandManager = mock<ICommandManager>();
        const compatSupport = mock(NotebookEditorCompatibilitySupport);
        when(compatSupport.canOpenWithOurNotebookEditor(anything())).thenReturn(true);
        when(compatSupport.canOpenWithVSCodeNotebookEditor(anything())).thenReturn(true);
        contentProvider = new NotebookContentProvider(
            instance(storageProvider),
            instance(commandManager),
            instance(compatSupport)
        );
    });

    test('Return notebook with 2 cells', async () => {
        const model: Partial<INotebookModel> = {
            cells: [
                {
                    data: {
                        cell_type: 'code',
                        execution_count: 10,
                        hasExecutionOrder: true,
                        outputs: [],
                        source: 'print(1)',
                        metadata: {}
                    },
                    file: 'a.ipynb',
                    id: 'MyCellId1',
                    line: 0,
                    state: CellState.init
                },
                {
                    data: {
                        cell_type: 'markdown',
                        hasExecutionOrder: false,
                        source: '# HEAD',
                        metadata: {}
                    },
                    file: 'a.ipynb',
                    id: 'MyCellId2',
                    line: 0,
                    state: CellState.init
                }
            ]
        };
        when(storageProvider.load(anything(), anything(), anything(), anything())).thenResolve(
            (model as unknown) as INotebookModel
        );

        const notebook = await contentProvider.openNotebook(fileUri, {});

        assert.isOk(notebook);
        assert.deepEqual(notebook.languages, [PYTHON_LANGUAGE]);
        // ignore metadata we add.
        notebook.cells.forEach((cell) => delete cell.metadata.custom);

        assert.deepEqual(notebook.cells, [
            {
                cellKind: (vscodeNotebookEnums as any).CellKind.Code,
                language: PYTHON_LANGUAGE,
                outputs: [],
                source: 'print(1)',
                metadata: {
                    editable: true,
                    executionOrder: 10,
                    hasExecutionOrder: true,
                    runState: (vscodeNotebookEnums as any).NotebookCellRunState.Success,
                    runnable: true
                }
            },
            {
                cellKind: (vscodeNotebookEnums as any).CellKind.Markdown,
                language: MARKDOWN_LANGUAGE,
                outputs: [],
                source: '# HEAD',
                metadata: {
                    editable: true,
                    executionOrder: undefined,
                    hasExecutionOrder: false,
                    runState: (vscodeNotebookEnums as any).NotebookCellRunState.Idle,
                    runnable: false
                }
            }
        ]);
    });

    test('Return notebook with csharp language', async () => {
        const model: Partial<INotebookModel> = {
            metadata: {
                language_info: {
                    name: 'csharp'
                },
                orig_nbformat: 5
            },
            cells: [
                {
                    data: {
                        cell_type: 'code',
                        execution_count: 10,
                        hasExecutionOrder: true,
                        outputs: [],
                        source: 'Console.WriteLine("1")',
                        metadata: {}
                    },
                    file: 'a.ipynb',
                    id: 'MyCellId1',
                    line: 0,
                    state: CellState.init
                },
                {
                    data: {
                        cell_type: 'markdown',
                        hasExecutionOrder: false,
                        source: '# HEAD',
                        metadata: {}
                    },
                    file: 'a.ipynb',
                    id: 'MyCellId2',
                    line: 0,
                    state: CellState.init
                }
            ]
        };
        when(storageProvider.load(anything(), anything(), anything(), anything())).thenResolve(
            (model as unknown) as INotebookModel
        );

        const notebook = await contentProvider.openNotebook(fileUri, {});

        assert.isOk(notebook);
        assert.deepEqual(notebook.languages, ['csharp']);
        // ignore metadata we add.
        notebook.cells.forEach((cell: NotebookCellData) => delete cell.metadata.custom);

        assert.deepEqual(notebook.cells, [
            {
                cellKind: (vscodeNotebookEnums as any).CellKind.Code,
                language: 'csharp',
                outputs: [],
                source: 'Console.WriteLine("1")',
                metadata: {
                    editable: true,
                    executionOrder: 10,
                    hasExecutionOrder: true,
                    runState: (vscodeNotebookEnums as any).NotebookCellRunState.Success,
                    runnable: true
                }
            },
            {
                cellKind: (vscodeNotebookEnums as any).CellKind.Markdown,
                language: MARKDOWN_LANGUAGE,
                outputs: [],
                source: '# HEAD',
                metadata: {
                    editable: true,
                    executionOrder: undefined,
                    hasExecutionOrder: false,
                    runState: (vscodeNotebookEnums as any).NotebookCellRunState.Idle,
                    runnable: false
                }
            }
        ]);
    });
    test('Verify mime types and order', () => {
        // https://github.com/microsoft/vscode-python/issues/11880
    });
});
