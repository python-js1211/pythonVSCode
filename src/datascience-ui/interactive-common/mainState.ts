// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
// tslint:disable-next-line: no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as path from 'path';

import { IDataScienceSettings } from '../../client/common/types';
import { CellMatcher } from '../../client/datascience/cellMatcher';
import { concatMultilineString, splitMultilineString } from '../../client/datascience/common';
import { Identifiers } from '../../client/datascience/constants';
import { CellState, ICell, IJupyterVariable, IMessageCell } from '../../client/datascience/types';
import { noop } from '../../test/core';
import { InputHistory } from './inputHistory';

export interface ICellViewModel {
    cell: ICell;
    inputBlockShow: boolean;
    inputBlockOpen: boolean;
    inputBlockText: string;
    inputBlockCollapseNeeded: boolean;
    editable: boolean;
    directInput?: boolean;
    showLineNumbers?: boolean;
    hideOutput?: boolean;
    useQuickEdit?: boolean;
    inputBlockToggled(id: string): void;
}

export interface IMainState {
    cellVMs: ICellViewModel[];
    editCellVM: ICellViewModel | undefined;
    busy: boolean;
    skipNextScroll?: boolean;
    undoStack: ICellViewModel[][];
    redoStack: ICellViewModel[][];
    submittedText: boolean;
    history: InputHistory;
    rootStyle?: string;
    rootCss?: string;
    font: IFont;
    theme?: string;
    forceDark?: boolean;
    monacoTheme?: string;
    tokenizerLoaded?: boolean;
    knownDark: boolean;
    editorOptions?: monacoEditor.editor.IEditorOptions;
    currentExecutionCount: number;
    variablesVisible: boolean;
    variables: IJupyterVariable[];
    pendingVariableCount: number;
    debugging: boolean;
    dirty?: boolean;
    selectedCell?: string;
    focusedCell?: string;
    enableGather: boolean;
    isAtBottom: boolean;
    newCell?: string;
    loadTotal?: number;
}

export interface IFont {
    size: number;
    family: string;
}

// tslint:disable-next-line: no-multiline-string
const darkStyle = `
        :root {
            --code-comment-color: #6A9955;
            --code-numeric-color: #b5cea8;
            --code-string-color: #ce9178;
            --code-variable-color: #9CDCFE;
            --code-type-color: #4EC9B0;
            --code-font-family: Consolas, 'Courier New', monospace;
            --code-font-size: 14px;
        }
`;

// This function generates test state when running under a browser instead of inside of
export function generateTestState(inputBlockToggled: (id: string) => void, filePath: string = '', editable: boolean = false): IMainState {
    return {
        cellVMs: generateVMs(inputBlockToggled, filePath, editable),
        editCellVM: createEditableCellVM(1),
        busy: true,
        skipNextScroll: false,
        undoStack: [],
        redoStack: [],
        submittedText: false,
        history: new InputHistory(),
        rootStyle: darkStyle,
        tokenizerLoaded: true,
        editorOptions: {},
        currentExecutionCount: 0,
        knownDark: false,
        variablesVisible: false,
        variables: [
            {
                name: 'foo',
                value: 'bar',
                type: 'DataFrame',
                size: 100,
                supportsDataExplorer: true,
                shape: '(100, 100)',
                truncated: true,
                count: 100
            }
        ],
        pendingVariableCount: 0,
        debugging: false,
        enableGather: true,
        isAtBottom: true,
        font: {
            size: 14,
            family: 'Consolas, \'Courier New\', monospace'
        }
    };
}

export function createEmptyCell(id: string | undefined, executionCount: number | null): ICell {
    return {
        data:
        {
            cell_type: 'code', // We should eventually allow this to change to entering of markdown?
            execution_count: executionCount,
            metadata: {},
            outputs: [],
            source: ''
        },
        id: id ? id : Identifiers.EditCellId,
        file: Identifiers.EmptyFileName,
        line: 0,
        state: CellState.finished,
        type: 'execute'
    };
}

export function createEditableCellVM(executionCount: number): ICellViewModel {
    return {
        cell: createEmptyCell(undefined, executionCount),
        editable: true,
        inputBlockOpen: true,
        inputBlockShow: true,
        inputBlockText: '',
        inputBlockCollapseNeeded: false,
        inputBlockToggled: noop
    };
}

export function extractInputText(inputCell: ICell, settings: IDataScienceSettings | undefined): string {
    let source: string[] = [];
    if (inputCell.data.source) {
        source = splitMultilineString(cloneDeep(inputCell.data.source));
    }
    const matcher = new CellMatcher(settings);

    // Eliminate the #%% on the front if it has nothing else on the line
    if (source.length > 0) {
        const title = matcher.exec(source[0].trim());
        if (title !== undefined && title.length <= 0) {
            source.splice(0, 1);
        }
        // Eliminate the lines to hide if we're debugging
        if (inputCell.extraLines) {
            inputCell.extraLines.forEach(i => source.splice(i, 1));
            inputCell.extraLines = undefined;
        }
    }

    return concatMultilineString(source);
}

export function createCellVM(inputCell: ICell, settings: IDataScienceSettings | undefined, inputBlockToggled: (id: string) => void, editable: boolean): ICellViewModel {
    let inputLinesCount = 0;
    const inputText = inputCell.data.cell_type === 'code' ? extractInputText(inputCell, settings) : '';
    if (inputText) {
        inputLinesCount = inputText.split('\n').length;
    }

    return {
        cell: inputCell,
        editable,
        inputBlockOpen: true,
        inputBlockShow: true,
        inputBlockText: inputText,
        inputBlockCollapseNeeded: (inputLinesCount > 1),
        inputBlockToggled: inputBlockToggled
    };
}

function generateVMs(inputBlockToggled: (id: string) => void, filePath: string, editable: boolean): ICellViewModel[] {
    const cells = generateCells(filePath);
    return cells.map((cell: ICell) => {
        const vm = createCellVM(cell, undefined, inputBlockToggled, editable);
        vm.useQuickEdit = false;
        return vm;
    });
}

function generateCells(filePath: string): ICell[] {
    // Dupe a bunch times for perf reasons
    let cellData: (nbformat.ICodeCell | nbformat.IMarkdownCell | nbformat.IRawCell | IMessageCell)[] = [];
    for (let i = 0; i < 10; i += 1) {
        cellData = [...cellData, ...generateCellData()];
    }
    return cellData.map((data: nbformat.ICodeCell | nbformat.IMarkdownCell | nbformat.IRawCell | IMessageCell, key: number) => {
        return {
            id: key.toString(),
            file: path.join(filePath, 'foo.py'),
            line: 1,
            state: key === cellData.length - 1 ? CellState.executing : CellState.finished,
            type: key === 3 ? 'preview' : 'execute',
            data: data
        };
    });
}

//tslint:disable:max-func-body-length
function generateCellData(): (nbformat.ICodeCell | nbformat.IMarkdownCell | nbformat.IRawCell | IMessageCell)[] {

    // Hopefully new entries here can just be copied out of a jupyter notebook (ipynb)
    return [
        {
            // These are special. Sys_info is our own custom cell
            cell_type: 'messages',
            messages: [
                'You have this python data:',
                'c:\\data\\python.exe',
                '3.9.9.9 The Uber Version',
                '(5, 9, 9)',
                'https:\\localhost\\token?=9343p0843084039483084308430984038403840938409384098304983094803948093848034809384'
            ],
            source: [],
            metadata: {}
        },
        {
            cell_type: 'code',
            execution_count: 467,
            metadata: {
                slideshow: {
                    slide_type: '-'
                }
            },
            outputs: [
                {
                    data: {
                        // tslint:disable-next-line: no-multiline-string
                        'text/html': [`
                            <div style="
                            overflow: auto;
                        ">
                        <style scoped="">
                            .dataframe tbody tr th:only-of-type {
                                vertical-align: middle;
                            }
                            .dataframe tbody tr th {
                                vertical-align: top;
                            }
                            .dataframe thead th {
                                text-align: right;
                            }
                        </style>
                        <table border="1" class="dataframe">
                          <thead>
                            <tr style="text-align: right;">
                              <th></th>
                              <th>0</th>
                              <th>1</th>
                              <th>2</th>
                              <th>3</th>
                              <th>4</th>
                              <th>5</th>
                              <th>6</th>
                              <th>7</th>
                              <th>8</th>
                              <th>9</th>
                              <th>...</th>
                              <th>2990</th>
                              <th>2991</th>
                              <th>2992</th>
                              <th>2993</th>
                              <th>2994</th>
                              <th>2995</th>
                              <th>2996</th>
                              <th>2997</th>
                              <th>2998</th>
                              <th>2999</th>
                            </tr>
                            <tr>
                              <th>idx</th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <th>2007-01-31</th>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>...</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                              <td>37.060604</td>
                            </tr>
                            <tr>
                              <th>2007-02-28</th>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>...</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                              <td>20.603407</td>
                            </tr>
                            <tr>
                              <th>2007-03-31</th>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>...</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                              <td>6.142031</td>
                            </tr>
                            <tr>
                              <th>2007-04-30</th>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>...</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                              <td>6.931635</td>
                            </tr>
                            <tr>
                              <th>2007-05-31</th>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>...</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                              <td>52.642243</td>
                            </tr>
                          </tbody>
                        </table>
                        <p>5 rows × 3000 columns</p>
                        </div>`
                        ]
                    },
                    execution_count: 4,
                    metadata: {},
                    output_type: 'execute_result'
                }
            ],
            source: [
                'myvar = \"\"\" # Lorem Ipsum\n',
                '\n',
                'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n',
                'Nullam eget varius ligula, eget fermentum mauris.\n',
                'Cras ultrices, enim sit amet iaculis ornare, nisl nibh aliquet elit, sed ultrices velit ipsum dignissim nisl.\n',
                'Nunc quis orci ante. Vivamus vel blandit velit.\n","Sed mattis dui diam, et blandit augue mattis vestibulum.\n',
                'Suspendisse ornare interdum velit. Suspendisse potenti.\n',
                'Morbi molestie lacinia sapien nec porttitor. Nam at vestibulum nisi.\n',
                '\"\"\" '
            ]
        },
        {
            cell_type: 'markdown',
            metadata: {},
            source: [
                '## Cell 3\n',
                'Here\'s some markdown\n',
                '- A List\n',
                '- Of Items'
            ]
        },
        {
            cell_type: 'code',
            execution_count: 1,
            metadata: {},
            outputs: [
                {
                    ename: 'NameError',
                    evalue: 'name "df" is not defined',
                    output_type: 'error',
                    traceback: [
                        '\u001b[1;31m---------------------------------------------------------------------------\u001b[0m',
                        '\u001b[1;31mNameError\u001b[0m                                 Traceback (most recent call last)',
                        '\u001b[1;32m<ipython-input-1-00cf07b74dcd>\u001b[0m in \u001b[0;36m<module>\u001b[1;34m()\u001b[0m\n\u001b[1;32m----> 1\u001b[1;33m \u001b[0mdf\u001b[0m\u001b[1;33m\u001b[0m\u001b[0m\n\u001b[0m',
                        '\u001b[1;31mNameError\u001b[0m: name "df" is not defined'
                    ]
                }
            ],
            source: [
                'df'
            ]
        },
        {
            cell_type: 'code',
            execution_count: 1,
            metadata: {},
            outputs: [
                {
                    ename: 'NameError',
                    evalue: 'name "df" is not defined',
                    output_type: 'error',
                    traceback: [
                        '\u001b[1;31m---------------------------------------------------------------------------\u001b[0m',
                        '\u001b[1;31mNameError\u001b[0m                                 Traceback (most recent call last)',
                        '\u001b[1;32m<ipython-input-1-00cf07b74dcd>\u001b[0m in \u001b[0;36m<module>\u001b[1;34m()\u001b[0m\n\u001b[1;32m----> 1\u001b[1;33m \u001b[0mdf\u001b[0m\u001b[1;33m\u001b[0m\u001b[0m\n\u001b[0m',
                        '\u001b[1;31mNameError\u001b[0m: name "df" is not defined'
                    ]
                }
            ],
            source: [
                'df'
            ]
        }
    ];
}
