// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fsapi from 'fs-extra';
import * as path from 'path';
import { getSearchPathEntries } from '../../common/utils/exec';

/**
 * Determine if the given filename looks like the simplest Python executable.
 */
export function matchBasicPythonBinFilename(filename: string): boolean {
    return path.basename(filename) === 'python';
}

/**
 * Checks if a given path ends with python*.exe
 * @param {string} interpreterPath : Path to python interpreter.
 * @returns {boolean} : Returns true if the path matches pattern for windows python executable.
 */
export function matchPythonBinFilename(filename: string): boolean {
    /**
     * This Reg-ex matches following file names:
     * python
     * python3
     * python38
     * python3.8
     */
    const posixPythonBinPattern = /^python(\d+(\.\d+)?)?$/;

    return posixPythonBinPattern.test(path.basename(filename));
}

export async function commonPosixBinPaths(): Promise<string[]> {
    const searchPaths = getSearchPathEntries();

    const paths: string[] = Array.from(
        new Set(
            [
                '/bin',
                '/etc',
                '/lib',
                '/lib/x86_64-linux-gnu',
                '/lib64',
                '/sbin',
                '/snap/bin',
                '/usr/bin',
                '/usr/games',
                '/usr/include',
                '/usr/lib',
                '/usr/lib/x86_64-linux-gnu',
                '/usr/lib64',
                '/usr/libexec',
                '/usr/local',
                '/usr/local/bin',
                '/usr/local/etc',
                '/usr/local/games',
                '/usr/local/lib',
                '/usr/local/sbin',
                '/usr/sbin',
                '/usr/share',
                '~/.local/bin',
            ].concat(searchPaths),
        ),
    );

    const exists = await Promise.all(paths.map((p) => fsapi.pathExists(p)));
    return paths.filter((_, index) => exists[index]);
}
