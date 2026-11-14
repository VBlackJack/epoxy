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
 * CC2 engine: a lit flame jet burns every block that is not fireproof (Lexy flame_jet_on on_stand): the frame block and
 * the ice block explode (the ice block does not melt to water), the dirt block survives. An unlit jet burns nothing.
 * Levels outside the CC2 engine are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';

const BLOCK_X = 3;
const TARGET_X = 4;
const MAX_WAIT_TICKS = 40;
const SETTLE_TICKS = 60;
const LIT_JET = 'flame_jet_cc2_on';
const UNLIT_JET = 'flame_jet_cc2_off';
const DIRT_BLOCK = 'dirt_block';
const FRAME_BLOCK = 'arrow_block_cross';
const ICE_BLOCK = 'ice_block';
const WATER = 'water';

function pushOntoJet(mode: RoomMode, blockType: string, jet: string) {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: { [`${TARGET_X},${ROOM_ROW}`]: jet },
      entities: [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
  engine.attemptPlayerMove('E');
  for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
  return {
    block: engine.getEntities().find((e) => e.type === blockType),
    terrain: engine.getTerrain()[ROOM_ROW][TARGET_X]
  };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 engine: a block pushed onto a flame jet', () => {
  it.each([FRAME_BLOCK, ICE_BLOCK])('burns a %s on a lit jet, without melting it to water', (blockType) => {
    const { block, terrain } = pushOntoJet('cc2', blockType, LIT_JET);
    expect(block).toBeUndefined();
    expect(terrain).toBe(LIT_JET);
  });

  it('spares the dirt block (fireproof) on a lit jet', () => {
    const { block, terrain } = pushOntoJet('cc2', DIRT_BLOCK, LIT_JET);
    expect(block).toMatchObject({ x: TARGET_X, y: ROOM_ROW });
    expect(terrain).toBe(LIT_JET);
  });

  it.each([DIRT_BLOCK, FRAME_BLOCK, ICE_BLOCK])('burns no %s on an unlit jet', (blockType) => {
    const { block, terrain } = pushOntoJet('cc2', blockType, UNLIT_JET);
    expect(block).toMatchObject({ x: TARGET_X, y: ROOM_ROW });
    expect(terrain).toBe(UNLIT_JET);
  });

  it.each(['cc', 'native'] as RoomMode[])('is unchanged outside the CC2 engine (%s)', (mode) => {
    // The frame block is not burnt by a jet there, the ice block still melts to water, the dirt block is spared.
    expect(pushOntoJet(mode, FRAME_BLOCK, LIT_JET).block).toMatchObject({ x: TARGET_X, y: ROOM_ROW });
    expect(pushOntoJet(mode, DIRT_BLOCK, LIT_JET).block).toMatchObject({ x: TARGET_X, y: ROOM_ROW });
    const ice = pushOntoJet(mode, ICE_BLOCK, LIT_JET);
    expect(ice.block).toBeUndefined();
    expect(ice.terrain).toBe(WATER);
  });
});
