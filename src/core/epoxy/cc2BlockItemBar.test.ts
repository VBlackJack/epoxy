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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const BLOCK_X = 3;
const ITEM_X = 4;
/** Items the CC2 dirt block is kept out of. */
const BARRING_ITEMS = ['chip', 'green_chip', 'key_yellow', 'key_green', 'stopwatch_bonus', 'stopwatch_penalty', 'score_10', 'score_100', 'score_1000', 'score_2x'];

function pushInto(mode: RoomMode, item: string, blockType: string): boolean {
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode, startX: 2, items: { [`${ITEM_X},${ROOM_ROW}`]: item }, entities: [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }] })
  );
  return playMove(engine, 'E').moved;
}

describe('CC2 dirt block item bar', () => {
  it.each(BARRING_ITEMS)('keeps the dirt block out of a cell holding %s on a CC2 level', (item) => {
    expect(pushInto('cc2', item, 'dirt_block')).toBe(false);
  });

  it.each(BARRING_ITEMS)('leaves %s open to the dirt block on a classic and a native level', (item) => {
    expect(pushInto('cc', item, 'dirt_block')).toBe(true);
    expect(pushInto('native', item, 'dirt_block')).toBe(true);
  });

  it('still lets the dirt block onto an item that does not bar it', () => {
    expect(pushInto('cc2', 'key_blue', 'dirt_block')).toBe(true);
  });

  it('does not bar another block type', () => {
    expect(pushInto('cc2', 'chip', 'ice_block')).toBe(true);
  });
});

/** Passes a block's push step takes to end, at most. */
const PUSH_WAIT_PASSES = 8;
/** Passes the explosion bars the real player (the same life as the splash in water). */
const EXPLOSION_PASSES = 5;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function blowUp(mode: RoomMode, blockType: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode, startX: 2, items: { [`${ITEM_X},${ROOM_ROW}`]: 'bomb' }, entities: [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }] })
  );
  expect(playMove(engine, 'E').accepted).toBe(true);
  for (let pass = 0; pass < PUSH_WAIT_PASSES && engine.getItems()[ROOM_ROW][ITEM_X] !== null; pass++) engine.tick();
  expect(engine.getItems()[ROOM_ROW][ITEM_X]).toBeNull();
  return engine;
}

describe('CC2 dirt block blown up on a bomb', () => {
  it('leaves an explosion that bars the real player for the splash life, then lets him in', () => {
    const engine = blowUp('cc2', 'dirt_block');
    expect(worldOf(engine).blockSplashes.size).toBe(1);
    for (let pass = 0; pass < EXPLOSION_PASSES; pass++) {
      engine.getPlayer().moveCooldown = 0;
      expect(playMove(engine, 'E').moved, `pass ${pass}`).toBe(false);
    }
    engine.getPlayer().moveCooldown = 0;
    expect(playMove(engine, 'E').moved).toBe(true);
  });

  it('leaves nothing on a classic-rules or a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = blowUp(mode, 'dirt_block');
      expect(worldOf(engine).blockSplashes.size, mode).toBe(0);
    }
  });
});
