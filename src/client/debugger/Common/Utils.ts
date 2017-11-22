'use strict';

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as untildify from 'untildify';
import { mergeEnvVariables, mergePythonPath, parseEnvFile } from '../../common/envFileParser';
import { IPythonEvaluationResult, IPythonModule, IPythonProcess, IPythonThread } from './Contracts';

export const IS_WINDOWS = /^win/.test(process.platform);
export const PATH_VARIABLE_NAME = IS_WINDOWS ? 'Path' : 'PATH';

const PathValidity: Map<string, boolean> = new Map<string, boolean>();
export function validatePath(filePath: string): Promise<string> {
    if (filePath.length === 0) {
        return Promise.resolve('');
    }
    if (PathValidity.has(filePath)) {
        return Promise.resolve(PathValidity.get(filePath) ? filePath : '');
    }
    return new Promise<string>(resolve => {
        fs.exists(filePath, exists => {
            PathValidity.set(filePath, exists);
            return resolve(exists ? filePath : '');
        });
    });
}

export function validatePathSync(filePath: string): boolean {
    if (filePath.length === 0) {
        return false;
    }
    if (PathValidity.has(filePath)) {
        return PathValidity.get(filePath);
    }
    const exists = fs.existsSync(filePath);
    PathValidity.set(filePath, exists);
    return exists;
}

export function CreatePythonThread(id: number, isWorker: boolean, process: IPythonProcess, name: string = ''): IPythonThread {
    return {
        IsWorkerThread: isWorker,
        Process: process,
        Name: name,
        Id: id,
        Frames: []
    };
}

export function CreatePythonModule(id: number, fileName: string): IPythonModule {
    let name = fileName;
    if (typeof fileName === 'string') {
        try {
            name = path.basename(fileName);
            // tslint:disable-next-line:no-empty
        } catch  { }
    } else {
        name = '';
    }

    return {
        ModuleId: id,
        Name: name,
        Filename: fileName
    };
}

export function FixupEscapedUnicodeChars(value: string): string {
    return value;
}

export function getPythonExecutable(pythonPath: string): string {
    pythonPath = untildify(pythonPath);
    // If only 'python'.
    if (pythonPath === 'python' ||
        pythonPath.indexOf(path.sep) === -1 ||
        path.basename(pythonPath) === path.dirname(pythonPath)) {
        return pythonPath;
    }

    if (isValidPythonPath(pythonPath)) {
        return pythonPath;
    }
    // Keep python right on top, for backwards compatibility.
    const KnownPythonExecutables = ['python', 'python4', 'python3.6', 'python3.5', 'python3', 'python2.7', 'python2'];

    for (let executableName of KnownPythonExecutables) {
        // Suffix with 'python' for linux and 'osx', and 'python.exe' for 'windows'.
        if (IS_WINDOWS) {
            executableName = `${executableName}.exe`;
            if (isValidPythonPath(path.join(pythonPath, executableName))) {
                return path.join(pythonPath, executableName);
            }
            if (isValidPythonPath(path.join(pythonPath, 'scripts', executableName))) {
                return path.join(pythonPath, 'scripts', executableName);
            }
        } else {
            if (isValidPythonPath(path.join(pythonPath, executableName))) {
                return path.join(pythonPath, executableName);
            }
            if (isValidPythonPath(path.join(pythonPath, 'bin', executableName))) {
                return path.join(pythonPath, 'bin', executableName);
            }
        }
    }

    return pythonPath;
}

function isValidPythonPath(pythonPath): boolean {
    try {
        const output = child_process.execFileSync(pythonPath, ['-c', 'print(1234)'], { encoding: 'utf8' });
        return output.startsWith('1234');
    } catch  {
        return false;
    }
}

type EnvVars = Object & { [key: string]: string };

export function getCustomEnvVars(envVars: Object, envFile: string, mergeWithProcessEnvVars: boolean = true): EnvVars {
    let envFileVars: EnvVars = null;
    if (typeof envFile === 'string' && envFile.length > 0 && fs.existsSync(envFile)) {
        try {
            envFileVars = parseEnvFile(envFile, mergeWithProcessEnvVars);
        } catch (ex) {
            console.error('Failed to load env file');
            console.error(ex);
        }
    }
    if (envFileVars && Object.keys(envFileVars).length > 0) {
        if (!envVars || Object.keys(envVars).length === 0) {
            return envFileVars;
        } else {
            envVars = envVars || {};
            return mergeEnvVariables(envVars as EnvVars, envFileVars);
        }
    }
    if (!envVars || Object.keys(envVars).length === 0) {
        return null;
    }

    return mergePythonPath(envVars as EnvVars, process.env.PYTHONPATH);
}
