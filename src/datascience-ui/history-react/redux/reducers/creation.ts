// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { Identifiers } from '../../../../client/datascience/constants';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { ICell, IDataScienceExtraSettings } from '../../../../client/datascience/types';
import { createCellVM, extractInputText, ICellViewModel, IMainState } from '../../../interactive-common/mainState';
import { createPostableAction } from '../../../interactive-common/redux/postOffice';
import { Helpers } from '../../../interactive-common/redux/reducers/helpers';
import { ICellAction } from '../../../interactive-common/redux/reducers/types';
import { InteractiveReducerArg } from '../mapping';

export namespace Creation {
    function isCellSupported(state: IMainState, cell: ICell): boolean {
        // Skip message cells in test mode
        if (state.testMode) {
            return cell.data.cell_type !== 'messages';
        }
        return true;
    }

    export function alterCellVM(cellVM: ICellViewModel, settings?: IDataScienceExtraSettings, visible?: boolean, expanded?: boolean): ICellViewModel {
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
                    const newText = extractInputText(cellVM.cell, settings);

                    newCellVM.inputBlockOpen = true;
                    newCellVM.inputBlockText = newText;
                } else {
                    // Collapse the cell
                    let newText = extractInputText(cellVM.cell, settings);
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

    export function prepareCellVM(cell: ICell, settings?: IDataScienceExtraSettings): ICellViewModel {
        let cellVM: ICellViewModel = createCellVM(cell, settings, false);

        const visible = settings ? settings.showCellInputCode : false;
        const expanded = !settings?.collapseCellInputCodeByDefault;

        // Set initial cell visibility and collapse
        cellVM = alterCellVM(cellVM, settings, visible, expanded);
        cellVM.hasBeenRun = true;

        return cellVM;
    }

    export function startCell(arg: InteractiveReducerArg<ICell>): IMainState {
        if (isCellSupported(arg.prevState, arg.payload)) {
            const result = Helpers.updateOrAdd(arg, prepareCellVM);
            if (result.cellVMs.length > arg.prevState.cellVMs.length && arg.payload.id !== Identifiers.EditCellId) {
                const cellVM = result.cellVMs[result.cellVMs.length - 1];

                // We're adding a new cell here. Tell the intellisense engine we have a new cell
                arg.queueAction(createPostableAction(
                    InteractiveWindowMessages.AddCell,
                    {
                        fullText: extractInputText(cellVM.cell, result.settings),
                        currentText: cellVM.inputBlockText,
                        cell: cellVM.cell
                    }));
            }

            return result;
        }
        return arg.prevState;
    }

    export function updateCell(arg: InteractiveReducerArg<ICell>): IMainState {
        if (isCellSupported(arg.prevState, arg.payload)) {
            return Helpers.updateOrAdd(arg, prepareCellVM);
        }
        return arg.prevState;
    }

    export function finishCell(arg: InteractiveReducerArg<ICell>): IMainState {
        if (isCellSupported(arg.prevState, arg.payload)) {
            return Helpers.updateOrAdd(arg, prepareCellVM);
        }
        return arg.prevState;
    }

    export function deleteAllCells(arg: InteractiveReducerArg): IMainState {
        // Send messages to other side to indicate the deletes
        arg.queueAction(createPostableAction(InteractiveWindowMessages.DeleteAllCells));

        return {
            ...arg.prevState,
            cellVMs: [],
            undoStack: Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs),
            selectedCellId: undefined,
            focusedCellId: undefined
        };
    }

    export function deleteCell(arg: InteractiveReducerArg<ICellAction>): IMainState {
        const index = arg.prevState.cellVMs.findIndex(c => c.cell.id === arg.payload.cellId);
        if (index >= 0 && arg.payload.cellId) {
            // Send messages to other side to indicate the delete
            arg.queueAction(createPostableAction(InteractiveWindowMessages.DeleteCell));
            arg.queueAction(createPostableAction(InteractiveWindowMessages.RemoveCell, { id: arg.payload.cellId }));

            const newVMs = arg.prevState.cellVMs.filter((_c, i) => i !== index);
            return {
                ...arg.prevState,
                cellVMs: newVMs,
                undoStack: Helpers.pushStack(arg.prevState.undoStack, arg.prevState.cellVMs)
            };
        }

        return arg.prevState;
    }

    export function unmount(arg: InteractiveReducerArg): IMainState {
        return {
            ...arg.prevState,
            cellVMs: [],
            undoStack: [],
            redoStack: [],
            editCellVM: undefined
        };
    }
}
