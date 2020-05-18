// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { IExtensionSingleActivationService } from '../../activation/types';
import { NativeNotebook } from '../../common/experimentGroups';
import { IExperimentsManager } from '../../common/types';
import { IServiceManager } from '../../ioc/types';
import { INotebookEditorProvider } from '../types';
import { NotebookContentProvider } from './contentProvider';
import { NotebookIntegration } from './integration';
import { NotebookEditorProvider, NotebookEditorProviderActivation } from './notebookEditorProvider';
import { NotebookKernel } from './notebookKernel';

export function registerTypes(serviceManager: IServiceManager) {
    // This condition is temporary.
    // If user belongs to the experiment, then make the necessary changes to package.json.
    // Once the API is final, we won't need to modify the package.json.
    if (!serviceManager.get<IExperimentsManager>(IExperimentsManager).inExperiment(NativeNotebook.experiment)) {
        return;
    }
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookEditorProviderActivation
    );
    serviceManager.rebindSingleton<INotebookEditorProvider>(INotebookEditorProvider, NotebookEditorProvider);
    serviceManager.addSingleton<NotebookKernel>(NotebookKernel, NotebookKernel);
    serviceManager.addSingleton<IExtensionSingleActivationService>(
        IExtensionSingleActivationService,
        NotebookIntegration
    );
    serviceManager.add<NotebookContentProvider>(NotebookContentProvider, NotebookContentProvider);
}
