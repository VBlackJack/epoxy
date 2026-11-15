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
 * A player teleported on the CC2 engine may exit onto a chip socket once no chip is missing (Lexy's Labyrinth game.js:2403-2434
 * tests the exit cell as the actor would enter it; tiletypes.js:3507-3513 socket.blocks is false at zero chips). With a chip
 * missing, or an item that bars the player lying on the socket, the exit is blocked, and the other levels keep a socket a wall.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

const PAD = 'teleport_forward';
const ITEM = 'teleport_yellow_item';
const SOCKET = 'socket';
const FLOOR = 'floor';
const NO_SIGN_KEY = 'no_sign_key_red';
const KEY = 'key_red';
const SETTLE_TICKS = 30;
const MAX_WAIT_TICKS = 40;
const PAD_A = { x: 3, y: ROOM_ROW };
const PAD_B = { x: 9, y: 3 };
const SOCKET_CELL = { x: PAD_B.x + 1, y: PAD_B.y };

type Cell = { x: number; y: number };
const key = (cell: Cell): string => `${cell.x},${cell.y}`;
const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const terrainAt = (engine: GameEngine, cell: Cell): string => world(engine).terrain[cell.y][cell.x];
const at = (engine: GameEngine): Cell => ({ x: engine.getPlayer().x, y: engine.getPlayer().y });

interface Setup {
  mode: RoomMode;
  chipsRequired: number;
  /** Item lying on the socket cell. */
  onSocket?: string;
  /** Key the player carries. */
  carries?: string;
}

/** Two pads, the forward exit of the second one closed by a socket, and the player stepping onto the first. */
function enter(opts: Setup): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode: opts.mode,
      chipsRequired: opts.chipsRequired,
      terrain: { [key(PAD_A)]: PAD, [key(PAD_B)]: PAD, [key(SOCKET_CELL)]: SOCKET },
      items: opts.onSocket ? { [key(SOCKET_CELL)]: opts.onSocket } : {}
    })
  );
  if (opts.carries) world(engine).player.keys[opts.carries] = 1;
  for (let waited = 0; waited <= MAX_WAIT_TICKS && engine.getPlayer().moveCooldown !== 0; waited++) engine.tick();
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return engine;
}

beforeEach(() => {
  loadTestConfigs();
});

describe('teleport exit onto a chip socket', () => {
  it('lets a CC2 player out onto the socket once no chip is missing, and the socket opens', () => {
    const engine = enter({ mode: 'cc2', chipsRequired: 0 });
    expect(at(engine)).toEqual(SOCKET_CELL);
    expect(terrainAt(engine, SOCKET_CELL)).toBe(FLOOR);
  });

  it('blocks the exit while a chip is missing: the socket stays shut and the pad is picked up instead', () => {
    const engine = enter({ mode: 'cc2', chipsRequired: 1 });
    expect(terrainAt(engine, SOCKET_CELL)).toBe(SOCKET);
    expect(at(engine)).toEqual(PAD_A);
    expect(world(engine).player.keys[ITEM] ?? 0).toBe(1);
  });

  it('blocks the exit when an item that bars the player lies on the opened socket', () => {
    const engine = enter({ mode: 'cc2', chipsRequired: 0, onSocket: NO_SIGN_KEY, carries: KEY });
    expect(at(engine)).toEqual(PAD_A);
    expect(terrainAt(engine, SOCKET_CELL)).toBe(SOCKET);
  });

  it.each<RoomMode>(['cc', 'native'])('leaves a %s level unchanged: a socket is no exit, even with no chip missing', (mode) => {
    const engine = enter({ mode, chipsRequired: 0 });
    expect(terrainAt(engine, SOCKET_CELL)).toBe(SOCKET);
    expect(at(engine)).toEqual(PAD_A);
  });
});
