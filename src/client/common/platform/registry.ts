import { injectable } from 'inversify';
import * as Registry from 'winreg';
import { Architecture } from '../../../utils/platform';
import { IRegistry, RegistryHive } from './types';

enum RegistryArchitectures {
    x86 = 'x86',
    x64 = 'x64'
}

@injectable()
export class RegistryImplementation implements IRegistry {
    public async getKeys(key: string, hive: RegistryHive, arch?: Architecture) {
        return getRegistryKeys({ hive: translateHive(hive)!, arch: translateArchitecture(arch), key });
    }
    public async getValue(key: string, hive: RegistryHive, arch?: Architecture, name: string = '') {
        return getRegistryValue({ hive: translateHive(hive)!, arch: translateArchitecture(arch), key }, name);
    }
}

export function getArchitectureDislayName(arch?: Architecture) {
    switch (arch) {
        case Architecture.x64:
            return '64-bit';
        case Architecture.x86:
            return '32-bit';
        default:
            return '';
    }
}

async function getRegistryValue(options: Registry.Options, name: string = '') {
    return new Promise<string | undefined | null>((resolve, reject) => {
        new Registry(options).get(name, (error, result) => {
            if (error || !result || typeof result.value !== 'string') {
                return resolve(undefined);
            }
            resolve(result.value);
        });
    });
}
async function getRegistryKeys(options: Registry.Options): Promise<string[]> {
    // https://github.com/python/peps/blob/master/pep-0514.txt#L85
    return new Promise<string[]>((resolve, reject) => {
        new Registry(options).keys((error, result) => {
            if (error || !Array.isArray(result)) {
                return resolve([]);
            }
            resolve(result.filter(item => typeof item.key === 'string').map(item => item.key));
        });
    });
}
function translateArchitecture(arch?: Architecture): RegistryArchitectures | undefined {
    switch (arch) {
        case Architecture.x86:
            return RegistryArchitectures.x86;
        case Architecture.x64:
            return RegistryArchitectures.x64;
        default:
            return;
    }
}
function translateHive(hive: RegistryHive): string | undefined {
    switch (hive) {
        case RegistryHive.HKCU:
            return Registry.HKCU;
        case RegistryHive.HKLM:
            return Registry.HKLM;
        default:
            return;
    }
}
