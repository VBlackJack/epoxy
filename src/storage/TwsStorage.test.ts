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

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTwsIndex, TwsLimits } from '../formats/TwsCodec';
import { FakeKeyedIndexedDb } from '../test/FakeKeyedIndexedDb';
import { twsFileBytes, twsSolutionRecord } from '../test/twsTestBytes';
import { TwsFiles } from './TwsFiles';
import { isStoredFile, TwsStorage } from './TwsStorage';

const LIMITS: TwsLimits = { maxFileBytes: 4096, maxSolutionTicks: 100000, maxSetNameChars: 64 };
const PACK = 'pack_a';
const OTHER_PACK = 'pack_b';
/** One fake for the whole file: the storage service keeps the database it first opened. */
const fake = new FakeKeyedIndexedDb();

function goodBytes(): Uint8Array {
  return twsFileBytes(1, [twsSolutionRecord({ number: 1, moves: [] })]);
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('TwsStorage', () => {
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

  it('puts a file and gets back the same bytes and name', async () => {
    const bytes = goodBytes();
    expect(await TwsStorage.put({ packId: PACK, fileName: 'mine.tws', bytes: arrayBufferOf(bytes), loadedAt: 5 })).toBe(true);
    const row = await TwsStorage.get(PACK);
    expect(row?.fileName).toBe('mine.tws');
    expect(row?.loadedAt).toBe(5);
    expect(Array.from(new Uint8Array(row?.bytes ?? new ArrayBuffer(0)))).toEqual(Array.from(bytes));
  });

  it('keeps the last file put for a pack', async () => {
    await TwsStorage.put({ packId: PACK, fileName: 'first.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 1 });
    await TwsStorage.put({ packId: PACK, fileName: 'second.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 2 });
    expect((await TwsStorage.get(PACK))?.fileName).toBe('second.tws');
    expect(fake.records.size).toBe(1);
  });

  it('deletes a file, and reads null after', async () => {
    await TwsStorage.put({ packId: PACK, fileName: 'mine.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 1 });
    expect(await TwsStorage.delete(PACK)).toBe(true);
    expect(await TwsStorage.get(PACK)).toBeNull();
  });

  it('reports a write that did not commit', async () => {
    fake.abortWrites = true;
    expect(await TwsStorage.put({ packId: PACK, fileName: 'mine.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 1 })).toBe(false);
  });

  it('deletes and ignores a stored row that is not a well formed file of the pack', async () => {
    const bad: unknown[] = [
      { packId: PACK, fileName: 'x.tws', bytes: 'not bytes', loadedAt: 1 },
      { packId: PACK, fileName: 7, bytes: new ArrayBuffer(4), loadedAt: 1 },
      { packId: OTHER_PACK, fileName: 'x.tws', bytes: new ArrayBuffer(4), loadedAt: 1 },
      'a string',
      null
    ];
    for (const row of bad) {
      fake.records.set(PACK, row);
      expect(await TwsStorage.get(PACK)).toBeNull();
      expect(fake.records.has(PACK)).toBe(false);
    }
  });

  it('judges a stored row', () => {
    expect(isStoredFile({ packId: PACK, fileName: 'x', bytes: new ArrayBuffer(1), loadedAt: 1 }, PACK)).toBe(true);
    expect(isStoredFile({ packId: PACK, fileName: 'x', bytes: new Uint8Array(1), loadedAt: 1 }, PACK)).toBe(false);
    expect(isStoredFile({ packId: PACK, fileName: 'x', bytes: new ArrayBuffer(1), loadedAt: 1 }, OTHER_PACK)).toBe(false);
  });

  it('reads null and refuses writes when the store is not available', async () => {
    // A fresh copy of the service, so it has no database cached from the tests above.
    vi.resetModules();
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    try {
      const { TwsStorage: unavailable } = await import('./TwsStorage');
      expect(await unavailable.get(PACK)).toBeNull();
      expect(await unavailable.put({ packId: PACK, fileName: 'x', bytes: new ArrayBuffer(1), loadedAt: 1 })).toBe(false);
      expect(await unavailable.delete(PACK)).toBe(false);
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = fake;
    }
  });
});

describe('TwsFiles', () => {
  beforeAll(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = fake;
  });

  afterAll(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  beforeEach(() => {
    fake.records.clear();
    fake.abortWrites = false;
    TwsFiles.resetForTests();
  });

  it('knows nothing of a pack until asked, then holds the state', async () => {
    expect(TwsFiles.peek(PACK)).toBeUndefined();
    const reading = TwsFiles.ensure(PACK, LIMITS);
    expect(TwsFiles.peek(PACK)).toEqual({ kind: 'loading' });
    expect(await reading).toEqual({ kind: 'none' });
    expect(TwsFiles.peek(PACK)).toEqual({ kind: 'none' });
  });

  it('reads a stored file once and parses it', async () => {
    await TwsStorage.put({ packId: PACK, fileName: 'mine.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 1 });
    const state = await TwsFiles.ensure(PACK, LIMITS);
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.fileName).toBe('mine.tws');
      expect(state.persisted).toBe(true);
      expect(state.index.entries.has(1)).toBe(true);
    }
    // Later asks never touch the store again.
    fake.records.clear();
    expect(await TwsFiles.ensure(PACK, LIMITS)).toBe(state);
  });

  it('shares one read between callers that ask while it runs', async () => {
    await TwsStorage.put({ packId: PACK, fileName: 'mine.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 1 });
    const first = TwsFiles.ensure(PACK, LIMITS);
    const second = TwsFiles.ensure(PACK, LIMITS);
    expect(second).toBe(first);
    await first;
  });

  it('turns a stored file the reader refuses into an error state that can be forgotten', async () => {
    await TwsStorage.put({ packId: PACK, fileName: 'mine.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 1 });
    const state = await TwsFiles.ensure(PACK, { ...LIMITS, maxFileBytes: 4 });
    expect(state).toEqual({ kind: 'error', fileName: 'mine.tws', code: 'too_large' });
    expect(await TwsFiles.forget(PACK)).toBe(true);
    expect(TwsFiles.peek(PACK)).toEqual({ kind: 'none' });
    expect(await TwsStorage.get(PACK)).toBeNull();
  });

  it('adopts a file: plays it at once, then marks it stored', async () => {
    const bytes = goodBytes();
    const index = parseTwsIndex(bytes, LIMITS);
    const stored = TwsFiles.adopt(PACK, 'mine.tws', bytes, index);
    expect(TwsFiles.peek(PACK)).toMatchObject({ kind: 'ready', fileName: 'mine.tws', persisted: false });
    expect(await stored).toBe(true);
    expect(TwsFiles.peek(PACK)).toMatchObject({ kind: 'ready', persisted: true });
    expect((await TwsStorage.get(PACK))?.fileName).toBe('mine.tws');
  });

  it('keeps a file that could not be stored for the session', async () => {
    const bytes = goodBytes();
    fake.abortWrites = true;
    expect(await TwsFiles.adopt(PACK, 'new.tws', bytes, parseTwsIndex(bytes, LIMITS))).toBe(false);
    expect(TwsFiles.peek(PACK)).toMatchObject({ kind: 'ready', fileName: 'new.tws', persisted: false });
  });

  it('lets a forget that came while the store was read stand', async () => {
    await TwsStorage.put({ packId: PACK, fileName: 'mine.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 1 });
    const reading = TwsFiles.ensure(PACK, LIMITS);
    await TwsFiles.forget(PACK);
    expect(await reading).toEqual({ kind: 'none' });
    expect(TwsFiles.peek(PACK)).toEqual({ kind: 'none' });
  });

  it('lets a load that came while the store was read stand', async () => {
    await TwsStorage.put({ packId: PACK, fileName: 'old.tws', bytes: arrayBufferOf(goodBytes()), loadedAt: 1 });
    const reading = TwsFiles.ensure(PACK, LIMITS);
    const bytes = goodBytes();
    await TwsFiles.adopt(PACK, 'new.tws', bytes, parseTwsIndex(bytes, LIMITS));
    await reading;
    expect(TwsFiles.peek(PACK)).toMatchObject({ kind: 'ready', fileName: 'new.tws' });
  });

  it('notifies a listener of each change, until it stops', async () => {
    let calls = 0;
    const stop = TwsFiles.subscribe(() => {
      calls++;
    });
    await TwsFiles.ensure(PACK, LIMITS);
    expect(calls).toBe(1);
    await TwsFiles.forget(PACK);
    expect(calls).toBe(2);
    stop();
    await TwsFiles.forget(PACK);
    expect(calls).toBe(2);
  });
});
