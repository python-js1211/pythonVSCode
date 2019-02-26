// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as colors from 'colors/safe';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionRootDir } from '../constants';

/**
 * In order to compile the extension in strict mode, one of the dependencies (@jupyterlab) has some files that
 * just won't compile in strict mode.
 * Unfortunately we cannot fix it by overriding their type definitions
 * Note: that has been done for a few of the JupyterLabl files (see typings/index.d.ts).
 * The solution is to modify the type definition file after `npm install`.
 */
function fixJupyterLabDTSFiles() {
    const relativePath = path.join(
        'node_modules',
        '@jupyterlab',
        'coreutils',
        'lib',
        'settingregistry.d.ts'
    );
    const filePath = path.join(
        ExtensionRootDir, relativePath
    );
    if (!fs.existsSync(filePath)) {
        throw new Error(`Type Definition file from JupyterLab not found '${filePath}' (pvsc post install script)`);
    }

    const fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    if (fileContents.indexOf('[key: string]: ISchema | undefined;') > 0) {
        // tslint:disable-next-line:no-console
        console.log(colors.blue(`${relativePath} file already updated (by Python VSC)`));
        return;
    }
    const replacedText = fileContents.replace('[key: string]: ISchema;', '[key: string]: ISchema | undefined;');
    if (fileContents === replacedText) {
        throw new Error('Fix for JupyterLabl file \'settingregistry.d.ts\' failed (pvsc post install script)');
    }
    fs.writeFileSync(filePath, replacedText);
    // tslint:disable-next-line:no-console
    console.log(colors.green(`${relativePath} file updated (by Python VSC)`));
}

fixJupyterLabDTSFiles();
