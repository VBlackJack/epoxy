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
 * CC2 wave 36: a lead who steps onto a brown button's trap in the same tic a press opens it stays inside when the presser comes
 * first in Lexy's frame order. Rows: a cloned presser (a fresh cloner template, a dropped rolling ball) has no list slot and counts
 * as listed last (a-d, n, CLN); with two pressers in the tic the one listed last decides (f, g, TPX); a block that presses in frame 0
 * of the arrival tic finds him still moving, so the ejection is lost (i-k, r, s, PFPB: pushed onto force floors, listed before and
 * after, one-player and multi-player, by the arrival and by a bomb).
 * Non-discriminating guards (the same values with the rule removed): e, h, l, o (one tic early, the lead is at rest and ejected
 * alike), p (both pressers listed before: ejected) and q (both listed after: kept). Row m is the snapshot round trip.
 * Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w36_, w36f_, w36r2_).
 *
 * tick() call k plays the Lexy tic k - 1, so "after N calls" is the end of Lexy tic N - 1; an input of Lexy tic t is given before the
 * tick() call t + 1. The values are the end-of-tic values of the Lexy lane named next to each case (actor oracle), read from the lane
 * run, not from the engine. The lanes start the shared turn at north (their replay header), so every load calls setReplayForceStart('N').
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';
import { droppedActorId } from './epoxyRollingBall';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const START: Direction = 'N';
const PREFIX_W36 = 'w36_';
const PREFIX_W36F = 'w36f_';
const PREFIX_W36R2 = 'w36r2_';
const TANK = 'tank';
const BALL = 'pink_ball';
const DIRT_BLOCK = 'dirt_block';
const ROLLING_BALL = 'rolling_ball';
type Cell = [number, number];

/** What an input can be: a held direction, or the drop of the bowling ball held. */
type Input = Direction | 'drop';
/** The inputs given at each tick() call, and the Lexy tics a swap is given at (before the input of the same tic). */
interface Plan {
  readonly inputs: Readonly<Record<number, Input>>;
  readonly swaps: readonly number[];
}

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

async function load(lane: string, prefix: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  engine.setReplayForceStart(START);
  return engine;
}

/** A plan from `tic input` pairs (an input is given before the call tic + 1) and the swap tics. */
function plan(inputs: ReadonlyArray<readonly [number, Input]>, swaps: readonly number[] = []): Plan {
  return { inputs: Object.fromEntries(inputs.map(([tic, input]) => [tic + 1, input])), swaps };
}

/** The id of the bowling ball the player holds. */
function heldBall(engine: GameEngine): string {
  const id = Object.keys(world(engine).player.keys).find((key) => droppedActorId(key) !== undefined);
  if (id === undefined) throw new Error('the player holds no bowling ball');
  return id;
}

/** Plays the tick() calls `from` + 1 to `ticks`. */
function play(engine: GameEngine, inputs: Plan, ticks: number, from = 0): void {
  for (let call = from + 1; call <= ticks; call++) {
    if (inputs.swaps.includes(call - 1)) expect(engine.swapPlayer()).toBe(true);
    const input = inputs.inputs[call];
    if (input === 'drop') engine.dropItem(heldBall(engine));
    else if (input !== undefined) engine.attemptPlayerMoveHeld([input]);
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

/** The cells of the entities of a type, in uid order. */
const cellsOfType = (type: string) => (engine: GameEngine): Cell[] =>
  engine
    .getEntities()
    .filter((e) => e.type === type)
    .sort((a, b) => a.uid - b.uid)
    .map((e) => [e.x, e.y]);

/** The controlled player's cell and the cells of the entities of a type. */
const playerAnd = (type: string) => (engine: GameEngine): { player: Cell; others: Cell[] } => ({
  player: playerCell(engine),
  others: cellsOfType(type)(engine)
});

/** The cells of the players who are not controlled, in swap order. */
const parkedCells = (engine: GameEngine): Cell[] => (engine.getParkedPlayers() ?? []).map((p) => [p.x, p.y]);

/** The state a straight run and a restored one must share: the snapshot and the hidden key. */
const stateKey = (engine: GameEngine): string => `${JSON.stringify(engine.captureState())}|${engine.getRuntimeKeyExtra()}`;

const E: Input = 'E';
const W: Input = 'W';
const N: Input = 'N';
const S: Input = 'S';
const DROP: Input = 'drop';

/** The lead's cell at each of four calls when he stays in the trap. */
const STAYS: Cell[] = [[4, 5], [4, 5], [4, 5], [4, 5]];
/** The lead's cell at each of four calls when the press at the first call ejects him at the next. */
const EJECTED: Cell[] = [[4, 5], [5, 5], [5, 5], [5, 5]];
/** The lead's cell when one tic early: the press at the second call, ejection at the third. */
const EJECTED_LATE: Cell[] = [[4, 5], [4, 5], [5, 5], [5, 5]];

const CLONE_INPUTS = plan([[0, E], [4, W], [8, E], [16, E]]);
const CLONE_CALLS = [20, 21, 22, 26] as const;

describe('CC2 wave 36 (a-e, n, o): a presser without a list slot counts as listed last (CLN)', () => {
  it('keeps Chip in the trap when the cloned tank reaches the button in his arrival tic, cloner listed after (Lexy lane w36_cln_sp_c_tank_a_o16)', async () => {
    const engine = await load('cln_sp_c_tank_a_o16', PREFIX_W36);
    const seen = sample(engine, CLONE_INPUTS, CLONE_CALLS, playerAnd(TANK));
    // With CLN removed Chip is ejected at call 21: (5,5) at calls 21, 22 and 26.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 9], [8, 9]]);
  });

  it('keeps Melinda in the trap, cloner listed before, ball clone (Lexy lane w36_cln_sp_m_ball_b_o16)', async () => {
    const engine = await load('cln_sp_m_ball_b_o16', PREFIX_W36);
    const seen = sample(engine, CLONE_INPUTS, CLONE_CALLS, playerAnd(BALL));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    expect(seen.map((s) => s.others)).toEqual([
      [[10, 3], [8, 3]],
      [[9, 3], [8, 3]],
      [[9, 3], [8, 3]],
      [[10, 3], [8, 3]]
    ]);
  });

  it('keeps the controlled player in the trap with a second player on the level (Lexy lane w36_cln_mp_c_ball_b_o16)', async () => {
    const engine = await load('cln_mp_c_ball_b_o16', PREFIX_W36);
    const seen = sample(engine, CLONE_INPUTS, CLONE_CALLS, (e) => ({ chip: playerCell(e), parked: parkedCells(e) }));
    expect(seen.map((s) => s.chip)).toEqual(STAYS);
    for (const s of seen) expect(s.parked).toEqual([[12, 12]]);
  });

  it('swaps away to Melinda and leaves Chip parked in the trap (Lexy lane w36_cln_mppk_c_tank_a_o16)', async () => {
    const engine = await load('cln_mppk_c_tank_a_o16', PREFIX_W36);
    const inputs = plan([[0, E], [4, W], [8, E], [16, E]], [20]);
    const seen = sample(engine, inputs, CLONE_CALLS, (e) => ({ controlled: playerCell(e), parked: parkedCells(e) }));
    // With CLN removed Chip is still controlled at call 21, at (5,5), and Melinda stays at (12,12).
    expect(seen[0]).toEqual({ controlled: [4, 5], parked: [[12, 12]] });
    for (const s of seen.slice(1)) expect(s).toEqual({ controlled: [12, 12], parked: [[4, 5]] });
  });

  it('guard: one tic early the lead is at rest and ejected as before (Lexy lane w36_cln_sp_c_tank_a_o15)', async () => {
    const engine = await load('cln_sp_c_tank_a_o15', PREFIX_W36);
    const seen = sample(engine, plan([[0, E], [4, W], [8, E], [15, E]]), [19, 20, 21, 25], playerCell);
    expect(seen).toEqual(EJECTED_LATE);
  });

  it('keeps Chip in the trap when the dropped rolling ball presses in his arrival tic (Lexy lane w36r2_bowl_c_d4_o20)', async () => {
    const engine = await load('bowl_c_d4_o20', PREFIX_W36R2);
    const seen = sample(engine, plan([[0, S], [4, DROP], [8, E], [20, S]]), [24, 25, 26, 30], playerAnd(ROLLING_BALL));
    // With CLN removed Chip steps out south at call 25: (4,6) at calls 25, 26 and 30.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    expect(seen.map((s) => s.others)).toEqual([[[3, 9]], [], [], []]);
  });

  it('guard: the rolling ball one tic early finds Chip at rest and he is ejected alike (Lexy lane w36r2_bowl_c_d4_o19)', async () => {
    const engine = await load('bowl_c_d4_o19', PREFIX_W36R2);
    const seen = sample(engine, plan([[0, S], [4, DROP], [8, E], [19, S]]), [23, 24, 25, 29], playerCell);
    expect(seen).toEqual([[4, 5], [4, 5], [4, 6], [4, 6]]);
  });
});

describe('CC2 wave 36 (f-h, p, q): the presser listed last decides (TPX)', () => {
  const TPX_INPUTS = plan([[8, E]]);
  const TPX_CALLS = [12, 13, 14, 18] as const;

  it('keeps Chip in the trap when two tanks press in his arrival tic, one listed after him (Lexy lane w36_tpx_sp_c_tt_o8)', async () => {
    const engine = await load('tpx_sp_c_tt_o8', PREFIX_W36);
    const seen = sample(engine, TPX_INPUTS, TPX_CALLS, playerAnd(TANK));
    // With TPX removed (any presser listed before ejects) Chip is at (5,5) at calls 13, 14 and 18.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3], [10, 9]]);
  });

  it('keeps Melinda in the trap for a tank and a ball, two players (Lexy lane w36_tpx_mp_m_tb_o8)', async () => {
    const engine = await load('tpx_mp_m_tb_o8', PREFIX_W36);
    const seen = sample(engine, TPX_INPUTS, TPX_CALLS, playerAnd(BALL));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    expect(seen.map((s) => s.others)).toEqual([[[10, 9]], [[9, 9]], [[9, 9]], [[8, 9]]]);
  });

  it('guard: one tic early the lead is at rest and ejected as before (Lexy lane w36_tpx_sp_c_tt_o7)', async () => {
    const engine = await load('tpx_sp_c_tt_o7', PREFIX_W36);
    const seen = sample(engine, plan([[7, E]]), [11, 12, 13, 17], playerCell);
    expect(seen).toEqual(EJECTED_LATE);
  });

  it('guard: both pressers listed before him eject him in the tic (Lexy lane w36r2_tpg_c_bb_o8)', async () => {
    const engine = await load('tpg_c_bb_o8', PREFIX_W36R2);
    const seen = sample(engine, TPX_INPUTS, TPX_CALLS, playerAnd(TANK));
    expect(seen.map((s) => s.player)).toEqual(EJECTED);
    for (const s of seen) expect(s.others).toEqual([[10, 2], [10, 3]]);
  });

  it('guard: both pressers listed after him keep him in the trap (Lexy lane w36r2_tpg_c_aa_o8)', async () => {
    const engine = await load('tpg_c_aa_o8', PREFIX_W36R2);
    const seen = sample(engine, TPX_INPUTS, TPX_CALLS, playerAnd(TANK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 9], [10, 10]]);
  });
});

describe('CC2 wave 36 (i-l, r, s): a block press in frame 0 of his arrival tic finds him moving (PFPB)', () => {
  it('keeps Chip in the trap, block on force floors listed after him (Lexy lane w36_mpre_sp_c_block_a_o8)', async () => {
    const engine = await load('mpre_sp_c_block_a_o8', PREFIX_W36);
    const seen = sample(engine, plan([[8, E]]), [12, 13, 14, 18], playerAnd(DIRT_BLOCK));
    // With PFPB removed the hook ejects him at call 13: (5,5) at calls 13, 14 and 18.
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 9]]);
  });

  it('keeps Chip in the trap, block listed before him, two players (Lexy lane w36_mpre_mp_c_block_b_o8)', async () => {
    const engine = await load('mpre_mp_c_block_b_o8', PREFIX_W36);
    const seen = sample(engine, plan([[8, E]]), [11, 12, 13, 17], (e) => ({ ...playerAnd(DIRT_BLOCK)(e), parked: parkedCells(e) }));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) {
      expect(s.others).toEqual([[10, 3]]);
      expect(s.parked).toEqual([[12, 12]]);
    }
  });

  it('keeps Chip in the trap, block pushed onto the force floors by the lead (Lexy lane w36f_pb_c_o16)', async () => {
    const engine = await load('pb_c_o16', PREFIX_W36F);
    const seen = sample(engine, plan([[0, N], [16, E]]), [20, 21, 22, 26], playerAnd(DIRT_BLOCK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('keeps Chip in the trap, block on two force floors listed before him (Lexy lane w36f_ff2_c_b_o2)', async () => {
    const engine = await load('ff2_c_b_o2', PREFIX_W36F);
    const seen = sample(engine, plan([[2, E]]), [6, 7, 8, 12], playerAnd(DIRT_BLOCK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    for (const s of seen) expect(s.others).toEqual([[10, 3]]);
  });

  it('keeps Chip in the trap when a bomb on the button destroys the block that presses (Lexy lane w36r2_bomb_c_b_o2)', async () => {
    const engine = await load('bomb_c_b_o2', PREFIX_W36R2);
    const seen = sample(engine, plan([[2, E]]), [6, 7, 8, 12], playerAnd(DIRT_BLOCK));
    expect(seen.map((s) => s.player)).toEqual(STAYS);
    // The block is at (10,3) at call 6 and the bomb has destroyed it after.
    expect(seen.map((s) => s.others)).toEqual([[[10, 3]], [], [], []]);
  });

  it('guard: one tic early the lead is at rest and ejected as before (Lexy lane w36_mpre_sp_c_block_b_o7)', async () => {
    const engine = await load('mpre_sp_c_block_b_o7', PREFIX_W36);
    const seen = sample(engine, plan([[7, E]]), [11, 12, 13, 17], playerCell);
    expect(seen).toEqual(EJECTED_LATE);
  });
});

describe('CC2 wave 36 (m): the rules keep no state outside the snapshot', () => {
  it('restores a clone press to the straight run (Lexy lane w36_cln_sp_c_tank_a_o16)', async () => {
    const straight = await load('cln_sp_c_tank_a_o16', PREFIX_W36);
    play(straight, CLONE_INPUTS, 26);
    const engine = await load('cln_sp_c_tank_a_o16', PREFIX_W36);
    play(engine, CLONE_INPUTS, 20);
    const snap = engine.captureState();
    play(engine, CLONE_INPUTS, 26, 20);
    engine.restoreState(snap);
    play(engine, CLONE_INPUTS, 26, 20);
    expect(playerCell(engine)).toEqual([4, 5]);
    expect(stateKey(engine)).toBe(stateKey(straight));
  });

  it('restores a block press to the straight run (Lexy lane w36_mpre_sp_c_block_a_o8)', async () => {
    const inputs = plan([[8, E]]);
    const straight = await load('mpre_sp_c_block_a_o8', PREFIX_W36);
    play(straight, inputs, 18);
    const engine = await load('mpre_sp_c_block_a_o8', PREFIX_W36);
    play(engine, inputs, 12);
    const snap = engine.captureState();
    play(engine, inputs, 18, 12);
    engine.restoreState(snap);
    play(engine, inputs, 18, 12);
    expect(playerCell(engine)).toEqual([4, 5]);
    expect(stateKey(engine)).toBe(stateKey(straight));
  });
});
