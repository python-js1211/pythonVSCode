// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import { Event, Uri } from 'vscode';

import { ICustomEditorService, IWorkspaceService } from '../../client/common/application/types';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry } from '../../client/common/types';
import { InteractiveWindowMessageListener } from '../../client/datascience/interactive-common/interactiveWindowMessageListener';
import { InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { NativeEditor } from '../../client/datascience/interactive-ipynb/nativeEditor';
import { NativeEditorProvider } from '../../client/datascience/interactive-ipynb/nativeEditorProvider';
import { INotebookEditor, INotebookEditorProvider, INotebookServerOptions } from '../../client/datascience/types';
import { IServiceContainer } from '../../client/ioc/types';

@injectable()
export class TestNativeEditorProvider implements INotebookEditorProvider {
    public get onDidChangeActiveNotebookEditor() {
        return this.realProvider.onDidChangeActiveNotebookEditor;
    }
    public get onDidCloseNotebookEditor() {
        return this.realProvider.onDidCloseNotebookEditor;
    }
    private realProvider: NativeEditorProvider;
    public get onDidOpenNotebookEditor(): Event<INotebookEditor> {
        return this.realProvider.onDidOpenNotebookEditor;
    }

    constructor(
        @inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IAsyncDisposableRegistry) asyncRegistry: IAsyncDisposableRegistry,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IWorkspaceService) workspace: IWorkspaceService,
        @inject(IConfigurationService) configuration: IConfigurationService,
        @inject(ICustomEditorService) customEditorService: ICustomEditorService
    ) {
        this.realProvider = new NativeEditorProvider(serviceContainer, asyncRegistry, disposables, workspace, configuration, customEditorService);
    }

    public get activeEditor(): INotebookEditor | undefined {
        return this.realProvider.activeEditor;
    }

    public get editors(): INotebookEditor[] {
        return this.realProvider.editors;
    }

    public async open(file: Uri): Promise<INotebookEditor> {
        const result = await this.realProvider.open(file);

        // During testing the MainPanel sends the init message before our interactive window is created.
        // Pretend like it's happening now
        // tslint:disable-next-line: no-any
        const listener = (result as any).messageListener as InteractiveWindowMessageListener;
        listener.onMessage(InteractiveWindowMessages.Started, {});

        // Also need the css request so that other messages can go through
        const webHost = result as NativeEditor;
        webHost.setTheme(false);
        return result;
    }

    public show(file: Uri): Promise<INotebookEditor | undefined> {
        return this.realProvider.show(file);
    }

    public async createNew(): Promise<INotebookEditor> {
        const result = await this.realProvider.createNew();

        // During testing the MainPanel sends the init message before our interactive window is created.
        // Pretend like it's happening now
        // tslint:disable-next-line: no-any
        const listener = (result as any).messageListener as InteractiveWindowMessageListener;
        listener.onMessage(InteractiveWindowMessages.Started, {});

        // Also need the css request so that other messages can go through
        const webHost = result as NativeEditor;
        webHost.setTheme(false);

        return result;
    }

    public async getNotebookOptions(): Promise<INotebookServerOptions> {
        return this.realProvider.getNotebookOptions();
    }
}
