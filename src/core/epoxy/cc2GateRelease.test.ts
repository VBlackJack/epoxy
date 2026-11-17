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
 * CC2 wave 18, batch C: a clone machine fed only through delayed gates releases its clone in the wire phase of its own sub-settle of the
 * tick-end settle, not as an untagged late release. Lexy powers it in the frame-2 wire phase of the tic the arrival reached (one gate), or
 * in the frame-0 / frame-1 phase of the next (two, three gates), and the out-of-turn step ends 11 frames after that phase (game.js:872-889,
 * 2218-2242). The lanes below are w18_or1 / w18_oror / w18_oror3 (Lexy: the clone lands in tic 8, 8, 9; the direct lane lands in 8).
 * Lane evidence, not unit-built: a parked player (no actor order) lands the gate release exactly where the direct release does in the same
 * mode (lanes directp, or1p, ororp), so the pending pre-pass needs no special case (the arrival is held uncounted).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, EntityPlacement, RuntimeEntity, SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const OR_GATE = 'signal_gate_or_cc2';
const PLATE = 'signal_plate';
const CLONE_MACHINE = 'clone_machine';
const LAUNCHER = 'shot_launcher_e';
const BLOCK = 'dirt_block';
const BALL = 'rolling_ball';
const SEED = 3;
const PLATE_X = 3;
const GATE_X = 4;
const SINK_X = 9;
const CLONE_X = SINK_X + 1;
const LANE_TICKS = 24;
/** The arrival frame tags of the clones of 1, 2 and 3 OR gates: the 12-frame step ends in frame 1, 2, 0 (sub-settles 1, 2, 3). */
const GATE_END_FRAMES: readonly number[] = [1, 2, 0];
/** Measured on the code before the stamp: the tick the first shot of a launcher through 1, 2, 3 OR gates is in flight. */
const LAUNCHER_FIRST_SHOT_TICKS: readonly number[] = [5, 5, 5];
/** Measured on the code before the stamp: the ball template through 1 OR, released at the fifth tick, steps out and on (position:cooldown). */
const BALL_TRACE_ONE_OR = '9:0 9:0 9:0 9:0 10:3/9:0 10:2/9:0 10:1/9:0 10:0/9:0 11:3/9:0 11:2/9:0 11:1/9:0 11:0/9:0';
/** Ticks of the ball trace the guard pins. */
const BALL_TRACE_TICKS = 12;
/** The gate counts of the lanes or1, oror, oror3. */
const GATE_COUNTS: readonly number[] = [1, 2, 3];

const link = (fromX: number, toX: number): SignalLink => ({ fromX, fromY: ROOM_ROW, toX, toY: ROOM_ROW });
const at = (x: number, id: string): [string, string] => [`${x},${ROOM_ROW}`, id];

function load(tiles: readonly [string, string][], links: SignalLink[], startX: number, entities: EntityPlacement[]): GameEngine {
  const level: CompiledLevel = room({ mode: 'cc2', startX, terrain: Object.fromEntries(tiles), entities });
  level.signalLinks = links;
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return engine;
}

const landed = (b: RuntimeEntity): boolean => b.arrivalTicks === undefined && b.cc2ArrivalWait === undefined && b.cc2ArrivalFrame === undefined;

/** The player steps east onto a plate wired through `gates` OR gates to a sink (the lane of Lexy or1 / oror / oror3). */
function orChain(gates: number, sinkTile: string, templateType: string): GameEngine {
  const gateXs = Array.from({ length: gates }, (_, i) => GATE_X + i);
  const tiles: [string, string][] = [at(PLATE_X, PLATE), ...gateXs.map((x): [string, string] => at(x, OR_GATE)), at(SINK_X, sinkTile)];
  const xs = [PLATE_X, ...gateXs, SINK_X];
  const templates: EntityPlacement[] = sinkTile === CLONE_MACHINE ? [{ type: templateType, x: SINK_X, y: ROOM_ROW, dir: 'E' }] : [];
  const engine = load(tiles, xs.slice(1).map((x, i) => link(xs[i], x)), PLATE_X - 1, templates);
  engine.attemptPlayerMove('E');
  return engine;
}

/** The tick the block clone lands and the arrival frame tag it carried the first tick it was seen. */
function orChainLanding(gates: number): { tick: number; frame: number | undefined } {
  const engine = orChain(gates, CLONE_MACHINE, BLOCK);
  let frame: number | undefined;
  for (let i = 0; i < LANE_TICKS; i++) {
    engine.tick();
    const clone = engine.getEntities().find((e) => e.kind === 'block' && e.x === CLONE_X && e.y === ROOM_ROW);
    if (clone !== undefined && frame === undefined) frame = clone.cc2ArrivalFrame ?? -1;
    if (clone !== undefined && landed(clone)) return { tick: engine.getTick(), frame };
  }
  throw new Error('the clone never landed');
}

describe('C: a gate-fed clone machine releases its clone in the frame of its wire phase (GCR)', () => {
  // Lexy lanes or1 / oror / oror3: the clone appears t4 f2, t5 f0, t5 f1 and lands t8, t8, t9. Without the stamp the third lands a tick early.
  it('lands the clones of 1, 2 and 3 OR gates in ticks L, L and L + 1', () => {
    const [one, two, three] = GATE_COUNTS.map(orChainLanding);
    expect(two.tick).toBe(one.tick);
    expect(three.tick).toBe(one.tick + 1);
  });

  // The end frame follows the sub-settle of the tick end: released in [2, 0, 1][s - 1], so the 12-frame step ends in frame 1, 2, 0.
  it('tags the arrival of the clone with the end frame of its sub-settle (1, 2, 0)', () => {
    expect(GATE_COUNTS.map((gates) => orChainLanding(gates).frame)).toEqual(GATE_END_FRAMES);
  });
});

/** The tick the first shot of a launcher fed through `gates` OR gates is in flight. */
function launcherFirstShotTick(gates: number): number {
  const engine = orChain(gates, LAUNCHER, BLOCK);
  for (let i = 0; i < LANE_TICKS; i++) {
    engine.tick();
    if ((engine.getShots()?.length ?? 0) > 0) return engine.getTick();
  }
  return -1;
}

/** The position and cooldown of every monster, per tick, of a ball template cloned through `gates` OR gates. */
function ballTrace(gates: number): string {
  const engine = orChain(gates, CLONE_MACHINE, BALL);
  const trace: string[] = [];
  for (let i = 0; i < BALL_TRACE_TICKS; i++) {
    engine.tick();
    trace.push(
      engine
        .getEntities()
        .filter((e) => e.kind === 'monster')
        .map((e) => `${e.x}:${e.cooldownTicks}`)
        .join('/')
    );
  }
  return trace.join(' ');
}

describe('C: scope guards (the stamp is for block clones released by a clone machine only)', () => {
  // Guards, not rule tests: they pass with the stamp reverted too, and fail only if the stamp is widened to a launcher or a monster
  // template. Lexy lane w18_or1ball: the ball clone moves as in the base every tick (the monster stamp changes nothing visible).
  it('a launcher fed through an OR fires on the tick it fired before the stamp (cloner only)', () => {
    expect(GATE_COUNTS.map(launcherFirstShotTick)).toEqual(LAUNCHER_FIRST_SHOT_TICKS);
  });

  it('a ball template through an OR keeps its cooldown trace (blocks only)', () => {
    expect(ballTrace(1)).toBe(BALL_TRACE_ONE_OR);
  });
});

