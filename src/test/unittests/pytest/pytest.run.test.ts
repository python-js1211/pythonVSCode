// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXTENSION_ROOT_DIR } from '../../../client/common/constants';
import { IFileSystem } from '../../../client/common/platform/types';
import { IProcessServiceFactory } from '../../../client/common/process/types';
import { CommandSource } from '../../../client/unittests/common/constants';
import { UnitTestDiagnosticService } from '../../../client/unittests/common/services/unitTestDiagnosticService';
import { FlattenedTestFunction, ITestManager, ITestManagerFactory, Tests, TestStatus, TestsToRun } from '../../../client/unittests/common/types';
import { rootWorkspaceUri, updateSetting } from '../../common';
import { MockProcessService } from '../../mocks/proc';
import { UnitTestIocContainer } from '../serviceRegistry';
import { initialize, initializeTest, IS_MULTI_ROOT_TEST } from './../../initialize';
import { ITestDetails, ITestScenarioDetails, testScenarios } from './pytest_run_tests_data';

const UNITTEST_TEST_FILES_PATH = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'pythonFiles', 'testFiles', 'standard');
const PYTEST_RESULTS_PATH = path.join(EXTENSION_ROOT_DIR, 'src', 'test', 'pythonFiles', 'testFiles', 'pytestFiles', 'results');

interface IResultsSummaryCount {
    passes: number;
    skips: number;
    failures: number;
    errors: number;
}

/**
 * Establishing what tests should be run (so that they can be passed to the test manager) can be
 * dependant on the test discovery process having occurred. If the scenario has any properties that
 * indicate its testsToRun property needs to be generated, then this process is done by using
 * properties of the scenario to determine which test folders/files/suites/functions should be
 * used from the tests object created by the test discovery process.
 *
 * @param scenario The testing scenario to emulate.
 * @param tests The tests that were discovered.
 */
async function getScenarioTestsToRun(scenario: ITestScenarioDetails, tests: Tests): Promise<TestsToRun> {
    const generateTestsToRun = (scenario.testSuiteIndex || scenario.testFunctionIndex);
    if (scenario.testsToRun === undefined && generateTestsToRun) {
        scenario.testsToRun = {
            testFolder: [],
            testFile: [],
            testSuite: [],
            testFunction: []
        };
        if (scenario.testSuiteIndex) {
            scenario.testsToRun.testSuite!.push(tests.testSuites[scenario.testSuiteIndex].testSuite);
        }
        if (scenario.testFunctionIndex) {
            scenario.testsToRun.testFunction!.push(tests.testSuites[scenario.testFunctionIndex].testSuite);
        }
    }
    return scenario.testsToRun;
}

/**
 * Run the tests and return the results.
 *
 * In the case of a failed test run, some test details can be marked through the passOnFailedRun property to pass on a
 * failed run. This is meant to simulate a test or the thing it's meant to test being fixed.
 *
 * @param testManager The test manager used to run the tests.
 * @param testsToRun The tests that the test manager should run.
 * @param failedRun Whether or not the current test run is for failed tests from a previous run.
 */
async function getResultsFromTestManagerRunTest(testManager: ITestManager, testsToRun: TestsToRun, failedRun: boolean = false): Promise<Tests> {
    if (failedRun) {
        return testManager.runTest(CommandSource.ui, undefined, true);
     } else {
        return testManager.runTest(CommandSource.ui, testsToRun);
     }
}

/**
 * Get the number of passes/skips/failures/errors for a test run based on the test details for a scenario.
 *
 * In the case of a failed test run, some test details can be marked through the passOnFailedRun property to pass on a
 * failed run. This is meant to simulate a test or the thing it's meant to test being fixed.
 *
 * @param testDetails All the test details for a scenario.
 * @param failedRun Whether or not the current test run is for failed tests from a previous run.
 */
function getExpectedSummaryCount(testDetails: ITestDetails[], failedRun: boolean): IResultsSummaryCount {
    const summaryCount: IResultsSummaryCount = {
        passes: 0,
        skips: 0,
        failures: 0,
        errors: 0
    };
    testDetails.forEach(td => {
        let tStatus = td.status;
        if (failedRun && td.passOnFailedRun) {
            tStatus = TestStatus.Pass;
        }
        switch (tStatus) {
            case TestStatus.Pass: {
                summaryCount.passes += 1;
                break;
            }
            case TestStatus.Skipped: {
                summaryCount.skips += 1;
                break;
            }
            case TestStatus.Fail: {
                summaryCount.failures += 1;
                break;
            }
            case TestStatus.Error: {
                summaryCount.errors += 1;
                break;
            }
            default: {
                throw Error('Unsupported TestStatus');
            }
        }
    });
    return summaryCount;
}

/**
 * Get all the test details associated with a file.
 *
 * @param testDetails All the test details for a scenario.
 * @param fileName The name of the file to find test details for.
 */
function getRelevantTestDetailsForFile(testDetails: ITestDetails[], fileName: string): ITestDetails[] {
    return testDetails.filter(td => {
        return td.fileName === fileName;
    });
}

/**
 * Every failed/skipped test in a file should should have an associated Diagnostic for it. This calculates and returns the
 * expected number of Diagnostics based on the expected test details for that file. In the event of a normal test run,
 * skipped tests will be included in the results, and thus will be included in the testDetails argument. But if it's a
 * failed test run, skipped tests will not be attempted again, so they will not be included in the testDetails argument.
 *
 * In the case of a failed test run, some test details can be marked through the passOnFailedRun property to pass on a
 * failed run. This is meant to simulate a test or the thing it's meant to test being fixed.
 *
 * @param testDetails All the test details for a file for the tests that were run.
 * @param skippedTestDetails All the test details for skipped tests for a file.
 * @param failedRun Whether or not the current test run is for failed tests from a previous run.
 */
function getIssueCountFromRelevantTestDetails(testDetails: ITestDetails[], skippedTestDetails: ITestDetails[], failedRun: boolean = false): number {
    const relevantIssueDetails = testDetails.filter(td => {
        return td.status !== TestStatus.Pass && !(failedRun && td.passOnFailedRun);
    });
    // If it's a failed run, the skipped tests won't be included in testDetails, but should still be included as they still aren't passing.
    return relevantIssueDetails.length + (failedRun ? skippedTestDetails.length : 0);
}

/**
 * Get the Diagnostic associated with the FlattenedTestFunction.
 *
 * @param diagnostics The array of Diagnostics for a file.
 * @param testFunc The FlattenedTestFunction to find the Diagnostic for.
 */
function getDiagnosticForTestFunc(diagnostics: vscode.Diagnostic[], testFunc: FlattenedTestFunction): vscode.Diagnostic {
    return diagnostics.find(diag => {
        return testFunc.testFunction.nameToRun === diag.code;
    })!;
}

/**
 * Get a list of all the unique files found in a given testDetails array.
 *
 * @param testDetails All the test details for a scenario.
 */
function getUniqueIssueFilesFromTestDetails(testDetails: ITestDetails[]): string[] {
    return testDetails.reduce<string[]>((filtered, issue) => {
        if (filtered.indexOf(issue.fileName) === -1 && issue.fileName !== undefined) {
            filtered.push(issue.fileName);
        }
        return filtered;
    }, []);
}

/**
 * Of all the test details that were run for a scenario, given a file location, get all those that were skipped.
 *
 * @param testDetails All test details that should have been run for the scenario.
 * @param fileName The location of a file that had tests run.
 */
function getRelevantSkippedIssuesFromTestDetailsForFile(testDetails: ITestDetails[], fileName: string): ITestDetails[] {
    return testDetails.filter(td => {
        return td.fileName === fileName && td.status === TestStatus.Skipped;
    });
}

/**
 * Get the FlattenedTestFunction from the test results that's associated with the given testDetails object.
 *
 * @param results Results of the test run.
 * @param testFileUri The Uri of the test file that was run.
 * @param testDetails The details of a particular test.
 */
function getTestFuncFromResultsByTestFileAndName(ioc: UnitTestIocContainer, results: Tests, testFileUri: vscode.Uri, testDetails: ITestDetails): FlattenedTestFunction {
    const fileSystem = ioc.serviceContainer.get<IFileSystem>(IFileSystem);
    return results.testFunctions.find(test => {
        return fileSystem.arePathsSame(vscode.Uri.file(test.parentTestFile.fullPath).fsPath, testFileUri.fsPath) && test.testFunction.name === testDetails.testName;
    })!;
}

/**
 * Generate a Diagnostic object (including DiagnosticRelatedInformation) using the provided test details that reflects
 * what the Diagnostic for the associated test should be in order for it to be compared to by the actual Diagnostic
 * for the test.
 *
 * @param testDetails Test details for a specific test.
 */
async function getExpectedDiagnosticFromTestDetails(testDetails: ITestDetails): Promise<vscode.Diagnostic> {
    const relatedInfo: vscode.DiagnosticRelatedInformation[] = [];
    const testFilePath = path.join(UNITTEST_TEST_FILES_PATH, testDetails.fileName);
    const testFileUri = vscode.Uri.file(testFilePath);
    let expectedSourceTestFilePath = testFilePath;
    if (testDetails.imported) {
        expectedSourceTestFilePath = path.join(UNITTEST_TEST_FILES_PATH, testDetails.sourceFileName!);
    }
    const expectedSourceTestFileUri = vscode.Uri.file(expectedSourceTestFilePath);
    const diagMsgPrefix = new UnitTestDiagnosticService().getMessagePrefix(testDetails.status);
    const expectedDiagMsg = `${diagMsgPrefix ? `${diagMsgPrefix}: ` : ''}${testDetails.message}`;
    let expectedDiagRange = testDetails.testDefRange;
    let expectedSeverity = vscode.DiagnosticSeverity.Error;
    if (testDetails.status === TestStatus.Skipped) {
        // Stack should stop at the test definition line.
        expectedSeverity = vscode.DiagnosticSeverity.Information;
    }
    if (testDetails.imported) {
        // Stack should include the class furthest down the chain from the file that was executed.
        relatedInfo.push(
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(testFileUri, testDetails.classDefRange!),
                testDetails.simpleClassName!
            )
        );
        expectedDiagRange = testDetails.classDefRange;
    }
    relatedInfo.push(
        new vscode.DiagnosticRelatedInformation(
            new vscode.Location(expectedSourceTestFileUri, testDetails.testDefRange!),
            testDetails.sourceTestName
        )
    );
    if (testDetails.status !== TestStatus.Skipped) {
        relatedInfo.push(
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(expectedSourceTestFileUri, testDetails.issueRange!),
                testDetails.issueLineText!
            )
        );
    } else {
        expectedSeverity = vscode.DiagnosticSeverity.Information;
    }

    const expectedDiagnostic = new vscode.Diagnostic(expectedDiagRange!, expectedDiagMsg, expectedSeverity);
    expectedDiagnostic.source = 'pytest';
    expectedDiagnostic.code = testDetails.nameToRun;
    expectedDiagnostic.relatedInformation = relatedInfo;
    return expectedDiagnostic;
}

async function testResultsSummary(results: Tests, expectedSummaryCount: IResultsSummaryCount) {
    const totalTests = results.summary.passed + results.summary.skipped + results.summary.failures + results.summary.errors;
    assert.notEqual(totalTests, 0);
    assert.equal(results.summary.passed, expectedSummaryCount.passes, 'Passed');
    assert.equal(results.summary.skipped, expectedSummaryCount.skips, 'Skipped');
    assert.equal(results.summary.failures, expectedSummaryCount.failures, 'Failures');
    assert.equal(results.summary.errors, expectedSummaryCount.errors, 'Errors');
}

async function testDiagnostic(diagnostic: vscode.Diagnostic, expectedDiagnostic: vscode.Diagnostic) {
    assert.equal(diagnostic.code, expectedDiagnostic.code, 'Diagnostic code');
    assert.equal(diagnostic.message, expectedDiagnostic.message, 'Diagnostic message');
    assert.equal(diagnostic.severity, expectedDiagnostic.severity, 'Diagnostic severity');
    assert.equal(diagnostic.range.start.line, expectedDiagnostic.range.start.line, 'Diagnostic range start line');
    assert.equal(diagnostic.range.start.character, expectedDiagnostic.range.start.character, 'Diagnostic range start character');
    assert.equal(diagnostic.range.end.line, expectedDiagnostic.range.end.line, 'Diagnostic range end line');
    assert.equal(diagnostic.range.end.character, expectedDiagnostic.range.end.character, 'Diagnostic range end character');
    assert.equal(diagnostic.source, expectedDiagnostic.source, 'Diagnostic source');
    assert.equal(diagnostic.relatedInformation!.length, expectedDiagnostic.relatedInformation!.length, 'DiagnosticRelatedInformation count');
}

async function testDiagnosticRelatedInformation(relatedInfo: vscode.DiagnosticRelatedInformation, expectedRelatedInfo: vscode.DiagnosticRelatedInformation) {
    assert.equal(relatedInfo.message, expectedRelatedInfo.message, 'DiagnosticRelatedInfo definition');
    assert.equal(relatedInfo.location.range.start.line, expectedRelatedInfo.location.range.start.line, 'DiagnosticRelatedInfo definition range start line');
    assert.equal(relatedInfo.location.range.start.character, expectedRelatedInfo.location.range.start.character, 'DiagnosticRelatedInfo definition range start character');
    assert.equal(relatedInfo.location.range.end.line, expectedRelatedInfo.location.range.end.line, 'DiagnosticRelatedInfo definition range end line');
    assert.equal(relatedInfo.location.range.end.character, expectedRelatedInfo.location.range.end.character, 'DiagnosticRelatedInfo definition range end character');
}

// tslint:disable-next-line:max-func-body-length
suite('Unit Tests - pytest - run with mocked process output', () => {
    let ioc: UnitTestIocContainer;
    const configTarget = IS_MULTI_ROOT_TEST ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
    suiteSetup(async () => {
        await initialize();
        await updateSetting('unitTest.pyTestArgs', [], rootWorkspaceUri, configTarget);
    });

    function initializeDI() {
        ioc = new UnitTestIocContainer();
        ioc.registerCommonTypes();
        ioc.registerUnitTestTypes();
        ioc.registerVariableTypes();
        // Mocks.
        ioc.registerMockProcessTypes();
    }

    async function injectTestDiscoveryOutput(outputFileName: string) {
        const procService = await ioc.serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory).create() as MockProcessService;
        procService.onExecObservable((file, args, options, callback) => {
            if (args.indexOf('--collect-only') >= 0) {
                callback({
                    out: fs.readFileSync(path.join(PYTEST_RESULTS_PATH, outputFileName), 'utf8').replace(/\/Users\/donjayamanne\/.vscode\/extensions\/pythonVSCode\/src\/test\/pythonFiles\/testFiles\/noseFiles/g, PYTEST_RESULTS_PATH),
                    source: 'stdout'
                });
            }
        });
    }
    async function injectTestRunOutput(outputFileName: string, failedOutput: boolean = false) {
        const procService = await ioc.serviceContainer.get<IProcessServiceFactory>(IProcessServiceFactory).create() as MockProcessService;
        procService.onExecObservable((file, args, options, callback) => {
            if (failedOutput && args.indexOf('--last-failed') === -1) {
                return;
            }
            const index = args.findIndex(arg => arg.startsWith('--junitxml='));
            if (index >= 0) {
                const fileName = args[index].substr('--junitxml='.length);
                const contents = fs.readFileSync(path.join(PYTEST_RESULTS_PATH, outputFileName), 'utf8');
                fs.writeFileSync(fileName, contents, 'utf8');
                callback({ out: '', source: 'stdout' });
            }
        });
    }
    function getScenarioTestDetails(scenario: ITestScenarioDetails, failedRun: boolean): ITestDetails[] {
        if (scenario.shouldRunFailed && failedRun) {
            return scenario.testDetails!.filter(td => {return td.status === TestStatus.Fail; })!;
        }
        return scenario.testDetails!;
    }
    testScenarios.forEach(scenario => {
        suite(scenario.scenarioName, () => {
            let testDetails: ITestDetails[];
            let factory: ITestManagerFactory;
            let testManager: ITestManager;
            let results: Tests;
            let diagnostics: vscode.Diagnostic[];
            suiteSetup(async () => {
                await initializeTest();
                initializeDI();
                await injectTestDiscoveryOutput(scenario.discoveryOutput);
                await injectTestRunOutput(scenario.runOutput);
                if (scenario.shouldRunFailed === true) { await injectTestRunOutput(scenario.failedRunOutput!, true); }
                await updateSetting('unitTest.pyTestArgs', ['-k=test_'], rootWorkspaceUri, configTarget);
                factory = ioc.serviceContainer.get<ITestManagerFactory>(ITestManagerFactory);
                testManager = factory('pytest', rootWorkspaceUri!, UNITTEST_TEST_FILES_PATH);
                const tests = await testManager.discoverTests(CommandSource.ui, true, true);
                scenario.testsToRun = await getScenarioTestsToRun(scenario, tests);
            });
            suiteTeardown(async () => {
                await ioc.dispose();
                await updateSetting('unitTest.pyTestArgs', [], rootWorkspaceUri, configTarget);
            });
            const shouldRunProperly = (suiteName, failedRun = false) => {
                suite(suiteName, () => {
                    testDetails = getScenarioTestDetails(scenario, failedRun);
                    const uniqueIssueFiles = getUniqueIssueFilesFromTestDetails(testDetails);
                    let expectedSummaryCount;
                    suiteSetup(async () => {
                        testDetails = getScenarioTestDetails(scenario, failedRun);
                        results = await getResultsFromTestManagerRunTest(testManager, scenario.testsToRun, failedRun);
                        expectedSummaryCount = getExpectedSummaryCount(testDetails, failedRun);
                    });
                    test('Test results summary', async () => { await testResultsSummary(results, expectedSummaryCount); });
                    uniqueIssueFiles.forEach(fileName => {
                        suite(fileName, () => {
                            let testFileUri: vscode.Uri;
                            let expectedDiagnosticCount: number;
                            const relevantTestDetails = getRelevantTestDetailsForFile(testDetails, fileName);
                            const relevantSkippedIssues = getRelevantSkippedIssuesFromTestDetailsForFile(scenario.testDetails!, fileName);
                            suiteSetup(async () => {
                                testFileUri = vscode.Uri.file(path.join(UNITTEST_TEST_FILES_PATH, fileName));
                                diagnostics = testManager.diagnosticCollection.get(testFileUri)!;
                                expectedDiagnosticCount = getIssueCountFromRelevantTestDetails(relevantTestDetails, relevantSkippedIssues, failedRun);
                            });
                            test('Test DiagnosticCollection', async () => { assert.equal(diagnostics.length, expectedDiagnosticCount, 'Diagnostics count'); });
                            const validateTestFunctionAndDiagnostics = (td: ITestDetails) => {
                                suite(td.testName, () => {
                                    let testFunc: FlattenedTestFunction;
                                    let expectedStatus: TestStatus;
                                    let diagnostic: vscode.Diagnostic;
                                    let expectedDiagnostic: vscode.Diagnostic;
                                    suiteSetup(async () => {
                                        testFunc = getTestFuncFromResultsByTestFileAndName(ioc, results, testFileUri, td)!;
                                        expectedStatus = (failedRun && td.passOnFailedRun) ? TestStatus.Pass : td.status;
                                    });
                                    suite('TestFunction', async () => {
                                        test('Status', async () => {
                                            assert.equal(testFunc.testFunction.status, expectedStatus, 'Test status');
                                        });
                                    });
                                    if (td.status !== TestStatus.Pass && !(failedRun && td.passOnFailedRun)) {
                                        suite('Diagnostic', async () => {
                                            suiteSetup(async () => {
                                                diagnostic = getDiagnosticForTestFunc(diagnostics, testFunc)!;
                                                expectedDiagnostic = await getExpectedDiagnosticFromTestDetails(td);
                                            });
                                            test('Test Diagnostic', async () => { await testDiagnostic(diagnostic, expectedDiagnostic); });
                                            suite('Test DiagnosticRelatedInformation', async () => {
                                                if (td.imported) {
                                                    test('Class Definition', async () => {
                                                        await testDiagnosticRelatedInformation(diagnostic.relatedInformation![0], expectedDiagnostic.relatedInformation![0]);
                                                    });
                                                }
                                                test('Test Function Definition', async () => {
                                                    await testDiagnosticRelatedInformation(diagnostic.relatedInformation![(td.imported ? 1 : 0)], expectedDiagnostic.relatedInformation![(td.imported ? 1 : 0)]);
                                                });
                                                if (td.status !== TestStatus.Skipped) {
                                                    test('Failure Line', async () => {
                                                        await testDiagnosticRelatedInformation(diagnostic.relatedInformation![(td.imported ? 1 : 0) + 1], expectedDiagnostic.relatedInformation![(td.imported ? 1 : 0) + 1]);
                                                    });
                                                }
                                            });
                                        });
                                    }
                                });
                            };
                            relevantTestDetails.forEach((td: ITestDetails) => { validateTestFunctionAndDiagnostics(td); });
                            if (failedRun) {
                                relevantSkippedIssues.forEach((td: ITestDetails) => {
                                    validateTestFunctionAndDiagnostics(td);
                                });
                            }
                        });
                    });
                });
            };
            shouldRunProperly('Run');
            if (scenario.shouldRunFailed) { shouldRunProperly('Run Failed', true); }
        });
    });
});
