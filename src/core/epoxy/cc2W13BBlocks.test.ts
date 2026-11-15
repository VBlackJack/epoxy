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
 * CC2 engine, wave 13, blocks:
 * - BBP: a block a bomb kills on arrival still presses the button under it (Lexy step_on_cell walks every layer, game.js:2316-2365;
 *   bomb.on_stand, tiletypes.js:1161-1180). Partial: buttons only.
 * - CLB: a block other than the dirt block enters an empty clone machine (cloner blocks_collision holds block_cc1 only,
 *   tiletypes.js:1693; defs.js:104-107) and a clone machine holds the block on it (cloner traps, tiletypes.js:1700-1702).
 * Outside the CC2 engine nothing changes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';

const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 60;
const BLOCK_X = 3;
const TARGET_X = 4;
const DIRT_BLOCK = 'dirt_block';
const ICE_BLOCK = 'ice_block';
const BOMB = 'bomb';
const GREEN_BUTTON = 'button_green';
const WALL_CLOSED = 'toggle_wall_closed';
const WALL_OPEN = 'toggle_wall_open';
const WALL_CELL = { x: 8, y: 8 };

beforeEach(() => {
  loadTestConfigs();
});

function waitForMove(engine: GameEngine): void {
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
}

function pushBlockOntoBombButton(mode: RoomMode, blockType: string): { block: boolean; wall: string } {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: { [`${TARGET_X},${ROOM_ROW}`]: GREEN_BUTTON, [`${WALL_CELL.x},${WALL_CELL.y}`]: WALL_CLOSED },
      items: { [`${TARGET_X},${ROOM_ROW}`]: BOMB },
      entities: [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  waitForMove(engine);
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return {
    block: engine.getEntities().some((e) => e.type === blockType),
    wall: engine.getTerrain()[WALL_CELL.y][WALL_CELL.x]
  };
}

describe('CC2 engine, BBP: a block a bomb kills on arrival', () => {
  // Fails without the rule: the wall stays closed (the bomb branch returned before the button).
  it.each([DIRT_BLOCK, ICE_BLOCK])('still presses the green button under it (%s)', (blockType) => {
    const result = pushBlockOntoBombButton('cc2', blockType);
    expect(result.block).toBe(false);
    expect(result.wall).toBe(WALL_OPEN);
  });

  it.each(['cc', 'native'] as RoomMode[])('leaves the button alone outside the CC2 engine (%s)', (mode) => {
    const result = pushBlockOntoBombButton(mode, DIRT_BLOCK);
    expect(result.block).toBe(false);
    expect(result.wall).toBe(WALL_CLOSED);
  });
});
