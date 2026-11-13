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
 * CC2 rolling ball: the review fixes of wave 6 (stale removals after an undo, a ball spent at launch on a button, the player
 * who walks into a ball).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW, ROOM_SIZE } from '../../test/cc2Room';
import type { RoomOptions } from '../../test/cc2Room';
import { STONE_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { isRollingBall } from './epoxyRollingBall';
import type { EpoxyWorld } from './epoxyWorld';

const LAST_FLOOR_X = ROOM_SIZE - 2;

beforeEach(() => {
  loadTestConfigs();
});

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function bowler(opts: Partial<RoomOptions> = {}): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode: 'cc2', ...opts }));
  engine.getPlayer().keys[STONE_ITEM_ID] = 1;
  return engine;
}

const ballOf = (engine: GameEngine) => engine.getEntities().find(isRollingBall);

describe('a ball set down after an undo', () => {
  it('leaves the cell at once, although a ball spent against a wall took the same uid before the undo', () => {
    const engine = bowler({ startX: LAST_FLOOR_X });
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(ballOf(engine)).toBeUndefined();
    expect(engine.undo()).toBe(true);
    expect(engine.getPlayer().keys[STONE_ITEM_ID]).toBe(1);
    world(engine).player.dir = 'W';
    expect(engine.dropItem(STONE_ITEM_ID)).toBe(true);
    expect(ballOf(engine)).toMatchObject({ x: LAST_FLOOR_X - 1, y: ROOM_ROW });
  });
});
