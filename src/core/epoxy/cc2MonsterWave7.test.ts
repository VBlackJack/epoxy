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
 * CC2 wave 7, monsters: a monster loaded on ice decides normally until it has left its load cell (IL), and a yellow tank that
 * stands on ice or a force floor is carried by it unless it still stands on its load cell on ice (YI), and a block refused on a
 * force floor tries once more after the entity pass (FB2), and a monster on a green button toggles the walls when its step ends,
 * after the entity pass (GB, GB2). Every rule is off on classic and native levels.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode, RoomOptions } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { Direction, RuntimeEntity } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const ICE = 'ice';
const FLOOR = 'floor';
const BUG = 'bug';
const START_X = 6;
const SETTLE_TICKS = 3;

function load(mode: RoomMode, options: Omit<RoomOptions, 'mode'>): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: 1, ...options }));
  return engine;
}

const monsterOf = (engine: GameEngine, type: string): RuntimeEntity => {
  const found = engine.getEntities().find((e) => e.type === type);
  if (found === undefined) throw new Error(`the room has a ${type}`);
  return found;
};

describe('monster loaded on ice (IL)', () => {
  const placed = (dir: Direction) => ({
    terrain: { [`${START_X},${ROOM_ROW}`]: ICE },
    entities: [{ type: BUG, x: START_X, y: ROOM_ROW, dir }]
  });
  // Two bugs side by side on ice, facing east, the one behind listed first (so it moves after the one ahead).
  const jam = {
    terrain: { [`${START_X - 1},${ROOM_ROW}`]: ICE, [`${START_X},${ROOM_ROW}`]: ICE },
    entities: [
      { type: BUG, x: START_X - 1, y: ROOM_ROW, dir: 'E' as const },
      { type: BUG, x: START_X, y: ROOM_ROW, dir: 'E' as const }
    ]
  };
  const behindX = (engine: GameEngine): number =>
    Math.min(...engine.getEntities().filter((e) => e.type === BUG).map((e) => e.x));

  it('judges the slide way at its decision: the bug behind another one turns back instead of following it', () => {
    const engine = load('cc2', jam);
    engine.tick();
    expect(behindX(engine)).toBe(START_X - 2);
  });

  it('marks the monster at load and forgets the mark with its first step away', () => {
    const engine = load('cc2', placed('N'));
    expect(monsterOf(engine, BUG).atLoadCell).toBe(true);
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(monsterOf(engine, BUG).atLoadCell).toBeUndefined();
  });

  it('marks nothing when the monster is not loaded on ice', () => {
    const engine = load('cc2', { terrain: { [`${START_X},${ROOM_ROW}`]: FLOOR }, entities: [{ type: BUG, x: START_X, y: ROOM_ROW, dir: 'N' }] });
    expect(monsterOf(engine, BUG).atLoadCell).toBeUndefined();
  });

  it('leaves a classic level and a native level without the mark', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(mode, placed('N'));
      expect(monsterOf(engine, BUG).atLoadCell, mode).toBeUndefined();
    }
  });
});

describe('yellow tank on ice and force floors (YI)', () => {
  const TANK = 'puppet';
  const FORCE_EAST = 'force_e';
  const TANK_X = 5;
  const WATCH_TICKS = 12;

  const tankIn = (engine: GameEngine): RuntimeEntity => monsterOf(engine, TANK);
  const loadTank = (mode: RoomMode, cell: string, dir: Direction): GameEngine =>
    load(mode, { terrain: { [`${TANK_X},${ROOM_ROW}`]: cell }, entities: [{ type: TANK, x: TANK_X, y: ROOM_ROW, dir }] });

  it('takes its pending steer on its load cell on ice', () => {
    const engine = loadTank('cc2', ICE, 'N');
    tankIn(engine).pendingSteer = 'S';
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(tankIn(engine).pendingSteer).toBeUndefined();
    expect(tankIn(engine).y).toBeGreaterThan(ROOM_ROW);
  });

  it('is carried at once by the force floor it is loaded on, its pending steer kept', () => {
    const engine = loadTank('cc2', FORCE_EAST, 'N');
    tankIn(engine).pendingSteer = 'S';
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(tankIn(engine).x).toBeGreaterThan(TANK_X);
    expect(tankIn(engine).y).toBe(ROOM_ROW);
    expect(tankIn(engine).pendingSteer).toBe('S');
  });

  it('is carried along the ice it moved onto, its pending steer kept until it is off', () => {
    const engine = load('cc2', {
      terrain: { [`${TANK_X + 1},${ROOM_ROW}`]: ICE, [`${TANK_X + 2},${ROOM_ROW}`]: ICE, [`${TANK_X + 3},${ROOM_ROW}`]: ICE },
      entities: [{ type: TANK, x: TANK_X, y: ROOM_ROW, dir: 'E' }]
    });
    tankIn(engine).pendingSteer = 'E';
    let onIce = false;
    for (let i = 0; i < WATCH_TICKS && !onIce; i++) {
      engine.tick();
      onIce = tankIn(engine).x > TANK_X;
    }
    expect(onIce).toBe(true);
    tankIn(engine).pendingSteer = 'N';
    for (let i = 0; i < WATCH_TICKS && tankIn(engine).x < TANK_X + 4; i++) engine.tick();
    expect(tankIn(engine).y).toBe(ROOM_ROW);
    expect(tankIn(engine).x).toBeGreaterThanOrEqual(TANK_X + 3);
  });

  it('leaves the classic and the native level alone', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = loadTank(mode, FORCE_EAST, 'N');
      expect(tankIn(engine).atLoadCell, mode).toBeUndefined();
    }
  });
});

describe('block refused on a force floor, retried after the pass (FB2)', () => {
  const BLOCK = 'dirt_block';
  const BLOCK_X = 5;
  const ROW_LENGTH = 6;
  const forceRow: Record<string, string> = {};
  for (let i = 0; i < ROW_LENGTH; i++) forceRow[`${BLOCK_X + i},${ROOM_ROW}`] = 'force_e';

  // The block ahead is listed first, so the one behind takes its turn first (the pass runs the list backwards).
  const options = {
    terrain: forceRow,
    entities: [
      { type: BLOCK, x: BLOCK_X + 1, y: ROOM_ROW, dir: 'E' as const },
      { type: BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' as const }
    ]
  };
  const columns = (engine: GameEngine): number[] =>
    engine
      .getEntities()
      .filter((e) => e.kind === 'block')
      .map((e) => e.x)
      .sort((a, b) => a - b);

  it('moves the block behind in the same tick as the block ahead on a CC2 level', () => {
    const engine = load('cc2', options);
    engine.tick();
    expect(columns(engine)).toEqual([BLOCK_X + 1, BLOCK_X + 2]);
  });

  it('keeps a classic level and a native level where they were', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = load(mode, options);
      engine.tick();
      expect(columns(engine), mode).toEqual([BLOCK_X, BLOCK_X + 1]);
    }
  });
});

describe('monster on a green button (GB, GB2)', () => {
  const BUTTON = 'button_green';
  const WALL_CLOSED = 'toggle_wall_closed';
  const WALL_OPEN = 'toggle_wall_open';
  const BALL = 'pink_ball';
  const BALL_X = 5;
  const WALL_CELL = { x: 3, y: 3 };
  const WATCH_TICKS = 30;
  const options = {
    terrain: {
      [`${BALL_X + 1},${ROOM_ROW}`]: BUTTON,
      [`${BALL_X + 2},${ROOM_ROW}`]: 'wall',
      [`${WALL_CELL.x},${WALL_CELL.y}`]: WALL_CLOSED
    },
    entities: [{ type: BALL, x: BALL_X, y: ROOM_ROW, dir: 'E' as const }]
  };
  const wallOf = (engine: GameEngine): string => engine.getTerrain()[WALL_CELL.y][WALL_CELL.x];

  /** The tick, counted from 1, at which the walls first changed; 0 when they never did. */
  function toggleTick(mode: RoomMode): { tick: number; ballArrival: number } {
    const engine = load(mode, options);
    let tick = 0;
    let ballArrival = 0;
    for (let i = 1; i <= WATCH_TICKS && tick === 0; i++) {
      engine.tick();
      if (ballArrival === 0 && monsterOf(engine, BALL).x > BALL_X) ballArrival = i;
      if (wallOf(engine) === WALL_OPEN) tick = i;
    }
    return { tick, ballArrival };
  }

  it('does not toggle the walls in the tick the monster arrives, but a few passes later, on a CC2 level', () => {
    const { tick, ballArrival } = toggleTick('cc2');
    expect(ballArrival).toBeGreaterThan(0);
    expect(tick).toBeGreaterThan(ballArrival);
  });

  it('toggles at the same tick as a classic level, which always queued the press', () => {
    expect(toggleTick('cc2').tick).toBe(toggleTick('cc').tick);
  });

  it('still toggles at once on a native level', () => {
    const { tick, ballArrival } = toggleTick('native');
    expect(ballArrival).toBeGreaterThan(0);
    expect(tick).toBe(ballArrival);
  });

  it('applies a queued green toggle after the entity pass: a monster of that pass still meets the old walls', () => {
    const pusherX = 7;
    const walkerX = 3;
    const engine = load('cc2', {
      terrain: {
        [`${pusherX},${ROOM_ROW}`]: BUTTON,
        [`${walkerX + 1},${ROOM_ROW}`]: WALL_CLOSED
      },
      entities: [
        { type: BALL, x: pusherX, y: ROOM_ROW, dir: 'E' },
        { type: BALL, x: walkerX, y: ROOM_ROW, dir: 'E' }
      ]
    });
    const w = (engine as unknown as { w: EpoxyWorld }).w;
    const [pusher, walker] = w.entities;
    pusher.cooldownTicks = WATCH_TICKS;
    w.ccArrivals.push({ uid: pusher.uid, x: pusherX, y: ROOM_ROW, action: 'toggle_walls', due: w.ccMonsterClock });
    engine.tick();
    expect(engine.getTerrain()[ROOM_ROW][walkerX + 1]).toBe(WALL_OPEN);
    expect(walker.x).toBeLessThanOrEqual(walkerX);
  });
});
