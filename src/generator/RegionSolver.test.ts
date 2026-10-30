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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, GridPoint } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { PieceSolver } from './PieceSolver';
import { RegionSolver } from './RegionSolver';

const SIZE = 12;
const SINGLE_TARGET_STATE_BUDGET = 2000;
const MULTI_TARGET_STATE_BUDGET = 20000;
const CHIP_TARGETS: GridPoint[] = [
  { x: 10, y: 1 },
  { x: 10, y: 4 },
  { x: 7, y: 6 },
  { x: 3, y: 10 },
  { x: 6, y: 10 },
  { x: 10, y: 10 },
  { x: 5, y: 3 },
  { x: 2, y: 6 }
];
const BALLS = [
  { type: 'pink_ball', x: 5, y: 2, dir: 'E' as const },
  { type: 'pink_ball', x: 3, y: 5, dir: 'S' as const },
  { type: 'pink_ball', x: 8, y: 8, dir: 'W' as const }
];

function openLevel(chips: GridPoint[], walls: GridPoint[] = []): CompiledLevel {
  const terrain = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  for (const w of walls) terrain[w.y][w.x] = 'wall';
  const items = Array.from({ length: SIZE }, () => new Array<string | null>(SIZE).fill(null));
  for (const c of chips) items[c.y][c.x] = 'chip';
  return {
    id: 'open_region',
    number: 1,
    password: 'OPEN',
    timeLimitSeconds: 0,
    chipsRequired: chips.length,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items,
    entities: BALLS.map((b) => ({ ...b })),
    trapLinks: [],
    cloneLinks: []
  };
}

function interior(): GridPoint[] {
  const cells: GridPoint[] = [];
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) cells.push({ x, y });
  return cells;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

describe('RegionSolver', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('crosses an open region with three monsters in few states', () => {
    const engine = load(openLevel([]));
    const start = RegionSolver.startFrom(engine, interior());
    const result = RegionSolver.solveRegion(engine, start, { x: 10, y: 10 });
    expect(result.moves).not.toBeNull();
    expect(result.statesExplored).toBeLessThan(SINGLE_TARGET_STATE_BUDGET);
  });

  it('collects chips one waypoint at a time within the total budget', () => {
    const engine = load(openLevel(CHIP_TARGETS));
    const start = RegionSolver.startFrom(engine, interior());
    const result = RegionSolver.collectInOrder(engine, start, CHIP_TARGETS);
    expect(result.moves).not.toBeNull();
    expect(result.statesExplored).toBeLessThan(MULTI_TARGET_STATE_BUDGET);
    for (const action of result.moves ?? []) PieceSolver.play(engine, action);
    expect(engine.getChipsRemaining()).toBe(0);
    expect(engine.getPlayer().alive).toBe(true);
  });

  it('returns null quickly when no path exists', () => {
    const wall: GridPoint[] = [];
    for (let y = 1; y < SIZE - 1; y++) wall.push({ x: 6, y });
    const engine = load(openLevel([], wall));
    const start = RegionSolver.startFrom(engine, interior());
    const result = RegionSolver.solveRegion(engine, start, { x: 10, y: 10 });
    expect(result.moves).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('is deterministic', () => {
    const engine = load(openLevel(CHIP_TARGETS));
    const first = RegionSolver.collectInOrder(engine, RegionSolver.startFrom(engine, interior()), CHIP_TARGETS);
    const second = RegionSolver.collectInOrder(engine, RegionSolver.startFrom(engine, interior()), CHIP_TARGETS);
    expect(second.moves).toEqual(first.moves);
    expect(second.statesExplored).toBe(first.statesExplored);
  });
});
