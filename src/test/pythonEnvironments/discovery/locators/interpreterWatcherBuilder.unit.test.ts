// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { expect } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { WorkspaceService } from '../../../../client/common/application/workspace';
import { IInterpreterWatcher, WORKSPACE_VIRTUAL_ENV_SERVICE } from '../../../../client/interpreter/contracts';
import { ServiceContainer } from '../../../../client/ioc/container';
import { InterpreterWatcherBuilder } from '../../../../client/pythonEnvironments/discovery/locators/services/interpreterWatcherBuilder';

suite('Interpreters - Watcher Builder', () => {
    test('Build Workspace Virtual Env Watcher', async () => {
        const workspaceService = mock(WorkspaceService);
        const serviceContainer = mock(ServiceContainer);
        const builder = new InterpreterWatcherBuilder(instance(workspaceService), instance(serviceContainer));
        const watcher = { register: () => Promise.resolve() };

        when(workspaceService.getWorkspaceFolder(anything())).thenReturn();
        when(serviceContainer.get<IInterpreterWatcher>(IInterpreterWatcher, WORKSPACE_VIRTUAL_ENV_SERVICE)).thenReturn(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (watcher as any) as IInterpreterWatcher,
        );

        const item = await builder.getWorkspaceVirtualEnvInterpreterWatcher(undefined);

        expect(item).to.be.equal(watcher, 'invalid');
    });
    test('Ensure we cache Workspace Virtual Env Watcher', async () => {
        const workspaceService = mock(WorkspaceService);
        const serviceContainer = mock(ServiceContainer);
        const builder = new InterpreterWatcherBuilder(instance(workspaceService), instance(serviceContainer));
        const watcher = { register: () => Promise.resolve() };

        when(workspaceService.getWorkspaceFolder(anything())).thenReturn();
        when(serviceContainer.get<IInterpreterWatcher>(IInterpreterWatcher, WORKSPACE_VIRTUAL_ENV_SERVICE)).thenReturn(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (watcher as any) as IInterpreterWatcher,
        );

        const [item1, item2, item3] = await Promise.all([
            builder.getWorkspaceVirtualEnvInterpreterWatcher(undefined),
            builder.getWorkspaceVirtualEnvInterpreterWatcher(undefined),
            builder.getWorkspaceVirtualEnvInterpreterWatcher(undefined),
        ]);

        expect(item1).to.be.equal(watcher, 'invalid');
        expect(item2).to.be.equal(watcher, 'invalid');
        expect(item3).to.be.equal(watcher, 'invalid');
    });
});
