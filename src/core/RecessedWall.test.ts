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

import { GameEngine } from './GameEngine';
import { DifficultyMetrics } from './DifficultyMetrics';
import { buildTestLevel } from '../test/buildTestLevel';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { CompiledLevel, Direction } from './types';

const RECESSED = 'recessed_wall';
const WALL = 'wall';
/** Ticks allowed for a single move or slide to resolve. */
const MAX_WAIT_TICKS = 40;
/** Side of the open room the directional tests run in. */
const ROOM_SIZE = 9;
/** Centre of that room, where the player starts. */
const CENTER = { x: 4, y: 4 };
const OPPOSITE: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const STEP: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 }
};

function engineFor(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** Moves one cell, waiting out the move cooldown. */
function step(engine: GameEngine, dir: Direction): void {
  for (let waited = 0; !engine.attemptPlayerMove(dir); waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error(`move ${dir} refused`);
    engine.tick();
  }
  engine.tick();
}

function settle(engine: GameEngine): void {
  for (let i = 0; i < MAX_WAIT_TICKS; i++) engine.tick();
}

/** Open walled room, player at the centre, with the neighbour in `dir` turned into a recessed wall. */
function roomWithRecessedWall(dir: Direction): CompiledLevel {
  const rows = Array.from({ length: ROOM_SIZE }, (_, y) =>
    Array.from({ length: ROOM_SIZE }, (_, x) =>
      x === 0 || y === 0 || x === ROOM_SIZE - 1 || y === ROOM_SIZE - 1 ? '#' : '.'
    ).join('')
  );
  const level = buildTestLevel(rows);
  level.playerStart = { ...CENTER, dir };
  level.terrain[CENTER.y + STEP[dir].dy][CENTER.x + STEP[dir].dx] = RECESSED;
  return level;
}

describe('recessed wall', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  for (const dir of ['N', 'E', 'S', 'W'] as Direction[]) {
    it(`lets the player in from the ${dir} side and walls the cell once left`, () => {
      const engine = engineFor(roomWithRecessedWall(dir));
      const cell = { x: CENTER.x + STEP[dir].dx, y: CENTER.y + STEP[dir].dy };
      step(engine, dir);
      expect(engine.getPlayer()).toMatchObject({ ...cell, alive: true });
      // Still open while the player stands in it.
      expect(engine.getTerrain()[cell.y][cell.x]).toBe(RECESSED);
      step(engine, OPPOSITE[dir]);
      expect(engine.getPlayer()).toMatchObject(CENTER);
      expect(engine.getTerrain()[cell.y][cell.x]).toBe(WALL);
      // Closed for good.
      settle(engine);
      expect(engine.attemptPlayerMove(dir)).toBe(false);
    });
  }

  it('lets the player cross it and keep walking', () => {
    const engine = engineFor(roomWithRecessedWall('E'));
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.getPlayer()).toMatchObject({ x: CENTER.x + 2, y: CENTER.y });
    expect(engine.getTerrain()[CENTER.y][CENTER.x + 1]).toBe(WALL);
  });

  it('stops a player sliding on ice at the recessed wall, then walls it once left', () => {
    const level = roomWithRecessedWall('E');
    level.terrain[CENTER.y][CENTER.x] = 'ice';
    const engine = engineFor(level);
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayer()).toMatchObject({ x: CENTER.x + 1, y: CENTER.y, alive: true });
    expect(engine.getTerrain()[CENTER.y][CENTER.x + 1]).toBe(RECESSED);
    step(engine, 'E');
    expect(engine.getTerrain()[CENTER.y][CENTER.x + 1]).toBe(WALL);
  });

  it('carries a player on a force floor into the recessed wall and walls it once left', () => {
    const level = roomWithRecessedWall('E');
    level.terrain[CENTER.y][CENTER.x] = 'force_e';
    level.playerStart = { x: CENTER.x - 1, y: CENTER.y, dir: 'E' };
    const engine = engineFor(level);
    step(engine, 'E');
    settle(engine);
    expect(engine.getPlayer()).toMatchObject({ x: CENTER.x + 1, y: CENTER.y, alive: true });
    expect(engine.getTerrain()[CENTER.y][CENTER.x + 1]).toBe(RECESSED);
    step(engine, 'S');
    expect(engine.getTerrain()[CENTER.y][CENTER.x + 1]).toBe(WALL);
  });

  it('does not let a block be pushed into it', () => {
    const level = roomWithRecessedWall('E');
    level.terrain[CENTER.y][CENTER.x + 1] = 'floor';
    level.terrain[CENTER.y][CENTER.x + 2] = RECESSED;
    level.entities = [{ x: CENTER.x + 1, y: CENTER.y, type: 'dirt_block', dir: 'E' }];
    const engine = engineFor(level);
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(engine.getEntities()[0]).toMatchObject({ x: CENTER.x + 1, y: CENTER.y });
    expect(engine.getTerrain()[CENTER.y][CENTER.x + 2]).toBe(RECESSED);
  });

  it('does not let a monster in', () => {
    const level = roomWithRecessedWall('E');
    level.entities = [{ x: CENTER.x + 2, y: CENTER.y, type: 'walker', dir: 'W' }];
    level.playerStart = { x: 1, y: 1, dir: 'S' };
    const engine = engineFor(level);
    for (let i = 0; i < MAX_WAIT_TICKS; i++) {
      engine.tick();
      const monster = engine.getEntities()[0];
      expect(monster && monster.x === CENTER.x + 1 && monster.y === CENTER.y).toBeFalsy();
    }
    expect(engine.getTerrain()[CENTER.y][CENTER.x + 1]).toBe(RECESSED);
  });

  it('replays a solution that crosses a recessed wall', () => {
    const level = { ...buildTestLevel(['#######', '#@.u.E#', '#######']), solution: 'EEEE' };
    const report = DifficultyMetrics.measure(level);
    expect(report.solved).toBe(true);
    expect(report.moves).toBe(4);
    expect(report.irreversibleEvents).toBe(1);
  });
});
