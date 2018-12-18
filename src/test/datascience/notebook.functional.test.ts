// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { Disposable, Uri } from 'vscode';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';

import { CancellationError } from '../../client/common/cancellation';
import { EXTENSION_ROOT_DIR } from '../../client/common/constants';
import { IFileSystem } from '../../client/common/platform/types';
import { IProcessServiceFactory, Output } from '../../client/common/process/types';
import { createDeferred } from '../../client/common/utils/async';
import { noop } from '../../client/common/utils/misc';
import { concatMultilineString } from '../../client/datascience/common';
import { JupyterExecution } from '../../client/datascience/jupyterExecution';
import {
    CellState,
    ICell,
    IJupyterExecution,
    INotebookExporter,
    INotebookImporter,
    INotebookServer,
    InterruptResult
} from '../../client/datascience/types';
import {
    IInterpreterService,
    IKnownSearchPathsForInterpreters,
    PythonInterpreter
} from '../../client/interpreter/contracts';
import { ICellViewModel } from '../../datascience-ui/history-react/cell';
import { generateTestState } from '../../datascience-ui/history-react/mainPanelState';
import { sleep } from '../core';
import { DataScienceIocContainer } from './dataScienceIocContainer';

// tslint:disable:no-any no-multiline-string max-func-body-length no-console max-classes-per-file
suite('Jupyter notebook tests', () => {
    const disposables: Disposable[] = [];
    let jupyterExecution: IJupyterExecution;
    let processFactory: IProcessServiceFactory;
    let ioc: DataScienceIocContainer;
    let modifiedConfig = false;

    setup(() => {
        ioc = new DataScienceIocContainer();
        ioc.registerDataScienceTypes();
        jupyterExecution = ioc.serviceManager.get<IJupyterExecution>(IJupyterExecution);
        processFactory = ioc.serviceManager.get<IProcessServiceFactory>(IProcessServiceFactory);
    });

    teardown(async () => {
        if (modifiedConfig) {
            const python = await getNotebookCapableInterpreter();
            const procService = await processFactory.create();
            if (procService && python) {
                await procService.exec(python.path, ['-m', 'jupyter', 'notebook', '--generate-config', '-y'], {env: process.env});
            }
        }
        for (let i = 0; i < disposables.length; i += 1) {
            const disposable = disposables[i];
            if (disposable) {
                const promise = disposable.dispose() as Promise<any>;
                if (promise) {
                    await promise;
                }
            }
        }
        ioc.dispose();

    });

    function escapePath(p: string) {
        return p.replace(/\\/g, '\\\\');
    }

    function srcDirectory() {
        return path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');
    }

    async function assertThrows(func : () => Promise<void>, message: string) {
        try  {
            await func();
            assert.fail(message);
        // tslint:disable-next-line:no-empty
        } catch {
        }
    }

    async function verifySimple(jupyterServer: INotebookServer | undefined, code: string, expectedValue: any) : Promise<void> {
        const cells = await jupyterServer!.execute(code, path.join(srcDirectory(), 'foo.py'), 2);
        assert.equal(cells.length, 1, `Wrong number of cells returned`);
        assert.equal(cells[0].data.cell_type, 'code', `Wrong type of cell returned`);
        const cell = cells[0].data as nbformat.ICodeCell;
        assert.equal(cell.outputs.length, 1, `Cell length not correct`);
        const data = cell.outputs[0].data;
        const error = cell.outputs[0].evalue;
        if (error) {
            assert.fail(`Unexpected error: ${error}`);
        }
        assert.ok(data, `No data object on the cell`);
        if (data) { // For linter
            assert.ok(data.hasOwnProperty('text/plain'), `Cell mime type not correct`);
            assert.ok(data['text/plain'], `Cell mime type not correct`);
            assert.equal(data['text/plain'], expectedValue, 'Cell value does not match');
        }
    }

    async function verifyError(jupyterServer: INotebookServer | undefined, code: string, errorString: string) : Promise<void> {
        const cells = await jupyterServer!.execute(code, path.join(srcDirectory(), 'foo.py'), 2);
        assert.equal(cells.length, 1, `Wrong number of cells returned`);
        assert.equal(cells[0].data.cell_type, 'code', `Wrong type of cell returned`);
        const cell = cells[0].data as nbformat.ICodeCell;
        assert.equal(cell.outputs.length, 1, `Cell length not correct`);
        const error = cell.outputs[0].evalue;
        if (error) {
            assert.ok(error, 'Error not found when expected');
            assert.equal(error, errorString, 'Unexpected error found');
        }
    }

    async function verifyCell(jupyterServer: INotebookServer | undefined, index: number, code: string, mimeType: string, cellType: string, verifyValue : (data: any) => void) : Promise<void> {
        // Verify results of an execute
        const cells = await jupyterServer!.execute(code, path.join(srcDirectory(), 'foo.py'), 2);
        assert.equal(cells.length, 1, `${index}: Wrong number of cells returned`);
        if (cellType === 'code') {
            assert.equal(cells[0].data.cell_type, cellType, `${index}: Wrong type of cell returned`);
            const cell = cells[0].data as nbformat.ICodeCell;
            assert.equal(cell.outputs.length, 1, `${index}: Cell length not correct`);
            const error = cell.outputs[0].evalue;
            if (error) {
                assert.ok(false, `${index}: Unexpected error: ${error}`);
            }
            const data = cell.outputs[0].data;
            assert.ok(data, `${index}: No data object on the cell`);
            if (data) { // For linter
                assert.ok(data.hasOwnProperty(mimeType), `${index}: Cell mime type not correct`);
                assert.ok(data[mimeType], `${index}: Cell mime type not correct`);
                verifyValue(data[mimeType]);
            }
        } else if (cellType === 'markdown') {
            assert.equal(cells[0].data.cell_type, cellType, `${index}: Wrong type of cell returned`);
            const cell = cells[0].data as nbformat.IMarkdownCell;
            const outputSource = concatMultilineString(cell.source);
            verifyValue(outputSource);
        } else if (cellType === 'error') {
            const cell = cells[0].data as nbformat.ICodeCell;
            assert.equal(cell.outputs.length, 1, `${index}: Cell length not correct`);
            const error = cell.outputs[0].evalue;
            assert.ok(error, 'Error not found when expected');
            verifyValue(error);
        }
    }

    function testMimeTypes(types : {code: string; mimeType: string; cellType: string; verifyValue(data: any): void}[]) {
        runTest('MimeTypes', async () => {
            // Test all mime types together so we don't have to startup and shutdown between
            // each
            const mimeTestDir = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');
            const server = await jupyterExecution.connectToNotebookServer(undefined, true, undefined, mimeTestDir);
            if (!server) {
                assert.fail('Server not created');
            }
            let statusCount: number = 0;
            if (server) {
                server.onStatusChanged((bool: boolean) => {
                    statusCount += 1;
                });
                for (let i = 0; i < types.length; i += 1) {
                    const prevCount = statusCount;
                    await verifyCell(server, i, types[i].code, types[i].mimeType, types[i].cellType, types[i].verifyValue);
                    if (types[i].cellType !== 'markdown') {
                        assert.ok(statusCount > prevCount, 'Status didnt update');
                    }
                }
            }
        });
    }

    function runTest(name: string, func: () => Promise<void>) {
        test(name, async () => {
            console.log(`Starting test ${name} ...`);
            if (await jupyterExecution.isNotebookSupported()) {
                return func();
            } else {
                // tslint:disable-next-line:no-console
                console.log(`Skipping test ${name}, no jupyter installed.`);
            }
        });
    }

    runTest('Creation', async () => {
        const server = await jupyterExecution.connectToNotebookServer(undefined, true);
        if (!server) {
            assert.fail('Server not created');
        }
    });

    runTest('Remote', async () => {
        const python = await getNotebookCapableInterpreter();
        const procService = await processFactory.create();

        if (procService && python) {
            const connectionFound = createDeferred();
            const exeResult = procService.execObservable(python.path, ['-m', 'jupyter', 'notebook', '--no-browser'], {env: process.env, throwOnStdErr: false});
            disposables.push(exeResult);

            exeResult.out.subscribe((output: Output<string>) => {
                const connectionURL = getConnectionInfo(output.out);
                if (connectionURL) {
                    connectionFound.resolve(connectionURL);
                }
            });

            const connString = await connectionFound.promise;
            const uri = connString as string;

            // We have a connection string here, so try to connect jupyterExecution to the notebook server
            const server = await jupyterExecution.connectToNotebookServer(uri!, true);
            if (!server) {
                assert.fail('Failed to connect to remote server');
            }
        }
    });

    function getConnectionInfo(output: string) : string | undefined {
        const UrlPatternRegEx = /(https?:\/\/[^\s]+)/ ;

        const urlMatch = UrlPatternRegEx.exec(output);
        if (urlMatch) {
            return urlMatch[0];
        }
        return undefined;
    }

    runTest('Failure', async () => {
        // Make a dummy class that will fail during launch
        class FailedProcess extends JupyterExecution {
            public isNotebookSupported = () : Promise<boolean> => {
                return Promise.resolve(false);
            }
        }
        ioc.serviceManager.rebind<IJupyterExecution>(IJupyterExecution, FailedProcess);
        jupyterExecution = ioc.serviceManager.get<IJupyterExecution>(IJupyterExecution);
        return assertThrows(async () => {
            await jupyterExecution.connectToNotebookServer(undefined, true);
        }, 'Server start is not throwing');
    });

    test('Not installed', async () => {
        // Rewire our data we use to search for processes
        class EmptyInterpreterService implements IInterpreterService {
            public onDidChangeInterpreter(_listener: (e: void) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable {
                return { dispose: noop };
            }
            public getInterpreters(resource?: Uri): Promise<PythonInterpreter[]> {
                return Promise.resolve([]);
            }
            public autoSetInterpreter(): Promise<void> {
                throw new Error('Method not implemented');
            }
            public getActiveInterpreter(resource?: Uri): Promise<PythonInterpreter | undefined> {
                return Promise.resolve(undefined);
            }
            public getInterpreterDetails(pythonPath: string, resoure?: Uri): Promise<PythonInterpreter> {
                throw new Error('Method not implemented');
            }
            public refresh(resource: Uri): Promise<void> {
                throw new Error('Method not implemented');
            }
            public initialize(): void {
                throw new Error('Method not implemented');
            }
            public getDisplayName(interpreter: Partial<PythonInterpreter>): Promise<string> {
                throw new Error('Method not implemented');
            }
            public shouldAutoSetInterpreter(): Promise<boolean> {
                throw new Error('Method not implemented');
            }
        }
        class EmptyPathService implements IKnownSearchPathsForInterpreters {
            public getSearchPaths() : string [] {
                return [];
            }
        }
        ioc.serviceManager.rebind<IInterpreterService>(IInterpreterService, EmptyInterpreterService);
        ioc.serviceManager.rebind<IKnownSearchPathsForInterpreters>(IKnownSearchPathsForInterpreters, EmptyPathService);
        jupyterExecution = ioc.serviceManager.get<IJupyterExecution>(IJupyterExecution);

        return assertThrows(async () => {
            await jupyterExecution.connectToNotebookServer(undefined, true);
        }, 'Server start is not throwing');
    });

    runTest('Export/Import', async () => {
        // Get a bunch of test cells (use our test cells from the react controls)
        const testFolderPath = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');
        const testState = generateTestState(id => { return; }, testFolderPath);
        const cells = testState.cellVMs.map((cellVM: ICellViewModel, index: number) => { return cellVM.cell; });

        // Translate this into a notebook
        const exporter = ioc.serviceManager.get<INotebookExporter>(INotebookExporter);
        const newFolderPath = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience', 'WorkspaceDir', 'WorkspaceSubDir', 'foo.ipynb');
        const notebook = await exporter.translateToNotebook(cells, newFolderPath);
        assert.ok(notebook, 'Translate to notebook is failing');

        // Make sure we added in our chdir
        if (notebook) {
            const nbcells = notebook['cells'];
            if (nbcells) {
                const firstCellText: string = nbcells[0]['source'] as string;
                assert.ok(firstCellText.includes('os.chdir'));
            }
        }

        // Save to a temp file
        const fileSystem = ioc.serviceManager.get<IFileSystem>(IFileSystem);
        const importer = ioc.serviceManager.get<INotebookImporter>(INotebookImporter);
        const temp = await fileSystem.createTemporaryFile('.ipynb');

        try {
            await fs.writeFile(temp.filePath, JSON.stringify(notebook), 'utf8');
            // Try importing this. This should verify export works and that importing is possible
            const results = await importer.importFromFile(temp.filePath);

            // Make sure we added a chdir into our results
            assert.ok(results.includes('os.chdir'));

            // Make sure we have a cell in our results
            assert.ok(/#\s*%%/.test(results), 'No cells in returned import');
        } finally {
            importer.dispose();
            temp.dispose();
        }
    });

    runTest('Restart kernel', async () => {
        const server = await jupyterExecution.connectToNotebookServer(undefined, true);
        if (!server) {
            assert.fail('Server not created');
        }

        // Setup some state and verify output is correct
        await verifySimple(server, `a=1${os.EOL}a`, 1);
        await verifySimple(server, `a+=1${os.EOL}a`, 2);
        await verifySimple(server, `a+=4${os.EOL}a`, 6);

        console.log('Waiting for idle');

        // In unit tests we have to wait for status idle before restarting. Unit tests
        // seem to be timing out if the restart throws any exceptions (even if they're caught)
        await server!.waitForIdle();

        console.log('Restarting kernel');

        await server!.restartKernel();

        console.log('Waiting for idle');
        await server!.waitForIdle();

        console.log('Verifying restart');
        await verifyError(server, 'a', `name 'a' is not defined`);
    });

    class TaggedCancellationTokenSource extends CancellationTokenSource {
        public tag: string;
        constructor(tag: string) {
            super();
            this.tag = tag;
        }
    }

    async function testCancelableCall<T>(method: (t: CancellationToken) => Promise<T>, messageFormat: string, timeout: number) : Promise<boolean> {
        const tokenSource = new TaggedCancellationTokenSource(messageFormat.format(timeout.toString()));
        const disp = setTimeout((s) => {
            tokenSource.cancel();
        }, timeout, tokenSource.tag);

        try {
            tokenSource.token['tag'] = messageFormat.format(timeout.toString());
            await method(tokenSource.token);
            assert.ok(false, messageFormat.format(timeout.toString()));
        } catch (exc) {
            // This should happen. This means it was canceled.
            assert.ok(exc instanceof CancellationError, `Non cancellation error found : ${exc.stack}`);
        } finally {
            clearTimeout(disp);
            tokenSource.dispose();
        }

        return true;
    }

    async function testCancelableMethod<T>(method: (t: CancellationToken) => Promise<T>, messageFormat: string, short?: boolean) : Promise<boolean> {
        const timeouts = short ? [10, 20, 30, 100] : [100, 200, 300, 1000];
        for (let i = 0; i < timeouts.length; i += 1) {
            await testCancelableCall(method, messageFormat, timeouts[i]);
        }

        return true;
    }

    runTest('Cancel execution', async () => {
        // Try different timeouts, canceling after the timeout on each
        assert.ok(await testCancelableMethod((t: CancellationToken) => jupyterExecution.connectToNotebookServer(undefined, true, t), 'Cancel did not cancel start after {0}ms'));

        // Make sure doing normal start still works
        const nonCancelSource = new CancellationTokenSource();
        const server = await jupyterExecution.connectToNotebookServer(undefined, true, nonCancelSource.token);
        assert.ok(server, 'Server not found with a cancel token that does not cancel');

        // Make sure can run some code too
        await verifySimple(server, `a=1${os.EOL}a`, 1);

        // Force a settings changed so that all of the cached data is cleared
        ioc.forceSettingsChanged();

        assert.ok(await testCancelableMethod((t: CancellationToken) => jupyterExecution.getUsableJupyterPython(t), 'Cancel did not cancel getusable after {0}ms', true));
        assert.ok(await testCancelableMethod((t: CancellationToken) => jupyterExecution.isNotebookSupported(t), 'Cancel did not cancel isNotebook after {0}ms', true));
        assert.ok(await testCancelableMethod((t: CancellationToken) => jupyterExecution.isKernelCreateSupported(t), 'Cancel did not cancel isKernel after {0}ms', true));
        assert.ok(await testCancelableMethod((t: CancellationToken) => jupyterExecution.isImportSupported(t), 'Cancel did not cancel isImport after {0}ms', true));
     });

    async function interruptExecute(server: INotebookServer, code: string, interruptMs: number, sleepMs: number) : Promise<InterruptResult> {
        let interrupted = false;
        let finishedBefore = false;
        const finishedPromise = createDeferred();
        const observable = server!.executeObservable(code, 'foo.py', 0);
        let cells : ICell[] = [];
        observable.subscribe(c => {
            cells = c;
            if (c.length > 0 && c[0].state === CellState.error) {
                finishedBefore = !interrupted;
                finishedPromise.resolve();
            }
            if (c.length > 0 && c[0].state === CellState.finished) {
                finishedBefore = !interrupted;
                finishedPromise.resolve();
            }
        }, (err) => finishedPromise.reject(err), () => finishedPromise.resolve());

        // Then interrupt
        interrupted = true;
        const result = await server!.interruptKernel(interruptMs);

        // Then we should get our finish unless there was a restart
        await Promise.race([finishedPromise.promise, sleep(sleepMs)]);
        assert.equal(finishedBefore, false, 'Finished before the interruption');
        assert.ok(finishedPromise.completed ||
            result === InterruptResult.TimedOut ||
            result === InterruptResult.Restarted,
            `Timed out before interrupt for result: ${result}: ${code}`);

        return result;
    }

    runTest('Interrupt kernel', async () => {
        const interrTestDir = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience');
        const server = await jupyterExecution.connectToNotebookServer(undefined, true, undefined, interrTestDir);
        if (!server) {
            assert.fail('Server not created');
        }

        // Try with something we can interrupt
        let interruptResult = await interruptExecute(server!,
`import signal
import _thread
import time

keep_going = True
def handler(signum, frame):
  global keep_going
  print('signal')
  keep_going = False

signal.signal(signal.SIGINT, handler)

while keep_going:
  print(".")
  time.sleep(.1)`, 5000, 5000);

        // Try again with something that doesn't return. However it should finish before
        // we get to our own sleep. Note: We need the print so that the test knows something happened.
        interruptResult = await interruptExecute(server!, `import time${os.EOL}time.sleep(4)${os.EOL}print("foo")`, 7000, 7000);

        // Try again with something that doesn't return. Make sure it times out
        interruptResult = await interruptExecute(server!, `import time${os.EOL}time.sleep(4)${os.EOL}print("foo")`, 100, 7000);
        assert.equal(interruptResult, InterruptResult.TimedOut);

        // The tough one, somethign that causes a kernel reset.
        interruptResult = await interruptExecute(server!,
`import signal
import time
import os

keep_going = True
def handler(signum, frame):
    global keep_going
    print('signal')
    os._exit(-2)

signal.signal(signal.SIGINT, handler)

while keep_going:
    print(".")
    time.sleep(.1)`, 5000, 5000);

    });

    testMimeTypes(
        [
            {
                code:
                    `a=1
a`,
                mimeType: 'text/plain',
                cellType: 'code',
                verifyValue: (d) => assert.equal(d, 1, 'Plain text invalid')
            },
            {
                code:
                    `import pandas as pd
df = pd.read("${escapePath(path.join(srcDirectory(), 'DefaultSalesReport.csv'))}")
df.head()`,
                mimeType: 'text/html',
                cellType: 'error',
                // tslint:disable-next-line:quotemark
                verifyValue: (d) => assert.ok((d as string).includes("has no attribute 'read'"), 'Unexpected error result')
            },
            {
                code:
                    `import pandas as pd
df = pd.read_csv("${escapePath(path.join(srcDirectory(), 'DefaultSalesReport.csv'))}")
df.head()`,
                mimeType: 'text/html',
                cellType: 'code',
                verifyValue: (d) => assert.ok(d.toString().includes('</td>'), 'Table not found')
            },
            {
                code:
                    `#%% [markdown]#
# #HEADER`,
                mimeType: 'text/plain',
                cellType: 'markdown',
                verifyValue: (d) => assert.equal(d, '#HEADER', 'Markdown incorrect')
            },
            {
                // Test relative directories too.
                code:
                `import pandas as pd
df = pd.read_csv("./DefaultSalesReport.csv")
df.head()`,
                mimeType: 'text/html',
                cellType: 'code',
                verifyValue: (d) => assert.ok(d.toString().includes('</td>'), 'Table not found')
            },
            {
                // Plotly
                code:
                    `import matplotlib.pyplot as plt
import matplotlib as mpl
import numpy as np
import pandas as pd
x = np.linspace(0, 20, 100)
plt.plot(x, np.sin(x))
plt.show()`,
                mimeType: 'image/png',
                cellType: 'code',
                verifyValue: (d) => { return; }
            }
        ]
    );

    async function getNotebookCapableInterpreter() : Promise<PythonInterpreter | undefined> {
        const is = ioc.serviceContainer.get<IInterpreterService>(IInterpreterService);
        const list = await is.getInterpreters();
        const procService = await processFactory.create();
        if (procService) {
            for (let i = 0; i < list.length; i += 1) {
                const result = await procService.exec(list[i].path, ['-m', 'jupyter', 'notebook', '--version'], {env: process.env});
                if (!result.stderr) {
                    return list[i];
                }
            }
        }
        return undefined;
    }

    async function generateNonDefaultConfig() {
        const usable = await getNotebookCapableInterpreter();
        assert.ok(usable, 'Cant find jupyter enabled python');

        // Manually generate an invalid jupyter config
        const procService = await processFactory.create();
        assert.ok(procService, 'Can not get a process service');
        const results = await procService!.exec(usable!.path, ['-m', 'jupyter', 'notebook', '--generate-config', '-y'], {env: process.env});

        // Results should have our path to the config.
        const match = /^.*\s+(.*jupyter_notebook_config.py)\s+.*$/m.exec(results.stdout);
        assert.ok(match && match !== null && match.length > 0, 'Jupyter is not outputting the path to the config');
        const configPath = match !== null ? match[1] : '';
        const filesystem = ioc.serviceContainer.get<IFileSystem>(IFileSystem);
        await filesystem.writeFile(configPath, 'c.NotebookApp.password_required = True'); // This should make jupyter fail
        modifiedConfig = true;
    }

    runTest('Non default config fails', async () => {
        await generateNonDefaultConfig();
        try {
            await jupyterExecution.connectToNotebookServer(undefined, false);
            assert.fail('Should not be able to connect to notebook server with bad config');
        } catch {
            noop();
        }
    });

    runTest('Non default config does not mess up default config', async () => {
        await generateNonDefaultConfig();
        const server = await jupyterExecution.connectToNotebookServer(undefined, true);
        assert.ok(server, 'Never connected to a default server with a bad default config');

        await verifySimple(server, `a=1${os.EOL}a`, 1);
    });

    // Tests that should be running:
    // - Creation
    // - Failure
    // - Not installed
    // - Different mime types
    // - Export/import
    // - Auto import
    // - changing directories
    // - Restart
    // - Error types
    // Test to write after jupyter process abstraction
    // - jupyter not installed
    // - kernel spec not matching
    // - ipykernel not installed
    // - kernelspec not installed
    // - startup / shutdown / restart - make uses same kernelspec. Actually should be in memory already
    // - Starting with python that doesn't have jupyter and make sure it can switch to one that does
    // - Starting with python that doesn't have jupyter and make sure the switch still uses a python that's close as the kernel

});
