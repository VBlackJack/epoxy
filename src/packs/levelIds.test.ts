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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { BUILTIN_PACK_IDS, LEVEL_ID_SEPARATOR } from '../config/constants';
import { LevelPack } from '../core/types';
import { resolveSavedLevel } from '../storage/persistedState';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel, makeUserPack } from '../test/packFixtures';
import { dedupeLevelIdsAcrossPacks, scopedLevelId, scopeLevelIds } from './levelIds';

const ids = (pack: LevelPack) => pack.levels.map((l) => l.id);

describe('scopeLevelIds', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('prefixes every id with the pack id and the separator', () => {
    const scoped = scopeLevelIds([makeLevel('a'), makeLevel('b')], 'pack_x');
    expect(scoped.map((l) => l.id)).toEqual([`pack_x${LEVEL_ID_SEPARATOR}a`, `pack_x${LEVEL_ID_SEPARATOR}b`]);
  });

  it('leaves a level without an id alone', () => {
    const blank = { ...makeLevel('a'), id: '' };
    expect(scopeLevelIds([blank], 'p')[0].id).toBe('');
  });
});

describe('importing the same file twice', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await LevelPackStorage.closeConnection();
  });

  it('gives each imported pack its own level ids', async () => {
    const decoded = () => [makeLevel('cclp9_level_1'), makeLevel('cclp9_level_2')];
    const first = await ConfigRegistry.registerImportedPack('cclp9', decoded());
    const second = await ConfigRegistry.registerImportedPack('cclp9', decoded());
    const all = [...ids(first.pack), ...ids(second.pack)];
    expect(new Set(all).size).toBe(4);
  });

  it('does not collide with a built-in pack when the file is named like it', async () => {
    const builtIn = new Set(
      ConfigRegistry.getAllPacks()
        .filter((p) => p.builtIn === true)
        .flatMap((p) => p.levels.map((l) => l.id))
    );
    expect(builtIn.size).toBeGreaterThan(0);
    const clash = [...builtIn].slice(0, 2).map((id) => makeLevel(id));
    const { pack } = await ConfigRegistry.registerImportedPack('cclp1', clash);
    for (const id of ids(pack)) expect(builtIn.has(id)).toBe(false);
  });
});

describe('dedupeLevelIdsAcrossPacks', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const builtIn = (): LevelPack => ({ ...makeUserPack('epoxy_campaign', ['b1', 'b2']), builtIn: true });

  it('lets the first stored holder keep its ids and scopes the later one', () => {
    const a = makeUserPack('pack_a', ['x', 'y']);
    const b = makeUserPack('pack_b', ['x', 'y']);
    const { packs, changed } = dedupeLevelIdsAcrossPacks([], [a, b]);
    expect(packs[0]).toBe(a);
    expect(ids(packs[1])).toEqual([scopedLevelId('pack_b', 'x'), scopedLevelId('pack_b', 'y')]);
    expect(changed).toEqual([packs[1]]);
  });

  it('renames only the colliding levels', () => {
    const a = makeUserPack('pack_a', ['x']);
    const b = makeUserPack('pack_b', ['x', 'z']);
    const { packs } = dedupeLevelIdsAcrossPacks([], [a, b]);
    expect(ids(packs[1])).toEqual([scopedLevelId('pack_b', 'x'), 'z']);
  });

  it('always lets a built-in pack keep its ids', () => {
    const imported = makeUserPack('pack_c', ['b1', 'other']);
    const { packs, changed } = dedupeLevelIdsAcrossPacks([builtIn()], [imported]);
    expect(ids(packs[0])).toEqual([scopedLevelId('pack_c', 'b1'), 'other']);
    expect(changed).toHaveLength(1);
  });

  it('is idempotent', () => {
    const stored = [makeUserPack('pack_a', ['x']), makeUserPack('pack_b', ['x']), makeUserPack('pack_c', ['x'])];
    const once = dedupeLevelIdsAcrossPacks([builtIn()], stored);
    const twice = dedupeLevelIdsAcrossPacks([builtIn()], once.packs);
    expect(twice.changed).toEqual([]);
    expect(new Set(once.packs.flatMap(ids)).size).toBe(3);
  });
});

describe('loading stored packs with duplicate level ids', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await LevelPackStorage.closeConnection();
  });

  it('renames the later pack, persists it and is stable on the next load', async () => {
    const fake = new FakeIndexedDb();
    vi.stubGlobal('indexedDB', fake);
    expect(await LevelPackStorage.savePack(makeUserPack('pack_a', ['dup_1', 'dup_2']))).toBe(true);
    expect(await LevelPackStorage.savePack(makeUserPack('pack_b', ['dup_1', 'dup_2']))).toBe(true);
    const order = (await LevelPackStorage.loadAllPacks())?.map((p) => p.id) ?? [];
    const [first, second] = order;

    await ConfigRegistry.loadStoredPacks();
    const packs = ConfigRegistry.getEditablePacks();
    const held = packs.flatMap(ids);
    expect(new Set(held).size).toBe(4);
    expect(ids(packs.find((p) => p.id === first)!)).toEqual(['dup_1', 'dup_2']);
    const stored = fake.records.get(second) as LevelPack;
    expect(stored.levels.map((l) => l.id)).toEqual([scopedLevelId(second, 'dup_1'), scopedLevelId(second, 'dup_2')]);

    await ConfigRegistry.loadStoredPacks();
    expect(ConfigRegistry.getEditablePacks().flatMap(ids)).toEqual(held);
  });

  it('keeps a save slot of a renamed level resolvable through its index', () => {
    const renamed = [scopedLevelId('pack_b', 'dup_1'), scopedLevelId('pack_b', 'dup_2')].map((id) => ({ id }));
    const saved = { packId: 'pack_b', levelId: 'dup_2', levelIndex: 1 };
    expect(resolveSavedLevel(saved, 'pack_b', renamed)).toBe(1);
  });
});

describe('level ids with the legacy migration, ultimate packs and JSON packs', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await LevelPackStorage.closeConnection();
  });

  it('does not append a legacy level again once the dedupe renamed it', async () => {
    const fake = new FakeIndexedDb();
    vi.stubGlobal('indexedDB', fake);
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      // The legacy key survives every start.
      removeItem: () => {
        throw new Error('blocked');
      }
    });
    await LevelPackStorage.savePack(makeUserPack('a_first', ['level_3']));
    await LevelPackStorage.savePack(makeUserPack(BUILTIN_PACK_IDS.CUSTOM, ['level_3']));
    store.set(
      ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.customLevelsKey),
      JSON.stringify([makeLevel('level_3')])
    );

    await ConfigRegistry.loadStoredPacks();
    const custom = () => ConfigRegistry.getAllPacks().find((p) => p.id === BUILTIN_PACK_IDS.CUSTOM)!;
    const afterFirst = ids(custom());
    expect(afterFirst).toEqual([scopedLevelId(BUILTIN_PACK_IDS.CUSTOM, 'level_3')]);
    await ConfigRegistry.loadStoredPacks();
    expect(ids(custom())).toEqual(afterFirst);
  });

  it('keeps the ids of a built-in ultimate pack and renames a stored copy', async () => {
    const fake = new FakeIndexedDb();
    vi.stubGlobal('indexedDB', fake);
    const holder = ConfigRegistry as unknown as { ultimatePacks: LevelPack[] };
    holder.ultimatePacks = [{ ...makeUserPack('cclp1', ['cclp1_level_1']), builtIn: true }];
    await LevelPackStorage.savePack(makeUserPack('a_copy', ['cclp1_level_1']));
    try {
      await ConfigRegistry.loadStoredPacks();
      const packs = ConfigRegistry.getAllPacks();
      expect(ids(packs.find((p) => p.id === 'cclp1')!)).toEqual(['cclp1_level_1']);
      expect(ids(packs.find((p) => p.id === 'a_copy')!)).toEqual([scopedLevelId('a_copy', 'cclp1_level_1')]);
    } finally {
      holder.ultimatePacks = [];
    }
  });

  it('does not prefix ids again when asked not to scope them', async () => {
    const { pack } = await ConfigRegistry.registerImportedPack('json', [makeLevel('already_unique')], {
      scopeIds: false
    });
    expect(ids(pack)).toEqual(['already_unique']);
  });
});
