// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { assert, expect, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { ReactWrapper } from 'enzyme';
import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sinon from 'sinon';
import { anything, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { Disposable, TextDocument, TextEditor, Uri, WindowState } from 'vscode';

import { IApplicationShell, IDocumentManager } from '../../client/common/application/types';
import { createDeferred, waitForPromise } from '../../client/common/utils/async';
import { createTemporaryFile } from '../../client/common/utils/fs';
import { noop } from '../../client/common/utils/misc';
import { Identifiers } from '../../client/datascience/constants';
import { InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { JupyterExecutionFactory } from '../../client/datascience/jupyter/jupyterExecutionFactory';
import { ICell, IJupyterExecution, INotebookEditorProvider, INotebookExporter } from '../../client/datascience/types';
import { PythonInterpreter } from '../../client/interpreter/contracts';
import { CellInput } from '../../datascience-ui/interactive-common/cellInput';
import { CellOutput } from '../../datascience-ui/interactive-common/cellOutput';
import { Editor } from '../../datascience-ui/interactive-common/editor';
import { NativeCell } from '../../datascience-ui/native-editor/nativeCell';
import { NativeEditor } from '../../datascience-ui/native-editor/nativeEditor';
import { NativeEditorStateController } from '../../datascience-ui/native-editor/nativeEditorStateController';
import { IKeyboardEvent } from '../../datascience-ui/react-common/event';
import { ImageButton } from '../../datascience-ui/react-common/imageButton';
import { IMonacoEditorState, MonacoEditor } from '../../datascience-ui/react-common/monacoEditor';
import { waitForCondition } from '../common';
import { DataScienceIocContainer } from './dataScienceIocContainer';
import { MockDocumentManager } from './mockDocumentManager';
import {
    addCell,
    closeNotebook,
    createNewEditor,
    getNativeCellResults,
    mountNativeWebView,
    openEditor,
    runMountedTest,
    setupWebview
} from './nativeEditorTestHelpers';
import { waitForUpdate } from './reactHelpers';
import {
    addContinuousMockData,
    addMockData,
    CellPosition,
    createKeyboardEventForCell,
    escapePath,
    findButton,
    getLastOutputCell,
    getNativeFocusedEditor,
    getOutputCell,
    isCellFocused,
    isCellSelected,
    srcDirectory,
    typeCode,
    verifyCellIndex,
    verifyHtmlOnCell,
    waitForMessage,
    waitForMessageResponse
} from './testHelpers';

use(chaiAsPromised);

//import { asyncDump } from '../common/asyncDump';
// tslint:disable:max-func-body-length trailing-comma no-any no-multiline-string
suite('DataScience Native Editor', () => {
    function createFileCell(cell: any, data: any): ICell {
        const newCell = { type: 'preview', id: 'FakeID', file: Identifiers.EmptyFileName, line: 0, state: 2, ...cell };
        newCell.data = { cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: '', ...data };

        return newCell;
    }
    suite('Editor tests', () => {
        const disposables: Disposable[] = [];
        let ioc: DataScienceIocContainer;

        setup(() => {
            ioc = new DataScienceIocContainer();
            ioc.registerDataScienceTypes();

            const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
            appShell.setup(a => a.showErrorMessage(TypeMoq.It.isAnyString())).returns((_e) => Promise.resolve(''));
            appShell.setup(a => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(''));
            appShell.setup(a => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns((_a1: string, a2: string, _a3: string) => Promise.resolve(a2));
            appShell.setup(a => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns((_a1: string, _a2: any, _a3: string, a4: string) => Promise.resolve(a4));
            appShell.setup(a => a.showSaveDialog(TypeMoq.It.isAny())).returns(() => Promise.resolve(Uri.file('foo.ipynb')));
            ioc.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);

        });

        teardown(async () => {
            for (const disposable of disposables) {
                if (!disposable) {
                    continue;
                }
                // tslint:disable-next-line:no-any
                const promise = disposable.dispose() as Promise<any>;
                if (promise) {
                    await promise;
                }
            }
            await ioc.dispose();
        });

        // Uncomment this to debug hangs on exit
        // suiteTeardown(() => {
        //      asyncDump();
        // });

        runMountedTest('Simple text', async (wrapper) => {
            // Create an editor so something is listening to messages
            await createNewEditor(ioc);

            // Add a cell into the UI and wait for it to render
            await addCell(wrapper, ioc, 'a=1\na');

            verifyHtmlOnCell(wrapper, 'NativeCell', '<span>1</span>', 1);
        }, () => { return ioc; });

        runMountedTest('Mime Types', async (wrapper) => {
            // Create an editor so something is listening to messages
            await createNewEditor(ioc);

            const badPanda = `import pandas as pd
df = pd.read("${escapePath(path.join(srcDirectory(), 'DefaultSalesReport.csv'))}")
df.head()`;
            const goodPanda = `import pandas as pd
df = pd.read_csv("${escapePath(path.join(srcDirectory(), 'DefaultSalesReport.csv'))}")
df.head()`;
            const matPlotLib = 'import matplotlib.pyplot as plt\r\nimport numpy as np\r\nx = np.linspace(0,20,100)\r\nplt.plot(x, np.sin(x))\r\nplt.show()';
            const matPlotLibResults = 'img';
            const spinningCursor = `import sys
import time
def spinning_cursor():
    while True:
        for cursor in '|/-\\\\':
            yield cursor
spinner = spinning_cursor()
for _ in range(50):
    sys.stdout.write(next(spinner))
    sys.stdout.flush()
    time.sleep(0.1)
    sys.stdout.write('\\r')`;

            addMockData(ioc, badPanda, `pandas has no attribute 'read'`, 'text/html', 'error');
            addMockData(ioc, goodPanda, `<td>A table</td>`, 'text/html');
            addMockData(ioc, matPlotLib, matPlotLibResults, 'text/html');
            const cursors = ['|', '/', '-', '\\'];
            let cursorPos = 0;
            let loops = 3;
            addContinuousMockData(ioc, spinningCursor, async (_c) => {
                const result = `${cursors[cursorPos]}\r`;
                cursorPos += 1;
                if (cursorPos >= cursors.length) {
                    cursorPos = 0;
                    loops -= 1;
                }
                return Promise.resolve({ result: result, haveMore: loops > 0 });
            });

            await addCell(wrapper, ioc, badPanda, true);
            verifyHtmlOnCell(wrapper, 'NativeCell', `has no attribute 'read'`, CellPosition.Last);

            await addCell(wrapper, ioc, goodPanda, true);
            verifyHtmlOnCell(wrapper, 'NativeCell', `<td>`, CellPosition.Last);

            await addCell(wrapper, ioc, matPlotLib, true);
            verifyHtmlOnCell(wrapper, 'NativeCell', matPlotLibResults, CellPosition.Last);

            await addCell(wrapper, ioc, spinningCursor, true);
            verifyHtmlOnCell(wrapper, 'NativeCell', '<div>', CellPosition.Last);
        }, () => { return ioc; });

        runMountedTest('Click buttons', async (wrapper) => {
            // Goto source should cause the visible editor to be picked as long as its filename matches
            const showedEditor = createDeferred();
            const textEditors: TextEditor[] = [];
            const docManager = TypeMoq.Mock.ofType<IDocumentManager>();
            const visibleEditor = TypeMoq.Mock.ofType<TextEditor>();
            const dummyDocument = TypeMoq.Mock.ofType<TextDocument>();
            dummyDocument.setup(d => d.fileName).returns(() => Uri.file('foo.py').fsPath);
            visibleEditor.setup(v => v.show()).returns(() => showedEditor.resolve());
            visibleEditor.setup(v => v.revealRange(TypeMoq.It.isAny())).returns(noop);
            visibleEditor.setup(v => v.document).returns(() => dummyDocument.object);
            textEditors.push(visibleEditor.object);
            docManager.setup(a => a.visibleTextEditors).returns(() => textEditors);
            ioc.serviceManager.rebindInstance<IDocumentManager>(IDocumentManager, docManager.object);
            // Create an editor so something is listening to messages
            await createNewEditor(ioc);

            // Get a cell into the list
            await addCell(wrapper, ioc, 'a=1\na');

            // find the buttons on the cell itself
            let cell = getLastOutputCell(wrapper, 'NativeCell');
            let ImageButtons = cell.find(ImageButton);
            assert.equal(ImageButtons.length, 7, 'Cell buttons not found');
            let deleteButton = ImageButtons.at(6);

            // Make sure delete works
            let afterDelete = await getNativeCellResults(wrapper, 1, async () => {
                deleteButton.simulate('click');
                return Promise.resolve();
            });
            assert.equal(afterDelete.length, 1, `Delete should remove a cell`);

            // Secondary delete should NOT delete the cell as there should ALWAYS be at
            // least one cell in the file.
            cell = getLastOutputCell(wrapper, 'NativeCell');
            ImageButtons = cell.find(ImageButton);
            assert.equal(ImageButtons.length, 7, 'Cell buttons not found');
            deleteButton = ImageButtons.at(6);

            afterDelete = await getNativeCellResults(wrapper, 1, async () => {
                deleteButton.simulate('click');
                return Promise.resolve();
            });
            assert.equal(afterDelete.length, 1, `Delete should NOT remove the last cell`);
        }, () => { return ioc; });

        runMountedTest('Export', async (wrapper) => {
            // Export should cause the export dialog to come up. Remap appshell so we can check
            const dummyDisposable = {
                dispose: () => { return; }
            };
            let exportCalled = false;
            const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
            appShell.setup(a => a.showErrorMessage(TypeMoq.It.isAnyString())).returns((e) => { throw e; });
            appShell.setup(a => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(''));
            appShell.setup(a => a.showSaveDialog(TypeMoq.It.isAny())).returns(() => {
                exportCalled = true;
                return Promise.resolve(undefined);
            });
            appShell.setup(a => a.setStatusBarMessage(TypeMoq.It.isAny())).returns(() => dummyDisposable);
            ioc.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);

            // Make sure to create the interactive window after the rebind or it gets the wrong application shell.
            await createNewEditor(ioc);
            await addCell(wrapper, ioc, 'a=1\na');

            // Export should cause exportCalled to change to true
            const exportButton = findButton(wrapper, NativeEditor, 6);
            await waitForMessageResponse(ioc, () => exportButton!.simulate('click'));
            assert.equal(exportCalled, true, 'Export should have been called');
        }, () => { return ioc; });

        runMountedTest('RunAllCells', async (wrapper) => {
            addMockData(ioc, 'b=2\nb', 2);
            addMockData(ioc, 'c=3\nc', 3);

            const baseFile = [ {id: 'NotebookImport#0', data: {source: 'a=1\na'}},
            {id: 'NotebookImport#1', data: {source: 'b=2\nb'}},
            {id: 'NotebookImport#2', data: {source: 'c=3\nc'}} ];
            const runAllCells =  baseFile.map(cell => {
                return createFileCell(cell, cell.data);
            });
            const notebook = await ioc.get<INotebookExporter>(INotebookExporter).translateToNotebook(runAllCells, undefined);
            await openEditor(ioc, JSON.stringify(notebook));

            // Export should cause exportCalled to change to true
            const runAllButton = findButton(wrapper, NativeEditor, 3);
            await waitForMessageResponse(ioc, () => runAllButton!.simulate('click'));

            await waitForUpdate(wrapper, NativeEditor, 15);

            verifyHtmlOnCell(wrapper, 'NativeCell', `1`, 0);
            verifyHtmlOnCell(wrapper, 'NativeCell', `2`, 1);
            verifyHtmlOnCell(wrapper, 'NativeCell', `3`, 2);
        }, () => { return ioc; });

        runMountedTest('Startup and shutdown', async (wrapper) => {
            addMockData(ioc, 'b=2\nb', 2);
            addMockData(ioc, 'c=3\nc', 3);

            const baseFile = [ {id: 'NotebookImport#0', data: {source: 'a=1\na'}},
            {id: 'NotebookImport#1', data: {source: 'b=2\nb'}},
            {id: 'NotebookImport#2', data: {source: 'c=3\nc'}} ];
            const runAllCells =  baseFile.map(cell => {
                return createFileCell(cell, cell.data);
            });
            const notebook = await ioc.get<INotebookExporter>(INotebookExporter).translateToNotebook(runAllCells, undefined);
            let editor = await openEditor(ioc, JSON.stringify(notebook));

            // Run everything
            let runAllButton = findButton(wrapper, NativeEditor, 3);
            await waitForMessageResponse(ioc, () => runAllButton!.simulate('click'));
            await waitForUpdate(wrapper, NativeEditor, 15);

            // Close editor. Should still have the server up
            await closeNotebook(editor, wrapper);
            const jupyterExecution = ioc.serviceManager.get<IJupyterExecution>(IJupyterExecution);
            const editorProvider = ioc.serviceManager.get<INotebookEditorProvider>(INotebookEditorProvider);
            const server = await jupyterExecution.getServer(await editorProvider.getNotebookOptions());
            assert.ok(server, 'Server was destroyed on notebook shutdown');

            // Reopen, and rerun
            editor = await openEditor(ioc, JSON.stringify(notebook));
            runAllButton = findButton(wrapper, NativeEditor, 3);
            await waitForMessageResponse(ioc, () => runAllButton!.simulate('click'));
            await waitForUpdate(wrapper, NativeEditor, 15);
            verifyHtmlOnCell(wrapper, 'NativeCell', `1`, 0);
        },
        () => {
                // Disable the warning displayed by nodejs when there are too many listeners.
                EventEmitter.defaultMaxListeners = 15;
                return ioc;
            }
        );

        test('Failure', async () => {
            let fail = true;
            // Make a dummy class that will fail during launch
            class FailedProcess extends JupyterExecutionFactory {
                public getUsableJupyterPython(): Promise<PythonInterpreter | undefined> {
                    if (fail) {
                        return Promise.resolve(undefined);
                    }
                    return super.getUsableJupyterPython();
                }
            }
            ioc.serviceManager.rebind<IJupyterExecution>(IJupyterExecution, FailedProcess);
            ioc.serviceManager.get<IJupyterExecution>(IJupyterExecution);
            addMockData(ioc, 'a=1\na', 1);
            const wrapper = mountNativeWebView(ioc);
            await createNewEditor(ioc);
            await addCell(wrapper, ioc, 'a=1\na', true);

            // Cell should not have the output
            verifyHtmlOnCell(wrapper, 'NativeCell', 'Jupyter cannot be started', 1);

            // Fix failure and try again
            fail = false;
            const cell = getOutputCell(wrapper, 'NativeCell', 1);
            assert.ok(cell, 'Cannot find the first cell');
            const imageButtons = cell!.find(ImageButton);
            assert.equal(imageButtons.length, 7, 'Cell buttons not found');
            const runButton = imageButtons.at(2);
            const update = waitForMessage(ioc, InteractiveWindowMessages.RenderComplete);
            runButton.simulate('click');
            await update;
            verifyHtmlOnCell(wrapper, 'NativeCell', `1`, 1);
        });
    });

    suite('Editor tests', () => {
        let wrapper: ReactWrapper<any, Readonly<{}>, React.Component>;
        const disposables: Disposable[] = [];
        let ioc: DataScienceIocContainer;
        const baseFile = `
{
 "cells": [
  {
   "cell_type": "code",
   "execution_count": 1,
   "metadata": {
    "collapsed": true
   },
   "outputs": [
    {
     "data": {
      "text/plain": [
       "1"
      ]
     },
     "execution_count": 1,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "a=1\\n",
    "a"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 2,
   "metadata": {},
   "outputs": [
    {
     "data": {
      "text/plain": [
       "2"
      ]
     },
     "execution_count": 2,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "b=2\\n",
    "b"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 3,
   "metadata": {},
   "outputs": [
    {
     "data": {
      "text/plain": [
       "3"
      ]
     },
     "execution_count": 3,
     "metadata": {},
     "output_type": "execute_result"
    }
   ],
   "source": [
    "c=3\\n",
    "c"
   ]
  }
 ],
 "metadata": {
  "file_extension": ".py",
  "kernelspec": {
   "display_name": "Python 3",
   "language": "python",
   "name": "python3"
  },
  "language_info": {
   "codemirror_mode": {
    "name": "ipython",
    "version": 3
   },
   "file_extension": ".py",
   "mimetype": "text/x-python",
   "name": "python",
   "nbconvert_exporter": "python",
   "pygments_lexer": "ipython3",
   "version": "3.7.4"
  },
  "mimetype": "text/x-python",
  "name": "python",
  "npconvert_exporter": "python",
  "pygments_lexer": "ipython3",
  "version": 3
 },
 "nbformat": 4,
 "nbformat_minor": 2
}`;
        const addedJSON = JSON.parse(baseFile);
        addedJSON.cells.splice(3, 0, {
            cell_type: 'code',
            execution_count: null,
            metadata: {},
            outputs: [],
            source: []
           });
        const addedJSONFile = JSON.stringify(addedJSON, null, ' ');

        let notebookFile: {
            filePath: string;
            cleanupCallback: Function;
        };
        function initIoc() {
            ioc = new DataScienceIocContainer();
            ioc.registerDataScienceTypes();
        }
        async function setupFunction(this: Mocha.Context) {
            const wrapperPossiblyUndefined = await setupWebview(ioc);
            if (wrapperPossiblyUndefined) {
                wrapper = wrapperPossiblyUndefined;

                addMockData(ioc, 'b=2\nb', 2);
                addMockData(ioc, 'c=3\nc', 3);
                // Use a real file so we can save notebook to a file.
                // This is used in some tests (saving).
                notebookFile = await createTemporaryFile('.ipynb');
                await fs.writeFile(notebookFile.filePath, baseFile);
                await Promise.all([waitForUpdate(wrapper, NativeEditor, 1), openEditor(ioc, baseFile, notebookFile.filePath)]);
            } else {
                // tslint:disable-next-line: no-invalid-this
                this.skip();
            }
        }

        teardown(async () => {
            for (const disposable of disposables) {
                if (!disposable) {
                    continue;
                }
                // tslint:disable-next-line:no-any
                const promise = disposable.dispose() as Promise<any>;
                if (promise) {
                    await promise;
                }
            }
            await ioc.dispose();
            try {
                notebookFile.cleanupCallback();
            } catch {
                noop();
            }
        });

        function clickCell(cellIndex: number) {
            wrapper
                .find(NativeCell)
                .at(cellIndex)
                .simulate('click');
            wrapper.update();
        }

        function simulateKeyPressOnCell(cellIndex: number, keyboardEvent: Partial<IKeyboardEvent> & { code: string }) {
            const event = { ...createKeyboardEventForCell(keyboardEvent), ...keyboardEvent };
            const id = `NotebookImport#${cellIndex}`;
            wrapper
                .find(NativeCell)
                .at(cellIndex)
                .find(CellInput)
                .props().keyDown!(id, event);
            wrapper.update();
        }

        suite('Selection/Focus', () => {
            setup(async function() {
                initIoc();
                // tslint:disable-next-line: no-invalid-this
                await setupFunction.call(this);
            });
            test('None of the cells are selected by default', async () => {
                assert.ok(!isCellSelected(wrapper, 'NativeCell', 0));
                assert.ok(!isCellSelected(wrapper, 'NativeCell', 1));
                assert.ok(!isCellSelected(wrapper, 'NativeCell', 2));
            });

            test('None of the cells are not focused by default', async () => {
                assert.ok(!isCellFocused(wrapper, 'NativeCell', 0));
                assert.ok(!isCellFocused(wrapper, 'NativeCell', 1));
                assert.ok(!isCellFocused(wrapper, 'NativeCell', 2));
            });

            test('Select cells by clicking them', async () => {
                // Click first cell, then second, then third.
                clickCell(0);
                assert.ok(isCellSelected(wrapper, 'NativeCell', 0));
                assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                assert.equal(isCellSelected(wrapper, 'NativeCell', 2), false);

                clickCell(1);
                assert.ok(isCellSelected(wrapper, 'NativeCell', 1));
                assert.equal(isCellSelected(wrapper, 'NativeCell', 0), false);
                assert.equal(isCellSelected(wrapper, 'NativeCell', 2), false);

                clickCell(2);
                assert.ok(isCellSelected(wrapper, 'NativeCell', 2));
                assert.equal(isCellSelected(wrapper, 'NativeCell', 0), false);
                assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
            });
        });

        suite('Keyboard Shortcuts', () => {
            setup(async function() {
                initIoc();
                // tslint:disable-next-line: no-invalid-this
                await setupFunction.call(this);
            });

            test('Traverse cells by using ArrowUp and ArrowDown, k and j', async () => {
                const keyCodesAndPositions = [
                    // When we press arrow down in the first cell, then second cell gets selected.
                    { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 0, expectedSelectedCell: 1 },
                    { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 1, expectedSelectedCell: 2 },
                    // Arrow down on last cell is a noop.
                    { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 2, expectedSelectedCell: 2 },
                    // When we press arrow up in the last cell, then second cell (from bottom) gets selected.
                    { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 2, expectedSelectedCell: 1 },
                    { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 1, expectedSelectedCell: 0 },
                    // Arrow up on last cell is a noop.
                    { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 0, expectedSelectedCell: 0 },

                    // Same tests as above with k and j.
                    { keyCode: 'j', cellIndexToPressKeysOn: 0, expectedSelectedCell: 1 },
                    { keyCode: 'j', cellIndexToPressKeysOn: 1, expectedSelectedCell: 2 },
                    // Arrow down on last cell is a noop.
                    { keyCode: 'j', cellIndexToPressKeysOn: 2, expectedSelectedCell: 2 },
                    { keyCode: 'k', cellIndexToPressKeysOn: 2, expectedSelectedCell: 1 },
                    { keyCode: 'k', cellIndexToPressKeysOn: 1, expectedSelectedCell: 0 },
                    // Arrow up on last cell is a noop.
                    { keyCode: 'k', cellIndexToPressKeysOn: 0, expectedSelectedCell: 0 }
                ];

                // keypress on first cell, then second, then third.
                // Test navigation through all cells, by traversing up and down.
                for (const testItem of keyCodesAndPositions) {
                    simulateKeyPressOnCell(testItem.cellIndexToPressKeysOn, { code: testItem.keyCode });

                    // Check if it is selected.
                    // Only the cell at the index should be selected, as that's what we click.
                    assert.ok(isCellSelected(wrapper, 'NativeCell', testItem.expectedSelectedCell) === true);
                }
            });

            test('Traverse cells by using ArrowUp and ArrowDown, k and j', async () => {
                const keyCodesAndPositions = [
                    // When we press arrow down in the first cell, then second cell gets selected.
                    { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 0, expectedIndex: 1 },
                    { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 1, expectedIndex: 2 },
                    // Arrow down on last cell is a noop.
                    { keyCode: 'ArrowDown', cellIndexToPressKeysOn: 2, expectedIndex: 2 },
                    // When we press arrow up in the last cell, then second cell (from bottom) gets selected.
                    { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 2, expectedIndex: 1 },
                    { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 1, expectedIndex: 0 },
                    // Arrow up on last cell is a noop.
                    { keyCode: 'ArrowUp', cellIndexToPressKeysOn: 0, expectedIndex: 0 }
                ];

                // keypress on first cell, then second, then third.
                // Test navigation through all cells, by traversing up and down.
                for (const testItem of keyCodesAndPositions) {
                    simulateKeyPressOnCell(testItem.cellIndexToPressKeysOn, { code: testItem.keyCode });

                    // Check if it is selected.
                    // Only the cell at the index should be selected, as that's what we click.
                    assert.ok(isCellSelected(wrapper, 'NativeCell', testItem.expectedIndex) === true);
                }
            });

            test('Pressing \'Enter\' on a selected cell, results in focus being set to the code', async () => {
                // For some reason we cannot allow setting focus to monaco editor.
                // Tests are known to fall over if allowed.
                const editor = wrapper
                    .find(NativeCell)
                    .at(1)
                    .find(Editor)
                    .first();
                (editor.instance() as Editor).giveFocus = () => editor.props().focused!();

                const update = waitForUpdate(wrapper, NativeEditor, 1);
                clickCell(1);
                simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                await update;

                // The second cell should be selected.
                assert.ok(isCellFocused(wrapper, 'NativeCell', 1));
            });

            test('Pressing \'Escape\' on a focused cell results in the cell being selected', async () => {
                // First focus the cell.
                let update = waitForUpdate(wrapper, NativeEditor, 1);
                clickCell(1);
                simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                await update;

                // The second cell should be selected.
                assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                assert.equal(isCellFocused(wrapper, 'NativeCell', 1), true);

                // Now hit escape.
                update = waitForUpdate(wrapper, NativeEditor, 1);
                simulateKeyPressOnCell(1, { code: 'Escape' });
                await update;

                // Confirm it is no longer focused, and it is selected.
                assert.equal(isCellSelected(wrapper, 'NativeCell', 1), true);
                assert.equal(isCellFocused(wrapper, 'NativeCell', 1), false);
            });

            test('Pressing \'Shift+Enter\' on a selected cell executes the cell and advances to the next cell', async () => {
                let update = waitForUpdate(wrapper, NativeEditor, 1);
                clickCell(1);
                simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                await update;

                // The 2nd cell should be focused
                assert.ok(isCellFocused(wrapper, 'NativeCell', 1));

                update = waitForUpdate(wrapper, NativeEditor, 7);
                simulateKeyPressOnCell(1, { code: 'Enter', shiftKey: true, editorInfo: undefined });
                await update;
                wrapper.update();

                // Ensure cell was executed.
                verifyHtmlOnCell(wrapper, 'NativeCell', '<span>2</span>', 1);

                // The third cell should be selected.
                assert.ok(isCellSelected(wrapper, 'NativeCell', 2));

                // The third cell should not be focused
                assert.ok(!isCellFocused(wrapper, 'NativeCell', 2));

                // Shift+enter on the last cell, it should behave differently. It should be selected and focused

                // First focus the cell.
                update = waitForUpdate(wrapper, NativeEditor, 2);
                clickCell(2);
                simulateKeyPressOnCell(2, { code: 'Enter', editorInfo: undefined });
                await update;

                // The 3rd cell should be focused
                assert.ok(isCellFocused(wrapper, 'NativeCell', 2));

                update = waitForUpdate(wrapper, NativeEditor, 7);
                simulateKeyPressOnCell(2, { code: 'Enter', shiftKey: true, editorInfo: undefined });
                await update;
                wrapper.update();

                // The fourth cell should be focused and not selected.
                assert.ok(!isCellSelected(wrapper, 'NativeCell', 3));

                // The fourth cell should be focused
                assert.ok(isCellFocused(wrapper, 'NativeCell', 3));
            });

            test('Pressing \'Ctrl+Enter\' on a selected cell executes the cell and cell selection is not changed', async () => {
                const update = waitForUpdate(wrapper, NativeEditor, 7);
                clickCell(1);
                simulateKeyPressOnCell(1, { code: 'Enter', ctrlKey: true, editorInfo: undefined });
                await update;

                // Ensure cell was executed.
                verifyHtmlOnCell(wrapper, 'NativeCell', '<span>2</span>', 1);

                // The first cell should be selected.
                assert.ok(isCellSelected(wrapper, 'NativeCell', 1));
            });

            test('Pressing \'Alt+Enter\' on a selected cell adds a new cell below it', async () => {
                // Initially 3 cells.
                assert.equal(wrapper.find('NativeCell').length, 3);

                const update = waitForUpdate(wrapper, NativeEditor, 1);
                clickCell(1);
                simulateKeyPressOnCell(1, { code: 'Enter', altKey: true, editorInfo: undefined });
                await update;

                // The second cell should be focused.
                assert.ok(isCellFocused(wrapper, 'NativeCell', 2));
                // There should be 4 cells.
                assert.equal(wrapper.find('NativeCell').length, 4);
            });

            test('Auto brackets work', async () => {
                // Initially 3 cells.
                assert.equal(wrapper.find('NativeCell').length, 3);

                // Give focus
                const update = waitForUpdate(wrapper, NativeEditor, 1);
                clickCell(1);
                simulateKeyPressOnCell(1, { code: 'Enter', editorInfo: undefined });
                await update;

                // The first cell should be focused.
                assert.ok(isCellFocused(wrapper, 'NativeCell', 1));

                // Type in something with brackets
                await addCell(wrapper, ioc, '', false);
                const editorEnzyme = getNativeFocusedEditor(wrapper);
                typeCode(editorEnzyme, 'a(');

                // Verify cell content
                const reactEditor = editorEnzyme!.instance() as MonacoEditor;
                const editor = reactEditor.state.editor;
                if (editor) {
                    assert.equal(editor.getModel()!.getValue(), 'a()', 'Text does not have brackets');
                }
            });

            test('Pressing \'d\' on a selected cell twice deletes the cell', async () => {
                // Initially 3 cells.
                assert.equal(wrapper.find('NativeCell').length, 3);

                clickCell(2);
                simulateKeyPressOnCell(2, { code: 'd' });
                simulateKeyPressOnCell(2, { code: 'd' });

                // There should be 2 cells.
                assert.equal(wrapper.find('NativeCell').length, 2);
            });

            test('Pressing \'a\' on a selected cell adds a cell at the current position', async () => {
                // Initially 3 cells.
                assert.equal(wrapper.find('NativeCell').length, 3);

                // const secondCell = wrapper.find('NativeCell').at(1);

                clickCell(0);
                const update = waitForUpdate(wrapper, NativeEditor, 1);
                simulateKeyPressOnCell(0, { code: 'a' });
                await update;

                // There should be 4 cells.
                assert.equal(wrapper.find('NativeCell').length, 4);

                // Verify cell indexes of old items.
                verifyCellIndex(wrapper, 'div[id="NotebookImport#0"]', 1);
                verifyCellIndex(wrapper, 'div[id="NotebookImport#1"]', 2);
                verifyCellIndex(wrapper, 'div[id="NotebookImport#2"]', 3);
            });

            test('Pressing \'b\' on a selected cell adds a cell after the current position', async () => {
                // Initially 3 cells.
                assert.equal(wrapper.find('NativeCell').length, 3);

                clickCell(1);
                const update = waitForUpdate(wrapper, NativeEditor, 1);
                simulateKeyPressOnCell(1, { code: 'b' });
                await update;

                // There should be 4 cells.
                assert.equal(wrapper.find('NativeCell').length, 4);

                // Verify cell indexes of old items.
                verifyCellIndex(wrapper, 'div[id="NotebookImport#0"]', 0);
                verifyCellIndex(wrapper, 'div[id="NotebookImport#1"]', 1);
                verifyCellIndex(wrapper, 'div[id="NotebookImport#2"]', 3);
            });

            test('Toggle visibility of output', async () => {
                // First execute contents of last cell.
                let update = waitForUpdate(wrapper, NativeEditor, 7);
                clickCell(2);
                simulateKeyPressOnCell(2, { code: 'Enter', ctrlKey: true, editorInfo: undefined });
                await update;

                // Ensure cell was executed.
                verifyHtmlOnCell(wrapper, 'NativeCell', '<span>3</span>', 2);

                // Hide the output
                update = waitForUpdate(wrapper, NativeEditor, 1);
                simulateKeyPressOnCell(2, { code: 'o' });
                await update;

                // Ensure cell output is hidden (looking for cell results will throw an exception).
                assert.throws(() => verifyHtmlOnCell(wrapper, 'NativeCell', '<span>3</span>', 2));

                // Display the output
                update = waitForUpdate(wrapper, NativeEditor, 1);
                simulateKeyPressOnCell(2, { code: 'o' });
                await update;

                // Ensure cell output is visible again.
                verifyHtmlOnCell(wrapper, 'NativeCell', '<span>3</span>', 2);
            });

            test('Toggle line numbers using the \'l\' key', async () => {
                clickCell(1);

                const monacoEditorComponent = wrapper
                    .find(NativeCell)
                    .at(1)
                    .find(MonacoEditor)
                    .first();
                const editor = (monacoEditorComponent.instance().state as IMonacoEditorState).editor!;
                const optionsUpdated = sinon.spy(editor, 'updateOptions');

                // Display line numbers.
                simulateKeyPressOnCell(1, { code: 'l' });
                // Confirm monaco editor got updated with line numbers set to turned on.
                assert.equal(optionsUpdated.lastCall.args[0].lineNumbers, 'on');

                // toggle the display of line numbers.
                simulateKeyPressOnCell(1, { code: 'l' });
                // Confirm monaco editor got updated with line numbers set to turned ff.
                assert.equal(optionsUpdated.lastCall.args[0].lineNumbers, 'off');
            });

            test('Toggle markdown and code modes using \'y\' and \'m\' keys', async () => {
                clickCell(1);

                // Switch to markdown
                simulateKeyPressOnCell(1, { code: 'm' });

                // Confirm output cell is rendered and monaco editor is not.
                assert.equal(
                    wrapper
                        .find(NativeCell)
                        .at(1)
                        .find(CellOutput).length,
                    1
                );
                assert.equal(
                    wrapper
                        .find(NativeCell)
                        .at(1)
                        .find(MonacoEditor).length,
                    0
                );

                // Switch back to code mode.
                // At this moment, there's no cell input element, hence send key strokes to the wrapper.
                const wrapperElement = wrapper
                    .find(NativeCell)
                    .at(1)
                    .find('.cell-wrapper')
                    .first();
                wrapperElement.simulate('keyDown', { key: 'y' });
                wrapper.update();

                // Confirm editor is rendered .
                const nativeCell = wrapper.find(NativeCell).at(1);
                assert.equal(
                    nativeCell
                        .find(MonacoEditor).length,
                    1
                );
            });

            test('Test undo using the key \'z\'', async () => {
                clickCell(0);

                // Add, then undo, keep doing at least 3 times and confirm it works as expected.
                for (let i = 0; i < 3; i += 1) {
                    // Add a new cell
                    let update = waitForUpdate(wrapper, NativeEditor, 1);
                    simulateKeyPressOnCell(0, { code: 'a' });
                    await update;

                    // There should be 4 cells and first cell is focused.
                    assert.equal(isCellSelected(wrapper, 'NativeCell', 0), false);
                    assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                    assert.equal(isCellFocused(wrapper, 'NativeCell', 0), true);
                    assert.equal(isCellFocused(wrapper, 'NativeCell', 1), false);
                    assert.equal(wrapper.find('NativeCell').length, 4);

                    // Unfocus the cell
                    update = waitForUpdate(wrapper, NativeEditor, 1);
                    simulateKeyPressOnCell(0, { code: 'Escape' });
                    await update;
                    assert.equal(isCellSelected(wrapper, 'NativeCell', 0), true);

                    // Press 'z' to undo.
                    update = waitForUpdate(wrapper, NativeEditor, 1);
                    simulateKeyPressOnCell(0, { code: 'z' });
                    await update;

                    // There should be 3 cells and first cell is selected & nothing focused.
                    assert.equal(isCellSelected(wrapper, 'NativeCell', 0), true);
                    assert.equal(isCellSelected(wrapper, 'NativeCell', 1), false);
                    assert.equal(wrapper.find('NativeCell').length, 3);
                }
            });

            test('Test save using the key \'s\'', async () => {
                clickCell(0);

                await addCell(wrapper, ioc, 'a=1\na', true);

                const notebookProvider = ioc.get<INotebookEditorProvider>(INotebookEditorProvider);
                const editor = notebookProvider.editors[0];
                assert.ok(editor, 'No editor when saving');
                const savedPromise = createDeferred();
                editor.saved(() => savedPromise.resolve());

                simulateKeyPressOnCell(1, { code: 's', ctrlKey: true });

                await waitForPromise(savedPromise.promise, 1_000);

                assert.ok(!editor!.isDirty, 'Editor should not be dirty after saving');
            });
        });

        suite('Auto Save', () => {
            let controller: NativeEditorStateController;
            let windowStateChangeHandlers: ((e: WindowState) => any)[] = [];
            let handleMessageSpy: sinon.SinonSpy<[string, any?], boolean>;
            setup(async function() {
                handleMessageSpy = sinon.spy(NativeEditorStateController.prototype, 'handleMessage');
                initIoc();

                windowStateChangeHandlers = [];
                // Keep track of all handlers for the onDidChangeWindowState event.
                ioc.applicationShell.setup(app => app.onDidChangeWindowState(TypeMoq.It.isAny())).callback(cb => windowStateChangeHandlers.push(cb));

                // tslint:disable-next-line: no-invalid-this
                await setupFunction.call(this);

                controller = (wrapper
                    .find(NativeEditor)
                    .first()
                    .instance() as NativeEditor).stateController;
            });
            teardown(() => sinon.restore());

            /**
             * Wait for a particular message to be received by the editor component.
             * If message isn't reiceived within a time out, then reject with a timeout error message.
             *
             * @param {string} message
             * @param {number} timeout
             * @returns {Promise<void>}
             */
            async function waitForMessageReceivedEditorComponent(message: string, timeout: number = 5000): Promise<void> {
                const errorMessage = `Timeout waiting for message ${message}`;
                await waitForCondition(async () => handleMessageSpy.calledWith(message, sinon.match.any), timeout, errorMessage);
            }

            /**
             * Wait for notebook to be marked as dirty (within a timeout of 5s).
             *
             * @param {boolean} [dirty=true]
             * @returns {Promise<void>}
             */
            async function waitForNotebookToBeDirty(): Promise<void> {
                // Wait for the notebook to be marked as dirty (the NotebookDirty message will be sent).
                await waitForMessageReceivedEditorComponent(InteractiveWindowMessages.NotebookDirty, 5_000);
                // Wait for the state to get updated.
                await waitForCondition(async () => controller.getState().dirty === true, 1_000, `Timeout waiting for dirty state to get updated to true`);
            }

            /**
             * Wait for notebook to be marked as clean (within a timeout of 5s).
             *
             * @param {boolean} [dirty=true]
             * @returns {Promise<void>}
             */
            async function waitForNotebookToBeClean(): Promise<void> {
                // Wait for the notebook to be marked as dirty (the NotebookDirty message will be sent).
                await waitForMessageReceivedEditorComponent(InteractiveWindowMessages.NotebookClean, 5_000);

                // Wait for the state to get updated.
                await waitForCondition(async () => controller.getState().dirty === false, 2_000, `Timeout waiting for dirty state to get updated to false`);
            }

            /**
             * Make some kind of a change to the notebook.
             *
             * @param {number} cellIndex
             */
            async function modifyNotebook() {
                // (Add a cell into the UI and wait for it to render)
                await addCell(wrapper, ioc, 'a', false);
            }

            test('Auto save notebook every 1s', async () => {
                // Configure notebook to save automatically ever 1s.
                when(ioc.mockedWorkspaceConfig.get('autoSave', 'off')).thenReturn('afterDelay');
                when(ioc.mockedWorkspaceConfig.get<number>('autoSaveDelay', anything())).thenReturn(1_000);
                ioc.forceSettingsChanged(ioc.getSettings().pythonPath);

                /**
                 * Make some changes to a cell of a notebook, then verify the notebook is auto saved.
                 *
                 * @param {number} cellIndex
                 */
                async function makeChangesAndConfirmFileIsUpdated() {
                    const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');

                    await modifyNotebook();
                    await waitForNotebookToBeDirty();

                    // At this point a message should be sent to extension asking it to save.
                    // After the save, the extension should send a message to react letting it know that it was saved successfully.

                    await waitForNotebookToBeClean();
                    // Confirm file has been updated as well.
                    const newFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                    assert.notEqual(newFileContents, notebookFileContents);
                }

                // Make changes & validate (try a couple of times).
                await makeChangesAndConfirmFileIsUpdated();
                await makeChangesAndConfirmFileIsUpdated();
                await makeChangesAndConfirmFileIsUpdated();
            });

            test('File saved with same format', async () => {
                // Configure notebook to save automatically ever 1s.
                when(ioc.mockedWorkspaceConfig.get('autoSave', 'off')).thenReturn('afterDelay');
                when(ioc.mockedWorkspaceConfig.get<number>('autoSaveDelay', anything())).thenReturn(1_000);
                ioc.forceSettingsChanged(ioc.getSettings().pythonPath);
                const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');

                await modifyNotebook();
                await waitForNotebookToBeDirty();

                // At this point a message should be sent to extension asking it to save.
                // After the save, the extension should send a message to react letting it know that it was saved successfully.

                await waitForNotebookToBeClean();
                // Confirm file is not the same. There should be a single cell that's been added
                const newFileContents = await fs.readFile(notebookFile.filePath, 'utf8');
                assert.notEqual(newFileContents, notebookFileContents);
                assert.equal(newFileContents, addedJSONFile);
            });

            test('Should not auto save notebook, ever', async () => {
                const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');

                // Configure notebook to to never save.
                when(ioc.mockedWorkspaceConfig.get('autoSave', 'off')).thenReturn('off');
                when(ioc.mockedWorkspaceConfig.get<number>('autoSaveDelay', anything())).thenReturn(1000);
                // Update the settings and wait for the component to receive it and process it.
                const promise = waitForMessageReceivedEditorComponent(InteractiveWindowMessages.UpdateSettings, 1_000);
                ioc.forceSettingsChanged(ioc.getSettings().pythonPath);
                await promise;

                await modifyNotebook();
                await waitForNotebookToBeDirty();

                // Now that the notebook is dirty, change the active editor.
                const docManager = ioc.get<IDocumentManager>(IDocumentManager) as MockDocumentManager;
                docManager.didChangeEmitter.fire();
                // Also, send notification about changes to window state.
                windowStateChangeHandlers.forEach(item => item({ focused: false }));
                windowStateChangeHandlers.forEach(item => item({ focused: true }));

                // Confirm the message is not clean, trying to wait for it to get saved will timeout (i.e. rejected).
                await expect(waitForNotebookToBeClean()).to.eventually.be.rejected;
                // Confirm file has not been updated as well.
                assert.equal(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
            });

            async function testAutoSavingWhenEditorFocusChanges(newEditor: TextEditor | undefined) {
                const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');

                await modifyNotebook();
                await waitForNotebookToBeDirty();

                // Configure notebook to save when active editor changes.
                when(ioc.mockedWorkspaceConfig.get('autoSave', 'off')).thenReturn('onFocusChange');
                ioc.forceSettingsChanged(ioc.getSettings().pythonPath);

                // Now that the notebook is dirty, change the active editor.
                const docManager = ioc.get<IDocumentManager>(IDocumentManager) as MockDocumentManager;
                docManager.didChangeEmitter.fire(newEditor);

                // At this point a message should be sent to extension asking it to save.
                // After the save, the extension should send a message to react letting it know that it was saved successfully.

                await waitForNotebookToBeClean();
                // Confirm file has been updated as well.
                assert.notEqual(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
            }

            test('Auto save notebook when focus changes from active editor to none', () => testAutoSavingWhenEditorFocusChanges(undefined));

            test('Auto save notebook when focus changes from active editor to something else', () =>
                testAutoSavingWhenEditorFocusChanges(TypeMoq.Mock.ofType<TextEditor>().object));

            test('Should not auto save notebook when active editor changes', async () => {
                const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');

                await modifyNotebook();
                await waitForNotebookToBeDirty();

                // Configure notebook to save when window state changes.
                when(ioc.mockedWorkspaceConfig.get('autoSave', 'off')).thenReturn('onWindowChange');
                ioc.forceSettingsChanged(ioc.getSettings().pythonPath);

                // Now that the notebook is dirty, change the active editor.
                // This should not trigger a save of notebook (as its configured to save only when window state changes).
                const docManager = ioc.get<IDocumentManager>(IDocumentManager) as MockDocumentManager;
                docManager.didChangeEmitter.fire();

                // Confirm the message is not clean, trying to wait for it to get saved will timeout (i.e. rejected).
                await expect(waitForNotebookToBeClean()).to.eventually.be.rejected;
                // Confirm file has not been updated as well.
                assert.equal(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
            });

            async function testAutoSavingWithChangesToWindowState(focused: boolean) {
                const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');

                await modifyNotebook();
                await waitForNotebookToBeDirty();

                // Configure notebook to save when active editor changes.
                when(ioc.mockedWorkspaceConfig.get('autoSave', 'off')).thenReturn('onWindowChange');
                ioc.forceSettingsChanged(ioc.getSettings().pythonPath);

                // Now that the notebook is dirty, send notification about changes to window state.
                windowStateChangeHandlers.forEach(item => item({ focused }));

                // At this point a message should be sent to extension asking it to save.
                // After the save, the extension should send a message to react letting it know that it was saved successfully.

                await waitForNotebookToBeClean();
                // Confirm file has been updated as well.
                assert.notEqual(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
            }

            test('Auto save notebook when window state changes to being not focused', async () => testAutoSavingWithChangesToWindowState(false));
            test('Auto save notebook when window state changes to being focused', async () => testAutoSavingWithChangesToWindowState(true));

            test('Should not auto save notebook when window state changes', async () => {
                const notebookFileContents = await fs.readFile(notebookFile.filePath, 'utf8');

                await modifyNotebook();
                await waitForNotebookToBeDirty();

                // Configure notebook to save when active editor changes.
                when(ioc.mockedWorkspaceConfig.get('autoSave', 'off')).thenReturn('onFocusChange');
                ioc.forceSettingsChanged(ioc.getSettings().pythonPath);

                // Now that the notebook is dirty, change window state.
                // This should not trigger a save of notebook (as its configured to save only when focus is changed).
                windowStateChangeHandlers.forEach(item => item({ focused: false }));
                windowStateChangeHandlers.forEach(item => item({ focused: true }));

                // Confirm the message is not clean, trying to wait for it to get saved will timeout (i.e. rejected).
                await expect(waitForNotebookToBeClean()).to.eventually.be.rejected;
                // Confirm file has not been updated as well.
                assert.equal(await fs.readFile(notebookFile.filePath, 'utf8'), notebookFileContents);
            });
        });
    });
});
