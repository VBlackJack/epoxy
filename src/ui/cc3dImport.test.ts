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
 * Import of a selection of cc3d level files into one pack, and the way a cc3d level survives the
 * trip through the storage validation that reloads imported packs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn(), playStep: vi.fn() }
}));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape, sanitizeStoredLevels } from '../config/ConfigValidation';
import { CC3D_ERROR_KEYS, Cc3dImportError } from '../formats/Cc3dXmlCodec';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  classifyImportSelection,
  importCc3dSelection,
  isCc3dFileName,
  packNameFromFile,
  type ImportableFile
} from './cc3dImport';

const CELL = 64;
const PLAYER_TYPE = 22;
const FISH_TYPE = 42;
const MAX_BYTES = 1024;

function levelXml(name: string, tiles: Array<{ type: number; x: number; y: number }>): string {
  const body = tiles
    .map(
      (t) =>
        `<tile image_index="${t.type}" x="${t.x * CELL}" y="${t.y * CELL}" direction="0" type="${t.type}"><attributes flags="0" editor_category="0" name="Stored" /></tile>`
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><map name="${name}" author="A" width="5" height="5" background="0"><tiles>${body}</tiles></map>`;
}

const VALID = levelXml('Valid', [
  { type: PLAYER_TYPE, x: 0, y: 0 },
  { type: FISH_TYPE, x: 2, y: 2 }
]);
const NO_PLAYER = levelXml('Broken', [{ type: FISH_TYPE, x: 2, y: 2 }]);

function file(name: string, text: string, size = text.length): ImportableFile {
  return { name, size, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('classifyImportSelection', () => {
  it('sends a selection of XML files to the cc3d import', () => {
    expect(classifyImportSelection(['1.xml', '2.XML'])).toBe('cc3d');
  });

  it('imports one file of any other format', () => {
    expect(classifyImportSelection(['pack.dat'])).toBe('single');
  });

  it('refuses several files of another format, importing none', () => {
    expect(classifyImportSelection(['a.json', 'b.ccl'])).toBe('several');
    expect(classifyImportSelection(['a.dat', 'b.dat'])).toBe('several');
  });

  it('refuses a selection that mixes XML and another format', () => {
    expect(classifyImportSelection(['1.xml', 'pack.dat'])).toBe('mixed');
  });

  it('recognises the extension without regard to case', () => {
    expect(isCc3dFileName('Level.XML')).toBe(true);
    expect(isCc3dFileName('level.xml.bak')).toBe(false);
    expect(packNameFromFile('my.pack.xml')).toBe('my.pack');
  });
});

describe('importCc3dSelection', () => {
  it('imports every readable file as one pack in numeric file order', async () => {
    const result = await importCc3dSelection(
      [file('10.xml', VALID, 1), file('2.xml', VALID, 1), file('1.xml', VALID, 1)],
      MAX_BYTES,
      'Pack'
    );
    expect(result.levels.map((l) => l.cc3d?.mapId)).toEqual(['1', '2', '10']);
    expect(result.levels.map((l) => l.number)).toEqual([1, 2, 3]);
    expect(result.skipped).toBe(0);
    expect(result.firstError).toBeNull();
  });

  it('imports the good files and counts the bad ones', async () => {
    const result = await importCc3dSelection(
      [file('1.xml', VALID, 1), file('2.xml', NO_PLAYER, 1), file('3.xml', 'not xml', 1)],
      MAX_BYTES,
      'Pack'
    );
    expect(result.levels).toHaveLength(1);
    expect(result.skipped).toBe(2);
    expect(result.firstError?.key).toBe(CC3D_ERROR_KEYS.playerCount);
    expect(result.firstError?.params).toEqual({ count: 0 });
  });

  it('skips a file over the size limit without reading it', async () => {
    const big = file('9.xml', VALID, MAX_BYTES + 1);
    const read = vi.spyOn(big, 'arrayBuffer');
    const result = await importCc3dSelection([big, file('1.xml', VALID, 1)], MAX_BYTES, 'Pack');
    expect(read).not.toHaveBeenCalled();
    expect(result.levels).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.firstError).toBeInstanceOf(Cc3dImportError);
    expect(result.firstError?.key).toBe('app.packs.import_too_large.label');
  });

  it('returns no level and the first error when every file fails', async () => {
    const result = await importCc3dSelection([file('1.xml', NO_PLAYER, 1), file('2.xml', '', 1)], MAX_BYTES, 'Pack');
    expect(result.levels).toHaveLength(0);
    expect(result.skipped).toBe(2);
    expect(result.firstError).not.toBeNull();
  });
});

describe('persistence of cc3d packs', () => {
  it('keeps a cc3d level whole through the validation that reloads stored packs', async () => {
    const { levels } = await importCc3dSelection([file('1.xml', VALID, 1)], MAX_BYTES, 'Pack');
    const bounds = ConfigRegistry.getLevelSizeBounds();
    // IndexedDB stores a structured clone; the reload runs the validation below.
    const stored = structuredClone(levels);
    expect(isCompiledLevelShape(stored[0], bounds)).toBe(true);
    const reloaded = sanitizeStoredLevels(stored, bounds);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toEqual(levels[0]);
    expect(reloaded[0].ruleset).toBe('cc3d');
    expect(reloaded[0].cc3d).toEqual(levels[0].cc3d);
  });

  it('registers an imported cc3d pack under the session, with its levels intact', async () => {
    const { levels } = await importCc3dSelection([file('1.xml', VALID, 1), file('2.xml', VALID, 1)], MAX_BYTES, 'Pack');
    const { pack } = await ConfigRegistry.registerImportedPack('Pack', levels);
    const found = ConfigRegistry.getAllPacks().find((p) => p.id === pack.id);
    expect(found?.levels).toHaveLength(2);
    expect(found?.levels.every((l) => l.ruleset === 'cc3d' && l.cc3d !== undefined)).toBe(true);
    expect(new Set(found?.levels.map((l) => l.id)).size).toBe(2);
  });
});
