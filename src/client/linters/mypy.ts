import { CancellationToken, TextDocument } from 'vscode';
import '../common/extensions';
import { escapeRegExp } from 'lodash';
import { Product } from '../common/types';
import { IServiceContainer } from '../ioc/types';
import { BaseLinter } from './baseLinter';
import { ILintMessage } from './types';

export function getRegex(filepath: string): string {
    return `${escapeRegExp(filepath)}:(?<line>\\d+)(:(?<column>\\d+))?: (?<type>\\w+): (?<message>.*)\\r?(\\n|$)`;
}
const COLUMN_OFF_SET = 1;

export class MyPy extends BaseLinter {
    constructor(serviceContainer: IServiceContainer) {
        super(Product.mypy, serviceContainer, COLUMN_OFF_SET);
    }

    protected async runLinter(document: TextDocument, cancellation: CancellationToken): Promise<ILintMessage[]> {
        const relativeFilePath = document.uri.fsPath.slice(this.getWorkspaceRootPath(document).length + 1);
        const regex = getRegex(relativeFilePath);
        const messages = await this.run([document.uri.fsPath], document, cancellation, regex);
        messages.forEach((msg) => {
            msg.severity = this.parseMessagesSeverity(msg.type, this.pythonSettings.linting.mypyCategorySeverity);
            msg.code = msg.type;
        });
        return messages;
    }
}
