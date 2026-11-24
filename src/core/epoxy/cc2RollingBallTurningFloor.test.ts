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
import { loadCc2Lane } from '../../test/cc2LaneFixture';
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
const PLAYER_START_X = 2;
const FLOOR_X = 5;
const AHEAD_X = FLOOR_X + 1;
const BELOW_Y = ROOM_ROW + 1;
const SOUTH_TURN = FORCE_CYCLE_ORDER.indexOf('S');
const TICKS = 4;
/** The Lexy lane of the ball thrown east at tic 8 onto a turning floor at (5,5) with a wall behind it. */
const BALL_WALL_LANE = 'ball_wall_d8';
const BALL_LANE_PREFIX = 'w35t_';
const THROW_TIC = 8;
const ARRIVAL_CALL = 14;
const BONK_CALL = 15;

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
  // Held back: no Lexy lane reaches this state. The old setup writes stepEndedPass by hand and lists a lurker ahead, which Lexy does not
  // have; every actor tried ahead on the Lexy lanes (w35t_ball_actor_d8, d12) leaves the cell before the ball arrives, so no Lexy value
  // can confirm or refute the expectation. Needs a lane with a stationary Lexy actor ahead of the ball (leftover of wave 35, rolling
  // ball with an actor ahead); the expectation is not changed.
  it.skip('is blown up with the actor ahead before the floor can turn it (on_blocked, then bonk)', () => {
    const engine = load({ entities: [{ type: LURKER, x: AHEAD_X, y: ROOM_ROW, dir: 'E' }] });
    for (let i = 0; i < TICKS; i++) engine.tick();
    expect(ballOf(engine)).toBeUndefined();
  });

  it('is turned by the floor against a wall, as a sliding ball does not blow up on terrain (Lexy lane w35t_ball_wall_d8)', async () => {
    const engine = new GameEngine();
    engine.loadLevel(await loadCc2Lane(BALL_WALL_LANE, BALL_LANE_PREFIX), 0);
    // The lane header starts the shared turn east: the arrival draws east into the wall, the bonk turns the ball south.
    engine.setReplayForceStart('E');
    // Chip walks east onto the ball at tic 0 and throws it at tic 8; it rolls east onto the floor and arrives at (5,5) at t14 f1.
    engine.attemptPlayerMoveHeld(['E']);
    for (let call = 1; call <= ARRIVAL_CALL; call++) {
      if (call === THROW_TIC + 1) engine.dropItem(null);
      engine.tick();
    }
    expect([ballOf(engine)?.x, ballOf(engine)?.y, ballOf(engine)?.dir]).toEqual([FLOOR_X, ROOM_ROW, 'E']);
    for (let call = ARRIVAL_CALL + 1; call <= BONK_CALL; call++) engine.tick();
    const ball = ballOf(engine);
    expect(ball).toBeDefined();
    expect(ball?.y).toBe(BELOW_Y);
    expect(ball?.dir).toBe('S');
  });
});
