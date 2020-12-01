// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// tslint:disable:max-classes-per-file

import { logWarning } from '../../logging';

/**
 * An object that can be disposed, like vscode.Disposable.
 */
export interface IDisposable {
    dispose(): void | Promise<void>;
}

/**
 * A registry of disposables.
 */
export interface IDisposables extends IDisposable {
    push(...disposable: IDisposable[]): void;
}

/**
 * Safely dispose each of the disposables.
 */
export async function disposeAll(disposables: IDisposable[]): Promise<void> {
    await Promise.all(
        disposables.map(async (d, index) => {
            try {
                await d.dispose();
            } catch (err) {
                logWarning(`dispose() #${index} failed (${err})`);
            }
        })
    );
}

/**
 * A list of disposables.
 */
export class Disposables implements IDisposables {
    private disposables: IDisposable[] = [];

    constructor(...disposables: IDisposable[]) {
        this.disposables.push(...disposables);
    }

    public push(...disposables: IDisposable[]) {
        this.disposables.push(...disposables);
    }

    public async dispose(): Promise<void> {
        const disposables = this.disposables;
        this.disposables = [];
        await disposeAll(disposables);
    }
}
