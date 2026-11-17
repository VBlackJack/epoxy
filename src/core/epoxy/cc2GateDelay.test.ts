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
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const settleCalls = vi.hoisted(() => [] as { gates: unknown; edges: { cell: number; rising: boolean }[] }[]);

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
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

import { ROOM_ROW, ROOM_SIZE, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { stableStringify } from '../engineSimHash';
import type { CompiledLevel, EntityPlacement, RuntimeEntity, SignalLink } from '../types';
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
/** The counter wraps at ten: five ticks keep the counts below it. */
const COUNTER_TICKS = 5;
const SETTLE_TICKS = 4;
/** A chain of this many gates or fewer reaches the sink one tick end after a direct wire; one more gate is a tick end later again. */
const GATES_IN_ONE_TICK_END = 3;
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

/** Plate at x=3, `gates` OR gates in a chain, a hold door at the end; the player steps onto the plate. The tick the door is powered. */
function chainPoweredTick(mode: RoomMode, gates: number): number {
  const gateXs = Array.from({ length: gates }, (_, i) => GATE_X + i);
  const tiles: [string, string][] = [at(PLATE_X, PLATE), ...gateXs.map((x): [string, string] => at(x, OR_GATE)), at(CHAIN_SINK_X, DOOR)];
  const xs = [PLATE_X, ...gateXs, CHAIN_SINK_X];
  const links = xs.slice(1).map((x, i) => link(xs[i], x));
  const engine = load(build(mode, tiles, links));
  engine.attemptPlayerMove('E');
  for (let i = 0; i < LANE_TICKS; i++) {
    engine.tick();
    if (poweredAt(engine, CHAIN_SINK_X)) return engine.getTick();
  }
  return -1;
}

describe('a logic gate adds one wire phase (GPD, GPD3)', () => {
  // Lexy game.js:872-889 runs a wire phase at the end of each of the three frames of a tic, and a gate emits from the powered edges of the last phase:
  // a source that changed reaches a sink through k gates in the k-th phase after it. One to three gates land in the same tick end,
  // the fourth gate waits for the next one.
  it('puts a chain of 1 to 3 gates in the tick end after a direct wire, and 4 gates one tick end later', () => {
    const direct = chainPoweredTick('cc2', 0);
    expect(direct).toBeGreaterThan(0);
    for (let gates = 1; gates <= GATES_IN_ONE_TICK_END; gates++) expect(chainPoweredTick('cc2', gates), `${gates} gates`).toBe(direct + 1);
    expect(chainPoweredTick('cc2', GATES_IN_ONE_TICK_END + 1)).toBe(direct + 2);
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
  // decision (TIC0_SUB_SETTLES). With two tic-0 gate steps the clock is in the other phase and the pattern is inverted.
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
  /** [the tick the sink is powered, the tick its clone is on the floor]. */
  function fireTicks(tiles: [string, string][], links: SignalLink[]): [number, number] {
    const engine = load(build('cc2', tiles, links, { entities: [{ type: BLOCK, x: SINK_X, y: ROOM_ROW, dir: 'E' }] }));
    engine.attemptPlayerMove('E');
    let powered = -1;
    let cloned = -1;
    for (let i = 0; i < LANE_TICKS; i++) {
      engine.tick();
      if (powered < 0 && poweredAt(engine, SINK_X)) powered = engine.getTick();
      if (cloned < 0 && engine.getEntities().some((e) => e.type === BLOCK && e.x === CLONE_X && e.y === ROOM_ROW)) cloned = engine.getTick();
    }
    return [powered, cloned];
  }
  const plateTile = at(PLATE_X, PLATE);
  const cloner = at(SINK_X, CLONE_MACHINE);

  it('fires the clone of a gate-fed sink in the settle where its edge rises', () => {
    const [powered, cloned] = fireTicks([plateTile, at(GATE_X, OR_GATE), cloner], [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)]);
    expect(powered).toBeGreaterThan(0);
    expect(cloned).toBe(powered);
  });

  it('keeps the deferral of a sink that also has a source wired straight in (mixed upstream)', () => {
    const [powered, cloned] = fireTicks([plateTile, at(GATE_X, OR_GATE), cloner], [link(PLATE_X, GATE_X), link(GATE_X, SINK_X), link(PLATE_X, SINK_X)]);
    expect(cloned).toBe(powered + 1);
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
  // Lexy: a departure is a frame-2 action, so the wire phase of that frame already sees it: through one gate the sink falls in the
  // tick end of the departure, as a direct wire does.
  function fallTick(gated: boolean): number {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(FAR_START_X, DOOR), ...(gated ? [at(GATE_X, OR_GATE)] : [])];
    const links = gated ? [link(PLATE_X, GATE_X), link(GATE_X, FAR_START_X)] : [link(PLATE_X, FAR_START_X)];
    const engine = load(build('cc2', tiles, links, { startX: PLATE_X }));
    for (let i = 0; i < SETTLE_TICKS; i++) engine.tick();
    expect(poweredAt(engine, FAR_START_X)).toBe(true);
    engine.attemptPlayerMove('E');
    for (let i = 0; i < LANE_TICKS; i++) {
      engine.tick();
      if (!poweredAt(engine, FAR_START_X)) return engine.getTick();
    }
    return -1;
  }

  it('drops a gated sink in the tick end of the departure, with the direct one', () => {
    const direct = fallTick(false);
    expect(direct).toBeGreaterThan(0);
    expect(fallTick(true)).toBe(direct);
  });
});

describe('the settles that stand for wire phases (GPDP, GPT0)', () => {
  /** A block reaches a plate in the pre-pass of frame `arrivalFrame` (the plate is off at load), wired through one OR gate to a clone machine. */
  function prePassLane(arrivalFrame: 0 | 1): GameEngine {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(GATE_X, OR_GATE), at(SINK_X, CLONE_MACHINE)];
    const engine = load(
      build('cc2', tiles, [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)], {
        startX: 11,
        entities: [{ type: BLOCK, x: SINK_X, y: ROOM_ROW, dir: 'E' }, { type: BLOCK, x: SECOND_PLATE_X, y: ROOM_ROW, dir: 'E' }]
      })
    );
    const pushed = engine.getEntities().find((e) => e.x === SECOND_PLATE_X && e.y === ROOM_ROW) as RuntimeEntity;
    pushed.x = PLATE_X;
    pushed.arrivalTicks = 1;
    pushed.cc2ArrivalWait = 1;
    pushed.cc2ArrivalFrame = arrivalFrame;
    return engine;
  }
  /** The tick-end settles of the tick that carried the sink's rising edge, and whether the sink is on once the tick is over. */
  const risingInTickEnd = (): boolean => settleCalls.some((call) => call.gates === 'tickEnd' && call.edges.some((edge) => edge.rising && edge.cell === cell(SINK_X)));

  // Lexy game.js:872-889: a frame-0 arrival reaches the f0 and the f1 wire phase before the decisions (two gate steps), a frame-1
  // arrival only the f1 one (one step): the gate sink rises in the pre-pass after the first (the tick end finds it risen already), in
  // the tick end after the second.
  it('a frame-0 arrival through one gate reaches the sink in the pre-pass, before the decisions', () => {
    const engine = prePassLane(0);
    engine.tick();
    expect(poweredAt(engine, SINK_X)).toBe(true);
    expect(risingInTickEnd()).toBe(false);
  });

  // A pin of the placement measured on the level replays, not a guard: no Lexy lane was built for it and it was not checked to fail
  // without the one-step rule of GPDP.
  it('a frame-1 arrival through one gate reaches the sink only in the tick end', () => {
    const engine = prePassLane(1);
    engine.tick();
    expect(poweredAt(engine, SINK_X)).toBe(true);
    expect(risingInTickEnd()).toBe(true);
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
  // Lexy clones once at tic 0 there too. Epoxy does not: this pins the open divergence (a NOT whose source is on at load never rises).
  function notCloneBlocks(held: boolean): number {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(GATE_X, NOT_GATE), at(SINK_X, CLONE_MACHINE)];
    const entities: EntityPlacement[] = [{ type: BLOCK, x: SINK_X, y: ROOM_ROW, dir: 'E' }, ...(held ? [{ type: BLOCK, x: PLATE_X, y: ROOM_ROW, dir: 'E' as const }] : [])];
    const engine = load(build('cc2', tiles, [link(PLATE_X, GATE_X), link(GATE_X, SINK_X)], { startX: FAR_START_X, entities }));
    engine.tick();
    return engine.getEntities().filter((e) => e.type === BLOCK && e.x === CLONE_X).length;
  }

  it('fires the clone machine of a NOT whose plate is empty at tic 0', () => {
    expect(notCloneBlocks(false)).toBe(1);
  });

  it('pin: a NOT whose plate is held at load does not fire its clone machine (Lexy fires it once at tic 0)', () => {
    expect(notCloneBlocks(true)).toBe(0);
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
});
