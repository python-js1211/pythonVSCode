// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import { EnvironmentTypeComparer } from '../../client/interpreter/configuration/environmentTypeComparer';
import { IInterpreterHelper } from '../../client/interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';

suite('Environment sorting', () => {
    const workspacePath = path.join('path', 'to', 'workspace');
    let interpreterHelper: IInterpreterHelper;
    let getActiveWorkspaceUriStub: sinon.SinonStub;
    let getInterpreterTypeDisplayNameStub: sinon.SinonStub;

    setup(() => {
        getActiveWorkspaceUriStub = sinon.stub().returns({ folderUri: { fsPath: workspacePath } });
        getInterpreterTypeDisplayNameStub = sinon.stub();

        interpreterHelper = ({
            getActiveWorkspaceUri: getActiveWorkspaceUriStub,
            getInterpreterTypeDisplayName: getInterpreterTypeDisplayNameStub,
        } as unknown) as IInterpreterHelper;
    });

    teardown(() => {
        sinon.restore();
    });

    type ComparisonTestCaseType = {
        title: string;
        envA: PythonEnvironment;
        envB: PythonEnvironment;
        expected: number;
    };

    const testcases: ComparisonTestCaseType[] = [
        {
            title: 'Local virtual environment should come first',
            envA: {
                envType: EnvironmentType.Venv,
                envPath: path.join(workspacePath, '.venv'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.System,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: -1,
        },
        {
            title: "Non-local virtual environment should not come first when there's a local env",
            envA: {
                envType: EnvironmentType.Venv,
                envPath: path.join('path', 'to', 'other', 'workspace', '.venv'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Venv,
                envPath: path.join(workspacePath, '.venv'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: "Conda environment should not come first when there's a local env",
            envA: {
                envType: EnvironmentType.Conda,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Venv,
                envPath: path.join(workspacePath, '.venv'),
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Conda base environment should come after any other conda env',
            envA: {
                envType: EnvironmentType.Conda,
                envName: 'base',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Conda,
                envName: 'random-name',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Pipenv environment should come before any other conda env',
            envA: {
                envType: EnvironmentType.Conda,
                envName: 'conda-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pipenv,
                envName: 'pipenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,

            expected: 1,
        },
        {
            title: 'System environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.System,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Poetry,
                envName: 'poetry-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Pyenv environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.Pyenv,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pipenv,
                envName: 'pipenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Global environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.Global,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Poetry,
                envName: 'poetry-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Windows Store environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.WindowsStore,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.VirtualEnv,
                envName: 'virtualenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'Unknown environment should not come first when there are global envs',
            envA: {
                envType: EnvironmentType.Unknown,
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pipenv,
                envName: 'pipenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title: 'If 2 environments are of the same type, the most recent Python version comes first',
            envA: {
                envType: EnvironmentType.Venv,
                envPath: path.join(workspacePath, '.old-venv'),
                version: { major: 3, minor: 7, patch: 5, raw: '3.7.5' },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Venv,
                envPath: path.join(workspacePath, '.venv'),
                version: { major: 3, minor: 10, patch: 2, raw: '3.10.2' },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title:
                "If 2 global environments have the same Python version and there's a Conda one, the Conda env should not come first",
            envA: {
                envType: EnvironmentType.Conda,
                envName: 'conda-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Pipenv,
                envName: 'pipenv-env',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
        {
            title:
                'If 2 global environments are of the same type and have the same Python version, they should be sorted by name',
            envA: {
                envType: EnvironmentType.Conda,
                envName: 'conda-foo',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            envB: {
                envType: EnvironmentType.Conda,
                envName: 'conda-bar',
                version: { major: 3, minor: 10, patch: 2 },
            } as PythonEnvironment,
            expected: 1,
        },
    ];

    testcases.forEach(({ title, envA, envB, expected }) => {
        test(title, () => {
            const envTypeComparer = new EnvironmentTypeComparer(interpreterHelper);
            const result = envTypeComparer.compare(envA, envB);

            assert.strictEqual(result, expected);
        });
    });
});
