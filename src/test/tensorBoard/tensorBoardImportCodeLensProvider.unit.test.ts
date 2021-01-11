// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import { mock } from 'ts-mockito';
import { ExperimentService } from '../../client/common/experiments/service';
import { IExperimentService } from '../../client/common/types';
import { TensorBoardImportCodeLensProvider } from '../../client/tensorBoard/tensorBoardImportCodeLensProvider';
import { MockDocument } from '../startPage/mockDocument';

suite('TensorBoard import code lens provider', () => {
    let experimentService: IExperimentService;
    let codeLensProvider: TensorBoardImportCodeLensProvider;

    setup(() => {
        experimentService = mock(ExperimentService);
        codeLensProvider = new TensorBoardImportCodeLensProvider(experimentService, []);
    });

    test('Provides code lens for Python files', () => {
        const document = new MockDocument('import tensorboard', 'foo.py', async () => true);
        const codeActions = codeLensProvider.provideCodeLenses(document);
        assert.ok(codeActions.length > 0, 'Failed to provide code lens for file containing tensorboard import');
    });
    test('Provides code lens for Python ipynbs', () => {
        const document = new MockDocument('import tensorboard', 'foo.ipynb', async () => true);
        const codeActions = codeLensProvider.provideCodeLenses(document);
        assert.ok(codeActions.length > 0, 'Failed to provide code lens for ipynb containing tensorboard import');
    });
    test('Does not provide code lens if no matching import', () => {
        const document = new MockDocument('import foo', 'foo.ipynb', async () => true);
        const codeActions = codeLensProvider.provideCodeLenses(document);
        assert.ok(codeActions.length === 0, 'Provided code lens for file without tensorboard import');
    });
});
