// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import './variableExplorer.css';

import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { IJupyterVariable } from '../../client/datascience/types';
import { getLocString } from '../react-common/locReactSide';
import { getSettings } from '../react-common/settingsReactSide';
import { CollapseButton } from './collapseButton';
import { VariableExplorerButtonCellFormatter } from './variableExplorerButtonCellFormatter';
import { CellStyle, VariableExplorerCellFormatter } from './variableExplorerCellFormatter';

import * as AdazzleReactDataGrid from 'react-data-grid';

import './variableExplorerGrid.scss';

interface IVariableExplorerProps {
    baseTheme: string;
    refreshVariables(): void;
    onHeightChange(): void;
    showDataExplorer(targetVariable: string): void;
    variableExplorerToggled(open: boolean): void;
}

interface IVariableExplorerState {
    open: boolean;
    gridColumns: {key: string; name: string}[];
    gridRows: IGridRow[];
    gridHeight: number;
    height: number;
    fontSize: number;
}

const defaultColumnProperties = {
    filterable: false,
    sortable: false,
    resizable: true
};

interface IGridRow {
    // tslint:disable-next-line:no-any
    [name: string]: any;
}

export class VariableExplorer extends React.Component<IVariableExplorerProps, IVariableExplorerState> {
    private divRef: React.RefObject<HTMLDivElement>;

    constructor(prop: IVariableExplorerProps) {
        super(prop);
        const columns = [
            {key: 'name', name: getLocString('DataScience.variableExplorerNameColumn', 'Name'), type: 'string', width: 120, formatter: <VariableExplorerCellFormatter cellStyle={CellStyle.variable} />},
            {key: 'type', name: getLocString('DataScience.variableExplorerTypeColumn', 'Type'), type: 'string', width: 120},
            {key: 'size', name: getLocString('DataScience.variableExplorerSizeColumn', 'Count'), type: 'string', width: 120, formatter: <VariableExplorerCellFormatter cellStyle={CellStyle.numeric} />},
            {key: 'value', name: getLocString('DataScience.variableExplorerValueColumn', 'Value'), type: 'string', width: 300},
            {key: 'buttons', name: '', type: 'boolean', width: 34, formatter: <VariableExplorerButtonCellFormatter showDataExplorer={this.props.showDataExplorer} baseTheme={this.props.baseTheme} /> }
        ];
        this.state = { open: false,
                        gridColumns: columns,
                        gridRows: [],
                        gridHeight: 200,
                        height: 0,
                        fontSize: 14};

        this.divRef = React.createRef<HTMLDivElement>();
    }

    public render() {
        if (getSettings && getSettings().showJupyterVariableExplorer) {
            const contentClassName = `variable-explorer-content ${this.state.open ? '' : ' hide'}`;

            const fontSizeStyle: React.CSSProperties = {
                fontSize: `${this.state.fontSize.toString()}px`
            };

            return(
                <div className='variable-explorer' ref={this.divRef} style={fontSizeStyle}>
                    <CollapseButton theme={this.props.baseTheme}
                        visible={true}
                        open={this.state.open}
                        onClick={this.toggleInputBlock}
                        tooltip={getLocString('DataScience.collapseVariableExplorerTooltip', 'Collapse variable explorer')}
                        label={getLocString('DataScience.collapseVariableExplorerLabel', 'Variables')} />
                    <div className={contentClassName}>
                        <div id='variable-explorer-data-grid'>
                            <AdazzleReactDataGrid
                                columns = {this.state.gridColumns.map(c => { return {...c, ...defaultColumnProperties}; })}
                                rowGetter = {this.getRow}
                                rowsCount = {this.state.gridRows.length}
                                minHeight = {this.state.gridHeight}
                                headerRowHeight = {this.state.fontSize + 9}
                                rowHeight = {this.state.fontSize + 9}
                                onRowDoubleClick = {this.rowDoubleClick}
                            />
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    }

    public componentDidMount = () => {
        // After mounting, check our computed style to see if the font size is changed
        if (this.divRef.current) {
            const newFontSize = parseInt(getComputedStyle(this.divRef.current).getPropertyValue('--code-font-size'), 10);

            // Make sure to check for update here so we don't update loop
            // tslint:disable-next-line: use-isnan
            if (newFontSize && newFontSize !== NaN && this.state.fontSize !== newFontSize) {
                this.setState({fontSize: newFontSize});
            }
        }

        this.updateHeight();
    }

    public componentDidUpdate = () => {
        this.updateHeight();
    }

    // New variable data passed in via a ref
    // Help to keep us independent of main history window state if we choose to break out the variable explorer
    public newVariablesData(newVariables: IJupyterVariable[]) {
        const newGridRows = newVariables.map(newVar => {
            return { buttons: {name: newVar.name, supportsDataExplorer: newVar.supportsDataExplorer}, name: newVar.name, type: newVar.type, size: '', value: getLocString('DataScience.variableLoadingValue', 'Loading...')};
        });

        this.setState({ gridRows: newGridRows});
    }

    // Update the value of a single variable already in our list
    public newVariableData(newVariable: IJupyterVariable) {
        const newGridRows = this.state.gridRows.slice();
        for (let i = 0; i < newGridRows.length; i = i + 1) {
            if (newGridRows[i].name === newVariable.name) {

                // For object with shape, use that for size
                // for object with length use that for size
                // If it doesn't have either, then just leave it out
                let newSize = '';
                if (newVariable.shape && newVariable.shape !== '') {
                    newSize = newVariable.shape;
                } else if (newVariable.count) {
                    newSize = newVariable.count.toString();
                }

                const newGridRow = {...newGridRows[i], value: newVariable.value, size: newSize};

                newGridRows[i] = newGridRow;
            }
        }

        this.setState({ gridRows: newGridRows });
    }

    public toggleInputBlock = () => {
        this.setState({open: !this.state.open});

        // If we toggle open request a data refresh
        if (!this.state.open) {
            this.props.refreshVariables();
        }

        // Notify of the toggle, reverse it as the state is not updated yet
        this.props.variableExplorerToggled(!this.state.open);
    }

    private rowDoubleClick = (_rowIndex: number, row: IGridRow) => {
        // On row double click, see if data explorer is supported and open it if it is
        if (row.buttons && row.buttons.supportsDataExplorer !== undefined
            && row.buttons.name && row.buttons.supportsDataExplorer) {
            this.props.showDataExplorer(row.buttons.name);
        }
    }

    private updateHeight = () => {
        // Make sure we check for a new height so we don't get into an update loop
        const divElement = ReactDOM.findDOMNode(this) as HTMLDivElement;

        if (divElement) {
            const newHeight = divElement.offsetHeight;

            if (this.state.height !== newHeight) {
                this.setState({height: newHeight});
                this.props.onHeightChange();
            }
        }
    }

    private getRow = (index: number) => {
        if (index >= 0 && index < this.state.gridRows.length) {
            return this.state.gridRows[index];
        }
        return {buttons: '', name: '', type: '', size: '', value: ''};
    }
}
