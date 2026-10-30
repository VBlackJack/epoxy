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
import { loadTestConfigs } from '../test/loadTestConfigs';

interface FakeRequest {
  result?: unknown;
  error: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
}

interface FakeTransaction {
  error: unknown;
  oncomplete?: () => void;
  onabort?: () => void;
  onerror?: () => void;
  objectStore: () => unknown;
}

/** Just enough of IndexedDB for the storage service: one store, async callbacks. */
class FakeIndexedDb {
  public records = new Map<string, unknown>();
  public opens = 0;
  public abortWrites = false;

  public open(): FakeRequest {
    this.opens++;
    const req: FakeRequest = { error: null };
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: (_name: string, mode: string) => this.transaction(mode),
      close: () => undefined
    };
    queueMicrotask(() => {
      req.result = db;
      req.onsuccess?.();
    });
    return req;
  }

  private transaction(mode: string): FakeTransaction {
    const tx: FakeTransaction = { error: null, objectStore: () => store };
    const run = (work: () => unknown): FakeRequest => {
      const req: FakeRequest = { error: null };
      queueMicrotask(() => {
        req.result = work();
        req.onsuccess?.();
        queueMicrotask(() => {
          if (mode === 'readwrite' && this.abortWrites) {
            tx.error = new Error('QuotaExceededError');
            tx.onabort?.();
          } else {
            tx.oncomplete?.();
          }
        });
      });
      return req;
    };
    const store = {
      getAll: () => run(() => [...this.records.values()]),
      put: (value: { id: string }) =>
        run(() => {
          if (!this.abortWrites) this.records.set(value.id, value);
          return value.id;
        }),
      delete: (key: string) => run(() => this.records.delete(key))
    };
    return tx;
  }
}

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
  });

  it('saves, loads and deletes through one cached connection', async () => {
    expect(await LevelPackStorage.savePack(pack('alpha'))).toBe(true);
    const loaded = await LevelPackStorage.loadAllPacks();
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
    const loaded = await LevelPackStorage.loadAllPacks();
    expect(loaded.map((p) => p.id).sort()).toEqual(['small', 'wide']);
    expect(loaded.find((p) => p.id === 'wide')?.levels[0].terrain[0]).toHaveLength(40);
  });

  it('drops stored records that are not well-formed packs', async () => {
    fake.records.set('good', pack('good'));
    fake.records.set('no_levels', { id: 'no_levels', name: 'x', levels: 'nope' });
    fake.records.set('bad_level', { id: 'bad_level', name: 'x', levels: [{ id: 3 }] });
    fake.records.set('junk', 42);
    const loaded = await LevelPackStorage.loadAllPacks();
    expect(loaded.map((p) => p.id)).toEqual(['good']);
  });
});
