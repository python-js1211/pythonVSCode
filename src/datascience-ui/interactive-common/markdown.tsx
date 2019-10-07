// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as React from 'react';

import { IKeyboardEvent } from '../react-common/event';
import { Editor } from './editor';
import { IFont } from './mainState';

export interface IMarkdownProps {
    autoFocus: boolean;
    markdown : string;
    codeTheme: string;
    testMode: boolean;
    monacoTheme: string | undefined;
    outermostParentClass: string;
    editorOptions?: monacoEditor.editor.IEditorOptions;
    editorMeasureClassName?: string;
    showLineNumbers?: boolean;
    useQuickEdit?: boolean;
    font: IFont;
    onCreated(code: string, modelId: string): void;
    onChange(changes: monacoEditor.editor.IModelContentChange[], modelId: string): void;
    focused?(): void;
    unfocused?(): void;
    openLink(uri: monacoEditor.Uri): void;
    keyDown?(e: IKeyboardEvent): void;
}

export class Markdown extends React.Component<IMarkdownProps> {
    private editorRef: React.RefObject<Editor> = React.createRef<Editor>();

    constructor(prop: IMarkdownProps) {
        super(prop);
    }

    public render() {
        const classes = 'markdown-editor-area';

        return (
            <div className={classes}>
                <Editor
                    codeTheme={this.props.codeTheme}
                    autoFocus={this.props.autoFocus}
                    readOnly={false}
                    history={undefined}
                    onCreated={this.props.onCreated}
                    onChange={this.onModelChanged}
                    testMode={this.props.testMode}
                    content={this.props.markdown}
                    outermostParentClass={this.props.outermostParentClass}
                    monacoTheme={this.props.monacoTheme}
                    language='markdown'
                    editorOptions={this.props.editorOptions}
                    openLink={this.props.openLink}
                    ref={this.editorRef}
                    editorMeasureClassName={this.props.editorMeasureClassName}
                    keyDown={this.props.keyDown}
                    focused={this.props.focused}
                    unfocused={this.props.unfocused}
                    showLineNumbers={this.props.showLineNumbers}
                    useQuickEdit={this.props.useQuickEdit}
                    font={this.props.font}
                />
            </div>
        );
    }

    public giveFocus() {
        if (this.editorRef && this.editorRef.current) {
            this.editorRef.current.giveFocus();
        }
    }

    private onModelChanged = (changes: monacoEditor.editor.IModelContentChange[], model: monacoEditor.editor.ITextModel) => {
        this.props.onChange(changes, model.id);
    }

}
