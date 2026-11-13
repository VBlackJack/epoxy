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
 * The rolling ball's on_bumped (Lexy tiletypes.js rolling_ball): an actor whose decision probes the ball's cell, whichever
 * way it was only trying, dies with the ball.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW } from '../../test/cc2Room';
import type { RoomOptions } from '../../test/cc2Room';
import { CELL_EDGE_BITS, STONE_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import { launchRollingBall } from './epoxyRollingBall';
import type { EpoxyContext } from './epoxyWorld';

/** Id of the rolling ball entity (what the hurl stone becomes when set down on a CC2-engine level). */
const ROLLING_BALL_ID = 'rolling_ball';

const LAUNCH_X = 4;
const BALL_X = LAUNCH_X + 1;
const TANK_X = BALL_X + 1;
const FAR_X = 10;

beforeEach(() => {
  loadTestConfigs();
});

const context = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function load(opts: RoomOptions): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(room(opts));
  return engine;
}

const ballOf = (engine: GameEngine) => engine.getEntities().find((e) => e.type === ROLLING_BALL_ID);

describe('CC2 rolling ball: bumped by a deciding actor', () => {
  it('dies with the tank whose decision probes its cell', () => {
    const engine = load({ mode: 'cc2', startX: FAR_X, entities: [{ type: 'tank', x: TANK_X, y: ROOM_ROW, dir: 'W' }] });
    expect(launchRollingBall(context(engine), LAUNCH_X, ROOM_ROW, 'E', STONE_ITEM_ID)).toBe(true);
    expect(ballOf(engine)).toMatchObject({ x: BALL_X });
    engine.tick();
    expect(ballOf(engine)).toBeUndefined();
    expect(engine.getEntities().some((e) => e.type === 'tank')).toBe(false);
  });

  it('dies with a bug that tries the ball cell as one of its preferences', () => {
    // A bug facing east tries its left (north) first: the ball is there, though the way ahead is free.
    const engine = load({ mode: 'cc2', startX: FAR_X, entities: [{ type: 'bug', x: BALL_X, y: ROOM_ROW + 1, dir: 'E' }] });
    expect(launchRollingBall(context(engine), LAUNCH_X, ROOM_ROW, 'E', STONE_ITEM_ID)).toBe(true);
    engine.tick();
    expect(ballOf(engine)).toBeUndefined();
    expect(engine.getEntities().some((e) => e.type === 'bug')).toBe(false);
  });

  it('spares a tank that looks away from the ball', () => {
    const engine = load({ mode: 'cc2', startX: FAR_X, entities: [{ type: 'tank', x: TANK_X, y: ROOM_ROW, dir: 'E' }] });
    expect(launchRollingBall(context(engine), LAUNCH_X, ROOM_ROW, 'E', STONE_ITEM_ID)).toBe(true);
    engine.tick();
    expect(ballOf(engine)).toBeDefined();
    expect(engine.getEntities().some((e) => e.type === 'tank')).toBe(true);
  });

  it('spares a bug whose probe of the ball cell is stopped by gravel under the ball', () => {
    const engine = load({ mode: 'cc2', startX: FAR_X, entities: [{ type: 'bug', x: BALL_X, y: ROOM_ROW + 1, dir: 'E' }] });
    expect(launchRollingBall(context(engine), LAUNCH_X, ROOM_ROW, 'E', STONE_ITEM_ID)).toBe(true);
    context(engine).world.terrain[ROOM_ROW][BALL_X] = 'gravel';
    engine.tick();
    expect(engine.getEntities().some((e) => e.type === 'bug')).toBe(true);
    expect(ballOf(engine)).toBeDefined();
  });

  it('spares a bug whose probe of the ball cell is stopped by a thin wall between them', () => {
    const engine = load({ mode: 'cc2', startX: FAR_X, entities: [{ type: 'bug', x: BALL_X, y: ROOM_ROW + 1, dir: 'E' }] });
    expect(launchRollingBall(context(engine), LAUNCH_X, ROOM_ROW, 'E', STONE_ITEM_ID)).toBe(true);
    const w = context(engine).world;
    const width = w.terrain[0].length;
    w.edgeMask = new Uint8Array(width * w.terrain.length);
    w.edgeMask[ROOM_ROW * width + BALL_X] |= CELL_EDGE_BITS.S;
    engine.tick();
    expect(engine.getEntities().some((e) => e.type === 'bug')).toBe(true);
    expect(ballOf(engine)).toBeDefined();
  });
});
