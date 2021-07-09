// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import * as fsWatcher from '../../../../../client/common/platform/fileSystemWatcher';
import * as platformUtils from '../../../../../client/common/utils/platform';
import {
    PythonEnvInfo,
    PythonEnvKind,
    PythonEnvSource,
    PythonReleaseLevel,
    PythonVersion,
    UNKNOWN_PYTHON_VERSION,
} from '../../../../../client/pythonEnvironments/base/info';
import { WorkspaceVirtualEnvironmentLocator } from '../../../../../client/pythonEnvironments/base/locators/lowLevel/workspaceVirtualEnvLocator';
import { getEnvs } from '../../../../../client/pythonEnvironments/base/locatorUtils';
import { TEST_LAYOUT_ROOT } from '../../../common/commonTestConstants';
import { assertEnvsEqual } from '../../../discovery/locators/envTestUtils';

suite('WorkspaceVirtualEnvironment Locator', () => {
    const testWorkspaceFolder = path.join(TEST_LAYOUT_ROOT, 'workspace', 'folder1');
    let getOSTypeStub: sinon.SinonStub;
    let watchLocationForPatternStub: sinon.SinonStub;
    let locator: WorkspaceVirtualEnvironmentLocator;

    function createExpectedEnvInfo(
        interpreterPath: string,
        kind: PythonEnvKind,
        version: PythonVersion = UNKNOWN_PYTHON_VERSION,
        name = '',
        location = path.join(testWorkspaceFolder, name),
    ): PythonEnvInfo {
        return {
            name,
            location,
            kind,
            executable: {
                filename: interpreterPath,
                sysPrefix: '',
                ctime: -1,
                mtime: -1,
            },
            display: undefined,
            version,
            arch: platformUtils.Architecture.Unknown,
            distro: { org: '' },
            searchLocation: Uri.file(path.dirname(location)),
            source: [PythonEnvSource.Other],
        };
    }

    function comparePaths(actual: PythonEnvInfo[], expected: PythonEnvInfo[]) {
        const actualPaths = actual.map((a) => a.executable.filename);
        const expectedPaths = expected.map((a) => a.executable.filename);
        assert.deepStrictEqual(actualPaths, expectedPaths);
    }

    setup(() => {
        getOSTypeStub = sinon.stub(platformUtils, 'getOSType');
        getOSTypeStub.returns(platformUtils.OSType.Linux);
        watchLocationForPatternStub = sinon.stub(fsWatcher, 'watchLocationForPattern');
        watchLocationForPatternStub.returns({
            dispose: () => {
                /* do nothing */
            },
        });
        locator = new WorkspaceVirtualEnvironmentLocator(testWorkspaceFolder);
    });
    teardown(async () => {
        await locator.dispose();
        getOSTypeStub.restore();
        watchLocationForPatternStub.restore();
    });

    test('iterEnvs(): Windows', async () => {
        getOSTypeStub.returns(platformUtils.OSType.Windows);
        const expectedEnvs = [
            createExpectedEnvInfo(
                path.join(testWorkspaceFolder, 'win1', 'python.exe'),
                PythonEnvKind.Venv,
                {
                    major: 3,
                    minor: 9,
                    micro: 0,
                    release: { level: PythonReleaseLevel.Alpha, serial: 1 },
                    sysVersion: undefined,
                },
                'win1',
            ),
            createExpectedEnvInfo(
                path.join(testWorkspaceFolder, '.direnv', 'win2', 'Scripts', 'python.exe'),
                PythonEnvKind.Venv,
                { major: 3, minor: 6, micro: 1 },
                'win2',
                path.join(testWorkspaceFolder, '.direnv', 'win2'),
            ),
            createExpectedEnvInfo(
                path.join(testWorkspaceFolder, '.venv', 'Scripts', 'python.exe'),
                PythonEnvKind.Pipenv,
                {
                    major: 3,
                    minor: 8,
                    micro: 2,
                    release: { level: PythonReleaseLevel.Final, serial: 0 },
                    sysVersion: undefined,
                },
                '.venv',
            ),
        ].sort((a, b) => a.executable.filename.localeCompare(b.executable.filename));

        const iterator = locator.iterEnvs();
        const actualEnvs = (await getEnvs(iterator)).sort((a, b) =>
            a.executable.filename.localeCompare(b.executable.filename),
        );

        comparePaths(actualEnvs, expectedEnvs);
        assertEnvsEqual(actualEnvs, expectedEnvs);
    });

    test('iterEnvs(): Non-Windows', async () => {
        const expectedEnvs = [
            createExpectedEnvInfo(
                path.join(testWorkspaceFolder, '.direnv', 'posix1virtualenv', 'bin', 'python'),
                PythonEnvKind.VirtualEnv,
                { major: 3, minor: 8, micro: -1 },
                'posix1virtualenv',
                path.join(testWorkspaceFolder, '.direnv', 'posix1virtualenv'),
            ),
        ].sort((a, b) => a.executable.filename.localeCompare(b.executable.filename));

        const iterator = locator.iterEnvs();
        const actualEnvs = (await getEnvs(iterator)).sort((a, b) =>
            a.executable.filename.localeCompare(b.executable.filename),
        );

        comparePaths(actualEnvs, expectedEnvs);
        assertEnvsEqual(actualEnvs, expectedEnvs);
    });
});
