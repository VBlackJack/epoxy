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

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { playDrop } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ccStepTicks, STONE_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

/** Id of the rolling ball entity (what the hurl stone becomes when set down on a CC2-engine level). */
const ROLLING_BALL_ID = 'rolling_ball';

const STONE = STONE_ITEM_ID;
const SIZE = 13;
const TIME_LIMIT_SECONDS = 200;
const PLAYER = { x: 2, y: 5 };
const LANE_Y = 5;
const FIRST_CELL_X = 3;
const ITEM_X = FIRST_CELL_X + 2;
const TAKEN_ITEMS = ['boots_water', 'score_10', 'key_blue'];
const LEFT_ITEMS = ['key_red', 'chip', 'green_chip', 'stopwatch_bonus'];
const FLIGHT_STEPS = 6;
/** A stone far from the lane, so the level has shots from the start. */
const FAR_CORNER = SIZE - 2;

beforeEach(() => {
  loadTestConfigs();
});

/** Ticks a rolling ball takes to cross one cell: the step ticks of its cadence (read from the monster definition). */
const stepTicks = (): number => ccStepTicks(ROLLING_BALL_ID);

function room(cc2: boolean, items: Array<[number, number, string]> = []): CompiledLevel {
  const terrain = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
  );
  const grid: Array<Array<string | null>> = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  grid[FAR_CORNER][FAR_CORNER] = STONE;
  for (const [x, y, id] of items) grid[y][x] = id;
  return {
    id: 'cc2_rolling_ball',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: TIME_LIMIT_SECONDS,
    chipsRequired: 0,
    playerStart: { ...PLAYER, dir: 'E' },
    terrain,
    items: grid,
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(cc2 ? { rulesFlavor: 'cc' as const, cc2: {} as never } : {})
  } as CompiledLevel;
}

function thrower(cc2: boolean, items: Array<[number, number, string]> = []): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(cc2, items));
  engine.getPlayer().keys[STONE] = 1;
  return engine;
}

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

function itemAt(engine: GameEngine, x: number, y: number): string | null {
  return engine.getItems()[y][x];
}

/** The rolling ball a CC2 drop sets rolling: an actor, not a shot. */
function ballOf(engine: GameEngine) {
  return engine.getEntities().find((e) => e.type === ROLLING_BALL_ID);
}

describe('CC2 rolling ball: items', () => {
  for (const id of TAKEN_ITEMS) {
    it(`rolls over ${id} and takes it`, () => {
      const engine = thrower(true, [[ITEM_X, LANE_Y, id]]);
      expect(engine.dropItem(STONE)).toBe(true);
      tickN(engine, stepTicks() * FLIGHT_STEPS);
      expect(itemAt(engine, ITEM_X, LANE_Y)).toBeNull();
      expect(ballOf(engine)).toBeDefined();
    });
  }

  for (const id of LEFT_ITEMS) {
    it(`rolls over ${id} and leaves it`, () => {
      const engine = thrower(true, [[ITEM_X, LANE_Y, id]]);
      expect(engine.dropItem(STONE)).toBe(true);
      tickN(engine, stepTicks() * FLIGHT_STEPS);
      expect(itemAt(engine, ITEM_X, LANE_Y)).toBe(id);
      expect(ballOf(engine)).toBeDefined();
    });
  }

  it('may be thrown at an item in the first cell', () => {
    const engine = thrower(true, [[FIRST_CELL_X, LANE_Y, 'chip']]);
    expect(engine.dropItem(STONE)).toBe(true);
  });

  it('still sets off a bomb', () => {
    const engine = thrower(true, [[ITEM_X, LANE_Y, 'bomb']]);
    expect(engine.dropItem(STONE)).toBe(true);
    tickN(engine, stepTicks() * FLIGHT_STEPS);
    expect(itemAt(engine, ITEM_X, LANE_Y)).toBeNull();
    expect(ballOf(engine)).toBeUndefined();
  });

  it('is stopped by an item on a native level, and refused at once when the item is next to the player', () => {
    const engine = thrower(false, [[ITEM_X, LANE_Y, 'boots_water']]);
    expect(engine.dropItem(STONE)).toBe(true);
    tickN(engine, ConfigRegistry.getGame().timing.hurlStepTicks * FLIGHT_STEPS);
    expect(itemAt(engine, ITEM_X, LANE_Y)).toBe('boots_water');
    expect(engine.getShots()).toEqual([]);
    const refused = thrower(false, [[FIRST_CELL_X, LANE_Y, 'chip']]);
    expect(refused.dropItem(STONE)).toBe(false);
  });
});

describe('CC2 rolling ball: pace', () => {
  it('spends a whole step on the first cell after the drop, then crosses one cell per step', () => {
    const engine = thrower(true);
    expect(playDrop(engine, STONE)).toBe(true);
    const shotX = (): number => ballOf(engine)?.x as number;
    const startX = shotX();
    tickN(engine, stepTicks());
    expect(shotX()).toBe(startX);
    tickN(engine, 1);
    expect(shotX()).toBe(startX + 1);
    tickN(engine, stepTicks() - 1);
    expect(shotX()).toBe(startX + 1);
    tickN(engine, 1);
    expect(shotX()).toBe(startX + 2);
  });

  it('keeps the native stone pace on a native level', () => {
    const stepTicks = ConfigRegistry.getGame().timing.hurlStepTicks;
    const engine = thrower(false);
    expect(engine.dropItem(STONE)).toBe(true);
    const startX = engine.getShots()?.[0].x as number;
    tickN(engine, stepTicks * 2);
    expect((engine.getShots()?.[0].x as number) - startX).toBe(2);
  });
});
