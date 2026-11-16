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
 * The CC2 tool thief takes every tool of the belt, dynamite, the bowling ball and yellow teleports included, and never a key
 * (Lexy take_all_tools_from_actor, tiletypes.js:1236-1256; game.js:3377).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { BRIBE_ITEM_ID, STONE_ITEM_ID } from '../coreConstants';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const FIRST_X = 3;
const THIEF = 'thief';
const DYNAMITE = 'dynamite';
const YELLOW_PAD_ITEM = 'teleport_yellow_item';
const KEY = 'key_red';
const MAX_WAIT_TICKS = 40;

/** Walks the corridor of `items`, whose next cell is the thief, and returns the engine standing on it. */
function walkInto(mode: RoomMode, items: string[]): GameEngine {
  const cells: Record<string, string> = {};
  items.forEach((id, i) => {
    cells[`${FIRST_X + i},${ROOM_ROW}`] = id;
  });
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: FIRST_X - 1, items: cells, terrain: { [`${FIRST_X + items.length},${ROOM_ROW}`]: THIEF } }));
  for (let i = 0; i <= items.length; i++) {
    for (let t = 0; t < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
    expect(playMove(engine, 'E').accepted).toBe(true);
  }
  for (let t = 0; t < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
  return engine;
}

describe('the CC2 tool thief and the counted tools (Lexy tiletypes.js:1236-1256)', () => {
  it('takes dynamite, the bowling ball and a yellow teleport, and leaves a key', () => {
    const engine = walkInto('cc2', [DYNAMITE, STONE_ITEM_ID, YELLOW_PAD_ITEM, KEY]);
    const keys = engine.getPlayer().keys;
    expect(keys[DYNAMITE]).toBeUndefined();
    expect(keys[STONE_ITEM_ID]).toBeUndefined();
    expect(keys[YELLOW_PAD_ITEM]).toBeUndefined();
    expect(keys[KEY]).toBe(1);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.thief_stole');
  });

  it('is paid off by a bribe, which keeps the tools', () => {
    const engine = walkInto('cc2', [BRIBE_ITEM_ID, DYNAMITE]);
    expect(engine.getPlayer().keys[DYNAMITE]).toBe(1);
    expect(engine.getPlayer().keys[BRIBE_ITEM_ID]).toBeUndefined();
  });

  it('leaves the counted tools of a native level in the pocket', () => {
    const engine = walkInto('native', [DYNAMITE, KEY]);
    expect(engine.getPlayer().keys[DYNAMITE]).toBe(1);
    expect(engine.getPlayer().keys[KEY]).toBe(1);
  });
});
