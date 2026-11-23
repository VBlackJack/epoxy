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
 * CC2 engine, wave 11 (IRT), reshaped in wave 24: a monster refused on ice at the decisions retries in frames 0 and 1 of the next
 * tic, so two balls jammed on ice follow one another once the front one has left; Lexy decides the forced slide and re-bonks every
 * frame of the tic (game.js:869-888, 1164-1210). Not for a monster the ice does not carry, nor off CC2.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ROOM_ROW, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import { cc2HiddenStateKey } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const BALL = 'pink_ball';
const ICE = 'ice';
const CLEATS = 'boots_ice';
const FRONT_X = 6;
const REAR_X = 5;
const FIRST_ICE_X = 5;
const WALL = 'wall';
const LAST_ICE_X = 9;
const TAG_FRAME = 0;
const FACING = 'E';
/** The wave 30 lane of the load-cell jam: the rear ball is entity 1 at (5, 4), the front one entity 2 at (6, 4). */
const LANE_PREFIX = 'w30_';
const LANE_REAR_UID = 1;
const LANE_FRONT_UID = 2;
const LANE_REAR_X = 5;
const LANE_FRONT_X = 6;
const LANE_ROW = 4;

/**
 * Two balls facing east on an ice row with a wall behind the rear one: the front one is listed first, so the rear one acts first in
 * the pass and is refused with no way to bounce back.
 */
function jam(mode: RoomMode, rearTool?: string): { front: () => RuntimeEntity; rear: () => RuntimeEntity; engine: GameEngine } {
  const terrain: Record<string, string> = {};
  for (let x = FIRST_ICE_X; x <= LAST_ICE_X; x++) terrain[`${x},${ROOM_ROW}`] = ICE;
  terrain[`${FIRST_ICE_X - 1},${ROOM_ROW}`] = WALL;
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode,
      startX: 1,
      terrain,
      entities: [
        { type: BALL, x: FRONT_X, y: ROOM_ROW, dir: 'E' },
        { type: BALL, x: REAR_X, y: ROOM_ROW, dir: 'E' }
      ]
    })
  );
  for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  const balls = engine.getEntities().filter((e) => e.type === BALL);
  if (rearTool !== undefined) balls[1].heldTools = [rearTool];
  return { engine, front: () => balls[0], rear: () => balls[1] };
}

describe('two balls jammed on ice', () => {
  // Lexy (lane w24_ice_pair_w): the rear ball refused at frame 2 leaves at frame 0 of the next tic, not in the tic of the refusal.
  it('lets the rear ball follow the front one in frame 0 of the next tic (CC2 engine; lane w24_ice_pair_w)', () => {
    const { engine, front, rear } = jam('cc2');
    engine.tick();
    expect(front().x).toBe(FRONT_X + 1);
    expect(rear().x).toBe(REAR_X);
    engine.tick();
    expect(rear().x).toBe(REAR_X + 1);
  });

  it('leaves the rear ball behind on a classic level', () => {
    const { engine, front, rear } = jam('cc');
    engine.tick();
    expect(front().x).toBe(FRONT_X + 1);
    expect(rear().x).toBe(REAR_X);
    expect(rear().cc2IceRefused).toBeUndefined();
    // The front ball is gone: the rear one follows in the main pass of the tick, as before the retry existed (no stamp, no pre-pass step).
    engine.tick();
    expect(rear().x).toBe(REAR_X + 1);
    expect(rear().cc2IceRefused).toBeUndefined();
  });

  it('leaves the rear ball behind on a native level', () => {
    const { engine, rear } = jam('native');
    engine.tick();
    expect(rear().x).toBe(REAR_X);
    expect(rear().cc2IceRefused).toBeUndefined();
    engine.tick();
    expect(rear().x).toBe(REAR_X);
  });

  it('does not retry for a ball that holds cleats (the ice does not carry it)', () => {
    const { engine, rear } = jam('cc2', CLEATS);
    engine.tick();
    expect(rear().x).toBe(REAR_X);
    // The refusal is stamped all the same, but the ice does not carry a ball on cleats, so the pre-pass does not retry it: it follows in the main pass.
    expect(rear().cc2IceRefused).toBeDefined();
    engine.tick();
    expect(rear().x).toBe(REAR_X + 1);
    expect(rear().cc2PrePassMoved).not.toBe(true);
  });

  // Lexy's ice has no on_ready, so a ball still on its load cell decides normally: its whole preference list is refused (the wall
  // behind it, the front ball ahead), it tries its last preference anyway, bonks and slides, and follows the front ball at once
  // (wave 30; Lexy lane w30_lcm_jam_ee: make_actor_decision game.js 1752-1772, bonk 1192-1207).
  it('a ball still on its load cell bonks and follows at once (Lexy lane w30_lcm_jam_ee)', async () => {
    const engine = new GameEngine();
    engine.loadLevel(await loadCc2Lane('lcm_jam_ee', LANE_PREFIX), 0);
    const rear = (): RuntimeEntity | undefined => engine.getEntities().find((e) => e.uid === LANE_REAR_UID);
    const front = (): RuntimeEntity | undefined => engine.getEntities().find((e) => e.uid === LANE_FRONT_UID);
    engine.tick();
    expect([rear()?.x, rear()?.y, rear()?.dir]).toEqual([LANE_REAR_X + 1, LANE_ROW, FACING]);
    expect([front()?.x, front()?.y, front()?.dir]).toEqual([LANE_FRONT_X + 1, LANE_ROW, FACING]);
    engine.tick();
    engine.tick();
    expect([rear()?.x, rear()?.y]).toEqual([LANE_REAR_X + 2, LANE_ROW]);
    expect([front()?.x, front()?.y]).toEqual([LANE_FRONT_X + 2, LANE_ROW]);
  });

  // The frame tag a clone carries ends with its own step, also when that step is made in the retry (game.js:2218-2242); the retry is
  // the frame-0 step of the next tic.
  it('drops the frame tag of a ball whose step is made in the retry', () => {
    const { engine, rear } = jam('cc2');
    rear().cc2Frame = TAG_FRAME;
    engine.tick();
    expect(rear().x).toBe(REAR_X);
    expect(rear().cc2Frame).toBe(TAG_FRAME);
    engine.tick();
    expect(rear().x).toBe(REAR_X + 1);
    expect(rear().cc2Frame).toBeUndefined();
  });

  // The stamp is part of the search key for one tick: the pre-pass of the next tic reads it, then deletes it (hidden key part I).
  it('keeps the refusal stamp in the hidden state key for one tick only (CC2 engine; lane w24_ice_pair_w)', () => {
    const { engine, rear } = jam('cc2');
    const w = (engine as unknown as { w: EpoxyWorld }).w;
    const iceParts = (): string[] => cc2HiddenStateKey(w).split(';').filter((part) => part.startsWith('I'));
    engine.tick();
    expect(iceParts()).toEqual([`I${rear().uid}`]);
    engine.tick();
    expect(iceParts()).toEqual([]);
  });
});
