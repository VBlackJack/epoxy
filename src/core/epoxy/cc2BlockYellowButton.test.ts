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
import type { RuntimeEntity } from '../types';

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

const tankOf = (engine: GameEngine): RuntimeEntity => {
  const tank = engine.getEntities().find((e) => e.type === TANK);
  if (tank === undefined) throw new Error('the room has a yellow tank');
  return tank;
};

/** Pushes a block east onto the yellow button and returns the pending decision of the tank seen while waiting. */
function pushOntoButton(mode: RoomMode): string | undefined {
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
  expect(engine.attemptPlayerMove('E')).toBe(true);
  let pending: string | undefined;
  for (let i = 0; i < WAIT_TICKS && pending === undefined; i++) {
    engine.tick();
    pending = tankOf(engine).pendingSteer;
  }
  return pending;
}

describe('block on the yellow button', () => {
  it('sets the pending decision of a yellow tank on a CC2-engine level', () => {
    expect(pushOntoButton('cc2')).toBe('E');
  });

  it('does nothing to the tank on a classic-rules level', () => {
    expect(pushOntoButton('cc')).toBeUndefined();
  });
});
