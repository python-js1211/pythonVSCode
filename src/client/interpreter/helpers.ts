import { inject, injectable } from 'inversify';
import { ConfigurationTarget, Uri } from 'vscode';
import { IDocumentManager, IWorkspaceService } from '../common/application/types';
import { traceError } from '../common/logger';
import { FileSystemPaths } from '../common/platform/fs-paths';
import { IPythonExecutionFactory } from '../common/process/types';
import { IPersistentStateFactory, Resource } from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { isMacDefaultPythonPath } from '../pythonEnvironments/discovery';
import { InterpeterHashProviderFactory } from '../pythonEnvironments/discovery/locators/services/hashProviderFactory';
import {
    EnvironmentType,
    getEnvironmentTypeName,
    InterpreterInformation,
    PythonEnvironment,
    sortInterpreters
} from '../pythonEnvironments/info';
import { IComponentAdapter, IInterpreterHelper } from './contracts';
import { IInterpreterHashProviderFactory } from './locators/types';

const EXPITY_DURATION = 24 * 60 * 60 * 1000;
type CachedPythonInterpreter = Partial<PythonEnvironment> & { fileHash: string };

export type WorkspacePythonPath = {
    folderUri: Uri;
    configTarget: ConfigurationTarget.Workspace | ConfigurationTarget.WorkspaceFolder;
};

export function getFirstNonEmptyLineFromMultilineString(stdout: string) {
    if (!stdout) {
        return '';
    }
    const lines = stdout
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    return lines.length > 0 ? lines[0] : '';
}

export function isInterpreterLocatedInWorkspace(interpreter: PythonEnvironment, activeWorkspaceUri: Uri) {
    const fileSystemPaths = FileSystemPaths.withDefaults();
    const interpreterPath = fileSystemPaths.normCase(interpreter.path);
    const resourcePath = fileSystemPaths.normCase(activeWorkspaceUri.fsPath);
    return interpreterPath.startsWith(resourcePath);
}

// The parts of IComponentAdapter used here.
interface IComponent {
    getInterpreterInformation(pythonPath: string): Promise<undefined | Partial<PythonEnvironment>>;
    isMacDefaultPythonPath(pythonPath: string): Promise<boolean | undefined>;
}

@injectable()
export class InterpreterHelper implements IInterpreterHelper {
    private readonly persistentFactory: IPersistentStateFactory;
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(InterpeterHashProviderFactory) private readonly hashProviderFactory: IInterpreterHashProviderFactory,
        @inject(IComponentAdapter) private readonly pyenvs: IComponent
    ) {
        this.persistentFactory = this.serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
    }
    public getActiveWorkspaceUri(resource: Resource): WorkspacePythonPath | undefined {
        const workspaceService = this.serviceContainer.get<IWorkspaceService>(IWorkspaceService);
        if (!workspaceService.hasWorkspaceFolders) {
            return;
        }
        if (Array.isArray(workspaceService.workspaceFolders) && workspaceService.workspaceFolders.length === 1) {
            return { folderUri: workspaceService.workspaceFolders[0].uri, configTarget: ConfigurationTarget.Workspace };
        }

        if (resource) {
            const workspaceFolder = workspaceService.getWorkspaceFolder(resource);
            if (workspaceFolder) {
                return { configTarget: ConfigurationTarget.WorkspaceFolder, folderUri: workspaceFolder.uri };
            }
        }
        const documentManager = this.serviceContainer.get<IDocumentManager>(IDocumentManager);

        if (documentManager.activeTextEditor) {
            const workspaceFolder = workspaceService.getWorkspaceFolder(documentManager.activeTextEditor.document.uri);
            if (workspaceFolder) {
                return { configTarget: ConfigurationTarget.WorkspaceFolder, folderUri: workspaceFolder.uri };
            }
        }
    }
    public async getInterpreterInformation(pythonPath: string): Promise<undefined | Partial<PythonEnvironment>> {
        const found = await this.pyenvs.getInterpreterInformation(pythonPath);
        if (found !== undefined) {
            return found;
        }

        const fileHash = await this.hashProviderFactory
            .create({ pythonPath })
            .then((provider) => provider.getInterpreterHash(pythonPath))
            .catch((ex) => {
                traceError(`Failed to create File hash for interpreter ${pythonPath}`, ex);
                return '';
            });
        const store = this.persistentFactory.createGlobalPersistentState<CachedPythonInterpreter>(
            `${pythonPath}.v3`,
            undefined,
            EXPITY_DURATION
        );
        if (store.value && fileHash && store.value.fileHash === fileHash) {
            return store.value;
        }
        const processService = await this.serviceContainer
            .get<IPythonExecutionFactory>(IPythonExecutionFactory)
            .create({ pythonPath });

        try {
            const info = await processService
                .getInterpreterInformation()
                .catch<InterpreterInformation | undefined>(() => undefined);
            if (!info) {
                return;
            }
            const details = {
                ...info,
                fileHash
            };
            await store.updateValue(details);
            return details;
        } catch (ex) {
            traceError(`Failed to get interpreter information for '${pythonPath}'`, ex);
            return;
        }
    }
    public async isMacDefaultPythonPath(pythonPath: string): Promise<boolean> {
        const result = await this.pyenvs.isMacDefaultPythonPath(pythonPath);
        if (result !== undefined) {
            return result;
        }
        return isMacDefaultPythonPath(pythonPath);
    }
    public getInterpreterTypeDisplayName(interpreterType: EnvironmentType) {
        return getEnvironmentTypeName(interpreterType);
    }
    public getBestInterpreter(interpreters?: PythonEnvironment[]): PythonEnvironment | undefined {
        if (!Array.isArray(interpreters) || interpreters.length === 0) {
            return;
        }
        const sorted = sortInterpreters(interpreters);
        return sorted[sorted.length - 1];
    }
}
