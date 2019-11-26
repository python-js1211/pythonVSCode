// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fsextra from 'fs-extra';
import { Container } from 'inversify';
import * as path from 'path';
import { anything, instance, mock, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { Disposable, Memento, OutputChannel } from 'vscode';
import { STANDARD_OUTPUT_CHANNEL } from '../client/common/constants';
import { Logger } from '../client/common/logger';
import { IS_WINDOWS } from '../client/common/platform/constants';
import {
    FileSystem, FileSystemPaths, FileSystemUtils, RawFileSystem
} from '../client/common/platform/fileSystem';
import { PathUtils } from '../client/common/platform/pathUtils';
import { PlatformService } from '../client/common/platform/platformService';
import { RegistryImplementation } from '../client/common/platform/registry';
import { registerTypes as platformRegisterTypes } from '../client/common/platform/serviceRegistry';
import { FileStat, FileType, IFileSystem, IPlatformService, IRegistry } from '../client/common/platform/types';
import { BufferDecoder } from '../client/common/process/decoder';
import { ProcessService } from '../client/common/process/proc';
import { PythonExecutionFactory } from '../client/common/process/pythonExecutionFactory';
import { PythonToolExecutionService } from '../client/common/process/pythonToolService';
import { registerTypes as processRegisterTypes } from '../client/common/process/serviceRegistry';
import { IBufferDecoder, IProcessServiceFactory, IPythonExecutionFactory, IPythonToolExecutionService } from '../client/common/process/types';
import { registerTypes as commonRegisterTypes } from '../client/common/serviceRegistry';
import { GLOBAL_MEMENTO, ICurrentProcess, IDisposableRegistry, ILogger, IMemento, IOutputChannel, IPathUtils, IsWindows, WORKSPACE_MEMENTO } from '../client/common/types';
import { createDeferred } from '../client/common/utils/async';
import { registerTypes as variableRegisterTypes } from '../client/common/variables/serviceRegistry';
import { registerTypes as formattersRegisterTypes } from '../client/formatters/serviceRegistry';
import { EnvironmentActivationService } from '../client/interpreter/activation/service';
import { IEnvironmentActivationService } from '../client/interpreter/activation/types';
import { IInterpreterAutoSelectionService, IInterpreterAutoSeletionProxyService } from '../client/interpreter/autoSelection/types';
import { CONDA_ENV_FILE_SERVICE, CONDA_ENV_SERVICE, CURRENT_PATH_SERVICE, GLOBAL_VIRTUAL_ENV_SERVICE, IInterpreterLocatorHelper, IInterpreterLocatorService, IInterpreterService, INTERPRETER_LOCATOR_SERVICE, IPipEnvService, KNOWN_PATH_SERVICE, PIPENV_SERVICE, WINDOWS_REGISTRY_SERVICE, WORKSPACE_VIRTUAL_ENV_SERVICE } from '../client/interpreter/contracts';
import { InterpreterService } from '../client/interpreter/interpreterService';
import { PythonInterpreterLocatorService } from '../client/interpreter/locators';
import { InterpreterLocatorHelper } from '../client/interpreter/locators/helpers';
import { CondaEnvFileService } from '../client/interpreter/locators/services/condaEnvFileService';
import { CondaEnvService } from '../client/interpreter/locators/services/condaEnvService';
import { CurrentPathService } from '../client/interpreter/locators/services/currentPathService';
import { GlobalVirtualEnvService } from '../client/interpreter/locators/services/globalVirtualEnvService';
import { InterpreterHashProvider } from '../client/interpreter/locators/services/hashProvider';
import { InterpeterHashProviderFactory } from '../client/interpreter/locators/services/hashProviderFactory';
import { InterpreterFilter } from '../client/interpreter/locators/services/interpreterFilter';
import { KnownPathsService } from '../client/interpreter/locators/services/KnownPathsService';
import { PipEnvService } from '../client/interpreter/locators/services/pipEnvService';
import { PipEnvServiceHelper } from '../client/interpreter/locators/services/pipEnvServiceHelper';
import { WindowsRegistryService } from '../client/interpreter/locators/services/windowsRegistryService';
import { WindowsStoreInterpreter } from '../client/interpreter/locators/services/windowsStoreInterpreter';
import { WorkspaceVirtualEnvService } from '../client/interpreter/locators/services/workspaceVirtualEnvService';
import { IPipEnvServiceHelper } from '../client/interpreter/locators/types';
import { registerTypes as interpretersRegisterTypes } from '../client/interpreter/serviceRegistry';
import { ServiceContainer } from '../client/ioc/container';
import { ServiceManager } from '../client/ioc/serviceManager';
import { IServiceContainer, IServiceManager } from '../client/ioc/types';
import { registerTypes as lintersRegisterTypes } from '../client/linters/serviceRegistry';
import { TEST_OUTPUT_CHANNEL } from '../client/testing/common/constants';
import { registerTypes as unittestsRegisterTypes } from '../client/testing/serviceRegistry';
import { MockOutputChannel } from './mockClasses';
import { MockAutoSelectionService } from './mocks/autoSelector';
import { MockMemento } from './mocks/mementos';
import { MockProcessService } from './mocks/proc';
import { MockProcess } from './mocks/process';

// This is necessary for unit tests and functional tests, since they
// do not run under VS Code so they do not have access to the actual
// "vscode" namespace.
class LegacyRawFileSystem extends RawFileSystem {
    public async readText(filename: string): Promise<string> {
        return fsextra.readFile(filename, 'utf8');
    }
    public async writeText(filename: string, text: string): Promise<void> {
        return fsextra.writeFile(filename, text, {
            encoding: 'utf8'
        });
    }
    public async rmtree(dirname: string): Promise<void> {
        return fsextra.stat(dirname)
            .then(() => fsextra.remove(dirname));
    }
    public async rmfile(filename: string): Promise<void> {
        return fsextra.unlink(filename);
    }
    public async stat(filename: string): Promise<FileStat> {
        const stat = await fsextra.stat(filename);
        let fileType = FileType.Unknown;
        if (stat.isFile()) {
            fileType = FileType.File;
        } else if (stat.isDirectory()) {
            fileType = FileType.Directory;
        } else if (stat.isSymbolicLink()) {
            fileType = FileType.SymbolicLink;
        }
        return {
            type: fileType,
            size: stat.size,
            ctime: stat.ctimeMs,
            mtime: stat.mtimeMs
        };
    }
    public async listdir(dirname: string): Promise<[string, FileType][]> {
        const names: string[] = await fsextra.readdir(dirname);
        const promises = names
            .map(name => {
                 const filename = path.join(dirname, name);
                 return this.lstat(filename)
                     .then(stat => [name, stat.type] as [string, FileType])
                     .catch(() => [name, FileType.Unknown] as [string, FileType]);
            });
        return Promise.all(promises);
    }
    public async mkdirp(dirname: string): Promise<void> {
        return fsextra.mkdirp(dirname);
    }
    public async copyFile(src: string, dest: string): Promise<void> {
        const deferred = createDeferred<void>();
        const rs = fsextra.createReadStream(src)
            .on('error', (err) => {
                deferred.reject(err);
            });
        const ws = fsextra.createWriteStream(dest)
            .on('error', (err) => {
                deferred.reject(err);
            }).on('close', () => {
                deferred.resolve();
            });
        rs.pipe(ws);
        return deferred.promise;
    }
}
class LegacyFileSystem extends FileSystem {
    constructor() {
        super();
        const paths = FileSystemPaths.withDefaults();
        const raw = new LegacyRawFileSystem(
            paths,
            // tslint:disable-next-line:no-any
            undefined as any,
            fsextra
        );
        this.utils = FileSystemUtils.withDefaults(raw, paths);
    }
}

export class IocContainer {
    // This may be set (before any registration happens) to indicate
    // whether or not IOC should depend on the VS Code API (e.g. the
    // "vscode" module).  So in "functional" tests, this should be set
    // to "false".
    public useVSCodeAPI = true;

    public readonly serviceManager: IServiceManager;
    public readonly serviceContainer: IServiceContainer;

    private disposables: Disposable[] = [];

    constructor() {
        const cont = new Container();
        this.serviceManager = new ServiceManager(cont);
        this.serviceContainer = new ServiceContainer(cont);

        this.serviceManager.addSingletonInstance<IServiceContainer>(IServiceContainer, this.serviceContainer);
        this.serviceManager.addSingletonInstance<Disposable[]>(IDisposableRegistry, this.disposables);
        this.serviceManager.addSingleton<Memento>(IMemento, MockMemento, GLOBAL_MEMENTO);
        this.serviceManager.addSingleton<Memento>(IMemento, MockMemento, WORKSPACE_MEMENTO);

        const stdOutputChannel = new MockOutputChannel('Python');
        this.disposables.push(stdOutputChannel);
        this.serviceManager.addSingletonInstance<OutputChannel>(IOutputChannel, stdOutputChannel, STANDARD_OUTPUT_CHANNEL);
        const testOutputChannel = new MockOutputChannel('Python Test - UnitTests');
        this.disposables.push(testOutputChannel);
        this.serviceManager.addSingletonInstance<OutputChannel>(IOutputChannel, testOutputChannel, TEST_OUTPUT_CHANNEL);

        this.serviceManager.addSingleton<IInterpreterAutoSelectionService>(IInterpreterAutoSelectionService, MockAutoSelectionService);
        this.serviceManager.addSingleton<IInterpreterAutoSeletionProxyService>(IInterpreterAutoSeletionProxyService, MockAutoSelectionService);
    }
    public async dispose(): Promise<void> {
        for (const disposable of this.disposables) {
            if (!disposable) {
                continue;
            }
            // tslint:disable-next-line:no-any
            const promise = disposable.dispose() as Promise<any>;
            if (promise) {
                await promise;
            }
        }
    }

    public registerCommonTypes(registerFileSystem: boolean = true) {
        commonRegisterTypes(this.serviceManager);
        if (registerFileSystem) {
            this.registerFileSystemTypes();
        }
    }
    public registerFileSystemTypes() {
        this.serviceManager.addSingleton<IPlatformService>(IPlatformService, PlatformService);
        this.serviceManager.addSingleton<IFileSystem>(
            IFileSystem,
            this.useVSCodeAPI ? FileSystem : LegacyFileSystem
        );
    }
    public registerProcessTypes() {
        processRegisterTypes(this.serviceManager);
        const mockEnvironmentActivationService = mock(EnvironmentActivationService);
        when(mockEnvironmentActivationService.getActivatedEnvironmentVariables(anything())).thenResolve();
        this.serviceManager.addSingletonInstance<IEnvironmentActivationService>(IEnvironmentActivationService, instance(mockEnvironmentActivationService));
        this.serviceManager.addSingleton<WindowsStoreInterpreter>(WindowsStoreInterpreter, WindowsStoreInterpreter);
        this.serviceManager.addSingleton<InterpreterHashProvider>(InterpreterHashProvider, InterpreterHashProvider);
        this.serviceManager.addSingleton<InterpeterHashProviderFactory>(InterpeterHashProviderFactory, InterpeterHashProviderFactory);
        this.serviceManager.addSingleton<InterpreterFilter>(InterpreterFilter, InterpreterFilter);
    }
    public registerVariableTypes() {
        variableRegisterTypes(this.serviceManager);
    }
    public registerUnitTestTypes() {
        unittestsRegisterTypes(this.serviceManager);
    }
    public registerLinterTypes() {
        lintersRegisterTypes(this.serviceManager);
    }
    public registerFormatterTypes() {
        formattersRegisterTypes(this.serviceManager);
    }
    public registerPlatformTypes() {
        platformRegisterTypes(this.serviceManager);
    }
    public registerInterpreterTypes() {
        interpretersRegisterTypes(this.serviceManager);
    }
    public registerMockProcessTypes() {
        this.serviceManager.addSingleton<IBufferDecoder>(IBufferDecoder, BufferDecoder);
        const processServiceFactory = TypeMoq.Mock.ofType<IProcessServiceFactory>();
        // tslint:disable-next-line:no-any
        const processService = new MockProcessService(new ProcessService(new BufferDecoder(), process.env as any));
        processServiceFactory.setup(f => f.create(TypeMoq.It.isAny())).returns(() => Promise.resolve(processService));
        this.serviceManager.addSingletonInstance<IProcessServiceFactory>(IProcessServiceFactory, processServiceFactory.object);
        this.serviceManager.addSingleton<IPythonExecutionFactory>(IPythonExecutionFactory, PythonExecutionFactory);
        this.serviceManager.addSingleton<IPythonToolExecutionService>(IPythonToolExecutionService, PythonToolExecutionService);
        this.serviceManager.addSingleton<IEnvironmentActivationService>(IEnvironmentActivationService, EnvironmentActivationService);
        const mockEnvironmentActivationService = mock(EnvironmentActivationService);
        when(mockEnvironmentActivationService.getActivatedEnvironmentVariables(anything())).thenResolve();
        this.serviceManager.rebindInstance<IEnvironmentActivationService>(IEnvironmentActivationService, instance(mockEnvironmentActivationService));
    }

    public registerMockInterpreterTypes() {
        this.serviceManager.addSingleton<IInterpreterService>(IInterpreterService, InterpreterService);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, PythonInterpreterLocatorService, INTERPRETER_LOCATOR_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, CondaEnvFileService, CONDA_ENV_FILE_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, CondaEnvService, CONDA_ENV_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, CurrentPathService, CURRENT_PATH_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, GlobalVirtualEnvService, GLOBAL_VIRTUAL_ENV_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, WorkspaceVirtualEnvService, WORKSPACE_VIRTUAL_ENV_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, PipEnvService, PIPENV_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, WindowsRegistryService, WINDOWS_REGISTRY_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, KnownPathsService, KNOWN_PATH_SERVICE);
        this.serviceManager.addSingleton<IInterpreterLocatorService>(IPipEnvService, PipEnvService);

        this.serviceManager.addSingleton<IInterpreterLocatorHelper>(IInterpreterLocatorHelper, InterpreterLocatorHelper);
        this.serviceManager.addSingleton<IPipEnvServiceHelper>(IPipEnvServiceHelper, PipEnvServiceHelper);
        this.serviceManager.addSingleton<IRegistry>(IRegistry, RegistryImplementation);
    }

    public registerMockProcess() {
        this.serviceManager.addSingletonInstance<boolean>(IsWindows, IS_WINDOWS);

        this.serviceManager.addSingleton<ILogger>(ILogger, Logger);
        this.serviceManager.addSingleton<IPathUtils>(IPathUtils, PathUtils);
        this.serviceManager.addSingleton<ICurrentProcess>(ICurrentProcess, MockProcess);
    }
}
