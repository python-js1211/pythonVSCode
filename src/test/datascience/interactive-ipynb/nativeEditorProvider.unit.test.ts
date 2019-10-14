// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable: no-any

import { expect } from 'chai';
import { instance, mock, when } from 'ts-mockito';
import * as typemoq from 'typemoq';
import { EventEmitter, TextDocument, Uri } from 'vscode';
import { CommandManager } from '../../../client/common/application/commandManager';
import { DocumentManager } from '../../../client/common/application/documentManager';
import { ICommandManager, IDocumentManager, IWorkspaceService } from '../../../client/common/application/types';
import { WorkspaceService } from '../../../client/common/application/workspace';
import { AsyncDisposableRegistry } from '../../../client/common/asyncDisposableRegistry';
import { ConfigurationService } from '../../../client/common/configuration/service';
import { FileSystem } from '../../../client/common/platform/fileSystem';
import { IFileSystem } from '../../../client/common/platform/types';
import { IConfigurationService } from '../../../client/common/types';
import { DataScienceErrorHandler } from '../../../client/datascience/errorHandler/errorHandler';
import { NativeEditorProvider } from '../../../client/datascience/interactive-ipynb/nativeEditorProvider';
import { IDataScienceErrorHandler, INotebookEditor } from '../../../client/datascience/types';
import { ServiceContainer } from '../../../client/ioc/container';
import { IServiceContainer } from '../../../client/ioc/types';
import { sleep } from '../../core';

// tslint:disable: max-func-body-length
suite('Data Science - Native Editor Provider', () => {
    let workspace: IWorkspaceService;
    let configService: IConfigurationService;
    let fileSystem: IFileSystem;
    let doctManager: IDocumentManager;
    let dsErrorHandler: IDataScienceErrorHandler;
    let cmdManager: ICommandManager;
    let svcContainer: IServiceContainer;

    setup(() => {
        svcContainer = mock(ServiceContainer);
        configService = mock(ConfigurationService);
        fileSystem = mock(FileSystem);
        doctManager = mock(DocumentManager);
        dsErrorHandler = mock(DataScienceErrorHandler);
        cmdManager = mock(CommandManager);
        workspace = mock(WorkspaceService);
    });

    function createNotebookProvider() {
        return new NativeEditorProvider(
            instance(svcContainer),
            instance(mock(AsyncDisposableRegistry)),
            [],
            instance(workspace),
            instance(configService),
            instance(fileSystem),
            instance(doctManager),
            instance(cmdManager),
            instance(dsErrorHandler)
        );
    }
    function createTextDocument(uri: Uri, content: string) {
        const textDocument = typemoq.Mock.ofType<TextDocument>();
        textDocument.setup(t => t.uri).returns(() => uri);
        textDocument.setup(t => t.fileName).returns(() => uri.fsPath);
        textDocument.setup(t => t.getText()).returns(() => content);
        return textDocument.object;
    }
    async function testAutomaticallyOpeningNotebookEditorWhenOpeningFiles(uri: Uri, shouldOpenNotebookEditor: boolean) {
        const eventEmitter = new EventEmitter<TextDocument>();
        const editor = typemoq.Mock.ofType<INotebookEditor>();
        when(configService.getSettings()).thenReturn({ datascience: { useNotebookEditor: true } } as any);
        when(doctManager.onDidOpenTextDocument).thenReturn(eventEmitter.event);
        editor.setup(e => e.closed).returns(() => new EventEmitter<INotebookEditor>().event);
        editor.setup(e => e.executed).returns(() => new EventEmitter<INotebookEditor>().event);
        editor.setup(e => (e as any).then).returns(() => undefined);
        when(svcContainer.get<INotebookEditor>(INotebookEditor)).thenReturn(editor.object);

        // Ensure the editor is created and the load and show methods are invoked.
        const invocationCount = shouldOpenNotebookEditor ? 1 : 0;
        editor
            .setup(e => e.load(typemoq.It.isAny(), typemoq.It.isAny()))
            .returns(() => Promise.resolve())
            .verifiable(typemoq.Times.exactly(invocationCount));
        editor
            .setup(e => e.show())
            .returns(() => Promise.resolve())
            .verifiable(typemoq.Times.exactly(invocationCount));

        const notebookEditor = createNotebookProvider();

        // Open a text document.
        const textDoc = createTextDocument(uri, 'hello');
        eventEmitter.fire(textDoc);

        // wait for callbacks to get executed.
        await sleep(1);

        // If we're to open the notebook, then there must be 1, else 0.
        expect(notebookEditor.editors).to.be.lengthOf(shouldOpenNotebookEditor ? 1 : 0);
        editor.verifyAll();
    }

    test('Open the notebook editor when an ipynb file is opened', async () => {
        await testAutomaticallyOpeningNotebookEditorWhenOpeningFiles(Uri.file('some file.ipynb'), true);
    });
    test('Do not open the notebook editor when a txt file is opened', async () => {
        await testAutomaticallyOpeningNotebookEditorWhenOpeningFiles(Uri.file('some text file.txt'), false);
    });
    test('Open the notebook editor when an ipynb file is opened with a file scheme', async () => {
        await testAutomaticallyOpeningNotebookEditorWhenOpeningFiles(Uri.parse('file:///some file.ipynb'), true);
    });
    test('Open the notebook editor when an ipynb file is opened with a vsls scheme (live share)', async () => {
        await testAutomaticallyOpeningNotebookEditorWhenOpeningFiles(Uri.parse('vsls:///some file.ipynb'), true);
    });
    test('Do not open the notebook editor when an ipynb file is opened with a git scheme (comparing staged/modified files)', async () => {
        await testAutomaticallyOpeningNotebookEditorWhenOpeningFiles(Uri.parse('git://some//text file.txt'), false);
    });
});
