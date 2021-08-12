// Experiment to check whether to show "Extension Survey prompt" or not.
export enum ShowExtensionSurveyPrompt {
    experiment = 'pythonSurveyNotification',
}

/*
 * Experiment to check whether the extension should deprecate `python.pythonPath` setting
 */
export enum DeprecatePythonPath {
    experiment = 'pythonDeprecatePythonPath',
}

// Experiment to switch Jedi to use an LSP instead of direct providers
export enum JediLSP {
    experiment = 'pythonJediLSP',
}
// Experiment to show a prompt asking users to join python mailing list.
export enum JoinMailingListPromptVariants {
    variant1 = 'pythonJoinMailingListVar1',
    variant2 = 'pythonJoinMailingListVar2',
    variant3 = 'pythonJoinMailingListVar3',
}

// Feature flag for 'Python: Launch TensorBoard' feature
export enum NativeTensorBoard {
    experiment = 'pythonTensorboardExperiment',
}

// Experiment to control which environment discovery mechanism can be used
export enum DiscoveryVariants {
    discoverWithFileWatching = 'pythonDiscoveryModule',
    discoveryWithoutFileWatching = 'pythonDiscoveryModuleWithoutWatcher',
}

// Find Interpreter suggestion experiment variants
export enum FindInterpreterVariants {
    useFind = 'pythonFindInterpreter',
}

// Feature gate to control whether we install the PyTorch profiler package
// torch.profiler release is being delayed till end of March. This allows us
// to turn on the profiler plugin install functionality between releases
export enum TorchProfiler {
    experiment = 'PythonPyTorchProfiler',
}

// Experiment to use the new environment sorting algorithm in the interpreter quickpick.
export enum EnvironmentSorting {
    experiment = 'pythonSortEnvs',
}

// Experiment to show the run failed tests button
export enum ShowRunFailedTests {
    experiment = 'pythonRunFailedTestsButtonDisplayed',
}

// Experiment to show the run failed tests button
export enum ShowRefreshTests {
    experiment = 'pythonRefreshTestsButtonDisplayed',
}
