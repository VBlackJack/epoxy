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
 * CC2 engine: an item under an item modifier (the no-sign) does not bar collision, and bars only an actor that holds the forbidden item,
 * a key or a held tool (Lexy game.js:69-71; tiletypes.js:1283-1290 no_sign.blocks; defs.js:118-125). Other rules keep the item bar.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import { canMonsterEnter } from './epoxyMonsters';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const MONSTER_X = 4;
const SIGN_X = MONSTER_X + 1;
const BLUE_KEY = 'key_blue';
const BLUE_SIGN = 'no_sign_key_blue';
const ICE_BOOTS = 'boots_ice';
const ICE_SIGN = 'no_sign_boots_ice';
const STONE_SIGN = 'no_sign_hurl_stone';

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** A monster of `type` facing east beside a no-sign item (`sign`) in an otherwise empty room. */
function setup(mode: RoomMode, type: string, sign: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: 1, items: { [`${SIGN_X},${ROOM_ROW}`]: sign }, entities: [{ type, x: MONSTER_X, y: ROOM_ROW, dir: 'E' }] }));
  return engine;
}

const monsterOf = (engine: GameEngine, type: string) => {
  const found = world(engine).entities.find((e) => e.type === type);
  if (found === undefined) throw new Error('the room has the monster');
  return found;
};

describe('no-sign item, CC2 engine', () => {
  it('a fireball enters a no-sign cell (Lexy game.js:69-71)', () => {
    const engine = setup('cc2', 'fireball', STONE_SIGN);
    expect(canMonsterEnter(world(engine), monsterOf(engine, 'fireball'), 'E')).toBe(true);
  });

  it('a rolling ball carrying key_blue is barred by no_sign_key_blue (tiletypes.js:1283-1290)', () => {
    const engine = setup('cc2', 'rolling_ball', BLUE_SIGN);
    const ball = monsterOf(engine, 'rolling_ball');
    expect(canMonsterEnter(world(engine), ball, 'E')).toBe(true);
    ball.heldKeys = [BLUE_KEY];
    expect(canMonsterEnter(world(engine), ball, 'E')).toBe(false);
  });

  it('a ball holding another key is not barred by it', () => {
    const engine = setup('cc2', 'rolling_ball', BLUE_SIGN);
    const ball = monsterOf(engine, 'rolling_ball');
    ball.heldKeys = ['key_red'];
    expect(canMonsterEnter(world(engine), ball, 'E')).toBe(true);
  });

  it('an actor holding the forbidden tool is barred by its sign', () => {
    const engine = setup('cc2', 'rolling_ball', ICE_SIGN);
    const ball = monsterOf(engine, 'rolling_ball');
    expect(canMonsterEnter(world(engine), ball, 'E')).toBe(true);
    ball.heldTools = [ICE_BOOTS];
    expect(canMonsterEnter(world(engine), ball, 'E')).toBe(false);
  });

  it('a classic-rules level and a native level keep the item bar', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = setup(mode, 'fireball', STONE_SIGN);
      expect(canMonsterEnter(world(engine), monsterOf(engine, 'fireball'), 'E')).toBe(false);
    }
  });
});
