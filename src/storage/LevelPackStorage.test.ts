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

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LevelPackStorage } from './LevelPackStorage';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { LevelPack } from '../core/types';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';

function pack(id: string): LevelPack {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  return {
    id,
    name: id,
    builtIn: false,
    levels: [
      {
        id: `${id}_1`,
        number: 1,
        password: 'TEST',
        timeLimitSeconds: 0,
        chipsRequired: 0,
        playerStart: { x: 1, y: 1, dir: 'S' },
        terrain: Array.from({ length: mapHeight }, () => new Array<string>(mapWidth).fill('floor')),
        items: Array.from({ length: mapHeight }, () => new Array<string | null>(mapWidth).fill(null)),
        entities: [],
        trapLinks: [],
        cloneLinks: []
      }
    ]
  };
}

describe('LevelPackStorage', () => {
  const fake = new FakeIndexedDb();

  beforeAll(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = fake;
  });

  afterAll(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  beforeEach(() => {
    loadTestConfigs();
    fake.records.clear();
    fake.abortWrites = false;
    fake.abortReads = false;
  });

  it('saves, loads and deletes through one cached connection', async () => {
    expect(await LevelPackStorage.savePack(pack('alpha'))).toBe(true);
    const loaded = (await LevelPackStorage.loadAllPacks()) ?? [];
    expect(loaded.map((p) => p.id)).toEqual(['alpha']);
    expect(await LevelPackStorage.deletePack('alpha')).toBe(true);
    expect(await LevelPackStorage.loadAllPacks()).toEqual([]);
    expect(fake.opens).toBe(1);
  });

  it('reports an aborted write as a failure', async () => {
    fake.abortWrites = true;
    expect(await LevelPackStorage.savePack(pack('beta'))).toBe(false);
  });

  it('keeps stored levels of any rectangular size within the bounds', async () => {
    const small = pack('small');
    small.levels[0].terrain = Array.from({ length: 10 }, () => new Array<string>(10).fill('floor'));
    small.levels[0].items = Array.from({ length: 10 }, () => new Array<string | null>(10).fill(null));
    const wide = pack('wide');
    wide.levels[0].terrain = Array.from({ length: 30 }, () => new Array<string>(40).fill('floor'));
    wide.levels[0].items = Array.from({ length: 30 }, () => new Array<string | null>(40).fill(null));
    const ragged = pack('ragged');
    ragged.levels[0].terrain[4] = ragged.levels[0].terrain[4].slice(0, 5);
    fake.records.set('small', small);
    fake.records.set('wide', wide);
    fake.records.set('ragged', ragged);
    const loaded = (await LevelPackStorage.loadAllPacks()) ?? [];
    expect(loaded.map((p) => p.id).sort()).toEqual(['small', 'wide']);
    expect(loaded.find((p) => p.id === 'wide')?.levels[0].terrain[0]).toHaveLength(40);
  });

  it('keeps an empty pack the player created and drops an empty imported one', async () => {
    fake.records.set('mine', { id: 'mine', name: 'Mine', userCreated: true, levels: [] });
    fake.records.set('imported', { id: 'imported', name: 'Imp', levels: [] });
    const loaded = (await LevelPackStorage.loadAllPacks()) ?? [];
    expect(loaded.map((p) => p.id)).toEqual(['mine']);
    expect(loaded[0]).toMatchObject({ userCreated: true, builtIn: false, levels: [] });
  });

  it('loads a record written before the flag existed as an imported pack', async () => {
    fake.records.set('old', pack('old'));
    const [loaded] = (await LevelPackStorage.loadAllPacks()) ?? [];
    expect(loaded.id).toBe('old');
    expect('userCreated' in loaded).toBe(false);
    expect(loaded.levels).toHaveLength(1);
  });

  it('reports an unreadable library as null, not as an empty one', async () => {
    fake.abortReads = true;
    expect(await LevelPackStorage.loadAllPacks()).toBeNull();
  });

  it('drops stored records that are not well-formed packs', async () => {
    fake.records.set('good', pack('good'));
    fake.records.set('no_levels', { id: 'no_levels', name: 'x', levels: 'nope' });
    fake.records.set('bad_level', { id: 'bad_level', name: 'x', levels: [{ id: 3 }] });
    fake.records.set('junk', 42);
    const loaded = (await LevelPackStorage.loadAllPacks()) ?? [];
    expect(loaded.map((p) => p.id)).toEqual(['good']);
  });
});
