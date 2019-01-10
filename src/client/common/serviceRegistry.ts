// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { IHttpClient } from '../activation/types';
import { IServiceManager } from '../ioc/types';
import { ApplicationEnvironment } from './application/applicationEnvironment';
import { ApplicationShell } from './application/applicationShell';
import { CommandManager } from './application/commandManager';
import { DebugService } from './application/debugService';
import { DocumentManager } from './application/documentManager';
import { Extensions } from './application/extensions';
import { TerminalManager } from './application/terminalManager';
import {
    IApplicationEnvironment,
    IApplicationShell,
    ICommandManager,
    IDebugService,
    IDocumentManager,
    ITerminalManager,
    IWorkspaceService
} from './application/types';
import { WorkspaceService } from './application/workspace';
import { AsyncDisposableRegistry } from './asyncDisposableRegistry';
import { ConfigurationService } from './configuration/service';
import { EditorUtils } from './editor';
import { FeatureDeprecationManager } from './featureDeprecationManager';
import { ProductInstaller } from './installer/productInstaller';
import { Logger } from './logger';
import { BrowserService } from './net/browser';
import { HttpClient } from './net/httpClient';
import { NugetService } from './nuget/nugetService';
import { INugetService } from './nuget/types';
import { PersistentStateFactory } from './persistentState';
import { IS_WINDOWS } from './platform/constants';
import { PathUtils } from './platform/pathUtils';
import { CurrentProcess } from './process/currentProcess';
import { TerminalActivator } from './terminal/activator';
import { PowershellTerminalActivationFailedHandler } from './terminal/activator/powershellFailedHandler';
import { Bash } from './terminal/environmentActivationProviders/bash';
import { CommandPromptAndPowerShell } from './terminal/environmentActivationProviders/commandPrompt';
import { CondaActivationCommandProvider } from './terminal/environmentActivationProviders/condaActivationProvider';
import { PipEnvActivationCommandProvider } from './terminal/environmentActivationProviders/pipEnvActivationProvider';
import { PyEnvActivationCommandProvider } from './terminal/environmentActivationProviders/pyenvActivationProvider';
import { TerminalServiceFactory } from './terminal/factory';
import { TerminalHelper } from './terminal/helper';
import {
    ITerminalActivationCommandProvider,
    ITerminalActivationHandler,
    ITerminalActivator,
    ITerminalHelper,
    ITerminalServiceFactory,
    TerminalActivationProviders
} from './terminal/types';
import {
    IAsyncDisposableRegistry,
    IBrowserService,
    IConfigurationService,
    ICurrentProcess,
    IEditorUtils,
    IExtensions,
    IFeatureDeprecationManager,
    IInstaller,
    ILogger,
    IPathUtils,
    IPersistentStateFactory,
    IRandom,
    IsWindows
} from './types';
import { IMultiStepInputFactory, MultiStepInputFactory } from './utils/multiStepInput';
import { Random } from './utils/random';

export function registerTypes(serviceManager: IServiceManager) {
    serviceManager.addSingletonInstance<boolean>(IsWindows, IS_WINDOWS);

    serviceManager.addSingleton<IExtensions>(IExtensions, Extensions);
    serviceManager.addSingleton<IRandom>(IRandom, Random);
    serviceManager.addSingleton<IPersistentStateFactory>(IPersistentStateFactory, PersistentStateFactory);
    serviceManager.addSingleton<ILogger>(ILogger, Logger);
    serviceManager.addSingleton<ITerminalServiceFactory>(ITerminalServiceFactory, TerminalServiceFactory);
    serviceManager.addSingleton<IPathUtils>(IPathUtils, PathUtils);
    serviceManager.addSingleton<IApplicationShell>(IApplicationShell, ApplicationShell);
    serviceManager.addSingleton<ICurrentProcess>(ICurrentProcess, CurrentProcess);
    serviceManager.addSingleton<IInstaller>(IInstaller, ProductInstaller);
    serviceManager.addSingleton<ICommandManager>(ICommandManager, CommandManager);
    serviceManager.addSingleton<IConfigurationService>(IConfigurationService, ConfigurationService);
    serviceManager.addSingleton<IWorkspaceService>(IWorkspaceService, WorkspaceService);
    serviceManager.addSingleton<IDocumentManager>(IDocumentManager, DocumentManager);
    serviceManager.addSingleton<ITerminalManager>(ITerminalManager, TerminalManager);
    serviceManager.addSingleton<IDebugService>(IDebugService, DebugService);
    serviceManager.addSingleton<IApplicationEnvironment>(IApplicationEnvironment, ApplicationEnvironment);
    serviceManager.addSingleton<IBrowserService>(IBrowserService, BrowserService);
    serviceManager.addSingleton<IHttpClient>(IHttpClient, HttpClient);
    serviceManager.addSingleton<IEditorUtils>(IEditorUtils, EditorUtils);
    serviceManager.addSingleton<INugetService>(INugetService, NugetService);
    serviceManager.addSingleton<ITerminalActivator>(ITerminalActivator, TerminalActivator);
    serviceManager.addSingleton<ITerminalActivationHandler>(ITerminalActivationHandler, PowershellTerminalActivationFailedHandler);

    serviceManager.addSingleton<ITerminalHelper>(ITerminalHelper, TerminalHelper);
    serviceManager.addSingleton<ITerminalActivationCommandProvider>(
        ITerminalActivationCommandProvider, Bash, TerminalActivationProviders.bashCShellFish);
    serviceManager.addSingleton<ITerminalActivationCommandProvider>(
        ITerminalActivationCommandProvider, CommandPromptAndPowerShell, TerminalActivationProviders.commandPromptAndPowerShell);
    serviceManager.addSingleton<ITerminalActivationCommandProvider>(
        ITerminalActivationCommandProvider, PyEnvActivationCommandProvider, TerminalActivationProviders.pyenv);
    serviceManager.addSingleton<ITerminalActivationCommandProvider>(
        ITerminalActivationCommandProvider, CondaActivationCommandProvider, TerminalActivationProviders.conda);
    serviceManager.addSingleton<ITerminalActivationCommandProvider>(
        ITerminalActivationCommandProvider, PipEnvActivationCommandProvider, TerminalActivationProviders.pipenv);
    serviceManager.addSingleton<IFeatureDeprecationManager>(IFeatureDeprecationManager, FeatureDeprecationManager);

    serviceManager.addSingleton<IAsyncDisposableRegistry>(IAsyncDisposableRegistry, AsyncDisposableRegistry);
    serviceManager.addSingleton<IMultiStepInputFactory>(IMultiStepInputFactory, MultiStepInputFactory);
}
