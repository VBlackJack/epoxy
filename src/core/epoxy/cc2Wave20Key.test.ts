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
 * CC2 wave 20, batch I0: the hidden state keys of the wave 20 rules (cc2-wave20 plan, F3). Each new part of cc2HiddenStateKey and of
 * cc3dArrivalKey is present exactly when its state is, and absent otherwise. The state is set by hand so that each key part is tested
 * apart from the rule that writes it (the rules have their own lane tests); the lane fixtures are only checked to import and run on the
 * CC2 engine.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { usesCc2Engine } from './ccRules';
import type { CompiledLevel, SignalLink } from '../types';
import { cc2HiddenStateKey, cc3dArrivalKey, copyCc3dArrival, currentEntityPass, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const DLATCH = 'signal_gate_dlatch_cc2';
const COUNTER = 'signal_counter_0_cc2';
const PLATE = 'signal_plate';
const DOOR = 'hold_door_red_closed';
const SEED = 3;
const PLATE_X = 3;
const SECOND_PLATE_X = 4;
const NODE_X = 5;
const SINK_X = 8;
const START_X = 2;
/** The hidden state key joins its parts with this separator (cc2HiddenStateKey). */
const KEY_PART_SEPARATOR = ';';
/** A cell index and a due pass used by the hand-set deferred edge and press. */
const EDGE_CELL = 40;
const PRESS_UID = 7;
const PRESS_DUE_AHEAD = 2;
const COUNTER_VALUE = 3;
const SEEN_INCREMENT = 1;
const HAZARD_CELL = { x: 3, y: ROOM_ROW };
const PASS_SHIFT = 5;
/** Ticks each lane fixture is played for in the smoke test: enough to reach the first clone, far from any lane's end. */
const LANE_SMOKE_TICKS = 5;
/** The 19 lane fixtures the wave 20 tests cite (src/core/epoxy/__fixtures__/cc2-lanes). */
const LANE_FIXTURES: readonly string[] = [
  'mixed', 'mixed2', 'mixed_push', 'gateonly', 'latch_or', 'latch_mid', 'cnt_mid', 'dlnot', 'nest_or1', 'nest_oror', 'nest_direct',
  'nest_player', 'nest3', 'nest_walk', 'nest_block', 'hz_flame_jet_on', 'beh_jet_k4', 'jet_out_mid', 'jet_lit_mid'
];

const link = (fromX: number, toX: number, port?: string): SignalLink => ({ fromX, fromY: ROOM_ROW, toX, toY: ROOM_ROW, ...(port === undefined ? {} : { port }) });
const at = (x: number, id: string): [string, string] => [`${x},${ROOM_ROW}`, id];
const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const parts = (w: EpoxyWorld): string[] => cc2HiddenStateKey(w).split(KEY_PART_SEPARATOR);
const partStarting = (w: EpoxyWorld, prefix: RegExp): string | undefined => parts(w).find((part) => prefix.test(part));

function load(mode: RoomMode, tiles: readonly [string, string][], links: SignalLink[]): GameEngine {
  const level: CompiledLevel = room({ mode, startX: START_X, terrain: Object.fromEntries(tiles) });
  level.signalLinks = links;
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return engine;
}

/** A plate feeding a counter, which feeds a door: a gate-delay network with a counter and nothing else that keeps state. */
const counterLane = (mode: RoomMode): GameEngine => load(mode, [at(PLATE_X, PLATE), at(NODE_X, COUNTER), at(SINK_X, DOOR)], [link(PLATE_X, NODE_X, 'in0'), link(NODE_X, SINK_X)]);

/** Two plates feeding a data latch, which feeds a door. */
const dlatchLane = (mode: RoomMode): GameEngine =>
  load(mode, [at(PLATE_X, PLATE), at(SECOND_PLATE_X, PLATE), at(NODE_X, DLATCH), at(SINK_X, DOOR)], [link(PLATE_X, NODE_X, 'in0'), link(SECOND_PLATE_X, NODE_X, 'in1'), link(NODE_X, SINK_X)]);

const nodeIndex = (w: EpoxyWorld, kind: string): number => (w.signals?.network.nodes ?? []).findIndex((node) => node.kind === kind);
const GATE_PART = /^g[01]*\//;
const COUNTER_PART = /^c\d/;

describe('the counter part of the hidden state key (F3)', () => {
  it('is present on a gate-delay network with a counter, with the value, the underflow and the inputs it last read', () => {
    const w = world(counterLane('cc2'));
    expect(partStarting(w, GATE_PART)).toBeDefined();
    const index = nodeIndex(w, 'counter');
    const state = w.signals?.state;
    expect(index).toBeGreaterThanOrEqual(0);
    expect(state?.counterValues).toBeDefined();
    const fresh = partStarting(w, COUNTER_PART);
    expect(fresh).toBe('c00');
    (state?.counterValues as number[])[index] = COUNTER_VALUE;
    expect(partStarting(w, COUNTER_PART)).toBe(`c${COUNTER_VALUE}0`);
    (state?.counterUnderflow as boolean[])[index] = true;
    expect(partStarting(w, COUNTER_PART)).toBe(`c${COUNTER_VALUE}u0`);
    state!.counterSeen = w.signals?.network.nodes.map(() => 0);
    (state?.counterSeen as number[])[index] = SEEN_INCREMENT;
    expect(partStarting(w, COUNTER_PART)).toBe(`c${COUNTER_VALUE}u${SEEN_INCREMENT}`);
  });

  it('is absent from a gate-delay network without a counter', () => {
    const w = world(dlatchLane('cc2'));
    expect(partStarting(w, GATE_PART)).toBeDefined();
    expect(partStarting(w, COUNTER_PART)).toBeUndefined();
  });

  it('is absent from a native level, which has no gate delay', () => {
    const w = world(counterLane('native'));
    expect(w.signals?.network.gateDelay).toBeUndefined();
    expect(cc2HiddenStateKey(w)).toBe('');
  });

  it('puts a network with only a counter in the gate part (keepsGateState)', () => {
    const w = world(counterLane('cc2'));
    expect(w.signals?.network.nodes.some((node) => node.kind === 'counter')).toBe(true);
    expect(w.signals?.network.nodes.some((node) => node.kind === 'latch' || node.kind === 'dlatch' || node.kind === 'and' || node.kind === 'or')).toBe(false);
    expect(partStarting(w, GATE_PART)).toBeDefined();
  });
});

describe('the delayed outputs of data latches and counters in the gate part (F3)', () => {
  it('tells a data latch output on from off', () => {
    const w = world(dlatchLane('cc2'));
    const index = nodeIndex(w, 'dlatch');
    const state = w.signals?.state;
    (state?.lastOutputs as boolean[])[index] = false;
    const off = partStarting(w, GATE_PART);
    (state?.lastOutputs as boolean[])[index] = true;
    const on = partStarting(w, GATE_PART);
    expect(on).not.toBe(off);
    expect(on?.split('/')[0].charAt(1 + index)).toBe('1');
  });

  it('tells a counter output on from off', () => {
    const w = world(counterLane('cc2'));
    const index = nodeIndex(w, 'counter');
    const state = w.signals?.state;
    (state?.lastOutputs as boolean[])[index] = false;
    const off = partStarting(w, GATE_PART);
    (state?.lastOutputs as boolean[])[index] = true;
    expect(partStarting(w, GATE_PART)).not.toBe(off);
  });

  it('leaves a source output out of the gate part', () => {
    const w = world(dlatchLane('cc2'));
    const source = nodeIndex(w, 'source');
    const state = w.signals?.state;
    (state?.lastOutputs as boolean[])[source] = false;
    const off = cc2HiddenStateKey(w);
    (state?.lastOutputs as boolean[])[source] = true;
    expect(cc2HiddenStateKey(w)).toBe(off);
  });
});

describe('the straight mark of a deferred sink edge in the hidden state key (F1, F3)', () => {
  it('marks a straight edge with s and leaves a plain one unmarked', () => {
    const w = world(dlatchLane('cc2'));
    w.cc2DeferredSinkEdges = [{ cell: EDGE_CELL, rising: true }];
    const plain = partStarting(w, /^d/);
    expect(plain).toBe(`d${EDGE_CELL}+`);
    w.cc2DeferredSinkEdges = [{ cell: EDGE_CELL, rising: true, straight: true }];
    expect(partStarting(w, /^d/)).toBe(`d${EDGE_CELL}+s`);
    w.cc2DeferredSinkEdges = [];
    expect(partStarting(w, /^d/)).toBeUndefined();
  });

  it('keeps the mark through a capture and a restore, and drops it when the level restarts', () => {
    const engine = dlatchLane('cc2');
    const w = world(engine);
    w.cc2DeferredSinkEdges = [{ cell: EDGE_CELL, rising: false, straight: true }, { cell: EDGE_CELL + 1, rising: true }];
    const snapshot = engine.captureState();
    expect(snapshot.cc2DeferredSinkEdges).toEqual([{ cell: EDGE_CELL, rising: false, straight: true }, { cell: EDGE_CELL + 1, rising: true }]);
    w.cc2DeferredSinkEdges = [];
    engine.restoreState(snapshot);
    expect(world(engine).cc2DeferredSinkEdges).toEqual([{ cell: EDGE_CELL, rising: false, straight: true }, { cell: EDGE_CELL + 1, rising: true }]);
    expect(partStarting(world(engine), /^d/)).toBe(`d${EDGE_CELL}-s,${EDGE_CELL + 1}+`);
    // The snapshot holds copies: changing the live edge leaves it as it was.
    delete world(engine).cc2DeferredSinkEdges[0].straight;
    expect(snapshot.cc2DeferredSinkEdges?.[0].straight).toBe(true);
    engine.loadLevel(world(engine).level, SEED);
    expect(world(engine).cc2DeferredSinkEdges).toEqual([]);
  });
});

describe('the step-end press part of the hidden state key (F3, RB)', () => {
  const press = (due: number, stepEnd: boolean) => ({ uid: PRESS_UID, x: PLATE_X, y: ROOM_ROW, action: 'trigger_cloner' as const, due, ...(stepEnd ? { stepEnd: true as const } : {}) });

  it('is present for a clone press waiting for its step end, with its due pass relative to the running one', () => {
    const w = world(dlatchLane('cc2'));
    const pass = currentEntityPass(w);
    expect(partStarting(w, /^p\d/)).toBeUndefined();
    w.ccArrivals.push(press(pass + PRESS_DUE_AHEAD, true));
    expect(partStarting(w, /^p\d/)).toBe(`p${PRESS_UID}@${PRESS_DUE_AHEAD}s`);
    const key = cc2HiddenStateKey(w);
    // The same position reached later gives the same key.
    w.ccMonsterClock += PASS_SHIFT;
    w.ccArrivals[0].due += PASS_SHIFT;
    expect(cc2HiddenStateKey(w)).toBe(key);
    w.ccArrivals[0].due += 1;
    expect(cc2HiddenStateKey(w)).not.toBe(key);
  });

  it('leaves an ordinary queued press out, as before', () => {
    const w = world(dlatchLane('cc2'));
    const empty = cc2HiddenStateKey(w);
    w.ccArrivals.push(press(currentEntityPass(w) + PRESS_DUE_AHEAD, false));
    expect(cc2HiddenStateKey(w)).toBe(empty);
  });

  it('keeps the mark through a capture and a restore', () => {
    const engine = dlatchLane('cc2');
    const w = world(engine);
    w.ccArrivals.push(press(currentEntityPass(w) + PRESS_DUE_AHEAD, true));
    const snapshot = engine.captureState();
    w.ccArrivals = [];
    engine.restoreState(snapshot);
    expect(world(engine).ccArrivals[0]?.stepEnd).toBe(true);
    expect(partStarting(world(engine), /^p\d/)).toBe(`p${PRESS_UID}@${PRESS_DUE_AHEAD}s`);
  });
});

describe('the hazard mark of a player arrival (F3, JET)', () => {
  it('adds :h with the cell while the step into a hazard waits, and nothing without it', () => {
    const engine = dlatchLane('cc2');
    const w = world(engine);
    expect(cc3dArrivalKey(w)).toBe('');
    w.player.cc3dArrival = { hazard: { ...HAZARD_CELL } };
    expect(cc3dArrivalKey(w)).toBe(`0:-:-:-:h${HAZARD_CELL.x}.${HAZARD_CELL.y}`);
    w.player.cc3dArrival = { bomb: { ...HAZARD_CELL } };
    expect(cc3dArrivalKey(w)).not.toContain(':h');
  });

  it('is copied and kept through a capture and a restore', () => {
    const engine = dlatchLane('cc2');
    const w = world(engine);
    const arrival = { hazard: { ...HAZARD_CELL } };
    const copy = copyCc3dArrival(arrival);
    expect(copy).toEqual(arrival);
    expect(copy.hazard).not.toBe(arrival.hazard);
    w.player.cc3dArrival = arrival;
    const snapshot = engine.captureState();
    w.player.cc3dArrival = undefined;
    engine.restoreState(snapshot);
    expect(world(engine).player.cc3dArrival).toEqual({ hazard: HAZARD_CELL });
    expect(cc3dArrivalKey(world(engine))).toContain(`:h${HAZARD_CELL.x}.${HAZARD_CELL.y}`);
  });
});

describe('the wave 20 lane fixtures', () => {
  it.each(LANE_FIXTURES)('lane %s imports as a CC2-engine level and plays', async (lane) => {
    const level = await loadCc2Lane(lane);
    expect(usesCc2Engine(level)).toBe(true);
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    for (let i = 0; i < LANE_SMOKE_TICKS; i++) engine.tick();
    expect(engine.getTick()).toBe(LANE_SMOKE_TICKS);
  });
});
