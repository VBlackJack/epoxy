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
 * CC2 wave 18, batch Z: the frame-0 wire phase of tic 0 runs from all-off wires (Lexy recalculate_circuitry, game.js:602, 728), so a gate
 * whose source is on at load still reads that source off once, and a counter fed by a plate held at load counts one. The lanes are the
 * .c2m files w18_cntheld, w18_cntnot and w18_dlnot (Lexy dump.mjs); the NOT-held lane is in cc2GateDelay.test.ts (w18_notheld).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, ROOM_SIZE, room } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, EntityPlacement, SignalLink } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const NOT_GATE = 'signal_gate_not_cc2';
const COUNTER = 'signal_counter_0_cc2';
const DLATCH = 'signal_gate_dlatch_cc2';
const PLATE = 'signal_plate';
const CLONE_MACHINE = 'clone_machine';
const BLOCK = 'dirt_block';
const SEED = 3;
const PLATE_X = 3;
const GATE_X = 4;
const SINK_X = 9;
const CLONE_X = SINK_X + 1;
const FAR_START_X = SINK_X + 3;
/** Ticks the latch lane runs: the clone appears at tic 0 in Lexy and lands at the end of tic 3 (lane dlnot, tick = tic + 1). */
const LATCH_LANE_TICKS = 6;
/** The tick whose end shows the dlnot clone landed (Lexy lane dlnot: clone at tic 0, lands t3). */
const DLNOT_LANDING_TICK = 4;

const cell = (x: number): number => ROOM_ROW * ROOM_SIZE + x;
const link = (fromX: number, toX: number, port?: string): SignalLink => ({ fromX, fromY: ROOM_ROW, toX, toY: ROOM_ROW, ...(port === undefined ? {} : { port }) });
const at = (x: number, id: string): [string, string] => [`${x},${ROOM_ROW}`, id];
const held = (x: number): EntityPlacement => ({ type: BLOCK, x, y: ROOM_ROW, dir: 'E' });

function load(tiles: readonly [string, string][], links: SignalLink[], entities: EntityPlacement[]): GameEngine {
  const level: CompiledLevel = room({ mode: 'cc2', startX: FAR_START_X, terrain: Object.fromEntries(tiles), entities });
  level.signalLinks = links;
  const engine = new GameEngine();
  engine.loadLevel(level, SEED);
  return engine;
}

describe('Z: tic 0 starts from all-off wires (N0, N0L)', () => {
  // Lexy lanes cntheld / cntnot: the counter reads 1 after tic 0. Lexy counts it in f1, after the all-off f0 phase; so does Epoxy's delayed
  // counter (it reads the all-off copy in f0, then the plate in f1). Without the
  // all-off phase the held plate is already on in the one gate step, a level not an edge, and the counter stays at 0.
  it('counts one at tic 0 for a counter fed by a plate held at load (cntheld)', () => {
    const engine = load([at(PLATE_X, PLATE), at(SINK_X, COUNTER)], [link(PLATE_X, SINK_X, 'in0')], [held(PLATE_X)]);
    engine.tick();
    expect(engine.getCounterValues()?.get(cell(SINK_X))).toBe(1);
  });

  it('counts one at tic 0 for a counter behind a NOT that is on at load (cntnot)', () => {
    const engine = load([at(PLATE_X, PLATE), at(GATE_X, NOT_GATE), at(SINK_X, COUNTER)], [link(PLATE_X, GATE_X), link(GATE_X, SINK_X, 'in0')], []);
    engine.tick();
    expect(engine.getCounterValues()?.get(cell(SINK_X))).toBe(1);
  });

  // Lexy lane dlnot (a data latch whose data and clock plates are held at load, then a NOT, then the clone machine): the latch output reads
  // off in the frame-0 phase, so the NOT emits and Lexy clones once at tic 0. Epoxy's load prime has already set the latch bit, so without
  // zeroing the latch output (N0L) the NOT never rises. The data latch is delayed like a gate, so the sink is gate-timed and the clone lands
  // in tick 4 (Lexy tic 3, lane dlnot); the latch-class end-of-next-tick deferral landed it one tick late.
  it('clones once at tic 0 through a NOT behind a data latch held on at load (dlnot)', () => {
    const tiles: [string, string][] = [at(PLATE_X, PLATE), at(PLATE_X + 1, PLATE), at(GATE_X + 1, DLATCH), at(GATE_X + 2, NOT_GATE), at(SINK_X, CLONE_MACHINE)];
    const links = [link(PLATE_X, GATE_X + 1, 'in0'), link(PLATE_X + 1, GATE_X + 1, 'in1'), link(GATE_X + 1, GATE_X + 2), link(GATE_X + 2, SINK_X)];
    const engine = load(tiles, links, [{ type: BLOCK, x: SINK_X, y: ROOM_ROW, dir: 'E' }, held(PLATE_X), held(PLATE_X + 1)]);
    const landed = (): boolean => engine.getEntities().some((e) => e.kind === 'block' && e.x === CLONE_X && !e.isSliding);
    let landingTick = -1;
    for (let i = 0; i < LATCH_LANE_TICKS; i++) {
      engine.tick();
      if (landingTick < 0 && landed()) landingTick = engine.getTick();
    }
    expect(engine.getEntities().filter((e) => e.kind === 'block' && e.x === CLONE_X).length).toBe(1);
    expect(landingTick).toBe(DLNOT_LANDING_TICK);
  });
});
