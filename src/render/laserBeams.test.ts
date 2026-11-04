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
import { armRects, BEAM_CORE_TILE, BEAM_HALO_TILE, beamArms, BeamBoard } from './laserBeams';
import { BeamCell, Direction, MirrorAxis, MirrorCorner } from '../core/types';

function board(
  cells: BeamCell[],
  mirrors: Record<string, MirrorAxis> = {},
  emitters: Record<string, Direction> = {},
  fronts: Record<string, MirrorCorner> = {}
): BeamBoard {
  return {
    mirrorFrontAt: (x, y) => fronts[`${x},${y}`],
    beamAt: (x, y) => cells.find((c) => c.x === x && c.y === y),
    mirrorAt: (x, y) => mirrors[`${x},${y}`],
    emitterAt: (x, y) => emitters[`${x},${y}`]
  };
}

const cell = (x: number, y: number, horizontal: boolean, vertical: boolean): BeamCell => ({ x, y, horizontal, vertical });

describe('beamArms', () => {
  it('draws a straight line through a plain cell and a cross where two beams meet', () => {
    const across = cell(1, 1, true, false);
    expect(beamArms(across, board([across]))).toEqual({ N: false, E: true, S: false, W: true });
    const both = cell(1, 1, true, true);
    expect(beamArms(both, board([both]))).toEqual({ N: true, E: true, S: true, W: true });
  });

  it('draws a corner on a slash mirror: a beam travelling east leaves to the north', () => {
    const mirror = cell(2, 2, true, true);
    const feeder = cell(1, 2, true, false);
    const out = cell(2, 1, false, true);
    const arms = beamArms(mirror, board([mirror, feeder, out], { '2,2': 'slash' }, {}));
    expect(arms).toEqual({ N: true, E: false, S: false, W: true });
  });

  it('draws a corner on a backslash mirror fed by an emitter beside it', () => {
    const mirror = cell(2, 2, true, true);
    const arms = beamArms(mirror, board([mirror], { '2,2': 'backslash' }, { '1,2': 'E' }));
    // Travelling east, a backslash turns the beam south.
    expect(arms).toEqual({ N: false, E: false, S: true, W: true });
  });

  it('draws the corner of a one-sided mirror on its front and none on its back', () => {
    const mirror = cell(2, 2, true, true);
    // A backslash mirror facing the north-east corner: a beam travelling east enters through the west side.
    // That is the back, so no corner is drawn and the cell shows the axes it carries.
    const back = beamArms(mirror, board([mirror], { '2,2': 'backslash' }, { '1,2': 'E' }, { '2,2': 'NE' }));
    expect(back).toEqual({ N: true, E: true, S: true, W: true });
    // Travelling west it enters through the east side, which is the front: it turns north.
    const front = beamArms(mirror, board([mirror], { '2,2': 'backslash' }, { '3,2': 'W' }, { '2,2': 'NE' }));
    expect(front).toEqual({ N: true, E: true, S: false, W: false });
  });

  it('draws both corners when a mirror is hit from two sides', () => {
    const mirror = cell(2, 2, true, true);
    const west = cell(1, 2, true, false);
    const east = cell(3, 2, true, false);
    const arms = beamArms(mirror, board([mirror, west, east], { '2,2': 'slash' }));
    expect(arms).toEqual({ N: true, E: true, S: true, W: true });
  });

  it('falls back to the axes the cell carries when no neighbour feeds a mirror', () => {
    const mirror = cell(2, 2, true, true);
    expect(beamArms(mirror, board([mirror], { '2,2': 'slash' }))).toEqual({ N: true, E: true, S: true, W: true });
  });
});

describe('armRects', () => {
  it('joins opposite arms into one continuous bar', () => {
    const rects = armRects({ N: false, E: true, S: false, W: true }, BEAM_HALO_TILE);
    const left = rects.find((r) => r.x === 0);
    const right = rects.find((r) => r.x > 0);
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left!.x + left!.w).toBeGreaterThanOrEqual(right!.x);
    expect(right!.x + right!.w).toBe(1);
  });

  it('keeps the core thinner than the halo and both centred', () => {
    expect(BEAM_CORE_TILE).toBeLessThan(BEAM_HALO_TILE);
    const [rect] = armRects({ N: true, E: false, S: false, W: false }, BEAM_CORE_TILE);
    expect(rect.x + rect.w / 2).toBeCloseTo(0.5);
    expect(rect.y).toBe(0);
  });

  it('draws nothing for a cell without arms', () => {
    expect(armRects({ N: false, E: false, S: false, W: false }, BEAM_HALO_TILE)).toEqual([]);
  });
});
