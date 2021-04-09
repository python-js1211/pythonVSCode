// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert, expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { ExecutionResult, ShellOptions } from '../../../../../client/common/process/types';
import { getUserHomeDir } from '../../../../../client/common/utils/platform';
import * as externalDependencies from '../../../../../client/pythonEnvironments/common/externalDependencies';
import {
    isPoetryEnvironment,
    Poetry,
} from '../../../../../client/pythonEnvironments/discovery/locators/services/poetry';
import { TEST_LAYOUT_ROOT } from '../../../common/commonTestConstants';

const testPoetryDir = path.join(TEST_LAYOUT_ROOT, 'poetry');
const project1 = path.join(testPoetryDir, 'project1');
const project4 = path.join(testPoetryDir, 'project4');
const project3 = path.join(testPoetryDir, 'project3');

suite('isPoetryEnvironment Tests', () => {
    let shellExecute: sinon.SinonStub;
    let getPythonSetting: sinon.SinonStub;

    suiteTeardown(() => {
        Poetry._poetryPromise = new Map();
    });

    suite('Global poetry environment', async () => {
        test('Return true if environment folder name matches global env pattern and environment is of virtual env type', async () => {
            const result = await isPoetryEnvironment(
                path.join(testPoetryDir, 'poetry-tutorial-project-6hnqYwvD-py3.8', 'Scripts', 'python.exe'),
            );
            expect(result).to.equal(true);
        });

        test('Return false if environment folder name does not matches env pattern', async () => {
            const result = await isPoetryEnvironment(
                path.join(testPoetryDir, 'wannabeglobalenv', 'Scripts', 'python.exe'),
            );
            expect(result).to.equal(false);
        });

        test('Return false if environment folder name matches env pattern but is not of virtual env type', async () => {
            const result = await isPoetryEnvironment(
                path.join(testPoetryDir, 'project1-haha-py3.8', 'Scripts', 'python.exe'),
            );
            expect(result).to.equal(false);
        });
    });

    suite('Local poetry environment', async () => {
        setup(() => {
            shellExecute = sinon.stub(externalDependencies, 'shellExecute');
            getPythonSetting = sinon.stub(externalDependencies, 'getPythonSetting');
            getPythonSetting.returns('poetry');
            shellExecute.callsFake((command: string, _options: ShellOptions) => {
                if (command === 'poetry env list --full-path') {
                    return Promise.resolve<ExecutionResult<string>>({ stdout: '' });
                }
                return Promise.reject(new Error('Command failed'));
            });
        });

        teardown(() => {
            sinon.restore();
        });

        test('Return true if environment folder name matches criteria for local envs', async () => {
            const result = await isPoetryEnvironment(path.join(project1, '.venv', 'Scripts', 'python.exe'));
            expect(result).to.equal(true);
        });

        test(`Return false if environment folder name is not named '.venv' for local envs`, async () => {
            const result = await isPoetryEnvironment(path.join(project1, '.venv2', 'Scripts', 'python.exe'));
            expect(result).to.equal(false);
        });

        test(`Return false if running poetry for project dir as cwd fails (pyproject.toml file is invalid)`, async () => {
            const result = await isPoetryEnvironment(path.join(project4, '.venv', 'bin', 'python'));
            expect(result).to.equal(false);
        });
    });
});

suite('Poetry binary is located correctly', async () => {
    let shellExecute: sinon.SinonStub;
    let getPythonSetting: sinon.SinonStub;

    suiteSetup(() => {
        Poetry._poetryPromise = new Map();
    });

    setup(() => {
        getPythonSetting = sinon.stub(externalDependencies, 'getPythonSetting');
        shellExecute = sinon.stub(externalDependencies, 'shellExecute');
    });

    teardown(() => {
        Poetry._poetryPromise = new Map();
        sinon.restore();
    });

    test("Return undefined if pyproject.toml doesn't exist in cwd", async () => {
        getPythonSetting.returns('poetryPath');
        shellExecute.callsFake((_command: string, _options: ShellOptions) => {
            return Promise.resolve<ExecutionResult<string>>({ stdout: '' });
        });

        const poetry = await Poetry.getPoetry(testPoetryDir);

        expect(poetry?._command).to.equal(undefined);
    });

    test('Return undefined if cwd contains pyproject.toml which does not contain a poetry section', async () => {
        getPythonSetting.returns('poetryPath');
        shellExecute.callsFake((_command: string, _options: ShellOptions) => {
            return Promise.resolve<ExecutionResult<string>>({ stdout: '' });
        });

        const poetry = await Poetry.getPoetry(project3);

        expect(poetry?._command).to.equal(undefined);
    });

    test('When user has specified a valid poetry path, use it', async () => {
        getPythonSetting.returns('poetryPath');
        shellExecute.callsFake((command: string, options: ShellOptions) => {
            if (
                command === `poetryPath env list --full-path` &&
                options.cwd &&
                externalDependencies.arePathsSame(options.cwd, project1)
            ) {
                return Promise.resolve<ExecutionResult<string>>({ stdout: '' });
            }
            return Promise.reject(new Error('Command failed'));
        });

        const poetry = await Poetry.getPoetry(project1);

        expect(poetry?._command).to.equal('poetryPath');
    });

    test("When user hasn't specified a path, use poetry on PATH if available", async () => {
        getPythonSetting.returns('poetry'); // Setting returns the default value
        shellExecute.callsFake((command: string, options: ShellOptions) => {
            if (
                command === `poetry env list --full-path` &&
                options.cwd &&
                externalDependencies.arePathsSame(options.cwd, project1)
            ) {
                return Promise.resolve<ExecutionResult<string>>({ stdout: '' });
            }
            return Promise.reject(new Error('Command failed'));
        });

        const poetry = await Poetry.getPoetry(project1);

        expect(poetry?._command).to.equal('poetry');
    });

    test('When poetry is not available on PATH, try using the default poetry location if valid', async () => {
        const home = getUserHomeDir();
        if (!home) {
            assert(true);
            return;
        }
        const defaultPoetry = path.join(home, '.poetry', 'bin', 'poetry');
        const pathExistsSync = sinon.stub(externalDependencies, 'pathExistsSync');
        pathExistsSync.withArgs(defaultPoetry).returns(true);
        pathExistsSync.callThrough();
        getPythonSetting.returns('poetry');
        shellExecute.callsFake((command: string, options: ShellOptions) => {
            if (
                command === `${defaultPoetry} env list --full-path` &&
                options.cwd &&
                externalDependencies.arePathsSame(options.cwd, project1)
            ) {
                return Promise.resolve<ExecutionResult<string>>({ stdout: '' });
            }
            return Promise.reject(new Error('Command failed'));
        });

        const poetry = await Poetry.getPoetry(project1);

        expect(poetry?._command).to.equal(defaultPoetry);
    });

    test('Return undefined otherwise', async () => {
        getPythonSetting.returns('poetry');
        shellExecute.callsFake((_command: string, _options: ShellOptions) => {
            return Promise.reject(new Error('Command failed'));
        });

        const poetry = await Poetry.getPoetry(project1);

        expect(poetry?._command).to.equal(undefined);
    });
});
