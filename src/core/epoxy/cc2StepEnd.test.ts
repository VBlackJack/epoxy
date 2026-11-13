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
 * On a CC2-engine level what a step of the player onto a cell does (a chip taken, a button pressed) acts when the step
 * ends (Lexy's Labyrinth on_arrive, frame 1 of the next tic), not when it starts. Other classic levels keep acting at
 * the start of the step.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const START_X = 2;
const TARGET_X = 3;
const MAX_TICKS = 40;
const CHIP = 'chip';
const GREEN_BUTTON = 'button_green';
const CLOSED_WALL = 'toggle_wall_closed';
const OPEN_WALL = 'toggle_wall_open';
const WALL_CELL = '9,5';

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** Ticks until the step under way has run its wait out; returns how many ticks that took. */
function waitOut(engine: GameEngine): number {
  let ticks = 0;
  while (ticks < MAX_TICKS && engine.getPlayer().moveCooldown > 0) {
    engine.tick();
    ticks++;
  }
  return ticks;
}

const wallAt = (engine: GameEngine): string => world(engine).terrain[ROOM_ROW][Number(WALL_CELL.split(',')[0])];

const buttonRoom = (mode: RoomMode): CompiledLevel =>
  room({ mode, terrain: { [`${TARGET_X},${ROOM_ROW}`]: GREEN_BUTTON, [WALL_CELL]: CLOSED_WALL } });

describe('CC2 engine: a chip is taken when the step onto it ends', () => {
  const chipRoom = (mode: RoomMode): CompiledLevel => room({ mode, chipsRequired: 1, items: { [`${TARGET_X},${ROOM_ROW}`]: CHIP } });

  it('leaves the chip on the floor during the step and takes it at the end', () => {
    const engine = load(chipRoom('cc2'));
    expect(world(engine).chipsRemaining).toBe(1);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(world(engine).chipsRemaining).toBe(1);
    expect(world(engine).items[ROOM_ROW][TARGET_X]).toBe(CHIP);
    // Not before the wait runs out: the tick that ends the step takes it.
    let guard = 0;
    while (engine.getPlayer().moveCooldown > 1 && guard++ < MAX_TICKS) {
      engine.tick();
      expect(world(engine).chipsRemaining).toBe(1);
    }
    engine.tick();
    expect(engine.getPlayer().moveCooldown).toBe(0);
    // The effect acts in the first frame of the tick after the wait ran out: at the start of the next tick or input.
    expect(world(engine).chipsRemaining).toBe(1);
    engine.tick();
    expect(world(engine).chipsRemaining).toBe(0);
    expect(world(engine).items[ROOM_ROW][TARGET_X]).toBeNull();
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
  });

  it.each(['cc', 'native'] as const)('is still taken at the start of the step on a %s level', (mode) => {
    const engine = load(chipRoom(mode));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(world(engine).chipsRemaining).toBe(0);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
  });

  it('undo in the middle of the step puts the chip and the pending effect back', () => {
    const engine = load(chipRoom('cc2'));
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(engine.getPlayer().cc3dArrival).toBeDefined();
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
    expect(engine.getPlayer().x).toBe(START_X);
    expect(world(engine).items[ROOM_ROW][TARGET_X]).toBe(CHIP);
    // The same step taken again still ends with the chip taken.
    engine.attemptPlayerMove('E');
    waitOut(engine);
    engine.tick();
    expect(world(engine).chipsRemaining).toBe(0);
  });
});

describe('CC2 engine: a button is pressed when the step onto it ends', () => {
  it('presses at the end of the step, not at its start', () => {
    const engine = load(buttonRoom('cc2'));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(wallAt(engine)).toBe(CLOSED_WALL);
    waitOut(engine);
    engine.tick();
    expect(wallAt(engine)).toBe(OPEN_WALL);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
    // Standing on it does not press again.
    for (let i = 0; i < 6; i++) engine.tick();
    expect(wallAt(engine)).toBe(OPEN_WALL);
  });

  it.each(['cc', 'native'] as const)('presses at the start of the step on a %s level', (mode) => {
    const engine = load(buttonRoom(mode));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(wallAt(engine)).toBe(OPEN_WALL);
  });

  it('does not press when the player is gone from the button as the step ends', () => {
    const engine = load(buttonRoom('cc2'));
    engine.attemptPlayerMove('E');
    engine.undo();
    for (let i = 0; i < 8; i++) engine.tick();
    expect(wallAt(engine)).toBe(CLOSED_WALL);
  });

  it('a press does not apply after the player died in the step', () => {
    const level = room({ mode: 'cc2', terrain: { [`${TARGET_X},${ROOM_ROW}`]: GREEN_BUTTON, [WALL_CELL]: CLOSED_WALL, [`${TARGET_X + 1},${ROOM_ROW}`]: 'water' } });
    const engine = load(level);
    engine.attemptPlayerMove('E');
    waitOut(engine);
    engine.tick();
    expect(wallAt(engine)).toBe(OPEN_WALL);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().alive).toBe(false);
    engine.tick();
    expect(wallAt(engine)).toBe(OPEN_WALL);
  });
});

describe('CC2 engine: a parked player lands on a button', () => {
  it('presses it at the end of his own step', () => {
    // The parked player slides east over ice onto the button; the controlled player stays at rest.
    const level: CompiledLevel = {
      ...room({
        mode: 'cc2',
        terrain: { '7,5': 'ice', '8,5': GREEN_BUTTON, [WALL_CELL]: CLOSED_WALL }
      }),
      extraPlayers: [{ x: 6, y: ROOM_ROW, dir: 'E', character: 'chip' }]
    };
    const engine = load(level);
    const parked = world(engine).parked[0];
    expect(parked).toBeDefined();
    expect(wallAt(engine)).toBe(CLOSED_WALL);
    // Give the parked player a forced slide step east: it enters the ice and goes on over it.
    parked.isSliding = true;
    parked.slideDir = 'E';
    parked.dir = 'E';
    parked.slideCooldown = 0;
    let sawPending = false;
    for (let i = 0; i < MAX_TICKS && wallAt(engine) === CLOSED_WALL; i++) {
      engine.tick();
      if (parked.cc3dArrival?.press !== undefined) sawPending = true;
    }
    expect(parked.x).toBe(8);
    expect(sawPending).toBe(true);
    expect(wallAt(engine)).toBe(OPEN_WALL);
    expect(parked.cc3dArrival).toBeUndefined();
  });
});
