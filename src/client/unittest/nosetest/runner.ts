'use strict';
import * as path from 'path';
import {execPythonFile} from './../../common/utils';
import {createDeferred, createTemporaryFile} from '../../common/helpers';
import {OutputChannel, window} from 'vscode';
import {TestFile, TestsToRun, TestSuite, TestFunction, FlattenedTestFunction, Tests, TestStatus, FlattenedTestSuite} from '../contracts';
import * as vscode from 'vscode';
import {extractBetweenDelimiters, convertFileToPackage, flattenTestFiles, updateResults, BaseTestManager} from '../testUtils';
import {CancellationToken} from 'vscode';
import {updateResultsFromXmlLogFile, PassCalculationFormulae} from '../xUnitParser';

export function runTest(rootDirectory: string, tests: Tests, args: string[], testsToRun?: TestsToRun, stdOut?: (output: string) => void, token?: CancellationToken): Promise<any> {
    let testPaths = [];
    if (testsToRun && testsToRun.testFolder) {
        testPaths = testPaths.concat(testsToRun.testFolder.map(f => f.rawName));
    }
    if (testsToRun && testsToRun.testFile) {
        testPaths = testPaths.concat(testsToRun.testFile.map(f => f.rawName));
    }
    if (testsToRun && testsToRun.testSuite) {
        testPaths = testPaths.concat(testsToRun.testSuite.map(f => f.rawName));
    }
    if (testsToRun && testsToRun.testFunction) {
        testPaths = testPaths.concat(testsToRun.testFunction.map(f => f.rawName));
    }

    let xmlLogFile = '';
    let xmlLogFileCleanup: Function = null;

    return createTemporaryFile('.xml').then(xmlLogResult => {
        xmlLogFile = xmlLogResult.filePath;
        xmlLogFileCleanup = xmlLogResult.cleanupCallback;
        return execPythonFile('nosetests', args.concat(['--with-xunit', `--xunit-file=${xmlLogFile}`]).concat(testPaths), rootDirectory, true, stdOut);
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

