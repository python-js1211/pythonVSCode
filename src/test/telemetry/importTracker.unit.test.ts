// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
//tslint:disable:max-func-body-length match-default-export-name no-any no-multiline-string no-trailing-whitespace
import { expect } from 'chai';
import rewiremock from 'rewiremock';
import * as TypeMoq from 'typemoq';
import { EventEmitter, TextDocument } from 'vscode';

import { IDocumentManager } from '../../client/common/application/types';
import { IHistoryProvider } from '../../client/datascience/types';
import { EventName } from '../../client/telemetry/constants';
import { ImportTracker } from '../../client/telemetry/importTracker';
import { ICodeExecutionManager } from '../../client/terminals/types';
import { createDocument } from '../datascience/editor-integration/helpers';

suite('Import Tracker', () => {
    const oldValueOfVSC_PYTHON_UNIT_TEST = process.env.VSC_PYTHON_UNIT_TEST;
    const oldValueOfVSC_PYTHON_CI_TEST = process.env.VSC_PYTHON_CI_TEST;
    // tslint:disable-next-line:no-require-imports
    const hashJs = require('hash.js');
    let importTracker: ImportTracker;
    let documentManager: TypeMoq.IMock<IDocumentManager>;
    let historyProvider: TypeMoq.IMock<IHistoryProvider>;
    let codeExecutionManager: TypeMoq.IMock<ICodeExecutionManager>;
    let openedEventEmitter: EventEmitter<TextDocument>;
    let savedEventEmitter: EventEmitter<TextDocument>;
    let historyEventEmitter: EventEmitter<string>;
    let codeExecutionEmitter: EventEmitter<string>;
    const pandasHash = hashJs.sha256().update('pandas').digest('hex');
    const elephasHash = hashJs.sha256().update('elephas').digest('hex');
    const kerasHash = hashJs.sha256().update('keras').digest('hex');
    const pysparkHash = hashJs.sha256().update('pyspark').digest('hex');
    const sparkdlHash = hashJs.sha256().update('sparkdl').digest('hex');
    const numpyHash = hashJs.sha256().update('numpy').digest('hex');
    const scipyHash = hashJs.sha256().update('scipy').digest('hex');
    const sklearnHash = hashJs.sha256().update('sklearn').digest('hex');
    const randomHash = hashJs.sha256().update('random').digest('hex');

    class Reporter {
        public static eventNames: string[] = [];
        public static properties: Record<string, string>[] = [];
        public static measures: {}[] = [];
        public sendTelemetryEvent(eventName: string, properties?: {}, measures?: {}) {
            Reporter.eventNames.push(eventName);
            Reporter.properties.push(properties!);
            Reporter.measures.push(measures!);
        }
    }

    setup(() => {
        process.env.VSC_PYTHON_UNIT_TEST = undefined;
        process.env.VSC_PYTHON_CI_TEST = undefined;

        openedEventEmitter = new EventEmitter<TextDocument>();
        savedEventEmitter = new EventEmitter<TextDocument>();
        historyEventEmitter = new EventEmitter<string>();
        codeExecutionEmitter = new EventEmitter<string>();

        documentManager = TypeMoq.Mock.ofType<IDocumentManager>();
        historyProvider = TypeMoq.Mock.ofType<IHistoryProvider>();
        codeExecutionManager = TypeMoq.Mock.ofType<ICodeExecutionManager>();
        documentManager.setup(a => a.onDidOpenTextDocument).returns(() => openedEventEmitter.event);
        documentManager.setup(a => a.onDidSaveTextDocument).returns(() => savedEventEmitter.event);
        historyProvider.setup(h => h.onExecutedCode).returns(() => historyEventEmitter.event);
        codeExecutionManager.setup(c => c.onExecutedCode).returns(() => codeExecutionEmitter.event);

        rewiremock.enable();
        rewiremock('vscode-extension-telemetry').with({ default: Reporter });

        importTracker = new ImportTracker(documentManager.object, historyProvider.object, codeExecutionManager.object);
    });
    teardown(() => {
        process.env.VSC_PYTHON_UNIT_TEST = oldValueOfVSC_PYTHON_UNIT_TEST;
        process.env.VSC_PYTHON_CI_TEST = oldValueOfVSC_PYTHON_CI_TEST;
        Reporter.properties = [];
        Reporter.eventNames = [];
        Reporter.measures = [];
        rewiremock.disable();

    });

    function emitDocEvent(code: string, ev: EventEmitter<TextDocument>) {
        const textDoc = createDocument(code, 'foo.py', 1, TypeMoq.Times.atMost(100), true);
        ev.fire(textDoc.object);
    }

    test('Open document', () => {
        emitDocEvent('import pandas\r\n', openedEventEmitter);

        expect(Reporter.eventNames).to.deep.equal([EventName.KNOWN_IMPORT_FROM_FILE]);
        expect(Reporter.properties).to.deep.equal([{ import: pandasHash }]);
    });

    test('Already opened documents', async () => {
        const doc = createDocument('import pandas\r\n', 'foo.py', 1, TypeMoq.Times.atMost(100), true);
        documentManager.setup(d => d.textDocuments).returns(() => [doc.object]);
        await importTracker.activate();

        expect(Reporter.eventNames).to.deep.equal([EventName.KNOWN_IMPORT_FROM_FILE]);
        expect(Reporter.properties).to.deep.equal([{ import: pandasHash }]);
    });

    test('Save document', () => {
        emitDocEvent('import pandas\r\n', savedEventEmitter);

        expect(Reporter.eventNames).to.deep.equal([EventName.KNOWN_IMPORT_FROM_FILE]);
        expect(Reporter.properties).to.deep.equal([{ import: pandasHash }]);
    });

    test('Execute', () => {
        historyEventEmitter.fire('import pandas\r\n');

        expect(Reporter.eventNames).to.deep.equal([EventName.KNOWN_IMPORT_FROM_EXECUTION]);
        expect(Reporter.properties).to.deep.equal([{ import: pandasHash }]);

        codeExecutionEmitter.fire('import pandas\r\n');

        // Should not emit another event.
        expect(Reporter.eventNames).to.deep.equal([EventName.KNOWN_IMPORT_FROM_EXECUTION]);
        expect(Reporter.properties).to.deep.equal([{ import: pandasHash }]);
    });

    test('elephas', () => {
        const elephas = `
        from elephas.java import java_classes, adapter
        from keras.models import Sequential
        from keras.layers import Dense
        
        
        model = Sequential()
        model.add(Dense(units=64, activation='relu', input_dim=100))
        model.add(Dense(units=10, activation='softmax'))
        model.compile(loss='categorical_crossentropy', optimizer='sgd', metrics=['accuracy'])
        
        model.save('test.h5')
        
        
        kmi = java_classes.KerasModelImport
        file = java_classes.File("test.h5")
        
        java_model = kmi.importKerasSequentialModelAndWeights(file.absolutePath)
        
        weights = adapter.retrieve_keras_weights(java_model)
        model.set_weights(weights)`;

        historyEventEmitter.fire(elephas);
        expect(Reporter.properties).to.deep.equal([{ import: elephasHash }, { import: kerasHash }]);
    });

    test('pyspark', () => {
        const pyspark = `from pyspark.ml.classification import LogisticRegression
        from pyspark.ml.evaluation import MulticlassClassificationEvaluator
        from pyspark.ml import Pipeline
        from sparkdl import DeepImageFeaturizer
        
        featurizer = DeepImageFeaturizer(inputCol="image", outputCol="features", modelName="InceptionV3")
        lr = LogisticRegression(maxIter=20, regParam=0.05, elasticNetParam=0.3, labelCol="label")
        p = Pipeline(stages=[featurizer, lr])
        
        model = p.fit(train_images_df)    # train_images_df is a dataset of images and labels
        
        # Inspect training error
        df = model.transform(train_images_df.limit(10)).select("image", "probability",  "uri", "label")
        predictionAndLabels = df.select("prediction", "label")
        evaluator = MulticlassClassificationEvaluator(metricName="accuracy")
        print("Training set accuracy = " + str(evaluator.evaluate(predictionAndLabels)))`;

        historyEventEmitter.fire(pyspark);
        expect(Reporter.properties).to.deep.equal([{ import: pysparkHash }, { import: sparkdlHash }]);
    });

    test('numpy', () => {
        const code = `import pandas as pd
import numpy as np
import random as rnd

def simplify_ages(df):
    df.Age = df.Age.fillna(-0.5)
    bins = (-1, 0, 5, 12, 18, 25, 35, 60, 120)
    group_names = ['Unknown', 'Baby', 'Child', 'Teenager', 'Student', 'Young Adult', 'Adult', 'Senior']
    categories = pd.cut(df.Age, bins, labels=group_names)
    df.Age = categories
    return df`;
        historyEventEmitter.fire(code);
        expect(Reporter.properties).to.deep.equal([{ import: pandasHash }, { import: numpyHash }, { import: randomHash }]);
    });

    test('scipy', () => {
        const code = `from scipy import special
def drumhead_height(n, k, distance, angle, t):
   kth_zero = special.jn_zeros(n, k)[-1]
   return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
theta = np.r_[0:2*np.pi:50j]
radius = np.r_[0:1:50j]
x = np.array([r * np.cos(theta) for r in radius])
y = np.array([r * np.sin(theta) for r in radius])
z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;
        historyEventEmitter.fire(code);
        expect(Reporter.properties).to.deep.equal([{ import: scipyHash }]);
    });

    test('function', () => {
        const code = `
def drumhead_height(n, k, distance, angle, t):
   import sklearn as sk
   return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
theta = np.r_[0:2*np.pi:50j]
radius = np.r_[0:1:50j]
x = np.array([r * np.cos(theta) for r in radius])
y = np.array([r * np.sin(theta) for r in radius])
z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;
        historyEventEmitter.fire(code);
        expect(Reporter.properties).to.deep.equal([{ import: sklearnHash }]);
    });

    test('Comma separated', () => {
        const code = `
def drumhead_height(n, k, distance, angle, t):
   import sklearn, pandas
   return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
theta = np.r_[0:2*np.pi:50j]
radius = np.r_[0:1:50j]
x = np.array([r * np.cos(theta) for r in radius])
y = np.array([r * np.sin(theta) for r in radius])
z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;
        historyEventEmitter.fire(code);
        expect(Reporter.properties).to.deep.equal([{ import: sklearnHash }, { import: pandasHash }]);
    });

    // That's probably enough different variants of code to verify nothing is wonky.
});
