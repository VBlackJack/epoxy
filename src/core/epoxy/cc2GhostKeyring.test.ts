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
 * CC2 engine: an actor that takes a key keeps it and opens doors with it when its step ends (Lexy game.js:3221-3275 attempt_take,
 * tiletypes.js:38-56 door on_arrive take_key_from_actor). Off the CC2 engine a ghost takes a key and holds nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { resolveMonsterArrival } from './epoxyMonsters';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const KEY_X = 5;
const DOOR_X = 7;
const START_X = 11;
const SEED = 77;
const GREEN_KEY = 'key_green';
const GREEN_DOOR = 'door_green';

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const contextOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

beforeEach(() => {
  loadTestConfigs();
});

/** A ghost that arrives on a green key, then on a green door; returns what it held after the key and the door cell after. */
function ghostTakesKeyThenDoor(mode: RoomMode): { engine: GameEngine; keyring: string[] | undefined; door: string } {
  const level = room({
    mode,
    startX: START_X,
    entities: [{ type: 'ghost', x: KEY_X, y: ROOM_ROW, dir: 'E' }],
    items: { [`${KEY_X},${ROOM_ROW}`]: GREEN_KEY },
    terrain: { [`${DOOR_X},${ROOM_ROW}`]: GREEN_DOOR }
  });
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  const ghost = engine.getEntities()[0];
  resolveMonsterArrival(contextOf(engine), ghost, false);
  const keyring = ghost.heldKeys === undefined ? undefined : [...ghost.heldKeys];
  ghost.x = DOOR_X;
  resolveMonsterArrival(contextOf(engine), ghost, false);
  return { engine, keyring, door: worldOf(engine).terrain[ROOM_ROW][DOOR_X] };
}

describe('a ghost with a green key', () => {
  it('keeps the key and opens a green door on the CC2 engine, the green key staying on its keyring', () => {
    const { keyring, door, engine } = ghostTakesKeyThenDoor('cc2');
    expect(keyring).toEqual([GREEN_KEY]);
    expect(door).not.toBe(GREEN_DOOR);
    expect(worldOf(engine).items[ROOM_ROW][KEY_X]).toBeNull();
    expect(engine.getEntities()[0].heldKeys).toEqual([GREEN_KEY]);
  });

  it('holds nothing and leaves the door shut off the CC2 engine', () => {
    for (const mode of ['cc', 'native'] as const) {
      const { keyring, door } = ghostTakesKeyThenDoor(mode);
      expect(keyring).toBeUndefined();
      expect(door).toBe(GREEN_DOOR);
    }
  });
});
