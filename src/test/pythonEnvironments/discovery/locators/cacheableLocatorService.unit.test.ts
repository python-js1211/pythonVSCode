/* eslint-disable max-classes-per-file */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import * as md5 from 'md5';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Disposable, Uri, WorkspaceFolder } from 'vscode';
import { IWorkspaceService } from '../../../../client/common/application/types';
import { WorkspaceService } from '../../../../client/common/application/workspace';
import { Resource } from '../../../../client/common/types';
import { noop } from '../../../../client/common/utils/misc';
import { IInterpreterWatcher } from '../../../../client/interpreter/contracts';
import { ServiceContainer } from '../../../../client/ioc/container';
import { IServiceContainer } from '../../../../client/ioc/types';
import { CacheableLocatorService } from '../../../../client/pythonEnvironments/discovery/locators/services/cacheableLocatorService';
import { PythonEnvironment } from '../../../../client/pythonEnvironments/info';

suite('Interpreters - Cacheable Locator Service', () => {
    suite('Caching', () => {
        class Locator extends CacheableLocatorService {
            constructor(name: string, serviceCcontainer: IServiceContainer, private readonly mockLocator: MockLocator) {
                super(name, serviceCcontainer);
            }

            public dispose() {
                noop();
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            protected async getInterpretersImplementation(_resource?: Uri): Promise<PythonEnvironment[]> {
                return this.mockLocator.getInterpretersImplementation();
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            protected getCachedInterpreters(_resource?: Uri): PythonEnvironment[] | undefined {
                return this.mockLocator.getCachedInterpreters();
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            protected async cacheInterpreters(_interpreters: PythonEnvironment[], _resource?: Uri) {
                return this.mockLocator.cacheInterpreters();
            }

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            protected getCacheKey(_resource?: Uri) {
                return this.mockLocator.getCacheKey();
            }
        }
        class MockLocator {
            // eslint-disable-next-line class-methods-use-this
            public async getInterpretersImplementation(): Promise<PythonEnvironment[]> {
                return [];
            }

            // eslint-disable-next-line class-methods-use-this
            public getCachedInterpreters(): PythonEnvironment[] | undefined {
                return undefined;
            }

            // eslint-disable-next-line class-methods-use-this
            public async cacheInterpreters() {
                return undefined;
            }

            // eslint-disable-next-line class-methods-use-this
            public getCacheKey(): string {
                return '';
            }
        }
        let serviceContainer: ServiceContainer;
        setup(() => {
            serviceContainer = mock(ServiceContainer);
        });

        test('Interpreters must be retrieved once, then cached', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const expectedInterpreters = [1, 2] as any;
            const mockedLocatorForVerification = mock(MockLocator);
            const locator = new (class extends Locator {
                // eslint-disable-next-line class-methods-use-this
                protected async addHandlersForInterpreterWatchers(
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    _cacheKey: string,
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    _resource: Resource,
                ): Promise<void> {
                    noop();
                }
            })('dummy', instance(serviceContainer), instance(mockedLocatorForVerification));

            when(mockedLocatorForVerification.getInterpretersImplementation()).thenResolve(expectedInterpreters);
            when(mockedLocatorForVerification.getCacheKey()).thenReturn('xyz');
            when(mockedLocatorForVerification.getCachedInterpreters()).thenResolve();

            const [items1, items2, items3] = await Promise.all([
                locator.getInterpreters(),
                locator.getInterpreters(),
                locator.getInterpreters(),
            ]);
            expect(items1).to.be.deep.equal(expectedInterpreters);
            expect(items2).to.be.deep.equal(expectedInterpreters);
            expect(items3).to.be.deep.equal(expectedInterpreters);

            verify(mockedLocatorForVerification.getInterpretersImplementation()).once();
            verify(mockedLocatorForVerification.getCachedInterpreters()).atLeast(1);
            verify(mockedLocatorForVerification.cacheInterpreters()).atLeast(1);
        });

        test('Ensure onDidCreate event handler is attached', async () => {
            const mockedLocatorForVerification = mock(MockLocator);
            class Watcher implements IInterpreterWatcher {
                // eslint-disable-next-line class-methods-use-this
                public onDidCreate(
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
                    _listener: (e: Resource) => any,
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
                    _thisArgs?: any,
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    _disposables?: Disposable[],
                ): Disposable {
                    return { dispose: noop };
                }
            }
            const watcher: IInterpreterWatcher = mock(Watcher);

            const locator = new (class extends Locator {
                // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
                protected async getInterpreterWatchers(_resource: Resource): Promise<IInterpreterWatcher[]> {
                    return [instance(watcher)];
                }
            })('dummy', instance(serviceContainer), instance(mockedLocatorForVerification));

            await locator.getInterpreters();

            verify(watcher.onDidCreate(anything(), anything(), anything())).once();
        });

        test('Ensure cache is cleared when watcher event fires', async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const expectedInterpreters = [1, 2] as any;
            const mockedLocatorForVerification = mock(MockLocator);
            class Watcher implements IInterpreterWatcher {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                private listner?: (e: Resource) => any;

                public onDidCreate(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    listener: (e: Resource) => any,
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
                    _thisArgs?: any,
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    _disposables?: Disposable[],
                ): Disposable {
                    this.listner = listener;
                    return { dispose: noop };
                }

                public invokeListeners() {
                    this.listner!(undefined);
                }
            }
            const watcher = new Watcher();

            const locator = new (class extends Locator {
                // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
                protected async getInterpreterWatchers(_resource: Resource): Promise<IInterpreterWatcher[]> {
                    return [watcher];
                }
            })('dummy', instance(serviceContainer), instance(mockedLocatorForVerification));

            when(mockedLocatorForVerification.getInterpretersImplementation()).thenResolve(expectedInterpreters);
            when(mockedLocatorForVerification.getCacheKey()).thenReturn('xyz');
            when(mockedLocatorForVerification.getCachedInterpreters()).thenResolve();

            const [items1, items2, items3] = await Promise.all([
                locator.getInterpreters(),
                locator.getInterpreters(),
                locator.getInterpreters(),
            ]);
            expect(items1).to.be.deep.equal(expectedInterpreters);
            expect(items2).to.be.deep.equal(expectedInterpreters);
            expect(items3).to.be.deep.equal(expectedInterpreters);

            verify(mockedLocatorForVerification.getInterpretersImplementation()).once();
            verify(mockedLocatorForVerification.getCachedInterpreters()).atLeast(1);
            verify(mockedLocatorForVerification.cacheInterpreters()).once();

            watcher.invokeListeners();

            const [items4, items5, items6] = await Promise.all([
                locator.getInterpreters(),
                locator.getInterpreters(),
                locator.getInterpreters(),
            ]);
            expect(items4).to.be.deep.equal(expectedInterpreters);
            expect(items5).to.be.deep.equal(expectedInterpreters);
            expect(items6).to.be.deep.equal(expectedInterpreters);

            // We must get the list of interperters again and cache the new result again.
            verify(mockedLocatorForVerification.getInterpretersImplementation()).twice();
            verify(mockedLocatorForVerification.cacheInterpreters()).twice();
        });
        test('Ensure locating event is raised', async () => {
            const mockedLocatorForVerification = mock(MockLocator);
            const locator = new (class extends Locator {
                // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
                protected async getInterpreterWatchers(_resource: Resource): Promise<IInterpreterWatcher[]> {
                    return [];
                }
            })('dummy', instance(serviceContainer), instance(mockedLocatorForVerification));

            let locatingEventRaised = false;
            locator.onLocating(() => {
                locatingEventRaised = true;
            });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            when(mockedLocatorForVerification.getInterpretersImplementation()).thenResolve([1, 2] as any);
            when(mockedLocatorForVerification.getCacheKey()).thenReturn('xyz');
            when(mockedLocatorForVerification.getCachedInterpreters()).thenResolve();

            await locator.getInterpreters();
            expect(locatingEventRaised).to.be.equal(true, 'Locating Event not raised');
        });
    });
    suite('Cache Key', () => {
        class Locator extends CacheableLocatorService {
            public dispose() {
                noop();
            }

            public getCacheKey(resource?: Uri) {
                return super.getCacheKey(resource);
            }

            // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
            protected async getInterpretersImplementation(_resource?: Uri): Promise<PythonEnvironment[]> {
                return [];
            }

            // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
            protected getCachedInterpreters(_resource?: Uri): PythonEnvironment[] | undefined {
                return [];
            }

            // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
            protected async cacheInterpreters(_interpreters: PythonEnvironment[], _resource?: Uri) {
                noop();
            }
        }
        let serviceContainer: ServiceContainer;
        setup(() => {
            serviceContainer = mock(ServiceContainer);
        });

        test('Cache Key must contain name of locator', async () => {
            const locator = new Locator('hello-World', instance(serviceContainer));

            const key = locator.getCacheKey();

            expect(key).contains('hello-World');
        });

        test('Cache Key must not contain path to workspace', async () => {
            const workspace = mock(WorkspaceService);
            const workspaceFolder: WorkspaceFolder = { name: '1', index: 1, uri: Uri.file(__dirname) };

            when(workspace.hasWorkspaceFolders).thenReturn(true);
            when(workspace.workspaceFolders).thenReturn([workspaceFolder]);
            when(workspace.getWorkspaceFolder(anything())).thenReturn(workspaceFolder);
            when(serviceContainer.get<IWorkspaceService>(IWorkspaceService)).thenReturn(instance(workspace));
            when(serviceContainer.get<IWorkspaceService>(IWorkspaceService, anything())).thenReturn(
                instance(workspace),
            );

            const locator = new Locator('hello-World', instance(serviceContainer), false);

            const key = locator.getCacheKey(Uri.file('something'));

            expect(key).contains('hello-World');
            expect(key).not.contains(md5(workspaceFolder.uri.fsPath));
        });

        test('Cache Key must contain path to workspace', async () => {
            const workspace = mock(WorkspaceService);
            const workspaceFolder: WorkspaceFolder = { name: '1', index: 1, uri: Uri.file(__dirname) };
            const resource = Uri.file('a');

            when(workspace.hasWorkspaceFolders).thenReturn(true);
            when(workspace.workspaceFolders).thenReturn([workspaceFolder]);
            when(workspace.getWorkspaceFolder(resource)).thenReturn(workspaceFolder);
            when(serviceContainer.get<IWorkspaceService>(IWorkspaceService)).thenReturn(instance(workspace));
            when(serviceContainer.get<IWorkspaceService>(IWorkspaceService, anything())).thenReturn(
                instance(workspace),
            );

            const locator = new Locator('hello-World', instance(serviceContainer), true);

            const key = locator.getCacheKey(resource);

            expect(key).contains('hello-World');
            expect(key).contains(md5(workspaceFolder.uri.fsPath));
        });
    });
});
