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
import { CC2_SOURCE_DB_NAME } from '../config/constants';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { c2mFileBytes, makeMap, player, put } from '../formats/cc2TestMaps';
import { parsePackJson, serializePack } from '../packs/packJson';
import { Cc2SourceStorage } from '../storage/Cc2SourceStorage';
import { bytesToBase64, sha256Fallback, sha256OfBytes } from '../storage/cc2Sources';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { FakeKeyedIndexedDb } from '../test/FakeKeyedIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { collectCc2Sources, hasCc2Levels } from './cc2Export';
import { importCc2Selection } from './cc2Import';

const PURPLE_WALL = 0x73;
const MAX_BYTES = 1 << 20;

/** Routes the sidecar database and the pack library database to their own fakes. */
class RoutingIndexedDb {
  public readonly sources = new FakeKeyedIndexedDb();
  public readonly packs = new FakeIndexedDb();
  public open(name: string) {
    return name === CC2_SOURCE_DB_NAME ? this.sources.open() : this.packs.open();
  }
}

const fake = new RoutingIndexedDb();
const bytes = c2mFileBytes(makeMap(4, 3, [player(1, 1), put(2, 1, { code: PURPLE_WALL })]), 'Lost');

async function importedLevels() {
  const file = { name: 'a.c2m', size: bytes.length, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer };
  return importCc2Selection([file], MAX_BYTES, String);
}

beforeAll(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = fake;
});

afterAll(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

beforeEach(() => {
  loadTestConfigs();
  fake.sources.records.clear();
  fake.packs.records.clear();
});

describe('the CC2 source sidecar and the pack file', () => {
  it('leaves the raw sources out of a pack file unless asked', async () => {
    const result = await importedLevels();
    await Cc2SourceStorage.putAll(result.sources);
    expect(serializePack('Pack', result.levels)).not.toContain('cc2Sources');
    expect(serializePack('Pack', result.levels, {}, true)).not.toContain('cc2Sources');
  });

  it('collects the sources of the levels from the sidecar and writes them in the file when the player opted in', async () => {
    const result = await importedLevels();
    await Cc2SourceStorage.putAll(result.sources);
    expect(hasCc2Levels(result.levels)).toBe(true);
    const sources = await collectCc2Sources(result.levels);
    const hash = result.levels[0].cc2?.sha256 as string;
    expect(Object.keys(sources ?? {})).toEqual([hash]);
    const parsed = JSON.parse(serializePack('Pack', result.levels, {}, false, sources));
    expect(parsed.cc2Sources[hash]).toBe(bytesToBase64(bytes));
  });

  it('writes no field when the sidecar holds none of the sources', async () => {
    const result = await importedLevels();
    expect(await collectCc2Sources(result.levels)).toBeUndefined();
  });

  it('keeps a source of a pack file only for a hash that a level names', async () => {
    const result = await importedLevels();
    const hash = result.levels[0].cc2?.sha256 as string;
    const other = 'c'.repeat(64);
    const text = serializePack('Pack', result.levels, {}, false, { [hash]: 'AAAA', [other]: 'BBBB' });
    const parsed = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set());
    expect(parsed.ok && parsed.cc2Sources).toEqual({ [hash]: 'AAAA' });
  });

  it('stores the sources of an imported pack file in the sidecar, and drops one that does not match its hash', async () => {
    const result = await importedLevels();
    const hash = result.levels[0].cc2?.sha256 as string;
    expect(hash).toBe(await sha256OfBytes(bytes));
    const forged = serializePack('Forged', result.levels, {}, false, { [hash]: bytesToBase64(Uint8Array.of(9, 9)) });
    await ConfigRegistry.importPackJson(forged);
    expect(await Cc2SourceStorage.getMany([hash])).toEqual([]);

    const honest = serializePack('Honest', result.levels, {}, false, { [hash]: bytesToBase64(bytes) });
    const imported = await ConfigRegistry.importPackJson(honest);
    expect(imported.ok).toBe(true);
    const stored = await Cc2SourceStorage.getMany([hash]);
    expect(Array.from(stored?.[0].bytes ?? [])).toEqual(Array.from(bytes));
  });

  it('ignores the sources of a pack read from a share link', async () => {
    const result = await importedLevels();
    const hash = result.levels[0].cc2?.sha256 as string;
    const text = serializePack('Shared', result.levels, {}, true, { [hash]: bytesToBase64(bytes) });
    const imported = await ConfigRegistry.importPackJson(text, { sourceHash: 'f'.repeat(64) });
    expect(imported.ok).toBe(true);
    expect(await Cc2SourceStorage.getMany([hash])).toEqual([]);
  });

  it('releases the sources of a deleted pack, but keeps one that another pack still names', async () => {
    const result = await importedLevels();
    const hash = result.levels[0].cc2?.sha256 as string;
    const text = serializePack('Twin', result.levels, {}, false, { [hash]: bytesToBase64(bytes) });
    const first = await ConfigRegistry.importPackJson(text);
    const second = await ConfigRegistry.importPackJson(text);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    await ConfigRegistry.deletePack(first.pack.id);
    expect(await Cc2SourceStorage.getMany([hash])).toHaveLength(1);
    await ConfigRegistry.deleteImportedPack(second.pack.id);
    expect(await Cc2SourceStorage.getMany([hash])).toEqual([]);
  });
});

describe('SHA-256 without crypto.subtle', () => {
  it('matches the browser digest for several lengths', async () => {
    for (const length of [0, 3, 55, 56, 63, 64, 65, 200]) {
      const data = Uint8Array.from({ length }, (_, i) => (i * 7 + 1) & 0xff);
      const expected = await sha256OfBytes(data);
      const fallback = Array.from(sha256Fallback(data), (b) => b.toString(16).padStart(2, '0')).join('');
      expect(fallback, `length ${length}`).toBe(expected);
    }
  });

  it('is used when the page has no crypto.subtle', async () => {
    const data = Uint8Array.of(1, 2, 3);
    const expected = await sha256OfBytes(data);
    vi.stubGlobal('crypto', {});
    try {
      expect(await sha256OfBytes(data)).toBe(expected);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
