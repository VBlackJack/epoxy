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
import { loadTestConfigs } from '../test/loadTestConfigs';
import { GameEngine } from './GameEngine';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, Direction, EntityPlacement } from './types';

const HIDDEN = 'validator.issues.hidden_by_block.label';
const CHIP_ITEM = 'chip';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  $: 'floor',
  c: 'floor',
  E: 'exit',
  W: 'water',
  I: 'ice',
  '4': 'ice_se',
  '3': 'ice_sw'
};

/** Rows: # wall, . floor, P player, $ block, c chip on floor, E exit, W water, I ice, 4 ice_se corner. */
function grid(rows: string[], blocks: EntityPlacement | EntityPlacement[]): CompiledLevel {
  let start = { x: 0, y: 0 };
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      return TERRAIN_CODES[ch];
    })
  );
  const items = rows.map((row) => [...row].map((ch) => (ch === 'c' ? CHIP_ITEM : null)));
  return {
    id: 'ice_grid',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'S' },
    terrain,
    items,
    entities: Array.isArray(blocks) ? blocks : [blocks],
    trapLinks: [],
    cloneLinks: []
  };
}

function hiddenCount(level: CompiledLevel): number {
  const issue = LevelValidator.validate(level).issues.find((i) => i.i18nKey === HIDDEN);
  return (issue?.params?.count as number | undefined) ?? 0;
}

const LANE_BLOCK: EntityPlacement = { type: 'dirt_block', x: 2, y: 1, dir: 'S' };
const CORNER_BLOCK: EntityPlacement = { type: 'dirt_block', x: 2, y: 2, dir: 'S' };

describe('hidden_by_block follows a slide on ice', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('flags a chip at the far end of an ice lane a block can enter', () => {
    expect(hiddenCount(grid(['#########', '#P$IIIIc#', '#########'], LANE_BLOCK))).toBe(1);
  });

  it('flags a chip only a slide can reach, past an ice corner the pusher cannot stand behind', () => {
    const rows = ['#####c#', '#####I#', '#P$II4#', '#######'];
    expect(hiddenCount(grid(rows, CORNER_BLOCK))).toBe(1);
  });

  it('does not flag that chip when the lane is plain floor', () => {
    const rows = ['#####c#', '#####.#', '#P$...#', '#######'];
    expect(hiddenCount(grid(rows, CORNER_BLOCK))).toBe(0);
  });

  it('does not flag a chip beside the lane that the slide never reaches', () => {
    const rows = ['###c###', '#P$IIII', '#######'];
    expect(hiddenCount(grid(rows, LANE_BLOCK))).toBe(0);
  });

  it('explores a second lane through an entry cell another lane already reached', () => {
    // The first block's lane east marks the shared ice cell (3,3); the second block comes from the north
    // and slides south through it, round the ice_sw corner at (3,4), to the chip. Nobody can stand at (2,4).
    const rows = ['#.....#', '#.....#', '#.....#', '#.$II.#', '###3Ic#', '#######'];
    const blocks: EntityPlacement[] = [
      { type: 'dirt_block', x: 2, y: 3, dir: 'S' },
      { type: 'dirt_block', x: 3, y: 1, dir: 'S' }
    ];
    expect(hiddenCount(grid(rows, blocks))).toBe(1);
  });

  it('flags a cell the slide only passes over, since another block could stop it there', () => {
    const rows = ['#########', '#P$IcIII#', '#########'];
    expect(hiddenCount(grid(rows, LANE_BLOCK))).toBe(1);
  });

  it('does not flag a chip behind water at the end of the lane, since the block sinks there', () => {
    expect(hiddenCount(grid(['#########', '#P$IIIWc#', '#########'], LANE_BLOCK))).toBe(0);
  });
});

const UNREACHABLE_EXIT = 'validator.issues.unreachable_exit.label';
const KEY_ITEM = 'key_yellow';
const MAX_ENGINE_TICKS = 200;

const GATE_TERRAIN: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  E: 'exit',
  I: 'ice',
  D: 'door_yellow',
  S: 'socket'
};

/** One-row corridor: P player, I ice, D yellow door, S socket, E exit; items row: k yellow key, c chip. */
function corridor(terrainRow: string, itemRow: string, chipsRequired = 0): CompiledLevel {
  const wallRow = '#'.repeat(terrainRow.length);
  const rows = [wallRow, terrainRow, wallRow];
  const itemRows = [wallRow, itemRow, wallRow];
  const start = { x: terrainRow.indexOf('P'), y: 1 };
  return {
    id: 'ice_gate',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired,
    playerStart: { ...start, dir: 'E' },
    terrain: rows.map((row) => [...row].map((ch) => GATE_TERRAIN[ch])),
    items: itemRows.map((row) =>
      [...row].map((ch) => (ch === 'k' ? KEY_ITEM : ch === 'c' ? CHIP_ITEM : null))
    ),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function exitUnreachable(level: CompiledLevel): boolean {
  return LevelValidator.validate(level).issues.some((i) => i.i18nKey === UNREACHABLE_EXIT);
}

/** Plays the moves in the real engine, letting every slide run out, and reports whether the level was won. */
function engineWins(level: CompiledLevel, moves: Direction[]): boolean {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const dir of moves) {
    let waited = 0;
    while (!engine.attemptPlayerMove(dir)) {
      engine.tick();
      if (++waited > MAX_ENGINE_TICKS) throw new Error(`move ${dir} refused`);
    }
    for (let i = 0; i < MAX_ENGINE_TICKS && (engine.getPlayer().isSliding || i === 0); i++) engine.tick();
  }
  return engine.isLevelCompleted();
}

describe('a slide opens the door or socket it reaches', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('opens a door with a key picked up on the ice before it', () => {
    const level = corridor('#PIIIDE#', '#..k....');
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, ['E', 'E'])).toBe(true);
  });

  it('opens a door with a key held before the slide starts', () => {
    const level = corridor('#.PIIDE#', '#k......#');
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, ['W', 'E', 'E', 'E'])).toBe(true);
  });

  it('still bounces off a door whose key is nowhere', () => {
    const level = corridor('#PIIIDE#', '#.......#');
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, ['E', 'E'])).toBe(false);
  });

  it('opens a socket once the chips collected on the ice suffice', () => {
    const level = corridor('#PIIISE#', '#..c....#', 1);
    expect(exitUnreachable(level)).toBe(false);
    expect(engineWins(level, ['E', 'E'])).toBe(true);
  });

  it('bounces off a socket while chips are still missing', () => {
    const level = corridor('#PIIISE#', '#..c....#', 2);
    expect(exitUnreachable(level)).toBe(true);
    expect(engineWins(level, ['E', 'E'])).toBe(false);
  });
});
