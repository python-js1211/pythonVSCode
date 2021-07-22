// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import { Event, EventEmitter, Uri } from 'vscode';
import { createDeferred } from '../../../../../client/common/utils/async';
import { IDisposable } from '../../../../../client/common/utils/resourceLifecycle';
import { PythonEnvInfo, PythonEnvKind } from '../../../../../client/pythonEnvironments/base/info';
import { WatchRootsArgs, WorkspaceLocators } from '../../../../../client/pythonEnvironments/base/locators/';
import { PythonEnvsChangedEvent } from '../../../../../client/pythonEnvironments/base/watcher';
import { assertSameEnvs, createLocatedEnv, createNamedEnv, getEnvs, SimpleLocator } from '../../common';

class WorkspaceFolders {
    public added = new EventEmitter<Uri>();

    public removed = new EventEmitter<Uri>();

    public readonly roots: Uri[];

    constructor(roots: (Uri | string)[]) {
        this.roots = roots.map((r) => (typeof r === 'string' ? Uri.file(r) : r));
    }

    public get onAdded(): Event<Uri> {
        return this.added.event;
    }

    public get onRemoved(): Event<Uri> {
        return this.removed.event;
    }

    public watchRoots(args: WatchRootsArgs): IDisposable {
        const { initRoot, addRoot, removeRoot } = args;

        this.roots.forEach(initRoot);
        this.onAdded(addRoot);
        this.onRemoved(removeRoot);

        return {
            dispose: () => undefined,
        };
    }

    public getRootsWatcher(): (args: WatchRootsArgs) => IDisposable {
        return (args) => this.watchRoots(args);
    }
}

async function ensureActivated(locators: WorkspaceLocators): Promise<void> {
    await getEnvs(locators.iterEnvs());
}

suite('WorkspaceLocators', () => {
    suite('onChanged', () => {
        test('no roots', async () => {
            const expected: PythonEnvsChangedEvent[] = [];
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const loc1 = new SimpleLocator([env1]);
            const folders = new WorkspaceFolders([]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [() => [loc1]]);
            await ensureActivated(locators);
            const events: PythonEnvsChangedEvent[] = [];
            locators.onChanged((e) => events.push(e));
            const event1: PythonEnvsChangedEvent = { kind: PythonEnvKind.Unknown };

            loc1.fire(event1);

            expect(events).to.deep.equal(expected);
        });

        test('no factories', async () => {
            const expected: PythonEnvsChangedEvent[] = [];
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const loc1 = new SimpleLocator([env1]);
            const folders = new WorkspaceFolders(['foo', 'bar']);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), []);
            await ensureActivated(locators);
            const events: PythonEnvsChangedEvent[] = [];
            locators.onChanged((e) => events.push(e));
            const event1: PythonEnvsChangedEvent = { kind: PythonEnvKind.Unknown };

            loc1.fire(event1);

            expect(events).to.deep.equal(expected);
        });

        test('consolidates events across roots', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const expected: PythonEnvsChangedEvent[] = [
                { searchLocation: root1, kind: PythonEnvKind.Unknown },
                { searchLocation: root2, kind: PythonEnvKind.Venv },
                { searchLocation: root1 },
                { searchLocation: root2, kind: PythonEnvKind.Venv },
                { searchLocation: root2, kind: PythonEnvKind.Pipenv },
                { searchLocation: root1, kind: PythonEnvKind.Conda },
            ];
            const event1: PythonEnvsChangedEvent = { kind: PythonEnvKind.Unknown };
            const event2: PythonEnvsChangedEvent = { kind: PythonEnvKind.Venv };
            const event3: PythonEnvsChangedEvent = {};
            const event4: PythonEnvsChangedEvent = { kind: PythonEnvKind.Venv };
            const event5: PythonEnvsChangedEvent = { kind: PythonEnvKind.Pipenv };
            const event6: PythonEnvsChangedEvent = { kind: PythonEnvKind.Conda };
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const loc1 = new SimpleLocator([env1]);
            const loc2 = new SimpleLocator([]);
            const loc3 = new SimpleLocator([]);
            const loc4 = new SimpleLocator([]);
            const loc5 = new SimpleLocator([]);
            const loc6 = new SimpleLocator([]);
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc2]),
                (r) => (r === root1 ? [loc3] : [loc4, loc5]),
                (r) => (r === root1 ? [loc6] : []),
            ]);
            await ensureActivated(locators);
            const events: PythonEnvsChangedEvent[] = [];
            locators.onChanged((e) => events.push(e));

            loc1.fire(event1);
            loc2.fire(event2);
            loc3.fire(event3);
            loc4.fire(event4);
            loc5.fire(event5);
            loc6.fire(event6);

            expect(events).to.deep.equal(expected);
        });

        test('does not identify roots during init', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            // Force r._formatted to be set.
            [root1, root2].forEach((r) => r.toString());
            const folders = new WorkspaceFolders(['foo', 'bar']);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), []);
            const events: PythonEnvsChangedEvent[] = [];
            locators.onChanged((e) => events.push(e));

            await ensureActivated(locators);

            expect(events).to.deep.equal([]);
        });

        test('identifies added roots', async () => {
            const added = Uri.file('baz');
            const expected: PythonEnvsChangedEvent[] = [{ searchLocation: added }];
            const folders = new WorkspaceFolders(['foo', 'bar']);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), []);
            await ensureActivated(locators);
            const events: PythonEnvsChangedEvent[] = [];
            locators.onChanged((e) => events.push(e));

            folders.added.fire(added);

            expect(events).to.deep.equal(expected);
        });

        test('identifies removed roots', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            // Force r._formatted to be set.
            [root1, root2].forEach((r) => r.toString());
            const expected: PythonEnvsChangedEvent[] = [{ searchLocation: root2 }];
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), []);
            await ensureActivated(locators);
            const events: PythonEnvsChangedEvent[] = [];
            locators.onChanged((e) => events.push(e));

            folders.removed.fire(root2);

            expect(events).to.deep.equal(expected);
        });

        test('does not emit events from removed roots', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const expected: PythonEnvsChangedEvent[] = [
                { searchLocation: root1, kind: PythonEnvKind.Unknown },
                { searchLocation: root2, kind: PythonEnvKind.Venv },
                { searchLocation: root2 }, // removed
                { searchLocation: root1 },
            ];
            const event1: PythonEnvsChangedEvent = { kind: PythonEnvKind.Unknown };
            const event2: PythonEnvsChangedEvent = { kind: PythonEnvKind.Venv };
            const event3: PythonEnvsChangedEvent = {};
            const event4: PythonEnvsChangedEvent = { kind: PythonEnvKind.Venv };
            const loc1 = new SimpleLocator([]);
            const loc2 = new SimpleLocator([]);
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [(r) => (r === root1 ? [loc1] : [loc2])]);
            await ensureActivated(locators);
            const events: PythonEnvsChangedEvent[] = [];
            locators.onChanged((e) => events.push(e));

            loc1.fire(event1);
            loc2.fire(event2);
            folders.removed.fire(root2);
            loc1.fire(event3);
            loc2.fire(event4); // This one is ignored.

            expect(events).to.deep.equal(expected);
        });
    });

    suite('iterEnvs()', () => {
        test('no roots', async () => {
            const expected: PythonEnvInfo[] = [];
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const loc1 = new SimpleLocator([env1]);
            const folders = new WorkspaceFolders([]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [() => [loc1]]);
            await ensureActivated(locators);

            const iterators = locators.iterEnvs();
            const envs = await getEnvs(iterators);

            expect(envs).to.deep.equal(expected);
        });

        test('no factories', async () => {
            const expected: PythonEnvInfo[] = [];
            const folders = new WorkspaceFolders(['foo', 'bar']);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), []);
            await ensureActivated(locators);

            const iterators = locators.iterEnvs();
            const envs = await getEnvs(iterators);

            expect(envs).to.deep.equal(expected);
        });

        test('one empty', async () => {
            const root1 = Uri.file('foo');
            const expected: PythonEnvInfo[] = [];
            const loc1 = new SimpleLocator([]);
            const folders = new WorkspaceFolders([root1]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [() => [loc1]]);
            await ensureActivated(locators);

            const iterators = locators.iterEnvs();
            const envs = await getEnvs(iterators);

            expect(envs).to.deep.equal(expected);
        });

        test('one not empty', async () => {
            const root1 = Uri.file('foo');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const expected: PythonEnvInfo[] = [env1];
            const loc1 = new SimpleLocator([env1]);
            const folders = new WorkspaceFolders([root1]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [() => [loc1]]);
            await ensureActivated(locators);

            const iterators = locators.iterEnvs();
            const envs = await getEnvs(iterators);

            assertSameEnvs(envs, expected);
        });

        test('empty locator ignored', async () => {
            const root1 = Uri.file('foo');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const expected: PythonEnvInfo[] = [env1, env2];
            const loc1 = new SimpleLocator([env1]);
            const loc2 = new SimpleLocator([], { before: loc1.done });
            const loc3 = new SimpleLocator([env2], { before: loc2.done });
            const folders = new WorkspaceFolders([root1]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [() => [loc1, loc2, loc3]]);
            await ensureActivated(locators);

            const iterators = locators.iterEnvs();
            const envs = await getEnvs(iterators);

            assertSameEnvs(envs, expected);
        });

        test('consolidates envs across roots', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createLocatedEnv('foo/some-dir', '3.8.1', PythonEnvKind.Conda);
            const env3 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env4 = createNamedEnv('42', '3.9.0rc2', PythonEnvKind.Pyenv);
            const env5 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env6 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const env7 = createNamedEnv('eggs', '3.9.1a0', PythonEnvKind.Venv);
            const env8 = createNamedEnv('foo', '3.5.12b1', PythonEnvKind.Venv);
            const expected: PythonEnvInfo[] = [env1, env2, env3, env4, env5, env6, env7, env8];
            const loc1 = new SimpleLocator([env1, env2]);
            const loc2 = new SimpleLocator([env3, env4], { before: loc1.done });
            const loc3 = new SimpleLocator([env5, env6], { before: loc2.done });
            const loc4 = new SimpleLocator([env7, env8], { before: loc3.done });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);

            const iterators = locators.iterEnvs();
            const envs = await getEnvs(iterators);

            assertSameEnvs(envs, expected);
        });

        test('query matches a root', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env3 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env4 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const expected: PythonEnvInfo[] = [env1, env2];
            const loc1 = new SimpleLocator([env1]);
            const loc2 = new SimpleLocator([env2], { before: loc1.done });
            const loc3 = new SimpleLocator([env3], { before: loc2.done });
            const loc4 = new SimpleLocator([env4], { before: loc3.done });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);
            const query = { searchLocations: { roots: [root1] } };

            const iterators = locators.iterEnvs(query);
            const envs = await getEnvs(iterators);

            assertSameEnvs(envs, expected);
        });

        test('query matches all roots', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env3 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env4 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const expected: PythonEnvInfo[] = [env1, env2, env3, env4];
            const loc1 = new SimpleLocator([env1]);
            const loc2 = new SimpleLocator([env2], { before: loc1.done });
            const loc3 = new SimpleLocator([env3], { before: loc2.done });
            const loc4 = new SimpleLocator([env4], { before: loc3.done });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);
            const query = { searchLocations: { roots: [root1, root2] } };

            const iterators = locators.iterEnvs(query);
            const envs = await getEnvs(iterators);

            assertSameEnvs(envs, expected);
        });

        test('query does not match a root', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env3 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env4 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const loc1 = new SimpleLocator([env1]);
            const loc2 = new SimpleLocator([env2], { before: loc1.done });
            const loc3 = new SimpleLocator([env3], { before: loc2.done });
            const loc4 = new SimpleLocator([env4], { before: loc3.done });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);
            const query = { searchLocations: { roots: [Uri.file('baz')] } };

            const iterators = locators.iterEnvs(query);
            const envs = await getEnvs(iterators);

            expect(envs).to.deep.equal([]);
        });

        test('query has no searchLocation', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env3 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env4 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const expected: PythonEnvInfo[] = [env1, env2, env3, env4];
            const loc1 = new SimpleLocator([env1]);
            const loc2 = new SimpleLocator([env2], { before: loc1.done });
            const loc3 = new SimpleLocator([env3], { before: loc2.done });
            const loc4 = new SimpleLocator([env4], { before: loc3.done });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);

            const iterators = locators.iterEnvs({ kinds: [PythonEnvKind.Unknown] });
            const envs = await getEnvs(iterators);

            assertSameEnvs(envs, expected);
        });

        test('iterate out of order', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createLocatedEnv('foo/some-dir', '3.8.1', PythonEnvKind.Conda);
            const env3 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env4 = createNamedEnv('42', '3.9.0rc2', PythonEnvKind.Pyenv);
            const env5 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env6 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const env7 = createNamedEnv('eggs', '3.9.1a0', PythonEnvKind.Venv);
            const env8 = createNamedEnv('foo', '3.5.12b1', PythonEnvKind.Venv);
            const expected: PythonEnvInfo[] = [env5, env6, env1, env2, env3, env4, env7, env8];
            const loc3 = new SimpleLocator([env5, env6]);
            const loc1 = new SimpleLocator([env1, env2], { before: loc3.done });
            const loc2 = new SimpleLocator([env3, env4], { before: loc1.done });
            const loc4 = new SimpleLocator([env7, env8], { before: loc2.done });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);

            const iterators = locators.iterEnvs();
            const envs = await getEnvs(iterators);

            assertSameEnvs(envs, expected);
        });

        test('iterate intermingled', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo-x', '3.8.1', PythonEnvKind.Venv);
            const env2 = createLocatedEnv('foo/some-dir', '3.8.1', PythonEnvKind.Conda);
            const env3 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env4 = createNamedEnv('42', '3.9.0rc2', PythonEnvKind.Pyenv);
            const env5 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env6 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const env7 = createNamedEnv('eggs', '3.9.1a0', PythonEnvKind.Venv);
            const env8 = createNamedEnv('foo-y', '3.5.12b1', PythonEnvKind.Venv);
            const expected = [env3, env6, env1, env2, env8, env4, env5, env7];
            const ordered = [env1, env2, env3, env4, env5, env6, env7, env8];
            const deferreds = [
                createDeferred<void>(),
                createDeferred<void>(),
                createDeferred<void>(),
                createDeferred<void>(),
                createDeferred<void>(),
                createDeferred<void>(),
                createDeferred<void>(),
                createDeferred<void>(),
            ];
            async function beforeEach(env: PythonEnvInfo) {
                const index = expected.indexOf(env);
                if (index === 0) {
                    return;
                }
                const blockedBy = ordered.indexOf(expected[index - 1]);
                await deferreds[blockedBy].promise;
            }
            async function afterEach(env: PythonEnvInfo) {
                const index = ordered.indexOf(env);
                deferreds[index].resolve();
            }
            const loc1 = new SimpleLocator([env1, env2], { beforeEach, afterEach });
            const loc2 = new SimpleLocator([env3, env4], { beforeEach, afterEach });
            const loc3 = new SimpleLocator([env5, env6], { beforeEach, afterEach });
            const loc4 = new SimpleLocator([env7, env8], { beforeEach, afterEach });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);

            const iterator = locators.iterEnvs();
            const envs = await getEnvs(iterator);

            assertSameEnvs(envs, expected);
        });

        test('respects roots set during init', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createLocatedEnv('foo/some-dir', '3.8.1', PythonEnvKind.Conda);
            const env3 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env4 = createNamedEnv('42', '3.9.0rc2', PythonEnvKind.Pyenv);
            const env5 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env6 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const env7 = createNamedEnv('eggs', '3.9.1a0', PythonEnvKind.Venv);
            const env8 = createNamedEnv('foo', '3.5.12b1', PythonEnvKind.Venv);
            const expected: PythonEnvInfo[] = [env1, env2, env3, env4, env5, env6, env7, env8];
            const loc1 = new SimpleLocator([env1, env2]);
            const loc2 = new SimpleLocator([env3, env4], { before: loc1.done });
            const loc3 = new SimpleLocator([env5, env6], { before: loc2.done });
            const loc4 = new SimpleLocator([env7, env8], { before: loc3.done });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);

            const iterator = locators.iterEnvs();
            const envs = await getEnvs(iterator);

            assertSameEnvs(envs, expected);
        });

        test('respects added roots', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createLocatedEnv('foo/some-dir', '3.8.1', PythonEnvKind.Conda);
            const env3 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env4 = createNamedEnv('42', '3.9.0rc2', PythonEnvKind.Pyenv);
            const env5 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env6 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const env7 = createNamedEnv('eggs', '3.9.1a0', PythonEnvKind.Venv);
            const env8 = createNamedEnv('foo', '3.5.12b1', PythonEnvKind.Venv);
            const expected: PythonEnvInfo[] = [env1, env2, env3, env4, env5, env6, env7, env8];
            const loc1 = new SimpleLocator([env1, env2]);
            const loc2 = new SimpleLocator([env3, env4], { before: loc1.done });
            const loc3 = new SimpleLocator([env5, env6], { before: loc2.done });
            const loc4 = new SimpleLocator([env7, env8], { before: loc3.done });
            const folders = new WorkspaceFolders([]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);

            const iteratorBefore = locators.iterEnvs();
            const envsBefore = await getEnvs(iteratorBefore);
            folders.added.fire(root1);
            folders.added.fire(root2);
            const iteratorAfter = locators.iterEnvs();
            const envsAfter = await getEnvs(iteratorAfter);

            expect(envsBefore).to.deep.equal([]);
            expect(envsAfter).to.deep.equal(expected);
        });

        test('ignores removed roots', async () => {
            const root1 = Uri.file('foo');
            const root2 = Uri.file('bar');
            const env1 = createNamedEnv('foo', '3.8.1', PythonEnvKind.Venv);
            const env2 = createLocatedEnv('foo/some-dir', '3.8.1', PythonEnvKind.Conda);
            const env3 = createNamedEnv('python2', '2.7', PythonEnvKind.Pipenv);
            const env4 = createNamedEnv('42', '3.9.0rc2', PythonEnvKind.Pyenv);
            const env5 = createNamedEnv('hello world', '3.8', PythonEnvKind.VirtualEnv);
            const env6 = createNamedEnv('spam', '3.10.0a0', PythonEnvKind.OtherVirtual);
            const env7 = createNamedEnv('eggs', '3.9.1a0', PythonEnvKind.Venv);
            const env8 = createNamedEnv('foo', '3.5.12b1', PythonEnvKind.Venv);
            const expectedBefore = [env1, env2, env3, env4, env5, env6, env7, env8];
            const expectedAfter = [env1, env2, env3, env4];
            const loc1 = new SimpleLocator([env1, env2]);
            const loc2 = new SimpleLocator([env3, env4], { before: loc1.done });
            const loc3 = new SimpleLocator([env5, env6], { before: loc2.done });
            const loc4 = new SimpleLocator([env7, env8], { before: loc3.done });
            const folders = new WorkspaceFolders([root1, root2]);
            const locators = new WorkspaceLocators(folders.getRootsWatcher(), [
                (r) => (r === root1 ? [loc1] : [loc3]),
                (r) => (r === root1 ? [loc2] : [loc4]),
            ]);
            await ensureActivated(locators);

            const iteratorBefore = locators.iterEnvs();
            const envsBefore = await getEnvs(iteratorBefore);
            folders.removed.fire(root2);
            const iteratorAfter = locators.iterEnvs();
            const envsAfter = await getEnvs(iteratorAfter);

            assertSameEnvs(envsBefore, expectedBefore);
            assertSameEnvs(envsAfter, expectedAfter);
        });
    });
});
