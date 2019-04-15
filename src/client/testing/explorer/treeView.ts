// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { TreeView } from 'vscode';
import { IExtensionActivationService } from '../../activation/types';
import { IApplicationShell, ICommandManager } from '../../common/application/types';
import { Commands } from '../../common/constants';
import { IDisposable, IDisposableRegistry, Resource } from '../../common/types';
import { ITestTreeViewProvider, TestDataItem } from '../types';

@injectable()
export class TreeViewService implements IExtensionActivationService, IDisposable {
    private _treeView!: TreeView<TestDataItem>;
    private readonly disposables: IDisposable[] = [];
    private activated: boolean = false;
    public get treeView(): TreeView<TestDataItem> {
        return this._treeView;
    }
    constructor(@inject(ITestTreeViewProvider) private readonly treeViewProvider: ITestTreeViewProvider,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(ICommandManager) private readonly commandManager: ICommandManager) {
        disposableRegistry.push(this);
    }
    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
    public async activate(_resource: Resource): Promise<void> {
        if (this.activated) {
            return;
        }
        this.activated = true;
        this._treeView = this.appShell.createTreeView('python_tests', { showCollapseAll: true, treeDataProvider: this.treeViewProvider });
        this.disposables.push(this._treeView);
        this.disposables.push(this.commandManager.registerCommand(Commands.Test_Reveal_Test_Item, this.onRevealTestItem, this));
    }
    public async onRevealTestItem(testItem: TestDataItem): Promise<void> {
        await this.treeView.reveal(testItem);
    }
}
