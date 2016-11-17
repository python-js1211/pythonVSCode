'use strict';
import { createTemporaryFile } from '../../common/helpers';
import { OutputChannel, CancellationToken } from 'vscode';
import { TestsToRun, Tests } from '../common/contracts';
import { updateResults } from '../common/testUtils';
import { updateResultsFromXmlLogFile, PassCalculationFormulae } from '../common/xUnitParser';
import { run } from '../common/runner';
import { PythonSettings } from '../../common/configSettings';
import * as vscode from 'vscode';
import { execPythonFile } from './../../common/utils';
import { createDeferred } from './../../common/helpers';
import * as os from 'os';
import * as path from 'path';

const pythonSettings = PythonSettings.getInstance();
const WITH_XUNIT = '--with-xunit';
const XUNIT_FILE = '--xunit-file';

export function runTest(rootDirectory: string, tests: Tests, args: string[], testsToRun?: TestsToRun, token?: CancellationToken, outChannel?: OutputChannel, debug?: boolean): Promise<any> {
    let testPaths = [];
    if (testsToRun && testsToRun.testFolder) {
        testPaths = testPaths.concat(testsToRun.testFolder.map(f => f.nameToRun));
    }
    if (testsToRun && testsToRun.testFile) {
        testPaths = testPaths.concat(testsToRun.testFile.map(f => f.nameToRun));
    }
    if (testsToRun && testsToRun.testSuite) {
        testPaths = testPaths.concat(testsToRun.testSuite.map(f => f.nameToRun));
    }
    if (testsToRun && testsToRun.testFunction) {
        testPaths = testPaths.concat(testsToRun.testFunction.map(f => f.nameToRun));
    }

    let xmlLogFile = '';
    let xmlLogFileCleanup: Function = () => { };

    // Check if '--with-xunit' is in args list
    const noseTestArgs = args.slice();
    if (noseTestArgs.indexOf(WITH_XUNIT) === -1) {
        noseTestArgs.push(WITH_XUNIT);
    }

    // Check if '--xunit-file' exists, if not generate random xml file
    let indexOfXUnitFile = noseTestArgs.findIndex(value => value.indexOf(XUNIT_FILE) === 0);
    let promiseToGetXmlLogFile: Promise<string>;
    if (indexOfXUnitFile === -1) {
        promiseToGetXmlLogFile = createTemporaryFile('.xml').then(xmlLogResult => {
            xmlLogFileCleanup = xmlLogResult.cleanupCallback;
            xmlLogFile = xmlLogResult.filePath;

            noseTestArgs.push(`${XUNIT_FILE}=${xmlLogFile}`);
            return xmlLogResult.filePath;
        });
    }
    else {
        if (noseTestArgs[indexOfXUnitFile].indexOf('=') === -1) {
            xmlLogFile = noseTestArgs[indexOfXUnitFile + 1];
        }
        else {
            xmlLogFile = noseTestArgs[indexOfXUnitFile].substring(noseTestArgs[indexOfXUnitFile].indexOf('=') + 1).trim();
        }

        promiseToGetXmlLogFile = Promise.resolve(xmlLogFile);
    }

    return promiseToGetXmlLogFile.then(() => {
        if (debug === true) {
            const def = createDeferred<any>();
            const launchDef = createDeferred<any>();
            const testLauncherFile = path.join(__dirname, '..', '..', '..', '..', 'pythonFiles', 'PythonTools', 'testlauncher.py');

            // start the debug adapter only once we have started the debug process
            // pytestlauncherargs
            const nosetestlauncherargs = [rootDirectory, 'my_secret', pythonSettings.unitTest.debugPort.toString(), 'nose'];
            let outputChannelShown = false;
            execPythonFile(pythonSettings.pythonPath, [testLauncherFile].concat(nosetestlauncherargs).concat(noseTestArgs.concat(testPaths)), rootDirectory, true, (data: string) => {
                if (data === 'READY' + os.EOL) {
                    // debug socket server has started
                    launchDef.resolve();
                }
                else {
                    if (!outputChannelShown) {
                        outputChannelShown = true;
                        outChannel.show();
                    }
                    outChannel.append(data);
                }
            }, token).catch(reason => {
                if (!def.rejected && !def.resolved) {
                    def.reject(reason);
                }
            }).then(() => {
                if (!def.rejected && !def.resolved) {
                    def.resolve();
                }
            }).catch(reason => {
                if (!def.rejected && !def.resolved) {
                    def.reject(reason);
                }
            });

            launchDef.promise.then(() => {
                return vscode.commands.executeCommand('vscode.startDebug', {
                    "name": "Debug Unit Test",
                    "type": "python",
                    "request": "attach",
                    "localRoot": rootDirectory,
                    "remoteRoot": rootDirectory,
                    "port": pythonSettings.unitTest.debugPort,
                    "secret": "my_secret",
                    "host": "localhost"
                });
            }).catch(reason => {
                if (!def.rejected && !def.resolved) {
                    def.reject(reason);
                }
            });

            return def.promise;
        }
        else {
            return run(pythonSettings.unitTest.nosetestPath, noseTestArgs.concat(testPaths), rootDirectory, token, outChannel);
        }
    }).then(() => {
        return updateResultsFromLogFiles(tests, xmlLogFile);
    }).then(result => {
        xmlLogFileCleanup();
        return result;
    }).catch(reason => {
        xmlLogFileCleanup();
        return Promise.reject(reason);
    });
}

export function updateResultsFromLogFiles(tests: Tests, outputXmlFile: string): Promise<any> {
    return updateResultsFromXmlLogFile(tests, outputXmlFile, PassCalculationFormulae.nosetests).then(() => {
        updateResults(tests);
        return tests;
    });
}
