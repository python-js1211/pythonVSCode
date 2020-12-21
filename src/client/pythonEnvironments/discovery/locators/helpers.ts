import * as fsapi from 'fs-extra';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { traceError } from '../../../common/logger';
import { IS_WINDOWS } from '../../../common/platform/constants';
import { IFileSystem } from '../../../common/platform/types';
import { IInterpreterLocatorHelper } from '../../../interpreter/contracts';
import { IPipEnvServiceHelper } from '../../../interpreter/locators/types';
import { EnvironmentType, PythonEnvironment } from '../../info';

const CheckPythonInterpreterRegEx = IS_WINDOWS ? /^python(\d+(.\d+)?)?\.exe$/ : /^python(\d+(.\d+)?)?$/;

export async function lookForInterpretersInDirectory(pathToCheck: string): Promise<string[]> {
    // Technically, we should be able to use fs.getFiles().  However,
    // that breaks some tests.  So we stick with the broader behavior.
    try {
        // tslint:disable-next-line: no-suspicious-comment
        // TODO https://github.com/microsoft/vscode-python/issues/11338
        const files = await fsapi.readdir(pathToCheck);
        return files
            .map((filename) => path.join(pathToCheck, filename))
            .filter((fileName) => CheckPythonInterpreterRegEx.test(path.basename(fileName)));
    } catch (err) {
        traceError('Python Extension (lookForInterpretersInDirectory.fs.readdir):', err);
        return [] as string[];
    }
}

@injectable()
export class InterpreterLocatorHelper implements IInterpreterLocatorHelper {
    constructor(
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IPipEnvServiceHelper) private readonly pipEnvServiceHelper: IPipEnvServiceHelper,
    ) {}

    public async mergeInterpreters(interpreters: PythonEnvironment[]): Promise<PythonEnvironment[]> {
        const items = interpreters
            .map((item) => ({ ...item }))
            .map((item) => {
                item.path = path.normalize(item.path);
                return item;
            })
            .reduce<PythonEnvironment[]>((accumulator, current: PythonEnvironment) => {
                const currentVersion = current && current.version ? current.version.raw : undefined;
                let existingItem = accumulator.find((item) => {
                    // If same version and same base path, then ignore.
                    // Could be Python 3.6 with path = python.exe, and Python 3.6 and path = python3.exe.
                    if (
                        item.version &&
                        item.version.raw === currentVersion &&
                        item.path &&
                        current.path &&
                        this.fs.arePathsSame(path.dirname(item.path), path.dirname(current.path))
                    ) {
                        return true;
                    }
                    return false;
                });
                if (!existingItem) {
                    accumulator.push(current);
                } else {
                    // Preserve type information.
                    // Possible we identified environment as unknown, but a later provider has identified env type.
                    if (
                        existingItem.envType === EnvironmentType.Unknown &&
                        current.envType !== EnvironmentType.Unknown
                    ) {
                        existingItem.envType = current.envType;
                    }
                    const props: (keyof PythonEnvironment)[] = [
                        'envName',
                        'envPath',
                        'path',
                        'sysPrefix',
                        'architecture',
                        'sysVersion',
                        'version',
                    ];
                    props.forEach((prop) => {
                        if (existingItem && !existingItem[prop] && current[prop]) {
                            existingItem = { ...existingItem, [prop]: current[prop] };
                        }
                    });
                }
                return accumulator;
            }, []);
        // This stuff needs to be fast.
        await Promise.all(
            items.map(async (item) => {
                const info = await this.pipEnvServiceHelper.getPipEnvInfo(item.path);
                if (info) {
                    item.envType = EnvironmentType.Pipenv;
                    item.pipEnvWorkspaceFolder = info.workspaceFolder.fsPath;
                    item.envName = info.envName || item.envName;
                }
            }),
        );
        return items;
    }
}
