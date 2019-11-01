// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { Kernel } from '@jupyterlab/services';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken } from 'vscode';
import '../../common/extensions';
import { traceError, traceInfo, traceWarning } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IProcessServiceFactory } from '../../common/process/types';
import { IAsyncDisposableRegistry } from '../../common/types';
import * as localize from '../../common/utils/localize';
import { noop } from '../../common/utils/misc';
import { IInterpreterService, PythonInterpreter } from '../../interpreter/contracts';
import { captureTelemetry } from '../../telemetry';
import { JupyterCommands, RegExpValues, Telemetry } from '../constants';
import { IJupyterExecution, IJupyterKernelSpec, IJupyterSessionManager } from '../types';
import { JupyterCommandFinder } from './jupyterCommandFinder';
import { JupyterKernelSpec } from './jupyterKernelSpec';

/**
 * Responsible for kernel management and the like.
 *
 * @export
 * @class KernelService
 */
export class KernelService {
    constructor(
        private readonly jupyterExecution: IJupyterExecution,
        private readonly commandFinder: JupyterCommandFinder,
        private readonly asyncRegistry: IAsyncDisposableRegistry,
        private readonly processServiceFactory: IProcessServiceFactory,
        private readonly interpreterService: IInterpreterService,
        private readonly fileSystem: IFileSystem
    ) {}
    @captureTelemetry(Telemetry.FindJupyterKernelSpec)
    public async getMatchingKernelSpec(sessionManager: IJupyterSessionManager | undefined, cancelToken?: CancellationToken): Promise<IJupyterKernelSpec | undefined> {
        try {
            // If not using an active connection, check on disk
            if (!sessionManager) {
                traceInfo('Searching for best interpreter');

                // Get our best interpreter. We want its python path
                const bestInterpreter = await this.jupyterExecution.getUsableJupyterPython(cancelToken);

                traceInfo(`Best interpreter is ${bestInterpreter ? bestInterpreter.path : 'notfound'}`);

                // Enumerate our kernel specs that jupyter will know about and see if
                // one of them already matches based on path
                if (bestInterpreter && !(await this.hasSpecPathMatch(bestInterpreter, cancelToken))) {
                    // Nobody matches on path, so generate a new kernel spec
                    if (await this.jupyterExecution.isKernelCreateSupported(cancelToken)) {
                        await this.addMatchingSpec(bestInterpreter, cancelToken);
                    }
                }
            }

            // Now enumerate them again
            const enumerator = sessionManager ? () => sessionManager.getActiveKernelSpecs() : () => this.enumerateSpecs(cancelToken);

            // Then find our match
            return this.findSpecMatch(enumerator);
        } catch (e) {
            // ECONNREFUSED seems to happen here. Log the error, but don't let it bubble out. We don't really need a kernel spec
            traceWarning(e);

            // Double check our jupyter server is still running.
            if (sessionManager && sessionManager.getConnInfo().localProcExitCode) {
                throw new Error(localize.DataScience.jupyterServerCrashed().format(sessionManager!.getConnInfo().localProcExitCode!.toString()));
            }
        }
    }
    private hasSpecPathMatch = async (info: PythonInterpreter | undefined, cancelToken?: CancellationToken): Promise<boolean> => {
        if (info) {
            // Enumerate our specs
            const specs = await this.enumerateSpecs(cancelToken);

            // See if any of their paths match
            return (
                specs.findIndex(s => {
                    if (info && s && s.path) {
                        return this.fileSystem.arePathsSame(s.path, info.path);
                    }
                    return false;
                }) >= 0
            );
        }

        // If no active interpreter, just act like everything is okay as we can't find a new spec anyway
        return true;
    }

    private async addMatchingSpec(bestInterpreter: PythonInterpreter, cancelToken?: CancellationToken): Promise<void> {
        const displayName = localize.DataScience.historyTitle();
        const ipykernelCommand = await this.commandFinder.findBestCommand(JupyterCommands.KernelCreateCommand, cancelToken);

        // If this fails, then we just skip this spec
        try {
            // Run the ipykernel install command. This will generate a new kernel spec. However
            // it will be pointing to the python that ran it. We'll fix that up afterwards
            const name = uuid();
            if (ipykernelCommand && ipykernelCommand.command) {
                const result = await ipykernelCommand.command.exec(['install', '--user', '--name', name, '--display-name', `'${displayName}'`], {
                    throwOnStdErr: true,
                    encoding: 'utf8',
                    token: cancelToken
                });

                // Result should have our file name.
                const match = RegExpValues.PyKernelOutputRegEx.exec(result.stdout);
                const diskPath = match && match !== null && match.length > 1 ? path.join(match[1], 'kernel.json') : await this.findSpecPath(name);

                // Make sure we delete this file at some point. When we close VS code is probably good. It will also be destroy when
                // the kernel spec goes away
                this.asyncRegistry.push({
                    dispose: async () => {
                        if (!diskPath) {
                            return;
                        }
                        try {
                            await this.fileSystem.deleteDirectory(path.dirname(diskPath));
                        } catch {
                            noop();
                        }
                    }
                });

                // If that works, rewrite our active interpreter into the argv
                if (diskPath && bestInterpreter) {
                    if (await this.fileSystem.fileExists(diskPath)) {
                        const specModel: Kernel.ISpecModel = JSON.parse(await this.fileSystem.readFile(diskPath));
                        specModel.argv[0] = bestInterpreter.path;
                        await this.fileSystem.writeFile(diskPath, JSON.stringify(specModel), { flag: 'w', encoding: 'utf8' });
                    }
                }
            }
        } catch (err) {
            traceError(err);
        }
    }

    private findSpecPath = async (specName: string, cancelToken?: CancellationToken): Promise<string | undefined> => {
        // Enumerate all specs and get path for the match
        const specs = await this.enumerateSpecs(cancelToken);
        const match = specs!
            .filter(s => s !== undefined)
            .find(s => {
                const js = s as JupyterKernelSpec;
                return js && js.name === specName;
            }) as JupyterKernelSpec;
        return match ? match.specFile : undefined;
    }

    //tslint:disable-next-line:cyclomatic-complexity
    private findSpecMatch = async (enumerator: () => Promise<(IJupyterKernelSpec | undefined)[]>): Promise<IJupyterKernelSpec | undefined> => {
        traceInfo('Searching for a kernelspec match');
        // Extract our current python information that the user has picked.
        // We'll match against this.
        const info = await this.interpreterService.getActiveInterpreter();
        let bestScore = 0;
        let bestSpec: IJupyterKernelSpec | undefined;

        // Then enumerate our specs
        const specs = await enumerator();

        // For each get its details as we will likely need them
        const specDetails = await Promise.all(
            specs.map(async s => {
                if (s && s.path && s.path.length > 0 && (await this.fileSystem.fileExists(s.path))) {
                    return this.interpreterService.getInterpreterDetails(s.path);
                }
                if (s && s.path && s.path.length > 0 && path.basename(s.path) === s.path) {
                    // This means the s.path isn't fully qualified. Try figuring it out.
                    return this.getInterpreterDetailsFromProcess(s.path);
                }
            })
        );

        for (let i = 0; specs && i < specs.length; i += 1) {
            const spec = specs[i];
            let score = 0;

            // First match on language. No point if not python.
            if (spec && spec.language && spec.language.toLocaleLowerCase() === 'python') {
                // Language match
                score += 1;

                // See if the path matches. Don't bother if the language doesn't.
                if (spec && spec.path && spec.path.length > 0 && info && spec.path === info.path) {
                    // Path match
                    score += 10;
                }

                // See if the version is the same
                if (info && info.version && specDetails[i]) {
                    const details = specDetails[i];
                    if (details && details.version) {
                        if (details.version.major === info.version.major) {
                            // Major version match
                            score += 4;

                            if (details.version.minor === info.version.minor) {
                                // Minor version match
                                score += 2;

                                if (details.version.patch === info.version.patch) {
                                    // Minor version match
                                    score += 1;
                                }
                            }
                        }
                    }
                } else if (info && info.version && spec && spec.path && spec.path.toLocaleLowerCase() === 'python' && spec.name) {
                    // This should be our current python.

                    // Search for a digit on the end of the name. It should match our major version
                    const match = /\D+(\d+)/.exec(spec.name);
                    if (match && match !== null && match.length > 0) {
                        // See if the version number matches
                        const nameVersion = parseInt(match[0], 10);
                        if (nameVersion && nameVersion === info.version.major) {
                            score += 4;
                        }
                    }
                }
            }

            // Update high score
            if (score > bestScore) {
                bestScore = score;
                bestSpec = spec;
            }
        }

        // If still not set, at least pick the first one
        if (!bestSpec && specs && specs.length > 0) {
            bestSpec = specs[0];
        }

        traceInfo(`Found kernelspec match ${bestSpec ? `${bestSpec.name}' '${bestSpec.path}` : 'undefined'}`);
        return bestSpec;
    }

    private async readSpec(kernelSpecOutputLine: string): Promise<JupyterKernelSpec | undefined> {
        const match = RegExpValues.KernelSpecOutputRegEx.exec(kernelSpecOutputLine);
        if (match && match !== null && match.length > 2) {
            // Second match should be our path to the kernel spec
            const file = path.join(match[2], 'kernel.json');
            try {
                if (await this.fileSystem.fileExists(file)) {
                    // Turn this into a IJupyterKernelSpec
                    const model = JSON.parse(await this.fileSystem.readFile(file));
                    model.name = match[1];
                    return new JupyterKernelSpec(model, file);
                }
            } catch {
                // Just return nothing if we can't parse.
            }
        }

        return undefined;
    }

    private enumerateSpecs = async (_cancelToken?: CancellationToken): Promise<(JupyterKernelSpec | undefined)[]> => {
        if (await this.jupyterExecution.isKernelSpecSupported()) {
            const kernelSpecCommand = await this.commandFinder.findBestCommand(JupyterCommands.KernelSpecCommand);

            if (kernelSpecCommand.command) {
                try {
                    traceInfo('Asking for kernelspecs from jupyter');

                    // Ask for our current list.
                    const list = await kernelSpecCommand.command.exec(['list'], { throwOnStdErr: true, encoding: 'utf8' });

                    traceInfo('Parsing kernelspecs from jupyter');

                    // This should give us back a key value pair we can parse
                    const lines = list.stdout.splitLines({ trim: false, removeEmptyEntries: true });

                    // Generate all of the promises at once
                    const promises = lines.map(l => this.readSpec(l));

                    traceInfo('Awaiting the read of kernelspecs from jupyter');

                    // Then let them run concurrently (they are file io)
                    const specs = await Promise.all(promises);

                    traceInfo('Returning kernelspecs from jupyter');
                    return specs!.filter(s => s);
                } catch {
                    // This is failing for some folks. In that case return nothing
                    return [];
                }
            }
        }

        return [];
    }
    private async getInterpreterDetailsFromProcess(baseProcessName: string): Promise<PythonInterpreter | undefined> {
        if (path.basename(baseProcessName) !== baseProcessName) {
            // This function should only be called with a non qualified path. We're using this
            // function to figure out the qualified path
            return undefined;
        }

        // Make sure it's python based
        if (!baseProcessName.toLocaleLowerCase().includes('python')) {
            return undefined;
        }

        try {
            // Create a new process service to use to execute this process
            const processService = await this.processServiceFactory.create();

            // Ask python for what path it's running at.
            const output = await processService.exec(baseProcessName, ['-c', 'import sys;print(sys.executable)'], { throwOnStdErr: true });
            const fullPath = output.stdout.trim();

            // Use this path to get the interpreter details.
            return this.interpreterService.getInterpreterDetails(fullPath);
        } catch {
            // Any failure, just assume this path is invalid.
            return undefined;
        }
    }
}
