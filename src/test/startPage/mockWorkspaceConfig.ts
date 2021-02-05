// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { ConfigurationTarget, WorkspaceConfiguration } from 'vscode';

export class MockWorkspaceConfiguration implements WorkspaceConfiguration {
    private values = new Map<string, any>();

    constructor(defaultSettings?: any) {
        if (defaultSettings) {
            const keys = [...Object.keys(defaultSettings)];
            keys.forEach((k) => this.values.set(k, defaultSettings[k]));
        }

        // Special case python path (not in the object)
        if (defaultSettings && defaultSettings.pythonPath) {
            this.values.set('pythonPath', defaultSettings.pythonPath);
        }
    }

    public get<T>(key: string, defaultValue?: T): T | undefined {
        if (this.values.has(key)) {
            return this.values.get(key);
        }

        return arguments.length > 1 ? defaultValue : (undefined as any);
    }
    public has(section: string): boolean {
        return this.values.has(section);
    }
    public inspect<T>(
        section: string,
    ):
        | {
              key: string;
              defaultValue?: T | undefined;
              globalValue?: T | undefined;
              globalLanguageValue?: T | undefined;
              workspaceValue?: T | undefined;
              workspaceLanguageValue?: T | undefined;
              workspaceFolderValue?: T | undefined;
              workspaceFolderLanguageValue?: T | undefined;
          }
        | undefined {
        return this.values.get(section);
    }
    public update(
        section: string,
        value: any,
        _configurationTarget?: boolean | ConfigurationTarget | undefined,
    ): Promise<void> {
        this.values.set(section, value);
        return Promise.resolve();
    }
}
