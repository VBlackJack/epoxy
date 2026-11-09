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
 * The validator and the block puzzle solver on the eight format 15 ids: a small winnable level holding each one is never
 * reported unwinnable (the checks over-approximate), and a powered twin a wire can switch on is read as its powered form.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { BlockPuzzleSolver } from './BlockPuzzleSolver';
import { GameEngine } from './GameEngine';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel, EntityPlacement, SignalLink } from './types';

const WIDTH = 10;
const HEIGHT = 5;
const ROW = 2;
const START_X = 1;
const EXIT_X = 8;
const MID_X = 4;
const NEXT_X = 5;
const UNWIRED_OFF_TWIN_KEY = 'validator.issues.unwired_off_twin.label';

interface Setup {
  terrain?: Array<[number, number, string]>;
  items?: Array<[number, number, string]>;
  entities?: EntityPlacement[];
  signalLinks?: SignalLink[];
  /** Keeps the whole room open instead of a one-cell lane along the row. */
  open?: boolean;
}

/** A walled lane (or room) with the player on the left and the exit on the right. */
function level(setup: Setup = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || x === WIDTH - 1 || y === 0 || y === HEIGHT - 1 || (!setup.open && y !== ROW) ? 'wall' : 'floor'))
  );
  terrain[ROW][EXIT_X] = 'exit';
  for (const [x, y, id] of setup.terrain ?? []) terrain[y][x] = id;
  const items: Array<Array<string | null>> = terrain.map((row) => row.map(() => null));
  for (const [x, y, id] of setup.items ?? []) items[y][x] = id;
  return {
    id: 'format_15_validator',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: START_X, y: ROW, dir: 'E' },
    terrain,
    items,
    entities: setup.entities ?? [],
    trapLinks: [],
    cloneLinks: [],
    signalLinks: setup.signalLinks
  };
}

const block = (type: string, x: number, y = ROW): EntityPlacement => ({ type, x, y, dir: 'E' });
const winnable = (l: CompiledLevel): boolean => LevelValidator.validate(l).valid;

beforeEach(() => {
  loadTestConfigs();
});

describe('validator: format 15 ids are never called unwinnable', () => {
  it('lets the player cross dirt_3d, a pop-up wall and an open trap', () => {
    for (const id of ['dirt_3d', 'popup_wall_cc2', 'trap_open']) {
      expect(winnable(level({ terrain: [[MID_X, ROW, id]] })), id).toBe(true);
    }
  });

  it('keeps a hidden wall of the new kind off the way when the room has a detour', () => {
    const l = level({ open: true, terrain: [[MID_X, ROW, 'appearing_wall_any']] });
    expect(winnable(l)).toBe(true);
  });

  it('lets the player cross a CC3D slime with both boots, and a block clear it', () => {
    const boots: Array<[number, number, string]> = [[2, ROW, 'boots_fire'], [3, ROW, 'boots_water']];
    expect(winnable(level({ terrain: [[MID_X, ROW, 'slime_3d']], items: boots }))).toBe(true);
    expect(winnable(level({ terrain: [[MID_X, ROW, 'slime_3d']], entities: [block('dirt_block', 2)] }))).toBe(true);
    expect(winnable(level({ terrain: [[MID_X, ROW, 'slime_3d']], entities: [block('ice_block_3d', 2)] }))).toBe(true);
  });

  it('keeps a CC3D slime a barrier without boots or blocks (control)', () => {
    expect(winnable(level({ terrain: [[MID_X, ROW, 'slime_3d']] }))).toBe(false);
    expect(winnable(level({ terrain: [[MID_X, ROW, 'slime_3d']], items: [[2, ROW, 'boots_fire']] }))).toBe(false);
  });

  it('lets the player cross either powered twin that is off', () => {
    for (const id of ['teleport_red_cc2_off', 'transmogrifier_cc2_off']) {
      expect(winnable(level({ terrain: [[MID_X, ROW, id]] })), id).toBe(true);
    }
  });

  it('reads a wired off teleporter as a pad of its group', () => {
    const l = level({
      terrain: [[2, ROW, 'signal_button'], [3, ROW, 'teleport_red_cc2'], [MID_X, ROW, 'wall'], [NEXT_X, ROW, 'wall'], [6, ROW, 'teleport_red_cc2_off']],
      signalLinks: [{ fromX: 2, fromY: ROW, toX: 6, toY: ROW }]
    });
    expect(winnable(l)).toBe(true);
  });

  it('warns about an off twin no wire ends on, and not about a wired one', () => {
    for (const id of ['teleport_red_cc2_off', 'transmogrifier_cc2_off']) {
      const unwired = LevelValidator.validate(level({ terrain: [[MID_X, ROW, id]] }));
      expect(unwired.issues.some((issue) => issue.i18nKey === UNWIRED_OFF_TWIN_KEY), id).toBe(true);
      const wired = LevelValidator.validate(
        level({ terrain: [[2, ROW, 'signal_button'], [MID_X, ROW, id]], signalLinks: [{ fromX: 2, fromY: ROW, toX: MID_X, toY: ROW }] })
      );
      expect(wired.issues.some((issue) => issue.i18nKey === UNWIRED_OFF_TWIN_KEY), id).toBe(false);
    }
  });

  it('lets an ice_block_3d melt a fire like an ice block does', () => {
    const lane = (type: string): CompiledLevel =>
      level({ terrain: [[7, ROW, 'fire']], entities: [block(type, 2), block('dirt_block', 3)] });
    expect(winnable(lane('ice_block')), 'ice_block').toBe(true);
    expect(winnable(lane('ice_block_3d')), 'ice_block_3d').toBe(true);
  });

  it('lets an ice_block_3d slide over a thief to the cells beyond', () => {
    const l = level({ terrain: [[6, ROW, 'thief'], [7, ROW, 'fire']], entities: [block('ice_block_3d', 2), block('dirt_block', 3)] });
    expect(winnable(l)).toBe(true);
  });
});

describe('block puzzle solver: format 15 ids', () => {
  const targets = (extra: Setup, type = 'dirt_block'): CompiledLevel => {
    const l = level({ open: true, ...extra, terrain: [[6, 2, 'block_target'], ...(extra.terrain ?? [])], entities: [block(type, 3)] });
    l.winRule = 'targets';
    return l;
  };

  it('leaves a level with a format 15 tile unchecked (never unsolvable)', () => {
    const tiles = ['dirt_3d', 'popup_wall_cc2', 'trap_open', 'appearing_wall_any', 'slime_3d', 'teleport_red_cc2_off', 'transmogrifier_cc2_off'];
    for (const id of tiles) {
      const engine = new GameEngine();
      engine.loadLevel(targets({ terrain: [[4, 2, id]] }));
      expect(BlockPuzzleSolver.verdict(engine).kind, id).toBe('not_checked');
    }
  });

  it('leaves a level with an ice_block_3d unchecked', () => {
    const engine = new GameEngine();
    engine.loadLevel(targets({}, 'ice_block_3d'));
    expect(BlockPuzzleSolver.verdict(engine).kind).toBe('not_checked');
  });
});
