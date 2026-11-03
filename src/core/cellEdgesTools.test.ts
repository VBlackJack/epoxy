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

import { beforeEach, describe, expect, it } from 'vitest';
import { exitReachableWithout } from '../generator/GuardCheck';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { BlockPuzzleSolver } from './BlockPuzzleSolver';
import { GameEngine } from './GameEngine';
import { LevelValidator } from './LevelValidator';
import { Pathfinder } from './Pathfinder';
import { CellEdge, CompiledLevel } from './types';

const SIZE = 9;
const EXIT_X = 7;
const MIDDLE = 4;
const UNREACHABLE_EXIT_KEYS = ['validator.issues.unreachable_exit.label', 'validator.issues.unreachable_exit_proven.label'];

/** A walled room with the player at (1, 4) and the exit at (7, 4); edges on request. */
function exitRoom(cellEdges?: CellEdge[]): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  terrain[MIDDLE][EXIT_X] = 'exit';
  return {
    id: 'edges_exit',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: MIDDLE, dir: 'E' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    ...(cellEdges ? { cellEdges } : {}),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

/** A full-height cut between columns 4 and 5, made of cell edges on floor. */
function cut(): CellEdge[] {
  return Array.from({ length: SIZE - 2 }, (_, i) => ({ x: MIDDLE, y: i + 1, sides: ['E' as const] }));
}

function engineFor(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('cell edges in the tools', () => {
  it('lets the validator see that a cut of edges closes the exit', () => {
    const keys = (level: CompiledLevel): string[] => LevelValidator.validate(level).issues.map((i) => i.i18nKey);
    expect(keys(exitRoom()).some((k) => UNREACHABLE_EXIT_KEYS.includes(k))).toBe(false);
    expect(keys(exitRoom(cut())).some((k) => UNREACHABLE_EXIT_KEYS.includes(k))).toBe(true);
  });

  it('plans no path across a cut of edges, and finds none to the exit objective', () => {
    expect(Pathfinder.findPath(engineFor(exitRoom()), EXIT_X, MIDDLE).moves.length).toBeGreaterThan(0);
    expect(Pathfinder.findPath(engineFor(exitRoom(cut())), EXIT_X, MIDDLE).moves).toEqual([]);
    expect(Pathfinder.findNextObjective(engineFor(exitRoom()))).toEqual({ x: EXIT_X, y: MIDDLE });
    expect(Pathfinder.findNextObjective(engineFor(exitRoom(cut())))).toBeNull();
  });

  it('reads the cut in the guard flood', () => {
    expect(exitReachableWithout(exitRoom(), 'key_red')).toBe(true);
    expect(exitReachableWithout(exitRoom(cut()), 'key_red')).toBe(false);
  });

  it('knows a block cannot be pushed across a cut of edges', () => {
    const targets = (cellEdges?: CellEdge[]): CompiledLevel => {
      const level = exitRoom(cellEdges);
      level.id = 'edges_targets';
      level.winRule = 'targets';
      level.terrain[MIDDLE][EXIT_X] = 'floor';
      level.terrain[MIDDLE][5] = 'block_target';
      level.entities = [{ type: 'dirt_block', x: 3, y: MIDDLE, dir: 'E' }];
      return level;
    };
    expect(BlockPuzzleSolver.verdict(engineFor(targets())).kind).toBe('solved');
    expect(BlockPuzzleSolver.verdict(engineFor(targets(cut().map((e) => ({ ...e, x: 3 }))))).kind).toBe('unsolvable');
  });
});