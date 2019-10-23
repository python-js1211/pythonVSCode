// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../common/extensions';

import { injectable, unmanaged } from 'inversify';
import { ConfigurationChangeEvent, ViewColumn, WorkspaceConfiguration } from 'vscode';

import { IWebPanel, IWebPanelMessageListener, IWebPanelProvider, IWorkspaceService } from '../common/application/types';
import { traceInfo } from '../common/logger';
import { IConfigurationService, IDisposable } from '../common/types';
import { createDeferred, Deferred } from '../common/utils/async';
import { noop } from '../common/utils/misc';
import { StopWatch } from '../common/utils/stopWatch';
import { captureTelemetry, sendTelemetryEvent } from '../telemetry';
import { DefaultTheme, Telemetry } from './constants';
import { CssMessages, IGetCssRequest, IGetMonacoThemeRequest, SharedMessages } from './messages';
import { ICodeCssGenerator, IDataScienceExtraSettings, IThemeFinder } from './types';

@injectable() // For some reason this is necessary to get the class hierarchy to work.
export class WebViewHost<IMapping> implements IDisposable {
    protected viewState: { visible: boolean; active: boolean } = { visible: false, active: false };
    private disposed: boolean = false;
    private webPanel: IWebPanel | undefined;
    private webPanelInit: Deferred<void> | undefined;
    private messageListener: IWebPanelMessageListener;
    private themeChangeHandler: IDisposable | undefined;
    private settingsChangeHandler: IDisposable | undefined;
    private themeIsDarkPromise: Deferred<boolean> | undefined;
    private startupStopwatch = new StopWatch();

    constructor(
        @unmanaged() protected configService: IConfigurationService,
        @unmanaged() private provider: IWebPanelProvider,
        @unmanaged() private cssGenerator: ICodeCssGenerator,
        @unmanaged() protected themeFinder: IThemeFinder,
        @unmanaged() protected workspaceService: IWorkspaceService,
        // tslint:disable-next-line:no-any
        @unmanaged() messageListenerCtor: (callback: (message: string, payload: any) => void, viewChanged: (panel: IWebPanel) => void, disposed: () => void) => IWebPanelMessageListener,
        @unmanaged() private mainScriptPath: string,
        @unmanaged() private title: string,
        @unmanaged() private viewColumn: ViewColumn
    ) {
        // Create our message listener for our web panel.
        this.messageListener = messageListenerCtor(this.onMessage.bind(this), this.webPanelViewStateChanged.bind(this), this.dispose.bind(this));

        // Listen for settings changes from vscode.
        this.themeChangeHandler = this.workspaceService.onDidChangeConfiguration(this.onPossibleSettingsChange, this);

        // Listen for settings changes
        this.settingsChangeHandler = this.configService.getSettings().onDidChange(this.onDataScienceSettingsChanged.bind(this));

        // Do the same thing a reload would do
        this.reload();
    }

    public async show(preserveFocus: boolean): Promise<void> {
        if (!this.isDisposed) {
            // Then show our web panel.
            if (this.webPanel) {
                await this.webPanel.show(preserveFocus);
            }
        }
    }

    public dispose() {
        if (!this.isDisposed) {
            this.disposed = true;
            if (this.webPanel) {
                this.webPanel.close();
                this.webPanel = undefined;
            }
            if (this.themeChangeHandler) {
                this.themeChangeHandler.dispose();
                this.themeChangeHandler = undefined;
            }
            if (this.settingsChangeHandler) {
                this.settingsChangeHandler.dispose();
                this.settingsChangeHandler = undefined;
            }
        }
    }

    public setTitle(newTitle: string) {
        if (!this.isDisposed && this.webPanel) {
            this.webPanel.title = newTitle;
        }
    }

    public setTheme(isDark: boolean) {
        if (this.themeIsDarkPromise && !this.themeIsDarkPromise.resolved) {
            this.themeIsDarkPromise.resolve(isDark);
        } else {
            this.themeIsDarkPromise = createDeferred<boolean>();
            this.themeIsDarkPromise.resolve(isDark);
        }
    }

    protected reload() {
        // Make not disposed anymore
        this.disposed = false;

        // Setup our init promise for the web panel. We use this to make sure we're in sync with our
        // react control.
        this.webPanelInit = createDeferred();

        // Setup a promise that will wait until the webview passes back
        // a message telling us what them is in use
        this.themeIsDarkPromise = createDeferred<boolean>();

        // Load our actual web panel
        this.loadWebPanel();
    }

    protected get isDisposed(): boolean {
        return this.disposed;
    }

    //tslint:disable-next-line:no-any
    protected onMessage(message: string, payload: any) {
        switch (message) {
            case SharedMessages.Started:
                this.webPanelRendered();
                break;

            case CssMessages.GetCssRequest:
                this.handleCssRequest(payload as IGetCssRequest).ignoreErrors();
                break;

            case CssMessages.GetMonacoThemeRequest:
                this.handleMonacoThemeRequest(payload as IGetMonacoThemeRequest).ignoreErrors();
                break;

            default:
                break;
        }
    }

    protected postMessage<M extends IMapping, T extends keyof M>(type: T, payload?: M[T]): Promise<void> {
        // Then send it the message
        return this.postMessageInternal(type.toString(), payload);
    }

    protected shareMessage<M extends IMapping, T extends keyof M>(type: T, payload?: M[T]) {
        // Send our remote message.
        this.messageListener.onMessage(type.toString(), payload);
    }

    protected onViewStateChanged(_visible: boolean, _active: boolean) {
        noop();
    }

    // tslint:disable-next-line:no-any
    protected async postMessageInternal(type: string, payload?: any): Promise<void> {
        if (this.webPanel && this.webPanelInit) {
            // Make sure the webpanel is up before we send it anything.
            await this.webPanelInit.promise;

            // Then send it the message
            this.webPanel.postMessage({ type: type.toString(), payload: payload });
        }
    }

    protected generateDataScienceExtraSettings(): IDataScienceExtraSettings {
        const editor = this.workspaceService.getConfiguration('editor');
        const workbench = this.workspaceService.getConfiguration('workbench');
        const theme = !workbench ? DefaultTheme : workbench.get<string>('colorTheme', DefaultTheme);
        return {
            ...this.configService.getSettings().datascience,
            extraSettings: {
                editor: {
                    cursor: this.getValue(editor, 'cursorStyle', 'line'),
                    cursorBlink: this.getValue(editor, 'cursorBlinking', 'blink'),
                    autoClosingBrackets: this.getValue(editor, 'autoClosingBrackets', 'languageDefined'),
                    autoClosingQuotes: this.getValue(editor, 'autoClosingQuotes', 'languageDefined'),
                    autoSurround: this.getValue(editor, 'autoSurround', 'languageDefined'),
                    autoIndent: this.getValue(editor, 'autoIndent', false),
                    fontLigatures: this.getValue(editor, 'fontLigatures', false)
                },
                fontSize: this.getValue(editor, 'fontSize', 14),
                fontFamily: this.getValue(editor, 'fontFamily', 'Consolas, \'Courier New\', monospace'),
                theme: theme
            },
            intellisenseOptions: {
                quickSuggestions: {
                    other: this.getValue(editor, 'quickSuggestions.other', true),
                    comments: this.getValue(editor, 'quickSuggestions.comments', false),
                    strings: this.getValue(editor, 'quickSuggestions.strings', false)
                },
                acceptSuggestionOnEnter: this.getValue(editor, 'acceptSuggestionOnEnter', 'on'),
                quickSuggestionsDelay: this.getValue(editor, 'quickSuggestionsDelay', 10),
                suggestOnTriggerCharacters: this.getValue(editor, 'suggestOnTriggerCharacters', true),
                tabCompletion: this.getValue(editor, 'tabCompletion', 'on'),
                suggestLocalityBonus: this.getValue(editor, 'suggest.localityBonus', true),
                suggestSelection: this.getValue(editor, 'suggestSelection', 'recentlyUsed'),
                wordBasedSuggestions: this.getValue(editor, 'wordBasedSuggestions', true),
                parameterHintsEnabled: this.getValue(editor, 'parameterHints.enabled', true)
            }
        };
    }

    protected isDark(): Promise<boolean> {
        return this.themeIsDarkPromise!.promise;
    }

    private getValue<T>(workspaceConfig: WorkspaceConfiguration, section: string, defaultValue: T): T {
        if (workspaceConfig) {
            return workspaceConfig.get(section, defaultValue);
        }
        return defaultValue;
    }

    private webPanelViewStateChanged = (webPanel: IWebPanel) => {
        const isVisible = webPanel.isVisible();
        const isActive = webPanel.isActive();
        this.onViewStateChanged(isVisible, isActive);
        this.viewState.visible = isVisible;
        this.viewState.active = isActive;
    }

    @captureTelemetry(Telemetry.WebviewStyleUpdate)
    private async handleCssRequest(request: IGetCssRequest): Promise<void> {
        this.setTheme(request.isDark);
        const settings = this.generateDataScienceExtraSettings();
        const isDark = await this.themeFinder.isThemeDark(settings.extraSettings.theme);
        const css = await this.cssGenerator.generateThemeCss(request.isDark, settings.extraSettings.theme);
        return this.postMessageInternal(CssMessages.GetCssResponse, { css, theme: settings.extraSettings.theme, knownDark: isDark });
    }

    @captureTelemetry(Telemetry.WebviewMonacoStyleUpdate)
    private async handleMonacoThemeRequest(request: IGetMonacoThemeRequest): Promise<void> {
        this.setTheme(request.isDark);
        const settings = this.generateDataScienceExtraSettings();
        const monacoTheme = await this.cssGenerator.generateMonacoTheme(request.isDark, settings.extraSettings.theme);
        return this.postMessageInternal(CssMessages.GetMonacoThemeResponse, { theme: monacoTheme });
    }

    // tslint:disable-next-line:no-any
    private webPanelRendered() {
        if (this.webPanelInit && !this.webPanelInit.resolved) {
            // Send telemetry for startup
            sendTelemetryEvent(Telemetry.WebviewStartup, this.startupStopwatch.elapsedTime, { type: this.title });

            // Resolve our started promise. This means the webpanel is ready to go.
            this.webPanelInit.resolve();
        }
    }

    // Post a message to our webpanel and update our new datascience settings
    private onPossibleSettingsChange = (event: ConfigurationChangeEvent) => {
        if (event.affectsConfiguration('workbench.colorTheme') ||
            event.affectsConfiguration('editor.fontSize') ||
            event.affectsConfiguration('editor.fontFamily') ||
            event.affectsConfiguration('editor.cursorStyle') ||
            event.affectsConfiguration('editor.cursorBlinking') ||
            event.affectsConfiguration('editor.autoClosingBrackets') ||
            event.affectsConfiguration('editor.autoClosingQuotes') ||
            event.affectsConfiguration('editor.autoSurround') ||
            event.affectsConfiguration('editor.autoIndent') ||
            event.affectsConfiguration('editor.fontLigatures') ||
            event.affectsConfiguration('files.autoSave') ||
            event.affectsConfiguration('files.autoSaveDelay') ||
            event.affectsConfiguration('python.dataScience.enableGather')) {
            // See if the theme changed
            const newSettings = this.generateDataScienceExtraSettings();
            if (newSettings) {
                const dsSettings = JSON.stringify(newSettings);
                this.postMessageInternal(SharedMessages.UpdateSettings, dsSettings).ignoreErrors();
            }
        }
    }

    // Post a message to our webpanel and update our new datascience settings
    private onDataScienceSettingsChanged = () => {
        // Stringify our settings to send over to the panel
        const dsSettings = JSON.stringify(this.generateDataScienceExtraSettings());
        this.postMessageInternal(SharedMessages.UpdateSettings, dsSettings).ignoreErrors();
    }

    private loadWebPanel() {
        traceInfo(`Loading web panel. Panel is ${this.webPanel ? 'set' : 'notset'}`);

        // Create our web panel (it's the UI that shows up for the history)
        if (this.webPanel === undefined) {

            // Get our settings to pass along to the react control
            const settings = this.generateDataScienceExtraSettings();

            traceInfo('Loading web view...');
            // Use this script to create our web view panel. It should contain all of the necessary
            // script to communicate with this class.
            this.webPanel = this.provider.create(this.viewColumn, this.messageListener, this.title, this.mainScriptPath, '', settings);

            traceInfo('Web view created.');
        }
    }
}
