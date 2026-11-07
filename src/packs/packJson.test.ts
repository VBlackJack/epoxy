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
import {
  PACK_JSON_FORMAT,
  PACK_JSON_MAX_VERSION,
  PACK_JSON_VERSION,
  PACK_JSON_VERSION_CELL_EDGES,
  PACK_JSON_VERSION_LAUNCHERS,
  PACK_JSON_VERSION_PULSE_SINKS,
  PACK_JSON_VERSION_SIGNALS,
  PACK_JSON_VERSION_UNDERLAYS,
  PACK_JSON_VERSION_V7,
  PACK_JSON_VERSION_V7_IDS,
  PACK_JSON_VERSION_V8,
  PACK_JSON_VERSION_V9,
  PACK_JSON_VERSION_V9_IDS,
  PACK_JSON_VERSION_V10,
  PACK_JSON_VERSION_V10_IDS,
  PACK_JSON_VERSION_V11,
  PACK_JSON_VERSION_V11_IDS
} from '../config/constants';
import { usesPulseSinkFormat, usesV7Ids } from '../core/signalLinks';
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

  it('writes version 1 unless a level carries cell edges, and then version 2', () => {
    const edged = { ...makeLevel('edged'), cellEdges: [{ x: 2, y: 2, sides: ['N' as const] }] };
    expect(JSON.parse(serializePack('N', [makeLevel('a')])).version).toBe(PACK_JSON_VERSION);
    expect(JSON.parse(serializePack('N', [makeLevel('a'), edged])).version).toBe(PACK_JSON_VERSION_CELL_EDGES);
    expect(serializePack('N', [makeLevel('a')])).not.toContain('cellEdges');
    // An empty list holds no edge: it writes version 1 like a level without the field.
    expect(JSON.parse(serializePack('N', [{ ...makeLevel('a'), cellEdges: [] }])).version).toBe(PACK_JSON_VERSION);
  });

  it('round-trips cell edges and reads both versions', () => {
    const edged = { ...makeLevel('edged'), cellEdges: [{ x: 2, y: 2, sides: ['N' as const, 'W' as const] }] };
    const result = parse(serializePack('Edges', [edged]));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.levels[0].cellEdges).toEqual(edged.cellEdges);
    const v1 = JSON.parse(serializePack('Plain', [makeLevel('a')]));
    expect(parse(JSON.stringify(v1))).toMatchObject({ ok: true });
  });

  it('writes version 3 only when a level carries underlays, and the highest feature present decides', () => {
    const hidden = { ...makeLevel('hidden'), underlays: [{ x: 2, y: 2, terrain: 'ice' }] };
    const edged = { ...makeLevel('edged'), cellEdges: [{ x: 2, y: 2, sides: ['N' as const] }] };
    expect(JSON.parse(serializePack('N', [makeLevel('a'), hidden])).version).toBe(PACK_JSON_VERSION_UNDERLAYS);
    expect(JSON.parse(serializePack('N', [edged, hidden])).version).toBe(PACK_JSON_VERSION_UNDERLAYS);
    expect(JSON.parse(serializePack('N', [makeLevel('a'), edged])).version).toBe(PACK_JSON_VERSION_CELL_EDGES);
    expect(JSON.parse(serializePack('N', [{ ...makeLevel('a'), underlays: [] }])).version).toBe(PACK_JSON_VERSION);
    expect(serializePack('N', [makeLevel('a'), edged])).not.toContain('underlays');
    expect(serializePack('N', [makeLevel('a')])).not.toContain('underlays');
  });

  it('keeps the bytes of a version 1 and a version 2 pack as they were before underlays', () => {
    const edged = { ...makeLevel('edged'), cellEdges: [{ x: 2, y: 2, sides: ['N' as const] }] };
    const v1 = serializePack('N', [makeLevel('a')]);
    const v2 = serializePack('N', [makeLevel('a'), edged]);
    expect(v1).toBe(JSON.stringify({ format: PACK_JSON_FORMAT, version: 1, name: 'N', levels: [makeLevel('a')] }, null, 2));
    expect(v2).toBe(JSON.stringify({ format: PACK_JSON_FORMAT, version: 2, name: 'N', levels: [makeLevel('a'), edged] }, null, 2));
  });

  it('round-trips underlays and reads versions 1 to 3', () => {
    const hidden = { ...makeLevel('hidden'), underlays: [{ x: 2, y: 2, terrain: 'ice' }] };
    hidden.terrain[2][2] = 'door_red';
    const result = parse(serializePack('Hidden', [hidden]));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.levels[0].underlays).toEqual(hidden.underlays);
    for (const version of [1, 2, 3]) {
      const file = { format: PACK_JSON_FORMAT, version, name: 'x', levels: [makeLevel('a')] };
      expect(parse(JSON.stringify(file))).toMatchObject({ ok: true });
    }
  });

  it('writes version 4 only when a level carries launcher links, keeps the older bytes, and reads versions 1 to 4', () => {
    const wired = makeLevel('wired');
    wired.terrain[2][2] = 'shot_trigger';
    wired.terrain[2][4] = 'shot_launcher_e';
    const linked = { ...wired, launcherLinks: [{ buttonX: 2, buttonY: 2, launcherX: 4, launcherY: 2 }] };
    const hidden = { ...makeLevel('hidden'), underlays: [{ x: 2, y: 2, terrain: 'ice' }] };
    expect(JSON.parse(serializePack('N', [makeLevel('a'), linked])).version).toBe(PACK_JSON_VERSION_LAUNCHERS);
    expect(JSON.parse(serializePack('N', [hidden, linked])).version).toBe(PACK_JSON_VERSION_LAUNCHERS);
    expect(JSON.parse(serializePack('N', [{ ...makeLevel('a'), launcherLinks: [] }])).version).toBe(PACK_JSON_VERSION);
    expect(serializePack('N', [makeLevel('a'), hidden])).not.toContain('launcherLinks');
    // The older versions are written exactly as before.
    expect(serializePack('N', [makeLevel('a'), hidden])).toBe(
      JSON.stringify({ format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION_UNDERLAYS, name: 'N', levels: [makeLevel('a'), hidden] }, null, 2)
    );
    const result = parse(serializePack('Wired', [linked]));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.levels[0].launcherLinks).toEqual(linked.launcherLinks);
    for (const version of [1, 2, 3, PACK_JSON_VERSION_LAUNCHERS]) {
      const file = { format: PACK_JSON_FORMAT, version, name: 'x', levels: [makeLevel('a')] };
      expect(parse(JSON.stringify(file))).toMatchObject({ ok: true });
    }
  });

  it('writes version 5 only when a level carries signal links, keeps the older bytes, and reads versions 1 to 5', () => {
    const wired = makeLevel('wired');
    wired.terrain[1][1] = 'laser_receiver_red';
    wired.terrain[3][3] = 'hold_door_red_closed';
    const signalLinks = [{ fromX: 1, fromY: 1, toX: 3, toY: 3, port: 'door' }];
    const linked = { ...wired, signalLinks };
    const launched = { ...makeLevel('launched'), launcherLinks: [{ buttonX: 2, buttonY: 2, launcherX: 4, launcherY: 2 }] };
    expect(JSON.parse(serializePack('N', [makeLevel('a'), linked])).version).toBe(PACK_JSON_VERSION_SIGNALS);
    expect(JSON.parse(serializePack('N', [launched, linked])).version).toBe(PACK_JSON_VERSION_SIGNALS);
    expect(JSON.parse(serializePack('N', [{ ...makeLevel('a'), signalLinks: [] }])).version).toBe(PACK_JSON_VERSION);
    // A pack without signal links is written exactly as before, in its own version.
    expect(JSON.parse(serializePack('N', [launched])).version).toBe(PACK_JSON_VERSION_LAUNCHERS);
    expect(serializePack('N', [makeLevel('a'), launched])).not.toContain('signalLinks');
    const result = parse(serializePack('Wired', [linked]));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.levels[0].signalLinks).toEqual(signalLinks);
    for (const version of [1, 2, 3, PACK_JSON_VERSION_LAUNCHERS, PACK_JSON_VERSION_SIGNALS]) {
      const file = { format: PACK_JSON_FORMAT, version, name: 'x', levels: [makeLevel('a')] };
      expect(parse(JSON.stringify(file))).toMatchObject({ ok: true });
    }
  });

  it('writes version 6 only for a pulse button or a link to a launcher or clone machine, and reads versions 1 to 6', () => {
    const wired = makeLevel('wired');
    wired.terrain[1][1] = 'signal_plate';
    wired.terrain[3][3] = 'hold_door_red_closed';
    const plateToDoor = { ...wired, signalLinks: [{ fromX: 1, fromY: 1, toX: 3, toY: 3 }] };
    // A v1 signal level is still written in version 5.
    expect(JSON.parse(serializePack('N', [plateToDoor])).version).toBe(PACK_JSON_VERSION_SIGNALS);

    const pulse = makeLevel('pulse');
    pulse.terrain[2][2] = 'signal_button';
    expect(JSON.parse(serializePack('N', [makeLevel('a'), pulse])).version).toBe(PACK_JSON_VERSION_PULSE_SINKS);

    const launched = makeLevel('launched');
    launched.terrain[1][1] = 'signal_plate';
    launched.terrain[3][3] = 'shot_launcher_e';
    const launchSignalLinks = [{ fromX: 1, fromY: 1, toX: 3, toY: 3 }];
    const edgeSink = { ...launched, signalLinks: launchSignalLinks };
    expect(JSON.parse(serializePack('N', [plateToDoor, edgeSink])).version).toBe(PACK_JSON_VERSION_PULSE_SINKS);

    const cloned = makeLevel('cloned');
    cloned.terrain[1][1] = 'signal_plate';
    cloned.terrain[3][3] = 'clone_machine';
    const clonerSink = { ...cloned, signalLinks: launchSignalLinks };
    expect(JSON.parse(serializePack('N', [clonerSink])).version).toBe(PACK_JSON_VERSION_PULSE_SINKS);

    const result = parse(serializePack('Edge', [edgeSink]));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.levels[0].signalLinks).toEqual(launchSignalLinks);

    // A pack that needs neither is written exactly as before.
    expect(serializePack('N', [plateToDoor])).toBe(
      JSON.stringify({ format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION_SIGNALS, name: 'N', levels: [plateToDoor] }, null, 2)
    );
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V11);
    // The check reads the shipped ids by name, so it holds without a tile lookup.
    expect(usesPulseSinkFormat(pulse, null)).toBe(true);
    expect(usesPulseSinkFormat(edgeSink, null)).toBe(true);
    expect(usesPulseSinkFormat(plateToDoor, null)).toBe(false);
    for (const version of [1, 2, 3, PACK_JSON_VERSION_LAUNCHERS, PACK_JSON_VERSION_SIGNALS, PACK_JSON_VERSION_PULSE_SINKS, PACK_JSON_VERSION_V7, PACK_JSON_VERSION_V8, PACK_JSON_VERSION_V9, PACK_JSON_VERSION_V10, PACK_JSON_VERSION_V11]) {
      const file = { format: PACK_JSON_FORMAT, version, name: 'x', levels: [makeLevel('a')] };
      expect(parse(JSON.stringify(file))).toMatchObject({ ok: true });
    }
  });

  it('refuses text that is not JSON, another format and a newer version', () => {
    expect(parse('{nope')).toEqual({ ok: false, error: 'malformed' });
    expect(parse('[]')).toEqual({ ok: false, error: 'format' });
    expect(parse(JSON.stringify({ format: 'other', version: 1, name: 'x', levels: [] }))).toEqual({
      ok: false,
      error: 'format'
    });
    const future = { format: PACK_JSON_FORMAT, version: PACK_JSON_MAX_VERSION + 1, name: 'x', levels: [makeLevel('a')] };
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

    it('strips bidirectional overrides and puts an imported author on one line', () => {
      const result = withLimits(file({ author: '\u202eAnn\nBob\u202c', description: 'a\u202eb\nc' }));
      expect(result.ok && result.author).toBe('Ann Bob');
      expect(result.ok && result.description).toBe('ab\nc');
    });

    it('ignores the fields when no limits are given', () => {
      const result = parse(file({ author: 'Ann' }));
      expect(result.ok && 'author' in result).toBe(false);
    });
  });
});

describe('pack format 7 id gate', () => {
  const version = (levels: CompiledLevel[]): number => JSON.parse(serializePack('N', levels)).version;

  it('writes version 7 for each scanned field and takes precedence over 6', () => {
    const terrain = makeLevel('t');
    terrain.terrain[1][1] = 'force_cycle';
    const underlay = { ...makeLevel('u'), underlays: [{ x: 2, y: 2, terrain: 'force_cycle' }] };
    const item = makeLevel('i');
    item.items[1][1] = 'ward';
    const entity = { ...makeLevel('e'), entities: [{ x: 1, y: 1, type: 'lurker', dir: 'S' as const }] };
    const clone = {
      ...makeLevel('c'),
      cloneLinks: [{ buttonX: 0, buttonY: 0, clonerX: 1, clonerY: 1, templateType: 'lurker_dormant', templateDir: 'S' as const }]
    };
    for (const level of [terrain, underlay, item, entity, clone]) {
      expect(usesV7Ids(level)).toBe(true);
      expect(version([level])).toBe(PACK_JSON_VERSION_V7);
    }
    const pulse = makeLevel('p');
    pulse.terrain[2][2] = 'signal_button';
    expect(version([pulse])).toBe(PACK_JSON_VERSION_PULSE_SINKS);
    expect(version([pulse, terrain])).toBe(PACK_JSON_VERSION_V7);
  });

  it('keeps v5 and v6 selection and skips CC3D levels', () => {
    const plain = makeLevel('a');
    expect(usesV7Ids(plain)).toBe(false);
    expect(version([plain])).toBe(PACK_JSON_VERSION);
    const signals = { ...makeLevel('s'), signalLinks: [{ fromX: 0, fromY: 0, toX: 1, toY: 1 }] };
    expect(version([signals])).toBe(PACK_JSON_VERSION_SIGNALS);
    const cc3d: CompiledLevel = { ...makeLevel('x'), ruleset: 'cc3d' };
    cc3d.terrain[1][1] = 'charge';
    cc3d.items[1][1] = 'ward';
    expect(usesV7Ids(cc3d)).toBe(false);
    expect(version([cc3d])).toBe(PACK_JSON_VERSION);
  });

  it('reads versions 7 to 11 and refuses version 12', () => {
    expect(PACK_JSON_MAX_VERSION).toBe(PACK_JSON_VERSION_V11);
    const sevenFile = { format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION_V7, name: 'x', levels: [makeLevel('a')] };
    expect(parse(JSON.stringify(sevenFile))).toMatchObject({ ok: true });
    const level = makeLevel('t');
    level.items[1][1] = 'charge';
    const written = parse(serializePack('N', [level]));
    expect(written).toMatchObject({ ok: true });
    if (written.ok) expect(written.levels[0].items[1][1]).toBe('charge');
    const future = { format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION_V11 + 1, name: 'x', levels: [level] };
    expect(parse(JSON.stringify(future))).toEqual({ ok: false, error: 'version' });
  });

  it('has every id of the gate in the shipped configs', () => {
    const bundle = loadTestConfigs() as unknown as {
      tiles: { tiles: Record<string, unknown> | Array<{ id: string }> };
      monsters: { entities: Record<string, unknown> };
    };
    const tileIds = Array.isArray(bundle.tiles.tiles)
      ? bundle.tiles.tiles.map((t) => t.id)
      : Object.keys(bundle.tiles.tiles);
    const known = new Set([...tileIds, ...Object.keys(bundle.monsters.entities)]);
    const missing = [...PACK_JSON_VERSION_V7_IDS].filter((id) => !known.has(id)).sort();
    expect(missing).toEqual([]);
    expect([...PACK_JSON_VERSION_V9_IDS].filter((id) => !known.has(id))).toEqual([]);
    expect([...PACK_JSON_VERSION_V10_IDS].filter((id) => !known.has(id))).toEqual([]);
    expect([...PACK_JSON_VERSION_V11_IDS].filter((id) => !known.has(id))).toEqual([]);
  });
});
