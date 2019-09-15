// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-unnecessary-override no-invalid-template-strings max-func-body-length no-any

import { instance, mock, verify } from 'ts-mockito';
import { IExtensionSingleActivationService } from '../../../client/activation/types';
import { DebugAdapterActivator } from '../../../client/debugger/extension/adapter/activator';
import { DebugAdapterDescriptorFactory } from '../../../client/debugger/extension/adapter/factory';
import { DebuggerBanner } from '../../../client/debugger/extension/banner';
import { PythonDebugConfigurationService } from '../../../client/debugger/extension/configuration/debugConfigurationService';
import { LaunchJsonCompletionProvider } from '../../../client/debugger/extension/configuration/launch.json/completionProvider';
import { LaunchJsonUpdaterService } from '../../../client/debugger/extension/configuration/launch.json/updaterService';
import { DjangoLaunchDebugConfigurationProvider } from '../../../client/debugger/extension/configuration/providers/djangoLaunch';
import { FileLaunchDebugConfigurationProvider } from '../../../client/debugger/extension/configuration/providers/fileLaunch';
import { FlaskLaunchDebugConfigurationProvider } from '../../../client/debugger/extension/configuration/providers/flaskLaunch';
import { ModuleLaunchDebugConfigurationProvider } from '../../../client/debugger/extension/configuration/providers/moduleLaunch';
import { DebugConfigurationProviderFactory } from '../../../client/debugger/extension/configuration/providers/providerFactory';
import { PyramidLaunchDebugConfigurationProvider } from '../../../client/debugger/extension/configuration/providers/pyramidLaunch';
import { RemoteAttachDebugConfigurationProvider } from '../../../client/debugger/extension/configuration/providers/remoteAttach';
import { AttachConfigurationResolver } from '../../../client/debugger/extension/configuration/resolvers/attach';
import { LaunchConfigurationResolver } from '../../../client/debugger/extension/configuration/resolvers/launch';
import { IDebugConfigurationProviderFactory, IDebugConfigurationResolver } from '../../../client/debugger/extension/configuration/types';
import { ChildProcessAttachEventHandler } from '../../../client/debugger/extension/hooks/childProcessAttachHandler';
import { ChildProcessAttachService } from '../../../client/debugger/extension/hooks/childProcessAttachService';
import { IChildProcessAttachService, IDebugSessionEventHandlers } from '../../../client/debugger/extension/hooks/types';
import { registerTypes } from '../../../client/debugger/extension/serviceRegistry';
import {
    DebugConfigurationType,
    IDebugAdapterDescriptorFactory,
    IDebugConfigurationProvider,
    IDebugConfigurationService,
    IDebuggerBanner
} from '../../../client/debugger/extension/types';
import { AttachRequestArguments, LaunchRequestArguments } from '../../../client/debugger/types';
import { ServiceManager } from '../../../client/ioc/serviceManager';
import { IServiceManager } from '../../../client/ioc/types';

suite('Debugging - Service Registry', () => {
    let serviceManager: IServiceManager;

    setup(() => {
        serviceManager = mock(ServiceManager);
    });
    test('Registrations', () => {
        registerTypes(instance(serviceManager));

        verify(serviceManager.addSingleton<IDebugConfigurationService>(IDebugConfigurationService, PythonDebugConfigurationService)).once();
        verify(serviceManager.addSingleton<IDebuggerBanner>(IDebuggerBanner, DebuggerBanner)).once();
        verify(serviceManager.addSingleton<IChildProcessAttachService>(IChildProcessAttachService, ChildProcessAttachService)).once();
        verify(serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, LaunchJsonCompletionProvider)).once();
        verify(serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, LaunchJsonUpdaterService)).once();
        verify(serviceManager.addSingleton<IExtensionSingleActivationService>(IExtensionSingleActivationService, DebugAdapterActivator)).once();
        verify(serviceManager.addSingleton<IDebugAdapterDescriptorFactory>(IDebugAdapterDescriptorFactory, DebugAdapterDescriptorFactory)).once();
        verify(serviceManager.addSingleton<IDebugSessionEventHandlers>(IDebugSessionEventHandlers, ChildProcessAttachEventHandler)).once();
        verify(serviceManager.addSingleton<IDebugConfigurationResolver<LaunchRequestArguments>>(IDebugConfigurationResolver, LaunchConfigurationResolver, 'launch')).once();
        verify(serviceManager.addSingleton<IDebugConfigurationResolver<AttachRequestArguments>>(IDebugConfigurationResolver, AttachConfigurationResolver, 'attach')).once();
        verify(serviceManager.addSingleton<IDebugConfigurationProviderFactory>(IDebugConfigurationProviderFactory, DebugConfigurationProviderFactory)).once();
        verify(serviceManager.addSingleton<IDebugConfigurationProvider>(IDebugConfigurationProvider, FileLaunchDebugConfigurationProvider, DebugConfigurationType.launchFile)).once();
        verify(serviceManager.addSingleton<IDebugConfigurationProvider>(IDebugConfigurationProvider, DjangoLaunchDebugConfigurationProvider, DebugConfigurationType.launchDjango)).once();
        verify(serviceManager.addSingleton<IDebugConfigurationProvider>(IDebugConfigurationProvider, FlaskLaunchDebugConfigurationProvider, DebugConfigurationType.launchFlask)).once();
        verify(serviceManager.addSingleton<IDebugConfigurationProvider>(IDebugConfigurationProvider, RemoteAttachDebugConfigurationProvider, DebugConfigurationType.remoteAttach)).once();
        verify(serviceManager.addSingleton<IDebugConfigurationProvider>(IDebugConfigurationProvider, ModuleLaunchDebugConfigurationProvider, DebugConfigurationType.launchModule)).once();
        verify(serviceManager.addSingleton<IDebugConfigurationProvider>(IDebugConfigurationProvider, PyramidLaunchDebugConfigurationProvider, DebugConfigurationType.launchPyramid)).once();
    });
});
