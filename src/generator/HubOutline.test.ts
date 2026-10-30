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

import { HubOutlineGrowthConfig } from '../core/types';
import { growOutline, growthSides, outlineFloor, OutlineRoom, wantedGrowth } from './HubOutline';

const SQUARE = ['.......', '.......', '.......', '.......', '.......', '.......', '.......'];
const CROSS = ['##...##', '##...##', '.......', '.......', '.......', '##...##', '##...##'];
/** A 32x32 map with a margin of 1 and 2 cells kept on each side of the outline. */
const ROOM: OutlineRoom = { interior: 900, boxArea: 417, pieceCount: 9, widest: 26, tallest: 26 };
const RULE: HubOutlineGrowthConfig = { cellsPerPiece: 12, freeAreaShare: 0.21, maxCells: 40 };
const EAST = growthSides(0, 0);
const SOUTH = growthSides(0, 1);

describe('hub outline growth', () => {
  it('asks for the outline share of the free area, less the floor drawn, within the cap', () => {
    // 900 - 417 - 108 = 375 free cells; 0.21 of them is 79; the square has 49.
    expect(wantedGrowth(SQUARE, ROOM, RULE)).toBe(30);
    // The cross has 33 floor cells, so 46 are wanted, more than the cap allows.
    expect(wantedGrowth(CROSS, ROOM, RULE)).toBe(RULE.maxCells);
    expect(wantedGrowth(CROSS, ROOM, { ...RULE, maxCells: 100 })).toBe(79 - outlineFloor(CROSS));
    expect(wantedGrowth(SQUARE, ROOM, { ...RULE, maxCells: 10 })).toBe(10);
    expect(wantedGrowth(SQUARE, ROOM, { ...RULE, freeAreaShare: 0 })).toBeLessThan(0);
    // Larger puzzles leave less free area, so the outline grows less.
    expect(wantedGrowth(SQUARE, { ...ROOM, boxArea: 470, pieceCount: 11 }, RULE)).toBeLessThan(wantedGrowth(SQUARE, ROOM, RULE));
  });

  it('grows toward the map edge the hub is shifted to first, then by offset, the drawn order for ties', () => {
    expect(growthSides(0, 0)).toEqual(['E', 'S', 'W', 'N']);
    expect(growthSides(-7, 3)).toEqual(['W', 'S', 'N', 'E']);
    expect(growthSides(2, -5)).toEqual(['N', 'E', 'W', 'S']);
  });

  it('leaves the drawn outline alone when nothing is wanted', () => {
    expect(growOutline(SQUARE, 0, ROOM, EAST)).toBe(SQUARE);
    expect(growOutline(SQUARE, -5, ROOM, EAST)).toBe(SQUARE);
  });

  it('adds rows and columns of floor round the outline, side after side, keeping the drawn walls', () => {
    const grown = growOutline(CROSS, 32, ROOM, EAST);
    expect(grown).toEqual(['.........', '.##...##.', '.##...##.', '.........', '.........', '.........', '.##...##.', '.##...##.', '.........']);
    expect(outlineFloor(grown)).toBe(outlineFloor(CROSS) + 32);
  });

  it('starts from the given side and stops when the next strip would overshoot more than it helps', () => {
    // East (7 cells) brings 7 of 10; south (8 cells) would land 5 past the target for 3 short: it stops.
    expect(growOutline(SQUARE, 10, ROOM, EAST)).toEqual(SQUARE.map((r) => `${r}.`));
    expect(growOutline(SQUARE, 10, ROOM, SOUTH)).toEqual([...SQUARE, '.......']);
  });

  it('skips the sides the room has no space for and pads ragged outlines with walls', () => {
    // Rows only, 7 cells each: five of them reach 35, the closest to 32 a sixth would not improve on.
    const narrow = { ...ROOM, widest: 7 };
    expect(growOutline(SQUARE, 32, narrow, EAST)).toEqual(['.......', '.......', ...SQUARE, '.......', '.......', '.......']);
    expect(growOutline(['...', '.'], 3, ROOM, EAST)).toEqual(['....', '.##.']);
  });
});
