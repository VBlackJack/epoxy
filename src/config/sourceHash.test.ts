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
 * The hash of the shared text an imported pack came from: kept on the stored record to
 * recognise the same link later, and never written to an exported file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LevelPack } from '../core/types';
import { encodeShareLink } from '../packs/shareLink';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { ConfigRegistry } from './ConfigRegistry';

const fake = new FakeIndexedDb();
const HASH = 'ab'.repeat(32);

beforeEach(() => {
  loadTestConfigs();
  fake.records.clear();
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

async function importShared(sourceHash?: string): Promise<LevelPack> {
  const text = ConfigRegistry.exportPackJson((await makeSource()).id, 'Shared', true) ?? '';
  const result = await ConfigRegistry.importPackJson(text, { sourceHash });
  if (!result.ok) throw new Error(result.error);
  return result.pack;
}

async function makeSource(): Promise<LevelPack> {
  const { pack } = await ConfigRegistry.createUserPack('Source');
  if (!pack) throw new Error('no pack');
  await ConfigRegistry.saveLevelToPack(pack.id, makeLevel('src_level'));
  return ConfigRegistry.getAllPacks().find((p) => p.id === pack.id) as LevelPack;
}

describe('pack source hash', () => {
  it('is stored with an imported pack and found again', async () => {
    const pack = await importShared(HASH);
    expect(pack.sourceHash).toBe(HASH);
    expect((fake.records.get(pack.id) as LevelPack).sourceHash).toBe(HASH);
    expect(ConfigRegistry.findPackBySourceHash(HASH)?.id).toBe(pack.id);
    expect(ConfigRegistry.findPackBySourceHash('cd'.repeat(32))).toBeNull();
  });

  it('is absent from a pack imported from a file', async () => {
    const pack = await importShared();
    expect(pack.sourceHash).toBeUndefined();
    expect('sourceHash' in (fake.records.get(pack.id) as LevelPack)).toBe(false);
  });

  it('survives a reload of the stored packs', async () => {
    const pack = await importShared(HASH);
    await ConfigRegistry.loadStoredPacks();
    expect(ConfigRegistry.findPackBySourceHash(HASH)?.id).toBe(pack.id);
  });

  it('drops a stored value that is not a SHA-256 hex digest', async () => {
    const pack = await importShared(HASH);
    for (const bad of ['xyz', 42, null, HASH.toUpperCase()]) {
      fake.records.set(pack.id, { ...(fake.records.get(pack.id) as LevelPack), sourceHash: bad });
      await ConfigRegistry.loadStoredPacks();
      expect(ConfigRegistry.findPackBySourceHash(HASH), String(bad)).toBeNull();
      expect(ConfigRegistry.getAllPacks().find((p) => p.id === pack.id)?.sourceHash).toBeUndefined();
    }
  });

  it('never reaches an exported file or a share link', async () => {
    const pack = await importShared(HASH);
    expect(ConfigRegistry.exportPackJson(pack.id)).not.toContain('sourceHash');
    expect(ConfigRegistry.exportPackJson(pack.id, undefined, true)).not.toContain(HASH);
  });

  it('keeps the hash when the pack is renamed', async () => {
    const pack = await importShared(HASH);
    await ConfigRegistry.renamePack(pack.id, 'Renamed');
    expect(ConfigRegistry.findPackBySourceHash(HASH)?.name).toBe('Renamed');
  });

  it('reads a link through the registry and recognises the pack it imported', async () => {
    const source = await makeSource();
    const text = ConfigRegistry.exportPackJson(source.id, 'Shared', true) ?? '';
    const link = await encodeShareLink(text, 'https://example.test/', ConfigRegistry.getGame().share.maxLinkChars);
    if (!link.ok) throw new Error(link.error);
    const read = await ConfigRegistry.readSharedPack(new URL(link.url).hash);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // The level id of the source is taken in the library: it is re-issued.
    expect(read.pack.levels[0].id).not.toBe('src_level');
    const imported = await ConfigRegistry.importPackJson(read.pack.text, { sourceHash: read.pack.sourceHash });
    expect(imported.ok).toBe(true);
    const again = await ConfigRegistry.readSharedPack(new URL(link.url).hash);
    expect(again.ok && again.pack.sourceHash && ConfigRegistry.findPackBySourceHash(again.pack.sourceHash)).toBeTruthy();
  });
});
