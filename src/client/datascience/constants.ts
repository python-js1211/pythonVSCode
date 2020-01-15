// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { PYTHON_LANGUAGE } from '../common/constants';
import { IS_WINDOWS } from '../common/platform/constants';
import { IVariableQuery } from '../common/types';
import { NativeCommandType } from './interactive-common/interactiveWindowTypes';

export const DefaultTheme = 'Default Light+';
// Identifier for the output panel that will display the output from the Jupyter Server.
export const JUPYTER_OUTPUT_CHANNEL = 'JUPYTER_OUTPUT_CHANNEL';

// Python Module to be used when instantiating the Python Daemon.
export const PythonDaemonModule = 'datascience.jupyter_daemon';

export namespace Commands {
    export const RunAllCells = 'python.datascience.runallcells';
    export const RunAllCellsAbove = 'python.datascience.runallcellsabove';
    export const RunCellAndAllBelow = 'python.datascience.runcellandallbelow';
    export const SwitchJupyterKernel = 'python.datascience.switchKernel';
    export const RunAllCellsAbovePalette = 'python.datascience.runallcellsabove.palette';
    export const RunCellAndAllBelowPalette = 'python.datascience.runcurrentcellandallbelow.palette';
    export const RunToLine = 'python.datascience.runtoline';
    export const RunFromLine = 'python.datascience.runfromline';
    export const RunCell = 'python.datascience.runcell';
    export const RunCurrentCell = 'python.datascience.runcurrentcell';
    export const RunCurrentCellAdvance = 'python.datascience.runcurrentcelladvance';
    export const ShowHistoryPane = 'python.datascience.showhistorypane';
    export const ImportNotebook = 'python.datascience.importnotebook';
    export const ImportNotebookFile = 'python.datascience.importnotebookfile';
    export const OpenNotebook = 'python.datascience.opennotebook';
    export const SelectJupyterURI = 'python.datascience.selectjupyteruri';
    export const ExportFileAsNotebook = 'python.datascience.exportfileasnotebook';
    export const ExportFileAndOutputAsNotebook = 'python.datascience.exportfileandoutputasnotebook';
    export const UndoCells = 'python.datascience.undocells';
    export const RedoCells = 'python.datascience.redocells';
    export const RemoveAllCells = 'python.datascience.removeallcells';
    export const InterruptKernel = 'python.datascience.interruptkernel';
    export const RestartKernel = 'python.datascience.restartkernel';
    export const NotebookEditorUndoCells = 'python.datascience.notebookeditor.undocells';
    export const NotebookEditorRedoCells = 'python.datascience.notebookeditor.redocells';
    export const NotebookEditorRemoveAllCells = 'python.datascience.notebookeditor.removeallcells';
    export const NotebookEditorInterruptKernel = 'python.datascience.notebookeditor.interruptkernel';
    export const NotebookEditorRestartKernel = 'python.datascience.notebookeditor.restartkernel';
    export const NotebookEditorRunAllCells = 'python.datascience.notebookeditor.runallcells';
    export const NotebookEditorRunSelectedCell = 'python.datascience.notebookeditor.runselectedcell';
    export const NotebookEditorAddCellBelow = 'python.datascience.notebookeditor.addcellbelow';
    export const ExpandAllCells = 'python.datascience.expandallcells';
    export const CollapseAllCells = 'python.datascience.collapseallcells';
    export const ExportOutputAsNotebook = 'python.datascience.exportoutputasnotebook';
    export const ExecSelectionInInteractiveWindow = 'python.datascience.execSelectionInteractive';
    export const RunFileInInteractiveWindows = 'python.datascience.runFileInteractive';
    export const DebugFileInInteractiveWindows = 'python.datascience.debugFileInteractive';
    export const AddCellBelow = 'python.datascience.addcellbelow';
    export const DebugCurrentCellPalette = 'python.datascience.debugcurrentcell.palette';
    export const DebugCell = 'python.datascience.debugcell';
    export const DebugStepOver = 'python.datascience.debugstepover';
    export const DebugContinue = 'python.datascience.debugcontinue';
    export const DebugStop = 'python.datascience.debugstop';
    export const RunCurrentCellAndAddBelow = 'python.datascience.runcurrentcellandaddbelow';
    export const ScrollToCell = 'python.datascience.scrolltocell';
    export const CreateNewNotebook = 'python.datascience.createnewnotebook';
    export const ViewJupyterOutput = 'python.datascience.viewJupyterOutput';
}

export namespace CodeLensCommands {
    // If not specified in the options this is the default set of commands in our design time code lenses
    export const DefaultDesignLenses = [Commands.RunCurrentCell, Commands.RunAllCellsAbove, Commands.DebugCell];
    // If not specified in the options this is the default set of commands in our debug time code lenses
    export const DefaultDebuggingLenses = [Commands.DebugContinue, Commands.DebugStop, Commands.DebugStepOver];
    // These are the commands that are allowed at debug time
    export const DebuggerCommands = [Commands.DebugContinue, Commands.DebugStop, Commands.DebugStepOver];
}

export namespace EditorContexts {
    export const HasCodeCells = 'python.datascience.hascodecells';
    export const DataScienceEnabled = 'python.datascience.featureenabled';
    export const HaveInteractiveCells = 'python.datascience.haveinteractivecells';
    export const HaveRedoableCells = 'python.datascience.haveredoablecells';
    export const HaveInteractive = 'python.datascience.haveinteractive';
    export const IsInteractive = 'python.datascience.isinteractive';
    export const OwnsSelection = 'python.datascience.ownsSelection';
    export const HaveNativeCells = 'python.datascience.havenativecells';
    export const HaveNativeRedoableCells = 'python.datascience.havenativeredoablecells';
    export const HaveNative = 'python.datascience.havenative';
    export const IsNative = 'python.datascience.isnative';
    export const HaveCellSelected = 'python.datascience.havecellselected';
}

export namespace RegExpValues {
    export const PythonCellMarker = /^(#\s*%%|#\s*\<codecell\>|#\s*In\[\d*?\]|#\s*In\[ \])/;
    export const PythonMarkdownCellMarker = /^(#\s*%%\s*\[markdown\]|#\s*\<markdowncell\>)/;
    export const CheckJupyterRegEx = IS_WINDOWS ? /^jupyter?\.exe$/ : /^jupyter?$/;
    export const PyKernelOutputRegEx = /.*\s+(.+)$/m;
    export const KernelSpecOutputRegEx = /^\s*(\S+)\s+(\S+)$/;
    // This next one has to be a string because uglifyJS isn't handling the groups. We use named-js-regexp to parse it
    // instead.
    export const UrlPatternRegEx = '(?<PREFIX>https?:\\/\\/)((\\(.+\\s+or\\s+(?<IP>.+)\\))|(?<LOCAL>[^\\s]+))(?<REST>:.+)';
    export interface IUrlPatternGroupType {
        LOCAL: string | undefined;
        PREFIX: string | undefined;
        REST: string | undefined;
        IP: string | undefined;
    }
    export const HttpPattern = /https?:\/\//;
    export const ExtractPortRegex = /https?:\/\/[^\s]+:(\d+)[^\s]+/;
    export const ConvertToRemoteUri = /(https?:\/\/)([^\s])+(:\d+[^\s]*)/;
    export const ParamsExractorRegEx = /\S+\((.*)\)\s*{/;
    export const ArgsSplitterRegEx = /([^\s,]+)/;
    export const ShapeSplitterRegEx = /.*,\s*(\d+).*/;
    export const SvgHeightRegex = /(\<svg.*height=\")(.*?)\"/;
    export const SvgWidthRegex = /(\<svg.*width=\")(.*?)\"/;
    export const SvgSizeTagRegex = /\<svg.*tag=\"sizeTag=\{(.*),\s*(.*)\}\"/;
    export const StyleTagRegex = /\<style[\s\S]*\<\/style\>/m;
}

export enum Telemetry {
    ImportNotebook = 'DATASCIENCE.IMPORT_NOTEBOOK',
    RunCell = 'DATASCIENCE.RUN_CELL',
    RunCurrentCell = 'DATASCIENCE.RUN_CURRENT_CELL',
    RunCurrentCellAndAdvance = 'DATASCIENCE.RUN_CURRENT_CELL_AND_ADVANCE',
    RunAllCells = 'DATASCIENCE.RUN_ALL_CELLS',
    RunAllCellsAbove = 'DATASCIENCE.RUN_ALL_CELLS_ABOVE',
    RunCellAndAllBelow = 'DATASCIENCE.RUN_CELL_AND_ALL_BELOW',
    RunSelectionOrLine = 'DATASCIENCE.RUN_SELECTION_OR_LINE',
    RunToLine = 'DATASCIENCE.RUN_TO_LINE',
    RunFromLine = 'DATASCIENCE.RUN_FROM_LINE',
    DeleteAllCells = 'DATASCIENCE.DELETE_ALL_CELLS',
    DeleteCell = 'DATASCIENCE.DELETE_CELL',
    GotoSourceCode = 'DATASCIENCE.GOTO_SOURCE',
    CopySourceCode = 'DATASCIENCE.COPY_SOURCE',
    RestartKernel = 'DATASCIENCE.RESTART_KERNEL',
    ExportNotebook = 'DATASCIENCE.EXPORT_NOTEBOOK',
    Undo = 'DATASCIENCE.UNDO',
    Redo = 'DATASCIENCE.REDO',
    /**
     * Saving a notebook
     */
    Save = 'DATASCIENCE.SAVE',
    CellCount = 'DATASCIENCE.CELL_COUNT',
    /**
     * Whether auto save feature in VS Code is enabled or not.
     */
    ShowHistoryPane = 'DATASCIENCE.SHOW_HISTORY_PANE',
    ExpandAll = 'DATASCIENCE.EXPAND_ALL',
    CollapseAll = 'DATASCIENCE.COLLAPSE_ALL',
    SelectJupyterURI = 'DATASCIENCE.SELECT_JUPYTER_URI',
    SelectLocalJupyterKernel = 'DATASCIENCE.SELECT_LOCAL_JUPYTER_KERNEL',
    SelectRemoteJupyuterKernel = 'DATASCIENCE.SELECT_REMOTE_JUPYTER_KERNEL',
    SetJupyterURIToLocal = 'DATASCIENCE.SET_JUPYTER_URI_LOCAL',
    SetJupyterURIToUserSpecified = 'DATASCIENCE.SET_JUPYTER_URI_USER_SPECIFIED',
    Interrupt = 'DATASCIENCE.INTERRUPT',
    ExportPythonFile = 'DATASCIENCE.EXPORT_PYTHON_FILE',
    ExportPythonFileAndOutput = 'DATASCIENCE.EXPORT_PYTHON_FILE_AND_OUTPUT',
    StartJupyter = 'DATASCIENCE.JUPYTERSTARTUPCOST',
    SubmitCellThroughInput = 'DATASCIENCE.SUBMITCELLFROMREPL',
    ConnectLocalJupyter = 'DATASCIENCE.CONNECTLOCALJUPYTER',
    ConnectRemoteJupyter = 'DATASCIENCE.CONNECTREMOTEJUPYTER',
    ConnectFailedJupyter = 'DATASCIENCE.CONNECTFAILEDJUPYTER',
    ConnectRemoteFailedJupyter = 'DATASCIENCE.CONNECTREMOTEFAILEDJUPYTER',
    StartSessionFailedJupyter = 'DATASCIENCE.START_SESSION_FAILED_JUPYTER',
    ConnectRemoteSelfCertFailedJupyter = 'DATASCIENCE.CONNECTREMOTESELFCERTFAILEDJUPYTER',
    RegisterAndUseInterpreterAsKernel = 'DATASCIENCE.REGISTER_AND_USE_INTERPRETER_AS_KERNEL',
    UseInterpreterAsKernel = 'DATASCIENCE.USE_INTERPRETER_AS_KERNEL',
    UseExistingKernel = 'DATASCIENCE.USE_EXISTING_KERNEL',
    SwitchToInterpreterAsKernel = 'DATASCIENCE.SWITCH_TO_INTERPRETER_AS_KERNEL',
    SwitchToExistingKernel = 'DATASCIENCE.SWITCH_TO_EXISTING_KERNEL',
    SelfCertsMessageEnabled = 'DATASCIENCE.SELFCERTSMESSAGEENABLED',
    SelfCertsMessageClose = 'DATASCIENCE.SELFCERTSMESSAGECLOSE',
    RemoteAddCode = 'DATASCIENCE.LIVESHARE.ADDCODE',
    RemoteReexecuteCode = 'DATASCIENCE.LIVESHARE.REEXECUTECODE',
    ShiftEnterBannerShown = 'DATASCIENCE.SHIFTENTER_BANNER_SHOWN',
    EnableInteractiveShiftEnter = 'DATASCIENCE.ENABLE_INTERACTIVE_SHIFT_ENTER',
    DisableInteractiveShiftEnter = 'DATASCIENCE.DISABLE_INTERACTIVE_SHIFT_ENTER',
    ShowDataViewer = 'DATASCIENCE.SHOW_DATA_EXPLORER',
    RunFileInteractive = 'DATASCIENCE.RUN_FILE_INTERACTIVE',
    DebugFileInteractive = 'DATASCIENCE.DEBUG_FILE_INTERACTIVE',
    PandasNotInstalled = 'DATASCIENCE.SHOW_DATA_NO_PANDAS',
    PandasTooOld = 'DATASCIENCE.SHOW_DATA_PANDAS_TOO_OLD',
    DataScienceSettings = 'DATASCIENCE.SETTINGS',
    VariableExplorerToggled = 'DATASCIENCE.VARIABLE_EXPLORER_TOGGLE',
    VariableExplorerVariableCount = 'DATASCIENCE.VARIABLE_EXPLORER_VARIABLE_COUNT',
    AddCellBelow = 'DATASCIENCE.ADD_CELL_BELOW',
    GetPasswordAttempt = 'DATASCIENCE.GET_PASSWORD_ATTEMPT',
    GetPasswordFailure = 'DATASCIENCE.GET_PASSWORD_FAILURE',
    GetPasswordSuccess = 'DATASCIENCE.GET_PASSWORD_SUCCESS',
    OpenPlotViewer = 'DATASCIENCE.OPEN_PLOT_VIEWER',
    DebugCurrentCell = 'DATASCIENCE.DEBUG_CURRENT_CELL',
    CodeLensAverageAcquisitionTime = 'DATASCIENCE.CODE_LENS_ACQ_TIME',
    ClassConstructionTime = 'DATASCIENCE.CLASS_CONSTRUCTION_TIME',
    FindJupyterCommand = 'DATASCIENCE.FIND_JUPYTER_COMMAND',
    /**
     * Telemetry sent when user selects an interpreter to be used for starting of Jupyter server.
     */
    SelectJupyterInterpreter = 'DATASCIENCE.SELECT_JUPYTER_INTERPRETER',
    /**
     * User used command to select an intrepreter for the jupyter server.
     */
    SelectJupyterInterpreterCommand = 'DATASCIENCE.SELECT_JUPYTER_INTERPRETER_Command',
    StartJupyterProcess = 'DATASCIENCE.START_JUPYTER_PROCESS',
    WaitForIdleJupyter = 'DATASCIENCE.WAIT_FOR_IDLE_JUPYTER',
    HiddenCellTime = 'DATASCIENCE.HIDDEN_EXECUTION_TIME',
    RestartJupyterTime = 'DATASCIENCE.RESTART_JUPYTER_TIME',
    InterruptJupyterTime = 'DATASCIENCE.INTERRUPT_JUPYTER_TIME',
    ExecuteCell = 'DATASCIENCE.EXECUTE_CELL_TIME',
    ExecuteCellPerceivedCold = 'DATASCIENCE.EXECUTE_CELL_PERCEIVED_COLD',
    ExecuteCellPerceivedWarm = 'DATASCIENCE.EXECUTE_CELL_PERCEIVED_WARM',
    WebviewStartup = 'DATASCIENCE.WEBVIEW_STARTUP',
    VariableExplorerFetchTime = 'DATASCIENCE.VARIABLE_EXPLORER_FETCH_TIME',
    WebviewStyleUpdate = 'DATASCIENCE.WEBVIEW_STYLE_UPDATE',
    WebviewMonacoStyleUpdate = 'DATASCIENCE.WEBVIEW_MONACO_STYLE_UPDATE',
    DataViewerFetchTime = 'DATASCIENCE.DATAVIEWER_FETCH_TIME',
    FindJupyterKernelSpec = 'DATASCIENCE.FIND_JUPYTER_KERNEL_SPEC',
    JupyterInstalledButNotKernelSpecModule = 'DATASCIENCE.JUPYTER_INTALLED_BUT_NO_KERNELSPEC_MODULE',
    PtvsdPromptToInstall = 'DATASCIENCE.PTVSD_PROMPT_TO_INSTALL',
    PtvsdSuccessfullyInstalled = 'DATASCIENCE.PTVSD_SUCCESSFULLY_INSTALLED',
    PtvsdInstallFailed = 'DATASCIENCE.PTVSD_INSTALL_FAILED',
    ScrolledToCell = 'DATASCIENCE.SCROLLED_TO_CELL',
    ExecuteNativeCell = 'DATASCIENCE.EXECUTE_NATIVE_CELL',
    CreateNewNotebook = 'DATASCIENCE.CREATE_NEW_NOTEBOOK',
    DebugStepOver = 'DATASCIENCE.DEBUG_STEP_OVER',
    DebugContinue = 'DATASCIENCE.DEBUG_CONTINUE',
    DebugStop = 'DATASCIENCE.DEBUG_STOP',
    OpenNotebook = 'DATASCIENCE.NATIVE.OPEN_NOTEBOOK',
    OpenNotebookAll = 'DATASCIENCE.NATIVE.OPEN_NOTEBOOK_ALL',
    ConvertToPythonFile = 'DATASCIENCE.NATIVE.CONVERT_NOTEBOOK_TO_PYTHON',
    NotebookWorkspaceCount = 'DATASCIENCE.NATIVE.WORKSPACE_NOTEBOOK_COUNT',
    NotebookRunCount = 'DATASCIENCE.NATIVE.NOTEBOOK_RUN_COUNT',
    NotebookOpenCount = 'DATASCIENCE.NATIVE.NOTEBOOK_OPEN_COUNT',
    NotebookOpenTime = 'DS_INTERNAL.NATIVE.NOTEBOOK_OPEN_TIME',
    SessionIdleTimeout = 'DATASCIENCE.JUPYTER_IDLE_TIMEOUT',
    JupyterStartTimeout = 'DATASCIENCE.JUPYTER_START_TIMEOUT',
    NotebookExecutionActivated = 'DATASCIENCE.NOTEBOOK.EXECUTION.ACTIVATED',
    JupyterNotInstalledErrorShown = 'DATASCIENCE.JUPYTER_NOT_INSTALLED_ERROR_SHOWN',
    JupyterCommandSearch = 'DATASCIENCE.JUPYTER_COMMAND_SEARCH',
    RegisterInterpreterAsKernel = 'DATASCIENCE.JUPYTER_REGISTER_INTERPRETER_AS_KERNEL',
    UserInstalledJupyter = 'DATASCIENCE.USER_INSTALLED_JUPYTER',
    UserDidNotInstallJupyter = 'DATASCIENCE.USER_DID_NOT_INSTALL_JUPYTER',
    OpenedInteractiveWindow = 'DATASCIENCE.OPENED_INTERACTIVE',
    FindKernelForLocalConnection = 'DATASCIENCE.FIND_KERNEL_FOR_LOCAL_CONNECTION'
}

export enum NativeKeyboardCommandTelemetry {
    AddToEnd = 'DATASCIENCE.NATIVE.KEYBOARD.ADD_TO_END',
    ArrowDown = 'DATASCIENCE.NATIVE.KEYBOARD.ARROW_DOWN',
    ArrowUp = 'DATASCIENCE.NATIVE.KEYBOARD.ARROW_UP',
    ChangeToCode = 'DATASCIENCE.NATIVE.KEYBOARD.CHANGE_TO_CODE',
    ChangeToMarkdown = 'DATASCIENCE.NATIVE.KEYBOARD.CHANGE_TO_MARKDOWN',
    CollapseInput = 'DATASCIENCE.NATIVE.KEYBOARD.COLLAPSE_INPUT',
    CollapseOutput = 'DATASCIENCE.NATIVE.KEYBOARD.COLLAPSE_OUTPUT',
    DeleteCell = 'DATASCIENCE.NATIVE.KEYBOARD.DELETE_CELL',
    InsertAbove = 'DATASCIENCE.NATIVE.KEYBOARD.INSERT_ABOVE',
    InsertBelow = 'DATASCIENCE.NATIVE.KEYBOARD.INSERT_BELOW',
    MoveCellDown = 'DATASCIENCE.NATIVE.KEYBOARD.MOVE_CELL_DOWN',
    MoveCellUp = 'DATASCIENCE.NATIVE.KEYBOARD.MOVE_CELL_UP',
    Run = 'DATASCIENCE.NATIVE.KEYBOARD.RUN',
    Save = 'DATASCIENCE.NATIVE.KEYBOARD.SAVE',
    RunAbove = 'DATASCIENCE.NATIVE.KEYBOARD.RUN_ABOVE',
    RunAll = 'DATASCIENCE.NATIVE.KEYBOARD.RUN_ALL',
    RunAndAdd = 'DATASCIENCE.NATIVE.KEYBOARD.RUN_AND_ADD',
    RunAndMove = 'DATASCIENCE.NATIVE.KEYBOARD.RUN_AND_MOVE',
    RunBelow = 'DATASCIENCE.NATIVE.KEYBOARD.RUN_BELOW',
    ToggleLineNumbers = 'DATASCIENCE.NATIVE.KEYBOARD.TOGGLE_LINE_NUMBERS',
    ToggleOutput = 'DATASCIENCE.NATIVE.KEYBOARD.TOGGLE_OUTPUT',
    ToggleVariableExplorer = 'DATASCIENCE.NATIVE.KEYBOARD.TOGGLE_VARIABLE_EXPLORER',
    Undo = 'DATASCIENCE.NATIVE.KEYBOARD.UNDO',
    Unfocus = 'DATASCIENCE.NATIVE.KEYBOARD.UNFOCUS'
}

export let NativeKeyboardCommandTelemetryLookup: { [id: number]: NativeKeyboardCommandTelemetry } = {};
const keys = [...Object.keys(NativeCommandType)];
const values1 = [...Object.values(NativeKeyboardCommandTelemetry)];
for (let i = 0; i < keys.length; i += 1) {
    NativeKeyboardCommandTelemetryLookup[i] = values1[i];
}

export enum NativeMouseCommandTelemetry {
    AddToEnd = 'DATASCIENCE.NATIVE.MOUSE.ADD_TO_END',
    ArrowDown = 'DATASCIENCE.NATIVE.MOUSE.ARROW_DOWN',
    ArrowUp = 'DATASCIENCE.NATIVE.MOUSE.ARROW_UP',
    ChangeToCode = 'DATASCIENCE.NATIVE.MOUSE.CHANGE_TO_CODE',
    ChangeToMarkdown = 'DATASCIENCE.NATIVE.MOUSE.CHANGE_TO_MARKDOWN',
    CollapseInput = 'DATASCIENCE.NATIVE.MOUSE.COLLAPSE_INPUT',
    CollapseOutput = 'DATASCIENCE.NATIVE.MOUSE.COLLAPSE_OUTPUT',
    DeleteCell = 'DATASCIENCE.NATIVE.MOUSE.DELETE_CELL',
    InsertAbove = 'DATASCIENCE.NATIVE.MOUSE.INSERT_ABOVE',
    InsertBelow = 'DATASCIENCE.NATIVE.MOUSE.INSERT_BELOW',
    MoveCellDown = 'DATASCIENCE.NATIVE.MOUSE.MOVE_CELL_DOWN',
    MoveCellUp = 'DATASCIENCE.NATIVE.MOUSE.MOVE_CELL_UP',
    Run = 'DATASCIENCE.NATIVE.MOUSE.RUN',
    RunAbove = 'DATASCIENCE.NATIVE.MOUSE.RUN_ABOVE',
    RunAll = 'DATASCIENCE.NATIVE.MOUSE.RUN_ALL',
    RunAndAdd = 'DATASCIENCE.NATIVE.MOUSE.RUN_AND_ADD',
    RunAndMove = 'DATASCIENCE.NATIVE.MOUSE.RUN_AND_MOVE',
    RunBelow = 'DATASCIENCE.NATIVE.MOUSE.RUN_BELOW',
    Save = 'DATASCIENCE.NATIVE.MOUSE.SAVE',
    ToggleLineNumbers = 'DATASCIENCE.NATIVE.MOUSE.TOGGLE_LINE_NUMBERS',
    ToggleOutput = 'DATASCIENCE.NATIVE.MOUSE.TOGGLE_OUTPUT',
    ToggleVariableExplorer = 'DATASCIENCE.NATIVE.MOUSE.TOGGLE_VARIABLE_EXPLORER',
    Undo = 'DATASCIENCE.NATIVE.MOUSE.UNDO',
    Unfocus = 'DATASCIENCE.NATIVE.MOUSE.UNFOCUS'
}

export let NativeMouseCommandTelemetryLookup: { [id: number]: NativeMouseCommandTelemetry } = {};
const values2 = [...Object.values(NativeMouseCommandTelemetry)];
for (let i = 0; i < keys.length; i += 1) {
    NativeMouseCommandTelemetryLookup[i] = values2[i];
}

export namespace HelpLinks {
    export const PythonInteractiveHelpLink = 'https://aka.ms/pyaiinstall';
    export const JupyterDataRateHelpLink = 'https://aka.ms/AA5ggm0'; // This redirects here: https://jupyter-notebook.readthedocs.io/en/stable/config.html
}

export namespace Settings {
    export const JupyterServerLocalLaunch = 'local';
    export const JupyterServerUriList = 'python.dataScience.jupyterServer.uriList';
    export const JupyterServerUriListMax = 10;
    export const IntellisenseTimeout = 30000;
    export const RemoteDebuggerPortBegin = 8889;
    export const RemoteDebuggerPortEnd = 9000;
    export const DefaultVariableQuery: IVariableQuery = {
        language: PYTHON_LANGUAGE,
        query: '%who_ls',
        parseExpr: "'(\\w+)'"
    };
}

export namespace Identifiers {
    export const EmptyFileName = '2DB9B899-6519-4E1B-88B0-FA728A274115';
    export const GeneratedThemeName = 'ipython-theme'; // This needs to be all lower class and a valid class name.
    export const HistoryPurpose = 'history';
    export const PingPurpose = 'ping';
    export const MatplotLibDefaultParams = '_VSCode_defaultMatplotlib_Params';
    export const EditCellId = '3D3AB152-ADC1-4501-B813-4B83B49B0C10';
    export const SvgSizeTag = 'sizeTag={{0}, {1}}';
    export const InteractiveWindowIdentity = 'history://EC155B3B-DC18-49DC-9E99-9A948AA2F27B';
    export const InteractiveWindowIdentityScheme = 'history';
    export const DefaultCodeCellMarker = '# %%';
}

export namespace CodeSnippits {
    export const ChangeDirectory = ['{0}', '{1}', 'import os', 'try:', "\tos.chdir(os.path.join(os.getcwd(), '{2}'))", '\tprint(os.getcwd())', 'except:', '\tpass', ''];
    export const ChangeDirectoryCommentIdentifier = '# ms-python.python added'; // Not translated so can compare.
    export const ImportIPython = '{0}\nfrom IPython import get_ipython\n\n{1}';
    export const MatplotLibInitSvg = `import matplotlib\n%matplotlib inline\n${Identifiers.MatplotLibDefaultParams} = dict(matplotlib.rcParams)\n%config InlineBackend.figure_formats = {'svg', 'png'}`;
    export const MatplotLibInitPng = `import matplotlib\n%matplotlib inline\n${Identifiers.MatplotLibDefaultParams} = dict(matplotlib.rcParams)\n%config InlineBackend.figure_formats = {'png'}`;
    export const ConfigSvg = `%config InlineBackend.figure_formats = {'svg', 'png'}`;
    export const ConfigPng = `%config InlineBackend.figure_formats = {'png'}`;
}

export enum JupyterCommands {
    NotebookCommand = 'notebook',
    ConvertCommand = 'nbconvert',
    KernelSpecCommand = 'kernelspec'
}

export namespace LiveShare {
    export const JupyterExecutionService = 'jupyterExecutionService';
    export const JupyterServerSharedService = 'jupyterServerSharedService';
    export const JupyterNotebookSharedService = 'jupyterNotebookSharedService';
    export const CommandBrokerService = 'commmandBrokerService';
    export const WebPanelMessageService = 'webPanelMessageService';
    export const InteractiveWindowProviderService = 'interactiveWindowProviderService';
    export const GuestCheckerService = 'guestCheckerService';
    export const LiveShareBroadcastRequest = 'broadcastRequest';
    export const ResponseLifetime = 15000;
    export const ResponseRange = 1000; // Range of time alloted to check if a response matches or not
    export const InterruptDefaultTimeout = 10000;
}

export namespace LiveShareCommands {
    export const isNotebookSupported = 'isNotebookSupported';
    export const isImportSupported = 'isImportSupported';
    export const connectToNotebookServer = 'connectToNotebookServer';
    export const getUsableJupyterPython = 'getUsableJupyterPython';
    export const executeObservable = 'executeObservable';
    export const getSysInfo = 'getSysInfo';
    export const serverResponse = 'serverResponse';
    export const catchupRequest = 'catchupRequest';
    export const syncRequest = 'synchRequest';
    export const restart = 'restart';
    export const interrupt = 'interrupt';
    export const interactiveWindowCreate = 'interactiveWindowCreate';
    export const interactiveWindowCreateSync = 'interactiveWindowCreateSync';
    export const disposeServer = 'disposeServer';
    export const guestCheck = 'guestCheck';
    export const createNotebook = 'createNotebook';
    export const inspect = 'inspect';
}
