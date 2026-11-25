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
 * CC2 wave 37: a monster's press of a brown button is ranked by its Lexy frame against the frame the lead's step onto the trap ends in.
 * Lexy ejects only on the first press (tiletypes.js 1768-1779) through attempt_out_of_turn_step, which refuses a moving actor
 * (game.js 2155): a press before his arrival frame is lost, one after it ejects, one in the same frame goes by list order.
 *   - PFPM (a-d, g2, l3b): a monster pushed off the walking cycle by force floors (sp, mp, parked in the trap, Melinda) or by the wave 36
 *     lane (a tank released from the last force floor) presses in an early frame of his arrival pass, and he stays in the trap.
 *   - PFPMT (h, i): a teleport exit step carries the frame of the step onto the pad.
 *   - PFPMC (j, k, l, l2, l3): a monster clone's release step ends in (press frame + 11 - later) % 3, and the releaser's ordinal
 *     stands in for the pressing player's when a monster fires the cloner.
 *   - PFPL (n-s): a lead carried onto the trap arrives in frame 0: a frame-1 press then finds him at rest and ejects him, a frame-0 press
 *     goes by list order (monsters and, through the block hook, blocks).
 * Regression guards: p (same frame, the monster listed before a carried lead: refused without PFPL, ejected with PFPM alone, which is the
 * round 1 regression), s (a carried lead on a level without actor order keeps list order: the unknown branch), g3 (two pressers, the
 * refused one and the same-frame one: non-discriminating, the rank rule refuses either way) and the rows e, f, g, m, r (one tic early or
 * late, a presser listed after: the values do not move with a rule removed).
 * Row t is the key and snapshot leg: the press, pad and arrival marks sit in cc2HiddenStateKey only while they can be read, and a
 * snapshot restored in the middle of a press plays on as the straight run. Row u is the gating: a level that is not a CC2-engine level
 * (native, and the CC3D pace) carries no mark.
 * Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w37_, w37lf_, w37lfb_, w37r2_ and w36_).
 *
 * tick() call k plays the Lexy tic k - 1, so "after N calls" is the end of Lexy tic N - 1; an input of Lexy tic t is given before the
 * tick() call t + 1. The values are the end-of-tic values of the Lexy lane named next to each case (actor oracle), read from the lane run,
 * not from the engine. The lanes start the shared turn at north (their replay header), so every load calls setReplayForceStart('N').
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CONVERTED_ID_SUFFIX } from '../cc3d/cc3dConstants';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, PlayerSnapshot } from '../types';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const START: Direction = 'N';
const PREFIX_FORCE = 'w37_';
const PREFIX_CARRIED = 'w37lf_';
const PREFIX_CARRIED_BLOCK = 'w37lfb_';
const PREFIX_ROUND2 = 'w37r2_';
const PREFIX_W36 = 'w36_';
const TANK = 'tank';
const GLIDER = 'glider';
const BALL = 'pink_ball';
const DIRT_BLOCK = 'dirt_block';
type Cell = [number, number];

/** The inputs given at each tick() call, and the Lexy tics a swap is given at (before the input of the same tic). */
interface Plan {
  readonly inputs: Readonly<Record<number, Direction>>;
  readonly swaps: readonly number[];
}

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

function setUp(engine: GameEngine, level: CompiledLevel): GameEngine {
  engine.loadLevel(level, SEED);
  engine.setReplayForceStart(START);
  return engine;
}

async function load(lane: string, prefix: string): Promise<GameEngine> {
  return setUp(new GameEngine(), await loadCc2Lane(lane, prefix));
}

/** A plan from `tic input` pairs (an input is given before the call tic + 1) and the swap tics. */
function plan(inputs: ReadonlyArray<readonly [number, Direction]>, swaps: readonly number[] = []): Plan {
  return { inputs: Object.fromEntries(inputs.map(([tic, input]) => [tic + 1, input])), swaps };
}

/** Plays the tick() calls `from` + 1 to `ticks`. */
function play(engine: GameEngine, inputs: Plan, ticks: number, from = 0): void {
  for (let call = from + 1; call <= ticks; call++) {
    if (inputs.swaps.includes(call - 1)) expect(engine.swapPlayer()).toBe(true);
    const input = inputs.inputs[call];
    if (input !== undefined) engine.attemptPlayerMoveHeld([input]);
    engine.tick();
  }
}

/** Plays on to each call of `calls` (in order) and reads `read` there. */
function sample<T>(engine: GameEngine, inputs: Plan, calls: readonly number[], read: (engine: GameEngine) => T): T[] {
  const out: T[] = [];
  let at = 0;
  for (const call of calls) {
    play(engine, inputs, call, at);
    at = call;
    out.push(read(engine));
  }
  return out;
}

const playerCell = (engine: GameEngine): Cell => [engine.getPlayer().x, engine.getPlayer().y];

/** The cells of the players who are not controlled, in swap order. */
const parkedCells = (engine: GameEngine): Cell[] => (engine.getParkedPlayers() ?? []).map((p) => [p.x, p.y]);

/** The cells of the entities of a type, in uid order. */
const cellsOfType = (type: string) => (engine: GameEngine): Cell[] =>
  engine
    .getEntities()
    .filter((e) => e.type === type)
    .sort((a, b) => a.uid - b.uid)
    .map((e) => [e.x, e.y]);

/** The controlled player's cell, the cells of the entities of a type and the parked players' cells. */
const seenWith = (type: string) => (engine: GameEngine): { player: Cell; others: Cell[]; parked: Cell[] } => ({
  player: playerCell(engine),
  others: cellsOfType(type)(engine),
  parked: parkedCells(engine)
});

/** The state a straight run and a restored one must share: the snapshot and the hidden key. */
const stateKey = (engine: GameEngine): string => `${JSON.stringify(engine.captureState())}|${engine.getRuntimeKeyExtra()}`;

const E: Direction = 'E';

/** The lead's cell at each of four calls when he stays in the trap. */
const STAYS: Cell[] = [[4, 5], [4, 5], [4, 5], [4, 5]];
/** The lead's cell when one tic early: the press at the second call, ejection at the third. */
const EJECTED_LATE: Cell[] = [[4, 5], [4, 5], [5, 5], [5, 5]];
/** The parked player's cell on the lanes with a second player. */
const MELINDA: Cell = [12, 12];

describe('CC2 wave 37 (a-d, g2, l3b): a press before the lead\'s arrival frame is lost (PFPM)', () => {
  it('keeps Chip in the trap, tank released from force floors listed before him (Lexy lane w37_ff3_sp_c_tank_b_o4)', async () => {
    const engine = await load('ff3_sp_c_tank_b_o4', PREFIX_FORCE);
    const seen = sample(engine, plan([[4, E]]), [8, 9, 10, 14], seenWith(TANK));
    // With PFPM removed Chip is ejected at call 9: (5,5) at calls 9, 10 and 14.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('keeps Chip in the trap with a second player on the level, glider (Lexy lane w37_ff2_mp_c_glider_b_o2)', async () => {
    const engine = await load('ff2_mp_c_glider_b_o2', PREFIX_FORCE);
    const seen = sample(engine, plan([[2, E]]), [6, 7, 8, 12], seenWith(GLIDER));
    // With PFPM removed Chip is ejected at call 7: (5,5) at calls 7, 8 and 12.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    expect(seen.map((s) => s.others)).toEqual([[[10, 3]], [[10, 2]], [[10, 2]], [[10, 1]]]);
    for (const s of seen) expect(s.parked).toEqual([MELINDA]);
  });

  it('swaps away to Melinda and leaves Chip parked in the trap (Lexy lane w37_ff4_mppk_c_tank_b_o6)', async () => {
    const engine = await load('ff4_mppk_c_tank_b_o6', PREFIX_FORCE);
    const seen = sample(engine, plan([[6, E]], [10]), [10, 11, 12, 16], seenWith(TANK));
    // With PFPM removed Chip is still controlled at call 11, at (5,5), and Melinda stays at (12,12).
    expect(seen[0].player).toEqual([4, 5]);
    expect(seen[0].parked).toEqual([MELINDA]);
    for (const s of seen.slice(1)) {
      expect(s.player).toEqual(MELINDA);
      expect(s.parked).toEqual([[4, 5]]);
    }
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('keeps Melinda in the trap (Lexy lane w37_ff1_sp_m_tank_b_o0)', async () => {
    const engine = await load('ff1_sp_m_tank_b_o0', PREFIX_FORCE);
    const seen = sample(engine, plan([[0, E]]), [4, 5, 6, 10], seenWith(TANK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('keeps Chip in the trap, the tank released from the last force floor of the wave 36 lane (Lexy lane w36_mpre_sp_c_tank_b_o8)', async () => {
    const engine = await load('mpre_sp_c_tank_b_o8', PREFIX_W36);
    const seen = sample(engine, plan([[8, E]]), [12, 13, 14, 18], seenWith(TANK));
    // With PFPM removed Chip is ejected at call 13: (5,5) at calls 13, 14 and 18 (wave 36 left this lane open).
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('keeps Chip in the trap, a clone press before a frame-0 lead, template listed before (Lexy lane w37r2_lfc_k3_clm1_sp_b)', async () => {
    const engine = await load('lfc_k3_clm1_sp_b', PREFIX_ROUND2);
    const seen = sample(engine, plan([]), [8, 9, 10, 14], seenWith(TANK));
    // With PFPM removed Chip is ejected at call 9: (5,5) at calls 9, 10 and 14.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3], [8, 4], [9, 3]]);
  });

  it('guard: the tank listed after him keeps him in the trap as before (Lexy lane w37_ff3_sp_c_tank_a_o4)', async () => {
    const engine = await load('ff3_sp_c_tank_a_o4', PREFIX_FORCE);
    const seen = sample(engine, plan([[4, E]]), [8, 9, 10, 14], seenWith(TANK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 9]]);
  });

  it('guard: one tic early the lead is at rest and ejected as before (Lexy lane w37_ff3_sp_c_tank_b_o3)', async () => {
    const engine = await load('ff3_sp_c_tank_b_o3', PREFIX_FORCE);
    expect(sample(engine, plan([[3, E]]), [7, 8, 9, 13], playerCell)).toEqual(EJECTED_LATE);
  });

  it('guard: one tic late the press lands while the trap is open; he stays where he stopped (Lexy lane w37_ff3_sp_c_tank_b_o5)', async () => {
    const engine = await load('ff3_sp_c_tank_b_o5', PREFIX_FORCE);
    expect(sample(engine, plan([[5, E]]), [9, 10, 11, 15], playerCell)).toEqual(STAYS);
  });

  it('guard: a refused press and a same-frame press together keep him in the trap, non-discriminating (Lexy lane w37r2_mix_fb_sp_o4)', async () => {
    const engine = await load('mix_fb_sp_o4', PREFIX_ROUND2);
    const seen = sample(engine, plan([[4, E]]), [8, 9, 10, 14], seenWith(TANK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3], [10, 9]]);
  });
});

describe('CC2 wave 37 (h, i): a teleport exit step carries the frame of the step onto the pad (PFPMT)', () => {
  const TELEPORT_INPUTS = plan([[6, E]]);
  const TELEPORT_CALLS = [10, 11, 12, 16] as const;

  it('keeps Chip in the trap, tank (Lexy lane w37_ftp_sp_c_tank_b_o6)', async () => {
    const engine = await load('ftp_sp_c_tank_b_o6', PREFIX_FORCE);
    const seen = sample(engine, TELEPORT_INPUTS, TELEPORT_CALLS, seenWith(TANK));
    // With PFPMT removed Chip is ejected at call 11: (5,5) at calls 11, 12 and 16.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('keeps Melinda in the trap, glider (Lexy lane w37_ftp_sp_m_glider_b_o6)', async () => {
    const engine = await load('ftp_sp_m_glider_b_o6', PREFIX_FORCE);
    const seen = sample(engine, TELEPORT_INPUTS, TELEPORT_CALLS, seenWith(GLIDER));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    expect(seen.map((s) => s.others)).toEqual([[[10, 3]], [[10, 2]], [[10, 2]], [[10, 1]]]);
  });
});

describe('CC2 wave 37 (j-m): a monster clone presses at the end of its release step (PFPMC)', () => {
  const RED_INPUTS = plan([[0, E], [4, E]]);
  const RED_CALLS = [8, 9, 10, 14] as const;

  it('keeps Chip in the trap, clone of the lead\'s red press, template listed before (Lexy lane w37_cl1_sp_c_tank_b_o4)', async () => {
    const engine = await load('cl1_sp_c_tank_b_o4', PREFIX_FORCE);
    const seen = sample(engine, RED_INPUTS, RED_CALLS, seenWith(TANK));
    // With PFPMC removed Chip is ejected at call 9: (5,5) at calls 9, 10 and 14.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3], [9, 3]]);
  });

  it('keeps Chip in the trap, clone of a tank\'s red press, two players, balls (Lexy lane w37_clm_mp_c_ball_b_o8)', async () => {
    const engine = await load('clm_mp_c_ball_b_o8', PREFIX_FORCE);
    const seen = sample(engine, plan([[8, E]]), [12, 13, 14, 18], seenWith(BALL));
    // With PFPMC removed Chip is ejected at call 13: (5,5) at calls 13, 14 and 18.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3], [9, 3]]);
    for (const s of seen) expect(s.parked).toEqual([MELINDA]);
  });

  it('swaps away to Melinda and leaves Chip parked in the trap, the swap after the frame-2 press (Lexy lane w37r2_pk2_clm_c_tank_b_o8)', async () => {
    const engine = await load('pk2_clm_c_tank_b_o8', PREFIX_ROUND2);
    const seen = sample(engine, plan([[8, E]], [12]), [12, 13, 14, 18], seenWith(TANK));
    // With PFPMC removed Chip is still controlled at call 13, at (5,5), and Melinda stays at (12,12).
    expect(seen[0].player).toEqual([4, 5]);
    expect(seen[0].parked).toEqual([MELINDA]);
    for (const s of seen.slice(1)) {
      expect(s.player).toEqual(MELINDA);
      expect(s.parked).toEqual([[4, 5]]);
    }
  });

  it('swaps away to Melinda, clone of the lead\'s red press (Lexy lane w37r2_pk2_cl1_c_tank_b_o4)', async () => {
    const engine = await load('pk2_cl1_c_tank_b_o4', PREFIX_ROUND2);
    const seen = sample(engine, plan([[0, E], [4, E]], [8]), [...RED_CALLS], seenWith(TANK));
    expect(seen[0].player).toEqual([4, 5]);
    expect(seen[0].parked).toEqual([MELINDA]);
    for (const s of seen.slice(1)) {
      expect(s.player).toEqual(MELINDA);
      expect(s.parked).toEqual([[4, 5]]);
    }
    for (const s of seen) expect(s.others).toEqual([[10, 3], [9, 3]]);
  });

  it('keeps Chip in the trap, clone press in frame 2 before a frame-0 lead, template listed after (Lexy lane w37r2_lfc_k3_clm1_sp_a)', async () => {
    const engine = await load('lfc_k3_clm1_sp_a', PREFIX_ROUND2);
    const seen = sample(engine, plan([]), [...RED_CALLS], seenWith(TANK));
    // With PFPMC removed Chip is ejected at call 9: (5,5) at calls 9, 10 and 14.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 9], [8, 10], [9, 9]]);
  });

  it('guard: the clone listed after him keeps him in the trap as before (Lexy lane w37_cl1_sp_c_tank_a_o4)', async () => {
    const engine = await load('cl1_sp_c_tank_a_o4', PREFIX_FORCE);
    const seen = sample(engine, RED_INPUTS, [...RED_CALLS], seenWith(TANK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 9], [9, 9]]);
  });
});

describe('CC2 wave 37 (n-s): a lead carried onto the trap arrives in frame 0 (PFPL)', () => {
  /** The lead is ejected at the second of four calls and stays out. */
  const EJECTED_AT_SECOND: Cell[] = [[4, 5], [5, 5], [5, 5], [5, 5]];

  it('ejects Chip at once, a frame-1 press listed after him finds him at rest, wire-driven tank (Lexy lane w37lf_k2_wf1_sp_tank_a)', async () => {
    const engine = await load('k2_wf1_sp_tank_a', PREFIX_CARRIED);
    const seen = sample(engine, plan([]), [6, 7, 8, 12], seenWith(TANK));
    // With PFPL removed Chip stays in the trap: (4,5) at all four calls.
    expect(seen.map((s) => s.player)).toEqual(EJECTED_AT_SECOND);
    for (const s of seen) expect(s.others).toEqual([[10, 9]]);
  });

  it('ejects Chip at once, walker source (Lexy lane w37lf_k3_wk2_sp_tank_a)', async () => {
    const engine = await load('k3_wk2_sp_tank_a', PREFIX_CARRIED);
    const seen = sample(engine, plan([]), [8, 9, 10, 14], seenWith(TANK));
    expect(seen.map((s) => s.player)).toEqual(EJECTED_AT_SECOND);
    for (const s of seen) expect(s.others).toEqual([[10, 9]]);
  });

  it('regression guard: a same-frame press by a monster listed before him ejects him (Lexy lane w37lf_k1_ff1_sp_tank_b)', async () => {
    const engine = await load('k1_ff1_sp_tank_b', PREFIX_CARRIED);
    const seen = sample(engine, plan([]), [4, 5, 6, 10], seenWith(TANK));
    // With PFPL removed Chip stays at (4,5) at all four calls; with PFPM kept and PFPL removed the same-frame press is refused: the
    // round 1 regression.
    expect(seen.map((s) => s.player)).toEqual(EJECTED_AT_SECOND);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('ejects Chip at once, a frame-0 block press listed before him goes by list order (Lexy lane w37lfb_k2_ff2_sp_b)', async () => {
    const engine = await load('k2_ff2_sp_b', PREFIX_CARRIED_BLOCK);
    const seen = sample(engine, plan([]), [6, 7, 8, 12], seenWith(DIRT_BLOCK));
    // With PFPL removed the block hook refuses every frame-0 block press: (4,5) at all four calls.
    expect(seen.map((s) => s.player)).toEqual(EJECTED_AT_SECOND);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('guard: a frame-0 block press listed after him keeps him in the trap (Lexy lane w37lfb_k2_ff2_sp_a)', async () => {
    const engine = await load('k2_ff2_sp_a', PREFIX_CARRIED_BLOCK);
    const seen = sample(engine, plan([]), [6, 7, 8, 12], seenWith(DIRT_BLOCK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 9]]);
  });

  it('regression guard: a carried lead on a level without actor order keeps list order (Lexy lane w37lf_k1_ff1_mp_tank_b)', async () => {
    const engine = await load('k1_ff1_mp_tank_b', PREFIX_CARRIED);
    const seen = sample(engine, plan([]), [4, 5, 6, 10], seenWith(TANK));
    // With PFPL removed the carried lead is read as walking and the press refused: (4,5) at all four calls.
    expect(seen.map((s) => s.player)).toEqual(EJECTED_AT_SECOND);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
    for (const s of seen) expect(s.parked).toEqual([MELINDA]);
  });
});

describe('CC2 wave 37 (t): the marks are in the hidden key only while they can be read, and a snapshot keeps them', () => {
  const FORCE_INPUTS = plan([[4, E]]);
  const TELEPORT_INPUTS = plan([[6, E]]);
  /** The entries of the hidden key that start with `letter`: Z (a press frame, a pad frame) and L (a trap arrival frame). */
  const entries = (engine: GameEngine, letter: string): string[] => cc2HiddenStateKey(world(engine)).split(';').filter((part) => part.startsWith(letter));
  const tankMark = (engine: GameEngine) => engine.getEntities().find((e) => e.type === TANK)?.cc2PressFrame;

  it('holds the press and arrival entries from the arrival to the release check, and none after (Lexy lane w37_ff3_sp_c_tank_b_o4)', async () => {
    const engine = await load('ff3_sp_c_tank_b_o4', PREFIX_FORCE);
    const counts = sample(engine, FORCE_INPUTS, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], (e) => [entries(e, 'Z').length, entries(e, 'L').length]);
    expect(counts.slice(0, 4)).toEqual([[1, 1], [1, 1], [1, 1], [1, 1]]);
    expect(counts.slice(4).every(([press, arrival]) => press === 0 && arrival === 0)).toBe(true);
    // The fields stay on the objects: only the key forgets them.
    expect(tankMark(engine)).toBe(0);
    expect(world(engine).player.cc2TrapArrivalFrame).toBe(1);
  });

  it('holds the arrival entry of a carried lead until his ejection (Lexy lane w37lf_k2_wf1_sp_tank_a)', async () => {
    const engine = await load('k2_wf1_sp_tank_a', PREFIX_CARRIED);
    const seen = sample(engine, plan([]), [3, 4, 5, 6, 7, 8, 12], (e) => entries(e, 'L'));
    expect(seen).toEqual([['L0:0'], ['L0:0'], ['L0:0'], ['L0:0'], [], [], []]);
    expect(world(engine).player.cc2TrapArrivalFrame).toBeUndefined();
  });

  it('holds the pad entry while the tank stands on the pad, the jumped flag after the arrival jump (Lexy lane w37_ftp_sp_c_tank_b_o6)', async () => {
    const engine = await load('ftp_sp_c_tank_b_o6', PREFIX_FORCE);
    const seen = sample(engine, TELEPORT_INPUTS, [3, 4, 5, 6, 7, 10, 11, 14], (e) => [entries(e, 'Z'), entries(e, 'L')]);
    expect(seen.slice(0, 4).map(([z]) => z)).toEqual([['Z1:-p1'], ['Z1:-p1'], ['Z1:-p1j'], ['Z1:-p1j']]);
    expect(seen.slice(4, 6)).toEqual([[['Z1:0'], ['L0:1']], [['Z1:0'], ['L0:1']]]);
    expect(seen.slice(6)).toEqual([[[], []], [[], []]]);
    expect(world(engine).entities.find((e) => e.type === TANK)?.cc2PadFrame).toBeUndefined();
  });

  it.each([
    { lane: 'ff3_sp_c_tank_b_o4', prefix: PREFIX_FORCE, inputs: FORCE_INPUTS, snapAt: 6, last: 15, chip: [4, 5] },
    { lane: 'ff3_sp_c_tank_b_o4', prefix: PREFIX_FORCE, inputs: FORCE_INPUTS, snapAt: 9, last: 15, chip: [4, 5] },
    { lane: 'k2_wf1_sp_tank_a', prefix: PREFIX_CARRIED, inputs: plan([]), snapAt: 4, last: 12, chip: [5, 5] },
    { lane: 'k2_wf1_sp_tank_a', prefix: PREFIX_CARRIED, inputs: plan([]), snapAt: 7, last: 12, chip: [5, 5] },
    { lane: 'ftp_sp_c_tank_b_o6', prefix: PREFIX_FORCE, inputs: TELEPORT_INPUTS, snapAt: 4, last: 14, chip: [4, 5] }
  ])('restores a snapshot of lane $lane taken after call $snapAt to the straight run', async ({ lane, prefix, inputs, snapAt, last, chip }) => {
    const straight = await load(lane, prefix);
    play(straight, inputs, last);
    const engine = await load(lane, prefix);
    play(engine, inputs, snapAt);
    const keyAtSnapshot = stateKey(engine);
    const snap = engine.captureState();
    play(engine, inputs, last, snapAt);
    engine.restoreState(snap);
    // The restored state is the captured one, marks included, and plays on as the straight run did.
    expect(stateKey(engine)).toBe(keyAtSnapshot);
    play(engine, inputs, last, snapAt);
    expect(playerCell(engine)).toEqual(chip);
    expect(playerCell(straight)).toEqual(chip);
    expect(stateKey(engine)).toBe(stateKey(straight));
  });

  it('writes the arrival mark of the controlled player into the snapshot while he is marked (Lexy lane w37_ff3_sp_c_tank_b_o4)', async () => {
    const engine = await load('ff3_sp_c_tank_b_o4', PREFIX_FORCE);
    play(engine, FORCE_INPUTS, 6);
    const snap = engine.captureState() as unknown as { player: PlayerSnapshot };
    expect(snap.player.cc2TrapArrivalFrame).toBe(1);
  });
});

describe('CC2 wave 37 (u): a level that is not a CC2-engine level carries no mark', () => {
  const FORCE_INPUTS = plan([[4, E]]);
  const entries = (engine: GameEngine, letter: string): string[] => cc2HiddenStateKey(world(engine)).split(';').filter((part) => part.startsWith(letter));
  /** The ff3 lane without its CC2 source (the CC2 engine is off): CC1 rules, a native level, and a converted CC3D level (the CC3D pace). */
  const FLAVORS: ReadonlyArray<readonly [string, (level: CompiledLevel) => CompiledLevel, boolean, boolean]> = [
    ['CC1 rules (.DAT-like)', (level) => ({ ...level, cc2: undefined }), true, false],
    ['a native level', (level) => ({ ...level, cc2: undefined, rulesFlavor: undefined }), false, false],
    ['a converted CC3D level (CC3D pace)', (level) => ({ ...level, cc2: undefined, rulesFlavor: undefined, id: `lane${CONVERTED_ID_SUFFIX}` }), false, true]
  ];

  it('control: the CC2-engine level writes the marks at the same step (Lexy lane w37_ff3_sp_c_tank_b_o4)', async () => {
    const engine = await load('ff3_sp_c_tank_b_o4', PREFIX_FORCE);
    play(engine, FORCE_INPUTS, 6);
    expect(playerCell(engine)).toEqual([4, 5]);
    expect(JSON.stringify(engine.captureState())).toContain('"cc2TrapArrivalFrame":1');
    expect(entries(engine, 'Z').length).toBeGreaterThan(0);
    expect(entries(engine, 'L').length).toBeGreaterThan(0);
  });

  it.each(FLAVORS)('%s: the player steps onto the trap and no press, pad or arrival mark exists', async (_name, convert, ccRules, cc3dPace) => {
    const engine = setUp(new GameEngine(), convert(await loadCc2Lane('ff3_sp_c_tank_b_o4', PREFIX_FORCE)));
    // The flavor itself is proven before the marks are looked for.
    expect(world(engine).ccRules).toBe(ccRules);
    expect(world(engine).cc3dPace).toBe(cc3dPace);
    const seen = sample(engine, FORCE_INPUTS, [5, 6, 7, 8, 9, 12], (e) => {
      expect(JSON.stringify(e.captureState())).not.toContain('cc2TrapArrivalFrame');
      expect(cc2HiddenStateKey(world(e)).split(';').filter((part) => part.startsWith('Z') || part.startsWith('L'))).toEqual([]);
      for (const entity of e.getEntities()) {
        expect(entity.cc2PressFrame).toBeUndefined();
        expect(entity.cc2PadFrame).toBeUndefined();
      }
      expect(world(e).player.cc2TrapArrivalFrame).toBeUndefined();
      return playerCell(e);
    });
    // He stepped onto the trap at call 5, as on the CC2-engine level.
    expect(seen.slice(0, 4)).toEqual(STAYS);
  });
});
