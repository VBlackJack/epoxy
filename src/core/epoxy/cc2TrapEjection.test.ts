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
 * CC2 engine, wave 10 (TE, TEC): the player's brown press at his step end ejects whatever the trap holds, out of turn (Lexy trap
 * add_press -> attempt_out_of_turn_step, tiletypes.js:1764-1779). A block is pushed out its facing; a monster steps once and keeps
 * one extra cooldown tick, counted once per tic (do_extra_cooldown, game.js:2218-2242). Other levels press at the start of the step.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { EntityPlacement } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const BROWN_BUTTON = 'button_brown';
const TRAP = 'trap';
const BUTTON_X = 3;
const TRAP_X = 9;
const TRAP_Y = 9;
const OUT_X = 8;
const MAX_TICKS = 40;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function load(mode: RoomMode, held: EntityPlacement): GameEngine {
  const level = room({ mode, terrain: { [`${BUTTON_X},${ROOM_ROW}`]: BROWN_BUTTON, [`${TRAP_X},${TRAP_Y}`]: TRAP }, entities: [held] });
  level.trapLinks = [{ buttonX: BUTTON_X, buttonY: ROOM_ROW, trapX: TRAP_X, trapY: TRAP_Y }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function stepOntoButton(engine: GameEngine): void {
  playMove(engine, 'E');
  for (let guard = 0; engine.getPlayer().moveCooldown > 0 && guard < MAX_TICKS; guard++) engine.tick();
}

/** The extra cooldown tick the ejection keeps on top of the glider's normal step wait. */
const TRAP_EJECT_EXTRA_TICKS = 1;

/** The cooldown a glider keeps right after a step of its own turn, on a free floor. */
function normalStepWait(): number {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode: 'cc2', entities: [{ type: 'glider', x: TRAP_X, y: TRAP_Y, dir: 'W' }] }));
  for (let guard = 0; guard < MAX_TICKS; guard++) {
    engine.tick();
    if (heldOf(engine).x !== TRAP_X) return heldOf(engine).cooldownTicks;
  }
  throw new Error('the glider never stepped');
}

const heldOf = (engine: GameEngine) => world(engine).entities[0];

describe('a trap ejects what it holds when the player press ends his step', () => {
  it('pushes a dirt block out its facing at the flush, before the next tick (MAP109 shape)', () => {
    const engine = load('cc2', { type: 'dirt_block', x: TRAP_X, y: TRAP_Y, dir: 'W' });
    stepOntoButton(engine);
    expect(heldOf(engine).x).toBe(TRAP_X);
    const tickAtFlush = engine.getTick();
    engine.flushPendingStepEnd();
    // The block arrives in the tick of the press, not one later.
    expect(heldOf(engine).x).toBe(OUT_X);
    expect(engine.getTick()).toBe(tickAtFlush);
  });

  it('steps a monster out once, out of turn, and keeps one extra cooldown tick for its step (MAP049 shape)', () => {
    const engine = load('cc2', { type: 'glider', x: TRAP_X, y: TRAP_Y, dir: 'W' });
    stepOntoButton(engine);
    expect(heldOf(engine).x).toBe(TRAP_X);
    engine.flushPendingStepEnd();
    const monster = heldOf(engine);
    expect(monster.x).toBe(OUT_X);
    // The cooldown set by the out-of-turn step includes the tick the pass would count a second time.
    const stepWait = monster.cooldownTicks;
    expect(stepWait).toBe(normalStepWait() + TRAP_EJECT_EXTRA_TICKS);
    const arrivedAt = engine.getTick();
    engine.tick();
    expect(heldOf(engine).cooldownTicks).toBe(stepWait - 1);
    expect(engine.getTick()).toBe(arrivedAt + 1);
  });

  it.each(['cc', 'native'] as RoomMode[])('ejects nothing at the flush outside the CC2 engine (%s)', (mode) => {
    const engine = load(mode, { type: 'dirt_block', x: TRAP_X, y: TRAP_Y, dir: 'W' });
    stepOntoButton(engine);
    engine.flushPendingStepEnd();
    expect(heldOf(engine).x).toBe(TRAP_X);
  });
});
