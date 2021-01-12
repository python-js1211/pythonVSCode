// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable } from 'inversify';
import * as vscode from 'vscode';
import { IExtensionSingleActivationService } from '../activation/types';
import { DiscoveryVariants } from '../common/experiments/groups';
import { FileChangeType } from '../common/platform/fileSystemWatcher';
import { IDisposableRegistry, Resource } from '../common/types';
import { getVersionString, parseVersion } from '../common/utils/version';
import {
    CONDA_ENV_FILE_SERVICE,
    CONDA_ENV_SERVICE,
    CURRENT_PATH_SERVICE,
    GetInterpreterOptions,
    GLOBAL_VIRTUAL_ENV_SERVICE,
    IComponentAdapter,
    ICondaService,
    IInterpreterLocatorHelper,
    IInterpreterLocatorProgressService,
    IInterpreterLocatorService,
    IInterpreterWatcher,
    IInterpreterWatcherBuilder,
    IKnownSearchPathsForInterpreters,
    INTERPRETER_LOCATOR_SERVICE,
    IVirtualEnvironmentsSearchPathProvider,
    KNOWN_PATH_SERVICE,
    PIPENV_SERVICE,
    WINDOWS_REGISTRY_SERVICE,
    WORKSPACE_VIRTUAL_ENV_SERVICE,
} from '../interpreter/contracts';
import { IPipEnvServiceHelper, IPythonInPathCommandProvider } from '../interpreter/locators/types';
import { IServiceManager } from '../ioc/types';
import { PythonEnvInfo, PythonEnvKind, PythonReleaseLevel } from './base/info';
import { buildEnvInfo } from './base/info/env';
import { ILocator, PythonLocatorQuery } from './base/locator';
import { isMacDefaultPythonPath } from './base/locators/lowLevel/macDefaultLocator';
import { getEnvs } from './base/locatorUtils';
import { getEnvironmentDirFromPath } from './common/commonUtils';
import { inExperiment, isParentPath } from './common/externalDependencies';
import { PythonInterpreterLocatorService } from './discovery/locators';
import { InterpreterLocatorHelper } from './discovery/locators/helpers';
import { InterpreterLocatorProgressService } from './discovery/locators/progressService';
import { CondaEnvironmentInfo } from './discovery/locators/services/conda';
import { CondaEnvFileService } from './discovery/locators/services/condaEnvFileService';
import { CondaEnvService } from './discovery/locators/services/condaEnvService';
import { isCondaEnvironment } from './discovery/locators/services/condaLocator';
import { CondaService } from './discovery/locators/services/condaService';
import { CurrentPathService, PythonInPathCommandProvider } from './discovery/locators/services/currentPathService';
import {
    GlobalVirtualEnvironmentsSearchPathProvider,
    GlobalVirtualEnvService,
} from './discovery/locators/services/globalVirtualEnvService';
import { InterpreterHashProvider } from './discovery/locators/services/hashProvider';
import { InterpeterHashProviderFactory } from './discovery/locators/services/hashProviderFactory';
import { InterpreterWatcherBuilder } from './discovery/locators/services/interpreterWatcherBuilder';
import { KnownPathsService, KnownSearchPathsForInterpreters } from './discovery/locators/services/KnownPathsService';
import { PipEnvService } from './discovery/locators/services/pipEnvService';
import { PipEnvServiceHelper } from './discovery/locators/services/pipEnvServiceHelper';
import { WindowsRegistryService } from './discovery/locators/services/windowsRegistryService';
import { WindowsStoreInterpreter } from './discovery/locators/services/windowsStoreInterpreter';
import { isWindowsStoreEnvironment } from './discovery/locators/services/windowsStoreLocator';
import {
    WorkspaceVirtualEnvironmentsSearchPathProvider,
    WorkspaceVirtualEnvService,
} from './discovery/locators/services/workspaceVirtualEnvService';
import { WorkspaceVirtualEnvWatcherService } from './discovery/locators/services/workspaceVirtualEnvWatcherService';
import { EnvironmentType, PythonEnvironment } from './info';
import { EnvironmentsSecurity, IEnvironmentsSecurity } from './security';

const convertedKinds = new Map(
    Object.entries({
        [PythonEnvKind.System]: EnvironmentType.System,
        [PythonEnvKind.MacDefault]: EnvironmentType.System,
        [PythonEnvKind.WindowsStore]: EnvironmentType.WindowsStore,
        [PythonEnvKind.Pyenv]: EnvironmentType.Pyenv,
        [PythonEnvKind.Conda]: EnvironmentType.Conda,
        [PythonEnvKind.CondaBase]: EnvironmentType.Conda,
        [PythonEnvKind.VirtualEnv]: EnvironmentType.VirtualEnv,
        [PythonEnvKind.Pipenv]: EnvironmentType.Pipenv,
        [PythonEnvKind.Venv]: EnvironmentType.Venv,
        [PythonEnvKind.VirtualEnvWrapper]: EnvironmentType.VirtualEnvWrapper,
    }),
);

function convertEnvInfo(info: PythonEnvInfo): PythonEnvironment {
    const { name, location, executable, arch, kind, searchLocation, version, distro } = info;
    const { filename, sysPrefix } = executable;
    const env: PythonEnvironment = {
        sysPrefix,
        envType: EnvironmentType.Unknown,
        envName: name,
        envPath: location,
        path: filename,
        architecture: arch,
    };

    const envType = convertedKinds.get(kind);
    if (envType !== undefined) {
        env.envType = envType;
    }
    // Otherwise it stays Unknown.

    if (searchLocation !== undefined) {
        if (kind === PythonEnvKind.Pipenv) {
            env.pipEnvWorkspaceFolder = searchLocation.fsPath;
        }
    }

    if (version !== undefined) {
        const { release, sysVersion } = version;
        if (release === undefined) {
            const versionStr = `${getVersionString(version)}-final`;
            env.version = parseVersion(versionStr);
            env.sysVersion = '';
        } else {
            const { level, serial } = release;
            const releaseStr = level === PythonReleaseLevel.Final ? 'final' : `${level}${serial}`;
            const versionStr = `${getVersionString(version)}-${releaseStr}`;
            env.version = parseVersion(versionStr);
            env.sysVersion = sysVersion;
        }
    }

    if (distro !== undefined && distro.org !== '') {
        env.companyDisplayName = distro.org;
    }
    // We do not worry about using distro.defaultDisplayName
    // or info.defaultDisplayName.

    return env;
}

export interface IPythonEnvironments extends ILocator {}

@injectable()
class ComponentAdapter implements IComponentAdapter, IExtensionSingleActivationService {
    // this will be set based on experiment
    private enabled?: boolean;

    private readonly refreshing = new vscode.EventEmitter<void>();

    private readonly refreshed = new vscode.EventEmitter<void>();

    constructor(
        // The adapter only wraps one thing: the component API.
        private readonly api: IPythonEnvironments,
        private readonly environmentsSecurity: IEnvironmentsSecurity,
        private readonly disposables: IDisposableRegistry,
    ) {}

    public async activate(): Promise<void> {
        this.enabled = (
            await Promise.all([
                inExperiment(DiscoveryVariants.discoverWithFileWatching),
                inExperiment(DiscoveryVariants.discoveryWithoutFileWatching),
            ])
        ).includes(true);
        this.disposables.push(
            this.api.onChanged((e) => {
                const query = {
                    kinds: e.kind ? [e.kind] : undefined,
                    searchLocations: e.searchLocation ? { roots: [e.searchLocation] } : undefined,
                };
                // Trigger a background refresh of the environments.
                getEnvs(this.api.iterEnvs(query)).ignoreErrors();
            }),
        );
    }

    // For use in VirtualEnvironmentPrompt.activate()

    // Call callback if an environment gets created within the resource provided.
    public onDidCreate(resource: Resource, callback: () => void): vscode.Disposable | undefined {
        if (!this.enabled) {
            return undefined;
        }
        const workspaceFolder = resource ? vscode.workspace.getWorkspaceFolder(resource) : undefined;
        return this.api.onChanged((e) => {
            if (!workspaceFolder || !e.searchLocation) {
                return;
            }
            if (
                e.type === FileChangeType.Created &&
                isParentPath(e.searchLocation.fsPath, workspaceFolder.uri.fsPath)
            ) {
                callback();
            }
        });
    }

    // Implements IInterpreterLocatorProgressHandler

    // A result of `undefined` means "Fall back to the old code!"
    public get onRefreshing(): vscode.Event<void> | undefined {
        return this.enabled ? this.refreshing.event : undefined;
    }

    public get onRefreshed(): vscode.Event<void> | undefined {
        return this.enabled ? this.refreshed.event : undefined;
    }

    // Implements IInterpreterHelper

    // A result of `undefined` means "Fall back to the old code!"
    public async getInterpreterInformation(pythonPath: string): Promise<undefined | Partial<PythonEnvironment>> {
        if (!this.enabled) {
            return undefined;
        }
        const env = await this.api.resolveEnv(pythonPath);
        if (env === undefined) {
            return undefined;
        }
        return convertEnvInfo(env);
    }

    // A result of `undefined` means "Fall back to the old code!"
    public async isMacDefaultPythonPath(pythonPath: string): Promise<boolean | undefined> {
        if (!this.enabled) {
            return undefined;
        }
        // While `ComponentAdapter` represents how the component would be used in the rest of the
        // extension, we cheat here for the sake of performance.  This is not a problem because when
        // we start using the component's public API directly we will be dealing with `PythonEnvInfo`
        // instead of just `pythonPath`.
        return isMacDefaultPythonPath(pythonPath);
    }

    // Implements IInterpreterService

    // We use the same getInterpreters() here as for IInterpreterLocatorService.

    // A result of `undefined` means "Fall back to the old code!"
    public async getInterpreterDetails(
        pythonPath: string,
        resource?: vscode.Uri,
    ): Promise<undefined | PythonEnvironment> {
        if (!this.enabled) {
            return undefined;
        }
        const info = buildEnvInfo({ executable: pythonPath });
        if (resource !== undefined) {
            const wsFolder = vscode.workspace.getWorkspaceFolder(resource);
            if (wsFolder !== undefined) {
                info.searchLocation = wsFolder.uri;
            }
        }
        const env = await this.api.resolveEnv(info);
        if (env === undefined) {
            return undefined;
        }
        return convertEnvInfo(env);
    }

    // Implements ICondaService

    // A result of `undefined` means "Fall back to the old code!"
    public async isCondaEnvironment(interpreterPath: string): Promise<boolean | undefined> {
        if (!this.enabled) {
            return undefined;
        }
        // While `ComponentAdapter` represents how the component would be used in the rest of the
        // extension, we cheat here for the sake of performance.  This is not a problem because when
        // we start using the component's public API directly we will be dealing with `PythonEnvInfo`
        // instead of just `pythonPath`.
        return isCondaEnvironment(interpreterPath);
    }

    // A result of `undefined` means "Fall back to the old code!"
    public async getCondaEnvironment(interpreterPath: string): Promise<CondaEnvironmentInfo | undefined> {
        if (!this.enabled) {
            return undefined;
        }
        if (!(await isCondaEnvironment(interpreterPath))) {
            return undefined;
        }
        // For Conda we assume we don't set name for environments if they're prefix conda environments, similarly
        // we don't have 'path' set if they're non-prefix conda environments.
        // So we don't have a helper function yet to give us a conda env's name (if it has one). So for
        // now we always set `path` (and never `name`).  Once we have such a helper we will use it.

        // TODO: Expose these two properties via a helper in the Conda locator on a temporary basis.
        const location = getEnvironmentDirFromPath(interpreterPath);
        // else
        return { name: '', path: location };
    }

    // Implements IWindowsStoreInterpreter

    // A result of `undefined` means "Fall back to the old code!"
    public async isWindowsStoreInterpreter(pythonPath: string): Promise<boolean | undefined> {
        if (!this.enabled) {
            return undefined;
        }
        // Eventually we won't be calling 'isWindowsStoreInterpreter' in the component adapter, so we won't
        // need to use 'isWindowsStoreEnvironment' directly here. This is just a temporary implementation.
        return isWindowsStoreEnvironment(pythonPath);
    }

    // Implements IInterpreterLocatorService

    // A result of `undefined` means "Fall back to the old code!"
    public get hasInterpreters(): Promise<boolean | undefined> {
        if (!this.enabled) {
            return Promise.resolve(undefined);
        }
        const iterator = this.api.iterEnvs();
        return iterator.next().then((res) => !res.done);
    }

    // A result of `undefined` means "Fall back to the old code!"
    public async getInterpreters(
        resource?: vscode.Uri,
        options?: GetInterpreterOptions,
        // Currently we have no plans to support GetInterpreterLocatorOptions:
        // {
        //     ignoreCache?: boolean
        //     onSuggestion?: boolean;
        // }
    ): Promise<PythonEnvironment[] | undefined> {
        if (!this.enabled) {
            return undefined;
        }
        this.refreshing.fire(); // Notify locators are locating.
        if (options?.onSuggestion) {
            // For now, until we have the concept of trusted workspaces, we assume all interpreters as safe
            // to run once user has triggered discovery, i.e interacted with the extension.
            this.environmentsSecurity.markAllEnvsAsSafe();
        }
        const query: PythonLocatorQuery = {};
        if (resource !== undefined) {
            const wsFolder = vscode.workspace.getWorkspaceFolder(resource);
            if (wsFolder !== undefined) {
                query.searchLocations = {
                    roots: [wsFolder.uri],
                    includeNonRooted: true,
                };
            }
        }

        const iterator = this.api.iterEnvs(query);
        const envs = await getEnvs(iterator);
        const legacyEnvs = envs.map(convertEnvInfo);
        this.refreshed.fire(); // Notify all locators have completed locating.
        return legacyEnvs;
    }
}

export function registerLegacyDiscoveryForIOC(serviceManager: IServiceManager): void {
    serviceManager.addSingleton<IInterpreterLocatorHelper>(IInterpreterLocatorHelper, InterpreterLocatorHelper);
    serviceManager.addSingleton<IInterpreterLocatorService>(
        IInterpreterLocatorService,
        PythonInterpreterLocatorService,
        INTERPRETER_LOCATOR_SERVICE,
    );
    serviceManager.addSingleton<IInterpreterLocatorProgressService>(
        IInterpreterLocatorProgressService,
        InterpreterLocatorProgressService,
    );
    serviceManager.addSingleton<IInterpreterLocatorService>(
        IInterpreterLocatorService,
        CondaEnvFileService,
        CONDA_ENV_FILE_SERVICE,
    );
    serviceManager.addSingleton<IInterpreterLocatorService>(
        IInterpreterLocatorService,
        CondaEnvService,
        CONDA_ENV_SERVICE,
    );
    serviceManager.addSingleton<IInterpreterLocatorService>(
        IInterpreterLocatorService,
        CurrentPathService,
        CURRENT_PATH_SERVICE,
    );
    serviceManager.addSingleton<IInterpreterLocatorService>(
        IInterpreterLocatorService,
        GlobalVirtualEnvService,
        GLOBAL_VIRTUAL_ENV_SERVICE,
    );
    serviceManager.addSingleton<IInterpreterLocatorService>(
        IInterpreterLocatorService,
        WorkspaceVirtualEnvService,
        WORKSPACE_VIRTUAL_ENV_SERVICE,
    );
    serviceManager.addSingleton<IInterpreterLocatorService>(IInterpreterLocatorService, PipEnvService, PIPENV_SERVICE);

    serviceManager.addSingleton<IInterpreterLocatorService>(
        IInterpreterLocatorService,
        WindowsRegistryService,
        WINDOWS_REGISTRY_SERVICE,
    );
    serviceManager.addSingleton<IInterpreterLocatorService>(
        IInterpreterLocatorService,
        KnownPathsService,
        KNOWN_PATH_SERVICE,
    );
    serviceManager.addSingleton<ICondaService>(ICondaService, CondaService);
    serviceManager.addSingleton<IPipEnvServiceHelper>(IPipEnvServiceHelper, PipEnvServiceHelper);
    serviceManager.addSingleton<IPythonInPathCommandProvider>(
        IPythonInPathCommandProvider,
        PythonInPathCommandProvider,
    );

    serviceManager.add<IInterpreterWatcher>(
        IInterpreterWatcher,
        WorkspaceVirtualEnvWatcherService,
        WORKSPACE_VIRTUAL_ENV_SERVICE,
    );
    serviceManager.addSingleton<WindowsStoreInterpreter>(WindowsStoreInterpreter, WindowsStoreInterpreter);
    serviceManager.addSingleton<InterpreterHashProvider>(InterpreterHashProvider, InterpreterHashProvider);
    serviceManager.addSingleton<InterpeterHashProviderFactory>(
        InterpeterHashProviderFactory,
        InterpeterHashProviderFactory,
    );
    serviceManager.addSingleton<IVirtualEnvironmentsSearchPathProvider>(
        IVirtualEnvironmentsSearchPathProvider,
        GlobalVirtualEnvironmentsSearchPathProvider,
        'global',
    );
    serviceManager.addSingleton<IVirtualEnvironmentsSearchPathProvider>(
        IVirtualEnvironmentsSearchPathProvider,
        WorkspaceVirtualEnvironmentsSearchPathProvider,
        'workspace',
    );
    serviceManager.addSingleton<IKnownSearchPathsForInterpreters>(
        IKnownSearchPathsForInterpreters,
        KnownSearchPathsForInterpreters,
    );
    serviceManager.addSingleton<IInterpreterWatcherBuilder>(IInterpreterWatcherBuilder, InterpreterWatcherBuilder);
}

export function registerNewDiscoveryForIOC(
    serviceManager: IServiceManager,
    api: IPythonEnvironments,
    environmentsSecurity: EnvironmentsSecurity,
    disposables: IDisposableRegistry,
): void {
    serviceManager.addSingletonInstance<IComponentAdapter>(
        IComponentAdapter,
        new ComponentAdapter(api, environmentsSecurity, disposables),
    );
    serviceManager.addBinding(IComponentAdapter, IExtensionSingleActivationService);
}
