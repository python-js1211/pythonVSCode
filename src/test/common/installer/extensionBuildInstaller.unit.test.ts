// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:no-any max-func-body-length no-invalid-this

import * as assert from 'assert';
import { expect } from 'chai';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { Uri } from 'vscode';
import { CommandManager } from '../../../client/common/application/commandManager';
import { ICommandManager } from '../../../client/common/application/types';
import { PVSC_EXTENSION_ID } from '../../../client/common/constants';
import { developmentBuildUri, InsidersBuildInstaller, StableBuildInstaller, vsixFileExtension } from '../../../client/common/installer/extensionBuildInstaller';
import { FileDownloader } from '../../../client/common/net/fileDownloader';
import { FileSystem } from '../../../client/common/platform/fileSystem';
import { IFileSystem } from '../../../client/common/platform/types';
import { DownloadOptions, IFileDownloader, IOutputChannel } from '../../../client/common/types';
import { ExtensionChannels } from '../../../client/common/utils/localize';
import { MockOutputChannel } from '../../../test/mockClasses';

suite('Extension build installer - Stable build installer', async () => {
    let output: IOutputChannel;
    let cmdManager: ICommandManager;
    let stableBuildInstaller: StableBuildInstaller;
    setup(() => {
        output = mock(MockOutputChannel);
        cmdManager = mock(CommandManager);
        stableBuildInstaller = new StableBuildInstaller(instance(output), instance(cmdManager));
    });
    test('Installing stable build logs progress and installs stable', async () => {
        when(output.append(ExtensionChannels.installingStableMessage())).thenReturn();
        when(output.appendLine(ExtensionChannels.installationCompleteMessage())).thenReturn();
        when(cmdManager.executeCommand('workbench.extensions.installExtension', PVSC_EXTENSION_ID)).thenResolve(undefined);
        await stableBuildInstaller.install();
        verify(output.append(ExtensionChannels.installingStableMessage())).once();
        verify(output.appendLine(ExtensionChannels.installationCompleteMessage())).once();
        verify(cmdManager.executeCommand('workbench.extensions.installExtension', PVSC_EXTENSION_ID)).once();
    });
});

suite('Extension build installer - Insiders build installer', async () => {
    let output: IOutputChannel;
    let cmdManager: ICommandManager;
    let fileDownloader: IFileDownloader;
    let fs: IFileSystem;
    let insidersBuildInstaller: InsidersBuildInstaller;
    setup(() => {
        output = mock(MockOutputChannel);
        fileDownloader = mock(FileDownloader);
        fs = mock(FileSystem);
        cmdManager = mock(CommandManager);
        insidersBuildInstaller = new InsidersBuildInstaller(instance(output), instance(fileDownloader), instance(fs), instance(cmdManager));
    });
    test('Installing Insiders build downloads and installs Insiders', async () => {
        const vsixFilePath = 'path/to/vsix';
        const options = {
            extension: vsixFileExtension,
            outputChannel: output,
            progressMessagePrefix: ExtensionChannels.downloadingInsidersMessage()
        };
        when(output.append(ExtensionChannels.installingInsidersMessage())).thenReturn();
        when(output.appendLine(ExtensionChannels.startingDownloadOutputMessage())).thenReturn();
        when(output.appendLine(ExtensionChannels.downloadCompletedOutputMessage())).thenReturn();
        when(output.appendLine(ExtensionChannels.installationCompleteMessage())).thenReturn();
        when(
            fileDownloader.downloadFile(developmentBuildUri, anything())
        ).thenCall((_, downloadOptions: DownloadOptions) => {
            expect(downloadOptions.extension).to.equal(options.extension, 'Incorrect file extension');
            expect(downloadOptions.progressMessagePrefix).to.equal(options.progressMessagePrefix);
            return Promise.resolve(vsixFilePath);
        });
        when(
            cmdManager.executeCommand('workbench.extensions.installExtension', anything())
        ).thenCall((_, cb) => {
            assert.deepEqual(cb, Uri.file(vsixFilePath), 'Wrong VSIX installed');
        });
        when(fs.deleteFile(vsixFilePath)).thenResolve();

        await insidersBuildInstaller.install();

        verify(output.append(ExtensionChannels.installingInsidersMessage())).once();
        verify(output.appendLine(ExtensionChannels.startingDownloadOutputMessage())).once();
        verify(output.appendLine(ExtensionChannels.downloadCompletedOutputMessage())).once();
        verify(output.appendLine(ExtensionChannels.installationCompleteMessage())).once();
        verify(cmdManager.executeCommand('workbench.extensions.installExtension', anything())).once();
        verify(fs.deleteFile(vsixFilePath)).once();
    });
});
