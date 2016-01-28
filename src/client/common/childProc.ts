'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';

export function sendCommand(commandLine: string, cwd: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {

        child_process.exec(commandLine, { cwd: cwd }, (error, stdout, stderr) => {
            var hasErrors = (error && error.message.length > 0) || (stderr && stderr.length > 0);
            if (hasErrors && (typeof stdout !== "string" || stdout.length === 0)) {
                var errorMsg = (error && error.message) ? error.message : (stderr && stderr.length > 0 ? stderr.toString("utf-8") : "");
                return reject(errorMsg);
            }

            resolve(stdout.toString('utf-8'));
        });
    });
}
