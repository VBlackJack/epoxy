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

  /** The direction the first arrival on a cycling force floor is pushed in. */
  function firstPush(mode: RoomMode, start: Direction | undefined): Direction | null {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode, startX: START_X, terrain: { [`${FLOOR_X},${ROOM_ROW}`]: CYCLE_FLOOR } }));
    if (start !== undefined) engine.setReplayForceStart(start);
    playMove(engine, 'E');
    return engine.getPlayer().slideDir;
  }

  it('starts the shared turn at the direction of the header on a CC2-engine level', () => {
    for (const start of STARTS) expect(firstPush('cc2', start)).toBe(start);
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

  it('leaves live play at its own start', () => {
    expect(firstPush('cc2', undefined)).toBe(FORCE_CYCLE_ORDER[0]);
  });
});
