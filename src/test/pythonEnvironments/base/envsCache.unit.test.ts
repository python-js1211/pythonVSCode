// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as assert from 'assert';
import * as sinon from 'sinon';
import { PythonEnvInfoCache } from '../../../client/pythonEnvironments/base/envsCache';
import { PythonEnvInfo, PythonEnvKind } from '../../../client/pythonEnvironments/base/info';
import * as externalDependencies from '../../../client/pythonEnvironments/common/externalDependencies';

suite('Environment Info cache', () => {
    let getGlobalPersistentStoreStub: sinon.SinonStub;
    let updatedValues: PythonEnvInfo[] | undefined;

    const allEnvsComplete = () => true;
    const envInfoArray = [
        {
            kind: PythonEnvKind.Conda, executable: { filename: 'my-conda-env' },
        },
        {
            kind: PythonEnvKind.Venv, executable: { filename: 'my-venv-env' },
        },
        {
            kind: PythonEnvKind.Pyenv, executable: { filename: 'my-pyenv-env' },
        },
    ] as PythonEnvInfo[];

    setup(() => {
        getGlobalPersistentStoreStub = sinon.stub(externalDependencies, 'getGlobalPersistentStore');
        getGlobalPersistentStoreStub.returns({
            get() { return envInfoArray; },
            set(envs: PythonEnvInfo[]) {
                updatedValues = envs;
                return Promise.resolve();
            },
        });
    });

    teardown(() => {
        getGlobalPersistentStoreStub.restore();
        updatedValues = undefined;
    });

    test('`initialize` reads from persistent storage', () => {
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        envsCache.initialize();

        assert.ok(getGlobalPersistentStoreStub.calledOnce);
    });

    test('The in-memory env info array is undefined if there is no value in persistent storage when initializing the cache', () => {
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        getGlobalPersistentStoreStub.returns({ get() { return undefined; } });
        envsCache.initialize();
        const result = envsCache.getAllEnvs();

        assert.strictEqual(result, undefined);
    });

    test('`getAllEnvs` should return a deep copy of the environments currently in memory', () => {
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        envsCache.initialize();
        const envs = envsCache.getAllEnvs()!;

        envs[0].name = 'some-other-name';

        assert.ok(envs[0] !== envInfoArray[0]);
    });

    test('`getAllEnvs` should return undefined if nothing has been set', () => {
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        const envs = envsCache.getAllEnvs();

        assert.deepStrictEqual(envs, undefined);
    });

    test('`setAllEnvs` should clone the environment info array passed as a parameter', () => {
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        envsCache.setAllEnvs(envInfoArray);
        const envs = envsCache.getAllEnvs();

        assert.deepStrictEqual(envs, envInfoArray);
        assert.strictEqual(envs === envInfoArray, false);
    });

    test('`filterEnvs` should return environments that match its argument using areSameEnvironmnet', () => {
        const env:PythonEnvInfo = { executable: { filename: 'my-venv-env' } } as unknown as PythonEnvInfo;
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        envsCache.initialize();

        const result = envsCache.filterEnvs(env);

        assert.deepStrictEqual(result, [{
            kind: PythonEnvKind.Venv, executable: { filename: 'my-venv-env' },
        }]);
    });

    test('`filterEnvs` should return a deep copy of the matched environments', () => {
        const envToFind = {
            kind: PythonEnvKind.System, executable: { filename: 'my-system-env' },
        } as unknown as PythonEnvInfo;
        const env:PythonEnvInfo = { executable: { filename: 'my-system-env' } } as unknown as PythonEnvInfo;
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        envsCache.setAllEnvs([...envInfoArray, envToFind]);

        const result = envsCache.filterEnvs(env)!;
        result[0].name = 'some-other-name';

        assert.notDeepStrictEqual(result[0], envToFind);
    });

    test('`filterEnvs` should return an empty array if no environment matches the properties of its argument', () => {
        const env:PythonEnvInfo = { executable: { filename: 'my-nonexistent-env' } } as unknown as PythonEnvInfo;
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        envsCache.initialize();

        const result = envsCache.filterEnvs(env);

        assert.deepStrictEqual(result, []);
    });

    test('`filterEnvs` should return undefined if the cache hasn\'t been initialized', () => {
        const env:PythonEnvInfo = { executable: { filename: 'my-nonexistent-env' } } as unknown as PythonEnvInfo;
        const envsCache = new PythonEnvInfoCache(allEnvsComplete);

        const result = envsCache.filterEnvs(env);

        assert.strictEqual(result, undefined);
    });

    test('`flush` should write complete environment info objects to persistent storage', async () => {
        const otherEnv = {
            kind: PythonEnvKind.OtherGlobal,
            executable: { filename: 'my-other-env' },
            defaultDisplayName: 'other-env',
        };
        const updatedEnvInfoArray = [
            otherEnv, { kind: PythonEnvKind.System, executable: { filename: 'my-system-env' } },
        ] as PythonEnvInfo[];
        const expected = [
            otherEnv,
        ];
        const envsCache = new PythonEnvInfoCache((env) => env.defaultDisplayName !== undefined);

        envsCache.initialize();
        envsCache.setAllEnvs(updatedEnvInfoArray);
        await envsCache.flush();

        assert.deepStrictEqual(updatedValues, expected);
    });

    test('`flush` should not write to persistent storage if there are no environment info objects in-memory', async () => {
        const envsCache = new PythonEnvInfoCache((env) => env.kind === PythonEnvKind.MacDefault);

        await envsCache.flush();

        assert.strictEqual(updatedValues, undefined);
    });

    test('`flush` should not write to persistent storage if there are no complete environment info objects', async () => {
        const envsCache = new PythonEnvInfoCache((env) => env.kind === PythonEnvKind.MacDefault);

        envsCache.initialize();
        await envsCache.flush();

        assert.strictEqual(updatedValues, undefined);
    });
});
