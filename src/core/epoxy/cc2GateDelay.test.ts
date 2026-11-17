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
 * CC2 wave 17, the wire model of the CC2 engine: a logic gate adds one wire phase (Lexy tiletypes.js logic_gate is_emitting reads the
 * powered edges of the last wire phase; game.js do_wire_phase), a tick end stands for three wire phases and tic 0 for one early gate
 * step, an OR or a NOT gate wired to its own input latches or clocks, and a clone machine fed through delayed gates fires in the
 * settle where its edge rises. Native, .DAT and CC1 levels keep the gates in the phase of their inputs.
 *
 * The Lexy loop every citation here means is the one the oracle runs: compat.emulate_60fps (game.js:839-843) selects
 * _advance_tic_lynx60 (game.js:872-889), three frames of decision, action and wire phase; the first non-forced decision is at frame 2,
 * so it sees the wire phases f0 and f1, and f0 only carries the sources onto the wires (every wire starts off, game.js:602, 728).
 *
 * Wave 19: the tick end is the frame-2 wire phase only, and the frame-0 and frame-1 phases run with the pre-pass frames of the next tic.
 * Two observation points therefore differ, and the tests below pin both: right after tick() (the Lexy end of tic, a frame-2 phase
 * included) and at the decisions inside the tick (the frame-2 decisions of Lexy, after the frame 0 and 1 phases). tick() k plays the
 * Lexy tic k - 1.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const settleCalls = vi.hoisted(() => [] as { gates: unknown; edges: { cell: number; rising: boolean }[] }[]);

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
// The decision point of a tick has no hook in the engine: the real epoxyFrames, followed by the sampler of readAtDecisionAndAfter.
vi.mock('./epoxyFrames', async (importOriginal) => (await import('../../test/cc2DecisionProbe')).decisionSamplingFrames(await importOriginal<typeof import('./epoxyFrames')>()));
vi.mock('./epoxySignals', async (importOriginal) => {
  const real = await importOriginal<typeof import('./epoxySignals')>();
  return {
    ...real,
    // Records every settle (its gate phases and the edges it returned) and delegates to the real one.
    // The pre-pass settle of epoxyFrames is not recorded (a circular import hands it the real function).
    settleWorldSignals: (...args: Parameters<typeof real.settleWorldSignals>) => {
      const edges = real.settleWorldSignals(...args);
      settleCalls.push({ gates: args[3], edges: edges.map((edge) => ({ ...edge })) });
      return edges;
    }
  };
});

import { readAtDecisionAndAfter } from '../../test/cc2DecisionProbe';
import { ROOM_ROW, ROOM_SIZE, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { stableStringify } from '../engineSimHash';
import type { CompiledLevel, EntityPlacement, RuntimeEntity, SignalLink } from '../types';
import { GATE_SETTLE_FRAME2 } from './epoxySignals';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
  settleCalls.length = 0;
});

const OR_GATE = 'signal_gate_or_cc2';
const AND_GATE = 'signal_gate_and_cc2';
const NOT_GATE = 'signal_gate_not_cc2';
const LATCH = 'signal_latch_off';
const COUNTER = 'signal_counter_0_cc2';
const PLATE = 'signal_plate';
const DOOR = 'hold_door_red_closed';
const PURPLE_WALL = 'purple_wall';
const TRAP = 'trap_wired';
const CLONE_MACHINE = 'clone_machine';
const BLOCK = 'dirt_block';
const MONSTER = 'glider';
const SEED = 3;

const PLATE_X = 3;
const SECOND_PLATE_X = 4;
const GATE_X = 5;
const SECOND_GATE_X = 6;
const SINK_X = 8;
const CLONE_X = SINK_X + 1;
const START_X = 2;
const FAR_START_X = 7;
const LANE_TICKS = 16;
/** The tick the clone of the NOT lane notheld lands in: Lexy tic t3 (0-based), so the fourth tick Epoxy counts (getTick starts at 1). */
const NOT_LANE_LANDING_TICK = 4;
/** The counter wraps at ten: five ticks keep the counts below it. */
const COUNTER_TICKS = 5;
const SETTLE_TICKS = 4;
/** The mixed upstream sink is powered in this tick, at the end of the tick and at its decisions (Lexy lane mixed, t4). */
const MIXED_POWERED_TICK = 5;
/** A chain of this many gates or fewer reaches the sink in the same tick end as one gate does; one more gate is a tick end later again. */
const GATES_IN_ONE_TICK_END = 3;
/** Chains of 0 to 4 gates: the tick whose end first shows the door powered (Lexy lanes chain0-4, end of tic t4, t4, t5, t5, t5). */
const CHAIN_POWERED_AFTER_TICK: readonly number[] = [5, 5, 6, 6, 6];
/** The tick whose decisions first see the door powered (Lexy lanes chain0-4, frame-2 decisions of tic t4, t5, t5, t5, t6). */
const CHAIN_POWERED_AT_DECISIONS: readonly number[] = [5, 6, 6, 6, 7];
const CHAIN_GATE_COUNTS: readonly number[] = [0, 1, 2, 3, 4];
/** The departure lanes (direct, through one gate): the tick whose end shows the sink fallen (Lexy lanes depart0 / depart1, end of tic t4, t5). */
const DEPARTURE_FALL_AFTER_TICK: readonly number[] = [5, 6];
/** The tick whose decisions see the sink fallen, direct and gated (Lexy lanes depart0 / depart1, frame-2 decisions of tic t5, t5). */
const DEPARTURE_FALL_AT_DECISIONS = 6;
/** Ticks run before the pre-pass lane of the frame-0 phase: the frame-0 wire phase is due from the second tick on. */
const FRAME_PHASE_DUE_TICKS = 3;
/** The F5 lane: force floors carry the player east into water, a plate and a door make the network a gate-delay one. */
const DEATH_FORCE_XS: readonly number[] = [2, 3];
const DEATH_WATER_X = 4;
const DEATH_PLATE_X = 8;
const DEATH_DOOR_X = 10;
const DEATH_LANE_TICKS = 20;
/** Ticks the frame-1 arrival lane is observed for: the arrival tick and the one after it. */
const FRAME_ONE_ARRIVAL_TICKS = 2;
const CHAIN_SINK_X = 10;

const cell = (x: number): number => ROOM_ROW * ROOM_SIZE + x;
const link = (fromX: number, toX: number, port?: string): SignalLink => ({ fromX, fromY: ROOM_ROW, toX, toY: ROOM_ROW, ...(port === undefined ? {} : { port }) });
const at = (x: number, id: string): [string, string] => [`${x},${ROOM_ROW}`, id];
const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const poweredAt = (engine: GameEngine, x: number): boolean => engine.getPoweredSignalCells()?.has(cell(x)) === true;

interface LaneOptions {
  startX?: number;
  entities?: EntityPlacement[];
  selfLinks?: number[];
}

/** A room with the given tiles and wires; `mode` 'cc2' plays the CC2 engine. */
function build(mode: RoomMode, tiles: readonly [string, string][], links: SignalLink[], options: LaneOptions = {}): CompiledLevel {
  const level = room({ mode, startX: options.startX ?? START_X, terrain: Object.fromEntries(tiles), entities: options.entities ?? [] });
  level.signalLinks = links;
  if (options.selfLinks !== undefined && level.cc2 !== undefined) level.cc2 = { ...level.cc2, selfLinks: options.selfLinks };
  return level;
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return engine;
}

/**
 * Plate at x=3, `gates` OR gates in a chain, a hold door at the end; the player steps onto the plate. The first tick whose end shows the
 * door powered, and the first tick whose decisions see it powered (-1 when never; no decision point off the CC2 engine).
 */
function chainFirstPowered(mode: RoomMode, gates: number): { post: number; decision: number } {
  const gateXs = Array.from({ length: gates }, (_, i) => GATE_X + i);
  const tiles: [string, string][] = [at(PLATE_X, PLATE), ...gateXs.map((x): [string, string] => at(x, OR_GATE)), at(CHAIN_SINK_X, DOOR)];
  const xs = [PLATE_X, ...gateXs, CHAIN_SINK_X];
  const links = xs.slice(1).map((x, i) => link(xs[i], x));
  const engine = load(build(mode, tiles, links));
  engine.attemptPlayerMove('E');
  let post = -1;
  let decision = -1;
  for (let i = 0; i < LANE_TICKS; i++) {
    const seen = readAtDecisionAndAfter(() => engine.tick(), () => poweredAt(engine, CHAIN_SINK_X));
    if (decision < 0 && seen.decision === true) decision = engine.getTick();
    if (post < 0 && seen.after) post = engine.getTick();
  }
  return { post, decision };
}

const chainPoweredTick = (mode: RoomMode, gates: number): number => chainFirstPowered(mode, gates).post;

describe('a logic gate adds one wire phase (GPD, GPD3)', () => {
  // Lexy game.js:872-889 runs a wire phase at the end of each of the three frames of a tic, and a gate emits from the powered edges of the last phase:
  // a source that changed reaches a sink through k gates in the k-th phase after it. One to three gates land in the same tick end,
  // the fourth gate waits for the next one.
  // Wave 19: the tick end is the frame-2 phase (one gate step); the f0 and f1 phases of the next tic run with its pre-pass, before the
  // decisions. The end of tic shows 0 to 4 gates powered at 5, 5, 6, 6, 6 (before wave 19: 4, 5, 5, 5, 6) and the decisions see them at
  // 5, 6, 6, 6, 7, where a step into the door decided then passes.
  it('puts a chain of 0 to 4 gates in the end of tick 5, 5, 6, 6, 6 and in the decisions of tick 5, 6, 6, 6, 7', () => {
    const seen = CHAIN_GATE_COUNTS.map((gates) => chainFirstPowered('cc2', gates));
    expect(seen.map((s) => s.post)).toEqual(CHAIN_POWERED_AFTER_TICK);
    expect(seen.map((s) => s.decision)).toEqual(CHAIN_POWERED_AT_DECISIONS);
  });

  it('keeps the gates in the phase of their inputs on a native level', () => {
    const direct = chainPoweredTick('native', 0);
    for (let gates = 1; gates <= GATES_IN_ONE_TICK_END + 1; gates++) expect(chainPoweredTick('native', gates), `${gates} gates`).toBe(direct);
  });

  it('only a CC2 network carries the gate-delay flag', () => {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(GATE_X, OR_GATE), at(SINK_X, DOOR)];
    const links = [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)];
    expect(world(load(build('cc2', tiles, links))).signals?.network.gateDelay).toBe(true);
    for (const mode of ['cc', 'native'] as const) expect(world(load(build(mode, tiles, links))).signals?.network.gateDelay).toBeUndefined();
  });
});

/** The tick the glider leaves a wired trap that a plate opens, with the wire direct or through one OR gate. */
function trapLeaveTick(mode: RoomMode, gated: boolean): number {
  const tiles: [string, string][] = [at(PLATE_X, PLATE), at(SINK_X, TRAP), ...(gated ? [at(GATE_X, OR_GATE)] : [])];
  const links = gated ? [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)] : [link(PLATE_X, SINK_X)];
  const engine = load(build(mode, tiles, links, { entities: [{ type: MONSTER, x: SINK_X, y: ROOM_ROW, dir: 'W' }] }));
  engine.attemptPlayerMove('E');
  for (let i = 0; i < LANE_TICKS + LANE_TICKS; i++) {
    engine.tick();
    if ((engine.getEntities().find((e) => e.type === MONSTER)?.x ?? SINK_X) < SINK_X) return engine.getTick();
  }
  return -1;
}

describe('the memories shape: an OR gate between a plate and a trap (GPD)', () => {
  // Lexy: the gate adds a wire phase, so the trapped monster decides one tic later than with a direct wire.
  it('lets the monster leave one decision later than with a direct wire', () => {
    const direct = trapLeaveTick('cc2', false);
    expect(direct).toBeGreaterThan(0);
    expect(trapLeaveTick('cc2', true)).toBe(direct + 1);
  });

  it('leaves a native level as it was', () => {
    expect(trapLeaveTick('native', true)).toBe(trapLeaveTick('native', false));
  });
});

describe('an OR or a NOT gate wired to its own input (GSL, GPD3)', () => {
  /** The door powered state after each tick; the player steps onto the plate, then off it east at tick `stepOffAt`. */
  function latchHistory(selfLinks: number[] | undefined): number[] {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(GATE_X, OR_GATE), at(FAR_START_X, DOOR)];
    const engine = load(build('cc2', tiles, [link(PLATE_X, GATE_X), link(GATE_X, FAR_START_X)], { selfLinks }));
    engine.attemptPlayerMove('E');
    const history: number[] = [];
    const stepOffAt = 5;
    for (let i = 0; i < LANE_TICKS; i++) {
      engine.tick();
      if (i === stepOffAt) engine.attemptPlayerMove('E');
      history.push(poweredAt(engine, FAR_START_X) ? 1 : 0);
    }
    return history;
  }

  it('latches: the output stays on after the other input falls', () => {
    const history = latchHistory([cell(GATE_X)]);
    expect(history.indexOf(1)).toBeGreaterThanOrEqual(0);
    expect(history[history.length - 1]).toBe(1);
  });

  it('without the self link the same OR falls with its input', () => {
    const history = latchHistory(undefined);
    expect(history.indexOf(1)).toBeGreaterThanOrEqual(0);
    expect(history[history.length - 1]).toBe(0);
  });

  // A NOT on its own output toggles once per wire phase: three times a tick end (game.js:872-889), and holds in a move settle. Lexy lane
  // (a NOT wired to its own input, a purple wall on its output circuit, the player one step into the wall at tic t only; dump.mjs on the
  // .c2m): the step succeeds at tics 1, 3, 5 and is refused at 0, 2, 4, 6, because the clock has run one gate step before the first
  // decision. Tic 0 runs two gate steps (TIC0_SUB_SETTLES), the first from all-off wires; the clock reaches the first decision in the phase
  // of one step from load, as the first of the two steps starts from all-off wires.
  it('a NOT clock leaves the wall it toggles open at the decisions of tics 1, 3, 5 only', () => {
    const OPEN_AT = [false, true, false, true, false, true];
    const stepsThrough = (waitTicks: number): boolean => {
      const tiles: [string, string][] = [at(GATE_X, NOT_GATE), at(SINK_X, PURPLE_WALL)];
      const engine = load(build('cc2', tiles, [link(GATE_X, SINK_X)], { selfLinks: [cell(GATE_X)], startX: FAR_START_X }));
      for (let i = 0; i < waitTicks; i++) engine.tick();
      engine.attemptPlayerMove('E');
      engine.tick();
      return engine.getPlayer().x === SINK_X;
    };
    expect(OPEN_AT.map((_, tic) => stepsThrough(tic))).toEqual(OPEN_AT);
  });

  // The same clock through a counter: 1, 2, 1, 2 rising edges a tick end from the second tick. Lexy's own counter reads 2, 1, 2, 1 there
  // (counter lane, memory after each tic): a counter is a gate in Lexy and lags its input by one wire phase, which Epoxy's counter does
  // not model; the clock itself (the wall lane above) is in Lexy's phase.
  it('a NOT clock counts 1, 2, 1, 2 rising edges per tick end through a counter', () => {
    const tiles: [string, string][] = [at(GATE_X, NOT_GATE), at(SINK_X, COUNTER)];
    const engine = load(build('cc2', tiles, [link(GATE_X, SINK_X, 'in0')], { selfLinks: [cell(GATE_X)] }));
    const counts: number[] = [];
    for (let i = 0; i < COUNTER_TICKS; i++) {
      engine.tick();
      counts.push(engine.getCounterValues()?.get(cell(SINK_X)) as number);
    }
    // The first tick adds the tic-0 phases; from the second the pattern is steady.
    expect(counts.slice(1).map((count, i) => count - counts[i])).toEqual([1, 2, 1, 2]);
  });
});

describe('the edges of every sub-settle fire in order (GPDS)', () => {
  // AND(plate, NOT plate): the NOT is one phase behind the plate, so the AND rises for one sub-settle and falls in the next: a
  // pulse inside one tick end (LOGICPR has two). The clone machine it feeds fires on that rising edge although the level before and
  // after the tick end is the same.
  function blocksAfterPulse(mode: RoomMode): number {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(GATE_X, NOT_GATE), at(SECOND_GATE_X, AND_GATE), at(SINK_X, CLONE_MACHINE)];
    const links = [link(PLATE_X, GATE_X), link(PLATE_X, SECOND_GATE_X, 'in0'), link(GATE_X, SECOND_GATE_X, 'in1'), link(SECOND_GATE_X, SINK_X)];
    const engine = load(build(mode, tiles, links, { entities: [{ type: BLOCK, x: SINK_X, y: ROOM_ROW, dir: 'E' }] }));
    engine.attemptPlayerMove('E');
    for (let i = 0; i < LANE_TICKS; i++) engine.tick();
    return engine.getEntities().filter((e) => e.type === BLOCK).length;
  }

  it('fires the clone machine of a sink that rises and falls inside one tick end', () => {
    expect(blocksAfterPulse('cc2')).toBe(2);
  });

  it('a native level has no pulse to fire', () => {
    expect(blocksAfterPulse('native')).toBe(1);
  });
});

describe('a clone machine fed through delayed gates fires in the settle (GPDE, GPDE2, GPDX)', () => {
  /**
   * The tick the sink is powered and the tick its clone is on the floor: seen at the end of the tick (post) and at the decisions inside
   * it (decision).
   */
  function fireSeen(tiles: [string, string][], links: SignalLink[]): { post: [number, number]; decision: [number, number] } {
    const engine = load(build('cc2', tiles, links, { entities: [{ type: BLOCK, x: SINK_X, y: ROOM_ROW, dir: 'E' }] }));
    engine.attemptPlayerMove('E');
    const read = (): [boolean, boolean] => [
      poweredAt(engine, SINK_X),
      engine.getEntities().some((e) => e.type === BLOCK && e.x === CLONE_X && e.y === ROOM_ROW)
    ];
    const post: [number, number] = [-1, -1];
    const decision: [number, number] = [-1, -1];
    for (let i = 0; i < LANE_TICKS; i++) {
      const seen = readAtDecisionAndAfter(() => engine.tick(), read);
      for (const k of [0, 1] as const) {
        if (post[k] < 0 && seen.after[k]) post[k] = engine.getTick();
        if (decision[k] < 0 && seen.decision?.[k] === true) decision[k] = engine.getTick();
      }
    }
    return { post, decision };
  }
  const fireTicks = (tiles: [string, string][], links: SignalLink[]): [number, number] => fireSeen(tiles, links).post;
  const plateTile = at(PLATE_X, PLATE);
  const cloner = at(SINK_X, CLONE_MACHINE);

  it('fires the clone of a gate-fed sink in the settle where its edge rises', () => {
    const [powered, cloned] = fireTicks([plateTile, at(GATE_X, OR_GATE), cloner], [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)]);
    expect(powered).toBeGreaterThan(0);
    expect(cloned).toBe(powered);
  });

  // Lexy lane mixed (a plate wired to the cloner straight and through one gate): the clone is on the floor at the end of tic t4 and at its
  // frame-2 decisions, with the power. Epoxy: the end of the tick is Lexy's (power and clone in tick 5), but the straight-wired source
  // keeps its deferral to the next pass, so the decisions of tick 5 see the sink powered and the clone only at tick 6: a pinned gap
  // (the decisions of Lexy t4 see the clone). Fixing it is a separate change in the shared before-pass path.
  it('keeps the deferral of a sink that also has a source wired straight in (mixed upstream)', () => {
    const { post, decision } = fireSeen([plateTile, at(GATE_X, OR_GATE), cloner], [link(PLATE_X, GATE_X), link(GATE_X, SINK_X), link(PLATE_X, SINK_X)]);
    expect(post).toEqual([MIXED_POWERED_TICK, MIXED_POWERED_TICK]);
    expect(decision[1]).toBe(decision[0] + 1);
    expect(decision[0]).toBe(MIXED_POWERED_TICK);
  });

  // No Lexy case was measured for a latch upstream of a gate (unverified): the deferral stays as the wave 11 calibration set it.
  it('keeps the deferral of a sink fed through a latch and a gate (unverified against Lexy)', () => {
    const [powered, cloned] = fireTicks(
      [plateTile, at(PLATE_X + 1, LATCH), at(GATE_X, OR_GATE), cloner],
      [link(PLATE_X, PLATE_X + 1), link(PLATE_X + 1, GATE_X), link(GATE_X, SINK_X)]
    );
    expect(cloned).toBe(powered + 1);
  });
});

describe('a source vacated in the pass reaches the wires first (GPDF)', () => {
  // Lexy: a departure is a frame-2 action, so the wire phase of that frame already sees it: a direct wire falls in the tick end of the
  // departure (lane depart0, end of tic t4), a wire through one gate one tick end later (lane depart1, t5: the gate steps in the
  // frame-2 phase only); both sinks are off at the decisions of the next tick (frame-2 decisions of t5, both lanes).
  /** [the first tick whose end shows the sink fallen, the first tick whose decisions see it fallen]. */
  function fallTicks(gated: boolean): [number, number] {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(FAR_START_X, DOOR), ...(gated ? [at(GATE_X, OR_GATE)] : [])];
    const links = gated ? [link(PLATE_X, GATE_X), link(GATE_X, FAR_START_X)] : [link(PLATE_X, FAR_START_X)];
    const engine = load(build('cc2', tiles, links, { startX: PLATE_X }));
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(poweredAt(engine, FAR_START_X)).toBe(true);
    engine.attemptPlayerMove('E');
    let post = -1;
    let decision = -1;
    for (let i = 0; i < LANE_TICKS; i++) {
      const seen = readAtDecisionAndAfter(() => engine.tick(), () => poweredAt(engine, FAR_START_X));
      if (decision < 0 && seen.decision === false) decision = engine.getTick();
      if (post < 0 && !seen.after) post = engine.getTick();
    }
    return [post, decision];
  }

  it('drops a direct sink in the tick end of the departure and a gated one a tick end later, both at the decisions of tick 6', () => {
    const [direct, directAtDecision] = fallTicks(false);
    const [gated, gatedAtDecision] = fallTicks(true);
    expect([direct, gated]).toEqual(DEPARTURE_FALL_AFTER_TICK);
    expect([directAtDecision, gatedAtDecision]).toEqual([DEPARTURE_FALL_AT_DECISIONS, DEPARTURE_FALL_AT_DECISIONS]);
  });
});

describe('the settles that stand for wire phases (GPDP, GPT0)', () => {
  /**
   * A block reaches a plate in the pre-pass of frame `arrivalFrame` of the tick after `ticksBefore` ticks (the plate is off), wired through
   * one OR gate to a clone machine. The settle calls of the setup are dropped: only those of the tick under test are recorded.
   */
  function prePassLane(arrivalFrame: 0 | 1, ticksBefore = 0): GameEngine {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(GATE_X, OR_GATE), at(SINK_X, CLONE_MACHINE)];
    const engine = load(
      build('cc2', tiles, [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)], {
        startX: 11,
        entities: [{ type: BLOCK, x: SINK_X, y: ROOM_ROW, dir: 'E' }, { type: BLOCK, x: SECOND_PLATE_X, y: ROOM_ROW, dir: 'E' }]
      })
    );
    for (let i = 0; i < ticksBefore; i++) engine.tick();
    const pushed = engine.getEntities().find((e) => e.x === SECOND_PLATE_X && e.y === ROOM_ROW) as RuntimeEntity;
    pushed.x = PLATE_X;
    pushed.arrivalTicks = 1;
    pushed.cc2ArrivalWait = 1;
    pushed.cc2ArrivalFrame = arrivalFrame;
    settleCalls.length = 0;
    return engine;
  }
  /** Whether the tick-end (frame-2) settle of the tick that just ran carried a rising edge of the sink. */
  const risingInFrame2 = (): boolean => settleCalls.some((call) => call.gates === GATE_SETTLE_FRAME2 && call.edges.some((edge) => edge.rising && edge.cell === cell(SINK_X)));

  // Lexy game.js:872-889: a frame-0 arrival reaches the f0 and the f1 wire phase before the decisions (two gate steps), a frame-1
  // arrival only the f1 one (one step): the gate sink rises in the pre-pass after the first (the tick end finds it risen already), in
  // the tick end after the second. The frame-0 phase is due from the second tick on (cc2WireFrameNext): the lane runs three ticks first.
  // Without the frame-0 phase the gate output rises in the frame-2 settle (measured by turning the phase off): this test fails then.
  it('a frame-0 arrival through one gate reaches the sink in the frame phases of the pre-pass, not in the tick end', () => {
    const engine = prePassLane(0, FRAME_PHASE_DUE_TICKS);
    expect(world(engine).cc2WireFrameNext).toBe(0);
    engine.tick();
    expect(poweredAt(engine, SINK_X)).toBe(true);
    expect(risingInFrame2()).toBe(false);
  });

  // The first tick has no frame phase due: the arrival reaches the wires in its own pre-pass settle (GPDP), as before wave 19.
  it('a frame-0 arrival of the first tick reaches the sink in its own pre-pass settle, before the decisions', () => {
    const engine = prePassLane(0);
    expect(world(engine).cc2WireFrameNext).toBeUndefined();
    engine.tick();
    expect(poweredAt(engine, SINK_X)).toBe(true);
    expect(risingInFrame2()).toBe(false);
  });

  // Lexy lane wor1: a frame-1 arrival through one gate reaches the sink in the frame-2 phase of its tic (one gate step), so the end of the
  // tick shows it, and the decisions of the next tick do too; the decisions of its own tick do not (a frame-1 arrival has one phase
  // before them, f1, for the plate, and the gate output only comes with the next).
  it('a frame-1 arrival through one gate reaches the sink in the tick end, and the decisions of the next tick', () => {
    const engine = prePassLane(1);
    const seen: { decision: boolean | undefined; after: boolean }[] = [];
    for (let i = 0; i < FRAME_ONE_ARRIVAL_TICKS; i++) seen.push(readAtDecisionAndAfter(() => engine.tick(), () => poweredAt(engine, SINK_X)));
    expect(seen[0].after).toBe(true);
    expect(risingInFrame2()).toBe(true);
    expect(seen.map((s) => s.decision)).toEqual([false, true]);
  });

  // Lexy lane (a purple wall fed by a pink plate held by a block at load through k diode gates, the player one step west into it at
  // tic 0; dump.mjs on the .c2m): the player stands in the wall cell after tic 0 with k = 0 and k = 1, and has been refused with k = 2
  // (a refused step is not retried). The two wire phases before the first decision (game.js:872-882) give one gate step.
  function doorPassed(mode: RoomMode, tiles: [string, string][], links: SignalLink[], plates: readonly number[]): boolean {
    const engine = load(
      build(mode, tiles, links, {
        startX: FAR_START_X,
        entities: plates.map((x) => ({ type: BLOCK, x, y: ROOM_ROW, dir: 'E' }))
      })
    );
    engine.attemptPlayerMove('E');
    engine.tick();
    return engine.getPlayer().x === SINK_X;
  }
  const andDoor = (mode: RoomMode): boolean =>
    doorPassed(
      mode,
      [at(PLATE_X, PLATE), at(SECOND_PLATE_X, PLATE), at(GATE_X, AND_GATE), at(SINK_X, DOOR)],
      [link(PLATE_X, GATE_X, 'in0'), link(SECOND_PLATE_X, GATE_X, 'in1'), link(GATE_X, SINK_X)],
      [PLATE_X, SECOND_PLATE_X]
    );
  const chainDoor = (mode: RoomMode, gates: number): boolean => {
    const gateXs = Array.from({ length: gates }, (_, i) => GATE_X + i);
    const xs = [PLATE_X, ...gateXs, SINK_X];
    return doorPassed(
      mode,
      [at(PLATE_X, PLATE), ...gateXs.map((x): [string, string] => at(x, OR_GATE)), at(SINK_X, DOOR)],
      xs.slice(1).map((x, i) => link(xs[i], x)),
      [PLATE_X]
    );
  };

  it('opens the door of an AND of two block-held plates at the first decision', () => {
    expect(andDoor('cc2')).toBe(true);
    expect(andDoor('native')).toBe(true);
  });

  it('opens the door behind one gate at the first decision and keeps it shut behind two chained gates', () => {
    expect(chainDoor('cc2', 0)).toBe(true);
    expect(chainDoor('cc2', 1)).toBe(true);
    expect(chainDoor('cc2', 2)).toBe(false);
  });

  it('leaves a native chain of two gates open at the first decision', () => {
    expect(chainDoor('native', 2)).toBe(true);
  });

  // Lexy lane (a pink plate, held or not by a block at load, a NOT gate, a clone machine): with the plate empty the NOT emits at once and
  // the clone appears at tic 0. With the plate held the NOT also emits in the first wire phase (it reads every wire off), then falls:
  // Lexy clones once at tic 0 there too (lanes w18_notheld / w18_notempty: one clone, appears t0, lands t3 in both). Tic 0 runs two gate
  // steps, the first from all-off wires, so Epoxy clones once as well and the clone lands with the empty-plate one.
  /** The Lexy lane notheld / notempty: a plate wired to a NOT wired to a clone machine, a block on the plate when `held`. */
  function notLane(held: boolean): GameEngine {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(GATE_X, NOT_GATE), at(SINK_X, CLONE_MACHINE)];
    const entities: EntityPlacement[] = [{ type: BLOCK, x: SINK_X, y: ROOM_ROW, dir: 'E' }, ...(held ? [{ type: BLOCK, x: PLATE_X, y: ROOM_ROW, dir: 'E' as const }] : [])];
    return load(build('cc2', tiles, [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)], { startX: FAR_START_X, entities }));
  }

  function notCloneBlocks(held: boolean): number {
    const engine = notLane(held);
    engine.tick();
    return engine.getEntities().filter((e) => e.type === BLOCK && e.x === CLONE_X).length;
  }

  it('fires the clone machine of a NOT whose plate is empty at tic 0', () => {
    expect(notCloneBlocks(false)).toBe(1);
  });

  /** The tick the clone of the lane lands (its arrival fields all gone); -1 when none does. */
  function notCloneLanding(held: boolean): number {
    const engine = notLane(held);
    for (let i = 0; i < LANE_TICKS; i++) {
      engine.tick();
      const clone = engine.getEntities().find((e) => e.type === BLOCK && e.x === CLONE_X);
      if (clone !== undefined && clone.arrivalTicks === undefined && clone.cc2ArrivalWait === undefined && clone.cc2ArrivalFrame === undefined) return engine.getTick();
    }
    return -1;
  }

  it('a NOT whose plate is held at load fires its clone machine once at tic 0, landing with the empty-plate clone (Lexy notheld)', () => {
    expect(notCloneBlocks(true)).toBe(1);
    expect(notCloneLanding(true)).toBe(NOT_LANE_LANDING_TICK);
    expect(notCloneLanding(true)).toBe(notCloneLanding(false));
  });
});

describe('the hidden state key and the capture of a gate-delay network (HK)', () => {
  // A gate-delay network with no delayed gate and no latch has no gate state: its key is the one it had before the gate delay.
  it('keeps no gate part on a CC2 network of plates and doors only', () => {
    const engine = load(build('cc2', [at(PLATE_X, PLATE), at(SINK_X, DOOR)], [link(PLATE_X, SINK_X)]));
    engine.attemptPlayerMove('E');
    for (let i = 0; i < LANE_TICKS; i++) engine.tick();
    expect(cc2HiddenStateKey(world(engine))).not.toMatch(/g[01]*\//);
  });

  function doorLane(mode: RoomMode): GameEngine {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(GATE_X, OR_GATE), at(SINK_X, DOOR)];
    return load(build(mode, tiles, [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)]));
  }
  const fingerprint = (engine: GameEngine): string => `${stableStringify(engine.captureState())}|${cc2HiddenStateKey(world(engine))}`;

  it('differs with a delayed gate on and off', () => {
    const engine = doorLane('cc2');
    const off = cc2HiddenStateKey(world(engine));
    engine.attemptPlayerMove('E');
    for (let i = 0; i < LANE_TICKS; i++) engine.tick();
    const on = cc2HiddenStateKey(world(engine));
    expect(on).not.toBe(off);
    expect(on).toContain('g');
  });

  it('has no gate part on a level that is not on a gate-delay network', () => {
    const engine = doorLane('native');
    engine.attemptPlayerMove('E');
    for (let i = 0; i < LANE_TICKS; i++) engine.tick();
    expect(cc2HiddenStateKey(world(engine))).toBe('');
  });

  it('a capture and restore across a tick where a delayed gate changes replays the same state', () => {
    const engine = doorLane('cc2');
    engine.attemptPlayerMove('E');
    for (let i = 0; i < LANE_TICKS; i++) {
      const snapshot = engine.captureState();
      engine.tick();
      const straight = fingerprint(engine);
      engine.restoreState(snapshot);
      engine.tick();
      expect(fingerprint(engine), `tick ${i}`).toBe(straight);
    }
  });

  // The frame wire phase still due crosses the tick boundary (cc2WireFrameNext, hidden key part W): a player carried into water dies in the
  // pre-pass of a tick before the frame-0 phase ran, so the phase is still due when the tick ends. An undo to the state before that tick
  // must give the same key and the same death with the same phase still due.
  it('restores the frame wire phase still due across a death in the pre-pass, and replays the same death', () => {
    const forces = DEATH_FORCE_XS.map((x): [string, string] => at(x, 'force_e'));
    const tiles: [string, string][] = [...forces, at(DEATH_WATER_X, 'water'), at(DEATH_PLATE_X, PLATE), at(DEATH_DOOR_X, DOOR)];
    const engine = load(build('cc2', tiles, [link(DEATH_PLATE_X, DEATH_DOOR_X)]));
    let snapshot = engine.captureState();
    let key = cc2HiddenStateKey(world(engine));
    let deathTick = -1;
    for (let i = 0; i < DEATH_LANE_TICKS && engine.getPlayer().alive; i++) {
      snapshot = engine.captureState();
      key = cc2HiddenStateKey(world(engine));
      engine.tick();
      if (!engine.getPlayer().alive) deathTick = engine.getTick();
    }
    expect(deathTick).toBeGreaterThan(0);
    const dueAfterDeath = world(engine).cc2WireFrameNext;
    expect(dueAfterDeath).toBeDefined();
    // The phase still due is part of the hidden state key (part W), so two states that differ in it never share a key.
    expect(cc2HiddenStateKey(world(engine))).toContain(`W${dueAfterDeath}`);
    engine.restoreState(snapshot);
    expect(cc2HiddenStateKey(world(engine))).toBe(key);
    expect(engine.getPlayer().alive).toBe(true);
    engine.tick();
    expect(engine.getPlayer().alive).toBe(false);
    expect(world(engine).cc2WireFrameNext).toBe(dueAfterDeath);
  });
});
