// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as assert from 'assert';
import { Uri } from 'vscode';
import { PythonEnvKind } from '../../../client/pythonEnvironments/base/info';
import {
    BasicPythonEnvsChangedEvent,
    BasicPythonEnvsWatcher,
    PythonEnvsChangedEvent,
    PythonEnvsWatcher
} from '../../../client/pythonEnvironments/base/watcher';

const KINDS_TO_TEST = [
    PythonEnvKind.Unknown,
    PythonEnvKind.System,
    PythonEnvKind.Custom,
    PythonEnvKind.OtherGlobal,
    PythonEnvKind.Venv,
    PythonEnvKind.Conda,
    PythonEnvKind.OtherVirtual
];

suite('pyenvs watcher - BasicPythonEnvsWatcher', () => {
    suite('fire()', () => {
        test('empty event', () => {
            const expected: BasicPythonEnvsChangedEvent = {};
            const watcher = new BasicPythonEnvsWatcher();
            let event: BasicPythonEnvsChangedEvent | undefined;
            watcher.onChanged((e) => {
                event = e;
            });

            watcher.fire(expected);

            assert.equal(event, expected);
        });

        KINDS_TO_TEST.forEach((kind) => {
            test(`non-empty event ("${kind}")`, () => {
                const expected: BasicPythonEnvsChangedEvent = {
                    kind: kind
                };
                const watcher = new BasicPythonEnvsWatcher();
                let event: BasicPythonEnvsChangedEvent | undefined;
                watcher.onChanged((e) => {
                    event = e;
                });

                watcher.fire(expected);

                assert.equal(event, expected);
            });
        });
    });

    suite('trigger()', () => {
        test('empty event', () => {
            const expected: BasicPythonEnvsChangedEvent = {
                kind: undefined
            };
            const watcher = new BasicPythonEnvsWatcher();
            let event: BasicPythonEnvsChangedEvent | undefined;
            watcher.onChanged((e) => {
                event = e;
            });

            watcher.trigger();

            assert.deepEqual(event, expected);
        });

        KINDS_TO_TEST.forEach((kind) => {
            test(`non-empty event ("${kind}")`, () => {
                const expected: BasicPythonEnvsChangedEvent = {
                    kind: kind
                };
                const watcher = new BasicPythonEnvsWatcher();
                let event: BasicPythonEnvsChangedEvent | undefined;
                watcher.onChanged((e) => {
                    event = e;
                });

                watcher.trigger(kind);

                assert.deepEqual(event, expected);
            });
        });
    });
});

suite('pyenvs watcher - PythonEnvsWatcher', () => {
    const location = Uri.file('some-dir');

    suite('fire()', () => {
        test('empty event', () => {
            const expected: PythonEnvsChangedEvent = {};
            const watcher = new PythonEnvsWatcher();
            let event: PythonEnvsChangedEvent | undefined;
            watcher.onChanged((e) => {
                event = e;
            });

            watcher.fire(expected);

            assert.equal(event, expected);
        });

        KINDS_TO_TEST.forEach((kind) => {
            test(`non-empty event ("${kind}")`, () => {
                const expected: PythonEnvsChangedEvent = {
                    kind: kind,
                    searchLocation: location
                };
                const watcher = new PythonEnvsWatcher();
                let event: PythonEnvsChangedEvent | undefined;
                watcher.onChanged((e) => {
                    event = e;
                });

                watcher.fire(expected);

                assert.equal(event, expected);
            });
        });
    });

    suite('trigger()', () => {
        test('empty event', () => {
            const expected: PythonEnvsChangedEvent = {
                kind: undefined,
                searchLocation: undefined
            };
            const watcher = new PythonEnvsWatcher();
            let event: PythonEnvsChangedEvent | undefined;
            watcher.onChanged((e) => {
                event = e;
            });

            watcher.trigger();

            assert.deepEqual(event, expected);
        });

        KINDS_TO_TEST.forEach((kind) => {
            test(`non-empty event ("${kind}")`, () => {
                const expected: PythonEnvsChangedEvent = {
                    kind: kind,
                    searchLocation: location
                };
                const watcher = new PythonEnvsWatcher();
                let event: PythonEnvsChangedEvent | undefined;
                watcher.onChanged((e) => {
                    event = e;
                });

                watcher.trigger(kind, location);

                assert.deepEqual(event, expected);
            });
        });
    });
});
