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

/** Pure maths of the Runeward painters: hash, waves, crest continuity, neighbour reading and the clock. */

import { describe, expect, it } from 'vitest';
import { NEIGHBOUR } from '../../tileNeighbours';
import { crestPhase, isShadowedFromNorth, mageSide, tileHash, wallHasFront, wave } from './runewardPainters';
import { runewardClockMs } from './runewardTiles';

/** Values of the same hash in the Runeward game (src/render/Painter.js), measured by running it. */
const REFERENCE_HASHES: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 0, 2182377942],
  [0, 1, 3299714085],
  [3, 7, 260807386],
  [12, 5, 2870757120],
  [63, 63, 4291322435],
  [-1, 2, 1965274965]
];

const PERIOD_MS = 2600;
const SAMPLE_COUNT = 64;
const FLOAT_TOLERANCE = 1e-9;
const FOUR_ROWS = 4;
const SAMPLE_CELLS: readonly (readonly [number, number])[] = [[0, 0], [3, 2], [17, 9], [40, 31]];
const SAMPLE_TIMES_MS: readonly number[] = [0, 333, 1300, 2599, 12345];
const CREST_ROWS = 3;

describe('tileHash', () => {
  it.each(REFERENCE_HASHES)('matches the game for cell (%i, %i)', (x, y, expected) => {
    expect(tileHash(x, y)).toBe(expected);
  });
});

describe('wave', () => {
  it('stays between 0 and 1 for any time and phase', () => {
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const value = wave(i * 137, PERIOD_MS, i / SAMPLE_COUNT);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('starts at the middle and repeats after one period', () => {
    expect(wave(0, PERIOD_MS)).toBeCloseTo(0.5, 9);
    expect(wave(PERIOD_MS, PERIOD_MS, 0.25)).toBeCloseTo(wave(0, PERIOD_MS, 0.25), 9);
  });
});

describe('crestPhase', () => {
  it('stays within -1 and 1', () => {
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const value = crestPhase(i * 91, PERIOD_MS, i, i * 3, i % CREST_ROWS, (i % 9) / 8);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
  });

  it('continues across a cell border: the right edge of a cell is the left edge of the next', () => {
    for (const [cx, cy] of SAMPLE_CELLS) {
      for (const time of SAMPLE_TIMES_MS) {
        for (let row = 0; row < CREST_ROWS; row += 1) {
          const rightEdge = crestPhase(time, PERIOD_MS, cx, cy, row, 1);
          const nextLeftEdge = crestPhase(time, PERIOD_MS, cx + 1, cy, row, 0);
          expect(Math.abs(rightEdge - nextLeftEdge)).toBeLessThan(FLOAT_TOLERANCE);
        }
      }
    }
  });

  it('is periodic in the map row, so far rows do not drift', () => {
    for (const time of SAMPLE_TIMES_MS) {
      const near = crestPhase(time, PERIOD_MS, 2, 1, 0, 0.5);
      const far = crestPhase(time, PERIOD_MS, 2, 1 + FOUR_ROWS * 25, 0, 0.5);
      expect(Math.abs(near - far)).toBeLessThan(FLOAT_TOLERANCE);
    }
  });

  it('moves with the clock and repeats after one period', () => {
    expect(crestPhase(0, PERIOD_MS, 1, 1, 0, 0.3)).not.toBeCloseTo(crestPhase(PERIOD_MS / 4, PERIOD_MS, 1, 1, 0, 0.3), 3);
    expect(crestPhase(PERIOD_MS, PERIOD_MS, 1, 1, 0, 0.3)).toBeCloseTo(crestPhase(0, PERIOD_MS, 1, 1, 0, 0.3), 9);
  });
});

describe('neighbour reading', () => {
  it('shows the wall front only when no wall of the mass stands south', () => {
    expect(wallHasFront({ wallMask: 0, shadowMask: 0, hash: 0 })).toBe(true);
    expect(wallHasFront({ wallMask: NEIGHBOUR.S, shadowMask: 0, hash: 0 })).toBe(false);
    expect(wallHasFront({ wallMask: NEIGHBOUR.N | NEIGHBOUR.E, shadowMask: 0, hash: 0 })).toBe(true);
  });

  it('shades a cell only from a caster to the north', () => {
    expect(isShadowedFromNorth({ wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 0 })).toBe(true);
    expect(isShadowedFromNorth({ wallMask: 0, shadowMask: NEIGHBOUR.S | NEIGHBOUR.W, hash: 0 })).toBe(false);
  });

  it('leans the mage toward the side it faces', () => {
    expect([mageSide('N'), mageSide('E'), mageSide('S'), mageSide('W')]).toEqual([0, 1, 0, -1]);
  });
});

describe('Runeward clock', () => {
  it('follows the frame ticks at the reference frame rate', () => {
    expect(runewardClockMs({ timeTick: 0, reducedMotion: false })).toBe(0);
    expect(runewardClockMs({ timeTick: 60, reducedMotion: false })).toBeCloseTo(1000, 6);
  });

  it('is frozen at 0 under reduced motion', () => {
    expect(runewardClockMs({ timeTick: 12345, reducedMotion: true })).toBe(0);
  });
});
