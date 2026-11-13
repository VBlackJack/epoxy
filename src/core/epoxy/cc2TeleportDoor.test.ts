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
 * A player teleported on the CC2 engine may exit into a door he holds the key of, and the door opens (Lexy's Labyrinth
 * tiletypes.js _define_door: blocks unless the actor has the key, on_arrive takes the key and opens the door; game.js
 * check_movement). Without the key the exit is blocked, and the other levels keep a door a wall for a teleport exit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

const PAD = 'teleport_forward';
const ITEM = 'teleport_yellow_item';
const DOOR = 'door_red';
const DOOR_KEY = 'key_red';
const OTHER_KEY = 'key_blue';
const FLOOR = 'floor';
const SETTLE_TICKS = 30;
const MAX_WAIT_TICKS = 40;
const PAD_A = { x: 3, y: ROOM_ROW };
const PAD_B = { x: 9, y: 3 };
const DOOR_CELL = { x: PAD_B.x + 1, y: PAD_B.y };

type Cell = { x: number; y: number };
const key = (cell: Cell): string => `${cell.x},${cell.y}`;
const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const terrainAt = (engine: GameEngine, cell: Cell): string => world(engine).terrain[cell.y][cell.x];
const held = (engine: GameEngine, id: string): number => world(engine).player.keys[id] ?? 0;
const at = (engine: GameEngine): Cell => ({ x: engine.getPlayer().x, y: engine.getPlayer().y });

/** Two pads, the exit east of the second one closed by a red door, and the player holding the keys given. */
function enterWith(mode: RoomMode, keys: Record<string, number>): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain: { [key(PAD_A)]: PAD, [key(PAD_B)]: PAD, [key(DOOR_CELL)]: DOOR } }));
  Object.assign(world(engine).player.keys, keys);
  for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; waited++) engine.tick();
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('teleport exit into a door', () => {
  it('lets a CC2 player out through the door he holds the key of: the key is spent and the door opens', () => {
    const engine = enterWith('cc2', { [DOOR_KEY]: 1 });
    expect(at(engine)).toEqual(DOOR_CELL);
    expect(terrainAt(engine, DOOR_CELL)).toBe(FLOOR);
    expect(held(engine, DOOR_KEY)).toBe(0);
    expect(terrainAt(engine, PAD_A)).toBe(PAD);
  });

  it('keeps the other keys of the player', () => {
    const engine = enterWith('cc2', { [DOOR_KEY]: 2, [OTHER_KEY]: 1 });
    expect(at(engine)).toEqual(DOOR_CELL);
    expect(held(engine, DOOR_KEY)).toBe(1);
    expect(held(engine, OTHER_KEY)).toBe(1);
  });

  it('blocks the exit without the key: the door stays shut and the pad is picked up instead', () => {
    const engine = enterWith('cc2', {});
    expect(terrainAt(engine, DOOR_CELL)).toBe(DOOR);
    expect(at(engine)).toEqual(PAD_A);
    expect(held(engine, ITEM)).toBe(1);
  });

  it('blocks the exit with the key of another colour', () => {
    const engine = enterWith('cc2', { [OTHER_KEY]: 1 });
    expect(terrainAt(engine, DOOR_CELL)).toBe(DOOR);
    expect(held(engine, OTHER_KEY)).toBe(1);
    expect(at(engine)).toEqual(PAD_A);
  });

  it.each<RoomMode>(['cc', 'native'])('leaves a %s level unchanged: a door is no exit, even with the key', (mode) => {
    const engine = enterWith(mode, { [DOOR_KEY]: 1 });
    expect(terrainAt(engine, DOOR_CELL)).toBe(DOOR);
    expect(held(engine, DOOR_KEY)).toBe(1);
    expect(at(engine)).toEqual(PAD_A);
    expect(terrainAt(engine, PAD_A)).toBe(PAD);
  });
});
