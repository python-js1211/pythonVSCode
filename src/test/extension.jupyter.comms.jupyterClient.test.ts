//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//
// Place this right on top
import { initialize } from './initialize';
// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { JupyterClientAdapter } from '../client/jupyter/jupyter_client/main';
import * as mocks from './mockClasses';
import { KernelRestartedError, KernelShutdownError } from '../client/jupyter/common/errors';

suiteSetup(done => {
    initialize().then(() => {
        done();
    });
});

// Defines a Mocha test suite to group tests of similar kind together
suite('JupyterClient', () => {
    test('Ping (Process and Socket)', done => {
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start({ 'PYTHON_DONJAYAMANNE_TEST': '1' }).then(() => {
            done();
        }).catch(reason => {
            assert.fail(reason, undefined, 'Starting Jupyter failed', '');
            done();
        });
    });
    test('Start Jupyter Adapter (Socket Client)', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            done();
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to start jupyter adapter', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('List Kernels (with start)', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            assert.notEqual(Object.keys(kernelSpecs).length, 0, 'kernelSpecs not found');
            done();
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('List Kernels (without starting)', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.getAllKernelSpecs().then(kernelSpecs => {
            assert.notEqual(Object.keys(kernelSpecs).length, 0, 'kernelSpecs not found');
            done();
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });

    test('Start Kernel (with start)', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            assert.equal(startedInfo.length, 3, 'Information for kernel start incorrect');
            assert.equal(typeof (startedInfo[0]), 'string', 'First part of information for kernel start incorrect');
            assert.equal(typeof (startedInfo[2]), 'string', 'Last part of information for kernel start incorrect');
            done();
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Start Kernel (without start)', done => {
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        jupyter.getAllKernelSpecs().then(kernelSpecs => {
            process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';

            // Ok we got the kernelspecs, now create another new jupyter client 
            // and tell it to start a specific kernel
            const jupyter2 = new JupyterClientAdapter(output, __dirname);
            const kernelNames = Object.keys(kernelSpecs);
            jupyter2.startKernel(kernelSpecs[kernelNames[0]].spec).then(startedInfo => {
                assert.equal(startedInfo.length, 3, 'Information for kernel start incorrect');
                assert.equal(typeof (startedInfo[0]), 'string', 'First part of information for kernel start incorrect');
                assert.equal(typeof (startedInfo[2]), 'string', 'Last part of information for kernel start incorrect');
                done();
            }).catch(reason => {
                assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
                done();
            });

            process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';

        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Execute Code (success)', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            const output = [];
            jupyter.runCode('1+2').subscribe(data => {
                output.push(data);
            }, reason => {
                assert.fail(reason, null, 'Code execution failed in jupyter', '');
                done();
            }, () => {
                assert.equal(output.some(d => d.stream === 'pyout' && d.type === 'text' && d.data['text/plain'] === '3'), true, 'pyout not found in output');
                assert.equal(output.some(d => d.stream === 'status' && d.type === 'text' && d.data === 'ok'), true, 'status not found in output');
                done();
            });
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Execute Code (with threads)', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            const output = [];
            jupyter.runCode('print(2)\nimport time\ntime.sleep(5)\nprint(3)').subscribe(data => {
                output.push(data);
            }, reason => {
                assert.fail(reason, null, 'Code execution failed in jupyter', '');
                done();
            }, () => {
                assert.equal(output.some(d => d.stream === 'stdout' && d.type === 'text' && d.data['text/plain'] === '2'), true, 'stdout (2) not found in output');
                assert.equal(output.some(d => d.stream === 'stdout' && d.type === 'text' && d.data['text/plain'] === '3'), true, 'stdout (3) not found in output');
                assert.equal(output.some(d => d.stream === 'status' && d.type === 'text' && d.data === 'ok'), true, 'status not found in output');
                done();
            });
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Execute Code (failure)', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            const output = [];
            jupyter.runCode('print(x)').subscribe(data => {
                output.push(data);
            }, reason => {
                assert.fail(reason, null, 'Code execution failed in jupyter', '');
                done();
            }, () => {
                assert.equal(output.some(d => d.stream === 'error' && d.type === 'text'), true, 'error not found in output');
                assert.equal(output.some(d => d.stream === 'status' && d.type === 'text' && d.data === 'error'), true, 'status not found in output');
                done();
            });
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Shutdown Kernel', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            assert.equal(startedInfo.length, 3, 'Information for kernel start incorrect');
            assert.equal(typeof (startedInfo[0]), 'string', 'First part of information for kernel start incorrect');
            assert.equal(typeof (startedInfo[2]), 'string', 'Last part of information for kernel start incorrect');

            return jupyter.shutdownkernel(startedInfo[0]);
        }).then(() => {
            done();
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Shutdown while executing code', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            const output = [];
            let runFailedWithError = false;
            jupyter.runCode('print(2)\nimport time\ntime.sleep(5)\nprint(3)').subscribe(data => {
                output.push(data);
                if (output.length === 1) {
                    // Shutdown this kernel immediately
                    jupyter.shutdownkernel(startedInfo[0]).then(() => {
                        assert.equal(runFailedWithError, true, 'Error event not raised in observale');
                        done();
                    }, reason => {
                        assert.fail(reason, null, 'Failed to shutdown the kernel', '');
                    });
                }
            }, reason => {
                if (reason instanceof KernelShutdownError) {
                    runFailedWithError = true;
                }
                else {
                    assert.fail(reason, null, 'Code execution failed in jupyter with invalid error', '');
                }
            }, () => {
                assert.fail('Complete event fired', 'none', 'Completed fired for observable', '');
            });
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });


    test('Interrupt Kernel', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            assert.equal(startedInfo.length, 3, 'Information for kernel start incorrect');
            assert.equal(typeof (startedInfo[0]), 'string', 'First part of information for kernel start incorrect');
            assert.equal(typeof (startedInfo[2]), 'string', 'Last part of information for kernel start incorrect');

            return jupyter.interruptKernel(startedInfo[0]);
        }).then(() => {
            jupyter.dispose();
            setTimeout(function () {
                done();

            }, 5000);
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Interrupt Kernel while executing code', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            const output = [];
            jupyter.runCode('print(2)\nimport time\ntime.sleep(5)\nprint(3)').subscribe(data => {
                output.push(data);

                if (output.length === 1) {
                    // interrupt this kernel immediately
                    jupyter.interruptKernel(startedInfo[0]).then(() => {
                        // Do nothing
                        const y = '';
                    }, reason => {
                        assert.fail(reason, null, 'Failed to interrupt the kernel', '');
                    });
                }
            }, reason => {
                assert.fail(reason, null, 'Code execution failed in jupyter with invalid error', '');
            }, () => {
                assert.equal(output.some(d => d.stream === 'stdout' && d.type === 'text' && d.data['text/plain'] === '2'), true, 'stdout not found in output');
                assert.equal(output.some(d => d.stream === 'error' && d.type === 'text'), true, 'error (KeyboardInterrupt) not found');
                assert.equal(output.some(d => d.stream === 'status' && d.type === 'text' && d.data === 'error'), true, 'status not found in output');
                jupyter.dispose();
                done();
            });
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Restart Kernel', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            assert.equal(startedInfo.length, 3, 'Information for kernel start incorrect');
            assert.equal(typeof (startedInfo[0]), 'string', 'First part of information for kernel start incorrect');
            assert.equal(typeof (startedInfo[2]), 'string', 'Last part of information for kernel start incorrect');

            return jupyter.restartKernel(startedInfo[0]);
        }).then(() => {
            done();
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to resrart the kernel', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
    test('Restart while executing code', done => {
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '0';
        const output = new mocks.MockOutputChannel('Jupyter');
        const jupyter = new JupyterClientAdapter(output, __dirname);
        jupyter.start().then(() => {
            return jupyter.getAllKernelSpecs();
        }).then(kernelSpecs => {
            const kernelNames = Object.keys(kernelSpecs);
            assert.notEqual(kernelNames.length, 0, 'kernelSpecs not found');
            // Get name of any kernel
            return jupyter.startKernel(kernelSpecs[kernelNames[0]].spec);
        }).then(startedInfo => {
            const output = [];
            let runFailedWithError = false;
            jupyter.runCode('print(2)\nimport time\ntime.sleep(5)\nprint(3)').subscribe(data => {
                output.push(data);
                if (output.length === 1) {
                    // Shutdown this kernel immediately
                    jupyter.restartKernel(startedInfo[0]).then(() => {
                        assert.equal(runFailedWithError, true, 'Error event not raised in observale');
                        done();
                    }, reason => {
                        assert.fail(reason, null, 'Failed to restart the kernel', '');
                    });
                }
            }, reason => {
                if (reason instanceof KernelRestartedError) {
                    runFailedWithError = true;
                }
                else {
                    assert.fail(reason, null, 'Code execution failed in jupyter with invalid error', '');
                }
            }, () => {
                assert.fail('Complete event fired', 'none', 'Completed fired for observable', '');
            });
        }).catch(reason => {
            assert.fail(reason, undefined, 'Failed to retrieve kernelspecs', '');
            done();
        });
        process.env['PYTHON_DONJAYAMANNE_TEST'] = '1';
    });
});