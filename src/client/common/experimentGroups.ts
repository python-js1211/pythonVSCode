export const LSControl = 'LS - control';
export const LSEnabled = 'LS - enabled';

// Experiment to check whether to always display the test explorer.
export enum AlwaysDisplayTestExplorerGroups {
    control = 'AlwaysDisplayTestExplorer - control',
    experiment = 'AlwaysDisplayTestExplorer - experiment'
}

// Experiment to check whether to show the "Run Python File in Terminal" icon.
export enum ShowPlayIcon {
    control = 'ShowPlayIcon - control',
    icon1 = 'ShowPlayIcon - start',
    icon2 = 'ShowPlayIcon - runFile'
}

// Experiment to check whether to show "Extension Survey prompt" or not.
export enum ShowExtensionSurveyPrompt {
    control = 'ShowExtensionSurveyPrompt - control',
    enabled = 'ShowExtensionSurveyPrompt - enabled'
}

// Experiment to check whether the extension should use the new VS Code debug adapter API.
export enum DebugAdapterDescriptorFactory {
    control = 'NewDebugAdapter - control',
    experiment = 'NewDebugAdapter - experiment'
}

// Experiment to check whether the ptvsd launcher should use pre-installed ptvsd wheels for debugging.
export enum DebugAdapterNewPtvsd {
    control = 'PtvsdWheels - control',
    experiment = 'PtvsdWheels - experiment'
}

// Dummy experiment added to validate metrics of A/B testing
export enum ValidateABTesting {
    control = 'AA_testing - control',
    experiment = 'AA_testing - experiment'
}
