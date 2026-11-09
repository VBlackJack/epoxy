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
import { isCc3dLevelShape, isCompiledLevelShape, sanitizeStoredLevels } from '../config/ConfigValidation';
import { LevelValidator } from '../core/LevelValidator';
import { isConvertedCc3dLevel } from '../core/cc3d/cc3dConstants';
import { ensureUniqueLevelIds } from '../config/ConfigValidation';
import * as Converter from '../core/cc3d/cc3dToEpoxy';
import * as Coverage from '../core/cc3d/epoxyCoverage';
import { featuresFor } from '../core/RulesetFeatures';
import { CC3D_ERROR_KEYS, Cc3dImportError, decodeCc3dFiles } from '../formats/Cc3dXmlCodec';
import { loadTestConfigs } from '../test/loadTestConfigs';
import {
  cc3dImportReportLines,
  classifyImportSelection,
  convertImportedLevels,
  importCc3dSelection,
  importDiggySelection,
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

const BYTES = new TextEncoder().encode(VALID).buffer as ArrayBuffer;

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

  it('sends multiple Diggy floor JSON files to the diggy import and keeps a single file on single', () => {
    expect(classifyImportSelection(['floors_4295.json', 'floors_4296.json'])).toBe('diggy');
    expect(classifyImportSelection(['floors_4295.json'])).toBe('single');
    expect(classifyImportSelection(['floors_4295.json', 'pack.dat'])).toBe('mixed');
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
    expect(result.levels.map((l) => l.cc3dSource?.mapId)).toEqual(['1', '2', '10']);
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

describe('import as Epoxy levels', () => {
  it('imports every level as an Epoxy-ruleset level that keeps its CC3D payload', async () => {
    const result = await importCc3dSelection([file('1.xml', VALID, 1)], MAX_BYTES, 'Pack');
    const level = result.levels[0];
    expect(level.ruleset).toBe('epoxy');
    // The payload sits under its own field: `cc3d` would make the editor, the validator and the .DAT export treat it as a CC3D room.
    expect(level.cc3d).toBeUndefined();
    expect(level.cc3dSource?.mapId).toBe('1');
    expect(level.cc3dSource?.cells).toHaveLength(25);
    expect(result.summary.imported).toBe(1);
  });

  it('gives the imported level every Epoxy aid', async () => {
    const { levels } = await importCc3dSelection([file('1.xml', VALID, 1)], MAX_BYTES, 'Pack');
    expect(featuresFor(levels[0]).itemDrop).toBe(true);
    expect(featuresFor(levels[0])).toEqual(featuresFor({ ruleset: 'epoxy' }));
  });

  it('keeps every converted level in the pack and counts it under exactly one verdict', () => {
    const decoded = decodeCc3dFiles([{ name: '1.xml', bytes: BYTES }], 'Pack').levels;
    const { levels, summary } = convertImportedLevels(decoded);
    expect(levels).toHaveLength(1);
    expect(summary.imported).toBe(1);
    expect(summary.failedLevels).toEqual([]);
    expect(summary.exact + summary.approx + summary.lostLevels.length).toBe(1);
  });

  it('keeps a level the converter marks lost in the pack and names it', () => {
    const decoded = decodeCc3dFiles([{ name: '1.xml', bytes: BYTES }], 'Pack').levels;
    const real = Coverage.classifyLevel;
    const spy = vi.spyOn(Coverage, 'classifyLevel').mockImplementation((level) => ({ ...real(level), verdict: 'lost' }));
    const { levels, summary } = convertImportedLevels(decoded);
    spy.mockRestore();
    expect(levels).toHaveLength(1);
    expect(summary.lostLevels).toEqual(['1']);
    expect(summary.exact + summary.approx).toBe(0);
  });

  it('keeps a level the validator flags and names exactly that level', () => {
    const decoded = decodeCc3dFiles(
      [
        { name: '1.xml', bytes: BYTES },
        { name: '2.xml', bytes: BYTES },
        { name: '3.xml', bytes: BYTES }
      ],
      'Pack'
    ).levels;
    const real = LevelValidator.validate.bind(LevelValidator);
    // The converted level of file 2 is the only one the validator reports an error on.
    const spy = vi.spyOn(LevelValidator, 'validate').mockImplementation((level, ...rest) => {
      const report = real(level, ...rest);
      const flagged = level.cc3dSource === undefined && level.number === 2;
      return flagged ? { ...report, issues: [{ severity: 'error', i18nKey: 'validator.issues.no_exit.label' }] } : { ...report, issues: [] };
    });
    const { levels, summary } = convertImportedLevels(decoded);
    spy.mockRestore();
    expect(levels).toHaveLength(3);
    expect(summary.invalidLevels).toEqual(['2']);
  });

  it('keeps the converted-level marker when the pack code makes an id unique after the suffix', () => {
    const decoded = decodeCc3dFiles([{ name: '1.xml', bytes: BYTES }], 'Pack').levels;
    const { levels } = convertImportedLevels(decoded);
    expect(isConvertedCc3dLevel(levels[0])).toBe(true);
    expect(isConvertedCc3dLevel({ id: `${levels[0].id}_2` })).toBe(true);
    const twins = ensureUniqueLevelIds([levels[0], levels[0]], 'Pack');
    expect(twins[1].id).not.toBe(twins[0].id);
    expect(isConvertedCc3dLevel(twins[1])).toBe(true);
    expect(isConvertedCc3dLevel({ id: 'plain_2' })).toBe(false);
  });

  it('reports a level whose conversion throws and carries on with the others', () => {
    const decoded = decodeCc3dFiles(
      [
        { name: '1.xml', bytes: BYTES },
        { name: '2.xml', bytes: BYTES },
        { name: '3.xml', bytes: BYTES }
      ],
      'Pack'
    ).levels;
    const real = Converter.convertCc3dLevel;
    const spy = vi.spyOn(Converter, 'convertCc3dLevel').mockImplementation((source) => {
      if (source.number === 2) throw new Error('boom');
      return real(source);
    });
    const { levels, summary } = convertImportedLevels(decoded);
    spy.mockRestore();
    expect(levels.map((l) => l.number)).toEqual([1, 3]);
    expect(summary.failedLevels).toEqual(['2']);
    expect(summary.imported).toBe(2);
  });

  it('keeps a level that failed to convert out of the skipped files count', async () => {
    const real = Converter.convertCc3dLevel;
    const spy = vi.spyOn(Converter, 'convertCc3dLevel').mockImplementation((source) => {
      if (source.number === 1) throw new Error('boom');
      return real(source);
    });
    const result = await importCc3dSelection([file('1.xml', VALID, 1), file('2.xml', VALID, 1)], MAX_BYTES, 'Pack');
    spy.mockRestore();
    expect(result.levels).toHaveLength(1);
    expect(result.skipped).toBe(0);
    expect(result.summary.failedLevels).toEqual(['1']);
  });

  it('writes one report line of counts, then one line per kind of level that needs a word', () => {
    const lines = cc3dImportReportLines({ imported: 5, exact: 2, approx: 2, lostLevels: ['4'], invalidLevels: [], failedLevels: ['7'] });
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => !line.startsWith('cc3d.'))).toBe(true);
  });

  it('caps the level numbers named in a report line and counts the rest', () => {
    const many = Array.from({ length: 30 }, (_, i) => String(i + 1));
    const lines = cc3dImportReportLines({ imported: 30, exact: 0, approx: 0, lostLevels: many, invalidLevels: [], failedLevels: [] });
    expect(lines[1]).toContain('12');
    expect(lines[1]).not.toContain('13');
  });
});

describe('importDiggySelection', () => {
  const DIGGY_FLOOR = JSON.stringify({
    floor: {
      floor_id: 1,
      name: 'Mine 1',
      rows: 5,
      columns: 5,
      bg_id: 1,
      blocked: '0_0;0_1;0_2;0_3;0_4;4_0;4_1;4_2;4_3;4_4'
    }
  });

  it('imports multiple Diggy floor files and skips oversized ones without reading them', async () => {
    const big = file('floors_99.json', DIGGY_FLOOR, MAX_BYTES + 1);
    const read = vi.spyOn(big, 'arrayBuffer');
    const result = await importDiggySelection([big, file('floors_1.json', DIGGY_FLOOR, 1)], MAX_BYTES, 'Diggy');
    expect(read).not.toHaveBeenCalled();
    expect(result.levels).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.tooLargeMaxMb).not.toBeNull();
  });
});

describe('persistence of cc3d packs', () => {
  it('keeps an imported Epoxy level and its CC3D payload whole through the validation that reloads stored packs', async () => {
    const { levels } = await importCc3dSelection([file('1.xml', VALID, 1)], MAX_BYTES, 'Pack');
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const stored = structuredClone(levels);
    expect(isCompiledLevelShape(stored[0], bounds)).toBe(true);
    const reloaded = sanitizeStoredLevels(stored, bounds);
    expect(reloaded).toEqual(levels);
    expect(reloaded[0].ruleset).toBe('epoxy');
    expect(reloaded[0].cc3dSource).toEqual(levels[0].cc3dSource);
  });

  it('drops a kept CC3D payload that is not a CC3D level instead of the whole level', async () => {
    const { levels } = await importCc3dSelection([file('1.xml', VALID, 1)], MAX_BYTES, 'Pack');
    const broken = { ...structuredClone(levels[0]), cc3dSource: { width: 'x' } };
    const reloaded = sanitizeStoredLevels([broken], ConfigRegistry.getLevelSizeBounds());
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].cc3dSource).toBeUndefined();
  });

  it('refuses a CC3D payload whose map id or terrain layers are not text', async () => {
    const { levels } = await importCc3dSelection([file('1.xml', VALID, 1)], MAX_BYTES, 'Pack');
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const source = structuredClone(levels[0].cc3dSource) as unknown as Record<string, unknown>;
    expect(isCc3dLevelShape(source, bounds)).toBe(true);
    expect(isCc3dLevelShape({ ...source, mapId: 7 }, bounds)).toBe(false);
    const cells = structuredClone(source.cells) as Array<{ terrain: unknown[] }>;
    cells[0].terrain = [5];
    expect(isCc3dLevelShape({ ...source, cells }, bounds)).toBe(false);
  });

  it('keeps a cc3d-ruleset level whole through the validation (packs stored before imports became Epoxy levels)', () => {
    const { levels } = decodeCc3dFiles([{ name: '1.xml', bytes: BYTES }], 'Pack');
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

  it('leaves the kept CC3D source out of an exported or shared pack, which still plays', async () => {
    const { levels } = await importCc3dSelection([file('1.xml', VALID, 1)], MAX_BYTES, 'Pack');
    const { pack } = await ConfigRegistry.registerImportedPack('Pack', levels);
    // Share links are made from the same text, compact or not.
    for (const compact of [false, true]) {
      const text = ConfigRegistry.exportPackJson(pack.id, 'Pack', compact);
      expect(text).not.toBeNull();
      expect(text).not.toContain('cc3dSource');
      const parsed = JSON.parse(text as string);
      expect(parsed.levels[0].cc3dSource).toBeUndefined();
      const reread = sanitizeStoredLevels(parsed.levels, ConfigRegistry.getLevelSizeBounds());
      expect(reread).toHaveLength(1);
      expect(reread[0].ruleset).toBe('epoxy');
      expect(featuresFor(reread[0]).itemDrop).toBe(true);
    }
    // The stored pack keeps its source.
    expect(ConfigRegistry.getAllPacks().find((p) => p.id === pack.id)?.levels[0].cc3dSource).toBeDefined();
  });

  it('registers an imported pack under the session, with its levels and payloads intact', async () => {
    const { levels } = await importCc3dSelection([file('1.xml', VALID, 1), file('2.xml', VALID, 1)], MAX_BYTES, 'Pack');
    const { pack } = await ConfigRegistry.registerImportedPack('Pack', levels);
    const found = ConfigRegistry.getAllPacks().find((p) => p.id === pack.id);
    expect(found?.levels).toHaveLength(2);
    expect(found?.levels.every((l) => l.ruleset !== 'cc3d' && l.cc3d === undefined && l.cc3dSource !== undefined)).toBe(true);
    expect(new Set(found?.levels.map((l) => l.id)).size).toBe(2);
  });
});
