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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { CompiledLevel, LevelTextConfig } from '../core/types';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { importCc3dSelection } from '../ui/cc3dImport';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { ConfigRegistry } from './ConfigRegistry';
import { clampLevelText, isCompiledLevelShape, sanitizeStoredLevels } from './ConfigValidation';

const CELL = 64;
const PLAYER_TYPE = 22;
const FISH_TYPE = 42;

async function makeCc3dLevel(): Promise<CompiledLevel> {
  const tile = (type: number, x: number, y: number) =>
    `<tile image_index="${type}" x="${x * CELL}" y="${y * CELL}" direction="0" type="${type}"><attributes flags="0" editor_category="0" name="Stored" /></tile>`;
  const xml = `<?xml version="1.0" encoding="utf-8"?><map name="Valid" author="A" width="5" height="5" background="0"><tiles>${tile(PLAYER_TYPE, 0, 0)}${tile(FISH_TYPE, 2, 2)}</tiles></map>`;
  const file = { name: '1.xml', size: 1, arrayBuffer: async () => new TextEncoder().encode(xml).buffer as ArrayBuffer };
  const { levels } = await importCc3dSelection([file], 1024, 'Pack');
  return levels[0];
}

let limits: LevelTextConfig;

function sanitize(levels: unknown[]): CompiledLevel[] {
  return sanitizeStoredLevels(levels, ConfigRegistry.getLevelSizeBounds(), limits);
}

describe('level shape and text limits', () => {
  beforeEach(() => {
    loadTestConfigs();
    limits = ConfigRegistry.getLevelTextLimits();
  });

  it('loads every campaign level unchanged', () => {
    const campaign = ConfigRegistry.getLevels();
    expect(campaign.length).toBeGreaterThan(0);
    const roundTripped = sanitize(JSON.parse(JSON.stringify(campaign)));
    expect(roundTripped).toEqual(campaign);
  });

  it('loads an imported cc3d level and a lynx level unchanged', async () => {
    const levels = [await makeCc3dLevel(), makeLevel('l1', { ruleset: 'lynx', customTitle: 'Titre', customHint: 'Hint', solution: 'NESW' })];
    expect(sanitize(JSON.parse(JSON.stringify(levels)))).toEqual(levels);
  });

  it('accepts entities with a type and links with coordinates', () => {
    const level = makeLevel('e', {
      entities: [{ x: 2, y: 2, type: 'blob', dir: 'N' }],
      trapLinks: [{ buttonX: 1, buttonY: 1, trapX: 2, trapY: 2 }]
    });
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds(), true)).toBe(true);
  });

  it('refuses entities and links that are not records', () => {
    const level = makeLevel('e') as unknown as Record<string, unknown>;
    const bounds = ConfigRegistry.getLevelSizeBounds();
    for (const bad of [[1], [null], ['x'], [[]]]) {
      expect(isCompiledLevelShape({ ...level, entities: bad }, bounds, true)).toBe(false);
      expect(isCompiledLevelShape({ ...level, trapLinks: bad }, bounds, true)).toBe(false);
      expect(isCompiledLevelShape({ ...level, cloneLinks: bad }, bounds, true)).toBe(false);
    }
  });

  it('refuses an entity without a string type', () => {
    const level = makeLevel('e') as unknown as Record<string, unknown>;
    const bounds = ConfigRegistry.getLevelSizeBounds();
    expect(isCompiledLevelShape({ ...level, entities: [{ x: 1, y: 1, dir: 'N' }] }, bounds, true)).toBe(false);
    expect(isCompiledLevelShape({ ...level, entities: [{ x: 1, y: 1, type: 4, dir: 'N' }] }, bounds, true)).toBe(false);
  });

  it('refuses more entities or links than the map has cells', () => {
    const level = makeLevel('e');
    const cells = level.terrain.length * level.terrain[0].length;
    const entity = { x: 1, y: 1, type: 'blob', dir: 'N' };
    const link = { buttonX: 1, buttonY: 1, trapX: 2, trapY: 2 };
    const bounds = ConfigRegistry.getLevelSizeBounds();
    expect(isCompiledLevelShape({ ...level, entities: Array(cells).fill(entity) }, bounds, true)).toBe(true);
    expect(isCompiledLevelShape({ ...level, entities: Array(cells + 1).fill(entity) }, bounds, true)).toBe(false);
    expect(isCompiledLevelShape({ ...level, trapLinks: Array(cells + 1).fill(link) }, bounds, true)).toBe(false);
    expect(isCompiledLevelShape({ ...level, cloneLinks: Array(cells + 1).fill(link) }, bounds, true)).toBe(false);
  });

  it('refuses more cc3d mobs than cells and more than four panels on a cell', async () => {
    const level = JSON.parse(JSON.stringify(await makeCc3dLevel())) as CompiledLevel;
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const cc3d = level.cc3d!;
    const mob = { kind: 'walker', x: 0, y: 0, dir: 'N' };
    const manyMobs = { ...level, cc3d: { ...cc3d, mobs: Array(cc3d.cells.length + 1).fill(mob) } };
    expect(isCompiledLevelShape(manyMobs, bounds, true)).toBe(false);
    const cells = cc3d.cells.map((cell, i) => (i === 0 ? { ...cell, panels: ['N', 'E', 'S', 'W', 'N'] } : cell));
    expect(isCompiledLevelShape({ ...level, cc3d: { ...cc3d, cells } }, bounds, true)).toBe(false);
  });

  it('cuts the text fields to their limits', () => {
    const long = (max: number) => 'x'.repeat(max + 10);
    const level = {
      ...makeLevel('t'),
      customTitle: long(limits.titleMaxLength),
      customHint: long(limits.hintMaxLength),
      author: long(limits.authorMaxLength),
      password: long(limits.passwordMaxLength),
      theme: long(limits.themeMaxLength),
      titleKey: long(limits.keyMaxLength),
      hintKey: long(limits.keyMaxLength)
    };
    const [kept] = sanitize([level]);
    expect(kept.customTitle).toHaveLength(limits.titleMaxLength);
    expect(kept.customHint).toHaveLength(limits.hintMaxLength);
    expect(kept.author).toHaveLength(limits.authorMaxLength);
    expect(kept.password).toHaveLength(limits.passwordMaxLength);
    expect(kept.theme).toHaveLength(limits.themeMaxLength);
    expect(kept.titleKey).toHaveLength(limits.keyMaxLength);
    expect(kept.hintKey).toHaveLength(limits.keyMaxLength);
  });

  it('drops a solution over its limit and keeps one at the limit', () => {
    const atLimit = { ...makeLevel('s'), solution: 'N'.repeat(limits.solutionMaxLength) };
    const over = { ...makeLevel('s2'), solution: 'N'.repeat(limits.solutionMaxLength + 1) };
    const [kept, dropped] = sanitize([atLimit, over]);
    expect(kept.solution).toHaveLength(limits.solutionMaxLength);
    expect(dropped.solution).toBeUndefined();
  });

  it('cuts tile ids, item ids and entity types', () => {
    const base = makeLevel('ids', { entities: [{ x: 2, y: 2, type: 'blob', dir: 'N' }] });
    const longId = 'y'.repeat(limits.idMaxLength + 5);
    const terrain = base.terrain.map((row) => [...row]);
    terrain[0][0] = longId;
    const items = base.items.map((row) => [...row]);
    items[0][0] = longId;
    const [kept] = sanitize([{ ...base, terrain, items, entities: [{ ...base.entities[0], type: longId }] }]);
    expect(kept.terrain[0][0]).toHaveLength(limits.idMaxLength);
    expect(kept.items[0][0]).toHaveLength(limits.idMaxLength);
    expect(kept.entities[0].type).toHaveLength(limits.idMaxLength);
  });

  it('reads stored data without the new shape rules or cuts', () => {
    const base = makeLevel('old', { entities: [{ x: 2, y: 2, type: 'blob', dir: 'N' }] });
    const stored = {
      ...base,
      customTitle: 'x'.repeat(150),
      solution: 'N'.repeat(limits.solutionMaxLength + 100),
      entities: [...base.entities, 7]
    };
    const [kept] = sanitizeStoredLevels([stored], ConfigRegistry.getLevelSizeBounds());
    expect(kept).toEqual(stored);
    expect(sanitize([stored])).toEqual([]);
  });

  it('returns the very same level when nothing is over a limit', () => {
    const level = makeLevel('same');
    expect(clampLevelText(level, limits)).toBe(level);
  });

  it('does not cut without limits', () => {
    const level = { ...makeLevel('free'), customTitle: 'x'.repeat(limits.titleMaxLength + 50) };
    const [kept] = sanitizeStoredLevels([level], ConfigRegistry.getLevelSizeBounds());
    expect(kept.customTitle).toHaveLength(limits.titleMaxLength + 50);
  });
});

describe('IndexedDB reads', () => {
  const fake = new FakeIndexedDb();

  beforeEach(() => {
    loadTestConfigs();
    fake.records.clear();
    vi.stubGlobal('indexedDB', fake);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await LevelPackStorage.closeConnection();
  });

  it('loads a stored level with a long title and a long solution unchanged', async () => {
    const limits = ConfigRegistry.getLevelTextLimits();
    const level = { ...makeLevel('s1'), customTitle: 'x'.repeat(150), solution: 'N'.repeat(limits.solutionMaxLength + 10) };
    fake.records.set('p1', { id: 'p1', name: 'Stored', userCreated: true, levels: [level] });
    const packs = await LevelPackStorage.loadAllPacks();
    expect(packs?.[0].levels[0]).toEqual(level);
  });
});
