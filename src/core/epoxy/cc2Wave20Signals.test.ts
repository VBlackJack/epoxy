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
 * CC2 wave 20, batch S (signals): the Lexy lanes of the straight or gate timing of a mixed sink (mixed, mixed2, gateonly; mixed_push is in
 * cc2GateDelay.test.ts) and of the data latches and counters a gate-delay network delays like a gate (latch_mid, latch_or, cnt_mid, dlnot).
 * Each lane is an original small .c2m (src/core/epoxy/__fixtures__/cc2-lanes) played on the CC2 engine; the player's input is the lane's
 * (RIGHT at tic 0, none for dlnot). tick() k plays Lexy tic k - 1: a Lexy decision row t is the decisions inside tick t + 1, a Lexy end of tic
 * t is the state right after tick t + 1. The clone is the dirt block the cloner (10, 7) lets out at (11, 7); it has landed once it no longer
 * slides.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { ROOM_ROW, ROOM_SIZE, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, SignalLink } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 3;
const BLOCK = 'dirt_block';
const CLONE_X = 11;
const CLONE_Y = 7;
const LANE_TICKS = 14;
/** RIGHT is held for this many tics (the lane's input; dlnot has none). */
const LANE_INPUT_TICKS = 1;
const NO_INPUT_TICKS = 0;

interface CloneSeen {
  /** The clone is on the floor. */
  out: boolean;
  /** The clone is on the floor and no longer slides. */
  landed: boolean;
}

/** The first tick at which each moment is seen: at the decisions inside the tick (dec) and right after it (post). */
interface LaneTicks {
  decOut: number;
  decLanded: number;
  postOut: number;
  postLanded: number;
}

/** Plays a lane and reports, for the clone, the first tick of each moment (-1 when never). */
async function playLane(lane: string, inputTicks: number): Promise<LaneTicks> {
  loadTestConfigs();
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane), SEED);
  const read = (): CloneSeen => {
    const clone = engine.getEntities().find((e) => e.type === BLOCK && e.x === CLONE_X && e.y === CLONE_Y);
    return { out: clone !== undefined, landed: clone !== undefined && !clone.isSliding };
  };
  const ticks: LaneTicks = { decOut: -1, decLanded: -1, postOut: -1, postLanded: -1 };
  for (let i = 0; i < LANE_TICKS; i++) {
    if (i < inputTicks) engine.attemptPlayerMove('E');
    const seen = readAtDecisionAndAfter(() => engine.tick(), read);
    const tick = engine.getTick();
    if (ticks.decOut < 0 && seen.decision?.out === true) ticks.decOut = tick;
    if (ticks.decLanded < 0 && seen.decision?.landed === true) ticks.decLanded = tick;
    if (ticks.postOut < 0 && seen.after.out) ticks.postOut = tick;
    if (ticks.postLanded < 0 && seen.after.landed) ticks.postLanded = tick;
  }
  return ticks;
}

describe('a mixed sink: the straight or gate timing is decided at its edge (MIXS, MIXG)', () => {
  // Lane mixed (Lexy): plate -> direct wire and OR -> cloner: clone at the t4 decisions and at the end of t4, landed at t8 (decisions and end).
  it('lane mixed: a straight-wired plate that is on fires the cloner with the direct sinks', async () => {
    expect(await playLane('mixed', LANE_INPUT_TICKS)).toEqual({ decOut: 5, decLanded: 9, postOut: 5, postLanded: 9 });
  });

  // Lanes mixed2 and gateonly (Lexy, identical): the OR path pressed, no straight-wired source on: clone at the t5 decisions, end of t4,
  // landed at t8. mixed2 must be exactly gateonly: the straight wire of a plate no one presses changes nothing.
  it('lane gateonly: the gate path alone', async () => {
    expect(await playLane('gateonly', LANE_INPUT_TICKS)).toEqual({ decOut: 6, decLanded: 9, postOut: 5, postLanded: 9 });
  });

  it('lane mixed2: the straight wire of a plate that is never pressed times the sink as the gate path alone', async () => {
    const mixed2 = await playLane('mixed2', LANE_INPUT_TICKS);
    expect(mixed2).toEqual(await playLane('gateonly', LANE_INPUT_TICKS));
    expect(mixed2).toEqual({ decOut: 6, decLanded: 9, postOut: 5, postLanded: 9 });
  });
});

describe('a data latch or a counter is delayed like a gate (LG)', () => {
  // Lane latch_mid (Lexy): the latch (input plate held at load, trigger plate stepped on at tic 0) feeds the cloner directly: powered at the t5
  // decisions, clone out at the end of t4 and at the t5 decisions, landed by the t8 decisions (end of t8).
  it('lane latch_mid: a data latch feeding a cloner', async () => {
    expect(await playLane('latch_mid', LANE_INPUT_TICKS)).toEqual({ decOut: 6, decLanded: 9, postOut: 5, postLanded: 9 });
  });

  // Lane cnt_mid (Lexy): a counter at 0 whose decrement plate is stepped on at tic 0: the underflow feeds the cloner, as latch_mid.
  it('lane cnt_mid: a counter underflow feeding a cloner', async () => {
    expect(await playLane('cnt_mid', LANE_INPUT_TICKS)).toEqual({ decOut: 6, decLanded: 9, postOut: 5, postLanded: 9 });
  });

  // Lane latch_or (Lexy): latch -> OR -> cloner: clone at the t5 decisions (no extra tick), out at the end of t5, landed at the t9 decisions
  // (end of t8). The latch-class deferral made it a tick later; delaying the latch without gate-timing the sink would too (the LGD mutant).
  it('lane latch_or: a data latch behind an OR feeding a cloner', async () => {
    expect(await playLane('latch_or', LANE_INPUT_TICKS)).toEqual({ decOut: 6, decLanded: 10, postOut: 6, postLanded: 9 });
  });

  // Lane dlnot (Lexy, wave 18 leftover): data and clock plates held at load, latch -> NOT -> cloner: clone at tic 0 (decisions and end of tic),
  // landed at the end of t3 (decisions of t4).
  it('lane dlnot: a data latch held on at load behind a NOT lands its clone at tic 3', async () => {
    expect(await playLane('dlnot', NO_INPUT_TICKS)).toEqual({ decOut: 1, decLanded: 5, postOut: 1, postLanded: 4 });
  });
});

describe('the input a delayed counter read at its last settle (counterSeen)', () => {
  const COUNTER = 'signal_counter_0_cc2';
  const NOT_GATE = 'signal_gate_not_cc2';
  const GATE_X = 5;
  const SINK_X = 8;
  const START_X = 2;
  const CLOCK_TICKS = 3;
  const COUNTED_TICKS = 2;
  const cell = (x: number): number => ROOM_ROW * ROOM_SIZE + x;
  const link = (fromX: number, toX: number, port?: string): SignalLink => ({ fromX, fromY: ROOM_ROW, toX, toY: ROOM_ROW, ...(port === undefined ? {} : { port }) });
  const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

  /** A NOT clock (wired to its own input) counting through a counter: the counter reads its input a phase late. */
  function clockLane(mode: RoomMode): GameEngine {
    const level: CompiledLevel = room({ mode, startX: START_X, terrain: { [`${GATE_X},${ROOM_ROW}`]: NOT_GATE, [`${SINK_X},${ROOM_ROW}`]: COUNTER } });
    level.signalLinks = [link(GATE_X, SINK_X, 'in0')];
    if (level.cc2 !== undefined) level.cc2 = { ...level.cc2, selfLinks: [cell(GATE_X)] };
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    return engine;
  }

  const count = (engine: GameEngine): number => engine.getCounterValues()?.get(cell(SINK_X)) as number;

  it('is kept on a gate-delay network once a counter settles, and a snapshot restores it', () => {
    const engine = clockLane('cc2');
    for (let i = 0; i < CLOCK_TICKS; i++) engine.tick();
    const seen = world(engine).signals?.state.counterSeen;
    expect(seen).toBeDefined();
    const snapshot = engine.captureState();
    expect(snapshot.signals?.counterSeen).toEqual(seen);
    // The snapshot owns a copy: the live state moving on does not change it.
    expect(snapshot.signals?.counterSeen).not.toBe(seen);
    const followed: number[] = [];
    for (let i = 0; i < COUNTED_TICKS; i++) {
      engine.tick();
      followed.push(count(engine));
    }
    engine.restoreState(snapshot);
    expect(world(engine).signals?.state.counterSeen).toEqual(snapshot.signals?.counterSeen);
    const replayed: number[] = [];
    for (let i = 0; i < COUNTED_TICKS; i++) {
      engine.tick();
      replayed.push(count(engine));
    }
    expect(replayed).toEqual(followed);
  });

  it('is never set on a native level, whose counter reads the wires of its own phase', () => {
    const engine = clockLane('native');
    for (let i = 0; i < CLOCK_TICKS; i++) engine.tick();
    expect(world(engine).signals?.network.gateDelay).toBeUndefined();
    expect(world(engine).signals?.state.counterSeen).toBeUndefined();
  });
});
