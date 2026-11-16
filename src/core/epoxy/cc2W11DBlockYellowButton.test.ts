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
 * CC2 engine, wave 11 (YBB): a block that arrives on the yellow button turns the yellow tanks at the tick its step ends, as
 * any actor does (Lexy button_yellow on_arrive takes any actor, tiletypes.js:2241-2250). Outside the CC2 engine nothing happens.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

const TANK = 'golem_yellow';
const BUTTON = 'puppet_control';
const BLOCK = 'dirt_block';
const BLOCK_X = 3;
const BUTTON_X = 4;
const TANK_CELL = { x: 6, y: 2 };
const WAIT_TICKS = 20;
/**
 * Passes between the block's landing and the first pass at which the tank may take the decision: the block's cooldown and one
 * pass for its step end, one less than the other actors' arrival rule gave before (button_yellow on_arrive, tiletypes.js:2241-2250).
 * Measured on this room: the base rule gave 6. The block now lands in frame 0 of the tic four after the push (a 12-frame out-of-turn
 * step, Lexy game.js:2218-2242; map033 t12-t16, defs.js:199-202 allow_double_cooldowns), before the decisions of that tick: the
 * press reaches the tank one pass earlier, so the margin is 4, not 5.
 */
const DUE_MARGIN_PASSES = 4;

/** The ticks (counted from the push) at which the block has landed and the tank holds its pending decision. */
function observe(mode: RoomMode): { landedAt: number | undefined; decidedAt: number | undefined; dueMargin: number | undefined } {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: { [`${BUTTON_X},${ROOM_ROW}`]: BUTTON },
      entities: [
        { type: BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' },
        { type: TANK, x: TANK_CELL.x, y: TANK_CELL.y, dir: 'N' }
      ]
    })
  );
  engine.attemptPlayerMove('E');
  let landedAt: number | undefined;
  let decidedAt: number | undefined;
  let dueMargin: number | undefined;
  for (let i = 0; i < WAIT_TICKS; i++) {
    engine.tick();
    const block = engine.getEntities().find((e) => e.type === BLOCK);
    const tank = engine.getEntities().find((e) => e.type === TANK);
    if (landedAt === undefined && block?.x === BUTTON_X && block.arrivalTicks === undefined) landedAt = i;
    if (decidedAt === undefined && tank?.pendingSteer !== undefined) {
      decidedAt = i;
      dueMargin = (tank.pendingSteerDue ?? Number.NaN) - (engine as unknown as { w: EpoxyWorld }).w.ccMonsterClock;
    }
  }
  return { landedAt, decidedAt, dueMargin };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 engine: a block arriving on the yellow button', () => {
  it('hands the tank its decision in the tick it lands, due one pass earlier', () => {
    const { landedAt, decidedAt, dueMargin } = observe('cc2');
    expect(landedAt).toBeDefined();
    expect(decidedAt).toBe(landedAt);
    expect(dueMargin).toBe(DUE_MARGIN_PASSES);
  });

  it.each(['cc', 'native'] as RoomMode[])('does nothing outside the CC2 engine (%s)', (mode) => {
    expect(observe(mode).decidedAt).toBeUndefined();
  });
});