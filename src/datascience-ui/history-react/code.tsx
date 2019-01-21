// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import 'codemirror/lib/codemirror.css';
import 'codemirror/mode/python/python';

import * as CodeMirror from 'codemirror';
import * as React from 'react';
import * as RCM from 'react-codemirror';

import './code.css';

import { Cursor } from './cursor';
import { InputHistory } from './inputHistory';

export interface ICodeProps {
    autoFocus: boolean;
    code : string;
    codeTheme: string;
    testMode: boolean;
    readOnly: boolean;
    history: string[];
    cursorType: string;
    onSubmit(code: string): void;
    onChangeLineCount(lineCount: number) : void;

}

interface ICodeState {
    focused: boolean;
    cursorLeft: number;
    cursorTop: number;
    cursorBottom: number;
    charUnderCursor: string;
}

export class Code extends React.Component<ICodeProps, ICodeState> {

    private codeMirror: CodeMirror.Editor | undefined;
    private history : InputHistory;
    private baseIndentation : number | undefined;

    constructor(prop: ICodeProps) {
        super(prop);
        this.state = {focused: false, cursorLeft: 0, cursorTop: 0, cursorBottom: 0, charUnderCursor: ''};
        this.history = new InputHistory(this.props.history);
    }

    public componentDidUpdate = () => {
        // Force our new value. the RCM control doesn't do this correctly
        if (this.codeMirror && this.props.readOnly && this.codeMirror.getValue() !== this.props.code) {
            this.codeMirror.setValue(this.props.code);
        }
    }

    public render() {
        const readOnly = this.props.testMode || this.props.readOnly;
        const classes = readOnly ? 'code-area' : 'code-area code-area-editable';
        return (
            <div className={classes}>
                <Cursor
                    hidden={readOnly}
                    codeInFocus={this.state.focused}
                    cursorType={this.props.cursorType}
                    text={this.state.charUnderCursor}
                    left={this.state.cursorLeft}
                    top={this.state.cursorTop}
                    bottom={this.state.cursorBottom}/>
                <RCM
                    key={1}
                    value={this.props.code}
                    autoFocus={this.props.autoFocus}
                    onChange={this.onChange}
                    options={
                        {
                            extraKeys:
                            {
                                Down: this.arrowDown,
                                Enter: this.enter,
                                'Shift-Enter': this.shiftEnter,
                                Up: this.arrowUp
                            },
                            theme: `${this.props.codeTheme} default`,
                            mode: 'python',
                            cursorBlinkRate: -1,
                            readOnly: readOnly ? 'nocursor' : false
                        }
                    }
                    ref={this.updateCodeMirror}
                    onFocusChange={this.onFocusChange}
                    onCursorActivity={this.onCursorActivity}
                />
            </div>
        );
    }

    private onCursorActivity = (codeMirror: CodeMirror.Editor) => {
        // Update left/top/char for cursor
        if (codeMirror) {
            const doc = codeMirror.getDoc();
            const selections = doc.listSelections();
            const cursor = doc.getCursor();
            const anchor = selections && selections.length > 0 ? selections[selections.length - 1].anchor : {ch: 10000, line: 10000};
            const wantStart = cursor.line < anchor.line || cursor.line === anchor.line && cursor.ch < anchor.ch;
            const coords = codeMirror.cursorCoords(wantStart, 'local');
            const char = this.getCursorChar();
            this.setState({
                cursorLeft: coords.left,
                cursorTop: coords.top,
                cursorBottom: coords.bottom,
                charUnderCursor: char
            });
        }

    }

    private getCursorChar = () : string => {
        if (this.codeMirror) {
            const doc = this.codeMirror.getDoc();
            const cursorPos = doc.getCursor();
            const line = doc.getLine(cursorPos.line);
            if (line.length > cursorPos.ch) {
                return line.slice(cursorPos.ch, cursorPos.ch + 1);
            }
        }

        // We don't need a state update on cursor change because
        // we only really need this on focus change
        return '';
    }

    private onFocusChange = (focused: boolean) => {
        this.setState({focused});
    }

    private updateCodeMirror = (rcm: ReactCodeMirror.ReactCodeMirror) => {
        if (rcm) {
            this.codeMirror = rcm.getCodeMirror();
            const coords = this.codeMirror.cursorCoords(false, 'local');
            const char = this.getCursorChar();
            this.setState({
                cursorLeft: coords.left,
                cursorTop: coords.top,
                cursorBottom: coords.bottom,
                charUnderCursor: char
            });
        }
    }

    private getBaseIndentation(instance: CodeMirror.Editor) : number {
        if (!this.baseIndentation) {
            const option = instance.getOption('indentUnit');
            if (option) {
                this.baseIndentation = parseInt(option.toString(), 10);
            } else {
                this.baseIndentation = 2;
            }
        }
        return this.baseIndentation;
    }

    private expectedIndent(instance: CodeMirror.Editor, line: number) : number {
        // Expected should be indent on the previous line and one more if line
        // ends with :
        const doc = instance.getDoc();
        const baseIndent = this.getBaseIndentation(instance);
        const lineStr = doc.getLine(line).trimRight();
        const lastChar = lineStr.length === 0 ? null : lineStr.charAt(lineStr.length - 1);
        const frontIndent = lineStr.length - lineStr.trimLeft().length;
        return frontIndent + (lastChar === ':' ? baseIndent : 0);
    }

    private shiftEnter = (instance: CodeMirror.Editor) => {
        // Shift enter is always submit (for now)
        const doc = instance.getDoc();
        // Double check we don't have an entirely empty document
        if (doc.getValue('').trim().length > 0) {
            let code = doc.getValue();
            // We have to clear the history as this CodeMirror doesn't go away.
            doc.clearHistory();
            doc.setValue('');

            // Submit without the last extra line if we have one.
            if (code.endsWith('\n\n')) {
                code = code.slice(0, code.length - 1);
            }

            this.props.onSubmit(code);
            return;
        }
    }

    private enter = (instance: CodeMirror.Editor) => {
        // See if the cursor is at the end of a single line or if on an indented line. Any indent
        // or line ends with : or ;\, then don't submit
        const doc = instance.getDoc();
        const cursor = doc.getCursor();
        const lastLine = doc.lastLine();
        if (cursor.line === lastLine) {

            // Check for any text
            const line = doc.getLine(lastLine);
            if (line.length === 0) {
                // Do the same thing as shift+enter
                this.shiftEnter(instance);
                return;
            }
        }

        // Otherwise add a line and indent the appropriate amount
        const expectedIndents = this.expectedIndent(instance, cursor.line);
        const indentString = Array(expectedIndents + 1).join(' ');
        doc.replaceRange(`\n${indentString}`, { line: cursor.line, ch: doc.getLine(cursor.line).length });
        doc.setCursor({line: cursor.line + 1, ch: indentString.length});

        // Tell our listener we added a new line
        this.props.onChangeLineCount(doc.lineCount());
    }

    private arrowUp = (instance: CodeMirror.Editor) => {
        if (instance.getDoc().getCursor().line === 0 && instance.getDoc().getCursor().ch === 0) {
            instance.getDoc().setValue(this.history.completeUp());
            return;
        }
        return CodeMirror.Pass;
    }

    private arrowDown = (instance: CodeMirror.Editor) => {
        if (instance.getDoc().getCursor().line === 0 && instance.getDoc().getCursor().ch === 0) {
            instance.getDoc().setValue(this.history.completeDown());
            return;
        }
        return CodeMirror.Pass;
    }

    private onChange = (newValue: string, change: CodeMirror.EditorChange) => {
        this.history.onChange();
    }
}
