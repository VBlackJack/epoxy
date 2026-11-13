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
 * CC2 engine: the light switch the player steps onto acts when his step ends, if he is still on it (Lexy's Labyrinth
 * light_switch_off.on_arrive), at the start of the next tick or input; any other level flips it at the start of the step.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SWITCH_OFF = 'toggle_switch_off';
const SWITCH_ON = 'toggle_switch_on';
const SWITCH_X = 3;
const MAX_TICKS = 40;

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const switchTile = (engine: GameEngine): string => world(engine).terrain[ROOM_ROW][SWITCH_X];

function load(mode: RoomMode): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain: { [`${SWITCH_X},${ROOM_ROW}`]: SWITCH_OFF } }));
  return engine;
}

function waitOut(engine: GameEngine): void {
  let guard = 0;
  while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
}

describe('CC2 engine: a light switch acts when the step onto it ends', () => {
  it('flips at the start of the tick after the wait ran out, not before', () => {
    const engine = load('cc2');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(switchTile(engine)).toBe(SWITCH_OFF);
    expect(engine.getPlayer().cc3dArrival?.pulse).toEqual({ x: SWITCH_X, y: ROOM_ROW });
    waitOut(engine);
    expect(switchTile(engine)).toBe(SWITCH_OFF);
    engine.tick();
    expect(switchTile(engine)).toBe(SWITCH_ON);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
  });

  it('flips once even when the next input steps off at once', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    waitOut(engine);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(switchTile(engine)).toBe(SWITCH_ON);
  });

  it('undo in the middle of the step puts the switch back, and the step taken again flips it once', () => {
    const engine = load('cc2');
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(engine.undo()).toBe(true);
    expect(switchTile(engine)).toBe(SWITCH_OFF);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
    engine.attemptPlayerMove('E');
    waitOut(engine);
    engine.tick();
    expect(switchTile(engine)).toBe(SWITCH_ON);
  });

  it('an undo and a redo of the step reach the state a straight run reaches', () => {
    const straight = load('cc2');
    straight.attemptPlayerMove('E');
    waitOut(straight);
    straight.tick();

    const redone = load('cc2');
    redone.attemptPlayerMove('E');
    redone.tick();
    redone.undo();
    redone.attemptPlayerMove('E');
    waitOut(redone);
    redone.tick();
    expect(switchTile(redone)).toBe(switchTile(straight));
    expect(JSON.stringify(redone.getPlayer())).toBe(JSON.stringify(straight.getPlayer()));
  });
});

describe('a level not on the CC2 engine flips the light switch at the start of the step', () => {
  it.each(['cc', 'native'] as const)('%s level', (mode) => {
    const engine = load(mode);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(switchTile(engine)).toBe(SWITCH_ON);
    expect(engine.getPlayer().cc3dArrival?.pulse).toBeUndefined();
  });
});
