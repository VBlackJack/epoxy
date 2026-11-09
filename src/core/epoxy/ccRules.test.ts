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

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { sanitizeStoredLevels } from '../../config/ConfigValidation';
import { documentFromLevel, levelFromDocument } from '../../editor/editorLevelIo';
import { cloneDocument, sameDocument, snapshotDocument } from '../../editor/editorDocument';
import { convertCc2Map } from '../../formats/cc2ToEpoxy';
import { makeMap, player } from '../../formats/cc2TestMaps';
import { parsePackJson, serializePack } from '../../packs/packJson';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { makeLevel } from '../../test/packFixtures';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel } from '../types';
import { usesCcRules } from './ccRules';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD: Cc2LevelData = {
  v: 1,
  sha256: 'ab'.repeat(32),
  file: 'one.c2m',
  order: 1,
  gridHash: 'x',
  coverage: { verdict: 'exact', lost: [], approx: [] }
} as Cc2LevelData;

function bounds() {
  return ConfigRegistry.getLevelSizeBounds();
}

describe('usesCcRules', () => {
  it('is true for the flag, true for a bare cc2 record, false for neither', () => {
    expect(usesCcRules({ rulesFlavor: 'cc' })).toBe(true);
    expect(usesCcRules({ cc2: CC2_RECORD })).toBe(true);
    expect(usesCcRules({})).toBe(false);
  });

  it('is exposed on the world of a loaded level', () => {
    const read = (level: CompiledLevel): boolean => {
      const engine = new GameEngine();
      engine.loadLevel(level);
      return (engine as unknown as { w: { ccRules: boolean } }).w.ccRules;
    };
    expect(read(makeLevel('plain'))).toBe(false);
    expect(read({ ...makeLevel('flag'), rulesFlavor: 'cc' })).toBe(true);
    expect(read({ ...makeLevel('legacy'), cc2: CC2_RECORD })).toBe(true);
  });
});

describe('cc2ToEpoxy', () => {
  it('sets the flavor on an imported level', () => {
    const { level } = convertCc2Map(makeMap(4, 3, [player(0, 0)]), { file: 'one.c2m', order: 1, sha256: 'ab'.repeat(32) });
    expect(level.rulesFlavor).toBe('cc');
    expect(usesCcRules(level)).toBe(true);
  });
});

describe('persistence', () => {
  it('survives a stored reload and drops a malformed value while keeping the level', () => {
    const good = { ...makeLevel('good'), rulesFlavor: 'cc' } as CompiledLevel;
    const bad = { ...makeLevel('bad'), rulesFlavor: 'epoxy' } as unknown as CompiledLevel;
    const [kept, stripped] = sanitizeStoredLevels([good, bad], bounds());
    expect(kept.rulesFlavor).toBe('cc');
    expect(stripped.id).toBe('bad');
    expect('rulesFlavor' in stripped).toBe(false);
  });

  it('survives a pack JSON round trip', () => {
    const level = { ...makeLevel('flavored'), rulesFlavor: 'cc' } as CompiledLevel;
    const result = parsePackJson(serializePack('P', [level]), bounds(), new Set(), () => 7000);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.levels[0].rulesFlavor).toBe('cc');
  });

  it('is dropped from a pack JSON file when malformed, the level is kept', () => {
    const text = serializePack('P', [{ ...makeLevel('odd'), rulesFlavor: 'nope' } as unknown as CompiledLevel]);
    const result = parsePackJson(text, bounds(), new Set(), () => 7000);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.levels).toHaveLength(1);
      expect(result.levels[0].rulesFlavor).toBeUndefined();
    }
  });

  it('tells two documents apart by rulesFlavor', () => {
    const plain = documentFromLevel(makeLevel('same'), { title: 'T', hint: '' });
    const flavored = documentFromLevel({ ...makeLevel('same'), rulesFlavor: 'cc' } as CompiledLevel, { title: 'T', hint: '' });
    expect(sameDocument(plain, flavored)).toBe(false);
    expect(sameDocument(flavored, cloneDocument(flavored))).toBe(true);
  });

  it('is kept by the editor document through load, clone, snapshot and save', () => {
    const level = { ...makeLevel('edited'), rulesFlavor: 'cc' } as CompiledLevel;
    const doc = documentFromLevel(level, { title: 'T', hint: '' });
    expect(doc.rulesFlavor).toBe('cc');
    expect(cloneDocument(doc).rulesFlavor).toBe('cc');
    expect(snapshotDocument(doc).rulesFlavor).toBe('cc');
    const saved = levelFromDocument(doc, { id: 'edited', number: 1, password: '', fallbackTitle: 'T' });
    expect(saved.rulesFlavor).toBe('cc');
    const plain = levelFromDocument(documentFromLevel(makeLevel('plain'), { title: 'T', hint: '' }), {
      id: 'plain',
      number: 1,
      password: '',
      fallbackTitle: 'T'
    });
    expect('rulesFlavor' in plain).toBe(false);
  });
});
