import { inject, injectable } from 'inversify';
import * as md5 from 'md5';
import * as path from 'path';
import { Disposable, Event, EventEmitter, Uri } from 'vscode';
import '../../client/common/extensions';
import { IDocumentManager, IWorkspaceService } from '../common/application/types';
import { getArchitectureDisplayName } from '../common/platform/registry';
import { IFileSystem } from '../common/platform/types';
import { IPythonExecutionFactory } from '../common/process/types';
import { IConfigurationService, IDisposableRegistry, IPersistentState, IPersistentStateFactory } from '../common/types';
import { sleep } from '../common/utils/async';
import { IServiceContainer } from '../ioc/types';
import { captureTelemetry } from '../telemetry';
import { EventName } from '../telemetry/constants';
import {
    IInterpreterDisplay, IInterpreterHelper, IInterpreterLocatorService,
    IInterpreterService, INTERPRETER_LOCATOR_SERVICE,
    InterpreterType, PythonInterpreter} from './contracts';
import { IVirtualEnvironmentManager } from './virtualEnvs/types';

const EXPITY_DURATION = 24 * 60 * 60 * 1000;

@injectable()
export class InterpreterService implements Disposable, IInterpreterService {
    private readonly locator: IInterpreterLocatorService;
    private readonly fs: IFileSystem;
    private readonly persistentStateFactory: IPersistentStateFactory;
    private readonly configService: IConfigurationService;
    private readonly didChangeInterpreterEmitter = new EventEmitter<void>();
    private readonly didChangeInterpreterInformation = new EventEmitter<PythonInterpreter>();
    private pythonPathSetting: string = '';

    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer) {
        this.locator = serviceContainer.get<IInterpreterLocatorService>(IInterpreterLocatorService, INTERPRETER_LOCATOR_SERVICE);
        this.fs = this.serviceContainer.get<IFileSystem>(IFileSystem);
        this.persistentStateFactory = this.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
        this.configService = this.serviceContainer.get<IConfigurationService>(IConfigurationService);
    }
    public get hasInterpreters(): Promise<boolean> {
        return this.locator.hasInterpreters;
    }

    public async refresh(resource?: Uri) {
        const interpreterDisplay = this.serviceContainer.get<IInterpreterDisplay>(IInterpreterDisplay);
        return interpreterDisplay.refresh(resource);
    }

    public initialize() {
        const disposables = this.serviceContainer.get<Disposable[]>(IDisposableRegistry);
        const documentManager = this.serviceContainer.get<IDocumentManager>(IDocumentManager);
        disposables.push(documentManager.onDidChangeActiveTextEditor((e) => e ? this.refresh(e.document.uri) : undefined));
        const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        const pySettings = this.configService.getSettings();
        this.pythonPathSetting = pySettings.pythonPath;
        const disposable = workspaceService.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('python.pythonPath', undefined)) {
                this.onConfigChanged();
            }
        });
        disposables.push(disposable);
    }

    @captureTelemetry(EventName.PYTHON_INTERPRETER_DISCOVERY, { locator: 'all' }, true)
    public async getInterpreters(resource?: Uri): Promise<PythonInterpreter[]> {
        const interpreters = await this.locator.getInterpreters(resource);
        await Promise.all(interpreters
            .filter(item => !item.displayName)
            .map(async item => {
                item.displayName = await this.getDisplayName(item, resource);
                // Always keep information up to date with latest details.
                if (!item.cachedEntry) {
                    this.updateCachedInterpreterInformation(item).ignoreErrors();
                }
            }));
        return interpreters;
    }

    public dispose(): void {
        this.locator.dispose();
        this.didChangeInterpreterEmitter.dispose();
        this.didChangeInterpreterInformation.dispose();
    }

    public get onDidChangeInterpreter(): Event<void> {
        return this.didChangeInterpreterEmitter.event;
    }

    public get onDidChangeInterpreterInformation(): Event<PythonInterpreter> {
        return this.didChangeInterpreterInformation.event;
    }

    public async getActiveInterpreter(resource?: Uri): Promise<PythonInterpreter | undefined> {
        const pythonExecutionFactory = this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
        const pythonExecutionService = await pythonExecutionFactory.create({ resource });
        const fullyQualifiedPath = await pythonExecutionService.getExecutablePath().catch(() => undefined);
        // Python path is invalid or python isn't installed.
        if (!fullyQualifiedPath) {
            return;
        }

        return this.getInterpreterDetails(fullyQualifiedPath, resource);
    }
    public async getInterpreterDetails(pythonPath: string, resource?: Uri): Promise<PythonInterpreter | undefined> {
        // If we don't have the fully qualified path, then get it.
        if (path.basename(pythonPath) === pythonPath) {
            const pythonExecutionFactory = this.serviceContainer.get<IPythonExecutionFactory>(IPythonExecutionFactory);
            const pythonExecutionService = await pythonExecutionFactory.create({ resource });
            pythonPath = await pythonExecutionService.getExecutablePath().catch(() => '');
            // Python path is invalid or python isn't installed.
            if (!pythonPath) {
                return;
            }
        }

        const store = await this.getInterpreterCache(pythonPath);
        if (store.value && store.value.info) {
            return store.value.info;
        }

        const fs = this.serviceContainer.get<IFileSystem>(IFileSystem);

        // Don't want for all interpreters are collected.
        // Try to collect the infromation manually, that's faster.
        // Get from which ever comes first.
        const option1 = (async () => {
            const result = this.collectInterpreterDetails(pythonPath, resource);
            await sleep(1000); // let the other option complete within 1s if possible.
            return result;
        })();

        // This is the preferred approach, hence the delay in option 1.
        const option2 = (async () => {
            const interpreters = await this.getInterpreters(resource);
            const found = interpreters.find(i => fs.arePathsSame(i.path, pythonPath));
            if (found) {
                // Cache the interpreter info, only if we get the data from interpretr list.
                // tslint:disable-next-line:no-any
                (found as any).__store = true;
                return found;
            }
            // Use option1 as a fallback.
            // tslint:disable-next-line:no-any
            return option1 as any as PythonInterpreter;
        })();

        const interpreterInfo = await Promise.race([option2, option1]) as PythonInterpreter;

        // tslint:disable-next-line:no-any
        if (interpreterInfo && (interpreterInfo as any).__store) {
            await this.updateCachedInterpreterInformation(interpreterInfo);
        } else {
            // If we got information from option1, then when option2 finishes cache it for later use (ignoring erors);
            option2.then(async info => {
                // tslint:disable-next-line:no-any
                if (info && (info as any).__store) {
                    await this.updateCachedInterpreterInformation(info);
                }
            }).ignoreErrors();
        }
        return interpreterInfo;
    }
    /**
     * Gets the display name of an interpreter.
     * The format is `Python <Version> <bitness> (<env name>: <env type>)`
     * E.g. `Python 3.5.1 32-bit (myenv2: virtualenv)`
     * @param {Partial<PythonInterpreter>} info
     * @returns {string}
     * @memberof InterpreterService
     */
    public async getDisplayName(info: Partial<PythonInterpreter>, resource?: Uri): Promise<string> {
        const fileHash = (info.path ? await this.fs.getFileHash(info.path).catch(() => '') : '') || '';
        const interpreterHash = `${fileHash}-${md5(JSON.stringify(info))}`;
        const store = this.persistentStateFactory.createGlobalPersistentState<{ hash: string; displayName: string }>(`${info.path}${interpreterHash}.interpreter.displayName.v5`, undefined, EXPITY_DURATION);
        if (store.value && store.value.hash === interpreterHash && store.value.displayName) {
            return store.value.displayName;
        }
        const displayNameParts: string[] = ['Python'];
        const envSuffixParts: string[] = [];

        if (info.version) {
            displayNameParts.push(`${info.version.major}.${info.version.minor}.${info.version.patch}`);
        }
        if (info.architecture) {
            displayNameParts.push(getArchitectureDisplayName(info.architecture));
        }
        if (!info.envName && info.path && info.type && info.type === InterpreterType.Pipenv) {
            // If we do not have the name of the environment, then try to get it again.
            // This can happen based on the context (i.e. resource).
            // I.e. we can determine if an environment is PipEnv only when giving it the right workspacec path (i.e. resource).
            const virtualEnvMgr = this.serviceContainer.get<IVirtualEnvironmentManager>(IVirtualEnvironmentManager);
            info.envName = await virtualEnvMgr.getEnvironmentName(info.path, resource);
        }
        if (info.envName && info.envName.length > 0) {
            envSuffixParts.push(`'${info.envName}'`);
        }
        if (info.type) {
            const interpreterHelper = this.serviceContainer.get<IInterpreterHelper>(IInterpreterHelper);
            const name = interpreterHelper.getInterpreterTypeDisplayName(info.type);
            if (name) {
                envSuffixParts.push(name);
            }
        }

        const envSuffix = envSuffixParts.length === 0 ? '' :
            `(${envSuffixParts.join(': ')})`;
        const displayName = `${displayNameParts.join(' ')} ${envSuffix}`.trim();

        // If dealing with cached entry, then do not store the display name in cache.
        if (!info.cachedEntry) {
            await store.updateValue({ displayName, hash: interpreterHash });
        }

        return displayName;
    }
    protected async getInterpreterCache(pythonPath: string): Promise<IPersistentState<{ fileHash: string; info?: PythonInterpreter }>> {
        const fileHash = (pythonPath ? await this.fs.getFileHash(pythonPath).catch(() => '') : '') || '';
        const store = this.persistentStateFactory.createGlobalPersistentState<{ fileHash: string; info?: PythonInterpreter }>(`${pythonPath}.interpreter.Details.v6`, undefined, EXPITY_DURATION);
        if (!store.value || store.value.fileHash !== fileHash) {
            await store.updateValue({ fileHash });
        }
        return store;
    }
    protected async updateCachedInterpreterInformation(info: PythonInterpreter): Promise<void>{
        this.didChangeInterpreterInformation.fire(info);
        const state = await this.getInterpreterCache(info.path);
        await state.updateValue({ fileHash: state.value.fileHash, info });
    }
    private onConfigChanged = () => {
        // Check if we actually changed our python path
        const pySettings = this.configService.getSettings();
        if (this.pythonPathSetting !== pySettings.pythonPath) {
            this.pythonPathSetting = pySettings.pythonPath;
            this.didChangeInterpreterEmitter.fire();
            const interpreterDisplay = this.serviceContainer.get<IInterpreterDisplay>(IInterpreterDisplay);
            interpreterDisplay.refresh()
                .catch(ex => console.error('Python Extension: display.refresh', ex));
        }
    }
    private async collectInterpreterDetails(pythonPath: string, resource: Uri | undefined) {
        const interpreterHelper = this.serviceContainer.get<IInterpreterHelper>(IInterpreterHelper);
        const virtualEnvManager = this.serviceContainer.get<IVirtualEnvironmentManager>(IVirtualEnvironmentManager);
        const [info, type] = await Promise.all([
            interpreterHelper.getInterpreterInformation(pythonPath),
            virtualEnvManager.getEnvironmentType(pythonPath)
        ]);
        if (!info) {
            return;
        }
        const details: Partial<PythonInterpreter> = {
            ...(info as PythonInterpreter),
            path: pythonPath,
            type: type
        };

        const envName = type === InterpreterType.Unknown ? undefined : await virtualEnvManager.getEnvironmentName(pythonPath, resource);
        const pthonInfo = {
            ...(details as PythonInterpreter),
            envName
        };
        pthonInfo.displayName = await this.getDisplayName(pthonInfo, resource);
        return pthonInfo;
    }
}
