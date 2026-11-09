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
 * The validator and the block puzzle solver on the ten format 14 ids: a small winnable level holding each one is never
 * reported unwinnable (the checks over-approximate), and the CC2 slime, the transmogrifier and the wired jet are read
 * the way the engine plays them.
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
const HELMET = 'helmet';
const ARROW_LOCKED_KEY = 'validator.issues.arrow_block_locked.label';

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
    id: 'format_14_validator',
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

describe('validator: format 14 ids are never called unwinnable', () => {
  it('lets the player cross a CC2 turtle', () => {
    expect(winnable(level({ terrain: [[MID_X, ROW, 'turtle_cc2']] }))).toBe(true);
  });

  it('lets the player cross a block barrier floor', () => {
    expect(winnable(level({ terrain: [[MID_X, ROW, 'block_barrier_floor']] }))).toBe(true);
  });

  it('lets the player pass a flame jet that is off, and a lit one a wire can put out', () => {
    expect(winnable(level({ terrain: [[MID_X, ROW, 'flame_jet_cc2_off']] }))).toBe(true);
    const wired = level({
      terrain: [[2, ROW, 'signal_button'], [MID_X, ROW, 'flame_jet_cc2_on']],
      signalLinks: [{ fromX: 2, fromY: ROW, toX: MID_X, toY: ROW }]
    });
    expect(winnable(wired)).toBe(true);
  });

  it('still calls an unwired lit CC2 flame jet a barrier without fire boots', () => {
    expect(winnable(level({ terrain: [[MID_X, ROW, 'flame_jet_cc2_on']] }))).toBe(false);
    expect(winnable(level({ terrain: [[MID_X, ROW, 'flame_jet_cc2_on']], items: [[2, ROW, 'boots_fire']] }))).toBe(true);
  });

  it('follows a teleporter of either new kind to a pad of its group', () => {
    for (const pad of ['teleport_random', 'teleport_red_cc2']) {
      const l = level({ terrain: [[3, ROW, pad], [MID_X, ROW, 'wall'], [NEXT_X, ROW, 'wall'], [6, ROW, pad]] });
      expect(winnable(l), pad).toBe(true);
    }
  });

  it('lets the player cross a CC2 transmogrifier and pick up a helmet', () => {
    expect(winnable(level({ terrain: [[MID_X, ROW, 'transmogrifier_cc2']] }))).toBe(true);
    expect(winnable(level({ items: [[2, ROW, HELMET]], entities: [{ type: 'walker', x: 6, y: ROW, dir: 'E' }] }))).toBe(true);
  });

  it('does not flag a free arrow block cross as locked', () => {
    const l = level({ open: true, entities: [block('arrow_block_cross', 3, 1)] });
    expect(winnable(l)).toBe(true);
    expect(LevelValidator.validate(l).issues.some((issue) => issue.i18nKey === ARROW_LOCKED_KEY)).toBe(false);
  });
});

describe('validator: the CC2 slime', () => {
  it('is crossed after a dirt block or an ice block cleared it, two slimes with one block included', () => {
    for (const type of ['dirt_block', 'ice_block']) {
      const l = level({ terrain: [[MID_X, ROW, 'slime_cc2'], [NEXT_X, ROW, 'slime_cc2']], entities: [block(type, 2)] });
      expect(winnable(l), type).toBe(true);
    }
  });

  it('is not crossed without any block', () => {
    expect(winnable(level({ terrain: [[MID_X, ROW, 'slime_cc2']] }))).toBe(false);
  });

  it('does not stop a block that must reach a target beyond it', () => {
    const l = level({ terrain: [[3, ROW, 'slime_cc2'], [6, ROW, 'block_target']], entities: [block('dirt_block', 2)] });
    l.winRule = 'targets';
    expect(LevelValidator.validate(l).valid).toBe(true);
  });
});

describe('validator: the CC2 transmogrifier and blocks', () => {
  const fireLane = (withTransmogrifier: boolean): CompiledLevel =>
    level({
      terrain: [[7, ROW, 'fire'], ...(withTransmogrifier ? ([[5, ROW, 'transmogrifier_cc2']] as Array<[number, number, string]>) : [])],
      entities: [block('dirt_block', 2), block('dirt_block', 3)]
    });

  it('reads a dirt block as possibly an ice block, so a fire it could melt is not a barrier', () => {
    expect(winnable(fireLane(true))).toBe(true);
  });

  it('keeps the fire a barrier when no transmogrifier can turn a dirt block into ice (control)', () => {
    expect(winnable(fireLane(false))).toBe(false);
  });
});

describe('block puzzle solver: format 14 ids', () => {
  const targets = (extra: Setup): CompiledLevel => {
    const l = level({ open: true, ...extra, terrain: [[6, 2, 'block_target'], ...(extra.terrain ?? [])], entities: [block('dirt_block', 3)] });
    l.winRule = 'targets';
    return l;
  };

  it('never calls a level with a format 14 tile or item unsolvable', () => {
    const tiles = ['slime_cc2', 'turtle_cc2', 'block_barrier_floor', 'flame_jet_cc2_on', 'flame_jet_cc2_off', 'teleport_random', 'teleport_red_cc2', 'transmogrifier_cc2'];
    for (const id of tiles) {
      const engine = new GameEngine();
      engine.loadLevel(targets({ terrain: [[4, 2, id]] }));
      expect(BlockPuzzleSolver.verdict(engine).kind, id).not.toBe('unsolvable');
    }
    const engine = new GameEngine();
    engine.loadLevel(targets({ items: [[2, 1, HELMET]] }));
    expect(BlockPuzzleSolver.verdict(engine).kind).not.toBe('unsolvable');
  });
});
