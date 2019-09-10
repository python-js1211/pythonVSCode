
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as React from 'react';
import { IDisposable } from '../../client/common/types';

// tslint:disable-next-line:no-require-imports no-var-requires
const debounce = require('lodash/debounce') as typeof import('lodash/debounce');

// See the discussion here: https://github.com/Microsoft/tslint-microsoft-contrib/issues/676
// tslint:disable: react-this-binding-issue
// tslint:disable-next-line:no-require-imports no-var-requires
const throttle = require('lodash/throttle') as typeof import('lodash/throttle');

import './monacoEditor.css';

const LINE_HEIGHT = 18;

export interface IMonacoEditorProps {
    language: string;
    value: string;
    theme?: string;
    outermostParentClass: string;
    options: monacoEditor.editor.IEditorConstructionOptions;
    testMode?: boolean;
    forceBackground?: string;
    measureWidthClassName?: string;
    editorMounted(editor: monacoEditor.editor.IStandaloneCodeEditor): void;
    openLink(uri: monacoEditor.Uri): void;
    lineCountChanged(newCount: number): void;
}

interface IMonacoEditorState {
    editor?: monacoEditor.editor.IStandaloneCodeEditor;
    model: monacoEditor.editor.ITextModel | null;
    visibleLineCount: number;
}

// Need this to prevent wiping of the current value on a componentUpdate. react-monaco-editor has that problem.

export class MonacoEditor extends React.Component<IMonacoEditorProps, IMonacoEditorState> {
    private containerRef: React.RefObject<HTMLDivElement>;
    private measureWidthRef: React.RefObject<HTMLDivElement>;
    private resizeTimer?: number;
    private leaveTimer?: number;
    private subscriptions: monacoEditor.IDisposable[] = [];
    private widgetParent: HTMLDivElement | undefined;
    private outermostParent: HTMLElement | null = null;
    private enteredHover: boolean = false;
    private lastOffsetLeft: number | undefined;
    private lastOffsetTop: number | undefined;
    private debouncedUpdateEditorSize : () => void | undefined;
    private styleObserver : MutationObserver | undefined;
    private watchingMargin: boolean = false;
    private throttledUpdateWidgetPosition = throttle(this.updateWidgetPosition.bind(this), 100);

    constructor(props: IMonacoEditorProps) {
        super(props);
        this.state = { editor: undefined, model: null, visibleLineCount: -1 };
        this.containerRef = React.createRef<HTMLDivElement>();
        this.measureWidthRef = React.createRef<HTMLDivElement>();
        this.debouncedUpdateEditorSize = debounce(this.updateEditorSize.bind(this), 150);

        // JSDOM has MutationObserver in the window object
        if ('MutationObserver' in window) {
            // tslint:disable-next-line: no-string-literal no-any
            const ctor = (window as any)['MutationObserver'];
            this.styleObserver = new ctor(this.watchStyles);
        }
    }

    // tslint:disable-next-line: max-func-body-length
    public componentDidMount = () => {
        if (window) {
            window.addEventListener('resize', this.windowResized);
        }
        if (this.containerRef.current) {
            // Compute our outermost parent
            let outerParent = this.containerRef.current.parentElement;
            while (outerParent && !outerParent.classList.contains(this.props.outermostParentClass)) {
                outerParent = outerParent.parentElement;
            }
            this.outermostParent = outerParent;
            if (this.outermostParent) {
                this.outermostParent.addEventListener('mouseleave', this.outermostParentLeave);
            }

            // Create the editor
            const editor = monacoEditor.editor.create(this.containerRef.current,
                {
                    value: this.props.value,
                    language: this.props.language,
                    ...this.props.options
                });

            // Force the editor to behave like a unix editor as
            // all of our code is assuming that.
            const model = editor.getModel();
            if (model) {
                model.setEOL(monacoEditor.editor.EndOfLineSequence.LF);
            }

            // Register a link opener so when a user clicks on a link we can navigate to it.
            // tslint:disable-next-line: no-any
            const openerService = (editor.getContribution('editor.linkDetector') as any).openerService;
            if (openerService && openerService.open) {
                openerService.open = this.props.openLink;
            }

            // Save the editor and the model in our state.
            this.setState({ editor, model });
            if (this.props.theme) {
                monacoEditor.editor.setTheme(this.props.theme);
            }

            // do the initial set of the height (wait a bit)
            this.windowResized();

            // on each edit recompute height (wait a bit)
            if (model) {
                this.subscriptions.push(model.onDidChangeContent(() => {
                    this.windowResized();
                }));
            }

            // On layout recompute height
            this.subscriptions.push(editor.onDidLayoutChange(() => {
                this.windowResized();
            }));

            // Setup our context menu to show up outside. Autocomplete doesn't have this problem so it just works
            this.subscriptions.push(editor.onContextMenu((e) => {
                if (this.state.editor) {
                    const domNode = this.state.editor.getDomNode();
                    const contextMenuElement = domNode ? domNode.querySelector('.monaco-menu-container') as HTMLElement : null;
                    if (contextMenuElement) {
                        const posY = (e.event.posy + contextMenuElement.clientHeight) > window.outerHeight
                            ? e.event.posy - contextMenuElement.clientHeight
                            : e.event.posy;
                        const posX = (e.event.posx + contextMenuElement.clientWidth) > window.outerWidth
                            ? e.event.posx - contextMenuElement.clientWidth
                            : e.event.posx;
                        contextMenuElement.style.position = 'fixed';
                        contextMenuElement.style.top = `${Math.max(0, Math.floor(posY))}px`;
                        contextMenuElement.style.left = `${Math.max(0, Math.floor(posX))}px`;
                    }
                }
            }));

            // Update our margin to include the correct line number style
            this.updateMargin(editor);

            // Make sure our suggest and hover windows show up on top of other stuff
            this.updateWidgetParent(editor);

            // If we're readonly, monaco is not putting the aria-readonly property on the textarea
            // We should do that
            if (this.props.options.readOnly) {
                this.setAriaReadOnly(editor);
            }

            // Eliminate the find action if possible
            // tslint:disable-next-line: no-any
            const editorAny = editor as any;
            if (editorAny._standaloneKeybindingService) {
                editorAny._standaloneKeybindingService.addDynamicKeybinding('-actions.find');
            }

            // Tell our parent the editor is ready to use
            this.props.editorMounted(editor);
        }
    }

    public componentWillUnmount = () => {
        if (this.resizeTimer) {
            window.clearTimeout(this.resizeTimer);
        }

        if (window) {
            window.removeEventListener('resize', this.windowResized);
        }

        if (this.outermostParent) {
            this.outermostParent.removeEventListener('mouseleave', this.outermostParentLeave);
            this.outermostParent = null;
        }
        if (this.widgetParent) {
            this.widgetParent.remove();
        }

        this.subscriptions.forEach(d => d.dispose());
        if (this.state.editor) {
            this.state.editor.dispose();
        }

        if (this.styleObserver) {
            this.styleObserver.disconnect();
        }
    }

    public componentDidUpdate(prevProps: IMonacoEditorProps, prevState: IMonacoEditorState) {
        if (this.state.editor) {
            if (prevProps.language !== this.props.language && this.state.model) {
                monacoEditor.editor.setModelLanguage(this.state.model, this.props.language);
            }
            if (prevProps.theme !== this.props.theme && this.props.theme) {
                monacoEditor.editor.setTheme(this.props.theme);
            }
            if (prevProps.options !== this.props.options) {
                if (prevProps.options.lineNumbers !== this.props.options.lineNumbers) {
                    this.updateMargin(this.state.editor);
                }
                this.state.editor.updateOptions(this.props.options);
            }
            if (prevProps.value !== this.props.value && this.state.model && this.state.model.getValue() !== this.props.value) {
                this.state.model.setValue(this.props.value);
            }
        }

        if (this.state.visibleLineCount === -1) {
            this.updateEditorSize();
        } else {
            // Debounce the call. This can happen too fast
            this.debouncedUpdateEditorSize();
        }
        // If this is our first time setting the editor, we might need to dynanically modify the styles
        // that the editor generates for the background colors.
        if (!prevState.editor && this.state.editor && this.containerRef.current) {
            this.updateBackgroundStyle();
        }
    }

    public render() {
        const measureWidthClassName = this.props.measureWidthClassName ? this.props.measureWidthClassName : 'measure-width-div';
        return (
            <div className='monaco-editor-outer-container' ref={this.containerRef}>
                <div className='monaco-editor-container' />
                <div className={measureWidthClassName} ref={this.measureWidthRef} />
            </div>
        );
    }

    public isSuggesting() : boolean {
        // This should mean our widgetParent has some height
        if (this.widgetParent && this.widgetParent.firstChild && this.widgetParent.firstChild.childNodes.length >= 2) {
            const htmlFirstChild = this.widgetParent.firstChild as HTMLElement;
            const suggestWidget = htmlFirstChild.getElementsByClassName('suggest-widget')[0] as HTMLDivElement;
            const signatureHelpWidget = htmlFirstChild.getElementsByClassName('parameter-hints-widget')[0] as HTMLDivElement;
            return this.isElementVisible(suggestWidget) || this.isElementVisible(signatureHelpWidget);
        }
        return false;
    }

    private watchStyles = (mutations: MutationRecord[], _observer: MutationObserver): void => {
        try {
            if (mutations && mutations.length > 0 && this.styleObserver) {
                mutations.forEach(m => {
                    if (m.type === 'attributes' && m.attributeName === 'style') {
                        const element = m.target as HTMLDivElement;
                        if (element && element.style && element.style.left) {
                            const left = element.style.left.endsWith('px') ? parseInt(element.style.left.substr(0, element.style.left.length - 2), 10) : -1;
                            if (left > 10) {
                                this.styleObserver!.disconnect();
                                element.style.left = `${left + 3}px`;
                                this.styleObserver!.observe(element, { attributes: true, attributeFilter: ['style']});
                            }
                        }
                    }
                });
            }
        } catch {
            // Skip doing anything if it fails
        }
    }

    private isElementVisible(element: HTMLElement | undefined): boolean {
        if (element && element.clientHeight > 0) {
            // See if it has the visibility set on the style
            const visibility = element.style.visibility;
            return visibility ? visibility !== 'hidden' : true;
        }
        return false;
    }

    private setAriaReadOnly(editor: monacoEditor.editor.IStandaloneCodeEditor) {
        const editorDomNode = editor.getDomNode();
        if (editorDomNode) {
            const textArea = editorDomNode.getElementsByTagName('textarea');
            if (textArea && textArea.length > 0) {
                const item = textArea.item(0);
                if (item) {
                    item.setAttribute('aria-readonly', 'true');
                }
            }
        }
    }

    private windowResized = () => {
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
        }
        this.resizeTimer = window.setTimeout(this.updateEditorSize.bind(this), 0);
    }

    private startUpdateWidgetPosition = () => {
        this.throttledUpdateWidgetPosition();
    }

    private updateBackgroundStyle = () => {
        if (this.state.editor && this.containerRef.current) {
            let nodes = this.containerRef.current.getElementsByClassName('monaco-editor-background');
            if (nodes && nodes.length > 0) {
                const backgroundNode = nodes[0] as HTMLDivElement;
                if (backgroundNode && backgroundNode.style) {
                    backgroundNode.style.backgroundColor = 'transparent';
                }
            }
            nodes = this.containerRef.current.getElementsByClassName('monaco-editor');
            if (nodes && nodes.length > 0) {
                const editorNode = nodes[0] as HTMLDivElement;
                if (editorNode && editorNode.style) {
                    editorNode.style.backgroundColor = 'transparent';
                }
            }
        }
    }

    private updateWidgetPosition(width?: number) {
        if (this.state.editor && this.widgetParent) {
            // Position should be at the top of the editor.
            const editorDomNode = this.state.editor.getDomNode();
            if (editorDomNode) {
                const rect = editorDomNode.getBoundingClientRect();
                if (rect &&
                    (rect.left !== this.lastOffsetLeft || rect.top !== this.lastOffsetTop)) {
                    this.lastOffsetLeft = rect.left;
                    this.lastOffsetTop = rect.top;

                    this.widgetParent.setAttribute(
                        'style',
                        `position: absolute; left: ${rect.left}px; top: ${rect.top}px; width:${width ? width : rect.width}px`);
                }
            }
        }
    }

    private updateEditorSize() {
        if (this.measureWidthRef.current &&
            this.containerRef.current &&
            this.containerRef.current.parentElement &&
            this.containerRef.current.parentElement.parentElement &&
            this.state.editor &&
            this.state.model) {
            const editorDomNode = this.state.editor.getDomNode();
            if (!editorDomNode) { return; }
            const grandParent = this.containerRef.current.parentElement.parentElement;
            const container = editorDomNode.getElementsByClassName('view-lines')[0] as HTMLElement;
            const currLineCount = Math.max(container.childElementCount, this.state.model.getLineCount());
            const lineHeightPx = container.firstChild && (container.firstChild as HTMLElement).style.height ?
                (container.firstChild as HTMLElement).style.height
                : `${LINE_HEIGHT}px`;
            const lineHeight = lineHeightPx && lineHeightPx.endsWith('px') ? parseInt(lineHeightPx.substr(0, lineHeightPx.length - 2), 10) : LINE_HEIGHT;
            const height = (currLineCount * lineHeight) + 3; // Fudge factor
            const width = this.measureWidthRef.current.clientWidth - grandParent.offsetLeft - 15; // Leave room for the scroll bar in regular cell table

            const layoutInfo = this.state.editor.getLayoutInfo();
            if (layoutInfo.height !== height || layoutInfo.width !== width || currLineCount !== this.state.visibleLineCount) {
                if (this.state.visibleLineCount !== currLineCount) {
                    this.props.lineCountChanged(currLineCount);
                }
                this.setState({visibleLineCount: currLineCount});
                this.state.editor.layout({width, height});

                // Also need to update our widget positions
                this.throttledUpdateWidgetPosition(width);
            }
        }
    }

    private onHoverLeave = () => {
        // If the hover is active, make sure to hide it.
        if (this.state.editor && this.widgetParent) {
            this.enteredHover = false;
            // tslint:disable-next-line: no-any
            const hover = this.state.editor.getContribution('editor.contrib.hover') as any;
            if (hover._hideWidgets) {
                hover._hideWidgets();
            }
        }
    }

    private onHoverEnter = () => {
        if (this.state.editor && this.widgetParent) {
            // If we enter the hover, indicate it so we don't leave
            this.enteredHover = true;
        }
    }

    private outermostParentLeave = () => {
        // Have to bounce this because the leave for the cell is the
        // enter for the hover
        if (this.leaveTimer) {
            clearTimeout(this.leaveTimer);
        }
        this.leaveTimer = window.setTimeout(this.outermostParentLeaveBounced, 0);
    }

    private outermostParentLeaveBounced = () => {
        if (this.state.editor && !this.enteredHover) {
            // If we haven't already entered hover, then act like it shuts down
            this.onHoverLeave();
        }
    }

    private updateMargin(editor: monacoEditor.editor.IStandaloneCodeEditor) {
        const editorNode = editor.getDomNode();
        if (editorNode) {
            try {
                const elements = editorNode.getElementsByClassName('margin-view-overlays');
                if (elements && elements.length) {
                    const margin = elements[0] as HTMLDivElement;

                    // Create  special class name based on the line number property
                    const specialExtra = `margin-view-overlays-border-${this.props.options.lineNumbers}`;
                    if (margin.className && !margin.className.includes(specialExtra)) {
                        margin.className = `margin-view-overlays ${specialExtra}`;
                    }

                    // Watch the scrollable element (it's where the code lines up)
                    const scrollable = editorNode.getElementsByClassName('monaco-scrollable-element');
                    if (!this.watchingMargin && scrollable && scrollable.length && this.styleObserver) {
                        const watching = scrollable[0] as HTMLDivElement;
                        this.watchingMargin = true;
                        this.styleObserver.observe(watching, { attributes: true, attributeFilter: ['style'] });
                    }
                }
            } catch {
                // Ignore if we can't get modify the margin class
            }
        }
    }

    private updateWidgetParent(editor: monacoEditor.editor.IStandaloneCodeEditor) {
        // Reparent the hover widgets. They cannot be inside anything that has overflow hidden or scrolling or they won't show
        // up overtop of anything. Warning, this is a big hack. If the class name changes or the logic
        // for figuring out the position of hover widgets changes, this won't work anymore.
        // appendChild on a DOM node moves it, but doesn't clone it.
        // https://developer.mozilla.org/en-US/docs/Web/API/Node/appendChild
        const editorNode = editor.getDomNode();
        if (editorNode) {
            try {
                const elements = editorNode.getElementsByClassName('overflowingContentWidgets');
                if (elements && elements.length) {
                    const contentWidgets = elements[0] as HTMLDivElement;
                    if (contentWidgets) {
                        // Go up to the document.
                        const document = contentWidgets.getRootNode() as HTMLDocument;

                        // His first child with the id 'root' should be where we want to parent our overflow widgets
                        if (document && document.getElementById) {
                            const root = document.getElementById('root');
                            if (root) {
                                // We need to create a dummy 'monaco-editor' div so that the content widgets get the same styles.
                                this.widgetParent = document.createElement('div', {});
                                this.widgetParent.setAttribute('class', `${editorNode.className} monaco-editor-pretend-parent`);

                                root.appendChild(this.widgetParent);
                                this.widgetParent.appendChild(contentWidgets);

                                // Listen for changes so we can update the position dynamically
                                editorNode.addEventListener('mouseenter', this.startUpdateWidgetPosition);

                                // We also need to trick the editor into thinking mousing over the hover does not
                                // mean the mouse has left the editor.
                                // tslint:disable-next-line: no-any
                                const hover = editor.getContribution('editor.contrib.hover') as any;
                                if (hover._toUnhook && hover._toUnhook.length === 8 && hover.contentWidget) {
                                    // This should mean our 5th element is the event handler for mouse leave. Remove it.
                                    const array = hover._toUnhook as IDisposable[];
                                    array[5].dispose();
                                    array.splice(5, 1);

                                    // Instead listen to mouse leave for our hover widget
                                    const hoverWidget = this.widgetParent.getElementsByClassName('monaco-editor-hover')[0] as HTMLElement;
                                    if (hoverWidget) {
                                        hoverWidget.addEventListener('mouseenter', this.onHoverEnter);
                                        hoverWidget.addEventListener('mouseleave', this.onHoverLeave);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // If something fails, then the hover will just work inside the main frame
                if (!this.props.testMode) {
                    window.console.warn(`Error moving editor widgets: ${e}`);
                }

                // Make sure we don't try moving it around.
                this.widgetParent = undefined;
            }
        }
    }
}
