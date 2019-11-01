// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { JSONObject } from '@phosphor/coreutils';
import ansiRegex from 'ansi-regex';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as React from 'react';
import '../../client/common/extensions';
import { concatMultilineStringInput, concatMultilineStringOutput } from '../../client/datascience/common';
import { Identifiers } from '../../client/datascience/constants';
import { CellState } from '../../client/datascience/types';
import { ClassType } from '../../client/ioc/types';
import { noop } from '../../test/core';
import { Image, ImageName } from '../react-common/image';
import { ImageButton } from '../react-common/imageButton';
import { getLocString } from '../react-common/locReactSide';
import { fixLatexEquations } from './latexManipulation';
import { ICellViewModel } from './mainState';
import { displayOrder, richestMimetype, transforms } from './transforms';

// tslint:disable-next-line: no-var-requires no-require-imports
const ansiToHtml = require('ansi-to-html');

// tslint:disable-next-line: no-require-imports
import cloneDeep = require('lodash/cloneDeep');

interface ICellOutputProps {
    cellVM: ICellViewModel;
    baseTheme: string;
    maxTextSize?: number;
    hideOutput?: boolean;
    themeMatplotlibPlots?: boolean;
    openLink(uri: monacoEditor.Uri): void;
    expandImage(imageHtml: string): void;
}

interface ICellOutput {
    mimeType: string;
    data: nbformat.MultilineString | JSONObject;
    renderWithScrollbars: boolean;
    isText: boolean;
    isError: boolean;
    extraButton: JSX.Element | null; // Extra button for plot viewing is stored here
    outputSpanClassName?: string; // Wrap this output in a span with the following className, undefined to not wrap
    doubleClick(): void; // Double click handler for plot viewing is stored here
}
// tslint:disable: react-this-binding-issue
export class CellOutput extends React.Component<ICellOutputProps> {
    // tslint:disable-next-line: no-any
    private static ansiToHtmlClass_ctor: ClassType<any> | undefined;
    constructor(prop: ICellOutputProps) {
        super(prop);
    }

    // tslint:disable-next-line: no-any
    private static get ansiToHtmlClass(): ClassType<any> {
        if (!CellOutput.ansiToHtmlClass_ctor) {
            // ansiToHtml is different between the tests running and webpack. figure out which one
            // tslint:disable-next-line: no-any
            if (ansiToHtml instanceof Function) {
                CellOutput.ansiToHtmlClass_ctor = ansiToHtml;
            } else {
                CellOutput.ansiToHtmlClass_ctor = ansiToHtml.default;
            }
        }
        return CellOutput.ansiToHtmlClass_ctor!;
    }

    private static getAnsiToHtmlOptions() : { fg: string; bg: string; colors: string [] } {
        // Here's the default colors for ansiToHtml. We need to use the
        // colors from our current theme.
        // const colors = {
        //     0: '#000',
        //     1: '#A00',
        //     2: '#0A0',
        //     3: '#A50',
        //     4: '#00A',
        //     5: '#A0A',
        //     6: '#0AA',
        //     7: '#AAA',
        //     8: '#555',
        //     9: '#F55',
        //     10: '#5F5',
        //     11: '#FF5',
        //     12: '#55F',
        //     13: '#F5F',
        //     14: '#5FF',
        //     15: '#FFF'
        // };
        return {
            fg: 'var(--vscode-terminal-foreground)',
            bg: 'var(--vscode-terminal-background)',
            colors: [
                'var(--vscode-terminal-ansiBlack)',         // 0
                'var(--vscode-terminal-ansiBrightRed)',     // 1
                'var(--vscode-terminal-ansiGreen)',         // 2
                'var(--vscode-terminal-ansiYellow)',        // 3
                'var(--vscode-terminal-ansiBrightBlue)',    // 4
                'var(--vscode-terminal-ansiMagenta)',       // 5
                'var(--vscode-terminal-ansiCyan)',          // 6
                'var(--vscode-terminal-ansiBrightBlack)',   // 7
                'var(--vscode-terminal-ansiWhite)',         // 8
                'var(--vscode-terminal-ansiRed)',           // 9
                'var(--vscode-terminal-ansiBrightGreen)',   // 10
                'var(--vscode-terminal-ansiBrightYellow)',  // 11
                'var(--vscode-terminal-ansiBlue)',          // 12
                'var(--vscode-terminal-ansiBrightMagenta)', // 13
                'var(--vscode-terminal-ansiBrightCyan)',    // 14
                'var(--vscode-terminal-ansiBrightWhite)'    // 15
            ]
        };
    }
    public render() {
        // Only render results if not an edit cell
        if (this.props.cellVM.cell.id !== Identifiers.EditCellId) {
            const outputClassNames = this.isCodeCell() ?
                `cell-output cell-output-${this.props.baseTheme}` :
                'markdown-cell-output-container';

            // Then combine them inside a div
            return <div className={outputClassNames}>{this.renderResults()}</div>;
        }
        return null;
    }

    // Public for testing
    public getUnknownMimeTypeFormatString() {
        return getLocString('DataScience.unknownMimeTypeFormat', 'Unknown Mime Type');
    }

    private getCell = () => {
        return this.props.cellVM.cell;
    }

    private isCodeCell = () => {
        return this.props.cellVM.cell.data.cell_type === 'code';
    }

    private hasOutput = () => {
        return this.getCell().state === CellState.finished || this.getCell().state === CellState.error || this.getCell().state === CellState.executing;
    }

    private getCodeCell = () => {
        return this.props.cellVM.cell.data as nbformat.ICodeCell;
    }

    private getMarkdownCell = () => {
        return this.props.cellVM.cell.data as nbformat.IMarkdownCell;
    }

     private renderResults = (): JSX.Element[] => {
        // Results depend upon the type of cell
        if (this.isCodeCell()) {
            return this.renderCodeOutputs();
        } else if (this.props.cellVM.cell.id !== Identifiers.EditCellId) {
            return this.renderMarkdownOutputs();
        } else {
            return [];
        }
    }

    private renderCodeOutputs = () => {
        if (this.isCodeCell() && this.hasOutput() && this.getCodeCell().outputs && !this.props.hideOutput) {
            // Render the outputs
            return this.renderOutputs(this.getCodeCell().outputs);
        }

        return [];
    }

    private renderMarkdownOutputs = () => {
        const markdown = this.getMarkdownCell();
        // React-markdown expects that the source is a string
        const source = fixLatexEquations(concatMultilineStringInput(markdown.source));
        const Transform = transforms['text/markdown'];
        const MarkdownClassName = 'markdown-cell-output';

        return [<div key={0} className={MarkdownClassName}><Transform key={0} data={source} /></div>];
    }

    // tslint:disable-next-line: max-func-body-length
    private transformOutput(output: nbformat.IOutput): ICellOutput {
        // First make a copy of the outputs.
        const copy = cloneDeep(output);

        let isText = false;
        let isError = false;
        let mimeType = 'text/plain';
        let renderWithScrollbars = false;
        let extraButton: JSX.Element | null = null;

        // Special case for json. Just turn into a string
        if (copy.data && copy.data.hasOwnProperty('application/json')) {
            copy.data = JSON.stringify(copy.data);
            renderWithScrollbars = true;
            isText = true;
        } else if (copy.output_type === 'stream') {
            // Stream output needs to be wrapped in xmp so it
            // show literally. Otherwise < chars start a new html element.
            mimeType = 'text/html';
            isText = true;
            isError = false;
            renderWithScrollbars = true;
            const stream = copy as nbformat.IStream;
            const formatted = concatMultilineStringOutput(stream.text);
            copy.data = {
                'text/html': formatted.includes('<') ? `<xmp>${formatted}</xmp>` : `<div>${formatted}</div>`
            };

            // Output may have goofy ascii colorization chars in it. Try
            // colorizing if we don't have html that needs <xmp> around it (ex. <type ='string'>)
            try {
                if (ansiRegex().test(formatted)) {
                    const converter = new CellOutput.ansiToHtmlClass(CellOutput.getAnsiToHtmlOptions());
                    const html = converter.toHtml(formatted);
                    copy.data = {
                        'text/html': html
                    };
                }
            } catch {
                noop();
            }
        } else if (copy.output_type === 'error') {
            mimeType = 'text/html';
            isText = true;
            isError = true;
            renderWithScrollbars = true;
            const error = copy as nbformat.IError;
            try {
                const converter = new CellOutput.ansiToHtmlClass(CellOutput.getAnsiToHtmlOptions());
                const trace = converter.toHtml(error.traceback.join('\n'));
                copy.data = {
                    'text/html': trace
                };
            } catch {
                // This can fail during unit tests, just use the raw data
                copy.data = {
                    'text/html': error.evalue
                };
            }
        } else if (copy.data) {
            // Compute the mime type
            mimeType = richestMimetype(copy.data, displayOrder, transforms);
        }

        // Then parse the mime type
        try {
            const mimeBundle = copy.data as nbformat.IMimeBundle;
            let data: nbformat.MultilineString | JSONObject = mimeBundle[mimeType];

            switch (mimeType) {
                case 'text/plain':
                case 'text/html':
                    return {
                        mimeType,
                        data: concatMultilineStringOutput(data as nbformat.MultilineString),
                        isText,
                        isError,
                        renderWithScrollbars: true,
                        extraButton,
                        doubleClick: noop
                    };

                case 'image/svg+xml':
                case 'image/png':
                    // There should be two mime bundles. Well if enablePlotViewer is turned on. See if we have both
                    const svg = mimeBundle['image/svg+xml'];
                    const png = mimeBundle['image/png'];
                    const buttonTheme = this.props.themeMatplotlibPlots ? this.props.baseTheme : 'vscode-light';
                    let doubleClick: () => void = noop;
                    if (svg && png) {
                        // Save the svg in the extra button.
                        const openClick = () => {
                            this.props.expandImage(svg.toString());
                        };
                        extraButton = (
                            <div className='plot-open-button'>
                                <ImageButton baseTheme={buttonTheme} tooltip={getLocString('DataScience.plotOpen', 'Expand image')} onClick={openClick}>
                                    <Image baseTheme={buttonTheme} class='image-button-image' image={ImageName.OpenPlot} />
                                </ImageButton>
                            </div>
                        );

                        // Switch the data to the png
                        data = png;
                        mimeType = 'image/png';

                        // Switch double click to do the same thing as the extra button
                        doubleClick = openClick;
                    }

                    // return the image
                    // If not theming plots then wrap in a span
                    return {
                        mimeType,
                        data,
                        isText,
                        isError,
                        renderWithScrollbars,
                        extraButton,
                        doubleClick,
                        outputSpanClassName: this.props.themeMatplotlibPlots ? undefined : 'cell-output-plot-background'
                    };

                default:
                    return {
                        mimeType,
                        data,
                        isText,
                        isError,
                        renderWithScrollbars,
                        extraButton,
                        doubleClick: noop
                    };
            }
        } catch (e) {
            return {
                data: e.toString(),
                isText: true,
                isError: false,
                extraButton: null,
                renderWithScrollbars: false,
                mimeType: 'text/plain',
                doubleClick: noop
            };
        }
    }

    private click = (event: React.MouseEvent<HTMLDivElement>) => {
        // If this is an anchor element, forward the click as Jupyter does.
        let anchor = event.target as HTMLAnchorElement;
        if (anchor && anchor.href) {
            // Href may be redirected to an inner anchor
            if (anchor.href.startsWith('vscode')) {
                const inner = anchor.getElementsByTagName('a');
                if (inner && inner.length > 0) {
                    anchor = inner[0];
                }
            }
            if (anchor && anchor.href && !anchor.href.startsWith('vscode')) {
                this.props.openLink(monacoEditor.Uri.parse(anchor.href));
            }
        }
    }

    // tslint:disable-next-line: max-func-body-length
    private renderOutputs(outputs: nbformat.IOutput[]): JSX.Element[] {
        return [this.renderOutput(outputs)];
    }

    private renderOutput = (outputs: nbformat.IOutput[]): JSX.Element => {
        const buffer: JSX.Element[] = [];
        const transformedList = outputs.map(this.transformOutput.bind(this));

        transformedList.forEach((transformed, index) => {
            let mimetype = transformed.mimeType;

            // If that worked, use the transform
            if (mimetype) {
                // Get the matching React.Component for that mimetype
                const Transform = transforms[mimetype];

                let className = transformed.isText ? 'cell-output-text' : 'cell-output-html';
                className = transformed.isError ? `${className} cell-output-error` : className;

                // If we are not theming plots then wrap them in a white span
                if (transformed.outputSpanClassName) {
                    buffer.push(
                        <div role='group' key={index} onDoubleClick={transformed.doubleClick} onClick={this.click} className={className}>
                            <span className={transformed.outputSpanClassName}>
                                {transformed.extraButton}
                                <Transform data={transformed.data} />
                            </span>
                        </div>
                    );
                } else {
                    buffer.push(
                        <div role='group' key={index} onDoubleClick={transformed.doubleClick} onClick={this.click} className={className}>
                            {transformed.extraButton}
                            <Transform data={transformed.data} />
                        </div>
                    );
                }
            } else {
                if (transformed.data) {
                    const keys = Object.keys(transformed.data);
                    mimetype = keys.length > 0 ? keys[0] : 'unknown';
                } else {
                    mimetype = 'unknown';
                }
                const str: string = this.getUnknownMimeTypeFormatString().format(mimetype);
                buffer.push(<div key={index}>{str}</div>);
            }
        });

        // Create a default set of properties
        const style: React.CSSProperties = {
        };

        // Create a scrollbar style if necessary
        if (transformedList.some(transformed => transformed.renderWithScrollbars) && this.props.maxTextSize) {
            style.overflowY = 'auto';
            style.maxHeight = `${this.props.maxTextSize}px`;
        }

        return <div key={0} style={style}>{buffer}</div>;
    }
}
