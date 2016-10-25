//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

//First thing to be executed
process.env['PYTHON_DONJAYAMANNE_TEST'] = "1";

// The module 'assert' provides assertion methods from node
import * as assert from "assert";
import * as fs from 'fs';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import * as path from "path";
let dummyPythonFile = path.join(__dirname, "..", "..", "src", "test", "pythonFiles", "dummy.py");

export function initialize(): Thenable<any> {
    return vscode.workspace.openTextDocument(dummyPythonFile);
}

export function closeActiveWindows(counter: number = 0): Thenable<any> {
    if (counter >= 10 || !vscode.window.activeTextEditor) {
        return Promise.resolve();
    }
    return new Promise<any>(resolve => {
        setTimeout(function () {
            if (!vscode.window.activeTextEditor) {
                setTimeout(function () {
                    resolve();
                }, 1000);
            }

            vscode.commands.executeCommand('workbench.action.closeActiveEditor').then(() => {
                closeActiveWindows(counter++).then(resolve, resolve);
            }, ()=>{
                closeActiveWindows(counter++).then(resolve, resolve);
            });
        }, 500);
    });
}

export const IS_TRAVIS = (process.env['TRAVIS'] + '') === 'true';
export const TEST_TIMEOUT = 10000;

function getPythonPath(): string {
    const pythonPaths = ['/home/travis/virtualenv/python3.5.2/bin/python',
        '/Users/travis/.pyenv/versions/3.5.1/envs/MYVERSION/bin/python'];
    for (let counter = 0; counter < pythonPaths.length; counter++) {
        if (fs.existsSync(pythonPaths[counter])) {
            return pythonPaths[counter];
        }
    }
    return 'python';
}

export const PYTHON_PATH = IS_TRAVIS ? getPythonPath() : 'python';