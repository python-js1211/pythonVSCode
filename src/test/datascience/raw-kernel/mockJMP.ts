// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { KernelMessage } from '@jupyterlab/services';
import { IJMPConnection, IJMPConnectionInfo } from '../../../client/datascience/types';

export class MockJMPConnection implements IJMPConnection {
    private callback: ((message: KernelMessage.IMessage) => void) | undefined;

    public async connect(_connectInfo: IJMPConnectionInfo): Promise<void> {
        return;
    }
    public sendMessage(_message: KernelMessage.IMessage): void {
        return;
    }
    public subscribe(handlerFunc: (message: KernelMessage.IMessage) => void): void {
        this.callback = handlerFunc;
    }
    public dispose(): void {
        return;
    }

    // Send a kernel message back to the hander function
    public messageBack(message: KernelMessage.IMessage) {
        if (this.callback) {
            this.callback(message);
        }
    }
}
