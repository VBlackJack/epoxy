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
 * CC2 engine, wave 11 (IRT): a monster refused on ice tries once more after the pass, so two balls jammed on ice follow one
 * another in the same tick once the front one has left. A partial approximation: one retry, where Lexy decides the forced slide
 * and re-bonks every frame of the tic (game.js:869-888, 1166-1200). Not for a monster the ice does not carry, nor off CC2.
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

/**
 * Two balls facing east on an ice row with a wall behind the rear one: the front one is listed first, so the rear one acts first in
 * the pass and is refused with no way to bounce back.
 */
function jam(mode: RoomMode, rearTool?: string, keepLoadCell = false): { front: () => RuntimeEntity; rear: () => RuntimeEntity; engine: GameEngine } {
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
  if (!keepLoadCell) for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
  const balls = engine.getEntities().filter((e) => e.type === BALL);
  if (rearTool !== undefined) balls[1].heldTools = [rearTool];
  return { engine, front: () => balls[0], rear: () => balls[1] };
}

describe('two balls jammed on ice', () => {
  it('lets the rear ball follow the front one in the same tick (CC2 engine)', () => {
    const { engine, front, rear } = jam('cc2');
    engine.tick();
    expect(front().x).toBe(FRONT_X + 1);
    expect(rear().x).toBe(REAR_X + 1);
  });

  it('leaves the rear ball behind on a classic level', () => {
    const { engine, front, rear } = jam('cc');
    engine.tick();
    expect(front().x).toBe(FRONT_X + 1);
    expect(rear().x).toBe(REAR_X);
  });

  it('leaves the rear ball behind on a native level', () => {
    const { engine, rear } = jam('native');
    engine.tick();
    expect(rear().x).toBe(REAR_X);
  });

  it('does not retry for a ball that holds cleats (the ice does not carry it)', () => {
    const { engine, rear } = jam('cc2', CLEATS);
    engine.tick();
    expect(rear().x).toBe(REAR_X);
  });

  // Lexy's ice has no on_ready, so a ball still on its load cell is not on the ice for the pass: no retry (game.js:869-888).
  it('does not retry for a ball still on its load cell, and keeps its facing', () => {
    const { engine, rear } = jam('cc2', undefined, true);
    rear().atLoadCell = true;
    engine.tick();
    expect(rear().x).toBe(REAR_X);
    expect(rear().atLoadCell).toBe(true);
    // A retry would have decided and bounced the ball again.
    expect(rear().dir).toBe(FACING);
  });

  // The frame tag a clone carries ends with its own step, also when that step is made in the retry (game.js:2218-2242).
  it('drops the frame tag of a ball whose step is made in the retry', () => {
    const { engine, rear } = jam('cc2');
    rear().cc2Frame = TAG_FRAME;
    engine.tick();
    expect(rear().x).toBe(REAR_X + 1);
    expect(rear().cc2Frame).toBeUndefined();
  });
});
