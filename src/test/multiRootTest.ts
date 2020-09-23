// tslint:disable:no-console

import * as path from 'path';
import { runTests } from 'vscode-test';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from './constants';
import { initializeLogger } from './testLogger';

const workspacePath = path.join(__dirname, '..', '..', 'src', 'testMultiRootWkspc', 'multi.code-workspace');
process.env.IS_CI_SERVER_TEST_DEBUGGER = '';
process.env.VSC_PYTHON_CI_TEST = '1';

initializeLogger();

const channel = process.env.VSC_PYTHON_CI_TEST_VSC_CHANNEL || 'stable';

function start() {
    console.log('*'.repeat(100));
    console.log('Start Multiroot tests');
    runTests({
        extensionDevelopmentPath: EXTENSION_ROOT_DIR_FOR_TESTS,
        extensionTestsPath: path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'out', 'test', 'index'),
        launchArgs: [workspacePath],
        version: channel,
        extensionTestsEnv: { ...process.env, UITEST_DISABLE_INSIDERS: '1' }
    }).catch((ex) => {
        console.error('End Multiroot tests (with errors)', ex);
        process.exit(1);
    });
}
start();
