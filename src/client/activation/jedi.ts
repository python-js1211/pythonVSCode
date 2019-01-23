// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { DocumentFilter, languages } from 'vscode';
import { PYTHON } from '../common/constants';
import { IConfigurationService, IExtensionContext, ILogger } from '../common/types';
import { IShebangCodeLensProvider } from '../interpreter/contracts';
import { IServiceContainer, IServiceManager } from '../ioc/types';
import { JediFactory } from '../languageServices/jediProxyFactory';
import { PythonCompletionItemProvider } from '../providers/completionProvider';
import { PythonDefinitionProvider } from '../providers/definitionProvider';
import { PythonHoverProvider } from '../providers/hoverProvider';
import { activateGoToObjectDefinitionProvider } from '../providers/objectDefinitionProvider';
import { PythonReferenceProvider } from '../providers/referenceProvider';
import { PythonRenameProvider } from '../providers/renameProvider';
import { PythonSignatureProvider } from '../providers/signatureProvider';
import { JediSymbolProvider } from '../providers/symbolProvider';
import { BlockFormatProviders } from '../typeFormatters/blockFormatProvider';
import { OnTypeFormattingDispatcher } from '../typeFormatters/dispatcher';
import { OnEnterFormatter } from '../typeFormatters/onEnterFormatter';
import { IUnitTestManagementService } from '../unittests/types';
import { WorkspaceSymbols } from '../workspaceSymbols/main';
import { ILanguageServerActivator } from './types';

@injectable()
export class JediExtensionActivator implements ILanguageServerActivator {
    private readonly context: IExtensionContext;
    private jediFactory?: JediFactory;
    private readonly documentSelector: DocumentFilter[];
    constructor(@inject(IServiceManager) private serviceManager: IServiceManager) {
        this.context = this.serviceManager.get<IExtensionContext>(IExtensionContext);
        this.documentSelector = PYTHON;
    }

    public async activate(): Promise<void> {
        const context = this.context;

        const jediFactory = (this.jediFactory = new JediFactory(context.asAbsolutePath('.'), this.serviceManager));
        context.subscriptions.push(jediFactory);
        context.subscriptions.push(...activateGoToObjectDefinitionProvider(jediFactory));

        context.subscriptions.push(jediFactory);
        context.subscriptions.push(
            languages.registerRenameProvider(this.documentSelector, new PythonRenameProvider(this.serviceManager))
        );
        const definitionProvider = new PythonDefinitionProvider(jediFactory);

        context.subscriptions.push(languages.registerDefinitionProvider(this.documentSelector, definitionProvider));
        context.subscriptions.push(
            languages.registerHoverProvider(this.documentSelector, new PythonHoverProvider(jediFactory))
        );
        context.subscriptions.push(
            languages.registerReferenceProvider(this.documentSelector, new PythonReferenceProvider(jediFactory))
        );
        context.subscriptions.push(
            languages.registerCompletionItemProvider(
                this.documentSelector,
                new PythonCompletionItemProvider(jediFactory, this.serviceManager),
                '.'
            )
        );
        context.subscriptions.push(
            languages.registerCodeLensProvider(
                this.documentSelector,
                this.serviceManager.get<IShebangCodeLensProvider>(IShebangCodeLensProvider)
            )
        );

        const onTypeDispatcher = new OnTypeFormattingDispatcher({
            '\n': new OnEnterFormatter(),
            ':': new BlockFormatProviders()
        });
        const onTypeTriggers = onTypeDispatcher.getTriggerCharacters();
        if (onTypeTriggers) {
            context.subscriptions.push(
                languages.registerOnTypeFormattingEditProvider(
                    PYTHON,
                    onTypeDispatcher,
                    onTypeTriggers.first,
                    ...onTypeTriggers.more
                )
            );
        }

        const serviceContainer = this.serviceManager.get<IServiceContainer>(IServiceContainer);
        context.subscriptions.push(new WorkspaceSymbols(serviceContainer));

        const symbolProvider = new JediSymbolProvider(serviceContainer, jediFactory);
        context.subscriptions.push(languages.registerDocumentSymbolProvider(this.documentSelector, symbolProvider));

        const pythonSettings = this.serviceManager.get<IConfigurationService>(IConfigurationService).getSettings();
        if (pythonSettings.devOptions.indexOf('DISABLE_SIGNATURE') === -1) {
            context.subscriptions.push(
                languages.registerSignatureHelpProvider(
                    this.documentSelector,
                    new PythonSignatureProvider(jediFactory),
                    '(',
                    ','
                )
            );
        }

        context.subscriptions.push(
            languages.registerRenameProvider(PYTHON, new PythonRenameProvider(serviceContainer))
        );

        const testManagementService = this.serviceManager.get<IUnitTestManagementService>(IUnitTestManagementService);
        testManagementService
            .activate()
            .then(() => testManagementService.activateCodeLenses(symbolProvider))
            .catch(ex => this.serviceManager.get<ILogger>(ILogger).logError('Failed to activate Unit Tests', ex));
    }

    public dispose(): void {
        if (this.jediFactory) {
            this.jediFactory.dispose();
        }
    }
}
