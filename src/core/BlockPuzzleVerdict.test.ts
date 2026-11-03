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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { loadTestConfigs } from '../test/loadTestConfigs';
import { BlockPuzzleSolver } from './BlockPuzzleSolver';
import { GameEngine } from './GameEngine';
import { CompiledLevel, EntityPlacement, WinRule } from './types';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  m: 'floor',
  $: 'floor',
  '*': 'block_target',
  T: 'block_target',
  I: 'ice',
  D: 'door_red',
  R: 'recessed_wall',
  X: 'trap',
  C: 'clone_machine',
  B: 'button_brown'
};

/** Rows: # wall, . floor, P player, T target, $ block, * block on a target, I ice. */
function room(rows: string[], winRule: WinRule = 'targets'): CompiledLevel {
  let start = { x: 1, y: 1 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === '$' || ch === '*') entities.push({ type: 'dirt_block', x, y, dir: 'S' });
      if (ch === 'm') entities.push({ type: 'bug', x, y, dir: 'S' });
      return TERRAIN_CODES[ch];
    })
  );
  return {
    id: 'verdict_room',
    ...(winRule === 'exit' ? {} : { winRule }),
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'E' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function engineFor(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('BlockPuzzleSolver.verdict', () => {
  it('still solves a room with a chip on the path', () => {
    const level = room(['#####', '#P$T#', '#####']);
    level.items[1][2] = 'chip';
    expect(BlockPuzzleSolver.verdict(engineFor(level))).toEqual({ kind: 'solved', pushes: 1 });
  });

  it('counts the pushes of a solvable room', () => {
    const verdict = BlockPuzzleSolver.verdict(engineFor(room(['#####', '#P$T#', '#####'])));
    expect(verdict).toEqual({ kind: 'solved', pushes: 1 });
  });

  it('solves a room whose blocks already cover every target in no push', () => {
    const verdict = BlockPuzzleSolver.verdict(engineFor(room(['#####', '#P*.#', '#####'])));
    expect(verdict).toEqual({ kind: 'solved', pushes: 0 });
  });

  it('proves a room unsolvable when the only block is stuck against a wall', () => {
    const level = room(['#####', '#P$.#', '#..T#', '#####']);
    expect(BlockPuzzleSolver.verdict(engineFor(level))).toEqual({ kind: 'unsolvable' });
  });

  it('proves a room unsolvable when it has fewer blocks than targets', () => {
    const level = room(['######', '#P$TT#', '######']);
    expect(BlockPuzzleSolver.verdict(engineFor(level))).toEqual({ kind: 'unsolvable' });
  });

  it('gives no verdict when the search budget runs out', () => {
    const level = room(['#####', '#P$T#', '#####']);
    expect(BlockPuzzleSolver.verdict(engineFor(level), 1)).toEqual({ kind: 'not_checked' });
  });

  it('does not judge an area a block can slide into', () => {
    const level = room(['#######', '#P$I.T#', '#######']);
    expect(BlockPuzzleSolver.verdict(engineFor(level))).toEqual({ kind: 'not_checked' });
  });

  it('judges nothing without targets, on a receivers level, or without blocks', () => {
    expect(BlockPuzzleSolver.verdict(engineFor(room(['#####', '#P$.#', '#####'])))).toEqual({ kind: 'none' });
    expect(BlockPuzzleSolver.verdict(engineFor(room(['#####', '#P$T#', '#####'], 'receivers')))).toEqual({
      kind: 'none'
    });
    expect(BlockPuzzleSolver.verdict(engineFor(room(['#####', '#P.T#', '#####'])))).toEqual({ kind: 'none' });
  });

  it('never judges what it does not model, whatever the map would say', () => {
    const solvable = ['#######', '#P$.T##', '#######'];
    const notChecked = (rows: string[], mutate?: (level: CompiledLevel) => void): void => {
      const level = room(rows);
      mutate?.(level);
      expect(BlockPuzzleSolver.verdict(engineFor(level))).toEqual({ kind: 'not_checked' });
    };
    // A monster standing between the block and its target.
    notChecked(['#######', '#P$mT##', '#######']);
    // A door somewhere on the map.
    notChecked(['#######', '#P$.TD#', '#######']);
    // A key on the map, even with the way open.
    notChecked(solvable, (level) => {
      level.items[1][3] = 'key_red';
    });
    // A cloner with one block for three targets.
    notChecked(['########', '#P$CTTT#', '########'], (level) => {
      level.cloneLinks.push({
        buttonX: 3,
        buttonY: 1,
        clonerX: 3,
        clonerY: 1,
        templateType: 'dirt_block',
        templateDir: 'S'
      });
    });
    // A recessed wall in the path.
    notChecked(['#######', '#P$RT##', '#######']);
    // A block standing on a trap.
    notChecked(['#######', '#PXT###', '#######'], (level) => {
      level.entities.push({ type: 'dirt_block', x: 2, y: 1, dir: 'S' });
    });
    // Ice anywhere, even far from the blocks.
    notChecked(['#######', '#P$.TI#', '#######']);
  });

  it('says nothing about a level won by an exit with brown buttons', () => {
    const level = room(['#######', '#P$BBE#', '#######'], 'exit');
    level.terrain[1][5] = 'exit';
    expect(BlockPuzzleSolver.verdict(engineFor(level))).toEqual({ kind: 'none' });
  });

  it('does not search a playable area above the watch cap', () => {
    const size = 60;
    const rows = Array.from({ length: size }, (_, y) =>
      y === 0 || y === size - 1 ? '#'.repeat(size) : `#${'.'.repeat(size - 2)}#`
    );
    rows[1] = `#P$T${'.'.repeat(size - 5)}#`;
    expect(BlockPuzzleSolver.verdict(engineFor(room(rows)))).toEqual({ kind: 'not_checked' });
  });

  it('agrees with isStuck: a proven dead end is unsolvable, a solvable room is not stuck', () => {
    const dead = engineFor(room(['#####', '#P$.#', '#..T#', '#####']));
    expect(BlockPuzzleSolver.isStuck(dead)).toBe(true);
    const fine = engineFor(room(['#####', '#P$T#', '#####']));
    expect(BlockPuzzleSolver.isStuck(fine)).toBe(false);
  });
});
