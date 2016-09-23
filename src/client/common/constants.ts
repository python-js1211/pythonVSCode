
export const PythonLanguage = { language: 'python', scheme: 'file' };

export namespace Commands {
    export const Set_Interpreter = 'python.setInterpreter';
    export const Exec_In_Terminal = 'python.execInTerminal';
    export const Exec_Selection_In_Terminal = 'python.execSelectionInTerminal';
    export const Tests_View_UI = 'python.viewTestUI';
    export const Tests_Picker_UI = 'python.selectTestToRun';
    export const Tests_Discover = 'python.discoverTests';
    export const Tests_Run_Failed = 'python.runFailedTests';
    export const Sort_Imports = 'python.sortImports';
    export const Tests_Run = 'python.runtests';
    export const Tests_Ask_To_Stop_Test = 'python.askToStopUnitTests';
    export const Tests_Ask_To_Stop_Discovery = 'python.askToStopUnitTestDiscovery';
    export const Tests_Stop = 'python.stopUnitTests';
    export const Tests_ViewOutput = 'python.viewTestOutput';
    export const Tests_Select_And_Run_Method = 'python.selectAndRunTestMethod';
    export const Refactor_Extract_Variable = 'python.refactorExtractVariable';
    export const Refaactor_Extract_Method = 'python.refactorExtractMethod';

    export namespace Jupyter {
        export const Get_All_KernelSpecs_For_Language = 'jupyter:getAllKernelSpecsForLanguage';
        export const Get_All_KernelSpecs = 'jupyter:getAllKernelSpecs';
        export const Select_Kernel = 'jupyter:selectKernel';
        export const Kernel_Options = 'jupyter:kernelOptions';
        export const ExecuteRangeInKernel = 'jupyter:execRangeInKernel';
        export const ExecuteSelectionOrLineInKernel = 'jupyter.runSelectionLine';
        export namespace Cell {
            export const ExecuteCurrentCell = 'jupyter:execCurrentCell';
            export const ExecuteCurrentCellAndAdvance = 'jupyter:execCurrentCellAndAdvance';
            export const AdcanceToCell = 'jupyter:advanceToNextCell';
            export const DisplayCellMenu = 'jupyter:displayCellMenu';
        }
        export namespace Kernel {
            export const Kernel_Interrupt = 'jupyter:kernelInterrupt';
            export const Kernel_Restart = 'jupyter:kernelRestart';
            export const Kernel_Shut_Down = 'jupyter:kernelShutDown';
            export const Kernel_Details = 'jupyter:kernelDetails';
        }
    }
}
export namespace Octicons {
    export const Test_Pass = '$(check)';
    export const Test_Fail = '$(alert)';
    export const Test_Error = '$(x)';
    export const Test_Skip = '$(circle-slash)';
}

export const Button_Text_Tests_View_Output = 'View Output';

export namespace Text {
    export const CodeLensUnitTest = 'Test';
}
export namespace Delays {
    // Max time to wait before aborting the generation of code lenses for unit tests
    export const MaxUnitTestCodeLensDelay = 5000;
}