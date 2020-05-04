// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { expect } from 'chai';
import { ReactWrapper } from 'enzyme';
import { parse } from 'node-html-parser';
import * as React from 'react';
import * as AdazzleReactDataGrid from 'react-data-grid';
import { Disposable } from 'vscode';

import { RunByLine } from '../../client/common/experimentGroups';
import { InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { IJupyterVariable } from '../../client/datascience/types';
import { DataScienceIocContainer } from './dataScienceIocContainer';
import { addCode } from './interactiveWindowTestHelpers';
import { addCell, createNewEditor } from './nativeEditorTestHelpers';
import {
    openVariableExplorer,
    runDoubleTest,
    runInteractiveTest,
    waitForMessage,
    waitForVariablesUpdated
} from './testHelpers';

// tslint:disable: no-var-requires no-require-imports
const rangeInclusive = require('range-inclusive');

// tslint:disable:max-func-body-length trailing-comma no-any no-multiline-string
[false, true].forEach((runByLine) => {
    suite(`DataScience Interactive Window variable explorer tests with RunByLine set to ${runByLine}`, () => {
        const disposables: Disposable[] = [];
        let ioc: DataScienceIocContainer;
        let createdNotebook = false;

        suiteSetup(function () {
            // These test require python, so only run with a non-mocked jupyter
            const isRollingBuild = process.env ? process.env.VSCODE_PYTHON_ROLLING !== undefined : false;
            if (!isRollingBuild) {
                // tslint:disable-next-line:no-console
                console.log('Skipping Variable Explorer tests. Requires python environment');
                // tslint:disable-next-line:no-invalid-this
                this.skip();
            }
        });

        setup(async () => {
            ioc = new DataScienceIocContainer();
            ioc.setExperimentState(RunByLine.experiment, runByLine);
            ioc.registerDataScienceTypes();
            createdNotebook = false;
            await ioc.activate();
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
        //suiteTeardown(() => {
        //      asyncDump();
        //});

        async function addCodeImpartial(
            wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
            code: string,
            waitForVariables: boolean = true,
            waitForVariablesCount: number = 1,
            expectError: boolean = false
        ): Promise<ReactWrapper<any, Readonly<{}>, React.Component>> {
            const variablesUpdated = waitForVariables
                ? waitForVariablesUpdated(ioc, waitForVariablesCount)
                : Promise.resolve();
            const nodes = wrapper.find('InteractivePanel');
            if (nodes.length > 0) {
                const result = await addCode(ioc, wrapper, code, expectError);
                await variablesUpdated;
                return result;
            } else {
                // For the native editor case, we need to create an editor before hand.
                if (!createdNotebook) {
                    await createNewEditor(ioc);
                    createdNotebook = true;
                }
                await addCell(wrapper, ioc, code, true);
                await variablesUpdated;
                return wrapper;
            }
        }

        runInteractiveTest(
            'Variable explorer - Exclude',
            async (wrapper) => {
                const basicCode: string = `import numpy as np
import pandas as pd
value = 'hello world'`;
                const basicCode2: string = `value2 = 'hello world 2'`;

                openVariableExplorer(wrapper);

                await addCodeImpartial(wrapper, 'a=1\na');
                await addCodeImpartial(wrapper, basicCode, true);

                // We should show a string and show an int, the modules should be hidden
                let targetVariables: IJupyterVariable[] = [
                    {
                        name: 'a',
                        value: '1',
                        supportsDataExplorer: false,
                        type: 'int',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    // tslint:disable-next-line:quotemark
                    {
                        name: 'value',
                        value: 'hello world',
                        supportsDataExplorer: false,
                        type: 'str',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    }
                ];
                verifyVariables(wrapper, targetVariables);

                // Update our exclude list to exclude strings
                ioc.getSettings().datascience.variableExplorerExclude = `${
                    ioc.getSettings().datascience.variableExplorerExclude
                };str`;

                // Add another string and check our vars, strings should be hidden
                await addCodeImpartial(wrapper, basicCode2, true);

                targetVariables = [
                    {
                        name: 'a',
                        value: '1',
                        supportsDataExplorer: false,
                        type: 'int',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    }
                ];
                verifyVariables(wrapper, targetVariables);
            },
            () => {
                return ioc;
            }
        );

        runInteractiveTest(
            'Variable explorer - Update',
            async (wrapper) => {
                const basicCode: string = `value = 'hello world'`;
                const basicCode2: string = `value2 = 'hello world 2'`;

                openVariableExplorer(wrapper);

                await addCodeImpartial(wrapper, 'a=1\na');

                // Check that we have just the 'a' variable
                let targetVariables: IJupyterVariable[] = [
                    {
                        name: 'a',
                        value: '1',
                        supportsDataExplorer: false,
                        type: 'int',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    }
                ];
                verifyVariables(wrapper, targetVariables);

                // Add another variable and check it
                await addCodeImpartial(wrapper, basicCode, true);

                targetVariables = [
                    {
                        name: 'a',
                        value: '1',
                        supportsDataExplorer: false,
                        type: 'int',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    {
                        name: 'value',
                        value: 'hello world',
                        supportsDataExplorer: false,
                        type: 'str',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    }
                ];
                verifyVariables(wrapper, targetVariables);

                // Add a second variable and check it
                await addCodeImpartial(wrapper, basicCode2, true);

                targetVariables = [
                    {
                        name: 'a',
                        value: '1',
                        supportsDataExplorer: false,
                        type: 'int',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    {
                        name: 'value',
                        value: 'hello world',
                        supportsDataExplorer: false,
                        type: 'str',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    // tslint:disable-next-line:quotemark
                    {
                        name: 'value2',
                        value: 'hello world 2',
                        supportsDataExplorer: false,
                        type: 'str',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    }
                ];
                verifyVariables(wrapper, targetVariables);
            },
            () => {
                return ioc;
            }
        );

        // Test our display of basic types. We render 8 rows by default so only 8 values per test
        runInteractiveTest(
            'Variable explorer - Types A',
            async (wrapper) => {
                const basicCode: string = `myList = [1, 2, 3]
mySet = set([42])
myDict = {'a': 1}`;

                openVariableExplorer(wrapper);

                await addCodeImpartial(wrapper, 'a=1\na');
                await addCodeImpartial(wrapper, basicCode, true);

                const targetVariables: IJupyterVariable[] = [
                    {
                        name: 'a',
                        value: '1',
                        supportsDataExplorer: false,
                        type: 'int',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    // tslint:disable-next-line:quotemark
                    {
                        name: 'myDict',
                        value: "{'a': 1}",
                        supportsDataExplorer: true,
                        type: 'dict',
                        size: 54,
                        shape: '',
                        count: 1,
                        truncated: false
                    },
                    {
                        name: 'myList',
                        value: '[1, 2, 3]',
                        supportsDataExplorer: true,
                        type: 'list',
                        size: 54,
                        shape: '',
                        count: 3,
                        truncated: false
                    },
                    // Set can vary between python versions, so just don't both to check the value, just see that we got it
                    {
                        name: 'mySet',
                        value: undefined,
                        supportsDataExplorer: false,
                        type: 'set',
                        size: 54,
                        shape: '',
                        count: 1,
                        truncated: false
                    }
                ];
                verifyVariables(wrapper, targetVariables);
            },
            () => {
                return ioc;
            }
        );

        runInteractiveTest(
            'Variable explorer - Basic B',
            async (wrapper) => {
                const basicCode: string = `import numpy as np
import pandas as pd
myComplex = complex(1, 1)
myInt = 99999999
myFloat = 9999.9999
mynpArray = np.array([1.0, 2.0, 3.0])
myDataframe = pd.DataFrame(mynpArray)
mySeries = myDataframe[0]
myTuple = 1,2,3,4,5,6,7,8,9
`;

                openVariableExplorer(wrapper);

                await addCodeImpartial(wrapper, 'a=1\na');
                await addCodeImpartial(wrapper, basicCode, true, 2);

                const targetVariables: IJupyterVariable[] = [
                    {
                        name: 'a',
                        value: '1',
                        supportsDataExplorer: false,
                        type: 'int',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    {
                        name: 'myComplex',
                        value: '(1+1j)',
                        supportsDataExplorer: false,
                        type: 'complex',
                        size: 54,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    {
                        name: 'myDataframe',
                        value: `0
0 1.0
1 2.0
2 3.0`,
                        supportsDataExplorer: true,
                        type: 'DataFrame',
                        size: 54,
                        shape: '(3, 1)',
                        count: 0,
                        truncated: false
                    },
                    {
                        name: 'myFloat',
                        value: '9999.9999',
                        supportsDataExplorer: false,
                        type: 'float',
                        size: 58,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    {
                        name: 'myInt',
                        value: '99999999',
                        supportsDataExplorer: false,
                        type: 'int',
                        size: 56,
                        shape: '',
                        count: 0,
                        truncated: false
                    },
                    // tslint:disable:no-trailing-whitespace
                    {
                        name: 'mySeries',
                        value: `0 1.0
1 2.0
2 3.0
Name: 0, dtype: float64`,
                        supportsDataExplorer: true,
                        type: 'Series',
                        size: 54,
                        shape: '(3,)',
                        count: 0,
                        truncated: false
                    },
                    {
                        name: 'myTuple',
                        value: '(1, 2, 3, 4, 5, 6, 7, 8, 9)',
                        supportsDataExplorer: false,
                        type: 'tuple',
                        size: 54,
                        shape: '9',
                        count: 0,
                        truncated: false
                    },
                    {
                        name: 'mynpArray',
                        value: '[1. 2. 3.]',
                        supportsDataExplorer: true,
                        type: 'ndarray',
                        size: 54,
                        shape: '(3,)',
                        count: 0,
                        truncated: false
                    }
                ];
                verifyVariables(wrapper, targetVariables);
            },
            () => {
                return ioc;
            }
        );

        function generateVar(v: number): IJupyterVariable {
            const valueEntry = Math.pow(v, 2) % 17;
            const expectedValue =
                valueEntry < 10
                    ? `[${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, <...> , ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}]`
                    : `[${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, <...> , ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}, ${valueEntry}]`;
            return {
                name: `var${v}`,
                value: expectedValue,
                supportsDataExplorer: true,
                type: 'list',
                size: 54,
                shape: '',
                count: 100000,
                truncated: false
            };
        }

        // Test our limits. Create 1050 items. Do this with both to make
        // sure no perf problems with one or the other and to smoke test the native editor
        runDoubleTest(
            'Variable explorer - A lot of items',
            async (wrapper) => {
                const basicCode: string = `for _i in range(1050):
    exec("var{}=[{} ** 2 % 17 for _l in range(100000)]".format(_i, _i))`;

                openVariableExplorer(wrapper);

                // Wait for two variable completes so we get the visible list (should be about 16 items when finished)
                await addCodeImpartial(wrapper, basicCode, true, 2);

                const allVariables: IJupyterVariable[] = rangeInclusive(0, 1050)
                    .map(generateVar)
                    .sort((a: IJupyterVariable, b: IJupyterVariable) => a.name.localeCompare(b.name));

                const targetVariables = allVariables.slice(0, 16);
                verifyVariables(wrapper, targetVariables);

                // Force a scroll to the bottom
                const complete = waitForMessage(ioc, InteractiveWindowMessages.VariablesComplete, { numberOfTimes: 2 });
                const grid = wrapper.find(AdazzleReactDataGrid);
                const viewPort = grid.find('Viewport').instance();
                const rowHeight = (viewPort.props as any).rowHeight as number;
                const scrollTop = (allVariables.length - 11) * rowHeight;
                (viewPort as any).onScroll({ scrollTop, scrollLeft: 0 });

                // Wait for a variable complete
                await complete;

                // Now we should have the bottom. For some reason only 10 come back here.
                const bottomVariables = allVariables.slice(1041, 1051);
                verifyVariables(wrapper, bottomVariables);
            },
            () => {
                return ioc;
            }
        );
    });

    // Verify a set of rows versus a set of expected variables
    function verifyVariables(
        wrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
        targetVariables: IJupyterVariable[]
    ) {
        // Force an update so we render whatever the current state is
        wrapper.update();

        // Then search for results.
        const foundRows = wrapper.find('div.react-grid-Row');

        expect(foundRows.length).to.be.equal(
            targetVariables.length,
            'Different number of variable explorer rows and target variables'
        );

        foundRows.forEach((row, index) => {
            verifyRow(row, targetVariables[index]);
        });
    }

    // Verify a single row versus a single expected variable
    function verifyRow(rowWrapper: ReactWrapper<any, Readonly<{}>, React.Component>, targetVariable: IJupyterVariable) {
        const rowCells = rowWrapper.find('div.react-grid-Cell');

        expect(rowCells.length).to.be.equal(5, 'Unexpected number of cells in variable explorer row');

        verifyCell(rowCells.at(0), targetVariable.name, targetVariable.name);
        verifyCell(rowCells.at(1), targetVariable.type, targetVariable.name);

        if (targetVariable.shape && targetVariable.shape !== '') {
            verifyCell(rowCells.at(2), targetVariable.shape, targetVariable.name);
        } else if (targetVariable.count) {
            verifyCell(rowCells.at(2), targetVariable.count.toString(), targetVariable.name);
        }

        if (targetVariable.value) {
            verifyCell(rowCells.at(3), targetVariable.value, targetVariable.name);
        }

        verifyCell(rowCells.at(4), targetVariable.supportsDataExplorer, targetVariable.name);
    }

    // Verify a single cell value against a specific target value
    function verifyCell(
        cellWrapper: ReactWrapper<any, Readonly<{}>, React.Component>,
        value: string | boolean,
        targetName: string
    ) {
        const cellHTML = parse(cellWrapper.html()) as any;
        const innerHTML = cellHTML.innerHTML;
        if (typeof value === 'string') {
            // tslint:disable-next-line:no-string-literal
            const match = /value="([\s\S]+?)"\s+/.exec(innerHTML);
            expect(match).to.not.be.equal(null, `${targetName} does not have a value attribute`);

            // Eliminate whitespace differences
            const actualValueNormalized = match![1].replace(/^\s*|\s(?=\s)|\s*$/g, '').replace(/\r\n/g, '\n');
            const expectedValueNormalized = value.replace(/^\s*|\s(?=\s)|\s*$/g, '').replace(/\r\n/g, '\n');

            expect(actualValueNormalized).to.be.equal(
                expectedValueNormalized,
                `${targetName} has an unexpected value ${innerHTML} in variable explorer cell`
            );
        } else {
            if (value) {
                expect(innerHTML).to.include('image-button-image', `Image class not found in ${targetName}`);
            } else {
                expect(innerHTML).to.not.include('image-button-image', `Image class was found ${targetName}`);
            }
        }
    }
});
