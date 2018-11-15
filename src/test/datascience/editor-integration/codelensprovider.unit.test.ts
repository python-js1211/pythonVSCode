// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as TypeMoq from 'typemoq';
import { TextDocument } from 'vscode';
import { IConfigurationService, IDataScienceSettings, IPythonSettings } from '../../../client/common/types';
import { DataScienceCodeLensProvider } from '../../../client/datascience/editor-integration/codelensprovider';
import { ICodeWatcher, IDataScienceCodeLensProvider } from '../../../client/datascience/types';
import { IServiceContainer } from '../../../client/ioc/types';

suite('DataScienceCodeLensProvider Unit Tests', () => {
    let serviceContainer: TypeMoq.IMock<IServiceContainer>;
    let configurationService: TypeMoq.IMock<IConfigurationService>;
    let codeLensProvider: IDataScienceCodeLensProvider;
    let dataScienceSettings: TypeMoq.IMock<IDataScienceSettings>;
    let pythonSettings: TypeMoq.IMock<IPythonSettings>;
    setup(() => {
        serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();
        configurationService = TypeMoq.Mock.ofType<IConfigurationService>();

        pythonSettings = TypeMoq.Mock.ofType<IPythonSettings>();
        dataScienceSettings = TypeMoq.Mock.ofType<IDataScienceSettings>();
        dataScienceSettings.setup(d => d.enabled).returns(() => true);
        pythonSettings.setup(p => p.datascience).returns(() => dataScienceSettings.object);
        configurationService.setup(c => c.getSettings(TypeMoq.It.isAny())).returns(() => pythonSettings.object);

        codeLensProvider = new DataScienceCodeLensProvider(serviceContainer.object, configurationService.object);
    });

    test('Initialize Code Lenses one document', () => {
        // Create our document
        const document = TypeMoq.Mock.ofType<TextDocument>();
        document.setup(d => d.fileName).returns(() => 'test.py');
        document.setup(d => d.version).returns(() => 1);

        const targetCodeWatcher = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher.setup(tc => tc.getCodeLenses()).returns(() => []).verifiable(TypeMoq.Times.once());
        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(ICodeWatcher))).returns(() => targetCodeWatcher.object).verifiable(TypeMoq.Times.once());

        codeLensProvider.provideCodeLenses(document.object, undefined);

        targetCodeWatcher.verifyAll();
        serviceContainer.verifyAll();
    });

    test('Initialize Code Lenses same doc called', () => {
        // Create our document
        const document = TypeMoq.Mock.ofType<TextDocument>();
        document.setup(d => d.fileName).returns(() => 'test.py');
        document.setup(d => d.version).returns(() => 1);

        const targetCodeWatcher = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher.setup(tc => tc.getCodeLenses()).returns(() => []).verifiable(TypeMoq.Times.exactly(2));
        targetCodeWatcher.setup(tc => tc.getFileName()).returns(() => 'test.py');
        targetCodeWatcher.setup(tc => tc.getVersion()).returns(() => 1);
        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(ICodeWatcher))).returns(() => targetCodeWatcher.object).verifiable(TypeMoq.Times.once());

        codeLensProvider.provideCodeLenses(document.object, undefined);
        codeLensProvider.provideCodeLenses(document.object, undefined);

        // getCodeLenses should be called twice, but getting the code watcher only once due to same doc
        targetCodeWatcher.verifyAll();
        serviceContainer.verifyAll();
    });

    test('Initialize Code Lenses new name / version', () => {
        // Create our document
        const document = TypeMoq.Mock.ofType<TextDocument>();
        document.setup(d => d.fileName).returns(() => 'test.py');
        document.setup(d => d.version).returns(() => 1);

        const document2 = TypeMoq.Mock.ofType<TextDocument>();
        document2.setup(d => d.fileName).returns(() => 'test2.py');
        document2.setup(d => d.version).returns(() => 1);

        const document3 = TypeMoq.Mock.ofType<TextDocument>();
        document3.setup(d => d.fileName).returns(() => 'test.py');
        document3.setup(d => d.version).returns(() => 2);

        const targetCodeWatcher = TypeMoq.Mock.ofType<ICodeWatcher>();
        targetCodeWatcher.setup(tc => tc.getCodeLenses()).returns(() => []).verifiable(TypeMoq.Times.exactly(3));
        targetCodeWatcher.setup(tc => tc.getFileName()).returns(() => 'test.py');
        targetCodeWatcher.setup(tc => tc.getVersion()).returns(() => 1);
        serviceContainer.setup(c => c.get(TypeMoq.It.isValue(ICodeWatcher))).returns(() => targetCodeWatcher.object).verifiable(TypeMoq.Times.exactly(3));

        codeLensProvider.provideCodeLenses(document.object, undefined);
        codeLensProvider.provideCodeLenses(document2.object, undefined);
        codeLensProvider.provideCodeLenses(document3.object, undefined);

        // service container get should be called three times as the names and versions don't match
        targetCodeWatcher.verifyAll();
        serviceContainer.verifyAll();
    });
});
