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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { SeededRandom } from '../core/Random';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { HubGrid } from './HubGrid';
import { Box } from './LevelAssembler';

const RANDOM_SEED = 20261110;
const SCENARIO_COUNT = 40;
const OPEN_CELLS = 120;
const CLAIM_COUNT = 40;
const BOX_COUNT = 4;
const BOX_SIZE = 5;
const SEGMENT_COUNT = 4;
/** A touching key that matches no cell, and one that matches a cell of the scenarios. */
const NO_TOUCHING = -1;

describe('HubGrid indexed corridor fit', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('answers like corridorFits for every cell, with claims, boxes, an extra box and a touching cell', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const rng = new SeededRandom(RANDOM_SEED);
    for (let scenario = 0; scenario < SCENARIO_COUNT; scenario++) {
      const grid = new HubGrid(cfg.hub);
      const cells = grid.width * grid.height;
      for (let i = 0; i < OPEN_CELLS; i++) {
        const k = rng.nextInt(0, cells - 1);
        grid.open(grid.point(k), rng.nextInt(0, SEGMENT_COUNT), true);
      }
      const claims = new Map<number, number>();
      for (let i = 0; i < CLAIM_COUNT; i++) claims.set(rng.nextInt(0, cells - 1), rng.nextInt(0, SEGMENT_COUNT));
      const randomBox = (): Box => {
        const x0 = rng.nextInt(0, grid.width - BOX_SIZE);
        const y0 = rng.nextInt(0, grid.height - BOX_SIZE);
        return { x0, y0, x1: x0 + BOX_SIZE - 1, y1: y0 + BOX_SIZE - 1 };
      };
      const boxes = Array.from({ length: BOX_COUNT }, randomBox);
      const extra = randomBox();
      const touching = rng.nextInt(0, cells - 1);
      const seg = rng.nextInt(0, SEGMENT_COUNT);

      grid.indexClaims(claims);
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          const p = { x, y };
          expect(grid.fitsIndexed(x, y, seg, boxes)).toBe(grid.corridorFits(p, seg, boxes, claims));
          expect(grid.fitsIndexed(x, y, seg, boxes, extra)).toBe(grid.corridorFits(p, seg, [...boxes, extra], claims));
          expect(grid.fitsIndexed(x, y, seg, boxes, null, touching)).toBe(grid.corridorFits(p, seg, boxes, claims, touching));
          expect(grid.fitsIndexed(x, y, seg, boxes, null, NO_TOUCHING)).toBe(grid.corridorFits(p, seg, boxes, claims));
          expect(grid.isClaimed(y * grid.width + x)).toBe(claims.has(y * grid.width + x));
        }
      }
    }
  });

  it('forgets the claims it was given before when it is indexed again', () => {
    const cfg = ConfigRegistry.getGame().procedural!;
    const grid = new HubGrid(cfg.hub);
    const cell = grid.key({ x: 10, y: 10 });
    grid.indexClaims(new Map([[cell, 1]]));
    expect(grid.isClaimed(cell)).toBe(true);
    grid.indexClaims(new Map());
    expect(grid.isClaimed(cell)).toBe(false);
    expect(grid.fitsIndexed(10, 10, 1, [])).toBe(true);
  });
});
