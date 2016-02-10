'use strict';

import * as path from 'path';
import * as baseLinter from './baseLinter';
import * as settings from './../common/configSettings';
import {OutputChannel} from 'vscode';

const FLAKE8_COMMANDLINE = " --format='%(row)d,%(col)d,%(code)s,%(code)s:%(text)s'";

export class Linter extends baseLinter.BaseLinter {
    constructor(rootDir: string, pythonSettings: settings.IPythonSettings, outputChannel: OutputChannel) {
        super("flake8", pythonSettings, outputChannel);
    }

    public runLinter(filePath: string, txtDocumentLines: string[]): Promise<baseLinter.ILintMessage[]> {
        if (!this.pythonSettings.linting.flake8Enabled) {
            return Promise.resolve([]);
        }

        var flake8Path = this.pythonSettings.linting.flake8Path;
        var cmdLine = `${flake8Path} ${FLAKE8_COMMANDLINE} ${filePath}`;
        return new Promise<baseLinter.ILintMessage[]>((resolve, reject) => {
            this.run(cmdLine, filePath, txtDocumentLines).then(messages=> {
                //All messages in pep8 are treated as warnings for now
                messages.forEach(msg=> {
                    msg.severity = baseLinter.LintMessageSeverity.Information;
                });

                resolve(messages);
            }, reject);
        });
    }
}
