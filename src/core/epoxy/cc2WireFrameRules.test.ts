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
 * CC2 wave 19, rules of the one-wire-phase-per-frame model that the lane tests do not reach directly: a settle that is no frame phase
 * holds everything while a frame phase is due (F10), the gate delay is on exactly where the frame model is (F13), and a parked-player
 * level whose coming tick times out leaves the frame phases due (F14, game.js:1507-1510). Each rule has a test that fails without it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const settleCalls = vi.hoisted(() => [] as { gates: unknown; edges: { cell: number; rising: boolean }[] }[]);

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));
vi.mock('./epoxySignals', async (importOriginal) => {
  const real = await importOriginal<typeof import('./epoxySignals')>();
  return {
    ...real,
    // Records every settle the engine and the test make (its gate phase and the edges it returned) and delegates to the real one.
    settleWorldSignals: (...args: Parameters<typeof real.settleWorldSignals>) => {
      const edges = real.settleWorldSignals(...args);
      settleCalls.push({ gates: args[3] ?? real.GATE_SETTLE_HOLD, edges: edges.map((edge) => ({ ...edge })) });
      return edges;
    }
  };
});

import { ROOM_ROW, ROOM_SIZE, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { EntityPlacement, SignalLink } from '../types';
import { frameModelOn } from './epoxyFrames';
import { GATE_SETTLE_FRAME2, GATE_SETTLE_HOLD, SIGNAL_PHASE_TICK, settleWorldSignals } from './epoxySignals';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
  settleCalls.length = 0;
});

const OR_GATE = 'signal_gate_or_cc2';
const PLATE = 'signal_plate';
const PULSE_BUTTON = 'signal_button';
const GREEN_WALL = 'toggle_wall_closed';
const PURPLE_WALL = 'purple_wall';
const BLOCK = 'dirt_block';
const SEED = 3;
const SOURCE_X = 3;
const GATE_X = 4;
const SINK_X = 8;
const WAITING_BLOCK_X = 6;
const LANE_TICKS = 16;
/** The ticks per second of the game clock (game.json timing.ticksPerSecond), for a time limit that ends at a chosen tick. */
const TICKS_PER_SECOND = 20;
const TIME_LIMIT_SECONDS = 2;
/** The last tick that runs: the coming one is the first to time out (elapsed seconds reach the limit). */
const LAST_TICK_BEFORE_TIMEOUT = TIME_LIMIT_SECONDS * TICKS_PER_SECOND - 1;
const FRAME_PHASE_DUE_FIRST = 0;

const cell = (x: number): number => ROOM_ROW * ROOM_SIZE + x;
const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const link = (fromX: number, toX: number): SignalLink => ({ fromX, fromY: ROOM_ROW, toX, toY: ROOM_ROW });
const at = (x: number, id: string): [string, string] => [`${x},${ROOM_ROW}`, id];
const sinkTile = (engine: GameEngine): string => engine.getTerrain()[ROOM_ROW][SINK_X];

interface LaneOptions {
  mode?: RoomMode;
  source: string;
  sink: string;
  timeLimitSeconds?: number;
  parked?: boolean;
  entities?: EntityPlacement[];
}

/** A source at SOURCE_X wired through one OR gate to a sink at SINK_X. */
function lane(options: LaneOptions): GameEngine {
  const level = room({
    mode: options.mode ?? 'cc2',
    terrain: Object.fromEntries([at(SOURCE_X, options.source), at(GATE_X, OR_GATE), at(SINK_X, options.sink)]),
    entities: options.entities ?? []
  });
  level.signalLinks = [link(SOURCE_X, GATE_X), link(GATE_X, SINK_X)];
  level.timeLimitSeconds = options.timeLimitSeconds ?? 0;
  if (options.parked === true) level.extraPlayers = [{ x: 1, y: ROOM_ROW + 1, dir: 'E', character: 'chip' }];
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return engine;
}

describe('a settle that is no frame phase holds everything while a frame phase is due (F10)', () => {
  /** Runs one tick, so that the frame-0 phase of the next one is due, then returns the engine. */
  function dueLane(source: string): GameEngine {
    const engine = lane({ source, sink: GREEN_WALL, entities: [{ type: BLOCK, x: WAITING_BLOCK_X, y: ROOM_ROW, dir: 'E' }] });
    engine.tick();
    expect(world(engine).cc2WireFrameNext).toBe(FRAME_PHASE_DUE_FIRST);
    settleCalls.length = 0;
    return engine;
  }

  function holdSettle(engine: GameEngine): ReturnType<typeof settleWorldSignals> {
    const edges = settleWorldSignals(world(engine), false, SIGNAL_PHASE_TICK, GATE_SETTLE_HOLD);
    settleCalls.length = 0;
    return edges;
  }

  /** The tick count after which the sink first shows flipped, counted from here, and the settle phases that carried its rising edge. */
  function riseAfterTicks(engine: GameEngine): { ticks: number; gates: unknown[] } {
    for (let i = 1; i <= LANE_TICKS; i++) {
      engine.tick();
      if (sinkTile(engine) !== GREEN_WALL) {
        const gates = settleCalls.filter((call) => call.edges.some((edge) => edge.rising && edge.cell === cell(SINK_X))).map((call) => call.gates);
        return { ticks: i, gates };
      }
    }
    return { ticks: -1, gates: [] };
  }

  // A block put on the plate by hand between two ticks, as the end of a step would: a hold settle (a move settle, settleBeforeActorPass)
  // lets no source in while the frame-0 phase is due, so it returns no edge and the plate keeps its last level. The next tick carries the
  // plate in through its own frame phase, and the sink rises in a frame phase, never in a hold settle.
  it('a plate put under a block between ticks stays unread by a hold settle and enters through the frame phases', () => {
    const engine = dueLane(PLATE);
    const w = world(engine);
    const runtime = w.signals;
    if (runtime === undefined) throw new Error('the lane has no signal network');
    const plateIndex = runtime.network.indexOfCell.get(cell(SOURCE_X)) as number;
    const block = engine.getEntities().find((e) => e.kind === 'block') as { x: number };
    block.x = SOURCE_X;
    expect(holdSettle(engine)).toEqual([]);
    expect(runtime.state.lastOutputs[plateIndex]).toBe(false);
    expect(sinkTile(engine)).toBe(GREEN_WALL);
    const rise = riseAfterTicks(engine);
    expect(rise.ticks).toBeGreaterThan(0);
    expect(rise.gates.length).toBeGreaterThan(0);
    expect(rise.gates).toEqual(rise.gates.map(() => GATE_SETTLE_FRAME2));
    expect(rise.gates).not.toContain(GATE_SETTLE_HOLD);
  });

  // A pulse press waiting in the runtime is consumed by sampling: a hold settle must leave it for the frame phase.
  it('a pending pulse press is left intact by a hold settle and fires in the next tick', () => {
    const engine = dueLane(PULSE_BUTTON);
    const runtime = world(engine).signals;
    if (runtime === undefined) throw new Error('the lane has no signal network');
    runtime.pending.add(cell(SOURCE_X));
    expect(holdSettle(engine)).toEqual([]);
    expect(runtime.pending.has(cell(SOURCE_X))).toBe(true);
    expect(sinkTile(engine)).toBe(GREEN_WALL);
    const rise = riseAfterTicks(engine);
    expect(rise.ticks).toBeGreaterThan(0);
    expect(rise.gates).not.toContain(GATE_SETTLE_HOLD);
  });
});

describe('the gate delay is on exactly where the frame model is (F13)', () => {
  const MODES: readonly RoomMode[] = ['cc2', 'cc', 'native'];
  it.each(MODES)('a %s room has a delayed network if and only if the frame model is on', (mode) => {
    const engine = lane({ mode, source: PLATE, sink: PURPLE_WALL });
    const w = world(engine);
    expect(w.signals?.network.gateDelay === true).toBe(frameModelOn(w));
  });

  it('is on for the CC2 room and off for the CC1 and native rooms', () => {
    const delayed = MODES.map((mode) => world(lane({ mode, source: PLATE, sink: PURPLE_WALL })).signals?.network.gateDelay === true);
    expect(delayed).toEqual([true, false, false]);
  });
});

describe('a parked-player level whose coming tick times out leaves the frame phases due (F14)', () => {
  /** The plate sits under a block put there by hand in the last tick that runs, so that tick's end settle reads it. */
  function runToTimeout(timeLimitSeconds: number): GameEngine {
    const engine = lane({
      source: PLATE,
      sink: PURPLE_WALL,
      timeLimitSeconds,
      parked: true,
      entities: [{ type: BLOCK, x: WAITING_BLOCK_X, y: ROOM_ROW, dir: 'E' }]
    });
    expect(world(engine).cc2ActorOrder).not.toBe(true);
    while (engine.getTick() < LAST_TICK_BEFORE_TIMEOUT - 1) engine.tick();
    (engine.getEntities().find((e) => e.kind === 'block') as { x: number }).x = SOURCE_X;
    engine.tick();
    return engine;
  }

  const plateLevel = (engine: GameEngine): boolean => {
    const runtime = world(engine).signals;
    if (runtime === undefined) throw new Error('the lane has no signal network');
    return runtime.state.lastOutputs[runtime.network.indexOfCell.get(cell(SOURCE_X)) as number] === true;
  };

  it('keeps the frame-0 phase due and runs none of them at the tick end', () => {
    const engine = runToTimeout(TIME_LIMIT_SECONDS);
    expect(engine.getTick()).toBe(LAST_TICK_BEFORE_TIMEOUT);
    expect(world(engine).cc2WireFrameNext).toBe(FRAME_PHASE_DUE_FIRST);
    expect(plateLevel(engine)).toBe(false);
    expect(sinkTile(engine)).toBe(PURPLE_WALL);
  });

  // The control: with no time limit the same tick end runs both phases (nothing is due afterwards) and the plate has entered the wires.
  it('runs the frame phases at the tick end when the level has no time limit', () => {
    const engine = runToTimeout(0);
    expect(world(engine).cc2WireFrameNext).toBeUndefined();
    expect(plateLevel(engine)).toBe(true);
  });
});
