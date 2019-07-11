// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as assert from 'assert';
import { mount } from 'enzyme';
import * as path from 'path';
import * as React from 'react';
import * as TypeMoq from 'typemoq';
import * as uuid from 'uuid/v4';
import { Disposable, Position, Range, SourceBreakpoint, Uri } from 'vscode';
import * as vsls from 'vsls/vscode';

import { IApplicationShell, IDebugService, IDocumentManager } from '../../client/common/application/types';
import { IProcessServiceFactory, Output } from '../../client/common/process/types';
import { createDeferred, waitForPromise } from '../../client/common/utils/async';
import { EXTENSION_ROOT_DIR } from '../../client/constants';
import {
    InteractiveWindowMessageListener
} from '../../client/datascience/interactive-window/interactiveWindowMessageListener';
import { InteractiveWindowMessages } from '../../client/datascience/interactive-window/interactiveWindowTypes';
import { IInteractiveWindow, IInteractiveWindowProvider, IJupyterExecution } from '../../client/datascience/types';
import { MainPanel } from '../../datascience-ui/history-react/MainPanel';
import { DataScienceIocContainer } from './dataScienceIocContainer';
import { getCellResults } from './interactiveWindowTestHelpers';
import { getConnectionInfo, getNotebookCapableInterpreter } from './jupyterHelpers';
import { MockDebuggerService } from './mockDebugService';
import { MockDocumentManager } from './mockDocumentManager';

//import { asyncDump } from '../common/asyncDump';
// tslint:disable-next-line:max-func-body-length no-any
suite('DataScience Debugger tests', () => {
    const disposables: Disposable[] = [];
    const postDisposables: Disposable[] = [];
    let ioc: DataScienceIocContainer;
    let processFactory: IProcessServiceFactory;
    let lastErrorMessage : string | undefined;
    let mockDebuggerService : MockDebuggerService | undefined;

    suiteSetup(function () {
        // Debugger tests require jupyter to run. Othewrise can't not really testing them
        const isRollingBuild = process.env ? process.env.VSCODE_PYTHON_ROLLING !== undefined : false;
        if (!isRollingBuild) {
            // tslint:disable-next-line:no-console
            console.log('Skipping Debugger tests. Requires python environment');
            // tslint:disable-next-line:no-invalid-this
            this.skip();
        }
    });

    setup(async () => {
        ioc = createContainer();
        mockDebuggerService = ioc.serviceManager.get<IDebugService>(IDebugService) as MockDebuggerService;
        processFactory = ioc.serviceManager.get<IProcessServiceFactory>(IProcessServiceFactory);
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
        if (mockDebuggerService) {
            mockDebuggerService.dispose();
        }
        await ioc.dispose();
        lastErrorMessage = undefined;
        for (const disposable of postDisposables) {
            if (!disposable) {
                continue;
            }
            // tslint:disable-next-line:no-any
            const promise = disposable.dispose() as Promise<any>;
            if (promise) {
                await promise;
            }
        }
    });

    suiteTeardown(() => {
//        asyncDump();
    });

    function createContainer(): DataScienceIocContainer {
        const result = new DataScienceIocContainer();
        result.registerDataScienceTypes();

        // Rebind the appshell so we can change what happens on an error
        const dummyDisposable = {
            dispose: () => { return; }
        };
        const appShell = TypeMoq.Mock.ofType<IApplicationShell>();
        appShell.setup(a => a.showErrorMessage(TypeMoq.It.isAnyString())).returns((e) => lastErrorMessage = e);
        appShell.setup(a => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns(() => Promise.resolve(''));
        appShell.setup(a => a.showInformationMessage(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny())).returns((_a1: string, a2: string, _a3: string) => Promise.resolve(a2));
        appShell.setup(a => a.showSaveDialog(TypeMoq.It.isAny())).returns(() => Promise.resolve(Uri.file('test.ipynb')));
        appShell.setup(a => a.setStatusBarMessage(TypeMoq.It.isAny())).returns(() => dummyDisposable);

        result.serviceManager.rebindInstance<IApplicationShell>(IApplicationShell, appShell.object);

        // Setup our webview panel
        result.createWebView(() => mount(<MainPanel baseTheme='vscode-light' codeTheme='light_vs' testMode={true} skipDefault={true} />), vsls.Role.None);

        // Make sure the history provider and execution factory in the container is created (the extension does this on startup in the extension)
        // This is necessary to get the appropriate live share services up and running.
        result.get<IInteractiveWindowProvider>(IInteractiveWindowProvider);
        result.get<IJupyterExecution>(IJupyterExecution);
        return result;
    }

    async function getOrCreateInteractiveWindow(): Promise<IInteractiveWindow> {
        const interactiveWindowProvider = ioc.get<IInteractiveWindowProvider>(IInteractiveWindowProvider);
        const result = await interactiveWindowProvider.getOrCreateActive();

        // During testing the MainPanel sends the init message before our interactive window is created.
        // Pretend like it's happening now
        // tslint:disable-next-line: no-any
        const listener = ((result as any).messageListener) as InteractiveWindowMessageListener;
        listener.onMessage(InteractiveWindowMessages.Started, {});

        return result;
    }

    async function debugCell(code: string, breakpoint?: Range, breakpointFile?: string) : Promise<void> {
        // Create a dummy document with just this code
        const docManager = ioc.get<IDocumentManager>(IDocumentManager) as MockDocumentManager;
        const fileName = path.join(EXTENSION_ROOT_DIR, 'foo.py');
        docManager.addDocument(code, fileName);

        if (breakpoint) {
            const sourceFile = breakpointFile ? path.join(EXTENSION_ROOT_DIR, breakpointFile) : fileName;
            const sb : SourceBreakpoint = {
                location: {
                    uri: Uri.file(sourceFile),
                    range: breakpoint
                },
                id: uuid(),
                enabled: true
            };
            mockDebuggerService!.addBreakpoints([sb]);
        }

        // Start the jupyter server
        const history = await getOrCreateInteractiveWindow();

        const expectedBreakLine = breakpoint && !breakpointFile ? breakpoint.start.line : 2; // 2 because of the 'breakpoint()' that gets added

        // Debug this code. We should either hit the breakpoint or stop on entry
        const results = await getCellResults(ioc.wrapper!, 5, async () => {
            const breakPromise = createDeferred<void>();
            disposables.push(mockDebuggerService!.onBreakpointHit(() => breakPromise.resolve()));
            const done = history.debugCode(code, fileName, 0, docManager.activeTextEditor);
            await waitForPromise(Promise.race([done, breakPromise.promise]), 60000);
            assert.ok(breakPromise.resolved, 'Breakpoint event did not fire');
            assert.ok(!lastErrorMessage, `Error occurred ${lastErrorMessage}`);
            const stackTrace = await mockDebuggerService!.getStackTrace();
            assert.ok(stackTrace, 'Stack trace not computable');
            assert.ok(stackTrace!.body.stackFrames.length >= 1, 'Not enough frames');
            assert.equal(stackTrace!.body.stackFrames[0].line, expectedBreakLine, 'Stopped on wrong line number');
            // Verify break location
            await mockDebuggerService!.continue();
        });
        assert.ok(results, 'No cell results after finishing debugging');
        await history.dispose();
    }

    test('Debug cell without breakpoint', async () => {
        await debugCell('#%%\nprint("bar")');
    });

    test('Debug cell with breakpoint', async () => {
        await debugCell('#%%\nprint("bar")\nprint("baz")', new Range(new Position(3, 0), new Position(3, 0)));
    });

    test('Debug cell with breakpoint in another file', async () => {
        await debugCell('#%%\nprint("bar")\nprint("baz")', new Range(new Position(3, 0), new Position(3, 0)), 'bar.py');
    });

    test('Debug remote', async () => {
        const python = await getNotebookCapableInterpreter(ioc, processFactory);
        const procService = await processFactory.create();

        if (procService && python) {
            const connectionFound = createDeferred();
            const configFile = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'datascience', 'serverConfigFiles', 'remoteToken.py');
            const exeResult = procService.execObservable(python.path, ['-m', 'jupyter', 'notebook', `--config=${configFile}`], { env: process.env, throwOnStdErr: false });

            // Make sure to shutdown after the session goes away. Otherwise the notebook files generated will still be around.
            postDisposables.push(exeResult);

            exeResult.out.subscribe((output: Output<string>) => {
                const connectionURL = getConnectionInfo(output.out);
                if (connectionURL) {
                    connectionFound.resolve(connectionURL);
                }
            });

            const connString = await connectionFound.promise;
            const uri = connString as string;
            ioc.getSettings().datascience.jupyterServerURI = uri;

            // Debug with this setting should use the server URI
            await debugCell('#%%\nprint("bar")');
        }
    });
});
