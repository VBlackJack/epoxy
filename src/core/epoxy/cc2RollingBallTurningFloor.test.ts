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
 * CC2 engine, wave 16: a rolling ball on a turning force floor. Its on_blocked runs first (Lexy tiletypes.js rolling_ball, called
 * from attempt_step at game.js:1789-1790 and 2107-2108): an actor ahead is blown up with it; terrain does not blow up a ball that
 * slides. Only then the bonk of the floor (game.js:1103-1106, 1127-1162) turns it and it tries the new way.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { FORCE_CYCLE_ORDER } from '../../config/constants';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const FORCE_CYCLE = 'force_cycle';
const ROLLING_BALL = 'rolling_ball';
const LURKER = 'lurker_dormant';
const WALL = 'wall';
const PLAYER_START_X = 2;
const FLOOR_X = 5;
const AHEAD_X = FLOOR_X + 1;
const BELOW_Y = ROOM_ROW + 1;
const SOUTH_TURN = FORCE_CYCLE_ORDER.indexOf('S');
const TICKS = 4;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const ballOf = (engine: GameEngine): RuntimeEntity | undefined => engine.getEntities().find((e) => e.type === ROLLING_BALL);

function load(ahead: { terrain?: Record<string, string>; entities?: { type: string; x: number; y: number; dir: 'E' }[] }): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode: 'cc2',
      startX: PLAYER_START_X,
      terrain: { [`${FLOOR_X},${ROOM_ROW}`]: FORCE_CYCLE, ...ahead.terrain },
      entities: [{ type: ROLLING_BALL, x: FLOOR_X, y: ROOM_ROW, dir: 'E' }, ...(ahead.entities ?? [])]
    })
  );
  worldOf(engine).forceCycleTurn = SOUTH_TURN;
  // Just arrived on the floor: the pre-pass retry waits and the first try is the move of the main pass.
  const ball = ballOf(engine) as RuntimeEntity;
  ball.stepEndedPass = worldOf(engine).ccMonsterClock;
  return engine;
}

describe('CC2 engine: a rolling ball refused on a turning force floor', () => {
  it('is blown up with the actor ahead before the floor can turn it (on_blocked, then bonk)', () => {
    const engine = load({ entities: [{ type: LURKER, x: AHEAD_X, y: ROOM_ROW, dir: 'E' }] });
    for (let i = 0; i < TICKS; i++) engine.tick();
    expect(ballOf(engine)).toBeUndefined();
  });

  it('is turned by the floor against a wall, as a sliding ball does not blow up on terrain', () => {
    const engine = load({ terrain: { [`${AHEAD_X},${ROOM_ROW}`]: WALL } });
    for (let i = 0; i < TICKS; i++) engine.tick();
    const ball = ballOf(engine);
    expect(ball).toBeDefined();
    expect(ball?.y).toBe(BELOW_Y);
  });
});
