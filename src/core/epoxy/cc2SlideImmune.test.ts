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
 * CC2 engine, wave 11 (SI): a monster holding the tool that protects against the slide of its floor (force boots on a force
 * floor, cleats on ice) is not carried by it and keeps the full step time (Lexy game.js:2178-2186; make_actor_decision never
 * sets the pending slide for an immune actor). CC2 engine only: a classic or native level keeps the slide.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { CC_MONSTER_STEP_TICKS } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const MONSTER = 'bug';
const FORCE_BOOTS = 'boots_force';
const CLEATS = 'boots_ice';
const FORCE_EAST = 'force_e';
const ICE = 'ice';
const WALL = 'wall';
const CELL_X = 6;
const FLOOR_STEP_TICKS = CC_MONSTER_STEP_TICKS / 2;
const TICKS = 40;

function monsterOf(engine: GameEngine): RuntimeEntity {
  const found = engine.getEntities().find((e) => e.type === MONSTER);
  if (found === undefined) throw new Error('the room has a bug');
  return found;
}

function load(mode: RoomMode, terrain: Record<string, string>, dir: 'N' | 'E', tool: string | undefined, startX = CELL_X): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: 1, terrain, entities: [{ type: MONSTER, x: startX, y: ROOM_ROW, dir }] }));
  // The monster has moved on from its load cell: the floor under it is an ordinary slide.
  for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  if (tool !== undefined) monsterOf(engine).heldTools = [tool];
  return engine;
}

describe('slideImmune: force boots on a force floor', () => {
  const forceRow = (): Record<string, string> => ({ [`${CELL_X},${ROOM_ROW}`]: FORCE_EAST });

  it('does not carry a bug that holds force boots (CC2 engine)', () => {
    const engine = load('cc2', forceRow(), 'N', FORCE_BOOTS);
    engine.tick();
    // Free of the floor it decides for itself: a bug turns left (west) first.
    expect(monsterOf(engine).x).toBe(CELL_X - 1);
  });

  it('carries the same bug without the boots', () => {
    const engine = load('cc2', forceRow(), 'N', undefined);
    engine.tick();
    expect(monsterOf(engine).x).toBe(CELL_X + 1);
  });

  it.each(['cc', 'native'] as RoomMode[])('treats the boots like no boots on a %s level', (mode) => {
    const shod = load(mode, forceRow(), 'N', FORCE_BOOTS);
    const free = load(mode, forceRow(), 'N', undefined);
    for (let t = 0; t < TICKS; t++) {
      shod.tick();
      free.tick();
      expect({ x: monsterOf(shod).x, y: monsterOf(shod).y }).toEqual({ x: monsterOf(free).x, y: monsterOf(free).y });
    }
  });

  /** Ticks between the bug reaching the second force cell and the third, walking east along three force cells. */
  function floorStepTicks(mode: RoomMode, tool: string | undefined): number {
    const terrain: Record<string, string> = {};
    for (let x = CELL_X - 1; x <= CELL_X + 4; x++) {
      terrain[`${x},${ROOM_ROW - 1}`] = WALL;
      terrain[`${x},${ROOM_ROW + 1}`] = WALL;
      if (x >= CELL_X) terrain[`${x},${ROOM_ROW}`] = FORCE_EAST;
    }
    const engine = load(mode, terrain, 'E', tool, CELL_X - 1);
    const reached: Record<number, number> = {};
    for (let t = 1; t <= TICKS; t++) {
      engine.tick();
      const x = monsterOf(engine).x;
      if (reached[x] === undefined) reached[x] = t;
    }
    return reached[CELL_X + 2] - reached[CELL_X + 1];
  }

  it('keeps the full step time onto the force floor when the bug holds the boots', () => {
    expect(floorStepTicks('cc2', FORCE_BOOTS)).toBe(CC_MONSTER_STEP_TICKS);
  });

  it('takes the half step without the boots', () => {
    expect(floorStepTicks('cc2', undefined)).toBe(FLOOR_STEP_TICKS);
  });
});

describe('slideImmune: cleats on ice', () => {
  const iceCell = (): Record<string, string> => ({ [`${CELL_X},${ROOM_ROW}`]: ICE });
  const where = (engine: GameEngine): { x: number; y: number } => ({ x: monsterOf(engine).x, y: monsterOf(engine).y });

  it('slides a bug without cleats straight on, and lets a bug with cleats decide', () => {
    const slid = load('cc2', iceCell(), 'N', undefined);
    slid.tick();
    expect(where(slid)).toEqual({ x: CELL_X, y: ROOM_ROW - 1 });
    const shod = load('cc2', iceCell(), 'N', CLEATS);
    shod.tick();
    expect(where(shod)).toEqual({ x: CELL_X - 1, y: ROOM_ROW });
  });

  it.each(['cc', 'native'] as RoomMode[])('keeps the ice slide of a bug that holds cleats on a %s level', (mode) => {
    const slid = load(mode, iceCell(), 'N', CLEATS);
    const free = load(mode, iceCell(), 'N', undefined);
    for (let t = 0; t < TICKS; t++) {
      slid.tick();
      free.tick();
      expect(where(slid)).toEqual(where(free));
    }
  });
});
