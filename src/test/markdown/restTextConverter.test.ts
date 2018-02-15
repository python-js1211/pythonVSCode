// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as fs from 'fs-extra';
import * as path from 'path';
import { RestTextConverter } from '../../client/common/markdown/restTextConverter';
import { compareFiles } from '../textUtils';

const srcPythoFilesPath = path.join(__dirname, '..', '..', '..', 'src', 'test', 'pythonFiles', 'markdown');

async function testConversion(fileName: string): Promise<void> {
  const cvt = new RestTextConverter();
  const file = path.join(srcPythoFilesPath, fileName);
  const source = await fs.readFile(`${file}.pydoc`, 'utf8');
  const actual = cvt.toMarkdown(source);
  const expected = await fs.readFile(`${file}.md`, 'utf8');
  compareFiles(expected, actual);
}

// tslint:disable-next-line:max-func-body-length
suite('Hover - RestTextConverter', () => {
  test('scipy', async () => await testConversion('scipy'));
  test('scipy.spatial', async () => await testConversion('scipy.spatial'));
  test('scipy.spatial.distance', async () => await testConversion('scipy.spatial.distance'));
  test('anydbm', async () => await testConversion('anydbm'));
  test('aifc', async () => await testConversion('aifc'));
  test('astroid', async () => await testConversion('astroid'));
});
