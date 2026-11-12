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
 * On a CC2-engine level the socket or door the player steps into is still there for the monsters until his step ends
 * (Lexy's Labyrinth socket on_arrive). The engine keeps that cell in the player's pending step-end record, set only once
 * the step went through, and drops it with the other step-end effects.
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
const SOCKET = 'socket';
const YELLOW_DOOR = 'door_yellow';
const YELLOW_KEY = 'key_yellow';

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const socketRoom = (mode: RoomMode, chipsRequired = 0): CompiledLevel =>
  room({ mode, chipsRequired, terrain: { [`${TARGET_X},${ROOM_ROW}`]: SOCKET } });

const doorRoom = (mode: RoomMode): CompiledLevel => room({ mode, terrain: { [`${TARGET_X},${ROOM_ROW}`]: YELLOW_DOOR } });

function withKey(engine: GameEngine): GameEngine {
  world(engine).player.keys[YELLOW_KEY] = 1;
  return engine;
}

describe('CC2 engine: the socket or door being stepped into', () => {
  it('is recorded when the step through a socket goes through, and dropped when the step ends', () => {
    const engine = load(socketRoom('cc2'));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().cc3dArrival?.opening).toEqual({ x: TARGET_X, y: ROOM_ROW });
    let guard = 0;
    while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) {
      engine.tick();
      if (engine.getPlayer().moveCooldown > 0) expect(engine.getPlayer().cc3dArrival?.opening).toBeDefined();
    }
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
  });

  it('is recorded for a key door too', () => {
    const engine = withKey(load(doorRoom('cc2')));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().cc3dArrival?.opening).toEqual({ x: TARGET_X, y: ROOM_ROW });
  });

  it('is not recorded when the socket stays shut (chips left)', () => {
    const engine = load(socketRoom('cc2', 1));
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
    expect(engine.getPlayer().x).toBe(START_X);
  });

  it('is not recorded when the door stays shut (no key)', () => {
    const engine = load(doorRoom('cc2'));
    expect(engine.attemptPlayerMove('E')).toBe(false);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
  });

  it('is not recorded for a plain floor step', () => {
    const engine = load(room({ mode: 'cc2' }));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
  });

  it.each(['cc', 'native'] as const)('is not recorded on a %s level', (mode) => {
    const engine = load(socketRoom(mode));
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
  });

  it('is put back on undo in the middle of the step', () => {
    const engine = load(socketRoom('cc2'));
    engine.attemptPlayerMove('E');
    engine.tick();
    expect(engine.getPlayer().cc3dArrival?.opening).toBeDefined();
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().cc3dArrival).toBeUndefined();
    expect(world(engine).terrain[ROOM_ROW][TARGET_X]).toBe(SOCKET);
  });

  it('does not bar the input once the step is over', () => {
    const engine = load(socketRoom('cc2'));
    engine.attemptPlayerMove('E');
    let guard = 0;
    while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
    expect(engine.attemptPlayerMove('E')).toBe(true);
  });
});
