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
 * CC2 engine, wave 11 (FB): the decision probes every held key and the probe bumps the cell, so the steel foil turns a plain
 * wall to steel even when the other held key is the one taken (Lexy game.js:1559-1561, 1643-1645, 1832-1833; wall.on_bumped,
 * tiletypes.js:393-400). Other levels are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playHeld } from '../../test/cc2Play';
import { STEEL_FOIL_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';

const PLAYER_X = 2;
const WALL_ROW = ROOM_ROW + 1;
const WALL = 'wall';
const STEEL = 'steel_wall';
const MAX_WAIT_TICKS = 40;

beforeEach(() => {
  loadTestConfigs();
});

function load(mode: RoomMode, withFoil: boolean): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain: { [`${PLAYER_X},${WALL_ROW}`]: WALL } }));
  if (withFoil) engine.getPlayer().boots.add(STEEL_FOIL_ITEM_ID);
  for (let waited = 0; engine.getPlayer().moveCooldown !== 0; waited++) {
    if (waited > MAX_WAIT_TICKS) throw new Error('the player never became able to move');
    engine.tick();
  }
  return engine;
}

describe('steel foil on the held key not taken', () => {
  it('turns the wall south to steel while the player goes east (E+S held)', () => {
    const engine = load('cc2', true);
    playHeld(engine, ['E', 'S']);
    expect(engine.getTerrain()[WALL_ROW][PLAYER_X]).toBe(STEEL);
    expect(engine.getPlayer().x).toBe(PLAYER_X + 1);
  });

  it('changes nothing without the foil', () => {
    const engine = load('cc2', false);
    playHeld(engine, ['E', 'S']);
    expect(engine.getTerrain()[WALL_ROW][PLAYER_X]).toBe(WALL);
    expect(engine.getPlayer().x).toBe(PLAYER_X + 1);
  });

  it('leaves a level of the CC1 flavour unchanged', () => {
    const engine = load('cc', true);
    playHeld(engine, ['E', 'S']);
    expect(engine.getTerrain()[WALL_ROW][PLAYER_X]).toBe(WALL);
  });
});
