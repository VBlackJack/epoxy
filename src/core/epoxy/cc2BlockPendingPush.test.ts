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
 * A push the player's decision left on a block jammed on a force floor (cc2PendingPush) turns the block's own move of the
 * tick, then is spent (Lexy pending_push, game.js:1703-1710).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import type { Direction } from '../types';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const START_X = 2;
const BLOCK_X = 5;
const WALL_X = BLOCK_X + 1;
const PUSH_TICKS = 6;

/** A dirt block on an east force floor, jammed against a wall; optionally holding a pending push to the south. */
function jammed(mode: RoomMode, pending: Direction | undefined): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: START_X,
      terrain: { [`${BLOCK_X},${ROOM_ROW}`]: 'force_e', [`${WALL_X},${ROOM_ROW}`]: 'wall' },
      entities: [{ type: 'dirt_block', x: BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  if (pending !== undefined) engine.getEntities()[0].cc2PendingPush = pending;
  for (let t = 0; t < PUSH_TICKS; t++) engine.tick();
  return engine;
}

describe('cc2PendingPush on a jammed block', () => {
  it('stays jammed without a pending push', () => {
    const block = jammed('cc2', undefined).getEntities()[0];
    expect({ x: block.x, y: block.y }).toEqual({ x: BLOCK_X, y: ROOM_ROW });
  });

  it('moves the block that way at its own move and deletes the field', () => {
    const block = jammed('cc2', 'S').getEntities()[0];
    expect(block.y).toBe(ROOM_ROW + 1);
    expect(block.x).toBe(BLOCK_X);
    expect(block.cc2PendingPush).toBeUndefined();
  });

  it('is ignored on a classic-rules and a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const block = jammed(mode, 'S').getEntities()[0];
      expect(block.y, mode).toBe(ROOM_ROW);
    }
  });
});
