// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as assert from 'assert';
import * as path from 'path';
import * as sinon from 'sinon';
import { Architecture } from '../../../../client/common/utils/platform';
import {
    PythonEnvInfo,
    PythonEnvKind,
    PythonEnvSource,
    PythonReleaseLevel,
    PythonVersion,
    UNKNOWN_PYTHON_VERSION,
} from '../../../../client/pythonEnvironments/base/info';
import { buildEnvInfo } from '../../../../client/pythonEnvironments/base/info/env';
import { parseVersion } from '../../../../client/pythonEnvironments/base/info/pythonVersion';
import { getEnvs } from '../../../../client/pythonEnvironments/base/locatorUtils';
import * as winreg from '../../../../client/pythonEnvironments/common/windowsRegistry';
import * as winutils from '../../../../client/pythonEnvironments/common/windowsUtils';
import { WindowsRegistryLocator } from '../../../../client/pythonEnvironments/discovery/locators/services/windowsRegistryLocator';
import { TEST_LAYOUT_ROOT } from '../../common/commonTestConstants';
import { assertEnvEqual, assertEnvsEqual } from './envTestUtils';

suite('Windows Registry', () => {
    let stubReadRegistryValues: sinon.SinonStub;
    let stubReadRegistryKeys: sinon.SinonStub;
    let locator: WindowsRegistryLocator;

    const regTestRoot = path.join(TEST_LAYOUT_ROOT, 'winreg');

    const registryData = {
        x64: {
            HKLM: [
                {
                    key: '\\SOFTWARE\\Python',
                    values: { '': '' },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCore', '\\SOFTWARE\\Python\\ContinuumAnalytics'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCore',
                    values: {
                        '': '',
                        DisplayName: 'Python Software Foundation',
                        SupportUrl: 'www.python.org',
                    },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCore\\3.9'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCore\\3.9',
                    values: {
                        '': '',
                        DisplayName: 'Python 3.9 (64-bit)',
                        SupportUrl: 'www.python.org',
                        SysArchitecture: '64bit',
                        SysVersion: '3.9',
                        Version: '3.9.0rc2',
                    },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCore\\3.9\\InstallPath'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCore\\3.9\\InstallPath',
                    values: {
                        '': '',
                        ExecutablePath: path.join(regTestRoot, 'py39', 'python.exe'),
                    },
                    subKeys: [] as string[],
                },
                {
                    key: '\\SOFTWARE\\Python\\ContinuumAnalytics',
                    values: {
                        '': '',
                    },
                    subKeys: ['\\SOFTWARE\\Python\\ContinuumAnalytics\\Anaconda38-64'],
                },
                {
                    key: '\\SOFTWARE\\Python\\ContinuumAnalytics\\Anaconda38-64',
                    values: {
                        '': '',
                        DisplayName: 'Anaconda py38_4.8.3',
                        SupportUrl: 'github.com/continuumio/anaconda-issues',
                        SysArchitecture: '64bit',
                        SysVersion: '3.8',
                        Version: 'py38_4.8.3',
                    },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCore\\Anaconda38-64\\InstallPath'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCore\\Anaconda38-64\\InstallPath',
                    values: {
                        '': '',
                        ExecutablePath: path.join(regTestRoot, 'conda3', 'python.exe'),
                    },
                    subKeys: [] as string[],
                },
            ],
            HKCU: [
                {
                    key: '\\SOFTWARE\\Python',
                    values: { '': '' },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCore'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCore',
                    values: {
                        '': '',
                        DisplayName: 'Python Software Foundation',
                        SupportUrl: 'www.python.org',
                    },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCore\\3.7'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCore\\3.7',
                    values: {
                        '': '',
                        DisplayName: 'Python 3.7 (64-bit)',
                        SupportUrl: 'www.python.org',
                        SysArchitecture: '64bit',
                        SysVersion: '3.7',
                        Version: '3.7.7',
                    },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCore\\3.7\\InstallPath'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCore\\3.7\\InstallPath',
                    values: {
                        '': '',
                        ExecutablePath: path.join(regTestRoot, 'python37', 'python.exe'),
                    },
                    subKeys: [] as string[],
                },
            ],
        },
        x86: {
            HKLM: [],
            HKCU: [
                {
                    key: '\\SOFTWARE\\Python',
                    values: { '': '' },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCodingPack'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCodingPack',
                    values: {
                        '': '',
                        DisplayName: 'Python Software Foundation',
                        SupportUrl: 'www.python.org',
                    },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCodingPack\\3.8'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCodingPack\\3.8',
                    values: {
                        '': '',
                        DisplayName: 'Python 3.8 (32-bit)',
                        SupportUrl: 'www.python.org',
                        SysArchitecture: '32bit',
                        SysVersion: '3.8.5',
                    },
                    subKeys: ['\\SOFTWARE\\Python\\PythonCodingPack\\3.8\\InstallPath'],
                },
                {
                    key: '\\SOFTWARE\\Python\\PythonCodingPack\\3.8\\InstallPath',
                    values: {
                        '': '',
                        ExecutablePath: path.join(regTestRoot, 'python38', 'python.exe'),
                    },
                    subKeys: [] as string[],
                },
            ],
        },
    };

    function fakeRegistryValues({ arch, hive, key }: winreg.Options): Promise<winreg.IRegistryValue[]> {
        const regArch = arch === 'x86' ? registryData.x86 : registryData.x64;
        const regHive = hive === winreg.HKCU ? regArch.HKCU : regArch.HKLM;
        for (const k of regHive) {
            if (k.key === key) {
                const values: winreg.IRegistryValue[] = [];
                for (const [name, value] of Object.entries(k.values)) {
                    values.push({
                        arch: arch ?? 'x64',
                        hive: hive ?? winreg.HKLM,
                        key: k.key,
                        name,
                        type: winreg.REG_SZ,
                        value: value ?? '',
                    });
                }
                return Promise.resolve(values);
            }
        }
        return Promise.resolve([]);
    }

    function fakeRegistryKeys({ arch, hive, key }: winreg.Options): Promise<winreg.IRegistryKey[]> {
        const regArch = arch === 'x86' ? registryData.x86 : registryData.x64;
        const regHive = hive === winreg.HKCU ? regArch.HKCU : regArch.HKLM;
        for (const k of regHive) {
            if (k.key === key) {
                const keys = k.subKeys.map((s) => ({
                    arch: arch ?? 'x64',
                    hive: hive ?? winreg.HKLM,
                    key: s,
                }));
                return Promise.resolve(keys);
            }
        }
        return Promise.resolve([]);
    }

    async function getDataFromKey(
        { arch, hive, key }: winreg.Options,
        org: string,
    ): Promise<winutils.IRegistryInterpreterData> {
        const data = await fakeRegistryValues({ arch, hive, key });
        const subKey = (await fakeRegistryKeys({ arch, hive, key }))[0];
        const subKeyData = (await fakeRegistryValues({ arch, hive, key: subKey.key })).find(
            (x) => x.name === 'ExecutablePath',
        );

        return Promise.resolve({
            interpreterPath: subKeyData?.value ?? '',
            versionStr: data.find((x) => x.name === 'Version')?.value,
            sysVersionStr: data.find((x) => x.name === 'SysVersion')?.value,
            bitnessStr: data.find((x) => x.name === 'SysArchitecture')?.value,
            displayName: data.find((x) => x.name === 'DisplayName')?.value,
            distroOrgName: org,
        });
    }

    async function createExpectedEnv(data: winutils.IRegistryInterpreterData): Promise<PythonEnvInfo> {
        const versionStr = data.versionStr ?? data.sysVersionStr ?? data.interpreterPath;
        let version: PythonVersion;
        try {
            version = parseVersion(versionStr);
        } catch (ex) {
            version = UNKNOWN_PYTHON_VERSION;
        }

        return buildEnvInfo({
            location: '',
            kind: PythonEnvKind.OtherGlobal,
            executable: data.interpreterPath,
            version,
            arch: data.bitnessStr === '32bit' ? Architecture.x86 : Architecture.x64,
            org: data.distroOrgName ?? '',
            defaultDisplayName: data.displayName,
            source: [PythonEnvSource.WindowsRegistry],
        });
    }

    async function getExpectedDataFromKey({ arch, hive, key }: winreg.Options, org: string): Promise<PythonEnvInfo> {
        return createExpectedEnv(await getDataFromKey({ arch, hive, key }, org));
    }

    setup(async () => {
        stubReadRegistryValues = sinon.stub(winreg, 'readRegistryValues');
        stubReadRegistryKeys = sinon.stub(winreg, 'readRegistryKeys');
        stubReadRegistryValues.callsFake(fakeRegistryValues);
        stubReadRegistryKeys.callsFake(fakeRegistryKeys);

        locator = new WindowsRegistryLocator();
    });

    teardown(() => {
        sinon.restore();
    });

    test('iterEnvs()', async () => {
        const expectedEnvs: PythonEnvInfo[] = (
            await Promise.all([
                getExpectedDataFromKey(
                    { arch: 'x64', hive: winreg.HKLM, key: '\\SOFTWARE\\Python\\PythonCore\\3.9' },
                    'PythonCore',
                ),
                getExpectedDataFromKey(
                    { arch: 'x64', hive: winreg.HKLM, key: '\\SOFTWARE\\Python\\ContinuumAnalytics\\Anaconda38-64' },
                    'ContinuumAnalytics',
                ),
                getExpectedDataFromKey(
                    { arch: 'x64', hive: winreg.HKCU, key: '\\SOFTWARE\\Python\\PythonCore\\3.7' },
                    'PythonCore',
                ),
                getExpectedDataFromKey(
                    { arch: 'x86', hive: winreg.HKCU, key: '\\SOFTWARE\\Python\\PythonCodingPack\\3.8' },
                    'PythonCodingPack',
                ),
            ])
        ).sort((a, b) => a.executable.filename.localeCompare(b.executable.filename));

        const iterator = locator.iterEnvs();
        const actualEnvs = (await getEnvs(iterator)).sort((a, b) =>
            a.executable.filename.localeCompare(b.executable.filename),
        );

        assertEnvsEqual(actualEnvs, expectedEnvs);
    });

    test('iterEnvs(): no registry permission', async () => {
        stubReadRegistryKeys.callsFake(() => {
            throw Error();
        });

        const iterator = locator.iterEnvs();
        const actualEnvs = (await getEnvs(iterator)).sort((a, b) =>
            a.executable.filename.localeCompare(b.executable.filename),
        );

        assert.deepStrictEqual(actualEnvs, []);
    });

    test('iterEnvs(): partial registry permission', async () => {
        stubReadRegistryKeys.callsFake(({ arch, hive, key }: winreg.Options) => {
            if (hive === winreg.HKLM) {
                throw Error();
            }
            return fakeRegistryKeys({ arch, hive, key });
        });

        const expectedEnvs: PythonEnvInfo[] = (
            await Promise.all([
                getExpectedDataFromKey(
                    { arch: 'x64', hive: winreg.HKCU, key: '\\SOFTWARE\\Python\\PythonCore\\3.7' },
                    'PythonCore',
                ),
                getExpectedDataFromKey(
                    { arch: 'x86', hive: winreg.HKCU, key: '\\SOFTWARE\\Python\\PythonCodingPack\\3.8' },
                    'PythonCodingPack',
                ),
            ])
        ).sort((a, b) => a.executable.filename.localeCompare(b.executable.filename));

        const iterator = locator.iterEnvs();
        const actualEnvs = (await getEnvs(iterator)).sort((a, b) =>
            a.executable.filename.localeCompare(b.executable.filename),
        );

        assertEnvsEqual(actualEnvs, expectedEnvs);
    });

    test('resolveEnv(string)', async () => {
        const expected: PythonEnvInfo = await getExpectedDataFromKey(
            { arch: 'x64', hive: winreg.HKLM, key: '\\SOFTWARE\\Python\\PythonCore\\3.9' },
            'PythonCore',
        );
        const interpreterPath = path.join(regTestRoot, 'py39', 'python.exe');

        const actual = await locator.resolveEnv(interpreterPath);

        assertEnvEqual(actual, expected);
    });

    test('resolveEnv(PythonEnvInfo)', async () => {
        const expected: PythonEnvInfo = await getExpectedDataFromKey(
            { arch: 'x64', hive: winreg.HKLM, key: '\\SOFTWARE\\Python\\PythonCore\\3.9' },
            'PythonCore',
        );
        const interpreterPath = path.join(regTestRoot, 'py39', 'python.exe');

        // Partially filled in env info object
        const input: PythonEnvInfo = {
            name: '',
            location: '',
            kind: PythonEnvKind.Unknown,
            distro: { org: '' },
            arch: Architecture.x64,
            executable: {
                filename: interpreterPath,
                sysPrefix: '',
                ctime: -1,
                mtime: -1,
            },
            version: {
                major: -1,
                minor: -1,
                micro: -1,
                release: { level: PythonReleaseLevel.Final, serial: -1 },
            },
            source: [],
        };

        const actual = await locator.resolveEnv(input);

        assertEnvEqual(actual, expected);
    });

    test('resolveEnv(string): unknown interpreter', async () => {
        const interpreterPath = path.join(regTestRoot, 'unknown_python.exe');

        const actual = await locator.resolveEnv(interpreterPath);

        assert.deepStrictEqual(actual, undefined);
    });
});
