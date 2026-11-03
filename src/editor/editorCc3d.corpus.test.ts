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
 * Optional corpus check: runs only when CC3D_CORPUS_DIR names a directory of level files (the data stays
 * outside the repository). Every level must survive decode -> editor document -> level with an identical
 * cc3d, no map change and no validator error; repainting a cell with its own layer must change nothing;
 * an edit followed by an undo must give back the same document.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CC3D_XML_EXTENSION, decodeCc3dFiles } from '../formats/Cc3dXmlCodec';
import { validateCc3dLevel } from '../core/cc3d/cc3dValidator';
import { type Cc3dLevel, topTerrain } from '../core/cc3d/model';
import type { CompiledLevel } from '../core/types';
import { placeLayer } from './cc3dEdits';
import { sameDocument, withCc3d } from './editorDocument';
import { EditorHistory } from './editorHistory';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { levelMapChanged } from './saveTarget';

const CORPUS_DIR = process.env.CC3D_CORPUS_DIR;
const TEST_TIMEOUT_MS = 300_000;
const HISTORY_SIZE = 10;

function loadLevels(): CompiledLevel[] {
  const dir = CORPUS_DIR as string;
  expect(existsSync(dir)).toBe(true);
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(CC3D_XML_EXTENSION))
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
  const { levels, failures } = decodeCc3dFiles(files, 'corpus');
  expect(failures).toEqual([]);
  return levels;
}

describe.skipIf(!CORPUS_DIR)('cc3d editor corpus round trip', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('keeps every level identical through the editor model', { timeout: TEST_TIMEOUT_MS }, () => {
    const levels = loadLevels();
    const problems: string[] = [];
    for (const level of levels) {
      const original = level.cc3d as Cc3dLevel;
      const doc = documentFromLevel(level, { title: 'T', hint: '' });
      const back = levelFromDocument(doc, { id: level.id, number: level.number, password: level.password, fallbackTitle: 'T' });
      if (JSON.stringify(back.cc3d) !== JSON.stringify(original)) problems.push(`${level.id}: cc3d differs`);
      if (levelMapChanged(level, back)) problems.push(`${level.id}: map reported changed`);
      if (back.chipsRequired !== level.chipsRequired) problems.push(`${level.id}: chipsRequired ${back.chipsRequired} vs ${level.chipsRequired}`);
      if (validateCc3dLevel(back.cc3d as Cc3dLevel).some((issue) => issue.severity === 'error')) problems.push(`${level.id}: validator error`);

      // Repainting a cell with the layer it already has changes nothing, whatever the cell.
      let repaintChanged = 0;
      for (let i = 0; i < original.cells.length; i += 1) {
        const x = i % original.width;
        const y = Math.floor(i / original.width);
        const same = placeLayer(original, x, y, topTerrain(original.cells[i]));
        if (same !== original && JSON.stringify(same.cells[i]) !== JSON.stringify(original.cells[i])) repaintChanged += 1;
      }
      if (repaintChanged > 0) problems.push(`${level.id}: ${repaintChanged} cells changed when repainted with their own layer`);

      // An edit then an undo gives back the same document.
      const history = new EditorHistory(HISTORY_SIZE);
      const edited = withCc3d(doc, placeLayer(original, 0, 0, { kind: 'water' }));
      history.push(doc);
      const undone = history.undo(edited);
      if (!undone || !sameDocument(undone, doc)) problems.push(`${level.id}: undo did not restore the document`);
    }
    console.info(`editor corpus round trip: ${levels.length} levels, ${problems.length} problems`);
    expect(problems).toEqual([]);
  });
});
