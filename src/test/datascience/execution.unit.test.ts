// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { JSONObject } from '@phosphor/coreutils/lib/json';
import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { Observable } from 'rxjs/Observable';
import { anyString, anything, instance, match, mock, when } from 'ts-mockito';
import { Matcher } from 'ts-mockito/lib/matcher/type/Matcher';
import * as TypeMoq from 'typemoq';
import * as uuid from 'uuid/v4';
import { Disposable, EventEmitter } from 'vscode';

import { IS_WINDOWS, PythonSettings } from '../../client/common/configSettings';
import { ConfigurationService } from '../../client/common/configuration/service';
import { Logger } from '../../client/common/logger';
import { FileSystem } from '../../client/common/platform/fileSystem';
import { IFileSystem, TemporaryFile } from '../../client/common/platform/types';
import { ProcessServiceFactory } from '../../client/common/process/processFactory';
import { PythonExecutionFactory } from '../../client/common/process/pythonExecutionFactory';
import {
    ExecutionResult,
    IProcessService,
    IPythonExecutionService,
    ObservableExecutionResult,
    Output
} from '../../client/common/process/types';
import { IConfigurationService, IDisposableRegistry, ILogger } from '../../client/common/types';
import { Architecture } from '../../client/common/utils/platform';
import { EXTENSION_ROOT_DIR } from '../../client/constants';
import { JupyterExecution } from '../../client/datascience/jupyterExecution';
import { ICell, IConnection, IJupyterKernelSpec, INotebookServer } from '../../client/datascience/types';
import { InterpreterType, PythonInterpreter } from '../../client/interpreter/contracts';
import { InterpreterService } from '../../client/interpreter/interpreterService';
import { CondaService } from '../../client/interpreter/locators/services/condaService';
import { KnownSearchPathsForInterpreters } from '../../client/interpreter/locators/services/KnownPathsService';
import { ServiceContainer } from '../../client/ioc/container';
import { noop } from '../core';

// tslint:disable:no-any no-http-string no-multiline-string max-func-body-length
class MockJupyterServer implements INotebookServer {

    private conninfo : IConnection | undefined;
    private kernelSpec : IJupyterKernelSpec  | undefined;
    private notebookFile : TemporaryFile | undefined;
    public connect(conninfo: IConnection, kernelSpec: IJupyterKernelSpec, notebookFile: TemporaryFile): Promise<void> {
        this.conninfo = conninfo;
        this.kernelSpec = kernelSpec;
        this.notebookFile = notebookFile;

        // Validate connection info and kernel spec
        if (conninfo.baseUrl && /[a-z,A-Z,0-9,-,.,_]+/.test(kernelSpec.name)) {
            return Promise.resolve();
        }
        return Promise.reject('invalid server startup');
    }
    //tslint:disable-next-line:no-any
    public onStatusChanged(_listener: (e: boolean) => any, _thisArgs?: any, _disposables?: Disposable[]): Disposable {
        return { dispose: noop };
    }
    public getCurrentState(): Promise<ICell[]> {
        throw new Error('Method not implemented');
    }
    public executeObservable(code: string, f: string, line: number): Observable<ICell[]> {
        throw new Error('Method not implemented');
    }
    public execute(code: string, f: string, line: number): Promise<ICell[]> {
        throw new Error('Method not implemented');
    }
    public restartKernel(): Promise<void> {
        throw new Error('Method not implemented');
    }
    public translateToNotebook(cells: ICell[]): Promise<JSONObject> {
        throw new Error('Method not implemented');
    }
    public waitForIdle(): Promise<void> {
        throw new Error('Method not implemented');
    }
    public shutdown() {
        noop();
    }
    public dispose() {
        if (this.conninfo) {
            this.conninfo.dispose(); // This should kill the process that's running
            this.conninfo = undefined;
        }
        if (this.kernelSpec) {
            this.kernelSpec.dispose(); // This destroy any unwanted kernel specs if necessary
            this.kernelSpec = undefined;
        }
        if (this.notebookFile) {
            this.notebookFile.dispose(); // This destroy any unwanted kernel specs if necessary
            this.notebookFile = undefined;
        }

    }
}

class DisposableRegistry implements IDisposableRegistry {
    private disposables: Disposable[] = [];

    public push = (disposable: Disposable): void => {
        this.disposables.push(disposable);
    }

    public dispose = () => {
        for (let i = 0; i < this.disposables.length; i += 1) {
            const disposable = this.disposables[i];
            if (disposable) {
                const promise = disposable.dispose() as Promise<any>;
                if (promise) {
                    throw new Error('Dispose is returning a promise.');
                }
            }
        }
        this.disposables = [];
    }

}

suite('Jupyter Execution', async () => {
    const interpreterService = mock(InterpreterService);
    const executionFactory = mock(PythonExecutionFactory);
    const condaService = mock(CondaService);
    const configService = mock(ConfigurationService);
    const processServiceFactory = mock(ProcessServiceFactory);
    const knownSearchPaths = mock(KnownSearchPathsForInterpreters);
    const logger = mock(Logger);
    const fileSystem = mock(FileSystem);
    const serviceContainer = mock(ServiceContainer);
    const disposableRegistry = new DisposableRegistry();
    const dummyEvent = new EventEmitter<void>();
    const pythonSettings = new PythonSettings();
    const jupyterOnPath = IS_WINDOWS ? '/foo/bar/jupyter.exe' : '/foo/bar/jupyter';
    let ipykernelInstallCount = 0;

    const workingPython: PythonInterpreter = {
        path: '/foo/bar/python.exe',
        version: '3.6.6.6',
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        type: InterpreterType.Unknown,
        architecture: Architecture.x64,
        version_info: [3, 6, 6, 'final']
    };

    const missingKernelPython: PythonInterpreter = {
        path: '/foo/baz/python.exe',
        version: '3.1.1.1',
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        type: InterpreterType.Unknown,
        architecture: Architecture.x64,
        version_info: [3, 1, 1, 'final']
    };

    const missingNotebookPython: PythonInterpreter = {
        path: '/bar/baz/python.exe',
        version: '2.1.1.1',
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        type: InterpreterType.Unknown,
        architecture: Architecture.x64,
        version_info: [2, 1, 1, 'final']
    };

    const missingNotebookPython2: PythonInterpreter = {
        path: '/two/baz/python.exe',
        version: '2.1.1.1',
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        type: InterpreterType.Unknown,
        architecture: Architecture.x64,
        version_info: [2, 1, 1, 'final']
    };

    let workingKernelSpec: string;

    suiteSetup(() => {
        noop();
    });
    suiteTeardown(() => {
        noop();
    });

    setup(() => {
        workingKernelSpec = createTempSpec(workingPython.path);
        ipykernelInstallCount = 0;
        // tslint:disable-next-line:no-invalid-this
    });

    teardown(() => {
        cleanupDisposables();
    });

    function cleanupDisposables() {
        disposableRegistry.dispose();
    }

    class FunctionMatcher extends Matcher {
        private func: (obj: any) => boolean;
        constructor(func: (obj: any) => boolean) {
            super();
            this.func = func;
        }
        public match(value: Object): boolean {
            return this.func(value);
        }
        public toString(): string
        {
            return 'FunctionMatcher';
        }
    }

    function createTempSpec(pythonPath: string) : string {
        const tempDir = os.tmpdir();
        const subDir = uuid();
        const filePath = path.join(tempDir, subDir, 'kernel.json');
        fs.ensureDirSync(path.dirname(filePath));
        fs.writeJSONSync(filePath,
            {
                display_name: 'Python 3',
                language: 'python',
                argv: [
                    pythonPath,
                    '-m',
                    'ipykernel_launcher',
                    '-f',
                    '{connection_file}'
                ]
            });
        return filePath;
    }

    function argThat(func: (obj: any) => boolean) : any {
        return new FunctionMatcher(func);
    }

    function createTypeMoq<T>(tag: string) : TypeMoq.IMock<T> {
        // Use typemoqs for those things that are resolved as promises. mockito doesn't allow nesting of mocks. ES6 Proxy class
        // is the problem. We still need to make it thenable though. See this issue: https://github.com/florinn/typemoq/issues/67
        const result = TypeMoq.Mock.ofType<T>();
        result['tag'] = tag;
        result.setup((x: any) => x.then).returns(() => undefined);
        return result;
    }

    function argsMatch(matchers: (string | RegExp)[], args: string[]) : boolean {
        if (matchers.length === args.length) {
            return args.every((s, i) => {
                const r = matchers[i] as RegExp;
                return r && r.test ? r.test(s) : s === matchers[i];
            });
        }
        return false;
    }

    function setupPythonService(service: TypeMoq.IMock<IPythonExecutionService>, module: string, args: (string | RegExp)[], result: Promise<ExecutionResult<string>>) {
        service.setup(x => x.execModule(
            TypeMoq.It.isValue(module),
            TypeMoq.It.is(a => argsMatch(args, a)),
            TypeMoq.It.isAny()))
            .returns(() => result);
    }

    function setupProcessServiceExec(service: TypeMoq.IMock<IProcessService>, file: string, args: (string | RegExp)[], result: Promise<ExecutionResult<string>>) {
        service.setup(x => x.exec(
            TypeMoq.It.isValue(file),
            TypeMoq.It.is(a => argsMatch(args, a)),
            TypeMoq.It.isAny()))
            .returns(() => result);
    }

    function setupProcessServiceExecWithFunc(service: TypeMoq.IMock<IProcessService>, file: string, args: (string | RegExp)[], result: () => Promise<ExecutionResult<string>>) {
        service.setup(x => x.exec(
            TypeMoq.It.isValue(file),
            TypeMoq.It.is(a => argsMatch(args, a)),
            TypeMoq.It.isAny()))
            .returns(result);
    }

    function setupProcessServiceExecObservable(service: TypeMoq.IMock<IProcessService>, file: string, args: (string | RegExp)[], stderr: string[], stdout: string[]) {
        const result : ObservableExecutionResult<string> = {
            proc: undefined,
            out: new Observable<Output<string>>(subscriber => {
                stderr.forEach(s => subscriber.next({ source: 'stderr', out: s}));
                stdout.forEach(s => subscriber.next({ source: 'stderr', out: s}));
            }),
            dispose: () => {
                noop();
            }
        };

        service.setup(x => x.execObservable(
            TypeMoq.It.isValue(file),
            TypeMoq.It.is(a => argsMatch(args, a)),
            TypeMoq.It.isAny()))
            .returns(() => result);
    }

    function setupWorkingPythonService(service: TypeMoq.IMock<IPythonExecutionService>) {
        setupPythonService(service, 'ipykernel', ['--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupPythonService(service, 'jupyter', ['nbconvert', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupPythonService(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupPythonService(service, 'jupyter', ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        service.setup(x => x.getInterpreterInformation()).returns(() => Promise.resolve(workingPython));
    }

    function setupMissingKernelPythonService(service: TypeMoq.IMock<IPythonExecutionService>) {
        setupPythonService(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupPythonService(service, 'jupyter', ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        service.setup(x => x.getInterpreterInformation()).returns(() => Promise.resolve(missingKernelPython));
    }

    function setupMissingNotebookPythonService(service: TypeMoq.IMock<IPythonExecutionService>) {
        service.setup(x => x.execModule(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((v) => {
                return Promise.reject('cant exec');
            });
        service.setup(x => x.getInterpreterInformation()).returns(() => Promise.resolve(missingNotebookPython));
    }

    function setupWorkingProcessService(service: TypeMoq.IMock<IProcessService>, notebookStdErr? : string[]) {
        // Don't mind the goofy path here. It's supposed to not find the item. It's just testing the internal regex works
        setupProcessServiceExecWithFunc(service, workingPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], () => {
            // Return different results after we install our kernel
            if (ipykernelInstallCount > 0) {
                return Promise.resolve({stdout: `working ${path.dirname(workingKernelSpec)}\r\n 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0`});
            }
            return Promise.resolve({stdout: ` 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0`});
        });
        setupProcessServiceExec(service, workingPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], Promise.resolve({stdout: `working ${path.dirname(workingKernelSpec)}\r\n 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0`}));
        setupProcessServiceExecWithFunc(service, workingPython.path, ['-m', 'ipykernel', 'install', '--user', '--name', /\w+-\w+-\w+-\w+-\w+/, '--display-name', `'Python Interactive'`], () => {
            ipykernelInstallCount += 1;
            return Promise.resolve({stdout: `somename ${path.dirname(workingKernelSpec)}`});
        });
        const getServerInfoPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'datascience', 'getServerInfo.py');
        setupProcessServiceExec(service, workingPython.path, [getServerInfoPath], Promise.resolve({stdout: 'failure to get server infos'}));
        setupProcessServiceExecObservable(service, workingPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], [], []);
        setupProcessServiceExecObservable(service, workingPython.path, ['-m', 'jupyter', 'notebook', '--no-browser', /--notebook-dir=.*/], [], notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']);
    }

    function setupMissingKernelProcessService(service: TypeMoq.IMock<IProcessService>, notebookStdErr? : string[]) {
        setupProcessServiceExec(service, missingKernelPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], Promise.resolve({stdout: `working ${path.dirname(workingKernelSpec)}`}));
        const getServerInfoPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'datascience', 'getServerInfo.py');
        setupProcessServiceExec(service, missingKernelPython.path, [getServerInfoPath], Promise.resolve({stdout: 'failure to get server infos'}));
        setupProcessServiceExecObservable(service, missingKernelPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], [], []);
        setupProcessServiceExecObservable(service, missingKernelPython.path, ['-m', 'jupyter', 'notebook', '--no-browser', /--notebook-dir=.*/], [], notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']);
    }

    function setupPathProcessService(jupyterPath: string, service: TypeMoq.IMock<IProcessService>, notebookStdErr? : string[]) {
        setupProcessServiceExec(service, jupyterPath, ['kernelspec', 'list'], Promise.resolve({stdout: `working ${path.dirname(workingKernelSpec)}`}));
        setupProcessServiceExecObservable(service, jupyterPath, ['kernelspec', 'list'], [], []);
        setupProcessServiceExec(service, jupyterPath, ['--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupProcessServiceExec(service, jupyterPath, ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupProcessServiceExec(service, jupyterPath, ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupProcessServiceExecObservable(service, jupyterPath, ['notebook', '--no-browser', /--notebook-dir=.*/], [], notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']);

        // WE also check for existence with just the key jupyter
        setupProcessServiceExec(service, 'jupyter', ['--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupProcessServiceExec(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
        setupProcessServiceExec(service, 'jupyter', ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1'}));
    }

    function createExecution(activeInterpreter: PythonInterpreter, notebookStdErr? : string[]) : JupyterExecution {
        // Setup defaults
        when(interpreterService.onDidChangeInterpreter).thenReturn(dummyEvent.event);
        when(interpreterService.getActiveInterpreter()).thenResolve(activeInterpreter);
        when(interpreterService.getInterpreters()).thenResolve([workingPython, missingKernelPython, missingNotebookPython]);
        when(interpreterService.getInterpreterDetails(match('/foo/bar/python.exe'))).thenResolve(workingPython); // Mockito is stupid. Matchers have to use literals.
        when(interpreterService.getInterpreterDetails(match('/foo/baz/python.exe'))).thenResolve(missingKernelPython);
        when(interpreterService.getInterpreterDetails(match('/bar/baz/python.exe'))).thenResolve(missingNotebookPython);
        when(interpreterService.getInterpreterDetails(argThat(o => !o.includes || !o.includes('python')))).thenReject('Unknown interpreter');

        // Create our working python and process service.
        const workingService = createTypeMoq<IPythonExecutionService>('working');
        setupWorkingPythonService(workingService);
        const missingKernelService = createTypeMoq<IPythonExecutionService>('missingKernel');
        setupMissingKernelPythonService(missingKernelService);
        const missingNotebookService = createTypeMoq<IPythonExecutionService>('missingNotebook');
        setupMissingNotebookPythonService(missingNotebookService);
        const missingNotebookService2 = createTypeMoq<IPythonExecutionService>('missingNotebook2');
        setupMissingNotebookPythonService(missingNotebookService2);
        const processService = createTypeMoq<IProcessService>('working process');
        setupWorkingProcessService(processService, notebookStdErr);
        setupMissingKernelProcessService(processService, notebookStdErr);
        setupPathProcessService(jupyterOnPath, processService, notebookStdErr);
        when(executionFactory.create(argThat(o => o.pythonPath && o.pythonPath === workingPython.path))).thenResolve(workingService.object);
        when(executionFactory.create(argThat(o => o.pythonPath && o.pythonPath === missingKernelPython.path))).thenResolve(missingKernelService.object);
        when(executionFactory.create(argThat(o => o.pythonPath && o.pythonPath === missingNotebookPython.path))).thenResolve(missingNotebookService.object);
        when(executionFactory.create(argThat(o => o.pythonPath && o.pythonPath === missingNotebookPython2.path))).thenResolve(missingNotebookService2.object);

        // Special case, nothing passed in. Match the active
        let activeService = workingService.object;
        if (activeInterpreter === missingKernelPython) {
            activeService = missingKernelService.object;
        } else if (activeInterpreter === missingNotebookPython) {
            activeService = missingNotebookService.object;
        } else if (activeInterpreter === missingNotebookPython2) {
            activeService = missingNotebookService2.object;
        }
        when(executionFactory.create(argThat(o => !o || !o.pythonPath))).thenResolve(activeService);
        when(processServiceFactory.create()).thenResolve(processService.object);

        // Service container needs logger, file system, and config service
        when(serviceContainer.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
        when(serviceContainer.get<IFileSystem>(IFileSystem)).thenReturn(instance(fileSystem));
        when(serviceContainer.get<ILogger>(ILogger)).thenReturn(instance(logger));
        when(configService.getSettings()).thenReturn(pythonSettings);

        // Setup default settings
        pythonSettings.datascience = {
            allowImportFromNotebook: true,
            jupyterLaunchTimeout: 10,
            enabled: true
        };

        // Service container also needs to generate jupyter servers. However we can't use a mock as that messes up returning
        // this object from a promise
        when(serviceContainer.get<INotebookServer>(INotebookServer)).thenReturn(new MockJupyterServer());

        when(knownSearchPaths.getSearchPaths()).thenReturn(['/foo/bar']);

        // We also need a file system
        const tempFile = {
            dispose: () => {
                return undefined;
            },
            filePath: '/foo/bar/baz.py'
        };
        when(fileSystem.createTemporaryFile(anything())).thenResolve(tempFile);
        when(fileSystem.deleteDirectory(anything())).thenResolve();

        return new JupyterExecution(
            instance(executionFactory),
            instance(condaService),
            instance(interpreterService),
            instance(processServiceFactory),
            instance(knownSearchPaths),
            instance(logger),
            disposableRegistry,
            instance(fileSystem),
            instance(serviceContainer));
    }

    test('Working notebook and commands found', async () => {
        const execution = createExecution(workingPython);
        await assert.eventually.equal(execution.isNotebookSupported(), true, 'Notebook not supported');
        await assert.eventually.equal(execution.isImportSupported(), true, 'Import not supported');
        await assert.eventually.equal(execution.isKernelSpecSupported(), true, 'Kernel Spec not supported');
        await assert.eventually.equal(execution.isKernelCreateSupported(), true, 'Kernel Create not supported');
        const usableInterpreter = await execution.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable intepreter not found');
        await assert.isFulfilled(execution.startNotebookServer(), 'Should be able to start a server');
    }).timeout(10000);

    test('Failing notebook throws exception', async () => {
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getInterpreters()).thenResolve([missingNotebookPython]);
        await assert.isRejected(execution.startNotebookServer(), 'Running cells requires Jupyter notebooks to be installed.');
    }).timeout(10000);

    test('Failing others throws exception', async () => {
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getInterpreters()).thenResolve([missingNotebookPython, missingNotebookPython2]);
        await assert.isRejected(execution.startNotebookServer(), 'Running cells requires Jupyter notebooks to be installed.');
    }).timeout(10000);

    test('Slow notebook startups throws exception', async () => {
        const execution = createExecution(workingPython, ['Failure']);
        await assert.isRejected(execution.startNotebookServer(), 'Jupyter notebook failed to launch. \r\nError: The Jupyter notebook server failed to launch in time');
    }).timeout(10000);

    test('Other than active works', async () => {
        const execution = createExecution(missingNotebookPython);
        await assert.eventually.equal(execution.isNotebookSupported(), true, 'Notebook not supported');
        await assert.eventually.equal(execution.isImportSupported(), true, 'Import not supported');
        await assert.eventually.equal(execution.isKernelSpecSupported(), true, 'Kernel Spec not supported');
        await assert.eventually.equal(execution.isKernelCreateSupported(), true, 'Kernel Create not supported');
        const usableInterpreter = await execution.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable intepreter not found');
        if (usableInterpreter) {
            assert.notEqual(usableInterpreter.path, missingNotebookPython.path);
        }
    }).timeout(10000);

    test('Other than active finds closest match', async () => {
        const execution = createExecution(missingKernelPython);
        when(interpreterService.getActiveInterpreter()).thenResolve(missingKernelPython);
        await assert.eventually.equal(execution.isNotebookSupported(), true, 'Notebook not supported');
        const usableInterpreter = await execution.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable intepreter not found');
        if (usableInterpreter) { // Linter
            assert.notEqual(usableInterpreter.path, missingKernelPython.path);
            assert.equal(usableInterpreter.version_info[0], missingKernelPython.version_info[0], 'Found interpreter should match on major');
            assert.notEqual(usableInterpreter.version_info[1], missingKernelPython.version_info[1], 'Found interpreter should not match on minor');
        }
    }).timeout(10000);

    test('Kernelspec is deleted on exit', async () => {
        const execution = createExecution(missingKernelPython);
        await assert.isFulfilled(execution.startNotebookServer(), 'Should be able to start a server');
        cleanupDisposables();
        const exists = fs.existsSync(workingKernelSpec);
        assert.notOk(exists, 'Temp kernel spec still exists');
    }).timeout(10000);

    test('Jupyter found on the path', async () => {
        // Make sure we can find jupyter on the path if we
        // can't find it in a python module.
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getInterpreters()).thenResolve([missingNotebookPython]);
        when(fileSystem.getFiles(anyString())).thenResolve([jupyterOnPath]);
        await assert.isFulfilled(execution.startNotebookServer(), 'Should be able to start a server');
    }).timeout(10000);
});
