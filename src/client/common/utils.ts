"use strict";

import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
import * as settings from "./configSettings";

const IS_WINDOWS = /^win/.test(process.platform);
const PATH_VARIABLE_NAME = IS_WINDOWS ? "Path" : "PATH";

const PathValidity: Map<string, boolean> = new Map<string, boolean>();
export function validatePath(filePath: string): Promise<string> {
    if (filePath.length === 0) {
        return Promise.resolve("");
    }
    if (PathValidity.has(filePath)) {
        return Promise.resolve(PathValidity.get(filePath) ? filePath : "");
    }
    return new Promise<string>(resolve => {
        fs.exists(filePath, exists => {
            PathValidity.set(filePath, exists);
            return resolve(exists ? filePath : "");
        });
    });
}

let pythonInterpretterDirectory: string = null;
let previouslyIdentifiedPythonPath: string = null;
let customEnvVariables: any = null;

export function getPythonInterpreterDirectory(): Promise<string> {
    // If we already have it and the python path hasn't changed, yay
    if (pythonInterpretterDirectory && previouslyIdentifiedPythonPath === settings.PythonSettings.getInstance().pythonPath) {
        return Promise.resolve(pythonInterpretterDirectory);
    }

    return new Promise<string>(resolve => {
        let pythonFileName = settings.PythonSettings.getInstance().pythonPath;

        // Check if we have the path
        if (path.basename(pythonFileName) === pythonFileName) {
            // No path provided
            return resolve("");
        }

        // If we can execute the python, then get the path from the fullyqualitified name
        child_process.execFile(pythonFileName, ["-c", "print(1234)"], (error, stdout, stderr) => {
            // Yes this is a valid python path
            if (stdout.startsWith("1234")) {
                return resolve(path.dirname(pythonFileName));
            }
            // No idea, didn't work, hence don't reject, but return empty path
            resolve("");
        });
    }).then(value => {
        // Cache and return
        previouslyIdentifiedPythonPath = settings.PythonSettings.getInstance().pythonPath;
        return pythonInterpretterDirectory = value;
    }).catch(() => {
        // Don't care what the error is, all we know is that this doesn't work
        return pythonInterpretterDirectory = "";
    });
}

export function execPythonFile(file: string, args: string[], cwd: string, includeErrorAsResponse: boolean = false): Promise<string> {
    // If running the python file, then always revert to execFileInternal
    // Cuz python interpreter is always a file and we can and will always run it using child_process.execFile()
    if (file === settings.PythonSettings.getInstance().pythonPath) {
        return execFileInternal(file, args, { cwd: cwd }, includeErrorAsResponse);
    }

    return getPythonInterpreterDirectory().then(pyPath => {
        // We don't have a path
        if (pyPath.length === 0) {
            return execFileInternal(file, args, { cwd: cwd }, includeErrorAsResponse);
        }

        if (customEnvVariables === null) {
            let pathValue = <string>process.env[PATH_VARIABLE_NAME];
            // Ensure to include the path of the current python 
            let newPath = "";
            if (IS_WINDOWS) {
                newPath = pyPath + "\\" + path.delimiter + path.join(pyPath, "Scripts\\") + path.delimiter + process.env[PATH_VARIABLE_NAME];
                // This needs to be done for windows
                process.env[PATH_VARIABLE_NAME] = newPath;
            }
            else {
                newPath = pyPath + path.delimiter + process.env[PATH_VARIABLE_NAME];
            }
            let customSettings = <{ [key: string]: string }>{};
            customSettings[PATH_VARIABLE_NAME] = newPath;
            customEnvVariables = mergeEnvVariables(customSettings);
        }

        return execFileInternal(file, args, { cwd, env: customEnvVariables }, includeErrorAsResponse);
    });
}

function handleResponse(file: string, includeErrorAsResponse: boolean, error: Error, stdout: string, stderr: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        if (typeof (error) === "object" && error !== null && ((<any>error).code === "ENOENT" || (<any>error).code === 127)) {
            return reject(error);
        }

        // pylint:
        //      In the case of pylint we have some messages (such as config file not found and using default etc...) being returned in stderr
        //      These error messages are useless when using pylint   
        if (includeErrorAsResponse && (stdout.length > 0 || stderr.length > 0)) {
            return resolve(stdout + "\n" + stderr);
        }

        let hasErrors = (error && error.message.length > 0) || (stderr && stderr.length > 0);
        if (hasErrors && (typeof stdout !== "string" || stdout.length === 0)) {
            let errorMsg = (error && error.message) ? error.message : (stderr && stderr.length > 0 ? stderr + "" : "");
            return reject(errorMsg);
        }

        resolve(stdout + "");
    });
}
function execFileInternal(file: string, args: string[], options: child_process.ExecFileOptions, includeErrorAsResponse: boolean): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        child_process.execFile(file, args, options, (error, stdout, stderr) => {
            handleResponse(file, includeErrorAsResponse, error, stdout, stderr).then(resolve, reject);
        });
    });
}
function execInternal(command: string, args: string[], options: child_process.ExecFileOptions, includeErrorAsResponse: boolean): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        child_process.exec([command].concat(args).join(" "), options, (error, stdout, stderr) => {
            handleResponse(command, includeErrorAsResponse, error, stdout, stderr).then(resolve, reject);
        });
    });
}

export function mergeEnvVariables(newVariables: { [key: string]: string }): any {
    for (let setting in process.env) {
        if (!newVariables[setting]) {
            newVariables[setting] = process.env[setting];
        }
    }

    return newVariables;
}