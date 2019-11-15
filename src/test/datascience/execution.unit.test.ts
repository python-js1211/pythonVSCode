// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { JSONObject } from '@phosphor/coreutils/lib/json';
import { assert } from 'chai';
import { ChildProcess } from 'child_process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { Observable } from 'rxjs/Observable';
import { SemVer } from 'semver';
import { anyString, anything, deepEqual, instance, match, mock, reset, verify, when } from 'ts-mockito';
import { Matcher } from 'ts-mockito/lib/matcher/type/Matcher';
import * as TypeMoq from 'typemoq';
import * as uuid from 'uuid/v4';
import { CancellationToken, CancellationTokenSource, ConfigurationChangeEvent, Disposable, EventEmitter, Uri } from 'vscode';
import { ApplicationShell } from '../../client/common/application/applicationShell';
import { IApplicationShell, IWorkspaceService } from '../../client/common/application/types';
import { WorkspaceService } from '../../client/common/application/workspace';
import { PythonSettings } from '../../client/common/configSettings';
import { ConfigurationService } from '../../client/common/configuration/service';
import { LiveShareApi } from '../../client/common/liveshare/liveshare';
import { Logger } from '../../client/common/logger';
import { PersistentState, PersistentStateFactory } from '../../client/common/persistentState';
import { FileSystem } from '../../client/common/platform/fileSystem';
import { IFileSystem, TemporaryFile } from '../../client/common/platform/types';
import { ProcessServiceFactory } from '../../client/common/process/processFactory';
import { PythonDaemonExecutionService } from '../../client/common/process/pythonDaemon';
import { PythonExecutionFactory } from '../../client/common/process/pythonExecutionFactory';
import {
    ExecutionResult,
    IProcessService,
    IPythonExecutionService,
    ObservableExecutionResult,
    Output
} from '../../client/common/process/types';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry, ILogger } from '../../client/common/types';
import { createDeferred } from '../../client/common/utils/async';
import { Architecture } from '../../client/common/utils/platform';
import { EXTENSION_ROOT_DIR } from '../../client/constants';
import { Identifiers, PythonDaemonModule } from '../../client/datascience/constants';
import { JupyterCommandFactory } from '../../client/datascience/jupyter/jupyterCommand';
import { JupyterCommandFinder } from '../../client/datascience/jupyter/jupyterCommandFinder';
import { JupyterExecutionFactory } from '../../client/datascience/jupyter/jupyterExecutionFactory';
import {
    ICell,
    IConnection,
    IJupyterKernelSpec,
    INotebook,
    INotebookCompletion,
    INotebookExecutionLogger,
    INotebookServer,
    INotebookServerLaunchInfo,
    InterruptResult
} from '../../client/datascience/types';
import { EnvironmentActivationService } from '../../client/interpreter/activation/service';
import { IInterpreterService, InterpreterType, PythonInterpreter } from '../../client/interpreter/contracts';
import { InterpreterService } from '../../client/interpreter/interpreterService';
import { KnownSearchPathsForInterpreters } from '../../client/interpreter/locators/services/KnownPathsService';
import { ServiceContainer } from '../../client/ioc/container';
import { ServiceManager } from '../../client/ioc/serviceManager';
import { getOSType, OSType } from '../common';
import { noop, sleep } from '../core';
import { MockAutoSelectionService } from '../mocks/autoSelector';
import { MockJupyterManagerFactory } from './mockJupyterManagerFactory';

class MockJupyterNotebook implements INotebook {

    constructor(private owner: INotebookServer) {
        noop();
    }

    public get server(): INotebookServer {
        return this.owner;
    }

    public get resource(): Uri {
        return Uri.parse(Identifiers.InteractiveWindowIdentity);
    }

    public clear(_id: string): void {
        noop();
    }
    public executeObservable(_code: string, _f: string, _line: number): Observable<ICell[]> {
        throw new Error('Method not implemented');
    }

    public async getCompletion(_cellCode: string, _offsetInCode: number, _cancelToken?: CancellationToken): Promise<INotebookCompletion> {
        throw new Error('Method not implemented');
    }
    public execute(_code: string, _f: string, _line: number): Promise<ICell[]> {
        throw new Error('Method not implemented');
    }
    public restartKernel(): Promise<void> {
        throw new Error('Method not implemented');
    }
    public translateToNotebook(_cells: ICell[]): Promise<JSONObject> {
        throw new Error('Method not implemented');
    }
    public waitForIdle(): Promise<void> {
        throw new Error('Method not implemented');
    }
    public setLaunchingFile(_file: string): Promise<void> {
        throw new Error('Method not implemented');
    }

    public async setMatplotLibStyle(_useDark: boolean): Promise<void> {
        noop();
    }

    public addLogger(_logger: INotebookExecutionLogger): void {
        noop();
    }

    public getSysInfo(): Promise<ICell | undefined> {
        return Promise.resolve(undefined);
    }

    public interruptKernel(_timeout: number): Promise<InterruptResult> {
        throw new Error('Method not implemented');
    }

    public async dispose(): Promise<void> {
        return Promise.resolve();
    }
}

// tslint:disable:no-any no-http-string no-multiline-string max-func-body-length
class MockJupyterServer implements INotebookServer {

    private launchInfo: INotebookServerLaunchInfo | undefined;
    private kernelSpec: IJupyterKernelSpec | undefined;
    private notebookFile: TemporaryFile | undefined;
    private _id = uuid();

    public get id(): string {
        return this._id;
    }
    public connect(launchInfo: INotebookServerLaunchInfo): Promise<void> {
        if (launchInfo && launchInfo.connectionInfo && launchInfo.kernelSpec) {
            this.launchInfo = launchInfo;
            this.kernelSpec = launchInfo.kernelSpec;

            // Validate connection info and kernel spec
            if (launchInfo.connectionInfo.baseUrl && launchInfo.kernelSpec.name && /[a-z,A-Z,0-9,-,.,_]+/.test(launchInfo.kernelSpec.name)) {
                return Promise.resolve();
            }
        }
        return Promise.reject('invalid server startup');
    }

    public async createNotebook(_resource: Uri): Promise<INotebook> {
        return new MockJupyterNotebook(this);
    }

    public async getNotebook(_resource: Uri): Promise<INotebook | undefined> {
        return new MockJupyterNotebook(this);
    }

    public async setMatplotLibStyle(_useDark: boolean): Promise<void> {
        noop();
    }
    public getConnectionInfo(): IConnection | undefined {
        return this.launchInfo ? this.launchInfo.connectionInfo : undefined;
    }
    public waitForConnect(): Promise<INotebookServerLaunchInfo | undefined> {
        throw new Error('Method not implemented');
    }
    public async shutdown() {
        return Promise.resolve();
    }

    public async dispose(): Promise<void> {
        if (this.launchInfo) {
            this.launchInfo.connectionInfo.dispose(); // This should kill the process that's running
            this.launchInfo = undefined;
        }
        if (this.kernelSpec) {
            await this.kernelSpec.dispose(); // This destroy any unwanted kernel specs if necessary
            this.kernelSpec = undefined;
        }
        if (this.notebookFile) {
            this.notebookFile.dispose(); // This destroy any unwanted kernel specs if necessary
            this.notebookFile = undefined;
        }

    }
}

class DisposableRegistry implements IDisposableRegistry, IAsyncDisposableRegistry {
    private disposables: Disposable[] = [];

    public push = (disposable: Disposable): void => {
        this.disposables.push(disposable);
    }

    public dispose = async (): Promise<void> => {
        for (const disposable of this.disposables) {
            if (!disposable) {
                continue;
            }
            const val = disposable.dispose();
            if (val instanceof Promise) {
                const promise = val as Promise<void>;
                await promise;
            }
        }
        this.disposables = [];
    }

}

suite('Jupyter Execution', async () => {
    const interpreterService = mock(InterpreterService);
    const executionFactory = mock(PythonExecutionFactory);
    const liveShare = mock(LiveShareApi);
    const configService = mock(ConfigurationService);
    const application = mock(ApplicationShell);
    const processServiceFactory = mock(ProcessServiceFactory);
    const knownSearchPaths = mock(KnownSearchPathsForInterpreters);
    const logger = mock(Logger);
    const fileSystem = mock(FileSystem);
    const activationHelper = mock(EnvironmentActivationService);
    const serviceContainer = mock(ServiceContainer);
    const workspaceService = mock(WorkspaceService);
    const disposableRegistry = new DisposableRegistry();
    const dummyEvent = new EventEmitter<void>();
    const configChangeEvent = new EventEmitter<ConfigurationChangeEvent>();
    const pythonSettings = new PythonSettings(undefined, new MockAutoSelectionService());
    const jupyterOnPath = getOSType() === OSType.Windows ? '/foo/bar/jupyter.exe' : '/foo/bar/jupyter';
    let ipykernelInstallCount = 0;

    const workingPython: PythonInterpreter = {
        path: '/foo/bar/python.exe',
        version: new SemVer('3.6.6-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        type: InterpreterType.Unknown,
        architecture: Architecture.x64
    };

    const missingKernelPython: PythonInterpreter = {
        path: '/foo/baz/python.exe',
        version: new SemVer('3.1.1-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        type: InterpreterType.Unknown,
        architecture: Architecture.x64
    };

    const missingNotebookPython: PythonInterpreter = {
        path: '/bar/baz/python.exe',
        version: new SemVer('2.1.1-final'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        type: InterpreterType.Unknown,
        architecture: Architecture.x64
    };

    const missingNotebookPython2: PythonInterpreter = {
        path: '/two/baz/python.exe',
        version: new SemVer('2.1.1'),
        sysVersion: '1.0.0.0',
        sysPrefix: 'Python',
        type: InterpreterType.Unknown,
        architecture: Architecture.x64
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
        return cleanupDisposables();
    });

    function cleanupDisposables(): Promise<void> {
        return disposableRegistry.dispose();
    }

    // tslint:disable-next-line: max-classes-per-file
    class FunctionMatcher extends Matcher {
        private func: (obj: any) => boolean;
        constructor(func: (obj: any) => boolean) {
            super();
            this.func = func;
        }
        public match(value: Object): boolean {
            return this.func(value);
        }
        public toString(): string {
            return 'FunctionMatcher';
        }
    }

    function createTempSpec(pythonPath: string): string {
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

    function argThat(func: (obj: any) => boolean): any {
        return new FunctionMatcher(func);
    }

    function createTypeMoq<T>(tag: string): TypeMoq.IMock<T> {
        // Use typemoqs for those things that are resolved as promises. mockito doesn't allow nesting of mocks. ES6 Proxy class
        // is the problem. We still need to make it thenable though. See this issue: https://github.com/florinn/typemoq/issues/67
        const result: TypeMoq.IMock<T> = TypeMoq.Mock.ofType<T>();
        (result as any).tag = tag;
        result.setup((x: any) => x.then).returns(() => undefined);
        return result;
    }

    function argsMatch(matchers: (string | RegExp)[], args: string[]): boolean {
        if (matchers.length === args.length) {
            return args.every((s, i) => {
                const r = matchers[i] as RegExp;
                return r && r.test ? r.test(s) : s === matchers[i];
            });
        }
        return false;
    }

    function setupPythonService(service: TypeMoq.IMock<IPythonExecutionService>, module: string | undefined, args: (string | RegExp)[], result: Promise<ExecutionResult<string>>) {

        if (module) {
            service.setup(x => x.execModule(
                TypeMoq.It.isValue(module),
                TypeMoq.It.is(a => argsMatch(args, a)),
                TypeMoq.It.isAny()))
                .returns(() => result);
            const withModuleArgs = ['-m', module, ...args];
            service.setup(x => x.exec(
                TypeMoq.It.is(a => argsMatch(withModuleArgs, a)),
                TypeMoq.It.isAny()))
                .returns(() => result);
        } else {
            service.setup(x => x.exec(
                TypeMoq.It.is(a => argsMatch(args, a)),
                TypeMoq.It.isAny()))
                .returns(() => result);

        }
    }

    function setupPythonServiceWithFunc(service: TypeMoq.IMock<IPythonExecutionService>, module: string, args: (string | RegExp)[], result: () => Promise<ExecutionResult<string>>) {
        service.setup(x => x.execModule(
            TypeMoq.It.isValue(module),
            TypeMoq.It.is(a => argsMatch(args, a)),
            TypeMoq.It.isAny()))
            .returns(result);
        const withModuleArgs = ['-m', module, ...args];
        service.setup(x => x.exec(
            TypeMoq.It.is(a => argsMatch(withModuleArgs, a)),
            TypeMoq.It.isAny()))
            .returns(result);
        service.setup(x => x.execModule(
            TypeMoq.It.isValue(module),
            TypeMoq.It.is(a => argsMatch(args, a)),
            TypeMoq.It.isAny()))
            .returns(result);
    }

    function setupPythonServiceExecObservable(service: TypeMoq.IMock<IPythonExecutionService>, module: string, args: (string | RegExp)[], stderr: string[], stdout: string[]) {
        const result: ObservableExecutionResult<string> = {
            proc: undefined,
            out: new Observable<Output<string>>(subscriber => {
                stderr.forEach(s => subscriber.next({ source: 'stderr', out: s }));
                stdout.forEach(s => subscriber.next({ source: 'stderr', out: s }));
            }),
            dispose: () => {
                noop();
            }
        };

        service.setup(x => x.execModuleObservable(
            TypeMoq.It.isValue(module),
            TypeMoq.It.is(a => argsMatch(args, a)),
            TypeMoq.It.isAny()))
            .returns(() => result);
        const withModuleArgs = ['-m', module, ...args];
        service.setup(x => x.execObservable(
            TypeMoq.It.is(a => argsMatch(withModuleArgs, a)),
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
        const result: ObservableExecutionResult<string> = {
            proc: undefined,
            out: new Observable<Output<string>>(subscriber => {
                stderr.forEach(s => subscriber.next({ source: 'stderr', out: s }));
                stdout.forEach(s => subscriber.next({ source: 'stderr', out: s }));
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

    function setupWorkingPythonService(service: TypeMoq.IMock<IPythonExecutionService>, notebookStdErr?: string[]) {
        setupPythonService(service, 'ipykernel', ['--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupPythonService(service, 'jupyter', ['nbconvert', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupPythonService(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupPythonService(service, 'jupyter', ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        service.setup(x => x.getInterpreterInformation()).returns(() => Promise.resolve(workingPython));

        // Don't mind the goofy path here. It's supposed to not find the item. It's just testing the internal regex works
        setupPythonServiceWithFunc(service, 'jupyter', ['kernelspec', 'list'], () => {
            // Return different results after we install our kernel
            if (ipykernelInstallCount > 0) {
                return Promise.resolve({ stdout: `working ${path.dirname(workingKernelSpec)}\r\n 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0` });
            }
            return Promise.resolve({ stdout: ` 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0` });
        });
        setupPythonService(service, 'jupyter', ['kernelspec', 'list'], Promise.resolve({ stdout: `working ${path.dirname(workingKernelSpec)}\r\n 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0` }));
        setupPythonServiceWithFunc(service, 'ipykernel', ['install', '--user', '--name', /\w+-\w+-\w+-\w+-\w+/, '--display-name', `'Python Interactive'`], () => {
            ipykernelInstallCount += 1;
            return Promise.resolve({ stdout: `somename ${path.dirname(workingKernelSpec)}` });
        });
        const getServerInfoPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'datascience', 'getServerInfo.py');
        setupPythonService(service, undefined, [getServerInfoPath], Promise.resolve({ stdout: 'failure to get server infos' }));
        setupPythonServiceExecObservable(service, 'jupyter', ['kernelspec', 'list'], [], []);
        setupPythonServiceExecObservable(service, 'jupyter', ['notebook', '--no-browser', /--notebook-dir=.*/, /--config=.*/, '--NotebookApp.iopub_data_rate_limit=10000000000.0'], [], notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']);

    }

    function setupMissingKernelPythonService(service: TypeMoq.IMock<IPythonExecutionService>, notebookStdErr?: string[]) {
        setupPythonService(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupPythonService(service, 'jupyter', ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        service.setup(x => x.getInterpreterInformation()).returns(() => Promise.resolve(missingKernelPython));
        setupPythonService(service, 'jupyter', ['kernelspec', 'list'], Promise.resolve({ stdout: `working ${path.dirname(workingKernelSpec)}` }));
        const getServerInfoPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'datascience', 'getServerInfo.py');
        setupPythonService(service, undefined, [getServerInfoPath], Promise.resolve({ stdout: 'failure to get server infos' }));
        setupPythonServiceExecObservable(service, 'jupyter', ['kernelspec', 'list'], [], []);
        setupPythonServiceExecObservable(service, 'jupyter', ['notebook', '--no-browser', /--notebook-dir=.*/, /--config=.*/, '--NotebookApp.iopub_data_rate_limit=10000000000.0'], [], notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']);
    }

    function setupMissingNotebookPythonService(service: TypeMoq.IMock<IPythonExecutionService>) {
        service.setup(x => x.execModule(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((_v) => {
                return Promise.reject('cant exec');
            });
        service.setup(x => x.getInterpreterInformation()).returns(() => Promise.resolve(missingNotebookPython));
    }

    function setupWorkingProcessService(service: TypeMoq.IMock<IProcessService>, notebookStdErr?: string[]) {
        // Don't mind the goofy path here. It's supposed to not find the item. It's just testing the internal regex works
        setupProcessServiceExecWithFunc(service, workingPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], () => {
            // Return different results after we install our kernel
            if (ipykernelInstallCount > 0) {
                return Promise.resolve({ stdout: `working ${path.dirname(workingKernelSpec)}\r\n 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0` });
            }
            return Promise.resolve({ stdout: ` 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0` });
        });
        setupProcessServiceExec(service, workingPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], Promise.resolve({ stdout: `working ${path.dirname(workingKernelSpec)}\r\n 0e8519db-0895-416c-96df-fa80131ecea0    C:\\Users\\rchiodo\\AppData\\Roaming\\jupyter\\kernels\\0e8519db-0895-416c-96df-fa80131ecea0` }));
        setupProcessServiceExecWithFunc(service, workingPython.path, ['-m', 'ipykernel', 'install', '--user', '--name', /\w+-\w+-\w+-\w+-\w+/, '--display-name', `'Python Interactive'`], () => {
            ipykernelInstallCount += 1;
            return Promise.resolve({ stdout: `somename ${path.dirname(workingKernelSpec)}` });
        });
        const getServerInfoPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'datascience', 'getServerInfo.py');
        setupProcessServiceExec(service, workingPython.path, [getServerInfoPath], Promise.resolve({ stdout: 'failure to get server infos' }));
        setupProcessServiceExecObservable(service, workingPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], [], []);
        setupProcessServiceExecObservable(service, workingPython.path, ['-m', 'jupyter', 'notebook', '--no-browser', /--notebook-dir=.*/, /--config=.*/, '--NotebookApp.iopub_data_rate_limit=10000000000.0'], [], notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']);
    }

    function setupMissingKernelProcessService(service: TypeMoq.IMock<IProcessService>, notebookStdErr?: string[]) {
        setupProcessServiceExec(service, missingKernelPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], Promise.resolve({ stdout: `working ${path.dirname(workingKernelSpec)}` }));
        const getServerInfoPath = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'datascience', 'getServerInfo.py');
        setupProcessServiceExec(service, missingKernelPython.path, [getServerInfoPath], Promise.resolve({ stdout: 'failure to get server infos' }));
        setupProcessServiceExecObservable(service, missingKernelPython.path, ['-m', 'jupyter', 'kernelspec', 'list'], [], []);
        setupProcessServiceExecObservable(service, missingKernelPython.path, ['-m', 'jupyter', 'notebook', '--no-browser', /--notebook-dir=.*/, /--config=.*/, '--NotebookApp.iopub_data_rate_limit=10000000000.0'], [], notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']);
    }

    function setupPathProcessService(jupyterPath: string, service: TypeMoq.IMock<IProcessService>, notebookStdErr?: string[]) {
        setupProcessServiceExec(service, jupyterPath, ['kernelspec', 'list'], Promise.resolve({ stdout: `working ${path.dirname(workingKernelSpec)}` }));
        setupProcessServiceExecObservable(service, jupyterPath, ['kernelspec', 'list'], [], []);
        setupProcessServiceExec(service, jupyterPath, ['--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupProcessServiceExec(service, jupyterPath, ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupProcessServiceExec(service, jupyterPath, ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupProcessServiceExecObservable(service, jupyterPath, ['notebook', '--no-browser', /--notebook-dir=.*/, /--config=.*/, '--NotebookApp.iopub_data_rate_limit=10000000000.0'], [], notebookStdErr ? notebookStdErr : ['http://localhost:8888/?token=198']);

        // WE also check for existence with just the key jupyter
        setupProcessServiceExec(service, 'jupyter', ['--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupProcessServiceExec(service, 'jupyter', ['notebook', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
        setupProcessServiceExec(service, 'jupyter', ['kernelspec', '--version'], Promise.resolve({ stdout: '1.1.1.1' }));
    }

    function createExecution(activeInterpreter: PythonInterpreter, notebookStdErr?: string[], skipSearch?: boolean): JupyterExecutionFactory {
        return createExecutionAndReturnProcessService(activeInterpreter, notebookStdErr, skipSearch).jupyterExecutionFactory;
    }
    function createExecutionAndReturnProcessService(activeInterpreter: PythonInterpreter, notebookStdErr?: string[], skipSearch?: boolean): {workingPythonExecutionService: TypeMoq.IMock<IPythonExecutionService>; jupyterExecutionFactory: JupyterExecutionFactory} {
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
        setupWorkingPythonService(workingService, notebookStdErr);
        const missingKernelService = createTypeMoq<IPythonExecutionService>('missingKernel');
        setupMissingKernelPythonService(missingKernelService, notebookStdErr);
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
        when(executionFactory.createActivatedEnvironment(argThat(o => !o || o.interpreter === activeInterpreter))).thenResolve(activeService);
        when(processServiceFactory.create()).thenResolve(processService.object);

        when(liveShare.getApi()).thenResolve(null);

        // Service container needs logger, file system, and config service
        when(serviceContainer.get<IConfigurationService>(IConfigurationService)).thenReturn(instance(configService));
        when(serviceContainer.get<IFileSystem>(IFileSystem)).thenReturn(instance(fileSystem));
        when(serviceContainer.get<ILogger>(ILogger)).thenReturn(instance(logger));
        when(serviceContainer.get<IWorkspaceService>(IWorkspaceService)).thenReturn(instance(workspaceService));
        when(serviceContainer.get<IApplicationShell>(IApplicationShell)).thenReturn(instance(application));
        when(configService.getSettings()).thenReturn(pythonSettings);
        when(workspaceService.onDidChangeConfiguration).thenReturn(configChangeEvent.event);
        when(application.withProgress(anything(), anything())).thenCall((_, cb: (_: any, token: any) => Promise<any>) => {
            return new Promise((resolve, reject) => {
                cb({ report: noop }, new CancellationTokenSource().token).then(resolve).catch(reject);
            });
        });

        // Setup default settings
        pythonSettings.datascience = {
            allowImportFromNotebook: true,
            jupyterLaunchTimeout: 10,
            jupyterLaunchRetries: 3,
            enabled: true,
            jupyterServerURI: 'local',
            notebookFileRoot: 'WORKSPACE',
            changeDirOnImportExport: true,
            useDefaultConfigForJupyter: true,
            jupyterInterruptTimeout: 10000,
            searchForJupyter: !skipSearch,
            showCellInputCode: true,
            collapseCellInputCodeByDefault: true,
            allowInput: true,
            maxOutputSize: 400,
            errorBackgroundColor: '#FFFFFF',
            sendSelectionToInteractiveWindow: false,
            variableExplorerExclude: 'module;function;builtin_function_or_method',
            codeRegularExpression: '^(#\\s*%%|#\\s*\\<codecell\\>|#\\s*In\\[\\d*?\\]|#\\s*In\\[ \\])',
            markdownRegularExpression: '^(#\\s*%%\\s*\\[markdown\\]|#\\s*\\<markdowncell\\>)',
            allowLiveShare: false,
            enablePlotViewer: true,
            runStartupCommands: '',
            debugJustMyCode: true
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
        when(fileSystem.createDirectory(anything())).thenResolve();
        when(fileSystem.deleteDirectory(anything())).thenResolve();
        when(fileSystem.fileExists(workingKernelSpec)).thenResolve(true);
        when(fileSystem.readFile(workingKernelSpec)).thenResolve('{"display_name":"Python 3","language":"python","argv":["/foo/bar/python.exe","-m","ipykernel_launcher","-f","{connection_file}"]}');

        const serviceManager = mock(ServiceManager);

        const mockSessionManager = new MockJupyterManagerFactory(instance(serviceManager));
        const commandFactory = new JupyterCommandFactory(
            instance(executionFactory),
            instance(activationHelper),
            instance(processServiceFactory),
            instance(interpreterService));
        const persistentSateFactory = mock(PersistentStateFactory);
        const persistentState = mock(PersistentState);
        when(persistentState.updateValue(anything())).thenResolve();
        when(persistentSateFactory.createGlobalPersistentState(anything())).thenReturn(instance(persistentState));
        when(persistentSateFactory.createGlobalPersistentState(anything(), anything())).thenReturn(instance(persistentState));
        when(persistentSateFactory.createWorkspacePersistentState(anything())).thenReturn(instance(persistentState));
        when(persistentSateFactory.createWorkspacePersistentState(anything(), anything())).thenReturn(instance(persistentState));
        const commandFinder = new JupyterCommandFinder(
            instance(interpreterService),
            instance(executionFactory),
            instance(configService),
            instance(knownSearchPaths),
            disposableRegistry,
            instance(fileSystem),
            instance(logger),
            instance(processServiceFactory),
            commandFactory,
            instance(workspaceService),
            instance(application),
            instance(persistentSateFactory));
        when(serviceContainer.get<JupyterCommandFinder>(JupyterCommandFinder)).thenReturn(commandFinder);
        when(serviceContainer.get<IInterpreterService>(IInterpreterService)).thenReturn(instance(interpreterService));
        return {
            workingPythonExecutionService: workingService,
            jupyterExecutionFactory: new JupyterExecutionFactory(
                instance(liveShare),
                instance(executionFactory),
                instance(interpreterService),
                instance(processServiceFactory),
                instance(logger),
                disposableRegistry,
                disposableRegistry,
                instance(fileSystem),
                mockSessionManager,
                instance(workspaceService),
                instance(configService),
                instance(serviceContainer))
        };
    }

    test('Working notebook and commands found', async () => {
        const { workingPythonExecutionService, jupyterExecutionFactory} = createExecutionAndReturnProcessService(workingPython);
        when(executionFactory.createDaemon(deepEqual({ daemonModule: PythonDaemonModule, pythonPath: workingPython.path }))).thenResolve(workingPythonExecutionService.object);

        await assert.eventually.equal(jupyterExecutionFactory.isNotebookSupported(), true, 'Notebook not supported');
        await assert.eventually.equal(jupyterExecutionFactory.isImportSupported(), true, 'Import not supported');
        await assert.eventually.equal(jupyterExecutionFactory.isKernelSpecSupported(), true, 'Kernel Spec not supported');
        await assert.eventually.equal(jupyterExecutionFactory.isKernelCreateSupported(), true, 'Kernel Create not supported');
        const usableInterpreter = await jupyterExecutionFactory.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable interpreter not found');
        await assert.isFulfilled(jupyterExecutionFactory.connectToNotebookServer(), 'Should be able to start a server');
    }).timeout(10000);

    test('Failing notebook throws exception', async () => {
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getInterpreters()).thenResolve([missingNotebookPython]);
        await assert.isRejected(execution.connectToNotebookServer(), 'cant exec');
    }).timeout(10000);

    test('Failing others throws exception', async () => {
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getInterpreters()).thenResolve([missingNotebookPython, missingNotebookPython2]);
        await assert.isRejected(execution.connectToNotebookServer(), 'cant exec');
    }).timeout(10000);

    test('Slow notebook startups throws exception', async () => {
        const daemonService = mock(PythonDaemonExecutionService);
        const stdErr = 'Failure';
        const proc = {on: noop} as any as ChildProcess;
        const out = new Observable<Output<string>>(s => s.next({ source: 'stderr', out: stdErr }));
        when(daemonService.execModuleObservable(anything(), anything(), anything())).thenReturn({ dispose: noop, proc: proc, out });
        when(executionFactory.createDaemon(deepEqual({ daemonModule: PythonDaemonModule, pythonPath: workingPython.path }))).thenResolve(instance(daemonService));

        const execution = createExecution(workingPython, [stdErr]);
        await assert.isRejected(execution.connectToNotebookServer(), `Jupyter notebook failed to launch. \r\nError: The Jupyter notebook server failed to launch in time\n${stdErr}`);
    }).timeout(10000);

    test('Other than active works', async () => {
        const execution = createExecution(missingNotebookPython);
        await assert.eventually.equal(execution.isNotebookSupported(), true, 'Notebook not supported');
        await assert.eventually.equal(execution.isImportSupported(), true, 'Import not supported');
        await assert.eventually.equal(execution.isKernelSpecSupported(), true, 'Kernel Spec not supported');
        await assert.eventually.equal(execution.isKernelCreateSupported(), true, 'Kernel Create not supported');
        const usableInterpreter = await execution.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable interpreter not found');
        if (usableInterpreter) {
            assert.notEqual(usableInterpreter.path, missingNotebookPython.path);
        }
    }).timeout(10000);

    test('Missing kernel python still finds interpreter', async () => {
        const execution = createExecution(missingKernelPython);
        when(interpreterService.getActiveInterpreter()).thenResolve(missingKernelPython);
        await assert.eventually.equal(execution.isNotebookSupported(), true, 'Notebook not supported');
        const usableInterpreter = await execution.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable interpreter not found');
        if (usableInterpreter) { // Linter
            assert.equal(usableInterpreter.path, missingKernelPython.path);
            assert.equal(usableInterpreter.version!.major, missingKernelPython.version!.major, 'Found interpreter should match on major');
            assert.equal(usableInterpreter.version!.minor, missingKernelPython.version!.minor, 'Found interpreter should match on minor');
        }
    }).timeout(10000);

    test('Other than active finds closest match', async () => {
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getActiveInterpreter()).thenResolve(missingNotebookPython);
        await assert.eventually.equal(execution.isNotebookSupported(), true, 'Notebook not supported');
        const usableInterpreter = await execution.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable interpreter not found');
        if (usableInterpreter) { // Linter
            assert.notEqual(usableInterpreter.path, missingNotebookPython.path);
            assert.notEqual(usableInterpreter.version!.major, missingNotebookPython.version!.major, 'Found interpreter should not match on major');
        }
        // Force config change and ask again
        pythonSettings.datascience.searchForJupyter = false;
        const evt = {
            affectsConfiguration(_m: string): boolean {
                return true;
            }
        };
        configChangeEvent.fire(evt);
        // Wait for cache to get cleared.
        await sleep(100);
        await assert.eventually.equal(execution.isNotebookSupported(), false, 'Notebook should not be supported after config change');
    }).timeout(10000);

    test('Display progress message', async () => {
        const execution = createExecution(missingNotebookPython);
        await assert.eventually.equal(execution.isNotebookSupported(), true, 'Notebook not supported');
        const usableInterpreter = await execution.getUsableJupyterPython();
        assert.isOk(usableInterpreter, 'Usable interpreter not found');
        if (usableInterpreter) { // Linter
            assert.notEqual(usableInterpreter.path, missingNotebookPython.path);
            assert.notEqual(usableInterpreter.version!.major, missingNotebookPython.version!.major, 'Found interpreter should not match on major');
        }
        // Force config change and ask again
        pythonSettings.datascience.searchForJupyter = false;
        const evt = {
            affectsConfiguration(_m: string): boolean {
                return true;
            }
        };
        configChangeEvent.fire(evt);
        // Wait for cache to get cleared.
        await sleep(100);
        await assert.eventually.equal(execution.isNotebookSupported(), false, 'Notebook should not be supported after config change');
        verify(application.withProgress(anything(), anything())).atLeast(1);
    }).timeout(10000);

    test('Progress message should not be displayed for more than 1s when interpreter search completes quickly', async () => {
        const execution = createExecution(missingNotebookPython);
        const progressCancellation = new CancellationTokenSource();
        reset(application);
        when(application.withProgress(anything(), anything())).thenCall((_, cb: (_: any, token: any) => Promise<any>) => {
            return new Promise((resolve, reject) => {
                cb({ report: noop }, progressCancellation.token).then(resolve).catch(reject);
            });
        });

        // Now interpreters = fast discovery (less time for display of progress).
        when(interpreterService.getInterpreters()).thenReturn(Promise.resolve([]));

        // The call to isNotebookSupported should not timeout in 1 seconds.
        const isNotebookSupported = execution.isNotebookSupported();
        await assert.eventually.notEqual(Promise.race([isNotebookSupported, sleep(1000).then(() => 'timeout')]), 'timeout');
        verify(application.withProgress(anything(), anything())).atLeast(1);
    }).timeout(10_000);

    test('Cancel progress message if interpreter search takes too long', async () => {
        const execution = createExecution(missingNotebookPython);
        const progressCancellation = new CancellationTokenSource();
        reset(application);
        when(application.withProgress(anything(), anything())).thenCall((_, cb: (_: any, token: any) => Promise<any>) => {
            return new Promise((resolve, reject) => {
                cb({ report: noop }, progressCancellation.token).then(resolve).catch(reject);
            });
        });

        const slowInterpreterDiscovery = createDeferred<PythonInterpreter[]>();
        when(interpreterService.getInterpreters()).thenReturn(slowInterpreterDiscovery.promise);

        // The call to interpreterService.getInterpreters shoud not complete, it is very slow.
        const isNotebookSupported = execution.isNotebookSupported();
        await assert.eventually.equal(Promise.race([isNotebookSupported, sleep(5000).then(() => 'timeout')]), 'timeout');

        // Once we cancel the progress message, the promise should resolve almost immediately.
        progressCancellation.cancel();
        await assert.eventually.notEqual(Promise.race([isNotebookSupported, sleep(500).then(() => 'timeout')]), 'timeout');
        verify(application.withProgress(anything(), anything())).atLeast(1);
    }).timeout(20_000);

    test('Kernelspec is deleted on exit', async () => {
        const { workingPythonExecutionService, jupyterExecutionFactory} = createExecutionAndReturnProcessService(missingKernelPython);
        when(interpreterService.getActiveInterpreter(undefined)).thenResolve(missingKernelPython);
        when(executionFactory.createDaemon(deepEqual({ daemonModule: PythonDaemonModule, pythonPath: missingKernelPython.path }))).thenResolve(workingPythonExecutionService.object);

        // const execution = createExecution(missingKernelPython);
        await assert.isFulfilled(jupyterExecutionFactory.connectToNotebookServer(), 'Should be able to start a server');
        await cleanupDisposables();
        const exists = fs.existsSync(workingKernelSpec);
        assert.notOk(exists, 'Temp kernel spec still exists');
    }).timeout(10000);

    test('Jupyter found on the path', async () => {
        // Make sure we can find jupyter on the path if we
        // can't find it in a python module.
        const execution = createExecution(missingNotebookPython);
        when(interpreterService.getInterpreters()).thenResolve([missingNotebookPython]);
        when(fileSystem.getFiles(anyString())).thenResolve([jupyterOnPath]);
        await assert.isFulfilled(execution.connectToNotebookServer(), 'Should be able to start a server');
    }).timeout(10000);

    test('Jupyter found on the path skipped', async () => {
        // Make sure we can find jupyter on the path if we
        // can't find it in a python module.
        const execution = createExecution(missingNotebookPython, undefined, true);
        when(interpreterService.getInterpreters()).thenResolve([missingNotebookPython]);
        when(fileSystem.getFiles(anyString())).thenResolve([jupyterOnPath]);
        await assert.isRejected(execution.connectToNotebookServer(), 'cant exec');
    }).timeout(10000);
});
