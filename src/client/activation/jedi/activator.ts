// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
// tslint:disable-next-line: import-name
import { IWorkspaceService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';
import { IConfigurationService, Resource } from '../../common/types';
import { LanguageServerActivatorBase } from '../common/activatorBase';
import { ILanguageServerManager } from '../types';

/**
 * Starts jedi language server manager.
 *
 * @export
 * @class JediLanguageServerActivator
 * @implements {ILanguageServerActivator}
 * @extends {LanguageServerActivatorBase}
 */
@injectable()
export class JediLanguageServerActivator extends LanguageServerActivatorBase {
    constructor(
        @inject(ILanguageServerManager) manager: ILanguageServerManager,
        @inject(IWorkspaceService) workspace: IWorkspaceService,
        @inject(IFileSystem) fs: IFileSystem,
        @inject(IConfigurationService) configurationService: IConfigurationService
    ) {
        super(manager, workspace, fs, configurationService);
    }

    public async ensureLanguageServerIsAvailable(_resource: Resource): Promise<void> {
        // Nothing to do here. Jedi language server is shipped with the extension
    }
}
