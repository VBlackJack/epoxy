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
 * CC2 wave 25: the press of an out-of-turn monster step taken in frame 0 or 1 of a tic lands at the frame Lexy ends that step in
 * (a frame-0 step ends in frame 2 of the tic before, after its decisions; a frame-1 step ends where a main-pass step of the tic
 * does), a slide step on ice refused in frame 0 retries in frame 1, and a monster refused both ways on ice in its own turn faces the
 * bounce way (_possibly_bonk). Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w24_ and w25_).
 *
 * tick() k plays the Lexy tic k - 1, so "after N ticks" is the end of Lexy tic N - 1. Every expected value is the end-of-tic value of
 * the Lexy lane named next to it (the actor oracle of that lane, harness checked).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import { cc2HiddenStateKey } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 3;
const BALL = 'pink_ball';
const TANK = 'tank';
const ICE = 'ice';
const WALL = 'wall';
const BALL_ROW = 4;
const OBSERVER_ROW = 6;
/** Lane f0_red: the tick the afterPass press of the cloner is pending in, the tick it is applied in. */
const RED_PENDING_TICK = 37;
const RED_APPLIED_TICK = 39;
const RED_CLONER_UID = 2;

/** Loads a lane through the CC2 importer with SEED. */
async function load(lane: string, prefix: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  return engine;
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

/** Plays `count` more ticks. */
function play(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

/** The x of every ball of a row, sorted. */
function rowX(engine: GameEngine, y: number): number[] {
  return engine
    .getEntities()
    .filter((e: RuntimeEntity) => e.type === BALL && e.y === y)
    .map((e) => e.x)
    .sort((a, b) => a - b);
}

/** The (x, y, dir) of every ball of a row, sorted by x. */
function rowCells(engine: GameEngine, y: number): [number, number, string | undefined][] {
  return engine
    .getEntities()
    .filter((e: RuntimeEntity) => e.type === BALL && e.y === y)
    .sort((a, b) => a.x - b.x)
    .map((e): [number, number, string | undefined] => [e.x, e.y, e.dir]);
}

function tankOf(engine: GameEngine): [number | undefined, number | undefined, string | undefined] {
  const tank = engine.getEntities().find((e) => e.type === TANK);
  return [tank?.x, tank?.y, tank?.dir];
}

describe('the press of a frame-0 pre-pass monster step (PSF, CC2 engine)', () => {
  // Lane f0_green (Lexy t72f2 press): the green toggle is Lexy's pending flag, applied after the frame's actor phase, so the observer
  // ball decides at t72 before the toggle. Without the rule the toggle came at the end of the t71 pass and the ball turned at t72.
  it('lane f0_green: the toggle comes after the decisions of the press tic', async () => {
    const engine = await load('f0_green', 'w25_');
    play(engine, 73);
    expect(rowCells(engine, OBSERVER_ROW)).toEqual([[12, OBSERVER_ROW, 'E']]);
    play(engine, 4);
    expect(rowCells(engine, OBSERVER_ROW)).toEqual([[13, OBSERVER_ROW, 'E']]);
  });

  // Lane f0_red (Lexy t38f2): the cloner fires in the press frame and the clone steps at once, so it stands at 5,6 at the end of t38.
  // Without the rule the press is one pass early and the clone is not there yet: [4, 6, 7].
  it('lane f0_red: the clone released by the press steps at once', async () => {
    const engine = await load('f0_red', 'w25_');
    play(engine, RED_APPLIED_TICK);
    expect(rowX(engine, OBSERVER_ROW)).toEqual([4, 5, 6, 7]);
  });

  // The afterPass arrival is part of the state: it survives a snapshot taken while it is pending, and the restored world plays on the
  // same as the original (uid 2 is the cloner button press, trigger_cloner at 7,4, due 38; pending after 36, 37 and 38 ticks).
  it('lane f0_red: an afterPass arrival survives a snapshot round trip', async () => {
    const engine = await load('f0_red', 'w25_');
    play(engine, RED_PENDING_TICK);
    const pending = world(engine).ccArrivals.find((a) => a.afterPass === true);
    expect(pending).toMatchObject({ uid: RED_CLONER_UID, x: 7, y: BALL_ROW, action: 'trigger_cloner', due: 38, afterPass: true });
    const snap = engine.captureState();
    const keyBefore = cc2HiddenStateKey(world(engine));
    play(engine, 2);
    expect(rowX(engine, OBSERVER_ROW)).toEqual([4, 5, 6, 7]);
    engine.restoreState(snap);
    expect(world(engine).ccArrivals.some((a) => a.afterPass === true)).toBe(true);
    expect(cc2HiddenStateKey(world(engine))).toBe(keyBefore);
    play(engine, 2);
    expect(rowX(engine, OBSERVER_ROW)).toEqual([4, 5, 6, 7]);
  });

  // The hidden key tells an afterPass press from a plain one: it applies at another moment, so the same state must not collapse.
  it('lane f0_red: the hidden key carries the afterPass press', async () => {
    const engine = await load('f0_red', 'w25_');
    play(engine, RED_PENDING_TICK);
    const key = cc2HiddenStateKey(world(engine));
    expect(key).toContain(`p${RED_CLONER_UID}@0a`);
    const arrival = world(engine).ccArrivals.find((a) => a.afterPass === true);
    expect(arrival).toBeDefined();
    delete (arrival as { afterPass?: true }).afterPass;
    expect(cc2HiddenStateKey(world(engine))).not.toBe(key);
  });
});

describe('the press of a frame-1 pre-pass monster step (PSF, CC2 engine)', () => {
  // Lane g1_red (Lexy t18f1 -> t22f0): the frame-1 step ends at the start of the tic like a main-pass step of the same tic, and the
  // clone steps then. Without the frame-1 half the clone is one tic early: [4, 5, 6, 8, 9] already after 22 ticks.
  it('lane g1_red: the clone of a frame-1 press steps one tic later', async () => {
    const engine = await load('g1_red', 'w25_');
    play(engine, 22);
    expect(rowX(engine, OBSERVER_ROW)).toEqual([4, 6, 8, 9]);
    play(engine, 1);
    expect(rowX(engine, OBSERVER_ROW)).toEqual([4, 5, 6, 8, 9]);
  });
});

describe('a slide step on ice refused in frame 0 retries in frame 1 (MSR, CC2 engine)', () => {
  // Lane g1_blue (Lexy t16): the middle ball, refused at t14f0, goes at t14f1; the rear one, refused at t16f1, leaves at t16f2. Without
  // the rule the middle ball waits for the main pass and the rear cascade diverges: row 4 at [4, 6, 8] after 17 ticks.
  it('lane g1_blue: the cascade of the jam follows the Lexy frames, to the end of the lane', async () => {
    const engine = await load('g1_blue', 'w25_');
    play(engine, 17);
    expect(rowX(engine, BALL_ROW)).toEqual([4, 6, 7]);
    expect(tankOf(engine)).toEqual([8, OBSERVER_ROW, 'W']);
    play(engine, 183);
    expect(rowX(engine, BALL_ROW)).toEqual([4, 6, 7]);
    expect(tankOf(engine)).toEqual([13, OBSERVER_ROW, 'E']);
  });
});

describe('a monster refused both ways on ice in its own turn faces the bounce way (FAC main-pass site, CC2 engine)', () => {
  // Lexy _possibly_bonk (game.js:1192-1207) turns the actor to the bounce way when both are held. Lane w24_ice_pair_w after the bonk of
  // t30: both balls face west, positions unchanged. Without the rule the front-refused ball keeps facing east.
  it('lane ice_pair_w: the refused rear ball faces west after the bonk', async () => {
    const engine = await load('ice_pair_w', 'w24_');
    play(engine, 31);
    expect(rowCells(engine, BALL_ROW)).toEqual([[12, BALL_ROW, 'W'], [14, BALL_ROW, 'W']]);
  });

  // Lane w24_ice_btn_retry, Lexy t31 and t33: the rear ball, refused again, faces west; without the rule it faces east.
  it('lane ice_btn_retry: the refused rear ball faces west at the Lexy tics', async () => {
    const engine = await load('ice_btn_retry', 'w24_');
    play(engine, 32);
    expect(rowCells(engine, BALL_ROW)[1]).toEqual([8, BALL_ROW, 'W']);
    play(engine, 2);
    expect(rowCells(engine, BALL_ROW)[1]).toEqual([8, BALL_ROW, 'W']);
  });
});

describe('off the CC2 engine the wave 25 rules do not apply', () => {
  // Regression guard (it passes with the rules off too): every wave 25 rule is gated on the CC2 engine off the CC3D pace, so a native
  // level queues no afterPass press and its refused rear ball keeps its facing. The room is the jam of cc2IceRetry.test.ts.
  it('regression guard: a native level jam queues no afterPass arrival and keeps the facing of the refused ball', () => {
    const terrain: Record<string, string> = {};
    for (let x = 5; x <= 9; x++) terrain[`${x},${ROOM_ROW}`] = ICE;
    terrain[`4,${ROOM_ROW}`] = WALL;
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'native',
        startX: 1,
        terrain,
        entities: [
          { type: BALL, x: 6, y: ROOM_ROW, dir: 'E' },
          { type: BALL, x: 5, y: ROOM_ROW, dir: 'E' }
        ]
      })
    );
    for (const loaded of engine.getEntities()) delete loaded.atLoadCell;
    engine.tick();
    expect(world(engine).ccArrivals.some((a) => a.afterPass === true)).toBe(false);
    const rear = engine.getEntities().filter((e) => e.type === BALL).sort((a, b) => a.x - b.x)[0];
    expect(rear.dir).toBe('E');
  });
});
