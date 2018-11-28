// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:max-func-body-length no-invalid-this no-any

import { expect } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { openFile, waitForCondition } from '../common';
import { EXTENSION_ROOT_DIR_FOR_TESTS, IS_SMOKE_TEST } from '../constants';
import { closeActiveWindows, initializeTest } from '../initialize';

suite('Smoke Test: Debug file', function () {
    // Large value to allow for LS to get downloaded.
    this.timeout(4 * 60_000);

    suiteSetup(function () {
        if (!IS_SMOKE_TEST) {
            return this.skip();
        }
    });
    setup(initializeTest);
    suiteTeardown(closeActiveWindows);
    teardown(closeActiveWindows);

    test('Debug', async () => {
        const file = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'smokeTests', 'testExecInTerminal.py');
        const outputFile = path.join(EXTENSION_ROOT_DIR_FOR_TESTS, 'src', 'testMultiRootWkspc', 'smokeTests', 'testExecInTerminal.log');
        if (await fs.pathExists(outputFile)) {
            await fs.unlink(outputFile);
        }
        await openFile(file);

        const config = {
            name: 'Debug',
            request: 'launch',
            type: 'python',
            program: file
        };

        const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], config);
        expect(started).to.be.equal(true, 'Debugger did not sart');
        const checkIfFileHasBeenCreated = () => fs.pathExists(outputFile);
        await waitForCondition(checkIfFileHasBeenCreated, 30_000, '\'testExecInTerminal.log\' file not created');
    });
});
