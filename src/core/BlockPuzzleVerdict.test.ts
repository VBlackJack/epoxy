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
  $: 'floor',
  '*': 'block_target',
  T: 'block_target',
  I: 'ice'
};

/** Rows: # wall, . floor, P player, T target, $ block, * block on a target, I ice. */
function room(rows: string[], winRule: WinRule = 'targets'): CompiledLevel {
  let start = { x: 1, y: 1 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === '$' || ch === '*') entities.push({ type: 'dirt_block', x, y, dir: 'S' });
      return TERRAIN_CODES[ch];
    })
  );
  return {
    id: 'verdict_room',
    winRule,
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

  it('agrees with isStuck: a proven dead end is unsolvable, a solvable room is not stuck', () => {
    const dead = engineFor(room(['#####', '#P$.#', '#..T#', '#####']));
    expect(BlockPuzzleSolver.isStuck(dead)).toBe(true);
    const fine = engineFor(room(['#####', '#P$T#', '#####']));
    expect(BlockPuzzleSolver.isStuck(fine)).toBe(false);
  });
});
