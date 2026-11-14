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
 * On a CC2-engine level each character keeps one key through its doors (Lexy's Labyrinth tiletypes.js infinite_items): Chip
 * never spends green, Melinda never spends yellow, and each spends every other key. The classic and native rules keep the
 * door's own consumesKey (green stays, the others go).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { PlayerCharacter } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const DOOR_X = 3;
const KEY_COUNT = 2;

/** Walks through a door of `color` with two keys of that color, and returns how many keys are left. */
function keysLeftAfterDoor(mode: RoomMode, character: PlayerCharacter, color: 'red' | 'yellow' | 'green'): number {
  const engine = new GameEngine();
  engine.loadLevel({ ...room({ mode, startX: DOOR_X - 1, terrain: { [`${DOOR_X},${ROOM_ROW}`]: `door_${color}` } }), character });
  engine.getPlayer().keys[`key_${color}`] = KEY_COUNT;
  expect(engine.attemptPlayerMove('E')).toBe(true);
  expect(engine.getPlayer().x).toBe(DOOR_X);
  return engine.getPlayer().keys[`key_${color}`] ?? 0;
}

describe('the key a character keeps on a CC2-engine level', () => {
  it('is named by the config: Chip keeps green, Melinda keeps yellow', () => {
    const kept = ConfigRegistry.getGame().cc2Characters?.keptKeyByCharacter;
    expect(kept?.chip).toBe('key_green');
    expect(kept?.melinda).toBe('key_yellow');
  });

  it('is never spent: Chip on green, Melinda on yellow', () => {
    expect(keysLeftAfterDoor('cc2', 'chip', 'green')).toBe(KEY_COUNT);
    expect(keysLeftAfterDoor('cc2', 'melinda', 'yellow')).toBe(KEY_COUNT);
  });

  it('is the only one: Chip spends yellow and red, Melinda spends green and red', () => {
    expect(keysLeftAfterDoor('cc2', 'chip', 'yellow')).toBe(KEY_COUNT - 1);
    expect(keysLeftAfterDoor('cc2', 'chip', 'red')).toBe(KEY_COUNT - 1);
    expect(keysLeftAfterDoor('cc2', 'melinda', 'green')).toBe(KEY_COUNT - 1);
    expect(keysLeftAfterDoor('cc2', 'melinda', 'red')).toBe(KEY_COUNT - 1);
  });

  it('follows the door on a classic-rules and a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      expect(keysLeftAfterDoor(mode, 'melinda', 'yellow')).toBe(KEY_COUNT - 1);
      expect(keysLeftAfterDoor(mode, 'melinda', 'green')).toBe(KEY_COUNT);
      expect(keysLeftAfterDoor(mode, 'chip', 'green')).toBe(KEY_COUNT);
      expect(keysLeftAfterDoor(mode, 'chip', 'yellow')).toBe(KEY_COUNT - 1);
    }
  });
});
