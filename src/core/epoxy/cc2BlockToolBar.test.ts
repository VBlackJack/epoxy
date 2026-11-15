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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const BLOCK_X = 3;
const ITEM_X = 4;
/**
 * The CC2 tools that bar the dirt block (Lexy COMMON_TOOL blocks_collision holds block_cc1, tiletypes.js:318-323): the boots,
 * the foil, the bolt, the helmet, the rail sign, dynamite, the bowling ball (hurl_stone) and the bribe.
 */
const BARRING_TOOLS = [
  'boots_water',
  'boots_fire',
  'boots_ice',
  'boots_force',
  'boots_speed',
  'boots_eye',
  'boots_pull',
  'hiking_boots',
  'lightning_bolt',
  'steel_foil',
  'railroad_sign',
  'helmet',
  'dynamite',
  'hurl_stone',
  'bribe'
];
/** The two keys the dirt block may still enter (Lexy keys do not carry block_cc1). */
const OPEN_KEYS = ['key_red', 'key_blue'];
/** Item tiles that already carried the bar and are not tools: the other two keys, the chips and the score and time bonuses. */
const BARRING_NON_TOOLS = [
  'key_yellow',
  'key_green',
  'chip',
  'green_chip',
  'score_10',
  'score_100',
  'score_1000',
  'score_2x',
  'stopwatch_bonus',
  'stopwatch_penalty'
];

function pushInto(mode: RoomMode, item: string, blockType: string): boolean {
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode, startX: 2, items: { [`${ITEM_X},${ROOM_ROW}`]: item }, entities: [{ type: blockType, x: BLOCK_X, y: ROOM_ROW, dir: 'E' }] })
  );
  return playMove(engine, 'E').moved;
}

describe('CC2 tools bar the dirt block', () => {
  it.each(BARRING_TOOLS)('keeps the dirt block out of a cell holding %s on a CC2 level', (tool) => {
    expect(pushInto('cc2', tool, 'dirt_block')).toBe(false);
  });

  it.each(BARRING_TOOLS)('leaves %s open to the dirt block on a classic and a native level', (tool) => {
    expect(pushInto('cc', tool, 'dirt_block')).toBe(true);
    expect(pushInto('native', tool, 'dirt_block')).toBe(true);
  });

  it.each(OPEN_KEYS)('still lets the dirt block onto %s', (key) => {
    expect(pushInto('cc2', key, 'dirt_block')).toBe(true);
  });

  it('does not bar another block type', () => {
    expect(pushInto('cc2', 'boots_fire', 'ice_block')).toBe(true);
  });

  it('is data: exactly these item tiles carry blocksDirtBlock, and the keys of the other two colours do not', () => {
    for (const tool of BARRING_TOOLS) expect(ConfigRegistry.getTile(tool).blocksDirtBlock, tool).toBe(true);
    // Every item tile carrying the bar is either one of these tools or one that already carried it: no tool is barred by accident.
    const carrying = Object.entries(ConfigRegistry.getTiles().tiles)
      .filter(([, tile]) => tile.blocksDirtBlock === true)
      .map(([id]) => id)
      .sort();
    expect(carrying).toEqual([...BARRING_TOOLS, ...BARRING_NON_TOOLS].sort());
    for (const key of OPEN_KEYS) expect(ConfigRegistry.getTile(key).blocksDirtBlock, key).toBeUndefined();
  });
});
