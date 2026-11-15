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
 * Wave 12, RWK: a rover imitating the walker decides as Lexy's walker does. The rover decide_movement calls the emulatee's
 * (tiletypes.js:2986-2995) and the walker goes forward, else draws one quarter turn from the walker generator, a blocked draw being
 * a wait (tiletypes.js:2805-2822; game.js:1752-1773).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { drawWalkerTurn, type CcGenerators } from './ccGenerators';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const ROVER_CELL = { x: 6, y: ROOM_ROW };
const WALKER_EMULATEE = 7;
/** Enough ticks for the first decision of the slowest rover. */
const RUN_TICKS = 20;
/** A cell walled on its four sides: every way is blocked. */
const BOXED_TERRAIN: Record<string, string> = {
  [`${ROVER_CELL.x - 1},${ROVER_CELL.y}`]: 'wall',
  [`${ROVER_CELL.x + 1},${ROVER_CELL.y}`]: 'wall',
  [`${ROVER_CELL.x},${ROVER_CELL.y - 1}`]: 'wall',
  [`${ROVER_CELL.x},${ROVER_CELL.y + 1}`]: 'wall'
};

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function start(mode: RoomMode): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain: BOXED_TERRAIN, entities: [{ type: 'rover', x: ROVER_CELL.x, y: ROVER_CELL.y, dir: 'E' }] }));
  const rover = engine.getEntities().find((e) => e.type === 'rover');
  if (rover === undefined) throw new Error('the rover is missing');
  rover.emulatee = WALKER_EMULATEE;
  rover.emulationMoves = 0;
  return engine;
}

describe('a rover imitating the walker (RWK)', () => {
  it('draws one quarter turn from the walker generator when blocked ahead and waits when the draw is blocked', () => {
    const engine = start('cc2');
    const w = world(engine);
    const shadow = { ...(w.ccGenerators as CcGenerators) };
    const before = { ...shadow };
    const expectedFacing = drawWalkerTurn(shadow, 'E');
    const rngBefore = w.rng.getState();
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      engine.tick();
      if (w.ccGenerators?.walkerLow !== before.walkerLow || w.ccGenerators?.walkerHigh !== before.walkerHigh) break;
    }
    // The walker generator was consumed by exactly one draw, as Lexy's walker consumes it (tiletypes.js:2805-2822).
    expect({ high: w.ccGenerators?.walkerHigh, low: w.ccGenerators?.walkerLow }).toEqual({ high: shadow.walkerHigh, low: shadow.walkerLow });
    // The shared level generator is not touched: Epoxy's own forward_else_random shuffle drew from it.
    expect(w.rng.getState()).toBe(rngBefore);
    const rover = engine.getEntities().find((e) => e.type === 'rover');
    expect(rover?.dir).toBe(expectedFacing);
    // The drawn way is blocked: a wait, the rover stays in its cell.
    expect(rover?.x).toBe(ROVER_CELL.x);
    expect(rover?.y).toBe(ROVER_CELL.y);
  });

  it('leaves the walker generator alone on a classic level (CC1 rules keep the rover on Epoxy own movement)', () => {
    const engine = start('cc');
    const w = world(engine);
    const before = { ...(w.ccGenerators as CcGenerators) };
    for (let tick = 0; tick < RUN_TICKS; tick++) engine.tick();
    expect({ high: w.ccGenerators?.walkerHigh, low: w.ccGenerators?.walkerLow }).toEqual({ high: before.walkerHigh, low: before.walkerLow });
  });

  it('keeps a native rover on the shared generator', () => {
    const engine = start('native');
    const w = world(engine);
    const rngBefore = w.rng.getState();
    expect(w.ccGenerators).toBeNull();
    for (let tick = 0; tick < RUN_TICKS; tick++) engine.tick();
    expect(w.rng.getState()).not.toBe(rngBefore);
  });
});
