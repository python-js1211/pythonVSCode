// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { InteractiveWindowMessages } from '../../../../client/datascience/interactive-common/interactiveWindowTypes';
import { CellState } from '../../../../client/datascience/types';
import { IMainState } from '../../mainState';
import { createPostableAction } from '../postOffice';
import { CommonReducerArg } from './types';

export namespace Kernel {
    export function restartKernel<T>(arg: CommonReducerArg<T>): IMainState {
        arg.queueAction(createPostableAction(InteractiveWindowMessages.RestartKernel));

        // Doesn't modify anything right now. Might set a busy flag or kernel state in the future
        return arg.prevState;
    }

    export function interruptKernel<T>(arg: CommonReducerArg<T>): IMainState {
        arg.queueAction(createPostableAction(InteractiveWindowMessages.Interrupt));

        // Doesn't modify anything right now. Might set a busy flag or kernel state in the future
        return arg.prevState;
    }

    export function handleRestarted<T>(arg: CommonReducerArg<T>) {
        // When we restart, make sure to turn off all executing cells. They aren't executing anymore
        const newVMs = [...arg.prevState.cellVMs];
        newVMs.forEach((vm, i) => {
            if (vm.cell.state !== CellState.finished && vm.cell.state !== CellState.error) {
                newVMs[i] = { ...vm, hasBeenRun: false, cell: { ...vm.cell, state: CellState.finished } };
            }
        });

        // Update our variables if variable window is open
        if (arg.prevState.variablesVisible) {
            arg.queueAction(createPostableAction(InteractiveWindowMessages.GetVariablesRequest, 0));
        }

        return {
            ...arg.prevState,
            cellVMs: newVMs,
            pendingVariableCount: 0,
            variables: [],
            currentExecutionCount: 0
        };
    }
}
