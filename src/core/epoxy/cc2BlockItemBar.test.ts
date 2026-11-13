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
import { GameEngine } from '../GameEngine';

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
  return engine.attemptPlayerMove('E');
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
