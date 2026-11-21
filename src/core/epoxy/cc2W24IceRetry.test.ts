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
 * CC2 wave 24: a monster whose ice slide a frame-2 decision refused retries it in frames 0 and 1 of the next tic (Lexy decides the
 * forced slide in every frame, game.js:869-888, and bonks each time, 1164-1214), instead of once after the pass. Played on the Lexy
 * lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefix w24_), imported through the CC2 importer as a player would.
 *
 * tick() k plays the Lexy tic k - 1, so "after N ticks" is the end of Lexy tic N - 1. Every expected position is the end-of-tic
 * position of the Lexy lane named next to it (the actor oracle of that lane, harness checked).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const LANE_PREFIX = 'w24_';
const SEED = 3;
const BALL = 'pink_ball';
const TANK = 'tank';
const LANE_ROW = 4;
const TANK_ROW = 6;
/** Lane ice_btn_retry: the tick of the Lexy t38 end, the tick of the first press, the tick the known gap shows in. */
const BTN_TICK = 39;
const BTN_FIRST_PRESS_TICK = 9;
const BTN_PIN_TICK = 73;

/** Plays a lane for `ticks` ticks more than `from` (an engine already advanced `from` ticks), returning the engine. */
async function load(lane: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, LANE_PREFIX), SEED);
  return engine;
}

function advance(engine: GameEngine, from: number, to: number): void {
  for (let i = from; i < to; i++) engine.tick();
}

/** The (x,y) of every ball, sorted by x. */
function balls(engine: GameEngine): [number, number][] {
  return engine
    .getEntities()
    .filter((e: RuntimeEntity) => e.type === BALL)
    .map((e): [number, number] => [e.x, e.y])
    .sort((a, b) => a[0] - b[0]);
}

function tankOf(engine: GameEngine): [number | undefined, number | undefined, string | undefined] {
  const tank = engine.getEntities().find((e) => e.type === TANK);
  return [tank?.x, tank?.y, tank?.dir];
}

describe('a ball refused on ice retries in the frames of the next tic (CC2 engine)', () => {
  // Lexy lane w24_ice_pair_w (actor order): the rear ball refused at frame 2 leaves at frame 0 of the next tic. Without the rule the
  // after-pass retry moves it in the tic of the refusal: rear at 13,4 after 31 ticks and at 14,4 after 33.
  it('lane ice_pair_w: the rear ball follows the front one one tic after its refusal', async () => {
    const expected: [number, [number, number][]][] = [
      [31, [[12, LANE_ROW], [14, LANE_ROW]]],
      [32, [[12, LANE_ROW], [13, LANE_ROW]]],
      [33, [[11, LANE_ROW], [13, LANE_ROW]]],
      [34, [[11, LANE_ROW], [12, LANE_ROW]]],
      [35, [[10, LANE_ROW], [12, LANE_ROW]]]
    ];
    const engine = await load('ice_pair_w');
    let played = 0;
    for (const [tick, cells] of expected) {
      advance(engine, played, tick);
      played = tick;
      expect(balls(engine), `after ${tick} ticks`).toEqual(cells);
    }
  });

  // The parked player has no actor order, so the end-of-tick pre-pass (runEndOfTickPrePass, GameEngine.ts:1341-1353) runs frame 0 of
  // the coming tic before the sample: the same cells as Lexy, one tic earlier at the even tics (Lexy at 32 / 34 / 36). Known and
  // inherent, no divergence. Without the rule the rear ball is at 14,4 after 33 ticks.
  it('lane ice_pair_w_parked: the parked placement shows frame 0 of the coming tic', async () => {
    const expected: [number, number][] = [
      [31, 13],
      [33, 12],
      [35, 11]
    ];
    const engine = await load('ice_pair_w_parked');
    let played = 0;
    for (const [tick, rearX] of expected) {
      advance(engine, played, tick);
      played = tick;
      expect(balls(engine)[1], `after ${tick} ticks`).toEqual([rearX, LANE_ROW]);
    }
  });

  // Lane ice_btn_retry: a ball refused on ice (wall behind, a ball on a blue button ahead) retries onto the button. Lexy t38 end: balls
  // at 5,4 and 7,4. Without the rule the after-pass retry moves the rear ball a tic early: (8,4) there.
  it('lane ice_btn_retry: the refused ball retries onto the button at the Lexy tic', async () => {
    const engine = await load('ice_btn_retry');
    advance(engine, 0, BTN_TICK);
    expect(balls(engine)).toEqual([[5, LANE_ROW], [7, LANE_ROW]]);
  });

  // The first press (Lexy t4f2) turns the blue tank in its closed corridor: west at the end of the ninth tick, as Lexy.
  it('lane ice_btn_retry: the first press turns the tank at its Lexy frame', async () => {
    const engine = await load('ice_btn_retry');
    advance(engine, 0, BTN_FIRST_PRESS_TICK);
    expect(tankOf(engine)).toEqual([10, TANK_ROW, 'W']);
  });

  // KNOWN GAP (C11, wave 24 leftover), pinned so a later fix shows up as a failing test to update. The press of a frame-0 out-of-turn
  // monster step that ends in frame 2 lands after the frame-2 decisions in Lexy, before them in Epoxy. Lane ice_btn_retry, the rear
  // ball's retry t69f0 ends at t72f2: Lexy's tank is still east at t72 and turns at t76; Epoxy applies that press before the t72
  // decisions, so its tank is already west.
  //   Lexy after tic 72 (73 ticks): tank (12, 6) facing E.   Epoxy now: tank (10, 6) facing W.
  it('lane ice_btn_retry: pins the known press-frame gap of a frame-0 retry step ending in frame 2', async () => {
    const engine = await load('ice_btn_retry');
    advance(engine, 0, BTN_PIN_TICK);
    expect(tankOf(engine)).toEqual([10, TANK_ROW, 'W']);
  });
});
