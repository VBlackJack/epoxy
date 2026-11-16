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
 * CC2 engine, wave 14 (SFM, block half): a block the player pushed onto a plain cell holds its 12-frame out-of-turn step until the
 * frame pre-pass settles it (Lexy game.js:2218-2242; map033 t12-t16; defs.js:199-202 allow_double_cooldowns). While it is held it
 * is a moving block: it cannot be pushed, and a slider behind it does not end its step early.
 * The "fails without the rule" half of these tests needs the pre-pass wired in the tick (integration of the wave).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playMove } from '../../test/cc2Play';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const BLOCK = 'dirt_block';
const ICE_BLOCK = 'ice_block';
const BLOCK_X = 3;
const LANDED_X = 4;
/** The tick the pushed block lands in: frame 0 of the tic four after the push (game.js:2218-2242; map033 t12-t16). */
const LANDING_TICK = 5;
/** The base landing tick of the same push in the main pass. */
const BASE_LANDING_TICK = 4;
const SLIDER_X = 5;
const WATER_X = SLIDER_X + 1;
const HELD_WAIT_PASSES = 3;

const blockOf = (engine: GameEngine, type = BLOCK) => engine.getEntities().find((e) => e.type === type);

function pushed(mode: RoomMode): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: 2, entities: [{ type: BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }] }));
  expect(playMove(engine, 'E').accepted).toBe(true);
  return engine;
}

describe('CC2 engine: a block pushed onto a plain cell holds its step', () => {
  it('is a moving block until frame 0 of the fifth tick, and cannot be pushed meanwhile', () => {
    const engine = pushed('cc2');
    for (let pass = 1; pass <= HELD_WAIT_PASSES; pass++) {
      expect(engine.getTick()).toBe(pass);
      const block = blockOf(engine);
      expect(block?.x, `tick ${pass}`).toBe(LANDED_X);
      expect(block?.arrivalTicks, `tick ${pass}`).toBeDefined();
      expect(block?.cc2ArrivalWait, `tick ${pass}`).toBeDefined();
      engine.getPlayer().moveCooldown = 0;
      expect(playMove(engine, 'E').moved, `push at tick ${pass}`).toBe(false);
      expect(blockOf(engine)?.x, `push at tick ${pass}`).toBe(LANDED_X);
    }
  });

  it('lands one tick later than the main pass it ended in before', () => {
    const engine = pushed('cc2');
    let landedAt = 0;
    while (blockOf(engine)?.arrivalTicks !== undefined && engine.getTick() < LANDING_TICK + 2) {
      engine.tick();
      landedAt = engine.getTick();
    }
    expect(landedAt).toBe(LANDING_TICK);
    expect(landedAt).toBe(BASE_LANDING_TICK + 1);
    const landed = blockOf(engine);
    expect(landed?.cc2ArrivalWait).toBeUndefined();
    expect(landed?.cc2ArrivalFrame).toBeUndefined();
  });

  it('holds nothing on a classic-rules or a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = pushed(mode);
      expect(blockOf(engine)?.cc2ArrivalWait, mode).toBeUndefined();
      expect(blockOf(engine)?.cc2ArrivalFrame, mode).toBeUndefined();
      expect(blockOf(engine)?.cc2SlideFrame, mode).toBeUndefined();
    }
  });
});

describe('CC2 engine: a slider behind a held block', () => {
  it('leaves the held block alone: its step does not end early, so the water under it stays', () => {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'cc2',
        startX: 1,
        terrain: { [`${WATER_X},${ROOM_ROW}`]: 'water', [`${SLIDER_X},${ROOM_ROW}`]: 'ice' },
        entities: [
          { type: ICE_BLOCK, x: SLIDER_X, y: ROOM_ROW, dir: 'E' },
          { type: BLOCK, x: WATER_X, y: ROOM_ROW, dir: 'E' }
        ]
      })
    );
    const slider = blockOf(engine, ICE_BLOCK);
    const held = blockOf(engine);
    if (slider === undefined || held === undefined) throw new Error('fixture');
    // The held block's step ends in the pass just coming (arrivalTicks 1), but the pre-pass holds it for a later tick.
    slider.isSliding = true;
    slider.cooldownTicks = 0;
    held.arrivalTicks = 1;
    held.cc2ArrivalWait = HELD_WAIT_PASSES;
    held.cc2ArrivalFrame = 0;
    const heldX = held.x;
    engine.tick();
    expect(held.arrivalTicks).toBe(1);
    expect(held.cc2ArrivalWait).toBeDefined();
    expect(held.x).toBe(heldX);
    expect(engine.getEntities()).toContain(held);
    expect(engine.getTerrain()[ROOM_ROW][WATER_X]).toBe('water');
  });
});
