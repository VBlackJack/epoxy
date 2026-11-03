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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { PACK_JSON_FORMAT, PACK_JSON_VERSION } from '../config/constants';
import { CompiledLevel } from '../core/types';
import { importCc3dSelection } from '../ui/cc3dImport';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { parsePackJson, serializePack } from './packJson';

const CELL = 64;
const PLAYER_TYPE = 22;
const FISH_TYPE = 42;

function cc3dXml(): string {
  const tile = (type: number, x: number, y: number) =>
    `<tile image_index="${type}" x="${x * CELL}" y="${y * CELL}" direction="0" type="${type}"><attributes flags="0" editor_category="0" name="Stored" /></tile>`;
  return `<?xml version="1.0" encoding="utf-8"?><map name="Valid" author="A" width="5" height="5" background="0"><tiles>${tile(PLAYER_TYPE, 0, 0)}${tile(FISH_TYPE, 2, 2)}</tiles></map>`;
}

async function makeCc3dLevel(): Promise<CompiledLevel> {
  const text = cc3dXml();
  const file = { name: '1.xml', size: 1, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
  const { levels } = await importCc3dSelection([file], 1024, 'Pack');
  return levels[0];
}

function parse(text: string, taken: string[] = []) {
  return parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set(taken), () => 7000);
}

describe('packJson', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('round-trips an epoxy, a lynx and a cc3d level untouched', async () => {
    const levels = [
      { ...makeLevel('e1', { customTitle: 'Plain', theme: 'night', solution: 'NES' }), number: 1 },
      { ...makeLevel('l1', { ruleset: 'lynx', titleKey: 'k.t', hintKey: 'k.h' }), number: 2 },
      { ...(await makeCc3dLevel()), id: 'c1', number: 3 }
    ];
    const result = parse(serializePack('Mixed', levels));
    expect(result).toEqual({ ok: true, name: 'Mixed', levels });
    if (result.ok) {
      expect(result.levels[1].ruleset).toBe('lynx');
      expect(result.levels[2].ruleset).toBe('cc3d');
      expect(result.levels[2].cc3d).toEqual(levels[2].cc3d);
    }
  });

  it('writes the format marker and the version', () => {
    const file = JSON.parse(serializePack('N', [makeLevel('a')]));
    expect(file).toMatchObject({ format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION, name: 'N' });
  });

  it('refuses text that is not JSON, another format and a newer version', () => {
    expect(parse('{nope')).toEqual({ ok: false, error: 'malformed' });
    expect(parse('[]')).toEqual({ ok: false, error: 'format' });
    expect(parse(JSON.stringify({ format: 'other', version: 1, name: 'x', levels: [] }))).toEqual({
      ok: false,
      error: 'format'
    });
    const future = { format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION + 1, name: 'x', levels: [makeLevel('a')] };
    expect(parse(JSON.stringify(future))).toEqual({ ok: false, error: 'version' });
    expect(parse(JSON.stringify({ ...future, version: 'one' }))).toEqual({ ok: false, error: 'version' });
  });

  it('refuses a file with no name or no valid level', () => {
    const base = { format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION };
    expect(parse(JSON.stringify({ ...base, name: ' ', levels: [makeLevel('a')] }))).toEqual({
      ok: false,
      error: 'name'
    });
    expect(parse(JSON.stringify({ ...base, name: 'x', levels: [{ id: 'bad' }] }))).toEqual({
      ok: false,
      error: 'no_levels'
    });
    expect(parse(JSON.stringify({ ...base, name: 'x', levels: 'nope' }))).toEqual({
      ok: false,
      error: 'malformed'
    });
  });

  it('keeps the valid levels and drops a level outside the size bounds', () => {
    const { maxLevelSize } = ConfigRegistry.getGame().grid;
    const huge = makeLevel('huge');
    huge.terrain = Array.from({ length: maxLevelSize + 1 }, () => new Array<string>(maxLevelSize + 1).fill('floor'));
    huge.items = huge.terrain.map((row) => row.map(() => null));
    const result = parse(serializePack('P', [huge, makeLevel('ok')]));
    expect(result.ok && result.levels.map((l) => l.id)).toEqual(['ok']);
  });

  it('makes ids unique inside the file and numbers the levels 1..n', () => {
    const result = parse(serializePack('P', [makeLevel('a'), makeLevel('a'), makeLevel('b')]));
    expect(result.ok && result.levels.map((l) => l.id)).toEqual(['a', 'a_2', 'b']);
    expect(result.ok && result.levels.map((l) => l.number)).toEqual([1, 2, 3]);
  });

  it('re-issues the ids the library already holds, avoiding the other ids of the file', () => {
    const result = parse(serializePack('P', [makeLevel('a'), makeLevel('b'), makeLevel('custom_7000')]), ['a']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.levels.map((l) => l.id);
    expect(ids[0]).not.toBe('a');
    expect(ids[0]).toMatch(/^custom_/);
    expect(ids.slice(1)).toEqual(['b', 'custom_7000']);
    expect(new Set(ids).size).toBe(3);
  });

  describe('metadata', () => {
    const limits = () => ConfigRegistry.getPackMetadataLimits();
    const withLimits = (text: string) =>
      parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set(), () => 7000, limits());
    const file = (extra: Record<string, unknown>) =>
      JSON.stringify({ format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION, name: 'P', ...extra, levels: [makeLevel('a')] });

    it('round-trips the author and the description, keeping the format version', () => {
      const text = serializePack('P', [makeLevel('a')], { author: 'Ann', description: 'Two\nlines' });
      expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION);
      const result = withLimits(text);
      expect(result.ok && result.author).toBe('Ann');
      expect(result.ok && result.description).toBe('Two\nlines');
    });

    it('writes no field for an empty metadata', () => {
      const parsed = JSON.parse(serializePack('P', [makeLevel('a')], { author: '', description: undefined }));
      expect('author' in parsed).toBe(false);
      expect('description' in parsed).toBe(false);
    });

    it('reads a file written before the fields existed', () => {
      const result = withLimits(file({}));
      expect(result.ok).toBe(true);
      expect(result.ok && 'author' in result).toBe(false);
      expect(result.ok && 'description' in result).toBe(false);
    });

    it('clamps to the configured lengths and drops non-string values', () => {
      const long = withLimits(file({ author: 'a'.repeat(999), description: 'd'.repeat(9999) }));
      expect(long.ok && long.author).toHaveLength(limits().authorMaxLength);
      expect(long.ok && long.description).toHaveLength(limits().descriptionMaxLength);
      const odd = withLimits(file({ author: 7, description: { x: 1 } }));
      expect(odd.ok && 'author' in odd).toBe(false);
      expect(odd.ok && 'description' in odd).toBe(false);
    });

    it('ignores the fields when no limits are given', () => {
      const result = parse(file({ author: 'Ann' }));
      expect(result.ok && 'author' in result).toBe(false);
    });
  });
});
