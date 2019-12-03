// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { nbformat } from '@jupyterlab/coreutils';
import { Kernel } from '@jupyterlab/services';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken } from 'vscode';
import { Cancellation } from '../../../common/cancellation';
import { PYTHON_LANGUAGE } from '../../../common/constants';
import '../../../common/extensions';
import { traceDecorators, traceError, traceInfo, traceWarning } from '../../../common/logger';
import { IFileSystem } from '../../../common/platform/types';
import { IProcessServiceFactory } from '../../../common/process/types';
import { IAsyncDisposableRegistry, ReadWrite } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { IEnvironmentActivationService } from '../../../interpreter/activation/types';
import { IInterpreterService, PythonInterpreter } from '../../../interpreter/contracts';
import { captureTelemetry } from '../../../telemetry';
import { JupyterCommands, RegExpValues, Telemetry } from '../../constants';
import { IJupyterExecution, IJupyterKernelSpec, IJupyterSessionManager } from '../../types';
import { JupyterCommandFinder, ModuleExistsStatus } from '../jupyterCommandFinder';
import { JupyterKernelSpec } from './jupyterKernelSpec';

/**
 * Helper to ensure we can differentiate between two types in union types, keeping typing information.
 * (basically avoiding the need to case using `as`).
 * We cannot use `xx in` as jupyter uses `JSONObject` which is too broad and captures anything and everything.
 *
 * @param {(nbformat.IKernelspecMetadata | PythonInterpreter)} item
 * @returns {item is PythonInterpreter}
 */
function isInterpreter(item: nbformat.IKernelspecMetadata | PythonInterpreter): item is PythonInterpreter {
    // Interpreters will not have a `display_name` property, but have `path` and `type` properties.
    return !!(item as PythonInterpreter).path && !!(item as PythonInterpreter).type && !(item as nbformat.IKernelspecMetadata).display_name;
}

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
        private readonly fileSystem: IFileSystem,
        private readonly activationHelper: IEnvironmentActivationService
    ) {}
    /**
     * Finds a kernel spec from a given session or jupyter process that matches a given spec.
     *
     * @param {nbformat.IKernelspecMetadata} kernelSpec The kernelspec (criteria) to be used when searching for a kernel.
     * @param {IJupyterSessionManager} [sessionManager] If not provided search against the jupyter process.
     * @param {CancellationToken} [cancelToken]
     * @returns {(Promise<IJupyterKernelSpec | undefined>)}
     * @memberof KernelService
     */
    public async findMatchingKernelSpec(
        kernelSpec: nbformat.IKernelspecMetadata,
        sessionManager?: IJupyterSessionManager,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined>;
    /**
     * Finds a kernel spec from a given session or jupyter process that matches a given interpreter.
     *
     * @param {PythonInterpreter} interpreter The interpreter (criteria) to be used when searching for a kernel.
     * @param {(IJupyterSessionManager | undefined)} sessionManager If not provided search against the jupyter process.
     * @param {CancellationToken} [cancelToken]
     * @returns {(Promise<IJupyterKernelSpec | undefined>)}
     * @memberof KernelService
     */
    public async findMatchingKernelSpec(
        interpreter: PythonInterpreter,
        sessionManager: IJupyterSessionManager | undefined,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined>;
    public async findMatchingKernelSpec(
        option: nbformat.IKernelspecMetadata | PythonInterpreter,
        sessionManager: IJupyterSessionManager | undefined,
        cancelToken?: CancellationToken
    ): Promise<IJupyterKernelSpec | undefined> {
        const specs = await this.getKernelSpecs(sessionManager, cancelToken);
        if (isInterpreter(option)) {
            return specs.find(item => item.language === PYTHON_LANGUAGE && this.fileSystem.arePathsSame(item.metadata?.interpreter?.path || '', option.path));
        } else {
            return specs.find(item => item.language === PYTHON_LANGUAGE && item.display_name === option.display_name && item.name === option.name);
        }
    }

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
    /**
     * Registers an interprter as a kernel.
     * The assumption is that `ipykernel` has been installed in the interpreter.
     * Kernel created will have following characteristics:
     * - display_name = Display name of the interpreter.
     * - metadata.interperter = Interpreter information (useful in finding a kernel that matches a given interpreter)
     * - env = Will have environment variables of the activated environment.
     *
     * @param {PythonInterpreter} interpreter
     * @param {CancellationToken} [cancelToken]
     * @returns {Promise<IJupyterKernelSpec>}
     * @memberof KernelService
     */
    @captureTelemetry(Telemetry.RegisterInterpreterAsKernel, undefined, true)
    @traceDecorators.error('Failed to register an interpreter as a kernel')
    public async registerKernel(interpreter: PythonInterpreter, cancelToken?: CancellationToken): Promise<IJupyterKernelSpec> {
        if (!interpreter.displayName){
            throw new Error('Interpreter does not have a display name');
        }
        const ipykernelCommand = await this.commandFinder.findBestCommand(JupyterCommands.KernelCreateCommand, cancelToken);
        if (ipykernelCommand.status === ModuleExistsStatus.NotFound || !ipykernelCommand.command){
            throw new Error('Command not found to install the kernel');
        }
        const name = await this.generateKernelNameForIntepreter(interpreter);
        const output = await ipykernelCommand.command.exec(['install', '--user', '--name', name, '--display-name', interpreter.displayName], {
            throwOnStdErr: true,
            encoding: 'utf8',
            token: cancelToken
        });
        const kernel = await this.findMatchingKernelSpec({display_name: interpreter.displayName, name}, undefined, cancelToken);
        if (!kernel){
            const error = `Kernel not created with the name ${name}, display_name ${interpreter.displayName}. Output is ${output.stdout}`;
            throw new Error(error);
        }
        if (!(kernel instanceof JupyterKernelSpec)) {
            const error = `Kernel not registered locally, created with the name ${name}, display_name ${interpreter.displayName}. Output is ${output.stdout}`;
            throw new Error(error);
        }
        if (!kernel.specFile){
            const error = `kernel.json not created with the name ${name}, display_name ${interpreter.displayName}. Output is ${output.stdout}`;
            throw new Error(error);
        }
        const specModel: ReadWrite<Kernel.ISpecModel> = JSON.parse(await this.fileSystem.readFile(kernel.specFile));

        // Get the activated environment variables (as a work around for `conda run` and similar).
        // This ensures the code runs within the context of an activated environment.
        specModel.env = await this.activationHelper.getActivatedEnvironmentVariables(undefined, interpreter, true)
                                // tslint:disable-next-line: no-any
                                .catch(noop).then(env => (env || {}) as any);

        // Ensure we update the metadata to include interpreter stuff as well (we'll use this to search kernels that match an interpreter).
        // We'll need information such as interpreter type, display name, path, etc...
        // Its just a JSON file, and the information is small, hence might as well store everything.
        specModel.metadata = specModel.metadata || {};
        // tslint:disable-next-line: no-any
        specModel.metadata.interpreter = interpreter as any;

        // Update the kernel.json with our new stuff.
        await this.fileSystem.writeFile(kernel.specFile, JSON.stringify(specModel, undefined, 2));
        kernel.metadata = specModel.metadata;

        return kernel;
    }
    /**
     * Not all characters are allowed in a kernel name.
     * This method will generate a name for a kernel based on display name and path.
     * Algorithm = <displayname - invalid characters> + <hash of path>
     *
     * @private
     * @param {PythonInterpreter} interpreter
     * @memberof KernelService
     */
    private async generateKernelNameForIntepreter(interpreter: PythonInterpreter): Promise<string> {
        return `${interpreter.displayName || ''}_${await this.fileSystem.getFileHash(interpreter.path)}`.replace(/[^A-Za-z0-9]/g, '');
    }
    private async getKernelSpecs(sessionManager?: IJupyterSessionManager, cancelToken?: CancellationToken): Promise<IJupyterKernelSpec[]> {
        const enumerator = sessionManager ? sessionManager.getActiveKernelSpecs() : this.enumerateSpecs(cancelToken);
        if (Cancellation.isCanceled(cancelToken)) {
            return [];
        }
        const specs = await enumerator;
        return specs.filter(item => !!item);
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
                        await this.fileSystem.writeFile(diskPath, JSON.stringify(specModel));
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

    private enumerateSpecs = async (_cancelToken?: CancellationToken): Promise<JupyterKernelSpec[]> => {
        // Ignore errors if there are no kernels.
        const kernelSpecCommand = await this.commandFinder.findBestCommand(JupyterCommands.KernelSpecCommand).catch(noop);

        if (!kernelSpecCommand || !kernelSpecCommand.command) {
            return [];
        }
        try {
            traceInfo('Asking for kernelspecs from jupyter');

            // Ask for our current list.
            const output = await kernelSpecCommand.command.exec(['list', '--json'], { throwOnStdErr: true, encoding: 'utf8' });

            traceInfo('Parsing kernelspecs from jupyter');
            // This should give us back a key value pair we can parse
            const kernelSpecs = JSON.parse(output.stdout.trim()) as Record<string, { resource_dir: string; spec: Omit<Kernel.ISpecModel, 'name'> }>;
            const specs = await Promise.all(Object.keys(kernelSpecs).map(async kernelName => {
                const specFile = path.join(kernelSpecs[kernelName].resource_dir, 'kernel.json');
                const spec = kernelSpecs[kernelName].spec;
                // Add the missing name property.
                const model = {
                    ...spec,
                    name: kernelName
                };
                // Check if the spec file exists.
                if (await this.fileSystem.fileExists(specFile)){
                    return new JupyterKernelSpec(model as Kernel.ISpecModel, specFile);
                } else {
                    return;
                }
            }));
            return specs.filter(item => !!item).map(item => item as JupyterKernelSpec);
        } catch (ex) {
            traceError('Failed to list kernels', ex);
            // This is failing for some folks. In that case return nothing
            return [];
        }
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
