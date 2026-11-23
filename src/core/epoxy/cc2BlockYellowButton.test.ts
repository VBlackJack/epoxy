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

/** A block that arrives on the yellow button steers the yellow tanks of a CC2-engine level, like any other actor. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { Direction, RuntimeEntity } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const TANK = 'golem_yellow';
const BUTTON = 'puppet_control';
const BLOCK = 'dirt_block';
const BLOCK_X = 3;
const BUTTON_X = 4;
const TANK_CELL = { x: 6, y: 2 };
const WAIT_TICKS = 40;
const TANK_FACING: Direction = 'N';
/** Passes between the tick the press is queued in and its due pass, as in cc2W11DBlockYellowButton (the block lands one pass earlier). */
const DUE_MARGIN_PASSES = 4;

const tankOf = (engine: GameEngine): RuntimeEntity => {
  const tank = engine.getEntities().find((e) => e.type === TANK);
  if (tank === undefined) throw new Error('the room has a yellow tank');
  return tank;
};

/** What the tank of a push of a block onto the yellow button shows while waiting: the queued press, then its decision at the due pass. */
interface ButtonPush {
  /** The first queued press the tank held (the block's press lands when its step ends, not at the push). */
  queued: { dir: Direction; due: number; margin: number } | undefined;
  /** The tank's facing and cell at the first tick it left its start facing: the decision taken at the due pass. */
  decided: { dir: Direction; x: number; y: number } | undefined;
}

/** Pushes a block east onto the yellow button and returns what the tank shows while waiting. */
function pushOntoButton(mode: RoomMode): ButtonPush {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      terrain: { [`${BUTTON_X},${ROOM_ROW}`]: BUTTON },
      entities: [
        { type: BLOCK, x: BLOCK_X, y: ROOM_ROW, dir: 'E' },
        { type: TANK, x: TANK_CELL.x, y: TANK_CELL.y, dir: TANK_FACING }
      ]
    })
  );
  expect(engine.attemptPlayerMove('E')).toBe(true);
  let queued: ButtonPush['queued'];
  let decided: ButtonPush['decided'];
  for (let i = 0; i < WAIT_TICKS && decided === undefined; i++) {
    engine.tick();
    const tank = tankOf(engine);
    const press = tank.cc2SteerQueue?.[0];
    if (queued === undefined && press !== undefined) queued = { ...press, margin: press.due - (engine as unknown as { w: EpoxyWorld }).w.ccMonsterClock };
    if (tank.dir !== TANK_FACING) decided = { dir: tank.dir, x: tank.x, y: tank.y };
  }
  return { queued, decided };
}

describe('block on the yellow button', () => {
  it('queues the press of the block and turns a yellow tank on a CC2-engine level at the due pass', () => {
    const { queued, decided } = pushOntoButton('cc2');
    expect(queued?.dir).toBe('E');
    expect(queued?.margin).toBe(DUE_MARGIN_PASSES);
    expect(decided?.dir).toBe('E');
    expect([decided?.x, decided?.y]).toEqual([TANK_CELL.x + 1, TANK_CELL.y]);
  });

  it('does nothing to the tank on a classic-rules level', () => {
    expect(pushOntoButton('cc')).toEqual({ queued: undefined, decided: undefined });
  });
});
