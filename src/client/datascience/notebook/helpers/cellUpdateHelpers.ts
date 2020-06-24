// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Responsible for syncing changes from our model into the VS Code cells.
 * Eg. when executing a cell, we update our model with the output, and here we react to those events and update the VS Code output.
 * This way, all updates to VSCode cells can happen in one place (here), and we can focus on updating just the Cell model with the data.
 * Here we only keep the outputs in sync. The assumption is that we won't be adding cells directly.
 * If adding cells and the like then please use VSC api to manipulate cells, else we have 2 ways of doing the same thing and that could lead to issues.
 */

import * as assert from 'assert';
import { createCellFrom } from '../../../../datascience-ui/common/cellFactory';
import {
    NotebookCellLanguageChangeEvent,
    NotebookCellOutputsChangeEvent,
    NotebookCellsChangeEvent
} from '../../../common/application/types';
import { MARKDOWN_LANGUAGE } from '../../../common/constants';
import { traceError } from '../../../common/logger';
import { INotebookModel } from '../../types';
import { findMappedNotebookCellModel } from './cellMappers';
import {
    createCellFromVSCNotebookCell,
    createVSCCellOutputsFromOutputs,
    updateVSCNotebookCellMetadata
} from './helpers';
// tslint:disable-next-line: no-var-requires no-require-imports
const vscodeNotebookEnums = require('vscode') as typeof import('vscode-proposed');

/**
 * If a VS Code cell changes, then ensure we update the corresponding cell in our INotebookModel.
 * I.e. if a cell is added/deleted/moved then update our model.
 * @returns {boolean} Returns `true` if the NotebookDocument was edited/updated.
 */
export function updateCellModelWithChangesToVSCCell(
    change: NotebookCellsChangeEvent | NotebookCellOutputsChangeEvent | NotebookCellLanguageChangeEvent,
    model: INotebookModel
): boolean | undefined | void {
    switch (change.type) {
        case 'changeCellOutputs':
            return clearCellOutput(change, model);
        case 'changeCellLanguage':
            return changeCellLanguage(change, model);
        case 'changeCells':
            return handleChangesToCells(change, model);
        default:
            // tslint:disable-next-line: no-string-literal
            assert.fail(`Unsupported cell change ${change['type']}`);
    }
}

/**
 * We're not interested in changes to cell output as this happens as a result of us pushing changes to the notebook.
 * I.e. cell output is already in our INotebookModel.
 * However we are interested in cell output being cleared (when user clears output).
 * @returns {boolean} Return `true` if NotebookDocument was updated/edited.
 */
function clearCellOutput(change: NotebookCellOutputsChangeEvent, model: INotebookModel): boolean {
    if (!change.cells.every((cell) => cell.outputs.length === 0)) {
        return false;
    }
    // In the VS Code cells, also clear the cell results, execution counts and times.
    change.cells.forEach((cell) => {
        cell.metadata.runState = undefined;
        cell.metadata.statusMessage = undefined;
        cell.metadata.executionOrder = undefined;
        cell.metadata.lastRunDuration = undefined;
        cell.metadata.runStartTime = undefined;
    });
    // If a cell has been cleared, then clear the corresponding ICell (cell in INotebookModel).
    change.cells.forEach((vscCell) => {
        const cell = findMappedNotebookCellModel(vscCell, model.cells);
        // tslint:disable-next-line: no-console
        console.log(cell);
        if (vscCell.cellKind === vscodeNotebookEnums.CellKind.Code) {
            cell.data.execution_count = null;
        }
        if (cell.data.metadata.vscode) {
            cell.data.metadata.vscode.start_execution_time = undefined;
            cell.data.metadata.vscode.end_execution_time = undefined;
        }
        cell.data.outputs = [];
        updateVSCNotebookCellMetadata(vscCell.metadata, cell);
        model.update({
            source: 'user',
            kind: 'clear',
            oldDirty: model.isDirty,
            newDirty: true,
            oldCells: [cell]
        });
    });

    return true;
}

function changeCellLanguage(change: NotebookCellLanguageChangeEvent, model: INotebookModel) {
    const cellModel = findMappedNotebookCellModel(change.cell, model.cells);
    const cellData = createCellFrom(cellModel.data, change.language === MARKDOWN_LANGUAGE ? 'markdown' : 'code');
    // tslint:disable-next-line: no-any
    change.cell.outputs = createVSCCellOutputsFromOutputs(cellData.outputs as any);
    change.cell.metadata.executionOrder = undefined;
    change.cell.metadata.hasExecutionOrder = change.language !== MARKDOWN_LANGUAGE; // Do not check for Python, to support other languages
    change.cell.metadata.runnable = change.language !== MARKDOWN_LANGUAGE; // Do not check for Python, to support other languages

    // Create a new cell & replace old one.
    const oldCellIndex = model.cells.indexOf(cellModel);
    model.cells[oldCellIndex] = createCellFromVSCNotebookCell(change.cell, model);
}

function handleChangesToCells(change: NotebookCellsChangeEvent, model: INotebookModel) {
    if (isCellMoveChange(change)) {
        handleCellMove(change, model);
    } else if (isCellDelete(change)) {
        handleCellDelete(change, model);
    } else if (isCellInsertion(change)) {
        handleCellInsertion(change, model);
    } else {
        traceError('Unsupported cell change', change);
        throw new Error('Unsupported cell change');
    }
}
/**
 * Determines whether a change is a move of a cell.
 * A move = Delete the cell as the first change, then as the second change insert into required place.
 */
function isCellMoveChange(change: NotebookCellsChangeEvent) {
    if (change.changes.length !== 2) {
        return false;
    }
    const [deleteChange, insertChange] = change.changes;
    //
    return (
        (deleteChange.deletedCount === 1 &&
            deleteChange.items.length === 0 &&
            // When moving, the second change needs to be an insertion of a single item at a given index.
            insertChange.deletedCount === 0) ||
        insertChange.items.length === 1
    );
}
function isCellDelete(change: NotebookCellsChangeEvent) {
    return change.changes.length === 1 && change.changes[0].deletedCount > 0 && change.changes[0].items.length === 0;
}
function isCellInsertion(change: NotebookCellsChangeEvent) {
    return change.changes.length === 1 && change.changes[0].deletedCount === 0 && change.changes[0].items.length > 0;
}

function handleCellMove(change: NotebookCellsChangeEvent, model: INotebookModel) {
    assert.equal(change.changes.length, 2, 'When moving cells we must have only 2 changes');
    const [, insertChange] = change.changes;
    const cellToSwap = findMappedNotebookCellModel(insertChange.items[0]!, model.cells);
    const cellToSwapWith = model.cells[insertChange.start];
    assert.notEqual(cellToSwap, cellToSwapWith, 'Cannot swap cell with the same cell');

    const indexOfCellToSwap = model.cells.indexOf(cellToSwap);
    model.cells[insertChange.start] = cellToSwap;
    model.cells[indexOfCellToSwap] = cellToSwapWith;
}
function handleCellInsertion(change: NotebookCellsChangeEvent, model: INotebookModel) {
    assert.equal(change.changes.length, 1, 'When inserting cells we must have only 1 change');
    assert.equal(change.changes[0].items.length, 1, 'Insertion of more than 1 cell is not supported');
    const insertChange = change.changes[0];
    const cell = change.changes[0].items[0];
    const newCell = createCellFromVSCNotebookCell(cell, model);
    model.cells.splice(insertChange.start, 0, newCell);
}
function handleCellDelete(change: NotebookCellsChangeEvent, model: INotebookModel) {
    assert.equal(change.changes.length, 1, 'When deleting cells we must have only 1 change');
    const deletionChange = change.changes[0];
    assert.equal(deletionChange.deletedCount, 1, 'Deleting more than one cell is not supported');
    model.cells.splice(deletionChange.start, 1);
}
