// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from 'path';

import { IWorkspaceService } from '../../common/application/types';
import { EXTENSION_ROOT_DIR } from '../../common/constants';
import { IFileSystem } from '../../common/platform/types';
import { IConfigurationService, Resource } from '../../common/types';
import { LanguageServerActivatorBase } from '../common/activatorBase';
import { ILanguageServerDownloader, ILanguageServerFolderService, ILanguageServerManager } from '../types';

/**
 * Starts the language server managers per workspaces (currently one for first workspace).
 *
 * @export
 * @class DotNetLanguageServerActivator
 * @implements {ILanguageServerActivator}
 * @extends {LanguageServerActivatorBase}
 */
@injectable()
export class DotNetLanguageServerActivator extends LanguageServerActivatorBase {
    constructor(
        @inject(ILanguageServerManager) manager: ILanguageServerManager,
        @inject(IWorkspaceService) workspace: IWorkspaceService,
        @inject(IFileSystem) fs: IFileSystem,
        @inject(ILanguageServerDownloader) private readonly lsDownloader: ILanguageServerDownloader,
        @inject(ILanguageServerFolderService)
        private readonly languageServerFolderService: ILanguageServerFolderService,
        @inject(IConfigurationService) configurationService: IConfigurationService,
    ) {
        super(manager, workspace, fs, configurationService);
    }

    public async ensureLanguageServerIsAvailable(resource: Resource): Promise<void> {
        const languageServerFolderPath = await this.ensureLanguageServerFileIsAvailable(resource, 'mscorlib.dll');
        if (languageServerFolderPath) {
            await this.prepareLanguageServerForNoICU(languageServerFolderPath);
        }
    }

    public async prepareLanguageServerForNoICU(languageServerFolderPath: string): Promise<void> {
        const targetJsonFile = path.join(
            languageServerFolderPath,
            'Microsoft.Python.LanguageServer.runtimeconfig.json',
        );

        let content: any = {};
        if (await this.fs.fileExists(targetJsonFile)) {
            try {
                content = JSON.parse(await this.fs.readFile(targetJsonFile));
                if (
                    content.runtimeOptions &&
                    content.runtimeOptions.configProperties &&
                    content.runtimeOptions.configProperties['System.Globalization.Invariant'] === true
                ) {
                    return;
                }
            } catch {
                // Do nothing.
            }
        }
        content.runtimeOptions = content.runtimeOptions || {};
        content.runtimeOptions.configProperties = content.runtimeOptions.configProperties || {};
        content.runtimeOptions.configProperties['System.Globalization.Invariant'] = true;
        await this.fs.writeFile(targetJsonFile, JSON.stringify(content));
    }

    private async ensureLanguageServerFileIsAvailable(
        resource: Resource,
        fileName: string,
    ): Promise<string | undefined> {
        const settings = this.configurationService.getSettings(resource);
        if (settings.downloadLanguageServer === false) {
            // Development mode
            return;
        }
        const languageServerFolder = await this.languageServerFolderService.getLanguageServerFolderName(resource);
        if (languageServerFolder) {
            const languageServerFolderPath = path.join(EXTENSION_ROOT_DIR, languageServerFolder);
            const mscorlib = path.join(languageServerFolderPath, fileName);
            if (!(await this.fs.fileExists(mscorlib))) {
                await this.lsDownloader.downloadLanguageServer(languageServerFolderPath, resource);
            }
            return languageServerFolderPath;
        }
    }
}
