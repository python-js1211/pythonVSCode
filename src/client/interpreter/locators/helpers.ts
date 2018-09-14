import { inject, injectable } from 'inversify';
import * as path from 'path';
import { fsReaddirAsync } from '../../../utils/fs';
import { IFileSystem, IPlatformService } from '../../common/platform/types';
import { IS_WINDOWS } from '../../common/util';
import { IServiceContainer } from '../../ioc/types';
import { IInterpreterHelper, IInterpreterLocatorHelper, InterpreterType, PythonInterpreter } from '../contracts';

const CheckPythonInterpreterRegEx = IS_WINDOWS ? /^python(\d+(.\d+)?)?\.exe$/ : /^python(\d+(.\d+)?)?$/;

export function lookForInterpretersInDirectory(pathToCheck: string): Promise<string[]> {
    return fsReaddirAsync(pathToCheck)
        .then(subDirs => subDirs.filter(fileName => CheckPythonInterpreterRegEx.test(path.basename(fileName))))
        .catch(err => {
            console.error('Python Extension (lookForInterpretersInDirectory.fsReaddirAsync):', err);
            return [] as string[];
        });
}

@injectable()
export class InterpreterLocatorHelper implements IInterpreterLocatorHelper {
    private readonly platform: IPlatformService;
    private readonly fs: IFileSystem;
    private readonly helper: IInterpreterHelper;

    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        this.platform = serviceContainer.get<IPlatformService>(IPlatformService);
        this.helper = serviceContainer.get<IInterpreterHelper>(IInterpreterHelper);
        this.fs = serviceContainer.get<IFileSystem>(IFileSystem);
    }
    public mergeInterpreters(interpreters: PythonInterpreter[]) {
        return interpreters
            .map(item => { return { ...item }; })
            .map(item => { item.path = path.normalize(item.path); return item; })
            .reduce<PythonInterpreter[]>((accumulator, current) => {
                if (this.platform.isMac && this.helper.isMacDefaultPythonPath(current.path)) {
                    return accumulator;
                }
                const currentVersion = Array.isArray(current.version_info) ? current.version_info.join('.') : undefined;
                const existingItem = accumulator.find(item => {
                    // If same version and same base path, then ignore.
                    // Could be Python 3.6 with path = python.exe, and Python 3.6 and path = python3.exe.
                    if (Array.isArray(item.version_info) && item.version_info.join('.') === currentVersion &&
                        item.path && current.path &&
                        this.fs.arePathsSame(path.dirname(item.path), path.dirname(current.path))) {
                        return true;
                    }
                    return false;
                });
                if (!existingItem) {
                    accumulator.push(current);
                } else {
                    // Preserve type information.
                    // Possible we identified environment as unknown, but a later provider has identified env type.
                    if (existingItem.type === InterpreterType.Unknown && current.type !== InterpreterType.Unknown) {
                        existingItem.type = current.type;
                    }
                    const props: (keyof PythonInterpreter)[] = ['envName', 'envPath', 'path', 'sysPrefix',
                        'architecture', 'sysVersion', 'version', 'version_info'];
                    for (const prop of props) {
                        if (!existingItem[prop] && current[prop]) {
                            existingItem[prop] = current[prop];
                        }
                    }
                }
                return accumulator;
            }, []);
    }
}
