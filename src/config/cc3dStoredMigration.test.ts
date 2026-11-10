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
 * Stored packs made before CC3D imports became Epoxy levels: their 'cc3d' levels are converted when the library loads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { CompiledLevel, LevelPack } from '../core/types';
import * as Converter from '../core/cc3d/cc3dToEpoxy';
import { isConvertedCc3dLevel } from '../core/cc3d/cc3dConstants';
import { decodeCc3dFiles } from '../formats/Cc3dXmlCodec';
import { LevelPackStorage } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { ConfigRegistry } from './ConfigRegistry';

const CELL = 64;
const PLAYER_TYPE = 22;
const FISH_TYPE = 42;
const PACK_ID = 'user_cc3d_old';

const fake = new FakeIndexedDb();

function levelXml(): string {
  const tiles = [
    { type: PLAYER_TYPE, x: 0, y: 0 },
    { type: FISH_TYPE, x: 2, y: 2 }
  ]
    .map(
      (t) =>
        `<tile image_index="${t.type}" x="${t.x * CELL}" y="${t.y * CELL}" direction="0" type="${t.type}"><attributes flags="0" editor_category="0" name="Stored" /></tile>`
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><map name="Valid" author="A" width="5" height="5" background="0"><tiles>${tiles}</tiles></map>`;
}

/** Three CC3D levels as an old import stored them. */
function oldCc3dLevels(): CompiledLevel[] {
  const bytes = new TextEncoder().encode(levelXml()).buffer as ArrayBuffer;
  return decodeCc3dFiles(
    [
      { name: '1.xml', bytes },
      { name: '2.xml', bytes },
      { name: '3.xml', bytes }
    ],
    'Old'
  ).levels;
}

function storePack(levels: CompiledLevel[]): LevelPack {
  const pack: LevelPack = { id: PACK_ID, name: 'Old', builtIn: false, userCreated: true, levels };
  fake.records.set(PACK_ID, pack);
  return pack;
}

const stored = () => fake.records.get(PACK_ID) as LevelPack;
const loaded = () => ConfigRegistry.getAllPacks().find((p) => p.id === PACK_ID) as LevelPack;

beforeEach(() => {
  loadTestConfigs();
  fake.records.clear();
  fake.abortWrites = false;
  fake.abortReads = false;
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await LevelPackStorage.closeConnection();
});

describe('migration of stored CC3D levels', () => {
  it('loads a stored CC3D pack as Epoxy levels that keep their ids and their CC3D payload', async () => {
    const old = oldCc3dLevels();
    expect(old.every((l) => l.ruleset === 'cc3d')).toBe(true);
    storePack(old);
    await ConfigRegistry.loadStoredPacks();

    const levels = loaded().levels;
    expect(levels.map((l) => l.id)).toEqual(old.map((l) => l.id));
    for (const [index, level] of levels.entries()) {
      expect(level.ruleset ?? 'epoxy').toBe('epoxy');
      expect(level.cc3d).toBeUndefined();
      expect(level.cc3dSource).toEqual(old[index].cc3d);
      expect(isConvertedCc3dLevel(level)).toBe(true);
    }
    // Scores and completion are keyed by level id: every old id is still found.
    for (const level of old) expect(levels.some((l) => l.id === level.id)).toBe(true);
    expect(ConfigRegistry.takeCc3dMigrationReport()).toEqual({ converted: 3, kept: 0 });
    expect(ConfigRegistry.takeCc3dMigrationReport()).toBeNull();
  });

  it('writes the migrated pack back once and does not migrate it again', async () => {
    storePack(oldCc3dLevels());
    await ConfigRegistry.loadStoredPacks();
    expect(stored().levels.every((l) => l.cc3dSource !== undefined && l.cc3d === undefined)).toBe(true);
    ConfigRegistry.takeCc3dMigrationReport();

    const convert = vi.spyOn(Converter, 'convertCc3dLevel');
    const save = vi.spyOn(LevelPackStorage, 'savePack');
    await ConfigRegistry.loadStoredPacks();
    expect(convert).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(ConfigRegistry.takeCc3dMigrationReport()).toBeNull();
  });

  it('keeps a level whose conversion throws as a CC3D level and counts it', async () => {
    const old = oldCc3dLevels();
    storePack(old);
    const real = Converter.convertCc3dLevel;
    vi.spyOn(Converter, 'convertCc3dLevel').mockImplementation((source) => {
      if (source.number === 2) throw new Error('boom');
      return real(source);
    });
    await ConfigRegistry.loadStoredPacks();

    const levels = loaded().levels;
    expect(levels.map((l) => l.id)).toEqual(old.map((l) => l.id));
    expect(levels.map((l) => l.ruleset ?? 'epoxy')).toEqual(['epoxy', 'cc3d', 'epoxy']);
    expect(levels[1].cc3d).toBeDefined();
    expect(ConfigRegistry.takeCc3dMigrationReport()).toEqual({ converted: 2, kept: 1 });
  });

  it('keeps the stored pack when the write-back fails and plays the converted copy from memory', async () => {
    const old = oldCc3dLevels();
    storePack(old);
    fake.abortWrites = true;
    await ConfigRegistry.loadStoredPacks();

    expect(loaded().levels.every((l) => l.cc3dSource !== undefined && l.cc3d === undefined)).toBe(true);
    expect(stored().levels.every((l) => l.ruleset === 'cc3d' && l.cc3d !== undefined)).toBe(true);
    // Nothing was written, so nothing is announced: the next start converts again and would repeat the notice.
    expect(ConfigRegistry.takeCc3dMigrationReport()).toBeNull();
  });

  it('keeps a level the converter reports as lost on the CC3D engine and counts it', async () => {
    const old = oldCc3dLevels();
    storePack(old);
    const real = Converter.convertCc3dLevel;
    vi.spyOn(Converter, 'convertCc3dLevel').mockImplementation((source) => {
      const result = real(source);
      if (source.number !== 3) return result;
      return { ...result, report: { ...result.report, lost: [{ key: 'trap_unworked', reason: 'test' }] } };
    });
    await ConfigRegistry.loadStoredPacks();

    const levels = loaded().levels;
    expect(levels.map((l) => l.ruleset ?? 'epoxy')).toEqual(['epoxy', 'epoxy', 'cc3d']);
    expect(levels[2].cc3d).toBeDefined();
    expect(ConfigRegistry.takeCc3dMigrationReport()).toEqual({ converted: 2, kept: 1 });
  });

  it('leaves a pack with no CC3D level and reports nothing', async () => {
    fake.records.set(PACK_ID, { id: PACK_ID, name: 'Plain', builtIn: false, userCreated: true, levels: [makeLevel('plain_1')] });
    const save = vi.spyOn(LevelPackStorage, 'savePack');
    await ConfigRegistry.loadStoredPacks();

    expect(loaded().levels.map((l) => l.id)).toEqual(['plain_1']);
    expect(save).not.toHaveBeenCalled();
    expect(ConfigRegistry.takeCc3dMigrationReport()).toBeNull();
  });
});
