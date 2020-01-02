// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { CellMatcher } from '../../../../client/datascience/cellMatcher';
import { concatMultilineStringInput } from '../../../../client/datascience/common';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { CellState } from '../../../../client/datascience/types';
import { CursorPos, IMainState } from '../../../interactive-common/mainState';
import { createPostableAction } from '../../../interactive-common/redux/postOffice';
import { Helpers } from '../../../interactive-common/redux/reducers/helpers';
import { CommonActionType, ICellAction, IChangeCellTypeAction, ICodeAction, IExecuteAction } from '../../../interactive-common/redux/reducers/types';
import { QueueAnotherFunc } from '../../../react-common/reduxUtils';
import { NativeEditorReducerArg } from '../mapping';
import { Creation } from './creation';
import { Effects } from './effects';

export namespace Execution {
    function executeRange(prevState: IMainState, start: number, end: number, codes: string[], queueAction: QueueAnotherFunc<CommonActionType>): IMainState {
        const newVMs = [...prevState.cellVMs];
        for (let pos = start; pos <= end; pos += 1) {
            const orig = prevState.cellVMs[pos];
            const code = codes[pos - start];
            // noop if the submitted code is just a cell marker
            const matcher = new CellMatcher(prevState.settings);
            if (code && matcher.stripFirstMarker(code).length > 0) {
                if (orig.cell.data.cell_type === 'code') {
                    // Update our input cell to be in progress again and clear outputs
                    newVMs[pos] = Helpers.asCellViewModel({
                        ...orig,
                        inputBlockText: code,
                        cell: { ...orig.cell, state: CellState.executing, data: { ...orig.cell.data, source: code, outputs: [] } }
                    });

                    // Send a message if a code cell
                    queueAction(createPostableAction(InteractiveWindowMessages.ReExecuteCell, { code, id: orig.cell.id }));
                } else {
                    // Update our input to be our new code
                    newVMs[pos] = Helpers.asCellViewModel({ ...orig, inputBlockText: code, cell: { ...orig.cell, data: { ...orig.cell.data, source: code } } });
                }
            }
        }

        return {
            ...prevState,
            cellVMs: newVMs
        };
    }

    export function executeAbove(arg: NativeEditorReducerArg<ICellAction>): IMainState {
        const index = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.cellId);
        if (index > 0) {
            const codes = arg.prevState.cellVMs.filter((_c, i) => i < index).map(c => concatMultilineStringInput(c.cell.data.source));
            return executeRange(arg.prevState, 0, index - 1, codes, arg.queueAction);
        }
        return arg.prevState;
    }

    export function executeCell(arg: NativeEditorReducerArg<IExecuteAction>): IMainState {
        const index = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.cellId);
        if (index >= 0) {
            // Start executing this cell.
            const executeResult = executeRange(arg.prevState, index, index, [arg.payload.code], arg.queueAction);

            // Modify the execute result if moving
            switch (arg.payload.moveOp) {
                case 'add':
                    // Add a new cell below
                    return Creation.insertBelow({ ...arg, prevState: executeResult });

                case 'select':
                    // Select the cell below this one, but don't focus it
                    if (index < arg.prevState.cellVMs.length - 1) {
                        return Effects.selectCell({
                            ...arg,
                            prevState: {
                                ...executeResult,
                                focusedCellId: undefined
                            },
                            payload: {
                                ...arg.payload,
                                cellId: arg.prevState.cellVMs[index + 1].cell.id,
                                cursorPos: CursorPos.Current
                            }
                        });
                    }
                    return executeResult;

                default:
                    return executeResult;
            }
        }
        return arg.prevState;
    }

    export function executeCellAndBelow(arg: NativeEditorReducerArg<ICodeAction>): IMainState {
        const index = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.cellId);
        if (index >= 0) {
            const codes = arg.prevState.cellVMs.filter((_c, i) => i > index).map(c => concatMultilineStringInput(c.cell.data.source));
            return executeRange(arg.prevState, index, index + codes.length, [arg.payload.code, ...codes], arg.queueAction);
        }
        return arg.prevState;
    }

    export function executeAllCells(arg: NativeEditorReducerArg): IMainState {
        // This is the same thing as executing the first cell and all below
        const firstCell = arg.prevState.cellVMs.length > 0 ? arg.prevState.cellVMs[0].cell.id : undefined;
        if (firstCell) {
            return executeCellAndBelow({ ...arg, payload: { cellId: firstCell, code: concatMultilineStringInput(arg.prevState.cellVMs[0].cell.data.source) } });
        }

        return arg.prevState;
    }

    export function executeSelectedCell(arg: NativeEditorReducerArg): IMainState {
        // This is the same thing as executing the selected cell
        const index = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.prevState.selectedCellId);
        if (arg.prevState.selectedCellId && index >= 0) {
            return executeCell({
                ...arg,
                payload: { cellId: arg.prevState.selectedCellId, code: concatMultilineStringInput(arg.prevState.cellVMs[index].cell.data.source), moveOp: 'none' }
            });
        }

        return arg.prevState;
    }

    export function clearAllOutputs(arg: NativeEditorReducerArg): IMainState {
        const newList = arg.prevState.cellVMs.map(cellVM => {
            return Helpers.asCellViewModel({ ...cellVM, cell: { ...cellVM.cell, data: { ...cellVM.cell.data, outputs: [], execution_count: null } } });
        });

        arg.queueAction(createPostableAction(InteractiveWindowMessages.ClearAllOutputs));

        return {
            ...arg.prevState,
            cellVMs: newList
        };
    }

    export function changeCellType(arg: NativeEditorReducerArg<IChangeCellTypeAction>): IMainState {
        const index = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.cellId);
        if (index >= 0) {
            const cellVMs = [...arg.prevState.cellVMs];
            const current = arg.prevState.cellVMs[index];
            const newType = current.cell.data.cell_type === 'code' ? 'markdown' : 'code';
            const newCell = {
                ...current,
                inputBlockText: arg.payload.currentCode,
                cell: {
                    ...current.cell,
                    data: { ...current.cell.data, cell_type: newType, source: arg.payload.currentCode }
                }
            };
            // tslint:disable-next-line: no-any
            cellVMs[index] = newCell as any; // This is because IMessageCell doesn't fit in here. But message cells can't change type
            if (newType === 'code') {
                arg.queueAction(
                    createPostableAction(InteractiveWindowMessages.InsertCell, {
                        cell: cellVMs[index].cell,
                        index,
                        code: arg.payload.currentCode,
                        codeCellAboveId: Helpers.firstCodeCellAbove(arg.prevState, current.cell.id)
                    })
                );
            } else {
                arg.queueAction(createPostableAction(InteractiveWindowMessages.RemoveCell, { id: current.cell.id }));
            }

            // When changing a cell type, also give the cell focus.
            return Effects.focusCell({ ...arg, prevState: { ...arg.prevState, cellVMs }, payload: { cellId: arg.payload.cellId, cursorPos: CursorPos.Current } });
        }

        return arg.prevState;
    }

    export function undo(arg: NativeEditorReducerArg): IMainState {
        if (arg.prevState.undoStack.length > 0) {
            // Pop one off of our undo stack and update our redo
            const cells = arg.prevState.undoStack[arg.prevState.undoStack.length - 1];
            const undoStack = arg.prevState.undoStack.slice(0, arg.prevState.undoStack.length - 1);
            const selected = cells.findIndex(c => c.selected);
            const redoStack = Helpers.pushStack(arg.prevState.redoStack, arg.prevState.cellVMs);
            arg.queueAction(createPostableAction(InteractiveWindowMessages.Undo));
            return {
                ...arg.prevState,
                cellVMs: cells,
                undoStack: undoStack,
                redoStack: redoStack,
                skipNextScroll: true,
                selectedCellId: selected >= 0 ? cells[selected].cell.id : undefined,
                focusedCellId: selected >= 0 && cells[selected].focused ? cells[selected].cell.id : undefined
            };
        }

        return arg.prevState;
    }

    export function redo(arg: NativeEditorReducerArg): IMainState {
        if (arg.prevState.redoStack.length > 0) {
            // Pop one off of our redo stack and update our undo
            const cells = arg.prevState.redoStack[arg.prevState.redoStack.length - 1];
            const redoStack = arg.prevState.redoStack.slice(0, arg.prevState.redoStack.length - 1);
            const undoStack = Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs);
            const selected = cells.findIndex(c => c.selected);
            arg.queueAction(createPostableAction(InteractiveWindowMessages.Redo));
            return {
                ...arg.prevState,
                cellVMs: cells,
                undoStack: undoStack,
                redoStack: redoStack,
                skipNextScroll: true,
                selectedCellId: selected >= 0 ? cells[selected].cell.id : undefined,
                focusedCellId: selected >= 0 && cells[selected].focused ? cells[selected].cell.id : undefined
            };
        }

        return arg.prevState;
    }
}
