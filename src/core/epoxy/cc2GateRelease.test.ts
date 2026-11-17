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
 *
 * Wave 19: the guards below pin the monster and launcher timings the frame wire phases give (a gate-fed release of the frame-0 and
 * frame-1 phases takes the before-pass tick of a monster clone, game.js:872-889, 2218-2242). tick() k plays the Lexy tic k - 1.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
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
/**
 * The tick whose end first shows a shot in flight, for a launcher fed through 1, 2, 3 OR gates: the launcher fires in the wire phase its
 * sink rises in (f2 of t4, f0 of t5, f1 of t5), the Lexy end of tic of those; no Lexy launcher lane exists, the cloner lanes or1 / oror /
 * oror3 (clone out t4, t5, t5) give the phases. Before wave 19: 5, 5, 5.
 */
const LAUNCHER_FIRST_SHOT_TICKS: readonly number[] = [5, 6, 6];
/** The tick whose decisions first see the shot in flight (the frame-2 decisions after the phases of the launcher above). */
const LAUNCHER_SHOT_AT_DECISION_TICK = 6;
/**
 * The ball template through 1, 2 and 3 ORs (position:cooldown:frame tag per monster, per tick, after each tick). One OR is released in
 * the frame-2 phase of the tick end and keeps the trace of before wave 19 (Lexy lane w18_or1ball: out t4, first step t8). Two and three
 * ORs are released in the f0 / f1 phase of the next tic (out t5), the clone carries the frame of its phase (tag 2, 0) and its 12-frame
 * step ends in frame 2 of t + 3 / frame 0 of t + 4, so its first decision is at t9 (lanes wororball, woror3ball: first step t9).
 */
const BALL_TRACE_ONE = '9:0:- 9:0:- 9:0:- 9:0:- 10:3:-/9:0:- 10:2:-/9:0:- 10:1:-/9:0:- 10:0:-/9:0:- 11:3:-/9:0:- 11:2:-/9:0:- 11:1:-/9:0:- 11:0:-/9:0:-';
const BALL_TRACE_TWO = '9:0:- 9:0:- 9:0:- 9:0:- 9:0:- 10:3:2/9:0:- 10:2:2/9:0:- 10:1:2/9:0:- 10:0:2/9:0:- 11:3:-/9:0:- 11:2:-/9:0:- 11:1:-/9:0:-';
const BALL_TRACE_THREE = '9:0:- 9:0:- 9:0:- 9:0:- 9:0:- 10:3:0/9:0:- 10:2:0/9:0:- 10:1:0/9:0:- 10:0:0/9:0:- 11:3:-/9:0:- 11:2:-/9:0:- 11:1:-/9:0:-';
const BALL_TRACES: readonly string[] = [BALL_TRACE_ONE, BALL_TRACE_TWO, BALL_TRACE_THREE];
/** The tick whose end shows the first step of the ball clone of 1, 2 and 3 ORs (Lexy lanes w18_or1ball, wororball, woror3ball: t8, t9, t9). */
const BALL_FIRST_STEP_TICKS: readonly number[] = [9, 10, 10];
/** The clone cell of the ball lane and the cell it steps to. */
const BALL_STEP_X = CLONE_X + 1;
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

/** The first tick whose end shows a shot of a launcher fed through `gates` OR gates in flight, and the first whose decisions see it. */
function launcherFirstShot(gates: number): { post: number; decision: number } {
  const engine = orChain(gates, LAUNCHER, BLOCK);
  let post = -1;
  let decision = -1;
  for (let i = 0; i < LANE_TICKS; i++) {
    const seen = readAtDecisionAndAfter(() => engine.tick(), () => (engine.getShots()?.length ?? 0) > 0);
    if (decision < 0 && seen.decision === true) decision = engine.getTick();
    if (post < 0 && seen.after) post = engine.getTick();
  }
  return { post, decision };
}

/** The position, cooldown and frame tag of every monster, per tick, of a ball template cloned through `gates` OR gates. */
function ballTrace(gates: number): string {
  const engine = orChain(gates, CLONE_MACHINE, BALL);
  const trace: string[] = [];
  for (let i = 0; i < BALL_TRACE_TICKS; i++) {
    engine.tick();
    trace.push(
      engine
        .getEntities()
        .filter((e) => e.kind === 'monster')
        .map((e) => `${e.x}:${e.cooldownTicks}:${e.cc2Frame ?? '-'}`)
        .join('/')
    );
  }
  return trace.join(' ');
}

/** The first tick whose end shows the ball clone of `gates` OR gates one cell past its machine, and what the decisions of that tick see. */
function ballFirstStep(gates: number): { tick: number; cooldownAtDecision: number | undefined } {
  const engine = orChain(gates, CLONE_MACHINE, BALL);
  const ballAt = (x: number): RuntimeEntity | undefined => engine.getEntities().find((e) => e.kind === 'monster' && e.x === x);
  for (let i = 0; i < LANE_TICKS; i++) {
    const seen = readAtDecisionAndAfter(() => engine.tick(), () => ballAt(CLONE_X)?.cooldownTicks);
    if (ballAt(BALL_STEP_X) !== undefined) return { tick: engine.getTick(), cooldownAtDecision: seen.decision };
  }
  throw new Error('the ball never stepped');
}

describe('C: scope guards (the stamp is for block clones released by a clone machine only)', () => {
  // A guard on the placement: a launcher fires in the wire phase its sink rises in, the model the Lexy cloner lanes check (no Lexy
  // launcher lane exists). Its shot is in flight after tick 5 / 6 / 6 and at the decisions of tick 6 for all three. The guard part: the
  // gate release stamp (frameGateRelease) is for a clone machine only, so a stamp widened to a launcher moves these ticks.
  it('a launcher fed through an OR fires in the wire phase its sink rises in (cloner stamp only)', () => {
    const shots = GATE_COUNTS.map(launcherFirstShot);
    expect(shots.map((s) => s.post)).toEqual(LAUNCHER_FIRST_SHOT_TICKS);
    expect(shots.map((s) => s.decision)).toEqual(GATE_COUNTS.map(() => LAUNCHER_SHOT_AT_DECISION_TICK));
  });

  // The traces carry the frame tag (cc2Frame) of every ball, so a stamp widened to monster templates fails here. Lexy lanes w18_or1ball /
  // wororball / woror3ball: appear at the end of tic t4, t5, t5, first step t8, t9, t9.
  it('a ball template through 1, 2 and 3 ORs keeps its cooldown and frame trace (blocks only)', () => {
    expect(GATE_COUNTS.map(ballTrace)).toEqual(BALL_TRACES);
  });

  // The first step is decided in tick 9 / 10 / 10 (Lexy t8, t9, t9): at the decisions of that tick the clone's cooldown has run out.
  it('a ball clone of 1, 2 and 3 ORs takes its first step in tick 9, 10, 10, with no cooldown left at those decisions', () => {
    const steps = GATE_COUNTS.map(ballFirstStep);
    expect(steps.map((s) => s.tick)).toEqual(BALL_FIRST_STEP_TICKS);
    expect(steps.map((s) => s.cooldownAtDecision)).toEqual(GATE_COUNTS.map(() => 0));
  });
});
