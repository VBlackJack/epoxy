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
import { FakeKeyedIndexedDb } from '../test/FakeKeyedIndexedDb';
import { Cc2SourceStorage } from './Cc2SourceStorage';

describe('Cc2SourceStorage', () => {
  const fake = new FakeKeyedIndexedDb();
  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);

  beforeAll(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = fake;
  });

  afterAll(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  beforeEach(() => {
    fake.records.clear();
    fake.abortWrites = false;
  });

  it('stores sources by hash and reads back the ones it holds', async () => {
    expect(await Cc2SourceStorage.putAll([{ sha256: HASH_A, bytes: Uint8Array.of(1, 2, 3) }])).toBe(true);
    const found = await Cc2SourceStorage.getMany([HASH_A, HASH_B]);
    expect(found?.map((r) => r.sha256)).toEqual([HASH_A]);
    expect(Array.from(found?.[0].bytes ?? [])).toEqual([1, 2, 3]);
  });

  it('removes sources', async () => {
    await Cc2SourceStorage.putAll([{ sha256: HASH_A, bytes: Uint8Array.of(1) }]);
    expect(await Cc2SourceStorage.deleteMany([HASH_A])).toBe(true);
    expect(await Cc2SourceStorage.getMany([HASH_A])).toEqual([]);
  });

  it('reports a write that did not commit', async () => {
    fake.abortWrites = true;
    expect(await Cc2SourceStorage.putAll([{ sha256: HASH_A, bytes: Uint8Array.of(1) }])).toBe(false);
  });

  it('has nothing to do for an empty list', async () => {
    expect(await Cc2SourceStorage.putAll([])).toBe(true);
    expect(await Cc2SourceStorage.getMany([])).toEqual([]);
  });
});
