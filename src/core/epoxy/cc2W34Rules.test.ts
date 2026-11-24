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
 * CC2 wave 34 (B1SP), on a level with one player (actor order): a press that opens the trap under the player does not eject him when
 * his step onto the trap ended in that turn and every presser is listed after him (Lexy attempt_step refuses a moving actor,
 * game.js:2155; trap add_press, tiletypes.js:1768-1779). Rows: a tank (a), the mirror of Melinda alone (b) and a ball (c) listed after
 * him keep him in the trap; the same tank listed before him ejects him (d); a block presser, whose arrival is settled in the pre-pass,
 * ejects him as well (e); the marks go through snapshots (f); an arrival one tic before the press is still ejected, which guards
 * restAtStart (g); a slide (h) and a teleporter exit (i) arriving in the same tic keep him in the trap; a slide arriving one tic early
 * (j) and a presser listed before (k) eject him. Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w34_,
 * w34r2_).
 *
 * tick() call k plays the Lexy tic k - 1, so "after N calls" is the end of Lexy tic N - 1; an input of Lexy tic t is given before the
 * tick() call t + 1. The values are the end-of-tic values of the Lexy lane named next to each case (actor oracle), read from the lane
 * run, not from the engine; positions only (the facing is not compared). Rows a, b, c, h and i fail with the B1SP code removed, rows g
 * and j fail with restAtStart forced false; rows d, e and k hold with the rule on and off.
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
const PREFIX_W34 = 'w34_';
const PREFIX_W34R2 = 'w34r2_';
const TANK = 'tank';
const BALL = 'pink_ball';
const MIRROR_MELINDA = 'mirror_melinda';
const DIRT_BLOCK = 'dirt_block';
type Keys = readonly Direction[];
type Cell = [number, number];

/** The keys given at each Lexy tic. */
interface Plan {
  readonly keys: Readonly<Record<number, Keys>>;
}

async function load(lane: string, prefix: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  return engine;
}

/** A plan from `key tic` pairs (a key is given before the call tic + 1). */
function plan(keys: ReadonlyArray<readonly [number, Keys]>): Plan {
  return { keys: Object.fromEntries(keys.map(([tic, held]) => [tic + 1, held])) };
}

/** Plays the tick() calls `from` + 1 to `ticks`. */
function play(engine: GameEngine, inputs: Plan, ticks: number, from = 0): void {
  for (let call = from + 1; call <= ticks; call++) {
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

/** The controlled player's cell and the cells of the entities of the presser's type. */
const playerAnd = (type: string) => (engine: GameEngine): { player: Cell; presser: Cell[] } => ({
  player: playerCell(engine),
  presser: cellsOfType(type)(engine)
});

/** The state a straight run and a restored one must share: the snapshot and the hidden key. */
const stateKey = (engine: GameEngine): string => `${JSON.stringify(engine.captureState())}|${engine.getRuntimeKeyExtra()}`;

const N: Keys = ['N'];
const E: Keys = ['E'];
const W: Keys = ['W'];

/** The trap cell Chip (or Melinda) steps into on every lane. */
const IN_TRAP: Cell = [4, 5];
/** The cell east of the trap, where the ejection puts him. */
const EJECTED: Cell = [5, 5];

describe('CC2 wave 34 (a-c): a press by an actor listed after him keeps him in the trap (B1SP)', () => {
  it('keeps Chip in the trap when the tank listed after him presses in the tic his step ended (Lexy lane w34_b1sp_c_tank_a_o8)', async () => {
    const engine = await load('b1sp_c_tank_a_o8', PREFIX_W34);
    const inputs = plan([[8, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [12, 13, 17], playerAnd(TANK));
    expect(seen[0]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
    expect(seen[1]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
    expect(seen[2]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
  });

  it('keeps Melinda in the trap when her mirror listed after her presses in that tic (Lexy lane w34_b1sp_m_mirror_a_o1)', async () => {
    const engine = await load('b1sp_m_mirror_a_o1', PREFIX_W34);
    const inputs = plan([[0, N], [1, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [5, 6, 10], playerAnd(MIRROR_MELINDA));
    expect(seen[0]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
    expect(seen[1]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
    expect(seen[2]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
  });

  it('keeps Chip in the trap when the ball listed after him presses in that tic (Lexy lane w34_b1sp_c_ball_a_o4)', async () => {
    const engine = await load('b1sp_c_ball_a_o4', PREFIX_W34);
    const inputs = plan([[4, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [8, 9, 13], playerAnd(BALL));
    expect(seen[0]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
    expect(seen[1]).toEqual({ player: IN_TRAP, presser: [[9, 9]] });
    expect(seen[2]).toEqual({ player: IN_TRAP, presser: [[8, 9]] });
  });
});

describe('CC2 wave 34 (d, e): the guards that eject him with the rule on and off', () => {
  it('ejects Chip when the tank is listed before him (Lexy lane w34_b1sp_c_tank_b_o8)', async () => {
    const engine = await load('b1sp_c_tank_b_o8', PREFIX_W34);
    const inputs = plan([[8, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [12, 13, 17], playerAnd(TANK));
    // Precondition, the same with the rule off: Chip is in the trap at call 12.
    expect(seen[0]).toEqual({ player: IN_TRAP, presser: [[10, 3]] });
    expect(seen[1]).toEqual({ player: EJECTED, presser: [[10, 3]] });
    expect(seen[2]).toEqual({ player: EJECTED, presser: [[10, 3]] });
  });

  it('ejects Chip when a block listed after him presses (arrival settled in the pre-pass; Lexy lane w34_b1sp_c_block_a_o3)', async () => {
    const engine = await load('b1sp_c_block_a_o3', PREFIX_W34);
    const inputs = plan([[3, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [6, 8, 10, 14], playerAnd(DIRT_BLOCK));
    expect(seen[0]).toEqual({ player: IN_TRAP, presser: [[8, 9]] });
    expect(seen[1]).toEqual({ player: IN_TRAP, presser: [[9, 9]] });
    expect(seen[2]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
    expect(seen[3]).toEqual({ player: EJECTED, presser: [[10, 9]] });
  });
});

describe('CC2 wave 34 (f): the fresh mark goes through snapshots', () => {
  it('holds the marks after call 12, drops them after call 13, and a restored run equals a straight run (Lexy lane w34_b1sp_c_tank_a_o8)', async () => {
    const lane = 'b1sp_c_tank_a_o8';
    const inputs = plan([[8, E], [30, N], [34, W]]);
    const straight = await load(lane, PREFIX_W34);
    play(straight, inputs, 17);

    const engine = await load(lane, PREFIX_W34);
    play(engine, inputs, 12);
    // Discriminating assertion of this row: trapShutFresh after call 12 (set by runPlayerTurn, the B1SP mark).
    expect(engine.getPlayer().trapShutAtTurn).toBe(true);
    expect(engine.getPlayer().trapShutFresh).toBe(true);
    const snap = engine.captureState();
    expect(snap.player.trapShutFresh).toBe(true);
    play(engine, inputs, 13, 12);
    expect(engine.getPlayer().trapShutAtTurn).toBeUndefined();
    expect(engine.getPlayer().trapShutFresh).toBeUndefined();
    play(engine, inputs, 17, 13);
    engine.restoreState(snap);
    play(engine, inputs, 17, 12);
    expect(playerCell(engine)).toEqual(IN_TRAP);
    expect(stateKey(engine)).toBe(stateKey(straight));
  });
});

describe('CC2 wave 34 (g, j): an arrival one tic before the press still ejects him (guards restAtStart)', () => {
  it('ejects Chip at call 13 when he arrived one tic before the tank listed after him pressed (Lexy lane w34_b1sp_c_tank_a_o7)', async () => {
    const engine = await load('b1sp_c_tank_a_o7', PREFIX_W34);
    const inputs = plan([[7, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [11, 12, 13, 17], playerAnd(TANK));
    // With restAtStart forced false the mark is set for this arrival too and Chip stays in the trap at calls 13 and 17.
    expect(seen[0]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
    expect(seen[1]).toEqual({ player: IN_TRAP, presser: [[10, 9]] });
    expect(seen[2]).toEqual({ player: EJECTED, presser: [[10, 9]] });
    expect(seen[3]).toEqual({ player: EJECTED, presser: [[10, 9]] });
  });

  it('ejects Chip when his slide ended one tic before the press (Lexy lane w34r2_ice_c_a_o3)', async () => {
    const engine = await load('ice_c_a_o3', PREFIX_W34R2);
    const inputs = plan([[3, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [11, 12, 13, 17], playerAnd(TANK));
    // With restAtStart forced false Chip stays in the trap at calls 13 and 17.
    expect(seen[0]).toEqual({ player: IN_TRAP, presser: [[10, 10]] });
    expect(seen[1]).toEqual({ player: IN_TRAP, presser: [[10, 10]] });
    expect(seen[2]).toEqual({ player: EJECTED, presser: [[10, 10]] });
    expect(seen[3]).toEqual({ player: EJECTED, presser: [[10, 10]] });
  });
});

describe('CC2 wave 34 (h, i): a slide or a teleporter exit that ends in the press tic keeps him in the trap (B1SP)', () => {
  it('keeps Chip in the trap when his ice slide ends in the tic the tank listed after him presses (Lexy lane w34r2_ice_c_a_o4)', async () => {
    const engine = await load('ice_c_a_o4', PREFIX_W34R2);
    const inputs = plan([[4, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [11, 12, 13, 17], playerAnd(TANK));
    for (const s of seen) expect(s).toEqual({ player: IN_TRAP, presser: [[10, 10]] });
  });

  it('keeps Chip in the trap when his teleporter exit ends in the tic the tank listed after him presses (Lexy lane w34r2_tp_c_a_o4)', async () => {
    const engine = await load('tp_c_a_o4', PREFIX_W34R2);
    const inputs = plan([[4, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [11, 12, 13, 17], playerAnd(TANK));
    for (const s of seen) expect(s).toEqual({ player: IN_TRAP, presser: [[10, 10]] });
  });
});

describe('CC2 wave 34 (k): a presser listed before him ejects him, arrival or not', () => {
  it('ejects Chip after his teleporter exit when the tank is listed before him (Lexy lane w34r2_tp_c_b_o4)', async () => {
    const engine = await load('tp_c_b_o4', PREFIX_W34R2);
    const inputs = plan([[4, E], [30, N], [34, W]]);
    const seen = sample(engine, inputs, [11, 12, 13, 17], playerAnd(TANK));
    expect(seen[0]).toEqual({ player: IN_TRAP, presser: [[10, 3]] });
    expect(seen[1]).toEqual({ player: IN_TRAP, presser: [[10, 3]] });
    expect(seen[2]).toEqual({ player: EJECTED, presser: [[10, 3]] });
    expect(seen[3]).toEqual({ player: EJECTED, presser: [[10, 3]] });
  });
});
