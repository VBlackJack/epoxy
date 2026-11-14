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
 * CC2 engine block bars (Lexy's Labyrinth tiletypes.js): a hint bars the dirt block,.
 * Levels outside the CC2 engine are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';

const PLAYER_X = 2;
const BLOCK_X = 3;
const TARGET_X = 4;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 60;
const DIRT_BLOCK = 'dirt_block';
const OTHER_BLOCKS = ['ice_block', 'arrow_block_cross'];
const HINT = 'hint';

function pushOnto(mode: RoomMode, blockType: string, terrain: string | null, item: string | null) {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: terrain === null ? {} : { [`${TARGET_X},${ROOM_ROW}`]: terrain },
      items: item === null ? {} : { [`${TARGET_X},${ROOM_ROW}`]: item },
      entities: [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
  engine.attemptPlayerMove('E' as Direction);
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  const block = engine.getEntities().find((e) => e.type === blockType);
  return { block, player: engine.getPlayer() };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 hint and blocks', () => {
  it('bars the dirt block from a hint tile', () => {
    const { block, player } = pushOnto('cc2', DIRT_BLOCK, HINT, null);
    expect(block).toMatchObject({ x: BLOCK_X, y: ROOM_ROW });
    expect(player.x).toBe(PLAYER_X);
  });

  it.each(OTHER_BLOCKS)('lets a %s onto a hint tile', (blockType) => {
    const { block } = pushOnto('cc2', blockType, HINT, null);
    expect(block).toMatchObject({ x: TARGET_X, y: ROOM_ROW });
  });

  it.each(['cc', 'native'] as RoomMode[])('leaves the dirt block free to enter a hint outside the CC2 engine (%s)', (mode) => {
    const { block } = pushOnto(mode, DIRT_BLOCK, HINT, null);
    expect(block).toMatchObject({ x: TARGET_X, y: ROOM_ROW });
  });
});
