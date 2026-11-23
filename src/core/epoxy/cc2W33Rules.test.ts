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
 * CC2 wave 33, on a level with several players (no actor order): a press that opens the trap of the controlled player (rows a, b) or
 * of a parked one (row c) steps him out the way he faces; not when the press comes in the tick his step onto the trap ended, from an
 * actor listed after him (d, d2); the ejection comes before the tick's input and before the swap (e), and the input at the end of the
 * ejected step is played one tic sooner (e2). A trapped player's refused move is copied by the mirrors (f), and with two keys held
 * the horizontal one decides (g). A swap clears the mirrors' memory and remembers the leaver's same-tick slide for the new
 * controller (h); mirrors listed after the leaver read the old memory, the one listed before a new controller who is himself listed
 * before the leaver reads his null decision (i, i2). The wave 32 exit step rows: a mirror copies the step of the player who left
 * through an exit until it ends (a32 to g3); a forced trap step is not copied (row b). Snapshots carry the new state (k).
 * Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w33_, w33r2_, w32r2_, w32_).
 *
 * tick() call k plays the Lexy tic k - 1, so "after N calls" is the end of Lexy tic N - 1; an input or a swap of Lexy tic t is given
 * before the tick() call t + 1. The values are the end-of-tic values of the Lexy lane named next to each case (actor oracle), read from
 * the lane run, not from the engine; positions only (a parked player's facing and the player who left by an exit are not compared).
 * The rows a, c, d, e and e2 also assert a precondition that holds with the rule on and off.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const PREFIX_W33 = 'w33_';
const PREFIX_W33R2 = 'w33r2_';
const PREFIX_W32R2 = 'w32r2_';
const PREFIX_W32 = 'w32_';
const TANK = 'tank';
const MIRROR_CHIP = 'mirror_chip';
const MIRROR_MELINDA = 'mirror_melinda';
type Keys = readonly Direction[];
type Cell = [number, number];

/** The keys given at each Lexy tic, and the Lexy tics a swap is given at (before the keys of the same tic). */
interface Plan {
  readonly keys: Readonly<Record<number, Keys>>;
  readonly swaps: readonly number[];
}

async function load(lane: string, prefix: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  return engine;
}

/** A plan from `key tic` pairs (a key is given before the call tic + 1) and the swap tics. */
function plan(keys: ReadonlyArray<readonly [number, Keys]>, swaps: readonly number[] = []): Plan {
  return { keys: Object.fromEntries(keys.map(([tic, held]) => [tic + 1, held])), swaps };
}

/** Plays the tick() calls `from` + 1 to `ticks`. */
function play(engine: GameEngine, inputs: Plan, ticks: number, from = 0): void {
  for (let call = from + 1; call <= ticks; call++) {
    if (inputs.swaps.includes(call - 1)) expect(engine.swapPlayer()).toBe(true);
    const keys = inputs.keys[call];
    if (keys !== undefined) engine.attemptPlayerMoveHeld(keys);
    engine.tick();
  }
}

/** Plays on to each tick of `ticks` (in order) and reads `read` there. */
function sample<T>(engine: GameEngine, inputs: Plan, ticks: readonly number[], read: (engine: GameEngine) => T): T[] {
  const out: T[] = [];
  let at = 0;
  for (const tick of ticks) {
    play(engine, inputs, tick, at);
    at = tick;
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

/** The cells of the players who are not controlled, in swap order. */
const parkedCells = (engine: GameEngine): Cell[] => (engine.getParkedPlayers() ?? []).map((p) => [p.x, p.y]);

/** The controlled player's cell and the cells of the tanks. */
const playerAndTank = (engine: GameEngine): { player: Cell; tanks: Cell[] } => ({ player: playerCell(engine), tanks: cellsOfType(TANK)(engine) });

/** The mirrors of Chip and of Melinda. */
const mirrors = (engine: GameEngine): { chip: Cell[]; melinda: Cell[] } => ({
  chip: cellsOfType(MIRROR_CHIP)(engine),
  melinda: cellsOfType(MIRROR_MELINDA)(engine)
});

/** The state a straight run and a restored one must share: the snapshot and the hidden key. */
const stateKey = (engine: GameEngine): string => `${JSON.stringify(engine.captureState())}|${engine.getRuntimeKeyExtra()}`;

const N: Keys = ['N'];
const E: Keys = ['E'];
const W: Keys = ['W'];
const NE: Keys = ['N', 'E'];
const NW: Keys = ['N', 'W'];

describe('CC2 wave 33 (a): a press that opens the trap of the controlled player steps him out (TEP)', () => {
  it('ejects Chip east when the tank presses the button (Lexy lane w33_tep_mp_ctl_c_tank_b_floor)', async () => {
    const engine = await load('tep_mp_ctl_c_tank_b_floor', PREFIX_W33);
    const inputs = plan([[0, E], [30, N], [34, W], [38, N]]);
    const seen = sample(engine, inputs, [12, 13, 17], playerAndTank);
    // Precondition, the same with the rule off: Chip is in the trap at call 12.
    expect(seen[0]).toEqual({ player: [4, 5], tanks: [[10, 3]] });
    expect(seen[1]).toEqual({ player: [5, 5], tanks: [[10, 3]] });
    expect(seen[2]).toEqual({ player: [5, 5], tanks: [[10, 3]] });
  });

  it('ejects Chip out of the trap and leaves his mirror where it was, whoever left by the exit (Lexy lane w32r2_b1_c_pb_d0)', async () => {
    const engine = await load('b1_c_pb_d0', PREFIX_W32R2);
    const inputs = plan([[0, E], [20, N], [24, W], [28, N]]);
    const seen = sample(engine, inputs, [4, 5, 9], (e) => ({ player: playerCell(e), mirrors: mirrors(e) }));
    // Precondition, the same with the rule off: Chip is in the trap at call 4 and his mirror at (4,3).
    expect(seen[0]).toEqual({ player: [4, 5], mirrors: { chip: [[4, 3]], melinda: [[10, 10]] } });
    // The ejection steps Chip onto the exit (5,5): control is at Melinda (12,12) and the forced step is no decision a mirror copies.
    expect(seen[1]).toEqual({ player: [12, 12], mirrors: { chip: [[4, 3]], melinda: [[10, 10]] } });
    expect(seen[2]).toEqual({ player: [12, 12], mirrors: { chip: [[4, 3]], melinda: [[10, 10]] } });
  });
});

describe('CC2 wave 33 (c): the same for a parked player (TEPK)', () => {
  it('ejects the parked Chip east while Melinda is controlled (Lexy lane w33_tep_mp_park_c_tank_b_floor)', async () => {
    const engine = await load('tep_mp_park_c_tank_b_floor', PREFIX_W33);
    const inputs = plan([[0, E], [8, E], [40, W], [44, N]], [4]);
    const seen = sample(engine, inputs, [12, 13, 17], (e) => ({ player: playerCell(e), parked: parkedCells(e), tanks: cellsOfType(TANK)(e) }));
    // Precondition, the same with the rule off: the parked Chip is in the trap at call 12.
    expect(seen[0]).toEqual({ player: [13, 12], parked: [[4, 5]], tanks: [[10, 3]] });
    expect(seen[1]).toEqual({ player: [13, 12], parked: [[5, 5]], tanks: [[10, 3]] });
    expect(seen[2]).toEqual({ player: [13, 12], parked: [[5, 5]], tanks: [[10, 3]] });
  });
});

describe('CC2 wave 33 (d): no ejection when the press comes in the tick his step onto the trap ended, from an actor listed after him (TEPF)', () => {
  it('keeps Chip in the trap when the tank listed after him presses in the same tic (Lexy lane w33r2_tsw_mp_c_a_o8)', async () => {
    const engine = await load('tsw_mp_c_a_o8', PREFIX_W33R2);
    const inputs = plan([[8, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [12, 13, 17], playerAndTank);
    expect(seen[0]).toEqual({ player: [4, 5], tanks: [[10, 9]] });
    expect(seen[1]).toEqual({ player: [4, 5], tanks: [[10, 9]] });
    expect(seen[2]).toEqual({ player: [4, 5], tanks: [[10, 9]] });
  });

  it('ejects him when the tank is listed before him (Lexy lane w33r2_tsw_mp_c_b_o8)', async () => {
    const engine = await load('tsw_mp_c_b_o8', PREFIX_W33R2);
    const inputs = plan([[8, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [12, 13, 17], playerAndTank);
    expect(seen[0]).toEqual({ player: [4, 5], tanks: [[10, 3]] });
    expect(seen[1]).toEqual({ player: [5, 5], tanks: [[10, 3]] });
    expect(seen[2]).toEqual({ player: [5, 5], tanks: [[10, 3]] });
  });
});

describe('CC2 wave 33 (e): the ejection comes before the input of the tick (TEPI)', () => {
  it('loses the north key given at the press tic: he is already stepping out east (Lexy lane w33r2_m1in_c_b_n12)', async () => {
    const engine = await load('m1in_c_b_n12', PREFIX_W33R2);
    const inputs = plan([[0, E], [12, N], [30, W]]);
    const seen = sample(engine, inputs, [12, 13, 14, 17], playerCell);
    expect(seen).toEqual([[4, 5], [5, 5], [5, 5], [5, 5]]);
  });

  it('plays the north key given at the end of the ejected step one tic sooner (Lexy lane w33r2_end_c_tank_b_k16)', async () => {
    const engine = await load('end_c_tank_b_k16', PREFIX_W33R2);
    const inputs = plan([[0, E], [16, N]]);
    const seen = sample(engine, inputs, [16, 17, 18, 21], playerCell);
    // Precondition, the same with the rule off: the ejected step has ended at call 16.
    expect(seen).toEqual([[5, 5], [5, 4], [5, 4], [5, 4]]);
  });
});

describe('CC2 wave 33 (f): the mirrors copy the refused move of a trapped player (TDM)', () => {
  it('copies north, then east, from a one-player level (Lexy lane w33_tdm_sp_c_b)', async () => {
    const engine = await load('tdm_sp_c_b', PREFIX_W33);
    const inputs = plan([[0, E], [8, N], [12, E], [16, W]]);
    const seen = sample(engine, inputs, [9, 10, 14], cellsOfType(MIRROR_CHIP));
    expect(seen).toEqual([[[10, 2]], [[10, 2]], [[11, 2]]]);
  });
});

describe('CC2 wave 33 (g): two keys held in a closed trap, the horizontal one decides (TDM2)', () => {
  it('faces west on north plus west and his mirror goes west (Lexy lane w33r2_two2_mp_c_N)', async () => {
    const engine = await load('two2_mp_c_N', PREFIX_W33R2);
    const inputs = plan([[0, E], [6, N], [10, NW], [14, N], [18, NE]]);
    const seen = sample(engine, inputs, [11, 12, 15], (e) => ({ facing: e.getPlayer().dir, mirror: cellsOfType(MIRROR_CHIP)(e) }));
    expect(seen[0]).toEqual({ facing: 'W', mirror: [[10, 8]] });
    expect(seen[1].mirror).toEqual([[9, 8]]);
    expect(seen[2].mirror).toEqual([[9, 8]]);
  });
});

describe('CC2 wave 33 (h): a swap clears the memory and remembers the leaver slide for the new controller (SWP)', () => {
  it('has the Chip mirror listed after the new controller copy the slide one tic later (Lexy lane w32r2_m1_fl_c_ma_s8)', async () => {
    const engine = await load('m1_fl_c_ma_s8', PREFIX_W32R2);
    const inputs = plan([[0, E], [8, N], [20, N], [24, E]], [4]);
    const seen = sample(engine, inputs, [5, 6, 9], mirrors);
    expect(seen[0]).toEqual({ chip: [[9, 11]], melinda: [[12, 11]] });
    expect(seen[1]).toEqual({ chip: [[9, 12]], melinda: [[12, 11]] });
    expect(seen[2]).toEqual({ chip: [[9, 12]], melinda: [[12, 11]] });
  });
});

describe('CC2 wave 33 (i): the mirrors listed around the leaver and the new controller read the right memory (SWP2)', () => {
  it('has the mirrors listed before a new controller, himself listed before the leaver, read his null decision (Lexy lane w33r2_swpa_fl_c_m0_s5)', async () => {
    const engine = await load('swpa_fl_c_m0_s5', PREFIX_W33R2);
    const inputs = plan([[1, E], [16, ['S']], [20, E], [24, ['S']]], [0, 5]);
    const seen = sample(engine, inputs, [6, 7, 10], mirrors);
    expect(seen).toEqual([
      { chip: [[5, 1]], melinda: [[7, 1]] },
      { chip: [[5, 1]], melinda: [[7, 1]] },
      { chip: [[5, 1]], melinda: [[7, 1]] }
    ]);
  });

  it('has the mirrors listed after the leaver read the old memory, his character (Lexy lane w33r2_swpa_fl_c_m2_s5)', async () => {
    const engine = await load('swpa_fl_c_m2_s5', PREFIX_W33R2);
    const inputs = plan([[1, E], [16, ['S']], [20, E], [24, ['S']]], [0, 5]);
    const seen = sample(engine, inputs, [6, 7, 11], mirrors);
    expect(seen).toEqual([
      { chip: [[9, 11]], melinda: [[12, 11]] },
      { chip: [[9, 11]], melinda: [[12, 11]] },
      { chip: [[9, 11]], melinda: [[12, 11]] }
    ]);
  });
});

describe('CC2 wave 33 (j): a mirror copies the exit step of the player who left until it ends (MXC)', () => {
  it('keeps the Chip mirror going north with two Chips, the first one leaving by the exit (Lexy lane w32r2_m2_cc_after_n1_d0)', async () => {
    const engine = await load('m2_cc_after_n1_d0', PREFIX_W32R2);
    const inputs = plan([[0, N], [16, N], [20, W], [24, N]]);
    const seen = sample(engine, inputs, [2, 6, 13], mirrors);
    for (const one of seen) expect(one).toEqual({ chip: [[9, 9]], melinda: [[11, 10]] });
  });
});

describe('CC2 wave 32 round 2 (MXC): the exit step the mirrors copy', () => {
  it('a: Melinda leads onto the exit, her mirror copies the step, Chip mirror does not (Lexy lane w32_mxc_player2_after_n1_d0)', async () => {
    const engine = await load('mxc_player2_after_n1_d0', PREFIX_W32);
    const seen = sample(engine, plan([[0, N]]), [2, 6, 13], mirrors);
    for (const one of seen) expect(one).toEqual({ chip: [[9, 10]], melinda: [[11, 9]] });
  });

  it('b: Chip leads with the mirrors listed before him, the copy is of the same tic (Lexy lane w32_mxc_player_before_n1_d0)', async () => {
    const engine = await load('mxc_player_before_n1_d0', PREFIX_W32);
    const seen = sample(engine, plan([[0, N]]), [1, 6, 13], mirrors);
    for (const one of seen) expect(one).toEqual({ chip: [[9, 1]], melinda: [[11, 2]] });
  });

  it('c: two keys, one step first, then the exit: the mirror copies the exit step the next tic (Lexy lane w32_mxc_player_after_ne_d1)', async () => {
    const engine = await load('mxc_player_after_ne_d1', PREFIX_W32);
    const seen = sample(engine, plan([[0, NE], [4, NE]]), [2, 6, 13], mirrors);
    // Precondition, the same with the rule off: at call 2 the mirror is at (9,9).
    expect(seen[0]).toEqual({ chip: [[9, 9]], melinda: [[11, 10]] });
    expect(seen[1]).toEqual({ chip: [[9, 8]], melinda: [[11, 10]] });
    expect(seen[2]).toEqual({ chip: [[9, 8]], melinda: [[11, 10]] });
  });

  it('e1: Chip goes north onto the exit while Melinda was swapped in on a force floor loop (Lexy lane w32r2_m1_fl_c_mb_s9)', async () => {
    const engine = await load('m1_fl_c_mb_s9', PREFIX_W32R2);
    const seen = sample(engine, plan([[0, E], [9, N]], [4]), [13, 15, 16, 20], mirrors);
    expect(seen.map((one) => one.chip)).toEqual([[[9, 5]], [[9, 5]], [[9, 5]], [[9, 5]]]);
    expect(seen.map((one) => one.melinda)).toEqual([[[12, 6]], [[12, 6]], [[11, 6]], [[12, 6]]]);
  });

  it('e2: Chip is swapped in on ice, Melinda leads onto the exit (Lexy lane w32r2_m1_ice_m_mb_s8)', async () => {
    const engine = await load('m1_ice_m_mb_s8', PREFIX_W32R2);
    const seen = sample(engine, plan([[0, E], [8, N]], [4]), [9, 10, 13, 14], mirrors);
    for (const one of seen) expect(one).toEqual({ chip: [[10, 6]], melinda: [[11, 5]] });
  });

  it('f1: two Chips, the first one leaves by the exit (Lexy lane w32r2_m2_cc_after_n1_d0)', async () => {
    const engine = await load('m2_cc_after_n1_d0', PREFIX_W32R2);
    const seen = sample(engine, plan([[0, N]]), [2, 6, 13], mirrors);
    for (const one of seen) expect(one).toEqual({ chip: [[9, 9]], melinda: [[11, 10]] });
  });

  it('f2: three players, the second leaves, then control goes round again (Lexy lane w32r2_m2_three_after)', async () => {
    const engine = await load('m2_three_after', PREFIX_W32R2);
    const seen = sample(engine, plan([[0, N], [16, N], [20, W], [24, N], [32, N]], [28]), [2, 6, 22], mirrors);
    expect(seen[0]).toEqual({ chip: [[9, 9]], melinda: [[11, 10]] });
    expect(seen[1]).toEqual({ chip: [[9, 9]], melinda: [[11, 10]] });
    expect(seen[2]).toEqual({ chip: [[8, 8]], melinda: [[11, 10]] });
  });

  it('f3: a force floor carries Chip onto the exit (Lexy lane w32r2_m3a_ff_c_before)', async () => {
    const engine = await load('m3a_ff_c_before', PREFIX_W32R2);
    const seen = sample(engine, plan([[0, N]]), [2, 4, 7], mirrors);
    expect(seen.map((one) => one.chip)).toEqual([[[9, 2]], [[9, 2]], [[9, 1]]]);
    expect(seen.map((one) => one.melinda)).toEqual([[[11, 3]], [[11, 3]], [[11, 3]]]);
  });

  it('g1: both mirrors walled in, nothing to copy (guard, Lexy lane w32r2_m3b_c_after)', async () => {
    const engine = await load('m3b_c_after', PREFIX_W32R2);
    const seen = sample(engine, plan([[0, N]]), [2, 6], mirrors);
    for (const one of seen) expect(one).toEqual({ chip: [[9, 10]], melinda: [[11, 10]] });
  });

  it('g2: Melinda carried onto an exit while parked, her mirror copies nothing of it (guard, Lexy lane w32r2_m3c_c_mb)', async () => {
    const engine = await load('m3c_c_mb', PREFIX_W32R2);
    const seen = sample(engine, plan([[0, E], [12, N], [16, N]], [2]), [7, 14, 18], mirrors);
    expect(seen.map((one) => one.chip)).toEqual([[[9, 5]], [[9, 4]], [[9, 3]]]);
    expect(seen.map((one) => one.melinda)).toEqual([[[12, 5]], [[12, 5]], [[12, 5]]]);
  });

  it('g3: a snapshot or an undo inside the exit step restores the memory and the run equals a straight run (Lexy lane w32r2_m2_cc_after_n1_d0)', async () => {
    const lane = 'm2_cc_after_n1_d0';
    const inputs = plan([[0, N]]);
    const straight = await load(lane, PREFIX_W32R2);
    play(straight, inputs, 8);

    const restored = await load(lane, PREFIX_W32R2);
    play(restored, inputs, 2);
    const snap = restored.captureState();
    expect(snap.mirrorMove?.exitStep).toEqual({ character: 'chip', ordinal: 0, ticks: 2 });
    play(restored, inputs, 8, 2);
    restored.restoreState(snap);
    play(restored, inputs, 8, 2);
    expect(stateKey(restored)).toBe(stateKey(straight));

    const undone = await load(lane, PREFIX_W32R2);
    play(undone, inputs, 2);
    undone.saveUndoSnapshot();
    const saved = stateKey(undone);
    play(undone, inputs, 5, 2);
    expect(undone.undo()).toBe(true);
    expect(stateKey(undone)).toBe(saved);
    play(undone, inputs, 8, 2);
    expect(stateKey(undone)).toBe(stateKey(straight));
  });
});

describe('CC2 wave 33 (k): the new state goes through snapshots', () => {
  it('a snapshot holds the trap mark of the parked Chip and a restored run equals a straight run (Lexy lane w33_tep_mp_park_c_tank_b_floor)', async () => {
    const lane = 'tep_mp_park_c_tank_b_floor';
    const inputs = plan([[0, E], [8, E], [40, W], [44, N]], [4]);
    const straight = await load(lane, PREFIX_W33);
    play(straight, inputs, 16);

    const engine = await load(lane, PREFIX_W33);
    play(engine, inputs, 12);
    const snap = engine.captureState();
    expect(snap.parked?.map((p) => [p.x, p.y, p.trapShutAtTurn === true])).toEqual([[4, 5, true]]);
    play(engine, inputs, 16, 12);
    engine.restoreState(snap);
    play(engine, inputs, 16, 12);
    expect(stateKey(engine)).toBe(stateKey(straight));
  });

  it('a snapshot holds the fresh trap mark of Chip and a restored run equals a straight run (Lexy lane w33r2_tsw_mp_c_a_o8)', async () => {
    const lane = 'tsw_mp_c_a_o8';
    const inputs = plan([[8, E], [30, N], [34, W]]);
    const straight = await load(lane, PREFIX_W33R2);
    play(straight, inputs, 16);

    const engine = await load(lane, PREFIX_W33R2);
    play(engine, inputs, 12);
    const snap = engine.captureState();
    expect(snap.player.trapShutFresh).toBe(true);
    play(engine, inputs, 16, 12);
    engine.restoreState(snap);
    play(engine, inputs, 16, 12);
    expect(stateKey(engine)).toBe(stateKey(straight));
  });

  it('a swap in a tick is in the snapshot taken before that tick and gone at its end (Lexy lane w33r2_swpa_fl_c_m0_s5)', async () => {
    const lane = 'swpa_fl_c_m0_s5';
    const inputs = plan([[1, E], [16, ['S']], [20, E], [24, ['S']]], [0, 5]);
    const straight = await load(lane, PREFIX_W33R2);
    play(straight, inputs, 6);

    const engine = await load(lane, PREFIX_W33R2);
    play(engine, inputs, 5);
    expect(engine.swapPlayer()).toBe(true);
    const snap = engine.captureState();
    expect(snap.mirrorMove?.swap).toBeDefined();
    expect(snap.mirrorMove?.swap?.oldCharacter).toBeDefined();
    engine.tick();
    expect(engine.captureState().mirrorMove?.swap).toBeUndefined();
    engine.restoreState(snap);
    expect(engine.captureState().mirrorMove?.swap).toEqual(snap.mirrorMove?.swap);
    engine.tick();
    expect(stateKey(engine)).toBe(stateKey(straight));
  });
});
