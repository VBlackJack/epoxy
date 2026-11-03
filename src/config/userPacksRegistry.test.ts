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
 * The library of user packs held by the registry: migration of the legacy
 * localStorage custom levels, and every public operation on stored packs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LevelPack } from '../core/types';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel, makeUserPack } from '../test/packFixtures';
import { ConfigRegistry } from './ConfigRegistry';
import { BUILTIN_PACK_IDS, CUSTOM_PACK_I18N_KEY, USER_PACK_ID_PREFIX } from './constants';

const fake = new FakeIndexedDb();
let store: Map<string, string>;

function lsKey(suffix: string): string {
  return ConfigRegistry.getStorageKey(suffix);
}
const legacyKey = () => lsKey(ConfigRegistry.getGame().storage.customLevelsKey);
const backupKey = () => lsKey(ConfigRegistry.getGame().storage.customLevelsBackupKey);

function packOf(packId: string): LevelPack | undefined {
  return ConfigRegistry.getAllPacks().find((p) => p.id === packId);
}
const idsOf = (packId: string) => packOf(packId)?.levels.map((l) => l.id);
const numbersOf = (packId: string) => packOf(packId)?.levels.map((l) => l.number);
const stored = (packId: string) => fake.records.get(packId) as LevelPack | undefined;

beforeEach(() => {
  loadTestConfigs();
  fake.records.clear();
  fake.abortWrites = false;
  fake.abortReads = false;
  store = new Map();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('migration of the legacy custom levels', () => {
  it('moves the localStorage levels into the custom pack and removes the legacy key', async () => {
    store.set(legacyKey(), JSON.stringify([makeLevel('custom_1'), makeLevel('custom_2')]));
    await ConfigRegistry.loadStoredPacks();

    expect(stored(BUILTIN_PACK_IDS.CUSTOM)?.levels.map((l) => l.id)).toEqual(['custom_1', 'custom_2']);
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)).toMatchObject({ userCreated: true, i18nKey: CUSTOM_PACK_I18N_KEY });
    expect(store.has(legacyKey())).toBe(false);
    expect(store.has(backupKey())).toBe(false);

    // The saved active pack id still resolves to a playable pack.
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.CUSTOM);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CUSTOM);
    expect(ConfigRegistry.getLevels().map((l) => l.id)).toEqual(['custom_1', 'custom_2']);
  });

  it('lets the stored pack win per level id and appends the legacy levels it lacks', async () => {
    fake.records.set(BUILTIN_PACK_IDS.CUSTOM, {
      ...makeUserPack(BUILTIN_PACK_IDS.CUSTOM, ['a', 'b']),
      levels: [makeLevel('a'), { ...makeLevel('b'), customTitle: 'From IDB' }]
    });
    store.set(
      legacyKey(),
      JSON.stringify([{ ...makeLevel('b'), customTitle: 'From LS' }, makeLevel('c')])
    );
    await ConfigRegistry.loadStoredPacks();

    expect(idsOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual(['a', 'b', 'c']);
    expect(numbersOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual([1, 2, 3]);
    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)?.levels[1].customTitle).toBe('From IDB');
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)?.levels).toHaveLength(3);
    expect(store.has(legacyKey())).toBe(false);
  });

  it('is idempotent: a second run, even with the legacy list back, changes nothing', async () => {
    store.set(legacyKey(), JSON.stringify([makeLevel('c1')]));
    await ConfigRegistry.loadStoredPacks();
    const first = structuredClone(stored(BUILTIN_PACK_IDS.CUSTOM));

    await ConfigRegistry.loadStoredPacks();
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)).toEqual(first);

    store.set(legacyKey(), JSON.stringify([makeLevel('c1')]));
    await ConfigRegistry.loadStoredPacks();
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)).toEqual(first);
    expect(store.has(legacyKey())).toBe(false);
  });

  it('keeps localStorage untouched and the levels playable when the write aborts', async () => {
    const raw = JSON.stringify([makeLevel('c1')]);
    store.set(legacyKey(), raw);
    fake.abortWrites = true;
    await ConfigRegistry.loadStoredPacks();

    expect(store.get(legacyKey())).toBe(raw);
    expect(fake.records.has(BUILTIN_PACK_IDS.CUSTOM)).toBe(false);
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.CUSTOM);
    expect(ConfigRegistry.getLevels().map((l) => l.id)).toEqual(['c1']);

    // The next start, with a healthy store, completes the move.
    fake.abortWrites = false;
    await ConfigRegistry.loadStoredPacks();
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)?.levels).toHaveLength(1);
    expect(store.has(legacyKey())).toBe(false);
  });

  it('keeps localStorage as the custom store when IndexedDB is unreadable', async () => {
    fake.records.set('pack_imported', makeUserPack('pack_imported', ['i1']));
    store.set(legacyKey(), JSON.stringify([makeLevel('c1')]));
    fake.abortReads = true;
    await ConfigRegistry.loadStoredPacks();

    // Nothing is removed and the unreadable library is not taken for an empty one.
    expect(store.has(legacyKey())).toBe(true);
    expect(fake.records.has('pack_imported')).toBe(true);
    expect(fake.records.has(BUILTIN_PACK_IDS.CUSTOM)).toBe(false);
    expect(idsOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual(['c1']);

    const result = await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('c2'));
    expect(result.persisted).toBe(true);
    expect((JSON.parse(store.get(legacyKey()) ?? '[]') as { id: string }[]).map((l) => l.id)).toEqual(['c1', 'c2']);
    expect(fake.records.has(BUILTIN_PACK_IDS.CUSTOM)).toBe(false);
  });

  it('copies the raw text to the backup key when entries could not be kept', async () => {
    const raw = JSON.stringify([makeLevel('good'), { id: 'broken' }]);
    store.set(legacyKey(), raw);
    await ConfigRegistry.loadStoredPacks();

    expect(idsOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual(['good']);
    expect(store.get(backupKey())).toBe(raw);
    expect(store.has(legacyKey())).toBe(false);
  });

  it('backs up the dropped legacy entries before the first write in the legacy store', async () => {
    const raw = JSON.stringify([makeLevel('good'), { id: 'broken' }]);
    store.set(legacyKey(), raw);
    fake.abortReads = true;
    await ConfigRegistry.loadStoredPacks();
    expect(store.get(backupKey())).toBe(raw);
    expect(store.get(legacyKey())).toBe(raw);

    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('next'));
    expect(store.get(backupKey())).toBe(raw);
    expect((JSON.parse(store.get(legacyKey()) ?? '[]') as { id: string }[]).map((l) => l.id)).toEqual([
      'good',
      'next'
    ]);
  });

  it('does not overwrite the legacy list when its backup could not be written', async () => {
    const raw = JSON.stringify([makeLevel('good'), { id: 'broken' }]);
    store.set(legacyKey(), raw);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === backupKey()) throw new Error('quota exceeded');
        store.set(key, value);
      },
      removeItem: (key: string) => void store.delete(key)
    });
    fake.abortReads = true;
    await ConfigRegistry.loadStoredPacks();

    const result = await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('next'));
    expect(result.persisted).toBe(false);
    expect(store.get(legacyKey())).toBe(raw);
    expect(idsOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual(['good', 'next']);
  });

  it('backs up the legacy list when the stored pack wins over a different version of a level', async () => {
    fake.records.set(BUILTIN_PACK_IDS.CUSTOM, {
      ...makeUserPack(BUILTIN_PACK_IDS.CUSTOM, []),
      levels: [{ ...makeLevel('a'), customTitle: 'From IDB' }]
    });
    const raw = JSON.stringify([{ ...makeLevel('a'), customTitle: 'From LS' }]);
    store.set(legacyKey(), raw);
    await ConfigRegistry.loadStoredPacks();

    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)?.levels[0].customTitle).toBe('From IDB');
    expect(store.get(backupKey())).toBe(raw);
    expect(store.has(legacyKey())).toBe(false);
  });

  it('writes no backup when the legacy levels equal the stored ones', async () => {
    fake.records.set(BUILTIN_PACK_IDS.CUSTOM, {
      ...makeUserPack(BUILTIN_PACK_IDS.CUSTOM, []),
      levels: [{ ...makeLevel('a'), number: 1 }]
    });
    store.set(legacyKey(), JSON.stringify([{ ...makeLevel('a'), number: 4 }]));
    await ConfigRegistry.loadStoredPacks();
    expect(store.has(backupKey())).toBe(false);
    expect(store.has(legacyKey())).toBe(false);
  });

  it('backs up a legacy value that is not even a list', async () => {
    store.set(legacyKey(), '{not json');
    await ConfigRegistry.loadStoredPacks();
    expect(store.get(backupKey())).toBe('{not json');
    expect(store.has(legacyKey())).toBe(false);
    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)).toBeUndefined();
  });

  it('does nothing when there is no legacy list', async () => {
    await ConfigRegistry.loadStoredPacks();
    expect(fake.records.size).toBe(0);
    expect(store.size).toBe(0);
  });

  it('loads a stored library that holds imported and user packs side by side', async () => {
    fake.records.set('pack_imported', { ...makeUserPack('pack_imported', ['i1']), userCreated: undefined });
    fake.records.set('user_pack_9', { ...makeUserPack('user_pack_9', []), levels: [] });
    await ConfigRegistry.loadStoredPacks();
    expect(packOf('pack_imported')).toBeDefined();
    expect(packOf('user_pack_9')?.levels).toEqual([]);
    expect(ConfigRegistry.getEditablePacks().map((p) => p.id).sort()).toEqual(['pack_imported', 'user_pack_9']);
  });
});

describe('operations on the library', () => {
  it('creates a named pack, persists it and keeps it out of play while empty', async () => {
    const result = await ConfigRegistry.createUserPack('  Mine ');
    expect(result.ok && result.persisted).toBe(true);
    const id = result.pack?.id ?? '';
    expect(id.startsWith(USER_PACK_ID_PREFIX)).toBe(true);
    expect(stored(id)).toMatchObject({ name: 'Mine', userCreated: true, levels: [] });
    expect(ConfigRegistry.isEditablePack(id)).toBe(true);
    expect(ConfigRegistry.getEditablePacks().map((p) => p.id)).toContain(id);

    ConfigRegistry.setActivePackId(id);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
  });

  it('refuses a blank pack name', async () => {
    expect(await ConfigRegistry.createUserPack('  ')).toEqual({ ok: false, persisted: false });
  });

  it('gives two packs created in the same millisecond different ids', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(5000);
    const a = await ConfigRegistry.createUserPack('A');
    const b = await ConfigRegistry.createUserPack('B');
    now.mockRestore();
    expect(a.pack?.id).not.toBe(b.pack?.id);
  });

  it('renames a pack and drops the label of the custom pack', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('x'));
    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)?.i18nKey).toBe(CUSTOM_PACK_I18N_KEY);
    const result = await ConfigRegistry.renamePack(BUILTIN_PACK_IDS.CUSTOM, 'My levels');
    expect(result).toMatchObject({ ok: true, persisted: true });
    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)).toMatchObject({ name: 'My levels' });
    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)?.i18nKey).toBeUndefined();
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)?.name).toBe('My levels');
    expect((await ConfigRegistry.renamePack('missing', 'x')).ok).toBe(false);
    expect((await ConfigRegistry.renamePack(BUILTIN_PACK_IDS.CAMPAIGN, 'x')).ok).toBe(false);
  });

  it('creates the custom pack on the first save and updates levels by id afterwards', async () => {
    const first = await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    expect(first).toMatchObject({ ok: true, persisted: true, index: 0 });
    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)).toMatchObject({ userCreated: true, builtIn: false });
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('b'));
    const update = await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, {
      ...makeLevel('a'),
      customTitle: 'Edited'
    });
    expect(update.index).toBe(0);
    expect(idsOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual(['a', 'b']);
    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)?.levels[0].customTitle).toBe('Edited');
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)?.levels[0].customTitle).toBe('Edited');
  });

  it('numbers a new level from the target pack, not from the active one', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    const { pack } = await ConfigRegistry.createUserPack('Other');
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.CAMPAIGN);
    await ConfigRegistry.saveLevelToPack(pack?.id ?? '', { ...makeLevel('z'), number: 99 });
    expect(numbersOf(pack?.id ?? '')).toEqual([1]);
    expect(numbersOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual([1]);
  });

  it('refuses to save into a pack that does not exist or is built in', async () => {
    expect((await ConfigRegistry.saveLevelToPack('missing', makeLevel('a'))).ok).toBe(false);
    expect((await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CAMPAIGN, makeLevel('a'))).ok).toBe(false);
    expect(ConfigRegistry.isEditablePack(BUILTIN_PACK_IDS.CAMPAIGN)).toBe(false);
  });

  it('removes a level, and falls back to the campaign when that empties the active pack', async () => {
    const { pack } = await ConfigRegistry.createUserPack('P');
    const id = pack?.id ?? '';
    await ConfigRegistry.saveLevelToPack(id, makeLevel('a'));
    await ConfigRegistry.saveLevelToPack(id, makeLevel('b'));
    ConfigRegistry.setActivePackId(id);

    expect(await ConfigRegistry.removeLevelFromPack(id, 'a')).toMatchObject({ ok: true, persisted: true });
    expect(numbersOf(id)).toEqual([1]);
    expect(ConfigRegistry.getActivePackId()).toBe(id);

    await ConfigRegistry.removeLevelFromPack(id, 'b');
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
    expect(stored(id)?.levels).toEqual([]);
    expect(packOf(id)).toBeDefined();
    expect(store.get(lsKey(ConfigRegistry.getGame().storage.activePackKey))).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
    expect((await ConfigRegistry.removeLevelFromPack(id, 'gone')).ok).toBe(false);
  });

  it('reorders levels inside a pack', async () => {
    const { pack } = await ConfigRegistry.createUserPack('P');
    const id = pack?.id ?? '';
    for (const levelId of ['a', 'b', 'c']) await ConfigRegistry.saveLevelToPack(id, makeLevel(levelId));
    expect(await ConfigRegistry.moveLevelInPack(id, 2, 0)).toMatchObject({ ok: true, persisted: true });
    expect(idsOf(id)).toEqual(['c', 'a', 'b']);
    expect(numbersOf(id)).toEqual([1, 2, 3]);
    expect(stored(id)?.levels.map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect((await ConfigRegistry.moveLevelInPack(id, 0, 9)).ok).toBe(false);
  });

  it('duplicates a level after its source under an id no pack holds', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('b'));
    const result = await ConfigRegistry.duplicateLevelInPack(BUILTIN_PACK_IDS.CUSTOM, 'a');
    expect(result.ok).toBe(true);
    expect(idsOf(BUILTIN_PACK_IDS.CUSTOM)?.[1]).toBe(result.level?.id);
    expect(result.level?.id).not.toBe('a');
    expect(numbersOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual([1, 2, 3]);
    expect((await ConfigRegistry.duplicateLevelInPack(BUILTIN_PACK_IDS.CUSTOM, 'gone')).ok).toBe(false);
  });

  it('copies a level to another pack, from a stored or a built-in pack', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a', { ruleset: 'lynx' }));
    const { pack } = await ConfigRegistry.createUserPack('Dest');
    const destId = pack?.id ?? '';

    const copy = await ConfigRegistry.copyLevelToPack(BUILTIN_PACK_IDS.CUSTOM, 'a', destId);
    expect(copy).toMatchObject({ ok: true, persisted: true });
    expect(copy.level).toMatchObject({ ruleset: 'lynx', number: 1 });
    expect(copy.level?.id).not.toBe('a');
    expect(idsOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual(['a']);

    const campaignFirst = ConfigRegistry.getLevels()[0].id;
    const fromCampaign = await ConfigRegistry.copyLevelToPack(BUILTIN_PACK_IDS.CAMPAIGN, campaignFirst, destId);
    expect(fromCampaign.ok).toBe(true);
    expect(numbersOf(destId)).toEqual([1, 2]);
    expect((await ConfigRegistry.copyLevelToPack(BUILTIN_PACK_IDS.CUSTOM, 'a', BUILTIN_PACK_IDS.CAMPAIGN)).ok).toBe(false);
  });

  it('moves a level to another pack and empties the source pack for good', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    const { pack } = await ConfigRegistry.createUserPack('Dest');
    const destId = pack?.id ?? '';
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.CUSTOM);

    const moved = await ConfigRegistry.moveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, 'a', destId);
    expect(moved).toMatchObject({ ok: true, persisted: true });
    expect(idsOf(destId)).toEqual(['a']);
    expect(stored(destId)?.levels).toHaveLength(1);
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)?.levels).toEqual([]);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
  });

  it('renames a moved level when the destination already holds its id', async () => {
    const { pack } = await ConfigRegistry.createUserPack('Dest');
    const destId = pack?.id ?? '';
    await ConfigRegistry.saveLevelToPack(destId, makeLevel('a'));
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    const moved = await ConfigRegistry.moveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, 'a', destId);
    expect(moved.level?.id).toBe('a_2');
    expect(idsOf(destId)).toEqual(['a', 'a_2']);
  });

  it('does not lose a save into the source pack made while a move is being written', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('b'));
    const { pack } = await ConfigRegistry.createUserPack('Dest');
    const destId = pack?.id ?? '';

    const moving = ConfigRegistry.moveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, 'a', destId);
    // Started while the first write of the move is still pending.
    const saving = ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('c'));
    await Promise.all([moving, saving]);

    expect(idsOf(BUILTIN_PACK_IDS.CUSTOM)).toEqual(['b', 'c']);
    expect(stored(BUILTIN_PACK_IDS.CUSTOM)?.levels.map((l) => l.id)).toEqual(['b', 'c']);
    expect(stored(destId)?.levels.map((l) => l.id)).toEqual(['a']);
  });

  it('does not lose a save into the destination pack made while a copy is being written', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    const { pack } = await ConfigRegistry.createUserPack('Dest');
    const destId = pack?.id ?? '';

    const copying = ConfigRegistry.copyLevelToPack(BUILTIN_PACK_IDS.CUSTOM, 'a', destId);
    const saving = ConfigRegistry.saveLevelToPack(destId, makeLevel('z'));
    await Promise.all([copying, saving]);

    expect(idsOf(destId)).toHaveLength(2);
    expect(stored(destId)?.levels).toHaveLength(2);
    expect(stored(destId)?.levels.map((l) => l.id)).toContain('z');
  });

  it('keeps level ids unique across the whole library', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    const { pack } = await ConfigRegistry.createUserPack('Dest');
    const destId = pack?.id ?? '';
    const now = vi.spyOn(Date, 'now').mockReturnValue(8000);
    await ConfigRegistry.duplicateLevelInPack(BUILTIN_PACK_IDS.CUSTOM, 'a');
    await ConfigRegistry.copyLevelToPack(BUILTIN_PACK_IDS.CUSTOM, 'a', destId);
    await ConfigRegistry.copyLevelToPack(BUILTIN_PACK_IDS.CUSTOM, 'a', destId);
    now.mockRestore();
    const all = ConfigRegistry.getAllPacks()
      .filter((p) => ConfigRegistry.isEditablePack(p.id))
      .flatMap((p) => p.levels.map((l) => l.id));
    expect(all).toHaveLength(4);
    expect(new Set(all).size).toBe(4);
  });

  it('deletes any non-built-in pack and falls back to the campaign when it was active', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    ConfigRegistry.setActivePackId(BUILTIN_PACK_IDS.CUSTOM);
    expect(await ConfigRegistry.deletePack(BUILTIN_PACK_IDS.CUSTOM)).toEqual({ ok: true, persisted: true });
    expect(packOf(BUILTIN_PACK_IDS.CUSTOM)).toBeUndefined();
    expect(fake.records.has(BUILTIN_PACK_IDS.CUSTOM)).toBe(false);
    expect(ConfigRegistry.getActivePackId()).toBe(BUILTIN_PACK_IDS.CAMPAIGN);
    expect((await ConfigRegistry.deletePack(BUILTIN_PACK_IDS.CAMPAIGN)).ok).toBe(false);
    expect((await ConfigRegistry.deletePack('missing')).ok).toBe(false);
  });

  it('deleteImportedPack removes an imported pack and reports the write honestly', async () => {
    const { pack } = await ConfigRegistry.registerImportedPack('Imp', [makeLevel('i1')]);
    fake.abortWrites = true;
    const result = await ConfigRegistry.deleteImportedPack(pack.id);
    expect(result).toEqual({ ok: true, persisted: false });
    expect(packOf(pack.id)).toBeUndefined();
  });

  it('keeps the change in memory and reports persisted false when a write is refused', async () => {
    const { pack } = await ConfigRegistry.createUserPack('P');
    const id = pack?.id ?? '';
    fake.abortWrites = true;
    const save = await ConfigRegistry.saveLevelToPack(id, makeLevel('a'));
    expect(save).toMatchObject({ ok: true, persisted: false, index: 0 });
    expect(idsOf(id)).toEqual(['a']);
    expect((await ConfigRegistry.renamePack(id, 'N')).persisted).toBe(false);
    expect((await ConfigRegistry.createUserPack('Q')).persisted).toBe(false);
    expect((await ConfigRegistry.moveLevelInPack(id, 0, 0)).ok).toBe(false);
    expect((await ConfigRegistry.removeLevelFromPack(id, 'a')).persisted).toBe(false);
    expect(idsOf(id)).toEqual([]);
  });

  it('exports a pack and imports it back as a new pack with fresh level ids', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a', { ruleset: 'lynx' }));
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('b'));
    const text = ConfigRegistry.exportPackJson(BUILTIN_PACK_IDS.CUSTOM);
    expect(text).not.toBeNull();

    const result = await ConfigRegistry.importPackJson(text ?? '');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.persisted).toBe(true);
    expect(result.pack.id).not.toBe(BUILTIN_PACK_IDS.CUSTOM);
    expect(result.pack.levels).toHaveLength(2);
    expect(result.pack.levels[0].ruleset).toBe('lynx');
    expect(result.pack.levels.map((l) => l.id)).not.toContain('a');
    expect(stored(result.pack.id)?.levels).toHaveLength(2);
  });

  it('exports under the display name the caller passes, the pack name by default', async () => {
    await ConfigRegistry.saveLevelToPack(BUILTIN_PACK_IDS.CUSTOM, makeLevel('a'));
    const named = JSON.parse(ConfigRegistry.exportPackJson(BUILTIN_PACK_IDS.CUSTOM, 'Translated') ?? '{}');
    expect(named.name).toBe('Translated');
    const plain = JSON.parse(ConfigRegistry.exportPackJson(BUILTIN_PACK_IDS.CUSTOM) ?? '{}');
    expect(plain.name).toBe(packOf(BUILTIN_PACK_IDS.CUSTOM)?.name);
  });

  it('refuses an unknown file, an unknown pack and an empty pack on export', async () => {
    expect(await ConfigRegistry.importPackJson('{"format":"nope"}')).toEqual({ ok: false, error: 'format' });
    expect(ConfigRegistry.exportPackJson('missing')).toBeNull();
    const { pack } = await ConfigRegistry.createUserPack('Empty');
    expect(ConfigRegistry.exportPackJson(pack?.id ?? '')).toBeNull();
  });

  it('moves a level to an index, persists it, accepts the same place and refuses an unknown level', async () => {
    const { pack } = await ConfigRegistry.createUserPack('P');
    const id = pack?.id ?? '';
    for (const levelId of ['a', 'b', 'c']) await ConfigRegistry.saveLevelToPack(id, makeLevel(levelId));
    expect(await ConfigRegistry.moveLevelToIndex(id, 'a', 2)).toMatchObject({ ok: true, persisted: true });
    expect(idsOf(id)).toEqual(['b', 'c', 'a']);
    expect(numbersOf(id)).toEqual([1, 2, 3]);
    expect(stored(id)?.levels.map((l) => l.id)).toEqual(['b', 'c', 'a']);
    expect(await ConfigRegistry.moveLevelToIndex(id, 'a', 2)).toEqual({ ok: true, persisted: true });
    expect((await ConfigRegistry.moveLevelToIndex(id, 'a', 9)).ok).toBe(false);
    expect((await ConfigRegistry.moveLevelToIndex(id, 'gone', 0)).ok).toBe(false);
    expect((await ConfigRegistry.moveLevelToIndex('missing', 'a', 0)).ok).toBe(false);
  });

  it('reports a move that could not be stored as session only', async () => {
    const { pack } = await ConfigRegistry.createUserPack('P');
    const id = pack?.id ?? '';
    for (const levelId of ['a', 'b']) await ConfigRegistry.saveLevelToPack(id, makeLevel(levelId));
    fake.abortWrites = true;
    expect(await ConfigRegistry.moveLevelToIndex(id, 'a', 1)).toMatchObject({ ok: true, persisted: false });
    expect(idsOf(id)).toEqual(['b', 'a']);
  });

  it('sets, clamps, persists and clears the author and description of a pack', async () => {
    const { pack } = await ConfigRegistry.createUserPack('P');
    const id = pack?.id ?? '';
    const { authorMaxLength } = ConfigRegistry.getPackMetadataLimits();
    const result = await ConfigRegistry.setPackMetadata(id, { author: 'x'.repeat(authorMaxLength + 9), description: 'a\nb' });
    expect(result).toMatchObject({ ok: true, persisted: true });
    expect(packOf(id)?.author).toHaveLength(authorMaxLength);
    expect(stored(id)?.description).toBe('a\nb');
    await ConfigRegistry.setPackMetadata(id, { author: '' });
    expect(packOf(id) && 'author' in (packOf(id) as object)).toBe(false);
    expect(packOf(id)?.description).toBe('a\nb');
    expect((await ConfigRegistry.setPackMetadata('missing', { author: 'A' })).ok).toBe(false);
  });

  it('carries the metadata through export and import', async () => {
    const { pack } = await ConfigRegistry.createUserPack('P');
    const id = pack?.id ?? '';
    await ConfigRegistry.saveLevelToPack(id, makeLevel('a'));
    await ConfigRegistry.setPackMetadata(id, { author: 'Ann', description: 'Hello\nworld' });
    const result = await ConfigRegistry.importPackJson(ConfigRegistry.exportPackJson(id) ?? '');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack).toMatchObject({ author: 'Ann', description: 'Hello\nworld' });
    expect(stored(result.pack.id)).toMatchObject({ author: 'Ann', description: 'Hello\nworld' });
  });
});
