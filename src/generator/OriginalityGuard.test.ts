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

import { describe, expect, it } from 'vitest';
import { CampaignGuardConfig, TileDefinition } from '../core/types';
import {
  CellClass,
  CellGrid,
  classifyCell,
  compareFingerprints,
  findSimilarPairs,
  fingerprintGrid,
  isSimilar
} from './OriginalityGuard';

const CONFIG: CampaignGuardConfig = { windowSize: 3, maxJaccard: 0.25, largeWindowSize: 5, largeWindowMinContent: 0, largeWindowMaxShare: 1 };
const GLYPH_CLASS: Record<string, CellClass> = {
  '#': CellClass.Wall,
  '.': CellClass.Floor,
  '~': CellClass.Hazard,
  D: CellClass.Door,
  c: CellClass.Item,
  o: CellClass.Other
};

function gridOf(rows: string[]): CellGrid {
  const width = rows[0].length;
  const cells = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => [...row].forEach((glyph, x) => (cells[y * width + x] = GLYPH_CLASS[glyph])));
  return { width, height: rows.length, cells };
}

function rotate(rows: string[]): string[] {
  return [...rows[0]].map((_, x) => rows.map((row) => row[x]).reverse().join(''));
}

function mirror(rows: string[]): string[] {
  return rows.map((row) => [...row].reverse().join(''));
}

const MAP = [
  '##########',
  '#..~~..D.#',
  '#.c#..#..#',
  '#..#o.#c.#',
  '#~.#..#..#',
  '#..D..~..#',
  '##########'
];

const OTHER = [
  '..........',
  '.........c',
  '..........',
  '......o...',
  '..........',
  '..........',
  '.#........'
];

function compare(a: string[], b: string[]) {
  return compareFingerprints(fingerprintGrid('a', gridOf(a), CONFIG), fingerprintGrid('b', gridOf(b), CONFIG));
}

describe('OriginalityGuard', () => {
  it('flags an identical map', () => {
    const result = compare(MAP, MAP);
    expect(result.jaccard).toBe(1);
    expect(isSimilar(result, CONFIG)).toBe(true);
  });

  it('flags rotated and mirrored copies', () => {
    for (const copy of [rotate(MAP), rotate(rotate(MAP)), mirror(MAP), mirror(rotate(MAP))]) {
      const result = compare(MAP, copy);
      expect(result.jaccard).toBe(1);
      expect(isSimilar(result, CONFIG)).toBe(true);
    }
  });

  it('does not flag an unrelated map', () => {
    const result = compare(MAP, OTHER);
    expect(result.jaccard).toBeLessThan(CONFIG.maxJaccard);
    expect(result.sharedLargeWindows).toBe(0);
    expect(isSimilar(result, CONFIG)).toBe(false);
  });

  it('flags a pair sharing one large window only', () => {
    const patch = ['#.~.#', '.cD..', '~.o#.', '..#.c', '#.~..'];
    const filler = '...........';
    const hostA = [...patch.map((row) => row + '......'), ...Array(6).fill(filler)];
    const hostB = [...Array(6).fill(filler), ...patch.map((row) => '......' + row)];
    const result = compare(hostA, hostB);
    expect(result.sharedLargeWindows).toBeGreaterThan(0);
    expect(isSimilar(result, CONFIG)).toBe(true);
  });

  it('ignores uniform windows', () => {
    expect(fingerprintGrid('wall', gridOf(['#######', '#######', '#######', '#######']), CONFIG).windows.size).toBe(0);
  });

  it('keeps large windows of bare floor and wall out when content is required', () => {
    const bare = ['#####', '#...#', '#...#', '#...#', '#####'];
    const strict = { ...CONFIG, largeWindowMinContent: 1 };
    expect(fingerprintGrid('bare', gridOf(bare), CONFIG).largeWindows.size).toBe(1);
    expect(fingerprintGrid('bare', gridOf(bare), strict).largeWindows.size).toBe(0);
  });

  it('lists only flagged pairs, closest first', () => {
    const candidates = [fingerprintGrid('map', gridOf(MAP), CONFIG)];
    const references = [
      fingerprintGrid('empty', gridOf(OTHER), CONFIG),
      fingerprintGrid('copy', gridOf(rotate(MAP)), CONFIG)
    ];
    const flagged = findSimilarPairs(candidates, references, CONFIG, { flaggedOnly: true });
    expect(flagged.map((p) => p.reference)).toEqual(['copy']);
    expect(findSimilarPairs(candidates, references, CONFIG, { flaggedOnly: false })).toHaveLength(2);
  });

  it('classifies tiles by role', () => {
    const tile = (extra: Partial<TileDefinition>): TileDefinition => ({
      id: 'x',
      category: 'c',
      layer: 'terrain',
      i18nKey: 'k',
      ...extra
    });
    expect(classifyCell(tile({ passableByPlayer: false }), null)).toBe(CellClass.Wall);
    expect(classifyCell(tile({ passableByPlayer: true }), null)).toBe(CellClass.Floor);
    expect(classifyCell(tile({ hazard: 'water' }), null)).toBe(CellClass.Hazard);
    expect(classifyCell(tile({ slideType: 'ice' }), null)).toBe(CellClass.Hazard);
    expect(classifyCell(tile({ requiredKey: 'key_red', passableByPlayer: false }), null)).toBe(CellClass.Door);
    expect(classifyCell(tile({ requiresAllChips: true }), null)).toBe(CellClass.Door);
    expect(classifyCell(tile({ isLevelExit: true }), null)).toBe(CellClass.Other);
    expect(classifyCell(tile({}), tile({ collectible: 'chip', layer: 'item' }))).toBe(CellClass.Item);
    expect(classifyCell(tile({}), tile({ hazard: 'bomb', layer: 'item' }))).toBe(CellClass.Hazard);
  });
});
