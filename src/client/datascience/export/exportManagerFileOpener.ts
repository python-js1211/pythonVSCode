import { inject, injectable } from 'inversify';
import { Uri } from 'vscode';
import { getLocString } from '../../../datascience-ui/react-common/locReactSide';
import { IApplicationShell, IDocumentManager } from '../../common/application/types';
import { PYTHON_LANGUAGE } from '../../common/constants';
import { traceError } from '../../common/logger';
import { IFileSystem } from '../../common/platform/types';
import { IBrowserService } from '../../common/types';
import { DataScience } from '../../common/utils/localize';
import { sendTelemetryEvent } from '../../telemetry';
import { Telemetry } from '../constants';
import { INotebookModel } from '../types';
import { ExportManagerDependencyChecker } from './exportManagerDependencyChecker';
import { ExportFormat, IExportManager } from './types';

@injectable()
export class ExportManagerFileOpener implements IExportManager {
    constructor(
        @inject(ExportManagerDependencyChecker) private readonly manager: IExportManager,
        @inject(IDocumentManager) protected readonly documentManager: IDocumentManager,
        @inject(IFileSystem) private readonly fileSystem: IFileSystem,
        @inject(IApplicationShell) private readonly applicationShell: IApplicationShell,
        @inject(IBrowserService) private readonly browserService: IBrowserService
    ) {}

    public async export(format: ExportFormat, model: INotebookModel): Promise<Uri | undefined> {
        let uri: Uri | undefined;
        try {
            uri = await this.manager.export(format, model);
        } catch (e) {
            let msg = e;
            traceError('Export failed', e);
            sendTelemetryEvent(Telemetry.ExportNotebookAsFailed, undefined, { format: format });

            if (format === ExportFormat.pdf) {
                msg = DataScience.exportToPDFDependencyMessage();
            }

            this.showExportFailed(msg);
            return;
        }

        if (!uri) {
            // if export didn't fail but no uri returned then user cancelled operation
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, { format: format, cancelled: true });
            return;
        }

        if (format === ExportFormat.python) {
            await this.openPythonFile(uri);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: true
            });
        } else {
            const opened = await this.askOpenFile(uri);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: opened
            });
        }
    }

    private async openPythonFile(uri: Uri): Promise<void> {
        const contents = await this.fileSystem.readFile(uri.fsPath);
        await this.fileSystem.deleteFile(uri.fsPath);
        const doc = await this.documentManager.openTextDocument({ language: PYTHON_LANGUAGE, content: contents });
        await this.documentManager.showTextDocument(doc);
    }

    private showExportFailed(msg: string) {
        this.applicationShell
            .showErrorMessage(
                // tslint:disable-next-line: messages-must-be-localized
                `${getLocString('DataScience.failedExportMessage', 'Export failed.')} ${msg}`
            )
            .then();
    }

    private async askOpenFile(uri: Uri): Promise<boolean> {
        const yes = getLocString('DataScience.openExportFileYes', 'Yes');
        const no = getLocString('DataScience.openExportFileNo', 'No');
        const items = [yes, no];

        const selected = await this.applicationShell
            .showInformationMessage(
                getLocString('DataScience.openExportedFileMessage', 'Would you like to open the exported file?'),
                ...items
            )
            .then((item) => item);

        if (selected === yes) {
            this.browserService.launch(uri.toString());
            return true;
        }
        return false;
    }
}
