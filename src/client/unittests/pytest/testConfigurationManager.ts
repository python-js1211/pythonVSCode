import * as vscode from 'vscode';
import { TestConfigurationManager } from '../common/testConfigurationManager';

export class ConfigurationManager extends TestConfigurationManager {
    public enable(): Thenable<any> {
        const pythonConfig = vscode.workspace.getConfiguration('python');
        return pythonConfig.update('unitTest.pyTestEnabled', true);
    }
    public disable(): Thenable<any> {
        const pythonConfig = vscode.workspace.getConfiguration('python');
        return pythonConfig.update('unitTest.pyTestEnabled', false);
    }

    public configure(rootDir: string): Promise<any> {
        // TODO: 
        // 1. Ask if pytest configuration exists
        // 2. Ask to create a py test config or use arguments
        // 3. Finally check if pytest is installed, if not prompt to install it
        //    Do we have issues if pytest is installed in a separate place (will pytest be able to import the files??)
        return Promise.resolve();
    }
}