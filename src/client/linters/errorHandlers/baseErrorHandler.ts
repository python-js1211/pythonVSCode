// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { OutputChannel, Uri } from 'vscode';
import { ExecutionInfo, IInstaller, ILogger, Product } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { IErrorHandler } from '../types';

export abstract class BaseErrorHandler implements IErrorHandler {
    protected logger: ILogger;
    protected installer: IInstaller;

    private handler: IErrorHandler;

    constructor(protected product: Product, protected outputChannel: OutputChannel, protected serviceContainer: IServiceContainer) {
        this.logger = this.serviceContainer.get<ILogger>(ILogger);
        this.installer = this.serviceContainer.get<IInstaller>(IInstaller);
    }
    protected get nextHandler() {
        return this.handler;
    }
    public setNextHandler(handler: IErrorHandler): void {
        this.handler = handler;
    }
    public abstract handleError(error: Error, resource: Uri, execInfo: ExecutionInfo): Promise<boolean>;
}
