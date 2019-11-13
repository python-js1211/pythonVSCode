// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as fastDeepEqual from 'fast-deep-equal';
import * as immutable from 'immutable';
import { min } from 'lodash';
// tslint:disable-next-line: no-require-imports
import cloneDeep = require('lodash/cloneDeep');
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as uuid from 'uuid/v4';

import { createDeferred, Deferred } from '../../client/common/utils/async';
import { CellMatcher } from '../../client/datascience/cellMatcher';
import { concatMultilineStringInput, generateMarkdownFromCodeLines } from '../../client/datascience/common';
import { Identifiers } from '../../client/datascience/constants';
import {
    IInteractiveWindowMapping,
    InteractiveWindowMessages
} from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { CssMessages, IGetCssResponse } from '../../client/datascience/messages';
import { IGetMonacoThemeResponse } from '../../client/datascience/monacoMessages';
import {
    CellState,
    ICell,
    IDataScienceExtraSettings,
    IInteractiveWindowInfo,
    IJupyterVariable,
    IJupyterVariablesResponse
} from '../../client/datascience/types';
import { arePathsSame } from '../react-common/arePathsSame';
import { IMessageHandler, PostOffice } from '../react-common/postOffice';
import { getSettings, updateSettings } from '../react-common/settingsReactSide';
import { detectBaseTheme } from '../react-common/themeDetector';
import { InputHistory } from './inputHistory';
import { IntellisenseProvider } from './intellisenseProvider';
import {
    createCellVM,
    createEditableCellVM,
    extractInputText,
    generateTestState,
    ICellViewModel,
    IMainState
} from './mainState';
import { initializeTokenizer, registerMonacoLanguage } from './tokenizer';

export interface IMainStateControllerProps {
    hasEdit: boolean;
    skipDefault: boolean;
    testMode: boolean;
    baseTheme: string;
    defaultEditable: boolean;
    enableGather: boolean;
    setState(state: {}, callback: () => void): void;
    activate(): void;
    scrollToCell(id: string): void;
}

// tslint:disable-next-line: max-func-body-length
export class MainStateController implements IMessageHandler {
    protected readonly postOffice: PostOffice = new PostOffice();
    private stackLimit = 10;
    private pendingState: IMainState;
    private renderedState: IMainState;
    private intellisenseProvider: IntellisenseProvider;
    private onigasmPromise: Deferred<ArrayBuffer> | undefined;
    private tmlangugePromise: Deferred<string> | undefined;
    private suspendUpdateCount: number = 0;
    private monacoIdToCellId: Map<string, string> = new Map<string, string>();
    private cellIdToMonacoId: Map<string, string> = new Map<string, string>();

    // tslint:disable-next-line:max-func-body-length
    constructor(private props: IMainStateControllerProps) {
        this.renderedState = {
            editorOptions: this.computeEditorOptions(),
            cellVMs: [],
            busy: true,
            undoStack: [],
            redoStack: [],
            submittedText: false,
            history: new InputHistory(),
            currentExecutionCount: 0,
            variables: [],
            pendingVariableCount: 0,
            debugging: false,
            knownDark: false,
            baseTheme: 'vscode-light',
            variablesVisible: false,
            editCellVM: this.props.hasEdit ? createEditableCellVM(1) : undefined,
            enableGather: this.props.enableGather,
            isAtBottom: true,
            font: {
                size: 14,
                family: 'Consolas, \'Courier New\', monospace'
            }
        };

        // Add test state if necessary
        if (!this.props.skipDefault) {
            this.renderedState = generateTestState(this.inputBlockToggled, '', this.props.defaultEditable);
        }

        // Setup the completion provider for monaco. We only need one
        this.intellisenseProvider = new IntellisenseProvider(this.postOffice, this.getCellId);

        // Setup the tokenizer for monaco if running inside of vscode
        if (this.props.skipDefault) {
            if (this.props.testMode) {
                // Running a test, skip the tokenizer. We want the UI to display synchronously
                this.renderedState = { tokenizerLoaded: true, ...this.renderedState };

                // However we still need to register python as a language
                registerMonacoLanguage();
            } else {
                initializeTokenizer(this.loadOnigasm, this.loadTmlanguage, this.tokenizerLoaded).ignoreErrors();
            }
        }

        // Copy the rendered state
        this.pendingState = { ...this.renderedState };

        // Add ourselves as a handler for the post office
        this.postOffice.addHandler(this);

        // Tell the interactive window code we have started.
        this.postOffice.sendMessage<IInteractiveWindowMapping, 'started'>(InteractiveWindowMessages.Started);

        // Get our monaco theme and css if not running a test, because these make everything async too
        if (!this.props.testMode) {
            this.postOffice.sendUnsafeMessage(CssMessages.GetCssRequest, { isDark: this.props.baseTheme !== 'vscode-light' });
            this.postOffice.sendUnsafeMessage(CssMessages.GetMonacoThemeRequest, { isDark: this.props.baseTheme !== 'vscode-light' });
        }
    }

    public dispose() {
        // Remove ourselves as a handler for the post office
        this.postOffice.removeHandler(this);

        // Get rid of our completion provider
        this.intellisenseProvider.dispose();

        // Get rid of our post office
        this.postOffice.dispose();
    }

    public requiresUpdate(prevState: IMainState, nextState: IMainState): boolean {
        // Compare all keys
        return !fastDeepEqual(prevState, nextState);
    }

    // tslint:disable-next-line:no-any cyclomatic-complexity max-func-body-length
    public handleMessage(msg: string, payload?: any) {
        switch (msg) {
            case InteractiveWindowMessages.StartCell:
                this.startCell(payload);
                return true;

            case InteractiveWindowMessages.FinishCell:
                this.finishCell(payload);
                return true;

            case InteractiveWindowMessages.UpdateCell:
                this.updateCell(payload);
                return true;

            case InteractiveWindowMessages.GetAllCells:
                this.getAllCells();
                return true;

            case InteractiveWindowMessages.ExpandAll:
                this.expandAllSilent();
                return true;

            case InteractiveWindowMessages.CollapseAll:
                this.collapseAllSilent();
                return true;

            case InteractiveWindowMessages.DeleteAllCells:
                this.clearAllSilent();
                return true;

            case InteractiveWindowMessages.Redo:
                this.redo();
                return true;

            case InteractiveWindowMessages.Undo:
                this.undo();
                return true;

            case InteractiveWindowMessages.StartProgress:
                if (!this.props.testMode) {
                    this.setState({ busy: true });
                }
                break;

            case InteractiveWindowMessages.StopProgress:
                if (!this.props.testMode) {
                    this.setState({ busy: false });
                }
                break;

            case InteractiveWindowMessages.UpdateSettings:
                this.updateSettings(payload);
                break;

            case InteractiveWindowMessages.Activate:
                this.props.activate();
                break;

            case InteractiveWindowMessages.GetVariablesResponse:
                this.getVariablesResponse(payload);
                break;

            case InteractiveWindowMessages.GetVariableValueResponse:
                this.getVariableValueResponse(payload);
                break;

            case InteractiveWindowMessages.LoadOnigasmAssemblyResponse:
                this.handleOnigasmResponse(payload);
                break;

            case InteractiveWindowMessages.LoadTmLanguageResponse:
                this.handleTmLanguageResponse(payload);
                break;

            case InteractiveWindowMessages.RestartKernel:
                // Go through all vms that are currently executing and mark them as finished
                this.handleRestarted();
                break;

            case InteractiveWindowMessages.StartDebugging:
                this.setState({ debugging: true });
                break;

            case InteractiveWindowMessages.StopDebugging:
                this.setState({ debugging: false });
                break;

            case InteractiveWindowMessages.LoadAllCells:
                this.handleLoadAllCells(payload);
                break;

            case CssMessages.GetCssResponse:
                this.handleCssResponse(payload);
                break;

            case CssMessages.GetMonacoThemeResponse:
                this.handleMonacoThemeResponse(payload);
                break;

            case InteractiveWindowMessages.ScrollToCell:
                if (payload.id) {
                    this.props.scrollToCell(payload.id);
                }
                break;

            default:
                break;
        }

        return false;
    }

    public stopBusy = () => {
        if (this.pendingState.busy) {
            this.setState({ busy: false });
        }
    }

    public redo = () => {
        // Pop one off of our redo stack and update our undo
        const cells = this.pendingState.redoStack[this.pendingState.redoStack.length - 1];
        const redoStack = this.pendingState.redoStack.slice(0, this.pendingState.redoStack.length - 1);
        const undoStack = this.pushStack(this.pendingState.undoStack, this.pendingState.cellVMs);
        this.sendMessage(InteractiveWindowMessages.Redo);
        this.setState({
            cellVMs: cells,
            undoStack: undoStack,
            redoStack: redoStack,
            skipNextScroll: true
        });
    }

    public undo = () => {
        // Pop one off of our undo stack and update our redo
        const cells = this.pendingState.undoStack[this.pendingState.undoStack.length - 1];
        const undoStack = this.pendingState.undoStack.slice(0, this.pendingState.undoStack.length - 1);
        const redoStack = this.pushStack(this.pendingState.redoStack, this.pendingState.cellVMs);
        this.sendMessage(InteractiveWindowMessages.Undo);
        this.setState({
            cellVMs: cells,
            undoStack: undoStack,
            redoStack: redoStack,
            skipNextScroll: true
        });
    }

    public deleteCell = (cellId: string) => {
        const index = this.findCellIndex(cellId);
        if (index >= 0) {
            this.sendMessage(InteractiveWindowMessages.DeleteCell);
            this.sendMessage(InteractiveWindowMessages.RemoveCell, { id: cellId });

            // Recompute select/focus if this item has either
            let newSelection = this.pendingState.selectedCellId;
            let newFocused = this.pendingState.focusedCellId;
            const newVMs = [...this.pendingState.cellVMs.filter(c => c.cell.id !== cellId)];
            const nextOrPrev = index === this.pendingState.cellVMs.length - 1 ? index - 1 : index;
            if (this.pendingState.selectedCellId === cellId || this.pendingState.focusedCellId === cellId) {
                if (nextOrPrev >= 0) {
                    newVMs[nextOrPrev] = { ...newVMs[nextOrPrev], selected: true, focused: this.pendingState.focusedCellId === cellId };
                    newSelection = newVMs[nextOrPrev].cell.id;
                    newFocused = newVMs[nextOrPrev].focused ? newVMs[nextOrPrev].cell.id : undefined;
                }
            }

            // Update our state
            this.setState({
                cellVMs: newVMs,
                selectedCellId: newSelection,
                focusedCellId: newFocused,
                undoStack: this.pushStack(this.pendingState.undoStack, this.pendingState.cellVMs),
                skipNextScroll: true
            });
        }
    }

    public collapseAll = () => {
        this.sendMessage(InteractiveWindowMessages.CollapseAll);
        this.collapseAllSilent();
    }

    public expandAll = () => {
        this.sendMessage(InteractiveWindowMessages.ExpandAll);
        this.expandAllSilent();
    }

    public clearAll = () => {
        this.sendMessage(InteractiveWindowMessages.DeleteAllCells);
        this.clearAllSilent();
    }

    public save = () => {
        // We have to take the current value of each cell to make sure we have the correct text.
        const newVMs = [...this.pendingState.cellVMs];
        for (let i = 0; i < newVMs.length; i += 1) {
            const text = this.getMonacoEditorContents(newVMs[i].cell.id);
            if (text !== undefined) {
                newVMs[i] = { ...newVMs[i], inputBlockText: text, cell: { ...newVMs[i].cell, data: { ...newVMs[i].cell.data, source: text } } };
            }
        }
        this.setState({
            cellVMs: newVMs
        });

        // Then send the save with the new state.
        this.sendMessage(InteractiveWindowMessages.SaveAll, { cells: newVMs.map(cvm => cvm.cell) });
    }

    public showPlot = (imageHtml: string) => {
        this.sendMessage(InteractiveWindowMessages.ShowPlot, imageHtml);
    }

    public showDataViewer = (targetVariable: string, numberOfColumns: number) => {
        this.sendMessage(InteractiveWindowMessages.ShowDataViewer, { variableName: targetVariable, columnSize: numberOfColumns });
    }

    public openLink = (uri: monacoEditor.Uri) => {
        this.sendMessage(InteractiveWindowMessages.OpenLink, uri.toString());
    }

    public canCollapseAll = () => {
        return this.getNonEditCellVMs().length > 0;
    }

    public canExpandAll = () => {
        return this.getNonEditCellVMs().length > 0;
    }

    public canExport = () => {
        return this.getNonEditCellVMs().length > 0;
    }

    public canRedo = () => {
        return this.pendingState.redoStack.length > 0;
    }

    public canUndo = () => {
        return this.pendingState.undoStack.length > 0;
    }

    public canClearAllOutputs = () => {
        return this.getNonEditCellVMs().length > 0;
    }

    public clearAllOutputs = () => {
        const newList = this.pendingState.cellVMs.map(cellVM => {
            const updatedVm = immutable.updateIn(cellVM, ['cell', 'data', 'outputs'], () => []);
            return immutable.updateIn(updatedVm, ['cell', 'data', 'execution_count'], () => null);
        });
        this.setState({
            cellVMs: newList
        });

        this.sendMessage(InteractiveWindowMessages.ClearAllOutputs);
    }

    public gotoCellCode = (cellId: string) => {
        // Find our cell
        const cellVM = this.pendingState.cellVMs.find(c => c.cell.id === cellId);

        // Send a message to the other side to jump to a particular cell
        if (cellVM) {
            this.sendMessage(InteractiveWindowMessages.GotoCodeCell, { file: cellVM.cell.file, line: cellVM.cell.line });
        }
    }

    public copyCellCode = (cellId: string) => {
        // Find our cell. This is also supported on the edit cell
        let cellVM = this.pendingState.cellVMs.find(c => c.cell.id === cellId);
        if (!cellVM && this.pendingState.editCellVM && cellId === this.pendingState.editCellVM.cell.id) {
            cellVM = this.pendingState.editCellVM;
        }

        // Send a message to the other side to jump to a particular cell
        if (cellVM) {
            this.sendMessage(InteractiveWindowMessages.CopyCodeCell, { source: extractInputText(cellVM.cell, getSettings()) });
        }
    }

    public gatherCell = (cellVM: ICellViewModel | undefined) => {
        if (cellVM) {
            this.sendMessage(InteractiveWindowMessages.GatherCodeRequest, cellVM.cell);
        }
    }

    public restartKernel = () => {
        // Send a message to the other side to restart the kernel
        this.sendMessage(InteractiveWindowMessages.RestartKernel);
    }

    public interruptKernel = () => {
        // Send a message to the other side to restart the kernel
        this.sendMessage(InteractiveWindowMessages.Interrupt);
    }

    public export = () => {
        // Send a message to the other side to export our current list
        const cellContents: ICell[] = this.pendingState.cellVMs.map((cellVM: ICellViewModel, _index: number) => { return cellVM.cell; });
        this.sendMessage(InteractiveWindowMessages.Export, cellContents);
    }

    // When the variable explorer wants to refresh state (say if it was expanded)
    public refreshVariables = (newExecutionCount?: number) => {
        this.sendMessage(InteractiveWindowMessages.GetVariablesRequest, newExecutionCount === undefined ? this.pendingState.currentExecutionCount : newExecutionCount);
    }

    public toggleVariableExplorer = () => {
        this.sendMessage(InteractiveWindowMessages.VariableExplorerToggle, !this.pendingState.variablesVisible);
        this.setState({ variablesVisible: !this.pendingState.variablesVisible });
        if (this.pendingState.variablesVisible) {
            this.refreshVariables();
        }
    }

    public codeChange = (changes: monacoEditor.editor.IModelContentChange[], id: string, modelId: string) => {
        // If the model id doesn't match, skip sending this edit. This happens
        // when a cell is reused after deleting another
        const expectedCellId = this.monacoIdToCellId.get(modelId);
        if (expectedCellId !== id) {
            // A cell has been reused. Update our mapping
            this.monacoIdToCellId.set(modelId, id);
            this.cellIdToMonacoId.set(id, modelId);
        } else {
            // Just a normal edit. Pass this onto the completion provider running in the extension
            this.sendMessage(InteractiveWindowMessages.EditCell, { changes, id });
        }
    }

    public readOnlyCodeCreated = (_text: string, _file: string, id: string, monacoId: string) => {
        const cell = this.pendingState.cellVMs.find(c => c.cell.id === id);
        if (cell) {
            // Pass this onto the completion provider running in the extension
            this.sendMessage(InteractiveWindowMessages.AddCell, {
                fullText: extractInputText(cell.cell, getSettings()),
                currentText: cell.inputBlockText,
                cell: cell.cell
            });
        }

        // Save in our map of monaco id to cell id
        this.monacoIdToCellId.set(monacoId, id);
        this.cellIdToMonacoId.set(id, monacoId);
    }

    public editableCodeCreated = (_text: string, _file: string, id: string, monacoId: string) => {
        // Save in our map of monaco id to cell id
        this.monacoIdToCellId.set(monacoId, id);
        this.cellIdToMonacoId.set(id, monacoId);
    }

    public codeLostFocus = (cellId: string) => {
        this.onCodeLostFocus(cellId);
        if (this.pendingState.focusedCellId === cellId) {
            const newVMs = [...this.pendingState.cellVMs];
            // Switch the old vm
            const oldSelect = this.findCellIndex(cellId);
            if (oldSelect >= 0) {
                newVMs[oldSelect] = { ...newVMs[oldSelect], focused: false };
            }
            // Only unfocus if we haven't switched somewhere else yet
            this.setState({ focusedCellId: undefined, cellVMs: newVMs });
        }
    }

    public codeGotFocus = (cellId: string | undefined) => {
        // Skip if already has focus
        if (cellId !== this.pendingState.focusedCellId) {
            const newVMs = [...this.pendingState.cellVMs];
            // Reset the old vms (nothing should be selected/focused)
            // Change state only for cells that were selected/focused
            newVMs.forEach((cellVM, index) => {
                if (cellVM.selected || cellVM.focused) {
                    newVMs[index] = { ...cellVM, selected: false, focused: false };
                }
            });
            const newSelect = this.findCellIndex(cellId);
            if (newSelect >= 0) {
                newVMs[newSelect] = { ...newVMs[newSelect], selected: true, focused: true };
            }

            // Save the whole thing in our state.
            this.setState({ selectedCellId: cellId, focusedCellId: cellId, cellVMs: newVMs });
        }

        // Send out a message that we received a focus change
        if (this.props.testMode && cellId) {
            this.sendMessage(InteractiveWindowMessages.FocusedCellEditor, { cellId });
        }
    }

    public selectCell = (cellId: string, focusedCellId?: string) => {
        // Skip if already the same cell
        if (this.pendingState.selectedCellId !== cellId || this.pendingState.focusedCellId !== focusedCellId) {
            const newVMs = [...this.pendingState.cellVMs];
            // Reset the old vms (nothing should be selected/focused)
            // Change state only for cells that were selected/focused
            newVMs.forEach((cellVM, index) => {
                if (cellVM.selected || cellVM.focused) {
                    newVMs[index] = { ...cellVM, selected: false, focused: false };
                }
            });
            const newSelect = this.findCellIndex(cellId);
            if (newSelect >= 0) {
                newVMs[newSelect] = { ...newVMs[newSelect], selected: true, focused: focusedCellId === newVMs[newSelect].cell.id };
            }

            // Save the whole thing in our state.
            this.setState({ selectedCellId: cellId, focusedCellId, cellVMs: newVMs });
        }
    }

    public changeCellType = (cellId: string, newType: 'code' | 'markdown') => {
        const index = this.pendingState.cellVMs.findIndex(c => c.cell.id === cellId);
        if (index >= 0 && this.pendingState.cellVMs[index].cell.data.cell_type !== newType) {
            const cellVMs = [...this.pendingState.cellVMs];
            const current = this.pendingState.cellVMs[index];
            const newSource = current.focused ? this.getMonacoEditorContents(cellId) : concatMultilineStringInput(current.cell.data.source);
            const newCell = { ...current, inputBlockText: newSource, cell: { ...current.cell, state: CellState.finished, data: { ...current.cell.data, cell_type: newType, source: newSource } } };
            // tslint:disable-next-line: no-any
            cellVMs[index] = (newCell as any); // This is because IMessageCell doesn't fit in here. But message cells can't change type
            this.setState({ cellVMs });
            if (newType === 'code') {
                this.sendMessage(InteractiveWindowMessages.InsertCell, { cell: cellVMs[index].cell, index, code: concatMultilineStringInput(cellVMs[index].cell.data.source), codeCellAboveId: this.firstCodeCellAbove(cellId) });
            } else {
                this.sendMessage(InteractiveWindowMessages.RemoveCell, { id: cellId });
            }
        }
    }

    public submitInput = (code: string, inputCell: ICellViewModel) => {
        // noop if the submitted code is just a cell marker
        const matcher = new CellMatcher(getSettings());
        if (matcher.stripFirstMarker(code).length === 0) {
            return;
        }

        // This should be from our last entry. Switch this entry to read only, and add a new item to our list
        if (inputCell && inputCell.cell.id === Identifiers.EditCellId) {
            let newCell = cloneDeep(inputCell);

            // Change this editable cell to not editable.
            newCell.cell.state = CellState.executing;
            newCell.cell.data.source = code;

            // Change type to markdown if necessary
            const split = code.splitLines({ trim: false });
            const firstLine = split[0];
            if (matcher.isMarkdown(firstLine)) {
                newCell.cell.data.cell_type = 'markdown';
                newCell.cell.data.source = generateMarkdownFromCodeLines(split);
                newCell.cell.state = CellState.finished;
            } else if (newCell.cell.data.cell_type === 'markdown') {
                newCell.cell.state = CellState.finished;
            }

            // Clear the input cell as it's the edit cell
            const monacoId = this.getMonacoId(Identifiers.EditCellId);
            const editor = monacoEditor.editor.getModels().find(m => m.id === monacoId);
            if (editor) {
                editor.setValue('');
            }

            // Update input controls (always show expanded since we just edited it.)
            newCell = createCellVM(newCell.cell, getSettings(), this.inputBlockToggled, this.props.defaultEditable);
            const collapseInputs = getSettings().collapseCellInputCodeByDefault;
            newCell = this.alterCellVM(newCell, true, !collapseInputs);
            newCell.useQuickEdit = false;

            // Generate a new id if necessary (as the edit cell always has the same one)
            if (newCell.cell.id === Identifiers.EditCellId) {
                newCell.cell.id = uuid();
            }

            // Indicate this is direct input so that we don't hide it if the user has
            // hide all inputs turned on.
            newCell.directInput = true;

            // Stick in a new cell at the bottom that's editable and update our state
            // so that the last cell becomes busy
            this.setState({
                cellVMs: [...this.pendingState.cellVMs, newCell],
                undoStack: this.pushStack(this.pendingState.undoStack, this.pendingState.cellVMs),
                redoStack: this.pendingState.redoStack,
                skipNextScroll: false,
                submittedText: true
            });

            // Send a message to execute this code if necessary.
            if (newCell.cell.state !== CellState.finished) {
                this.sendMessage(InteractiveWindowMessages.SubmitNewCell, { code, id: newCell.cell.id });
            }
        } else if (inputCell.cell.data.cell_type === 'code') {
            const index = this.findCellIndex(inputCell.cell.id);
            if (index >= 0) {
                // Update our input cell to be in progress again and clear outputs
                const newVMs = [...this.pendingState.cellVMs];
                newVMs[index] = { ...inputCell, cell: { ...inputCell.cell, state: CellState.executing, data: { ...inputCell.cell.data, source: code, outputs: [] } } };
                this.setState({
                    cellVMs: newVMs
                });
            }

            // Send a message to rexecute this code
            this.sendMessage(InteractiveWindowMessages.ReExecuteCell, { code, id: inputCell.cell.id });
        } else if (inputCell.cell.data.cell_type === 'markdown') {
            const index = this.findCellIndex(inputCell.cell.id);
            if (index >= 0) {
                // Change the input on the cell
                const newVMs = [...this.pendingState.cellVMs];
                newVMs[index] = { ...inputCell, inputBlockText: code, cell: { ...inputCell.cell, data: { ...inputCell.cell.data, source: code } } };
                this.setState({
                    cellVMs: newVMs
                });
            }
        }
    }

    public findCell(cellId?: string): ICellViewModel | undefined {
        const nonEdit = this.pendingState.cellVMs.find(cvm => cvm.cell.id === cellId);
        if (!nonEdit && cellId === Identifiers.EditCellId) {
            return this.pendingState.editCellVM;
        }
        return nonEdit;
    }

    public findCellIndex(cellId?: string): number {
        return this.pendingState.cellVMs.findIndex(cvm => cvm.cell.id === cellId);
    }

    public getMonacoId(cellId: string): string | undefined {
        return this.cellIdToMonacoId.get(cellId);
    }

    public toggleLineNumbers = (cellId: string) => {
        const index = this.pendingState.cellVMs.findIndex(c => c.cell.id === cellId);
        if (index >= 0) {
            const newVMs = [...this.pendingState.cellVMs];
            newVMs[index] = immutable.merge(newVMs[index], { showLineNumbers: !newVMs[index].showLineNumbers });
            this.setState({ cellVMs: newVMs });
        }
    }

    public toggleOutput = (cellId: string) => {
        const index = this.pendingState.cellVMs.findIndex(c => c.cell.id === cellId);
        if (index >= 0) {
            const newVMs = [...this.pendingState.cellVMs];
            newVMs[index] = immutable.merge(newVMs[index], { hideOutput: !newVMs[index].hideOutput });
            this.setState({ cellVMs: newVMs });
        }
    }

    public setState(newState: {}, callback?: () => void) {
        // Add to writable state (it should always reflect the current conditions)
        this.pendingState = { ...this.pendingState, ...newState };

        if (this.suspendUpdateCount > 0) {
            // Just save our new state
            this.renderedState = { ...this.renderedState, ...newState };
            if (callback) {
                callback();
            }
        } else {
            // Send a UI update
            this.props.setState(newState, () => {
                this.renderedState = { ...this.renderedState, ...newState };
                if (callback) {
                    callback();
                }
            });
        }
    }

    public renderUpdate(newState: {}) {
        // This method should be called during the render stage of anything
        // using this state Controller. That's because after shouldComponentUpdate
        // render is next and at this point the state has been set.
        // See https://reactjs.org/docs/react-component.html
        // Otherwise we set the state in the callback during setState and this can be
        // too late for any render code to use the stateController.

        const oldCount = this.renderedState.pendingVariableCount;

        // If the new state includes a finished cell that wasn't finished before, and we're in test
        // mode, send another message. We use this to determine when rendering is 'finished' for a cell.
        if (this.props.testMode && 'cellVMs' in newState) {
            const renderedFinished = this.pendingState.cellVMs.filter(c => c.cell.state === CellState.finished || c.cell.state === CellState.error).map(c => c.cell.id);
            const previousFinished = this.renderedState.cellVMs.filter(c => c.cell.state === CellState.finished || c.cell.state === CellState.error).map(c => c.cell.id);
            if (renderedFinished.length > previousFinished.length) {
                const diff = renderedFinished.filter(r => previousFinished.indexOf(r) < 0);
                // Send async so happens after the render is actually finished.
                setTimeout(() => this.sendMessage(InteractiveWindowMessages.RenderComplete, { ids: diff }), 1);
            }
        }

        // Update the actual rendered state (it should be used by rendering)
        this.renderedState = { ...this.renderedState, ...newState };

        // If the new state includes any cellVM changes, send an update to the other side
        if ('cellVMs' in newState) {
            this.sendInfo();
        }

        // If the new state includes pendingVariableCount and it's gone to zero, send a message
        if (this.renderedState.pendingVariableCount === 0 && oldCount !== 0) {
            setTimeout(() => this.sendMessage(InteractiveWindowMessages.VariablesComplete), 1);
        }

    }

    public getState(): IMainState {
        return this.pendingState;
    }

    public getMonacoEditorContents(cellId: string): string | undefined {
        const index = this.findCellIndex(cellId);
        if (index >= 0) {
            // Get the model for the monaco editor
            const monacoId = this.getMonacoId(cellId);
            if (monacoId) {
                const model = monacoEditor.editor.getModels().find(m => m.id === monacoId);
                if (model) {
                    return model.getValue().replace(/\r/g, '');
                }
            }
        }
    }

    // Adjust the visibility or collapsed state of a cell
    protected alterCellVM(cellVM: ICellViewModel, visible: boolean, expanded: boolean): ICellViewModel {
        if (cellVM.cell.data.cell_type === 'code') {
            // If we are already in the correct state, return back our initial cell vm
            if (cellVM.inputBlockShow === visible && cellVM.inputBlockOpen === expanded) {
                return cellVM;
            }

            const newCellVM = { ...cellVM };
            if (cellVM.inputBlockShow !== visible) {
                if (visible) {
                    // Show the cell, the rest of the function will add on correct collapse state
                    newCellVM.inputBlockShow = true;
                } else {
                    // Hide this cell
                    newCellVM.inputBlockShow = false;
                }
            }

            // No elseif as we want newly visible cells to pick up the correct expand / collapse state
            if (cellVM.inputBlockOpen !== expanded && cellVM.inputBlockCollapseNeeded && cellVM.inputBlockShow) {
                if (expanded) {
                    // Expand the cell
                    const newText = extractInputText(cellVM.cell, getSettings());

                    newCellVM.inputBlockOpen = true;
                    newCellVM.inputBlockText = newText;
                } else {
                    // Collapse the cell
                    let newText = extractInputText(cellVM.cell, getSettings());
                    if (newText.length > 0) {
                        newText = newText.split('\n', 1)[0];
                        newText = newText.slice(0, 255); // Slice to limit length, slicing past length is fine
                        newText = newText.concat('...');
                    }

                    newCellVM.inputBlockOpen = false;
                    newCellVM.inputBlockText = newText;
                }
            }

            return newCellVM;
        }

        return cellVM;
    }

    protected onCodeLostFocus(_cellId: string) {
        // Default is do nothing.
    }

    protected getCellId = (monacoId: string): string => {
        const result = this.monacoIdToCellId.get(monacoId);
        if (result) {
            return result;
        }

        // Just assume it's the edit cell if not found.
        return Identifiers.EditCellId;
    }

    protected addCell(cell: ICell) {
        this.insertCell(cell);
    }

    protected prepareCellVM(cell: ICell, isMonaco?: boolean): ICellViewModel {
        const showInputs = getSettings().showCellInputCode;
        const collapseInputs = getSettings().collapseCellInputCodeByDefault;
        let cellVM: ICellViewModel = createCellVM(cell, getSettings(), this.inputBlockToggled, this.props.defaultEditable);

        // Set initial cell visibility and collapse
        cellVM = this.alterCellVM(cellVM, showInputs, !collapseInputs);

        if (isMonaco) {
            cellVM.useQuickEdit = false;
        }

        return cellVM;
    }

    protected insertCell(cell: ICell, position?: number, isMonaco?: boolean): ICellViewModel {
        const cellVM = this.prepareCellVM(cell, isMonaco);
        const newList = [...this.pendingState.cellVMs];
        // Make sure to use the same array so our entire state doesn't update
        if (position !== undefined && position >= 0) {
            newList.splice(position, 0, cellVM);
        } else {
            newList.push(cellVM);
        }
        this.setState({
            cellVMs: newList,
            undoStack: this.pushStack(this.pendingState.undoStack, this.pendingState.cellVMs),
            redoStack: this.pendingState.redoStack,
            skipNextScroll: false
        });

        return cellVM;
    }

    protected suspendUpdates() {
        this.suspendUpdateCount += 1;
    }

    protected resumeUpdates() {
        if (this.suspendUpdateCount > 0) {
            this.suspendUpdateCount -= 1;
            if (this.suspendUpdateCount === 0) {
                this.setState(this.pendingState); // This should cause an update
            }
        }

    }

    protected sendMessage = <M extends IInteractiveWindowMapping, T extends keyof M>(type: T, payload?: M[T]) => {
        this.postOffice.sendMessage<M, T>(type, payload);
    }

    protected pushStack = (stack: ICellViewModel[][], cells: ICellViewModel[]) => {
        // Get the undo stack up to the maximum length
        const slicedUndo = stack.slice(0, min([stack.length, this.stackLimit]));

        // make a copy of the cells so that further changes don't modify them.
        const copy = cloneDeep(cells);
        return [...slicedUndo, copy];
    }

    protected firstCodeCellAbove(cellId: string): string | undefined {
        const codeCells = this.pendingState.cellVMs.filter(c => c.cell.data.cell_type === 'code');
        const index = codeCells.findIndex(c => c.cell.id === cellId);
        if (index > 0) {
            return codeCells[index - 1].cell.id;
        }
        return undefined;
    }

    // tslint:disable:no-any
    protected computeEditorOptions(): monacoEditor.editor.IEditorOptions {
        const intellisenseOptions = getSettings().intellisenseOptions;
        const extraSettings = getSettings().extraSettings;
        if (intellisenseOptions && extraSettings) {
            return {
                quickSuggestions: {
                    other: intellisenseOptions.quickSuggestions.other,
                    comments: intellisenseOptions.quickSuggestions.comments,
                    strings: intellisenseOptions.quickSuggestions.strings
                },
                acceptSuggestionOnEnter: intellisenseOptions.acceptSuggestionOnEnter,
                quickSuggestionsDelay: intellisenseOptions.quickSuggestionsDelay,
                suggestOnTriggerCharacters: intellisenseOptions.suggestOnTriggerCharacters,
                tabCompletion: intellisenseOptions.tabCompletion,
                suggest: {
                    localityBonus: intellisenseOptions.suggestLocalityBonus
                },
                suggestSelection: intellisenseOptions.suggestSelection,
                wordBasedSuggestions: intellisenseOptions.wordBasedSuggestions,
                parameterHints: {
                    enabled: intellisenseOptions.parameterHintsEnabled
                },
                cursorStyle: extraSettings.editor.cursor,
                cursorBlinking: extraSettings.editor.cursorBlink,
                autoClosingBrackets: extraSettings.editor.autoClosingBrackets as any,
                autoClosingQuotes: extraSettings.editor.autoClosingQuotes as any,
                autoIndent: extraSettings.editor.autoIndent as any,
                autoSurround: extraSettings.editor.autoSurround as any,
                fontLigatures: extraSettings.editor.fontLigatures
            };
        }

        return {};
    }

    // tslint:disable-next-line: no-any
    private handleLoadAllCells(payload: any) {
        if (payload && payload.cells) {
            // Turn off updates so we generate all of the cell vms without rendering.
            this.suspendUpdates();

            // Generate all of the VMs
            const cells = payload.cells as ICell[];
            const vms = cells.map(c => this.prepareCellVM(c, true));

            // Set our state to not being busy anymore. Clear undo stack as this can't be undone.
            this.setState({ busy: false, loadTotal: payload.cells.length, undoStack: [], cellVMs: vms });

            // Turn updates back on and resend the state.
            this.resumeUpdates();
        }
    }

    private handleRestarted() {
        this.suspendUpdates();

        const newVMs = [...this.pendingState.cellVMs];

        // When we restart, reset all code cells to indicate they haven't been run in the new kernel.
        // Also make sure to turn off all executing cells as they aren't executing anymore.
        const executableCells = newVMs
            .map((cvm, i) => { return { cvm, i }; })
            .filter(s => s.cvm.cell.data.cell_type === 'code');

        if (executableCells) {
            executableCells.forEach(s => {
                if (newVMs[s.i].hasBeenRun && newVMs[s.i].hasBeenRun === true) {
                    newVMs[s.i] = immutable.updateIn(s.cvm, ['hasBeenRun'], () => false);
                }

                if (newVMs[s.i].cell.state !== CellState.error && newVMs[s.i].cell.state !== CellState.finished) {
                    newVMs[s.i] = immutable.updateIn(s.cvm, ['cell', 'state'], () => CellState.finished);
                }
            });
        }

        this.setState({ cellVMs: newVMs, currentExecutionCount: 0 });
        this.resumeUpdates();

        // Update our variables
        this.refreshVariables();
    }

    private darkChanged = (newDark: boolean) => {
        // update our base theme if allowed. Don't do this
        // during testing as it will mess up the expected render count.
        if (!this.props.testMode) {
            this.setState(
                {
                    baseTheme: newDark ? 'vscode-dark' : 'vscode-light'
                }
            );
        }
    }

    private monacoThemeChanged = (theme: string) => {
        // update our base theme if allowed. Don't do this
        // during testing as it will mess up the expected render count.
        if (!this.props.testMode) {
            this.setState(
                {
                    monacoTheme: theme
                }
            );
        }
    }

    // tslint:disable-next-line:no-any
    private updateSettings = (payload?: any) => {
        if (payload) {
            const prevShowInputs = getSettings().showCellInputCode;
            updateSettings(payload as string);

            // If our settings change updated show inputs we need to fix up our cells
            const showInputs = getSettings().showCellInputCode;

            // Also save the editor options. Intellisense options may have changed.
            this.setState({
                editorOptions: this.computeEditorOptions()
            });

            // Update theme if necessary
            const newSettings = JSON.parse(payload as string);
            const dsSettings = newSettings as IDataScienceExtraSettings;
            if (dsSettings && dsSettings.extraSettings && dsSettings.extraSettings.theme !== this.pendingState.vscodeThemeName) {
                // User changed the current theme. Rerender
                this.postOffice.sendUnsafeMessage(CssMessages.GetCssRequest, { isDark: this.computeKnownDark() });
                this.postOffice.sendUnsafeMessage(CssMessages.GetMonacoThemeRequest, { isDark: this.computeKnownDark() });
            }

            if (prevShowInputs !== showInputs) {
                this.toggleCellInputVisibility(showInputs, getSettings().collapseCellInputCodeByDefault);
            }

            if (dsSettings.extraSettings) {
                const fontSize = dsSettings.extraSettings.fontSize;
                const fontFamily = dsSettings.extraSettings.fontFamily;

                this.setState({
                    font: {
                        size: fontSize,
                        family: fontFamily
                    }
                });
            }
        }
    }

    private getAllCells = () => {
        // Send all of our cells back to the other side
        const cells = this.pendingState.cellVMs.map((cellVM: ICellViewModel) => {
            return cellVM.cell;
        });

        this.sendMessage(InteractiveWindowMessages.ReturnAllCells, cells);
    }

    private getNonEditCellVMs(): ICellViewModel[] {
        return this.pendingState.cellVMs;
    }

    private clearAllSilent = () => {
        // Update our state
        this.setState({
            cellVMs: [],
            undoStack: this.pushStack(this.pendingState.undoStack, this.pendingState.cellVMs),
            skipNextScroll: true,
            busy: false // No more progress on delete all
        });
    }

    private inputBlockToggled = (id: string) => {
        // Create a shallow copy of the array, let not const as this is the shallow array copy that we will be changing
        const cellVMArray: ICellViewModel[] = [...this.pendingState.cellVMs];
        const cellVMIndex = cellVMArray.findIndex((value: ICellViewModel) => {
            return value.cell.id === id;
        });

        if (cellVMIndex >= 0) {
            // Const here as this is the state object pulled off of our shallow array copy, we don't want to mutate it
            const targetCellVM = cellVMArray[cellVMIndex];

            // Mutate the shallow array copy
            cellVMArray[cellVMIndex] = this.alterCellVM(targetCellVM, true, !targetCellVM.inputBlockOpen);

            this.setState({
                skipNextScroll: true,
                cellVMs: cellVMArray
            });
        }
    }

    private toggleCellInputVisibility = (visible: boolean, collapse: boolean) => {
        this.alterAllCellVMs(visible, !collapse);
    }

    private collapseAllSilent = () => {
        if (getSettings().showCellInputCode) {
            this.alterAllCellVMs(true, false);
        }
    }

    private expandAllSilent = () => {
        if (getSettings().showCellInputCode) {
            this.alterAllCellVMs(true, true);
        }
    }

    private alterAllCellVMs = (visible: boolean, expanded: boolean) => {
        const newCells = this.pendingState.cellVMs.map((value: ICellViewModel) => {
            return this.alterCellVM(value, visible, expanded);
        });

        this.setState({
            skipNextScroll: true,
            cellVMs: newCells
        });
    }

    private sendInfo = () => {
        const info: IInteractiveWindowInfo = {
            cellCount: this.pendingState.cellVMs.length,
            undoCount: this.pendingState.undoStack.length,
            redoCount: this.pendingState.redoStack.length,
            selectedCell: this.pendingState.selectedCellId
        };
        this.sendMessage(InteractiveWindowMessages.SendInfo, info);
    }

    private updateOrAdd = (cell: ICell, allowAdd?: boolean) => {
        const index = this.pendingState.cellVMs.findIndex((c: ICellViewModel) => {
            return c.cell.id === cell.id &&
                c.cell.line === cell.line &&
                arePathsSame(c.cell.file, cell.file);
        });
        if (index >= 0) {
            // This means the cell existed already so it was actual executed code.
            // Use its execution count to update our execution count.
            const newExecutionCount = cell.data.execution_count ?
                Math.max(this.pendingState.currentExecutionCount, parseInt(cell.data.execution_count.toString(), 10)) :
                this.pendingState.currentExecutionCount;
            if (newExecutionCount !== this.pendingState.currentExecutionCount && this.pendingState.variablesVisible) {
                // We also need to update our variable explorer when the execution count changes
                // Use the ref here to maintain var explorer independence
                this.refreshVariables(newExecutionCount);
            }

            this.pendingState.cellVMs[index].hasBeenRun = true;

            // Have to make a copy of the cell VM array or
            // we won't actually update.
            const newVMs = [...this.pendingState.cellVMs];

            // Live share has been disabled for now, see https://github.com/microsoft/vscode-python/issues/7972
            // Check to see if our code still matches for the cell (in liveshare it might be updated from the other side)
            // if (concatMultilineStringInput(this.pendingState.cellVMs[index].cell.data.source) !== concatMultilineStringInput(cell.data.source)) {

            // Prevent updates to the source, as its possible we have recieved a response for a cell execution
            // and the user has updated the cell text since then.
            newVMs[index] = {
                ...newVMs[index],
                cell: {
                    ...newVMs[index].cell,
                    state: cell.state,
                    data: {
                        ...cell.data,
                        source: newVMs[index].cell.data.source
                    }
                }
            };

            this.setState({
                cellVMs: newVMs,
                currentExecutionCount: newExecutionCount
            });

        } else if (allowAdd) {
            // This is an entirely new cell (it may have started out as finished)
            this.addCell(cell);
        }
    }

    private isCellSupported(cell: ICell): boolean {
        return !this.props.testMode || cell.data.cell_type !== 'messages';
    }

    // tslint:disable-next-line:no-any
    private finishCell = (payload?: any) => {
        if (payload) {
            const cell = payload as ICell;
            if (cell && this.isCellSupported(cell)) {
                this.updateOrAdd(cell, true);
            }
        }
    }

    // tslint:disable-next-line:no-any
    private startCell = (payload?: any) => {
        if (payload) {
            const cell = payload as ICell;
            if (cell && this.isCellSupported(cell)) {
                this.updateOrAdd(cell, true);
            }
        }
    }

    // tslint:disable-next-line:no-any
    private updateCell = (payload?: any) => {
        if (payload) {
            const cell = payload as ICell;
            if (cell && this.isCellSupported(cell)) {
                this.updateOrAdd(cell, false);
            }
        }
    }

    // Find the display value for one specific variable
    private refreshVariable = (targetVar: IJupyterVariable) => {
        this.sendMessage(InteractiveWindowMessages.GetVariableValueRequest, targetVar);
    }

    // When we get a variable value back use the ref to pass to the variable explorer
    // tslint:disable-next-line:no-any
    private getVariableValueResponse = (payload?: any) => {
        if (payload) {
            const variable = payload as IJupyterVariable;

            // Only send the updated variable data if we are on the same execution count as when we requested it
            if (variable && variable.executionCount !== undefined && variable.executionCount === this.pendingState.currentExecutionCount) {
                const stateVariable = this.pendingState.variables.findIndex(v => v.name === variable.name);
                if (stateVariable >= 0) {
                    const newState = [...this.pendingState.variables];
                    newState.splice(stateVariable, 1, variable);
                    this.setState({
                        variables: newState,
                        pendingVariableCount: Math.max(0, this.pendingState.pendingVariableCount - 1)
                    });
                }
            }
        }
    }

    // When we get our new set of variables back use the ref to pass to the variable explorer
    // tslint:disable-next-line:no-any
    private getVariablesResponse = (payload?: any) => {
        if (payload) {
            const variablesResponse = payload as IJupyterVariablesResponse;

            // Check to see if we have moved to a new execution count only send our update if we are on the same count as the request
            if (variablesResponse.executionCount === this.pendingState.currentExecutionCount) {
                this.setState({
                    variables: variablesResponse.variables,
                    pendingVariableCount: variablesResponse.variables.length
                });

                // Now put out a request for all of the sub values for the variables
                variablesResponse.variables.forEach(this.refreshVariable);
            }
        }
    }

    // tslint:disable-next-line: no-any
    private tokenizerLoaded = (_e?: any) => {
        this.setState({ tokenizerLoaded: true });
    }

    private loadOnigasm = (): Promise<ArrayBuffer> => {
        if (!this.onigasmPromise) {
            this.onigasmPromise = createDeferred<ArrayBuffer>();
            // Send our load onigasm request
            this.sendMessage(InteractiveWindowMessages.LoadOnigasmAssemblyRequest);
        }
        return this.onigasmPromise.promise;
    }

    private loadTmlanguage = (): Promise<string> => {
        if (!this.tmlangugePromise) {
            this.tmlangugePromise = createDeferred<string>();
            // Send our load onigasm request
            this.sendMessage(InteractiveWindowMessages.LoadTmLanguageRequest);
        }
        return this.tmlangugePromise.promise;
    }

    // tslint:disable-next-line: no-any
    private handleOnigasmResponse(payload: any) {
        if (payload && this.onigasmPromise) {
            const typedArray = new Uint8Array(payload.data);
            this.onigasmPromise.resolve(typedArray.buffer);
        } else if (this.onigasmPromise) {
            this.onigasmPromise.resolve(undefined);
        }
    }

    // tslint:disable-next-line: no-any
    private handleTmLanguageResponse(payload: any) {
        if (payload && this.tmlangugePromise) {
            this.tmlangugePromise.resolve(payload.toString());
        } else if (this.tmlangugePromise) {
            this.tmlangugePromise.resolve(undefined);
        }
    }

    // tslint:disable-next-line:no-any
    private handleCssResponse(payload?: any) {
        const response = payload as IGetCssResponse;
        if (response && response.css) {

            // Recompute our known dark value from the class name in the body
            // VS code should update this dynamically when the theme changes
            const computedKnownDark = this.computeKnownDark();

            // We also get this in our response, but computing is more reliable
            // than searching for it.

            if (this.pendingState.knownDark !== computedKnownDark) {
                this.darkChanged(computedKnownDark);
            }

            let fontSize: number = 14;
            let fontFamily: string = 'Consolas, \'Courier New\', monospace';
            const sizeSetting = '--code-font-size: ';
            const familySetting = '--code-font-family: ';
            const fontSizeIndex = response.css.indexOf(sizeSetting);
            const fontFamilyIndex = response.css.indexOf(familySetting);

            if (fontSizeIndex > -1) {
                const fontSizeEndIndex = response.css.indexOf('px;', fontSizeIndex + sizeSetting.length);
                fontSize = parseInt(response.css.substring(fontSizeIndex + sizeSetting.length, fontSizeEndIndex), 10);
            }

            if (fontFamilyIndex > -1) {
                const fontFamilyEndIndex = response.css.indexOf(';', fontFamilyIndex + familySetting.length);
                fontFamily = response.css.substring(fontFamilyIndex + familySetting.length, fontFamilyEndIndex);
            }

            this.setState({
                rootCss: response.css,
                font: {
                    size: fontSize,
                    family: fontFamily
                },
                vscodeThemeName: response.theme,
                knownDark: computedKnownDark
            });
        }
    }

    // tslint:disable-next-line: no-any
    private handleMonacoThemeResponse(payload?: any) {
        const response = payload as IGetMonacoThemeResponse;
        if (response && response.theme) {

            // Tell monaco we have a new theme. THis is like a state update for monaco
            monacoEditor.editor.defineTheme('interactiveWindow', response.theme);
            this.monacoThemeChanged('interactiveWindow');
        }
    }

    private computeKnownDark(): boolean {
        const ignore = getSettings && getSettings().ignoreVscodeTheme ? true : false;
        const baseTheme = ignore ? 'vscode-light' : detectBaseTheme();
        return baseTheme !== 'vscode-light';
    }
}
