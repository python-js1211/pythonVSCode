"use strict";

import {IPythonProcess, IPythonThread, IPythonModule, IPythonEvaluationResult} from "./Contracts";
import * as path from "path";
import * as fs from 'fs';
import * as child_process from 'child_process';

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

export function CreatePythonThread(id: number, isWorker: boolean, process: IPythonProcess, name: string = ""): IPythonThread {
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
    if (typeof fileName === "string") {
        try {
            name = path.basename(fileName);
        }
        catch (ex) {
        }
    }
    else {
        name = "";
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
    // If only 'python'
    if (pythonPath === 'python' ||
        pythonPath.indexOf(path.sep) === -1 ||
        path.basename(pythonPath) === path.dirname(pythonPath)) {
        return pythonPath;
    }

    if (isValidPythonPath(pythonPath)) {
        return pythonPath;
    }

    // Suffix with 'python' for linux and 'osx', and 'python.exe' for 'windows'
    if (IS_WINDOWS) {
        if (isValidPythonPath(path.join(pythonPath, 'python.exe'))) {
            return path.join(pythonPath, 'python.exe');
        }
        if (isValidPythonPath(path.join(pythonPath, 'scripts', 'python.exe'))) {
            return path.join(pythonPath, 'scripts', 'python.exe');
        }
    }
    else {
        if (isValidPythonPath(path.join(pythonPath, 'python'))) {
            return path.join(pythonPath, 'python');
        }
        if (isValidPythonPath(path.join(pythonPath, 'bin', 'python'))) {
            return path.join(pythonPath, 'bin', 'python');
        }
    }

    return pythonPath;
}

function isValidPythonPath(pythonPath): boolean {
    try {
        let output = child_process.execFileSync(pythonPath, ['-c', 'print(1234)'], { encoding: 'utf8' });
        return output.startsWith('1234');
    }
    catch (ex) {
        return false;
    }
}