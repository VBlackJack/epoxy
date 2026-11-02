/*
 * Copyright 2026 Julien Bombled
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Optional corpus check: runs only when CC3D_CORPUS_DIR names a directory of
 * level files. The data stays outside the repository.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape } from '../config/ConfigValidation';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CC3D_XML_EXTENSION, decodeCc3dFiles } from './Cc3dXmlCodec';

const CORPUS_DIR = process.env.CC3D_CORPUS_DIR;

describe.skipIf(!CORPUS_DIR)('corpus import', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('imports every file', () => {
    const dir = CORPUS_DIR as string;
    const files = readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(CC3D_XML_EXTENSION))
      .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
    const { levels, failures } = decodeCc3dFiles(files, 'corpus');
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const malformed = levels.filter((level) => !isCompiledLevelShape(level as unknown, bounds)).map((level) => level.id);
    const report = failures.map((f) => `${f.name}: ${f.error.key} ${JSON.stringify(f.error.params)}`);
    console.info(`corpus: ${levels.length} of ${files.length} imported, ${failures.length} failed\n${report.join('\n')}`);
    expect(malformed).toEqual([]);
    expect(report).toEqual([]);
  });
});
