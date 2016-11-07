import * as vscode from 'vscode';
import * as settings from './configSettings';
import { createDeferred, isNotInstalledError } from './helpers';
import { execPythonFile } from './utils';

export enum Product {
    pytest,
    nosetest,
    pylint,
    flake8,
    pep8,
    pylama,
    prospector,
    pydocstyle,
    yapf,
    autopep8,
    mypy,
    unittest
}

const ProductInstallScripts = new Map<Product, string[]>();
ProductInstallScripts.set(Product.autopep8, ['pip', 'install', 'autopep8']);
ProductInstallScripts.set(Product.flake8, ['pip', 'install', 'flake8']);
ProductInstallScripts.set(Product.mypy, ['pip', 'install', 'mypy-lang']);
ProductInstallScripts.set(Product.nosetest, ['pip', 'install', 'nose']);
ProductInstallScripts.set(Product.pep8, ['pip', 'install', 'pep8']);
ProductInstallScripts.set(Product.pylama, ['pip', 'install', 'pylama']);
ProductInstallScripts.set(Product.prospector, ['pip', 'install', 'prospector']);
ProductInstallScripts.set(Product.pydocstyle, ['pip', 'install', 'pydocstyle']);
ProductInstallScripts.set(Product.pylint, ['pip', 'install', 'pylint']);
ProductInstallScripts.set(Product.pytest, ['pip', 'install', '-U', 'pytest']);
ProductInstallScripts.set(Product.yapf, ['pip', 'install', 'yapf']);


const Linters: Product[] = [Product.flake8, Product.pep8, Product.pylama, Product.prospector, Product.pylint, Product.mypy, Product.pydocstyle];
const Formatters: Product[] = [Product.autopep8, Product.yapf];
const TestFrameworks: Product[] = [Product.pytest, Product.nosetest, Product.unittest];

const ProductNames = new Map<Product, string>();
ProductNames.set(Product.autopep8, 'autopep8');
ProductNames.set(Product.flake8, 'flake8');
ProductNames.set(Product.mypy, 'mypy');
ProductNames.set(Product.nosetest, 'nosetest');
ProductNames.set(Product.pep8, 'pep8');
ProductNames.set(Product.pylama, 'pylama');
ProductNames.set(Product.prospector, 'prospector');
ProductNames.set(Product.pydocstyle, 'pydocstyle');
ProductNames.set(Product.pylint, 'pylint');
ProductNames.set(Product.pytest, 'py.test');
ProductNames.set(Product.yapf, 'yapf');

const SettingToDisableProduct = new Map<Product, string>();
SettingToDisableProduct.set(Product.autopep8, '');
SettingToDisableProduct.set(Product.flake8, 'linting.flake8Enabled');
SettingToDisableProduct.set(Product.mypy, 'linting.mypyEnabled');
SettingToDisableProduct.set(Product.nosetest, 'unitTest.nosetestsEnabled');
SettingToDisableProduct.set(Product.pep8, 'linting.pep8Enabled');
SettingToDisableProduct.set(Product.pylama, 'linting.pylamaEnabled');
SettingToDisableProduct.set(Product.prospector, 'linting.prospectorEnabled');
SettingToDisableProduct.set(Product.pydocstyle, 'linting.pydocstyleEnabled');
SettingToDisableProduct.set(Product.pylint, 'linting.pylintEnabled');
SettingToDisableProduct.set(Product.pytest, 'unitTest.pyTestEnabled');
SettingToDisableProduct.set(Product.yapf, 'yapf');

export class Installer {
    private static terminal: vscode.Terminal;
    private disposables: vscode.Disposable[] = [];
    constructor(private outputChannel: vscode.OutputChannel = null) {
        this.disposables.push(vscode.window.onDidCloseTerminal(term => {
            if (term === Installer.terminal) {
                Installer.terminal = null;
            }
        }));
    }
    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }

    promptToInstall(product: Product): Thenable<any> {
        let productType = Linters.indexOf(product) >= 0 ? 'Linter' : (Formatters.indexOf(product) >= 0 ? 'Formatter' : 'Test Framework');
        const productName = ProductNames.get(product);

        const installOption = 'Install ' + productName;
        const disableOption = 'Disable this ' + productType;
        const alternateFormatter = product === Product.autopep8 ? 'yapf' : 'autopep8';
        const useOtherFormatter = `Use '${alternateFormatter}' formatter`;
        const options = [];
        if (Formatters.indexOf(product) === -1) {
            options.push(...[installOption, disableOption]);
        }
        else {
            options.push(...[installOption, useOtherFormatter]);
        }
        return vscode.window.showErrorMessage(`${productType} ${productName} is not installed`, ...options).then(item => {
            switch (item) {
                case installOption: {
                    return this.installProduct(product);
                }
                case disableOption: {
                    if (Linters.indexOf(product) >= 0) {
                        return disableLinter(product);
                    }
                    else {
                        const pythonConfig = vscode.workspace.getConfiguration('python');
                        const settingToDisable = SettingToDisableProduct.get(product);
                        return pythonConfig.update(settingToDisable, false);
                    }
                }
                case useOtherFormatter: {
                    const pythonConfig = vscode.workspace.getConfiguration('python');
                    return pythonConfig.update('formatting.provider', alternateFormatter);
                }
                case 'Help': {
                    return Promise.resolve();
                }
            }
        });
    }

    installProduct(product: Product): Promise<any> {
        if (!this.outputChannel && !Installer.terminal) {
            Installer.terminal = vscode.window.createTerminal('Python Installer');
        }

        let installArgs = ProductInstallScripts.get(product);
        const pythonPath = settings.PythonSettings.getInstance().pythonPath;

        if (this.outputChannel) {
            // Errors are just displayed to the user
            this.outputChannel.show();
            return execPythonFile(pythonPath, ['-m', ...installArgs], vscode.workspace.rootPath, true, (data) => {
                this.outputChannel.append(data);
            });
        }
        else {
            let installScript = installArgs.join(' ');
            if (pythonPath.indexOf(' ') >= 0) {
                installScript = `"${pythonPath}" -m ${installScript}`;
            }
            else {
                installScript = `${pythonPath} -m ${installScript}`;
            }

            Installer.terminal.sendText(installScript);
            Installer.terminal.show(false);
            // Unfortunately we won't know when the command has completed
            return Promise.resolve();
        }
    }

    isProductInstalled(product: Product): Promise<boolean> {
        return isProductInstalled(product);
    }
}

export function disableLinter(product: Product) {
    const pythonConfig = vscode.workspace.getConfiguration('python');
    const settingToDisable = SettingToDisableProduct.get(product);
    pythonConfig.update(settingToDisable, false);
}

function isTestFrameworkInstalled(product: Product): Promise<boolean> {
    const fileToRun = product === Product.pytest ? 'py.test' : 'nosetests';
    const def = createDeferred<boolean>();
    execPythonFile(fileToRun, ['--version'], vscode.workspace.rootPath, false)
        .then(() => {
            def.resolve(true);
        }).catch(reason => {
            if (isNotInstalledError(reason)) {
                def.resolve(false);
            }
            else {
                def.resolve(true);
            }
        });
    return def.promise;
}
function isProductInstalled(product: Product): Promise<boolean> {
    switch (product) {
        case Product.pytest: {
            return isTestFrameworkInstalled(product);
        }
        case Product.nosetest: {
            return isTestFrameworkInstalled(product);
        }
    }
    throw new Error('Not supported');
}