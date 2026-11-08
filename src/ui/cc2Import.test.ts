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

import { beforeAll, describe, expect, it } from 'vitest';
import { PACK_JSON_VERSION_V12 } from '../config/constants';
import { FLOOR_CODE, c2mFileBytes, makeMap, player, put } from '../formats/cc2TestMaps';
import { parseC2gScript } from '../formats/C2gScript';
import { serializePack } from '../packs/packJson';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { classifyImportSelection } from './cc3dImport';
import {
  compareNaturalPaths,
  dropImportJunk,
  folderNameOf,
  importCc2Selection,
  importPathOf,
  isImportJunkPath,
  orderCc2Maps,
  summarizeCc2Import
} from './cc2Import';
import type { Cc2ImportFile } from './cc2Import';

const MAX_BYTES = 1 << 20;
/** The lightning bolt has no Epoxy equivalent yet, so a level that holds it keeps a reserved id and is lost. */
const LOST_ITEM = 0x62;
const PURPLE_WALL = 0x73;
const FORMAT = (bytes: number): string => String(bytes);

/** A selected file backed by bytes, with the path a folder pick would give it. */
function fileOf(path: string, bytes: Uint8Array): Cc2ImportFile {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return {
    name,
    size: bytes.length,
    webkitRelativePath: path.includes('/') ? path : '',
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer
  };
}

function scriptFile(path: string, text: string): Cc2ImportFile {
  return fileOf(path, new TextEncoder().encode(text));
}

/** A level whose title tells which file it came from. */
function levelFile(path: string, title: string, broken = false): Cc2ImportFile {
  const map = makeMap(4, 3, [player(1, 1), ...(broken ? [put(2, 1, { code: LOST_ITEM }, { code: FLOOR_CODE })] : [])]);
  return fileOf(path, c2mFileBytes(map, title));
}

beforeAll(() => {
  loadTestConfigs();
});

describe('classifying a CC2 selection', () => {
  it('imports levels and game scripts together as one pack', () => {
    expect(classifyImportSelection(['a.c2m'])).toBe('cc2');
    expect(classifyImportSelection(['a.C2M', 'b.c2m', 'game.C2G'])).toBe('cc2');
  });

  it('refuses a mix with another format', () => {
    expect(classifyImportSelection(['a.c2m', 'b.dat'])).toBe('mixed');
    expect(classifyImportSelection(['a.c2m', 'b.xml'])).toBe('mixed');
  });

  it('leaves the other formats as they were', () => {
    expect(classifyImportSelection(['a.xml'])).toBe('cc3d');
    expect(classifyImportSelection(['a.dat'])).toBe('single');
  });
});

describe('macOS companion files', () => {
  it('recognises AppleDouble files and the __MACOSX folder', () => {
    expect(isImportJunkPath('pack/._lesson.c2m')).toBe(true);
    expect(isImportJunkPath('__MACOSX/pack/lesson.c2m')).toBe(true);
    expect(isImportJunkPath('pack\\__macosx\\lesson.c2m')).toBe(true);
    expect(isImportJunkPath('pack/lesson.c2m')).toBe(false);
    expect(isImportJunkPath('._x.c2m')).toBe(true);
  });

  it('drops them from a selection and keeps the real files', () => {
    const kept = dropImportJunk([levelFile('p/a.c2m', 'A'), levelFile('p/._a.c2m', 'junk'), levelFile('__MACOSX/p/a.c2m', 'junk')]);
    expect(kept.map(importPathOf)).toEqual(['p/a.c2m']);
  });
});

describe('ordering through the game script', () => {
  const script = (lines: string[]) => ({ path: 'game/g.c2g', script: parseC2gScript(lines.join('\r\n')) });

  it('follows the script, matching case-insensitively through backslashes and folders', () => {
    const order = orderCc2Maps(
      ['game/1-20/Lesson_2.c2m', 'game/1-20/lesson_1.c2m'],
      [script(['game "Mine"', 'map "1-20\\LESSON_1.C2M"', 'music "+Track02" map "1-20\\lesson_2.c2m"'])]
    );
    expect(order.ordered.map((m) => m.path)).toEqual(['game/1-20/lesson_1.c2m', 'game/1-20/Lesson_2.c2m']);
    expect(order.ordered[1].music).toBe('+Track02');
    expect(order.gameName).toBe('Mine');
    expect(order.appended).toBe(0);
  });

  it('falls back to a unique base name when the folders differ', () => {
    const order = orderCc2Maps(['x/one.c2m', 'x/two.c2m'], [script(['map "levels\\two.c2m"', 'map "levels\\one.c2m"'])]);
    expect(order.ordered.map((m) => m.path)).toEqual(['x/two.c2m', 'x/one.c2m']);
  });

  it('does not guess between two files with the same base name', () => {
    const order = orderCc2Maps(['a/one.c2m', 'b/one.c2m'], [script(['map "one.c2m"'])]);
    expect(order.scripted).toBe(false);
    expect(order.ordered.map((m) => m.path)).toEqual(['a/one.c2m', 'b/one.c2m']);
  });

  it('uses the script that places the most maps, and appends the maps it does not list', () => {
    const small = { path: 'game/a.c2g', script: parseC2gScript('game "Small"\nmap "one.c2m"') };
    const large = { path: 'game/b.c2g', script: parseC2gScript('game "Large"\nmap "three.c2m"\nmap "one.c2m"') };
    const order = orderCc2Maps(['game/one.c2m', 'game/three.c2m', 'game/two.c2m'], [small, large]);
    expect(order.gameName).toBe('Large');
    expect(order.ordered.map((m) => m.path)).toEqual(['game/three.c2m', 'game/one.c2m', 'game/two.c2m']);
    expect(order.appended).toBe(1);
  });

  it('puts the maps in natural path order without a script', () => {
    const order = orderCc2Maps(['p/level10.c2m', 'p/Level2.c2m', 'p/level1.c2m'], []);
    expect(order.ordered.map((m) => m.path)).toEqual(['p/level1.c2m', 'p/Level2.c2m', 'p/level10.c2m']);
    expect(order.gameName).toBeNull();
    expect(compareNaturalPaths('a2', 'a10')).toBeLessThan(0);
  });
});

describe('building the pack', () => {
  it('converts the levels in script order and names the pack after the game', async () => {
    const result = await importCc2Selection(
      [
        scriptFile('Game/main.c2g', 'game "My Steam Game"\nmap "b.c2m"\nmap "a.c2m"\n'),
        levelFile('Game/a.c2m', 'Alpha'),
        levelFile('Game/b.c2m', 'Bravo', true),
        levelFile('Game/._b.c2m', 'junk'),
        levelFile('Game/c.c2m', 'Charlie')
      ],
      MAX_BYTES,
      FORMAT
    );
    expect(result.packName).toBe('My Steam Game');
    expect(result.levels.map((l) => l.customTitle)).toEqual(['Bravo', 'Alpha', 'Charlie']);
    expect(result.levels.map((l) => l.number)).toEqual([1, 2, 3]);
    expect(result.levels.map((l) => l.cc2?.file)).toEqual(['b.c2m', 'a.c2m', 'c.c2m']);
    expect(result.summary).toMatchObject({ levelCount: 3, exact: 2, lost: 1, skipped: 0, appended: 1 });
    expect(result.summary.lostKeys).toEqual(['lightning_bolt']);
    expect(result.sources).toHaveLength(3);
  });

  it('plays a purple wall level as exact now that Epoxy has the tile', async () => {
    const map = makeMap(4, 3, [player(1, 1), put(2, 1, { code: PURPLE_WALL })]);
    const result = await importCc2Selection([fileOf('a.c2m', c2mFileBytes(map, 'Purple'))], MAX_BYTES, FORMAT);
    expect(result.summary).toMatchObject({ levelCount: 1, exact: 1, lost: 0 });
    expect(result.levels[0].terrain[1][2]).toBe('purple_wall');
  });

  it('writes the pack in format 12 when a reserved id is present, and carries no raw bytes by default', async () => {
    const result = await importCc2Selection([levelFile('a.c2m', 'Lost', true)], MAX_BYTES, FORMAT);
    const text = serializePack('Pack', result.levels);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION_V12);
    expect(text).not.toContain('cc2Sources');
  });

  it('skips files that cannot be read and reports the first failure', async () => {
    const result = await importCc2Selection(
      [levelFile('p/a.c2m', 'Alpha'), fileOf('p/b.c2m', new Uint8Array([1, 2, 3])), levelFile('p/c.c2m', 'Charlie')],
      MAX_BYTES,
      FORMAT
    );
    expect(result.levels).toHaveLength(2);
    expect(result.summary.skipped).toBe(1);
    expect(result.firstError?.key).toBe('cc2.import.error.unreadable');
  });

  it('refuses a file over the size limit before reading it', async () => {
    const big = { ...levelFile('p/a.c2m', 'Big'), size: MAX_BYTES + 1 };
    const result = await importCc2Selection([big], MAX_BYTES, FORMAT);
    expect(result.levels).toHaveLength(0);
    expect(result.summary).toMatchObject({ skipped: 0, tooLarge: 1 });
    expect(result.firstError).toEqual({ key: 'app.packs.import_too_large.label', params: { max: String(MAX_BYTES) } });
  });

  it('names a pack made without a script from its folder', () => {
    expect(folderNameOf([levelFile('My Levels/a.c2m', 'A')])).toBe('My Levels');
    expect(folderNameOf([fileOf('a.c2m', new Uint8Array(0))])).toBeNull();
  });

  it('summarises counts, warnings and lost mechanics', () => {
    const summary = summarizeCc2Import(
      [
        { file: 'a', title: 'a', verdict: 'exact', exact: [], approx: [], lost: [], warnings: ['w'] },
        { file: 'b', title: 'b', verdict: 'lost', exact: [], approx: [], lost: [{ key: 'rover', reason: '' }], warnings: [] }
      ],
      2,
      1
    );
    expect(summary).toEqual({
      levelCount: 2,
      exact: 1,
      approx: 0,
      lost: 1,
      skipped: 2,
      tooLarge: 0,
      appended: 1,
      warningCount: 1,
      lostKeys: ['rover']
    });
  });
});
