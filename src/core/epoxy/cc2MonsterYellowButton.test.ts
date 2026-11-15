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
 * CC2 engine, wave 11 (YB): a monster's arrival on the yellow button reaches the yellow tanks one pass earlier: Lexy
 * button_yellow on_arrive sets the pending decision of the tanks at once (tiletypes.js:2241-2250), so a tank decides at the first pass after
 * the monster's step ends (the base count was one pass later). Classic and native levels keep the pending decision unset.
 */

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
const WALKER = 'glider';
const WALKER_X = 3;
const BUTTON_X = 4;
const TANK_CELL = { x: 6, y: 2 };
const WAIT_TICKS = 40;

const find = (engine: GameEngine, type: string): RuntimeEntity => {
  const found = engine.getEntities().find((e) => e.type === type);
  if (found === undefined) throw new Error(`the room has a ${type}`);
  return found;
};

/** The tick on which the monster's step onto the button ends (its cooldown reaches 0) and the tick on which the tank has turned east; undefined when it never does. */
function ticks(mode: RoomMode): { arrived: number | undefined; turned: number | undefined } {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: 1,
      terrain: { [`${BUTTON_X},${ROOM_ROW}`]: BUTTON },
      entities: [
        { type: WALKER, x: WALKER_X, y: ROOM_ROW, dir: 'E' },
        { type: TANK, x: TANK_CELL.x, y: TANK_CELL.y, dir: 'N' }
      ]
    })
  );
  for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  let arrived: number | undefined;
  let turned: number | undefined;
  for (let t = 1; t <= WAIT_TICKS && turned === undefined; t++) {
    engine.tick();
    const walker = find(engine, WALKER);
    if (arrived === undefined && walker.x === BUTTON_X && walker.cooldownTicks === 0) arrived = t;
    if (find(engine, TANK).dir === 'E') turned = t;
  }
  return { arrived, turned };
}

describe('a monster arriving on the yellow button', () => {
  it('turns a yellow tank at the first pass after its step ends (CC2 engine)', () => {
    const { arrived, turned } = ticks('cc2');
    expect(arrived).toBeDefined();
    expect(turned).toBe((arrived as number) + 1);
  });

  it.each(['cc', 'native'] as RoomMode[])('does not steer the tank on a %s level', (mode) => {
    expect(ticks(mode).turned).toBeUndefined();
  });
});
