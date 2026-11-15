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
 * Wave 12, RBL2: the bowling ball a pickup pushes off a full belt is set down by Lexy's attempt_take through the same
 * _place_dropped_item as the drop key (game.js:3221-3280, 2539-2580), inside the player's own turn, so it takes no extra cooldown
 * tick either (a monster ejected from a trap keeps its one).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playMove } from '../../test/cc2Play';
import { room, ROOM_ROW } from '../../test/cc2Room';
import { STONE_ITEM_ID, ccStepTicks } from '../coreConstants';
import { GameEngine } from '../GameEngine';

beforeEach(() => {
  loadTestConfigs();
});

const ROLLING_BALL_ID = 'rolling_ball';
const FIRST_X = 3;
const FILLERS = ['boots_water', 'boots_fire', 'boots_ice'];
const FIFTH = 'boots_speed';
const MAX_WAIT_TICKS = 40;
const stepTicks = (): number => ccStepTicks(ROLLING_BALL_ID);

const ballOf = (engine: GameEngine) => engine.getEntities().find((e) => e.type === ROLLING_BALL_ID);

function walkEast(engine: GameEngine, steps: number): void {
  for (let i = 0; i < steps; i++) {
    for (let t = 0; t < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
    expect(playMove(engine, 'E').accepted).toBe(true);
  }
}

describe('the bowling ball pushed off a full belt', () => {
  it('ends its first step one tick short of a full step after the pickup, as a dropped ball does, then crosses one cell per step', () => {
    const items = [STONE_ITEM_ID, ...FILLERS, FIFTH];
    const cells: Record<string, string> = {};
    items.forEach((id, i) => {
      cells[`${FIRST_X + i},${ROOM_ROW}`] = id;
    });
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', startX: FIRST_X - 1, items: cells }));
    // The first four steps fill the belt with the bowling ball oldest; the fifth pickup pushes it off (game.js:3221-3280).
    walkEast(engine, items.length - 1);
    expect(ballOf(engine)).toBeUndefined();
    for (let t = 0; t < MAX_WAIT_TICKS && engine.getPlayer().moveCooldown > 0; t++) engine.tick();
    expect(playMove(engine, 'E').accepted).toBe(true);
    const ballX = (): number => ballOf(engine)?.x as number;
    const startX = ballX();
    expect(startX).toBe(engine.getPlayer().x + 1);
    // Same pace as the drop key (cc2RollingBallActor.test.ts): the ball is set down inside the player's own turn, so no +1 tick.
    for (let i = 0; i < stepTicks() - 1; i++) engine.tick();
    expect(ballX()).toBe(startX);
    engine.tick();
    expect(ballX()).toBe(startX + 1);
    for (let i = 0; i < stepTicks() - 1; i++) engine.tick();
    expect(ballX()).toBe(startX + 1);
    engine.tick();
    expect(ballX()).toBe(startX + 2);
  });
});
