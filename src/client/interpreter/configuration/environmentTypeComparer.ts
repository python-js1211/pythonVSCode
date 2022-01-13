// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { getArchitectureDisplayName } from '../../common/platform/registry';
import { Resource } from '../../common/types';
import { isParentPath } from '../../pythonEnvironments/common/externalDependencies';
import { EnvironmentType, PythonEnvironment, virtualEnvTypes } from '../../pythonEnvironments/info';
import { PythonVersion } from '../../pythonEnvironments/info/pythonVersion';
import { IInterpreterHelper } from '../contracts';
import { IInterpreterComparer } from './types';

export enum EnvLocationHeuristic {
    /**
     * Environments inside the workspace.
     */
    Local = 1,
    /**
     * Environments outside the workspace.
     */
    Global = 2,
}

@injectable()
export class EnvironmentTypeComparer implements IInterpreterComparer {
    private workspaceFolderPath: string;

    constructor(@inject(IInterpreterHelper) private readonly interpreterHelper: IInterpreterHelper) {
        this.workspaceFolderPath = this.interpreterHelper.getActiveWorkspaceUri(undefined)?.folderUri.fsPath ?? '';
    }

    /**
     * Compare 2 Python environments, sorting them by assumed usefulness.
     * Return 0 if both environments are equal, -1 if a should be closer to the beginning of the list, or 1 if a comes after b.
     *
     * The comparison guidelines are:
     * 1. Local environments first (same path as the workspace root);
     * 2. Global environments next (anything not local), with conda environments at a lower priority, and "base" being last;
     * 3. Globally-installed interpreters (/usr/bin/python3, Windows Store).
     *
     * Always sort with newest version of Python first within each subgroup.
     */
    public compare(a: PythonEnvironment, b: PythonEnvironment): number {
        // Check environment location.
        const envLocationComparison = compareEnvironmentLocation(a, b, this.workspaceFolderPath);
        if (envLocationComparison !== 0) {
            return envLocationComparison;
        }

        // Check environment type.
        const envTypeComparison = compareEnvironmentType(a, b);
        if (envTypeComparison !== 0) {
            return envTypeComparison;
        }

        // Check Python version.
        const versionComparison = comparePythonVersionDescending(a.version, b.version);
        if (versionComparison !== 0) {
            return versionComparison;
        }

        // If we have the "base" Conda env, put it last in its Python version subgroup.
        if (isBaseCondaEnvironment(a)) {
            return 1;
        }

        if (isBaseCondaEnvironment(b)) {
            return -1;
        }

        // Check alphabetical order.
        const nameA = getSortName(a, this.interpreterHelper);
        const nameB = getSortName(b, this.interpreterHelper);
        if (nameA === nameB) {
            return 0;
        }

        return nameA > nameB ? 1 : -1;
    }

    public getRecommended(interpreters: PythonEnvironment[], resource: Resource): PythonEnvironment | undefined {
        // When recommending an intepreter for a workspace, we either want to return a local one
        // or fallback on a globally-installed interpreter, and we don't want want to suggest a global environment
        // because we would have to add a way to match environments to a workspace.
        const workspaceUri = this.interpreterHelper.getActiveWorkspaceUri(resource);
        const filteredInterpreters = interpreters.filter((i) => {
            if (getEnvLocationHeuristic(i, workspaceUri?.folderUri.fsPath || '') === EnvLocationHeuristic.Local) {
                return true;
            }
            if (virtualEnvTypes.includes(i.envType)) {
                // We're not sure if these envs were created for the workspace, so do not recommend them.
                return false;
            }
            return true;
        });
        filteredInterpreters.sort(this.compare.bind(this));
        return filteredInterpreters.length ? filteredInterpreters[0] : undefined;
    }
}

function getSortName(info: PythonEnvironment, interpreterHelper: IInterpreterHelper): string {
    const sortNameParts: string[] = [];
    const envSuffixParts: string[] = [];

    // Sort order for interpreters is:
    // * Version
    // * Architecture
    // * Interpreter Type
    // * Environment name
    if (info.version) {
        sortNameParts.push(info.version.raw);
    }
    if (info.architecture) {
        sortNameParts.push(getArchitectureDisplayName(info.architecture));
    }
    if (info.companyDisplayName && info.companyDisplayName.length > 0) {
        sortNameParts.push(info.companyDisplayName.trim());
    } else {
        sortNameParts.push('Python');
    }

    if (info.envType) {
        const name = interpreterHelper.getInterpreterTypeDisplayName(info.envType);
        if (name) {
            envSuffixParts.push(name);
        }
    }
    if (info.envName && info.envName.length > 0) {
        envSuffixParts.push(info.envName);
    }

    const envSuffix = envSuffixParts.length === 0 ? '' : `(${envSuffixParts.join(': ')})`;
    return `${sortNameParts.join(' ')} ${envSuffix}`.trim();
}

function isBaseCondaEnvironment(environment: PythonEnvironment): boolean {
    return (
        environment.envType === EnvironmentType.Conda &&
        (environment.envName === 'base' || environment.envName === 'miniconda')
    );
}

/**
 * Compare 2 Python versions in decending order, most recent one comes first.
 */
function comparePythonVersionDescending(a: PythonVersion | undefined, b: PythonVersion | undefined): number {
    if (!a) {
        return 1;
    }

    if (!b) {
        return -1;
    }

    if (a.raw === b.raw) {
        return 0;
    }

    if (a.major === b.major) {
        if (a.minor === b.minor) {
            if (a.patch === b.patch) {
                return a.build.join(' ') > b.build.join(' ') ? -1 : 1;
            }
            return a.patch > b.patch ? -1 : 1;
        }
        return a.minor > b.minor ? -1 : 1;
    }

    return a.major > b.major ? -1 : 1;
}

/**
 * Compare 2 environment locations: return 0 if they are the same, -1 if a comes before b, 1 otherwise.
 */
function compareEnvironmentLocation(a: PythonEnvironment, b: PythonEnvironment, workspacePath: string): number {
    const aHeuristic = getEnvLocationHeuristic(a, workspacePath);
    const bHeuristic = getEnvLocationHeuristic(b, workspacePath);

    return Math.sign(aHeuristic - bHeuristic);
}

/**
 * Return a heuristic value depending on the environment type.
 */
export function getEnvLocationHeuristic(environment: PythonEnvironment, workspacePath: string): EnvLocationHeuristic {
    if (
        workspacePath.length > 0 &&
        ((environment.envPath && isParentPath(environment.envPath, workspacePath)) ||
            (environment.path && isParentPath(environment.path, workspacePath)))
    ) {
        return EnvLocationHeuristic.Local;
    }
    return EnvLocationHeuristic.Global;
}

/**
 * Compare 2 environment types: return 0 if they are the same, -1 if a comes before b, 1 otherwise.
 */
function compareEnvironmentType(a: PythonEnvironment, b: PythonEnvironment): number {
    const envTypeByPriority = getPrioritizedEnvironmentType();
    return Math.sign(envTypeByPriority.indexOf(a.envType) - envTypeByPriority.indexOf(b.envType));
}

function getPrioritizedEnvironmentType(): EnvironmentType[] {
    return [
        // Prioritize non-Conda environments.
        EnvironmentType.Poetry,
        EnvironmentType.Pipenv,
        EnvironmentType.VirtualEnvWrapper,
        EnvironmentType.Venv,
        EnvironmentType.VirtualEnv,
        EnvironmentType.Conda,
        EnvironmentType.Pyenv,
        EnvironmentType.WindowsStore,
        EnvironmentType.Global,
        EnvironmentType.System,
        EnvironmentType.Unknown,
    ];
}
