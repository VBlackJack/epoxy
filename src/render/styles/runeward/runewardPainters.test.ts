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

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { RunewardArtConfig } from '../../../core/types';
import { loadTestConfigs } from '../../../test/loadTestConfigs';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import {
  crestPhase,
  isShadowedFromNorth,
  mageSide,
  paintBlueWall,
  paintExit,
  paintFloor,
  paintLava,
  paintMage,
  paintWall,
  paintWater,
  tileHash,
  wallHasFront,
  wave
} from './runewardPainters';
import { countCalls, createRecordedContext } from '../../../test/runewardTestContext';
import { RUNEWARD_FALLBACK, RUNEWARD_PAINTERS, runewardClockMs, type RunewardPaintEnv, type RunewardTilePass } from './runewardTiles';

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

const TILE = 48;
const SMALL_TILE = 12;
const CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: NEIGHBOUR.N, hash: 123456789, cx: 5, cy: 4 };
const OPEN_CELL: Readonly<TileNeighbours> = { wallMask: 0, shadowMask: 0, hash: 1, cx: 1, cy: 1 };
const CLOCK_MS = 777;
/** Calls the tile dispatch adds around a drawing: save and translate before, restore after. */
const WRAPPER_HEAD = 2;
const WRAPPER_TAIL = 1;
const INK_CREST_ALPHA = 'globalAlpha = 0.85';
const POSE = { dir: 'S', inWater: false, alive: true, frame: 0, hop: 0 } as const;

function plainArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArt as RunewardArtConfig;
}

function parchmentArt(): RunewardArtConfig {
  return ConfigRegistry.getGame().runewardArtVariants?.parchment as RunewardArtConfig;
}

function envOf(art: RunewardArtConfig): RunewardPaintEnv {
  return { timeTick: 0, signalPowered: false, reducedMotion: false, cache: new Map(), art };
}

function assignment(property: string, value: string): string {
  return `${property} = ${JSON.stringify(value)}`;
}

/** Log of one registered tile painter at the origin of a recording context. */
function tileLog(id: string, art: RunewardArtConfig, pass: RunewardTilePass, neighbours = CELL): string[] {
  const { ctx, lines } = createRecordedContext();
  RUNEWARD_PAINTERS.tiles[id](ctx, 0, 0, TILE, pass, neighbours, envOf(art), false, false);
  return lines;
}

describe('ink drawing under the parchment art', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('gives floor, invisible wall and appearing wall the same calls at the same cell', () => {
    const art = parchmentArt();
    const floor = tileLog('floor', art, 'static');
    expect(floor.length).toBeGreaterThan(10);
    for (const neighbours of [CELL, { ...CELL, shadowMask: 0 }, { ...CELL, hash: 7 }, { ...CELL, cx: 0, cy: 0 }]) {
      const expected = tileLog('floor', art, 'static', neighbours);
      expect(tileLog('invisible_wall', art, 'static', neighbours)).toEqual(expected);
      expect(tileLog('appearing_wall', art, 'static', neighbours)).toEqual(expected);
    }
  });

  it('gives real and fake blue walls the same calls', () => {
    const art = parchmentArt();
    expect(tileLog('blue_wall_fake', art, 'static')).toEqual(tileLog('blue_wall_real', art, 'static'));
  });

  it('draws the floor shadow as clipped hatching, not as a gradient', () => {
    const { ctx, lines } = createRecordedContext();
    paintFloor(ctx, TILE, parchmentArt(), CELL);
    expect(countCalls(lines, 'clip')).toBe(2);
    expect(countCalls(lines, 'createLinearGradient')).toBe(0);
  });

  it('draws the exit and the liquids in the ink colours of the variant', () => {
    const art = parchmentArt();
    const ink = art.ink!;
    const exit = createRecordedContext();
    paintExit(exit.ctx, TILE, art, CELL, 0);
    expect(exit.lines).toContain(assignment('fillStyle', ink.gold));
    const lava = createRecordedContext();
    paintLava(lava.ctx, TILE, art, CELL, 0);
    expect(lava.lines).toContain(assignment('strokeStyle', ink.line));
    expect(lava.lines).toContain(assignment('strokeStyle', art.lava.crest));
    const water = createRecordedContext();
    paintWater(water.ctx, TILE, art, CELL, 0);
    expect(water.lines).toContain(assignment('strokeStyle', art.water.crest));
    expect(water.lines).toContain(INK_CREST_ALPHA);
  });

  it('keeps the wash out of the animated pass and the crests out of the static pass', () => {
    const art = parchmentArt();
    for (const id of ['water', 'fire', 'exit']) {
      const staticLines = tileLog(id, art, 'static');
      const animatedLines = tileLog(id, art, 'animated');
      expect(countCalls(staticLines, 'fillRect')).toBeGreaterThan(0);
      expect(countCalls(animatedLines, 'fillRect')).toBe(0);
      expect(countCalls(animatedLines, 'stroke')).toBeGreaterThan(0);
      expect(countCalls(tileLog(id, art, 'all'), 'fillRect')).toBe(countCalls(staticLines, 'fillRect'));
    }
    expect(tileLog('water', art, 'static').some((line) => line === INK_CREST_ALPHA)).toBe(false);
  });

  it('moves the crests with the clock', () => {
    const art = parchmentArt();
    const at = (timeMs: number): string[] => {
      const { ctx, lines } = createRecordedContext();
      paintWater(ctx, TILE, art, CELL, timeMs, 'animated');
      return lines;
    };
    expect(at(0)).toEqual(at(0));
    expect(at(CLOCK_MS)).not.toEqual(at(0));
  });

  it('outlines the mage in ink with a gold band and a wood staff', () => {
    const art = parchmentArt();
    const { ctx, lines } = createRecordedContext();
    paintMage(ctx, TILE, art, POSE, 0);
    expect(lines).toContain(assignment('strokeStyle', art.ink!.line));
    expect(lines).toContain(assignment('strokeStyle', art.ink!.wood));
    expect(lines).toContain(assignment('fillStyle', art.ink!.gold));
  });

  it('hatches the front of walls from 16 px and washes it below', () => {
    const art = parchmentArt();
    const wall = createRecordedContext();
    paintWall(wall.ctx, TILE, art, OPEN_CELL);
    expect(countCalls(wall.lines, 'clip')).toBe(1);
    const small = createRecordedContext();
    paintWall(small.ctx, SMALL_TILE, art, OPEN_CELL);
    expect(countCalls(small.lines, 'clip')).toBe(0);
  });

  it('marks blue walls with a diamond lattice', () => {
    const blue = createRecordedContext();
    paintBlueWall(blue.ctx, TILE, parchmentArt(), OPEN_CELL);
    expect(countCalls(blue.lines, 'closePath')).toBe(2);
  });
});

describe('tiles that must not pass for floor', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('draws the socket as its own seal in both variants', () => {
    for (const art of [plainArt(), parchmentArt()]) {
      expect(art.seal).toBeDefined();
      for (const neighbours of [CELL, OPEN_CELL, { ...CELL, hash: 7, cx: 0, cy: 0 }]) {
        const floor = tileLog('floor', art, 'static', neighbours);
        expect(tileLog('socket', art, 'static', neighbours)).not.toEqual(floor);
        expect(tileLog('socket', art, 'animated', neighbours)).toEqual([]);
      }
    }
  });

  it('keeps gravel, dirt and hint out of the floor painter so the shared drawing shows them', () => {
    for (const id of ['gravel', 'dirt', 'hint']) {
      expect(RUNEWARD_PAINTERS.tiles[id]).toBeUndefined();
      expect(RUNEWARD_FALLBACK.has(id)).toBe(true);
    }
    for (const id of ['invisible_wall', 'appearing_wall']) {
      expect(RUNEWARD_PAINTERS.tiles[id]).toBe(RUNEWARD_PAINTERS.tiles.floor);
    }
  });
});

describe('default Runeward art', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('has no ink section', () => {
    expect(plainArt().ink).toBeUndefined();
  });

  it('makes no ink calls: no clipped hatching, no ellipse, no curls, no ink alpha', () => {
    const art = plainArt();
    const { ctx, lines } = createRecordedContext();
    paintFloor(ctx, TILE, art, CELL);
    paintWall(ctx, TILE, art, OPEN_CELL);
    paintBlueWall(ctx, TILE, art, OPEN_CELL);
    expect(countCalls(lines, 'clip')).toBe(0);
    expect(countCalls(lines, 'ellipse')).toBe(0);
    for (const pass of ['static', 'animated', 'all'] as const) {
      for (const id of ['water', 'fire', 'exit']) {
        const log = tileLog(id, art, pass);
        expect(log).not.toContain(INK_CREST_ALPHA);
        expect(countCalls(log, 'quadraticCurveTo')).toBe(0);
        expect(countCalls(log, 'closePath')).toBe(0);
      }
    }
  });

  it('draws the liquids and the exit the same in every pass', () => {
    const art = plainArt();
    for (const id of ['water', 'fire', 'exit']) {
      const reference = createRecordedContext();
      if (id === 'water') paintWater(reference.ctx, TILE, art, CELL, 0);
      else if (id === 'fire') paintLava(reference.ctx, TILE, art, CELL, 0);
      else paintExit(reference.ctx, TILE, art, CELL, 0);
      expect(tileLog(id, art, 'static').slice(WRAPPER_HEAD, -WRAPPER_TAIL)).toEqual(reference.lines);
    }
  });
});
