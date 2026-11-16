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
 * CC2 engine, wave 15: a voluntary step onto ice lasts the time of the ice (Lexy speed_factor 0.5, game.js:2177-2194), as the step onto
 * a force floor already does: the walking wait ends with the slide wait, so the tick he arrives reads his new cell (MAP123 t345-t347).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { room, ROOM_ROW } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const START_X = 2;
const TILE_X = 3;
const WALL_X = 4;
/** The wait of a plain walking step on the CC2 engine, in ticks. */
const WALK_WAIT_TICKS = 3;

type Mode = 'cc2' | 'cc' | 'native';

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

/** Steps east onto `tile` (a wall behind it) and returns the (moveCooldown, slideCooldown) pair after each of `ticks` ticks. */
function waits(mode: Mode, tile: string, ticks: number): Array<[number, number]> {
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, startX: START_X, terrain: { [`${TILE_X},${ROOM_ROW}`]: tile, [`${WALL_X},${ROOM_ROW}`]: 'wall' } }));
  const w = worldOf(engine);
  engine.attemptPlayerMove('E');
  const out: Array<[number, number]> = [];
  for (let i = 0; i < ticks; i++) {
    engine.tick();
    out.push([w.player.moveCooldown, w.player.slideCooldown]);
  }
  return out;
}

describe('PIC: a step onto ice', () => {
  it('lasts the slide wait of the ice, so his walking wait ends with it', () => {
    const [arrival, next] = waits('cc2', 'ice', 2);
    // The tick he arrives: one tick of slide wait left, and the same one of walking wait (not the 3 of a plain step).
    expect(arrival).toEqual([1, 1]);
    expect(next).toEqual([0, 0]);
  });

  it('leaves a step onto plain floor at the walking wait', () => {
    const [arrival] = waits('cc2', 'floor', 1);
    expect(arrival[0]).toBe(WALK_WAIT_TICKS);
  });

  it('leaves the classic and native levels unchanged', () => {
    expect(waits('cc', 'ice', 2)).toEqual([[3, 0], [4, 0]]);
    expect(waits('native', 'ice', 3)).toEqual([[3, 1], [2, 0], [1, 0]]);
  });
});
