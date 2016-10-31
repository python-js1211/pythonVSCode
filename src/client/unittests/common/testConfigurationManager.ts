import * as vscode from 'vscode';
import { createDeferred } from '../../common/helpers';
import { getSubDirectories } from '../../common/utils';
import * as path from 'path';

export abstract class TestConfigurationManager {
    public abstract enable(): Thenable<any>;
    public abstract disable(): Thenable<any>;

    public abstract configure(rootDir: string): Promise<any>;

    protected selectTestDir(rootDir: string, subDirs: string[]): Promise<string> {
        const options = {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: 'Select the directory containing the unit tests'
        };
        let items: vscode.QuickPickItem[] = subDirs.map(dir => {
            const dirName = path.relative(rootDir, dir);
            if (dirName.indexOf('.') === 0) {
                return null;
            }
            return <vscode.QuickPickItem>{
                label: dirName,
                description: '',
            };
        }).filter(item => item !== null);

        items = [{ label: '.', description: 'Root directory' }, ...items];

        const def = createDeferred<string>();
        vscode.window.showQuickPick(items, options).then(item => {
            if (!item) {
                return def.resolve();
            }

            def.resolve(item.label);
        });

        return def.promise;
    }

    protected selectTestFilePattern(): Promise<string> {
        const options = {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: 'Select the pattern to identify test files'
        };
        let items: vscode.QuickPickItem[] = [
            { label: '*test.py', description: `Python Files ending with 'test'` },
            { label: '*_test.py', description: `Python Files ending with '_test'` },
            { label: 'test*.py', description: `Python Files begining with 'test'` },
            { label: 'test_*.py', description: `Python Files begining with 'test_'` },
            { label: '*test*.py', description: `Python Files containing the word 'test'` }
        ];

        const def = createDeferred<string>();
        vscode.window.showQuickPick(items, options).then(item => {
            if (!item) {
                return def.resolve();
            }

            def.resolve(item.label);
        });

        return def.promise;
    }
    protected getTestDirs(rootDir): Promise<string[]> {
        return getSubDirectories(rootDir).then(subDirs => {
            subDirs.sort();

            // Find out if there are any dirs with the name test and place them on the top
            let possibleTestDirs = subDirs.filter(dir => dir.match(/test/i));
            let nonTestDirs = subDirs.filter(dir => possibleTestDirs.indexOf(dir) === -1);
            possibleTestDirs.push(...nonTestDirs);

            // The test dirs are now on top
            return possibleTestDirs;
        });
    }
}