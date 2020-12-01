// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as fs from 'fs-extra';
import * as path from 'path';
import { traceWarning } from '../../../../client/common/logger';
import { FileChangeType } from '../../../../client/common/platform/fileSystemWatcher';
import { createDeferred, Deferred, sleep } from '../../../../client/common/utils/async';
import { getOSType, OSType } from '../../../../client/common/utils/platform';
import { IDisposable } from '../../../../client/common/utils/resourceLifecycle';
import { PythonEnvKind } from '../../../../client/pythonEnvironments/base/info';
import { ILocator } from '../../../../client/pythonEnvironments/base/locator';
import { getEnvs } from '../../../../client/pythonEnvironments/base/locatorUtils';
import { PythonEnvsChangedEvent } from '../../../../client/pythonEnvironments/base/watcher';
import { getInterpreterPathFromDir } from '../../../../client/pythonEnvironments/common/commonUtils';
import { arePathsSame } from '../../../../client/pythonEnvironments/common/externalDependencies';
import { deleteFiles, PYTHON_PATH } from '../../../common';
import { TEST_TIMEOUT } from '../../../constants';
import { run } from './envTestUtils';

/**
 * A utility class used to create, delete, or modify environments. Primarily used for watcher
 * tests, where we need to create environments.
 */
class Venvs {
    constructor(private readonly root: string, private readonly prefix = '.virtualenv-') {}

    public async create(name: string): Promise<string> {
        const envName = this.resolve(name);
        const argv = [PYTHON_PATH.fileToCommandArgument(), '-m', 'virtualenv', envName];
        try {
            await run(argv, { cwd: this.root });
        } catch (err) {
            throw new Error(`Failed to create Env ${path.basename(envName)} Error: ${err}`);
        }
        const dirToLookInto = path.join(this.root, envName);
        const filename = await getInterpreterPathFromDir(dirToLookInto);
        if (!filename) {
            throw new Error(`No environment to update exists in ${dirToLookInto}`);
        }
        return filename;
    }

    /**
     * Creates a dummy environment by creating a fake executable.
     * @param name environment suffix name to create
     */
    public async createDummyEnv(name: string): Promise<string> {
        const envName = this.resolve(name);
        const filepath = path.join(this.root, envName, getOSType() === OSType.Windows ? 'python.exe' : 'python');
        try {
            await fs.createFile(filepath);
        } catch (err) {
            throw new Error(`Failed to create python executable ${filepath}, Error: ${err}`);
        }
        return filepath;
    }

    // eslint-disable-next-line class-methods-use-this
    public async update(filename: string): Promise<void> {
        try {
            await fs.writeFile(filename, 'Environment has been updated');
        } catch (err) {
            throw new Error(`Failed to update Workspace virtualenv executable ${filename}, Error: ${err}`);
        }
    }

    // eslint-disable-next-line class-methods-use-this
    public async delete(filename: string): Promise<void> {
        try {
            await fs.remove(filename);
        } catch (err) {
            traceWarning(`Failed to clean up ${filename}`);
        }
    }

    public async cleanUp(): Promise<void> {
        const globPattern = path.join(this.root, `${this.prefix}*`);
        await deleteFiles(globPattern);
    }

    private resolve(name: string): string {
        // Ensure env is random to avoid conflicts in tests (corrupting test data)
        const now = new Date().getTime().toString().substr(-8);
        return `${this.prefix}${name}${now}`;
    }
}

type locatorFactoryFuncType1 = () => Promise<ILocator & IDisposable>;
// tslint:disable:no-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type locatorFactoryFuncType2 = (_: any) => Promise<ILocator & IDisposable>;
// tslint:enable:no-any
export type locatorFactoryFuncType = locatorFactoryFuncType1 & locatorFactoryFuncType2;

/**
 * Test if we're able to:
 * * Detect a new environment
 * * Detect when an environment has been deleted
 * * Detect when an environment has been updated
 * @param root The root folder where we create, delete, or modify environments.
 * @param createLocatorFactoryFunc The factory function used to create the locator.
 */
export function testLocatorWatcher(
    root: string,
    createLocatorFactoryFunc: locatorFactoryFuncType,
    options?: {
        /**
         * Argument to the locator factory function if any.
         */
        arg?: string;
        /**
         * Environment kind to check for in watcher events.
         * If not specified the check is skipped is default. This is because detecting kind of virtual env
         * often depends on the file structure around the executable, so we need to wait before attempting
         * to verify it. Omitting that check in those cases as we can never deterministically say when it's
         * ready to check.
         */
        kind?: PythonEnvKind
    },
): void {
    let locator: ILocator & IDisposable;
    const venvs = new Venvs(root);

    async function waitForChangeToBeDetected(deferred: Deferred<void>) {
        const timeout = setTimeout(() => {
            clearTimeout(timeout);
            deferred.reject(new Error('Environment not detected'));
        }, TEST_TIMEOUT);
        await deferred.promise;
    }

    async function isLocated(executable: string): Promise<boolean> {
        const items = await getEnvs(locator.iterEnvs());
        return items.some((item) => arePathsSame(item.executable.filename, executable));
    }

    suiteSetup(() => venvs.cleanUp());

    async function setupLocator(onChanged: (e: PythonEnvsChangedEvent) => Promise<void>) {
        locator = options?.arg ? await createLocatorFactoryFunc(options.arg) : await createLocatorFactoryFunc();
        await getEnvs(locator.iterEnvs()); // Force the FS watcher to start.
        // Wait for watchers to get ready
        await sleep(1000);
        locator.onChanged(onChanged);
    }

    teardown(async () => {
        await venvs.cleanUp();
        locator.dispose();
    });

    test('Detect a new environment', async () => {
        let actualEvent: PythonEnvsChangedEvent;
        const deferred = createDeferred<void>();
        await setupLocator(async (e) => {
            actualEvent = e;
            deferred.resolve();
        });

        const executable = await venvs.create('one');
        await waitForChangeToBeDetected(deferred);
        const isFound = await isLocated(executable);

        assert.ok(isFound);
        assert.equal(actualEvent!.type, FileChangeType.Created, 'Wrong event emitted');
        if (options?.kind) {
            assert.equal(actualEvent!.kind, options.kind, 'Wrong event emitted');
        }
    });

    test('Detect when an environment has been deleted', async () => {
        let actualEvent: PythonEnvsChangedEvent;
        const deferred = createDeferred<void>();
        const executable = await venvs.create('one');
        await setupLocator(async (e) => {
            if (e.type === FileChangeType.Deleted) {
                actualEvent = e;
                deferred.resolve();
            }
        });

        // VSCode API has a limitation where it fails to fire event when environment folder is deleted directly:
        // https://github.com/microsoft/vscode/issues/110923
        // Using chokidar directly in tests work, but it has permission issues on Windows that you cannot delete a
        // folder if it has a subfolder that is being watched inside: https://github.com/paulmillr/chokidar/issues/422
        // Hence we test directly deleting the executable, and not the whole folder using `workspaceVenvs.cleanUp()`.
        await venvs.delete(executable);
        await waitForChangeToBeDetected(deferred);
        const isFound = await isLocated(executable);

        assert.notOk(isFound);
        assert.notEqual(actualEvent!, undefined, 'Wrong event emitted');
        if (options?.kind) {
            assert.equal(actualEvent!.kind, options.kind, 'Wrong event emitted');
        }
    });

    test('Detect when an environment has been updated', async () => {
        let actualEvent: PythonEnvsChangedEvent;
        const deferred = createDeferred<void>();
        // Create a dummy environment so we can update its executable later. We can't choose a real environment here.
        // Executables inside real environments can be symlinks, so writing on them can result in the real executable
        // being updated instead of the symlink.
        const executable = await venvs.createDummyEnv('one');
        await setupLocator(async (e) => {
            if (e.type === FileChangeType.Changed) {
                actualEvent = e;
                deferred.resolve();
            }
        });

        await venvs.update(executable);
        await waitForChangeToBeDetected(deferred);
        const isFound = await isLocated(executable);

        assert.ok(isFound);
        assert.notEqual(actualEvent!, undefined, 'Wrong event emitted');
        if (options?.kind) {
            assert.equal(actualEvent!.kind, options.kind, 'Wrong event emitted');
        }
    });
}
