
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.


// Place this right on top
import { initialize, PYTHON_PATH } from './initialize';
// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { PythonImportSortProvider } from '../client/providers/importSortProvider';
import * as path from 'path';
import * as settings from '../client/common/configSettings';
import * as fs from 'fs';
import { EOL } from 'os';

const pythonSettings = settings.PythonSettings.getInstance();
const fileToFormatWithoutConfig = path.join(__dirname, '..', '..', 'src', 'test', 'pythonFiles', 'sorting', 'noconfig', 'before.py');
const originalFileToFormatWithoutConfig = path.join(__dirname, '..', '..', 'src', 'test', 'pythonFiles', 'sorting', 'noconfig', 'original.py');
const fileToFormatWithConfig = path.join(__dirname, '..', '..', 'src', 'test', 'pythonFiles', 'sorting', 'withconfig', 'before.py');
const originalFileToFormatWithConfig = path.join(__dirname, '..', '..', 'src', 'test', 'pythonFiles', 'sorting', 'withconfig', 'original.py');
const extensionDir = path.join(__dirname, '..', '..');

suite('Formatting', () => {
    suiteSetup(done => {
        initialize().then(() => {
            pythonSettings.pythonPath = PYTHON_PATH;
        }).then(done, done);
    });

    suiteTeardown(() => {
        fs.writeFileSync(fileToFormatWithConfig, fs.readFileSync(originalFileToFormatWithConfig));
        fs.writeFileSync(fileToFormatWithoutConfig, fs.readFileSync(originalFileToFormatWithoutConfig));
        if (vscode.window.activeTextEditor) {
            return vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
    });
    setup(() => {
        pythonSettings.sortImports.args = [];
        fs.writeFileSync(fileToFormatWithConfig, fs.readFileSync(originalFileToFormatWithConfig));
        fs.writeFileSync(fileToFormatWithoutConfig, fs.readFileSync(originalFileToFormatWithoutConfig));
    });
    teardown(() => {
        if (vscode.window.activeTextEditor) {
            return vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
    });

    test('Without Config', done => {
        let textEditor: vscode.TextEditor;
        let textDocument: vscode.TextDocument;
        return vscode.workspace.openTextDocument(fileToFormatWithoutConfig).then(document => {
            textDocument = document;
            return vscode.window.showTextDocument(textDocument);
        }).then(editor => {
            textEditor = editor;
            const sorter = new PythonImportSortProvider();
            return sorter.sortImports(extensionDir, textDocument);
        }).then(edits => {            
            assert.equal(edits.filter(value => value.newText === EOL && value.range.isEqual(new vscode.Range(2, 0, 2, 0))).length, 1, 'EOL not found');
            assert.equal(edits.filter(value => value.newText === '' && value.range.isEqual(new vscode.Range(3, 0, 4, 0))).length, 1, '"" not found');
            assert.equal(edits.filter(value => value.newText === `from rope.base import libutils${EOL}from rope.refactor.extract import ExtractMethod, ExtractVariable${EOL}from rope.refactor.rename import Rename${EOL}` && value.range.isEqual(new vscode.Range(6, 0, 6, 0))).length, 1, 'Text not found');
            assert.equal(edits.filter(value => value.newText === '' && value.range.isEqual(new vscode.Range(13, 0, 18, 0))).length, 1, '"" not found');
        }).then(done, done);
    });

    test('With Config', done => {
        let textEditor: vscode.TextEditor;
        let textDocument: vscode.TextDocument;
        return vscode.workspace.openTextDocument(fileToFormatWithConfig).then(document => {
            textDocument = document;
            return vscode.window.showTextDocument(textDocument);
        }).then(editor => {
            textEditor = editor;
            const sorter = new PythonImportSortProvider();
            return sorter.sortImports(extensionDir, textDocument);
        }).then(edits => {
            const newValue = `from third_party import lib2${EOL}from third_party import lib3${EOL}from third_party import lib4${EOL}from third_party import lib5${EOL}from third_party import lib6${EOL}from third_party import lib7${EOL}from third_party import lib8${EOL}from third_party import lib9${EOL}`;
            assert.equal(edits.filter(value => value.newText === newValue && value.range.isEqual(new vscode.Range(0, 0, 3, 0))).length, 1, 'New Text not found');
        }).then(done, done);
    });

    test('With Changes and Config in Args', done => {
        let textEditor: vscode.TextEditor;
        let textDocument: vscode.TextDocument;
        pythonSettings.sortImports.args = ['-sp', path.join(__dirname, '..', '..', 'src', 'test', 'pythonFiles', 'sorting', 'withconfig')];
        return vscode.workspace.openTextDocument(fileToFormatWithConfig).then(document => {
            textDocument = document;
            return vscode.window.showTextDocument(textDocument);
        }).then(editor => {
            textEditor = editor;
            return editor.edit(editor => {
                editor.insert(new vscode.Position(0, 0), 'from third_party import lib0' + EOL);
            });
        }).then(() => {
            const sorter = new PythonImportSortProvider();
            return sorter.sortImports(extensionDir, textDocument);
        }).then(edits => {
            const newValue = `from third_party import lib2${EOL}from third_party import lib3${EOL}from third_party import lib4${EOL}from third_party import lib5${EOL}from third_party import lib6${EOL}from third_party import lib7${EOL}from third_party import lib8${EOL}from third_party import lib9${EOL}`;
            assert.equal(edits.filter(value => value.newText === newValue && value.range.isEqual(new vscode.Range(1, 0, 4, 0))).length, 1, 'New Text not found');
        }).then(done, done);
    });
});