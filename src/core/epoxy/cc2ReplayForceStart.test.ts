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
 * The replay header's force floor start: the replay check hands it to the engine, and the random force floors of a CC2-engine
 * level start their shared turn there (Lexy's Labyrinth game.js:3061-3069); live play keeps its own start.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { FORCE_CYCLE_ORDER } from '../../config/constants';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, type RoomMode } from '../../test/cc2Room';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

describe('the force floor start of a replay', () => {
  const CYCLE_FLOOR = 'force_cycle';
  const START_X = 2;
  const FLOOR_X = 3;
  const STARTS: readonly Direction[] = ['N', 'E', 'S', 'W'];
  /** The Lexy lanes of wave 35: Chip steps east onto a turning floor at (3,5) with each header; the lane name carries the header. */
  const LANE_BY_START: Readonly<Record<Direction, string>> = { N: 'rfs_north', E: 'rfs_east', S: 'rfs_south', W: 'rfs_west' };
  const LANE_PREFIX = 'w35t_';
  /** The cell Chip stands on after 3 tick() calls: the arrival at t2 f1 draws the header way and the step at t2 f2 takes it. */
  const CELL_AFTER_THREE: Readonly<Record<Direction, readonly [number, number]>> = { N: [3, 4], E: [4, 5], S: [3, 6], W: [2, 5] };
  const CALLS_TO_LEAVE = 3;

  /** Chip's cell after 3 calls on the lane of a header; `start` is handed to the engine as the replay check does (none: live play). */
  async function cellAfterThree(lane: Direction, start: Direction | undefined): Promise<readonly [number, number]> {
    const engine = new GameEngine();
    engine.loadLevel(await loadCc2Lane(LANE_BY_START[lane], LANE_PREFIX), 0);
    if (start !== undefined) engine.setReplayForceStart(start);
    engine.attemptPlayerMoveHeld(['E']);
    for (let call = 1; call <= CALLS_TO_LEAVE; call++) engine.tick();
    return [engine.getPlayer().x, engine.getPlayer().y];
  }

  /** The direction the first arrival on a cycling force floor is pushed in. */
  function firstPush(mode: RoomMode, start: Direction | undefined): Direction | null {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode, startX: START_X, terrain: { [`${FLOOR_X},${ROOM_ROW}`]: CYCLE_FLOOR } }));
    if (start !== undefined) engine.setReplayForceStart(start);
    playMove(engine, 'E');
    return engine.getPlayer().slideDir;
  }

  it('starts the shared turn at the direction of the header on a CC2-engine level (Lexy lanes w35t_rfs_*)', async () => {
    // The arrival on the turning floor draws the header way at t2 f1 and Chip steps that way at t2 f2.
    for (const start of STARTS) expect(await cellAfterThree(start, start)).toEqual(CELL_AFTER_THREE[start]);
  });

  it('follows the order of the cycle from there', () => {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', startX: START_X, terrain: { [`${FLOOR_X},${ROOM_ROW}`]: CYCLE_FLOOR } }));
    engine.setReplayForceStart('N');
    expect(engine.getForceCycleTurn()).toBe(FORCE_CYCLE_ORDER.indexOf('N'));
  });

  it('is not honoured on a classic-rules or a native level', () => {
    const live = firstPush('cc', undefined);
    expect(firstPush('cc', 'N')).toBe(live);
    expect(firstPush('native', 'N')).toBe(firstPush('native', undefined));
  });

  it('leaves live play at its own start (Lexy lane w35t_rfs_east: the first draw is east)', async () => {
    // Live play hands no header to the engine: the first arrival is pushed in FORCE_CYCLE_ORDER[0], east, as on the east lane.
    expect(await cellAfterThree('E', undefined)).toEqual(CELL_AFTER_THREE[FORCE_CYCLE_ORDER[0]]);
  });
});
