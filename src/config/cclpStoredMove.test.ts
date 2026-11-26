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
 * Stored packs imported from a .DAT file before community sets played the CCLP engine: they move when the library loads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { DEFAULT_RULESET } from '../core/coreConstants';
import { CompiledLevel, LevelPack, UltimatePackDescriptor } from '../core/types';
import { DatCodec } from '../formats/DatCodec';
import { scopeLevelIds } from '../packs/levelIds';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';
import { CCLP_IMPORT_RELEASE_MS } from './constants';
import { setCclpStoredPackMoveOverride } from './featureFlags';

const SIZE = 32;
const PACK_ID = `pack_synth_${CCLP_IMPORT_RELEASE_MS - 1}`;
const RECORD_KEY = 'cclp_stored_move';
const fake = new FakeIndexedDb();
let storage: Map<string, string>;

function synthLevel(n: number): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor')));
  const items: (string | null)[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  terrain[10][10 + n] = 'exit';
  items[3][3] = 'chip';
  return {
    id: `synth_level_${n}`,
    number: n,
    customTitle: `Synthetic ${n}`,
    customHint: '',
    password: `QW${n}ZX`,
    timeLimitSeconds: 50 + n,
    chipsRequired: 1,
    playerStart: { x: 2, y: 2, dir: 'S' },
    terrain,
    items,
    entities: [
      { type: 'bug', x: 20, y: 20, dir: 'N' },
      { type: 'dirt_block', x: 7, y: 7, dir: 'N' }
    ],
    trapLinks: [],
    cloneLinks: []
  };
}

function synthBytes(): ArrayBuffer {
  const encoded = DatCodec.encodeLevels([synthLevel(1), synthLevel(2), synthLevel(3)]);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

function storePack(ruleset: 'epoxy' | 'lynx'): LevelPack {
  const levels = DatCodec.decodeBuffer(synthBytes(), 'SYNTH', ruleset === 'epoxy' ? DEFAULT_RULESET : 'lynx');
  const pack: LevelPack = { id: PACK_ID, name: 'SYNTH', builtIn: false, levels: structuredClone(scopeLevelIds(levels, PACK_ID)) };
  fake.records.set(PACK_ID, structuredClone(pack));
  return pack;
}

/** Makes the synthetic set a bundled one, as loadAll does with the fetched packs. */
function holdSynthSet(): void {
  const descriptor: UltimatePackDescriptor = { id: 'ccup_synth', name: 'Synth', i18nKey: 'x', url: './packs/SYNTH.DAT', prefix: 'ref', ruleset: 'lynx', rulesProfile: 'cclp' };
  (ConfigRegistry as unknown as { bundledDatPacks: unknown[] }).bundledDatPacks = [{ descriptor, buffer: synthBytes() }];
}

const stored = () => fake.records.get(PACK_ID) as LevelPack;
const loaded = () => ConfigRegistry.getAllPacks().find((p) => p.id === PACK_ID) as LevelPack;
const moveRecord = () => storage.get(`${ConfigRegistry.getStorageKey(RECORD_KEY)}`);

beforeEach(() => {
  loadTestConfigs();
  (ConfigRegistry as unknown as { bundledDatPacks: unknown[] }).bundledDatPacks = [];
  (ConfigRegistry as unknown as { bundledDatMissing: boolean }).bundledDatMissing = false;
  fake.records.clear();
  fake.abortWrites = false;
  fake.abortReads = false;
  storage = new Map();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k)
  });
  setCclpStoredPackMoveOverride(true);
});

afterEach(async () => {
  setCclpStoredPackMoveOverride(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('load-time move of stored .DAT packs to the CCLP engine', () => {
  it('does nothing while the flag is off', async () => {
    setCclpStoredPackMoveOverride(false);
    const old = storePack('lynx');
    await ConfigRegistry.loadStoredPacks();
    expect(loaded().levels.every((l) => l.rulesProfile === undefined)).toBe(true);
    expect(stored().levels).toEqual(old.levels);
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
    expect(moveRecord()).toBeUndefined();
  });

  it('writes no record and decodes nothing when the library holds no stored pack', async () => {
    holdSynthSet();
    const decode = vi.spyOn(DatCodec, 'decodeBuffer');
    const setItem = vi.spyOn(localStorage, 'setItem');
    await ConfigRegistry.loadStoredPacks();
    expect(decode).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    expect(moveRecord()).toBeUndefined();
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
  });

  it('moves a classic pack of a bundled set once, keeps the level ids, and runs only once', async () => {
    holdSynthSet();
    const old = storePack('epoxy');
    await ConfigRegistry.loadStoredPacks();
    for (const pack of [loaded(), stored()]) {
      expect(pack.levels.map((l) => l.id)).toEqual(old.levels.map((l) => l.id));
      expect(pack.levels.every((l) => l.ruleset === 'lynx' && l.rulesProfile === 'cclp' && l.rulesFlavor === undefined)).toBe(true);
    }
    expect(ConfigRegistry.takeCclpMoveReport()).toEqual({ movedPacks: 1, keptPackIds: [] });
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
    expect(JSON.parse(moveRecord() as string)).toEqual({ version: 1, kept: [] });
    const decode = vi.spyOn(DatCodec, 'decodeBuffer');
    await ConfigRegistry.loadStoredPacks();
    expect(decode).not.toHaveBeenCalled();
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
  });

  it('moves an untouched plain Lynx pack of any set by giving it the CCLP rules', async () => {
    storePack('lynx');
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels.every((l) => l.rulesProfile === 'cclp')).toBe(true);
    expect(ConfigRegistry.takeCclpMoveReport()).toEqual({ movedPacks: 1, keptPackIds: [] });
  });

  it('keeps a classic pack of a set it does not hold and reports it on every start, from the record', async () => {
    const old = storePack('epoxy');
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels).toEqual(old.levels);
    expect(loaded().levels.every((l) => l.rulesFlavor === 'cc')).toBe(true);
    expect(ConfigRegistry.takeCclpMoveReport()).toEqual({ movedPacks: 0, keptPackIds: [PACK_ID] });
    expect(JSON.parse(moveRecord() as string)).toEqual({ version: 1, kept: [PACK_ID] });
    await ConfigRegistry.loadStoredPacks();
    expect(ConfigRegistry.takeCclpMoveReport()).toEqual({ movedPacks: 0, keptPackIds: [PACK_ID] });
  });

  it('keeps the stored pack when the write is refused and moves it on the next start', async () => {
    holdSynthSet();
    const old = storePack('epoxy');
    fake.abortWrites = true;
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels).toEqual(old.levels);
    expect(loaded().levels.every((l) => l.rulesFlavor === 'cc')).toBe(true);
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
    expect(moveRecord()).toBeUndefined();
    fake.abortWrites = false;
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels.every((l) => l.rulesProfile === 'cclp')).toBe(true);
    expect(ConfigRegistry.takeCclpMoveReport()).toEqual({ movedPacks: 1, keptPackIds: [] });
  });

  it('never overwrites a save another tab made after the library was read', async () => {
    holdSynthSet();
    storePack('epoxy');
    const read = LevelPackStorage.loadAllPacks.bind(LevelPackStorage);
    vi.spyOn(LevelPackStorage, 'loadAllPacks').mockImplementation(async () => {
      const packs = await read();
      const other = structuredClone(stored());
      other.levels[1].timeLimitSeconds = 777;
      fake.records.set(PACK_ID, other);
      return packs;
    });
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels[1].timeLimitSeconds).toBe(777);
    expect(stored().levels.every((l) => l.rulesFlavor === 'cc')).toBe(true);
    expect(loaded().levels.every((l) => l.rulesFlavor === 'cc')).toBe(true);
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
    expect(moveRecord()).toBeUndefined();
  });

  it('does not write back a pack whose stored record lost a level to validation', async () => {
    storePack('lynx');
    const raw = structuredClone(stored()) as unknown as { levels: Record<string, unknown>[] };
    raw.levels[1].terrain = 'broken';
    fake.records.set(PACK_ID, raw);
    await ConfigRegistry.loadStoredPacks();
    expect(loaded().levels).toHaveLength(2);
    expect((fake.records.get(PACK_ID) as typeof raw).levels[1].terrain).toBe('broken');
    expect((fake.records.get(PACK_ID) as LevelPack).levels.every((l) => l.rulesProfile === undefined)).toBe(true);
    expect(moveRecord()).toBeUndefined();
  });

  it('leaves a classic pack and writes no record while a bundled reference is missing, then moves it on the next start', async () => {
    const old = storePack('epoxy');
    // The set's bundled file failed to fetch: its stored copy would read as unknown, wrongly, and must neither move nor be told.
    (ConfigRegistry as unknown as { bundledDatMissing: boolean }).bundledDatMissing = true;
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels).toEqual(old.levels);
    expect(loaded().levels.every((l) => l.rulesFlavor === 'cc')).toBe(true);
    expect(moveRecord()).toBeUndefined();
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
    (ConfigRegistry as unknown as { bundledDatMissing: boolean }).bundledDatMissing = false;
    holdSynthSet();
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels.every((l) => l.rulesProfile === 'cclp')).toBe(true);
    expect(ConfigRegistry.takeCclpMoveReport()).toEqual({ movedPacks: 1, keptPackIds: [] });
    expect(JSON.parse(moveRecord() as string)).toEqual({ version: 1, kept: [] });
  });

  it('does not judge, record or notify when a bundled reference cannot be decoded', async () => {
    holdSynthSet();
    (ConfigRegistry as unknown as { bundledDatPacks: { buffer: ArrayBuffer }[] }).bundledDatPacks[0].buffer = new ArrayBuffer(3);
    const old = storePack('epoxy');
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels).toEqual(old.levels);
    expect(moveRecord()).toBeUndefined();
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
  });

  it('moves nothing and records nothing while the library cannot be read', async () => {
    holdSynthSet();
    const old = storePack('epoxy');
    fake.abortReads = true;
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels).toEqual(old.levels);
    expect(moveRecord()).toBeUndefined();
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
  });

  it('lets the app start, records nothing and retries when the move throws', async () => {
    holdSynthSet();
    const old = storePack('epoxy');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const replace = vi.spyOn(LevelPackStorage, 'replacePackIfUnchanged').mockRejectedValueOnce(new Error('boom'));
    await expect(ConfigRegistry.loadStoredPacks()).resolves.toBeUndefined();
    expect(stored().levels).toEqual(old.levels);
    expect(moveRecord()).toBeUndefined();
    expect(ConfigRegistry.takeCclpMoveReport()).toBeNull();
    replace.mockRestore();
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels.every((l) => l.rulesProfile === 'cclp')).toBe(true);
  });
});
