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
 * CC2 wave 35, on a level with one player (actor order): a turning force floor draws its direction when the step of an actor onto it
 * ends, at the actor's slot of the arrival frame, not when the step starts (Lexy on_stand from step_on_cell, in the cooldown phase of
 * the arrival frame), and a refused actor bonks and draws again in every frame. Rows: a monster (a, RFM), the player (b, RFP) and a
 * block (c, RFB) draw at their arrival; a pushed block bonks into the player (d, RFB); an actor loaded on a fixed force floor first
 * slides in frame 1 of tic 0 (e, LFF); an actor loaded on a turning floor draws in tic 0 (f the player and a walker, g monsters, LRF);
 * a player whose suction boots cancel the floor draws nothing (h, BTS); the pending draw goes through snapshots (i) and the hidden key
 * (k); a level with a parked player keeps the old timing (j); a clone released onto the floor draws at its arrival (l); a yellow tank
 * is carried by a turning floor as any monster (m-q, RFY). Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes
 * (prefixes w32_, w35_, w35t_, w35y_).
 *
 * tick() call k plays the Lexy tic k - 1, so "after N calls" is the end of Lexy tic N - 1; an input of Lexy tic t is given before the
 * tick() call t + 1. The lanes start the shared turn of the turning floors at north (the replay header of each lane, as the lane
 * runs did), so every load calls setReplayForceStart('N'). The values are the end-of-tic values of the Lexy lane named next to each
 * case (actor oracle), read from the lane run, not from the engine. Every row except j (the actor-order guard) fails with at least one rule removed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction, RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const START: Direction = 'N';
const PREFIX_W32 = 'w32_';
const PREFIX_W35 = 'w35_';
const PREFIX_W35T = 'w35t_';
const PREFIX_W35Y = 'w35y_';
const WALKER = 'walker';
const BALL = 'pink_ball';
const DIRT_BLOCK = 'dirt_block';
const TANK = 'tank';
const YELLOW_TANK = 'puppet';
type Keys = readonly Direction[];
type Cell = [number, number];

/** The keys given at each Lexy tic. */
interface Plan {
  readonly keys: Readonly<Record<number, Keys>>;
}

async function load(lane: string, prefix: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  engine.setReplayForceStart(START);
  return engine;
}

/** A plan from `key tic` pairs (a key is given before the call tic + 1). */
function plan(keys: ReadonlyArray<readonly [number, Keys]>): Plan {
  return { keys: Object.fromEntries(keys.map(([tic, held]) => [tic + 1, held])) };
}

const NO_INPUT: Plan = plan([]);

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

/** The entities of a type, in uid order. */
const entitiesOfType = (engine: GameEngine, type: string): RuntimeEntity[] =>
  engine
    .getEntities()
    .filter((e) => e.type === type)
    .sort((a, b) => a.uid - b.uid);

/** The cell of the first entity of a type. */
const cellOf = (type: string) => (engine: GameEngine): Cell => {
  const e = entitiesOfType(engine, type)[0];
  return [e.x, e.y];
};

/** The cell and facing of the first entity of a type. */
const stateOf = (type: string) => (engine: GameEngine): { cell: Cell; dir: Direction } => {
  const e = entitiesOfType(engine, type)[0];
  return { cell: [e.x, e.y], dir: e.dir };
};

/** The player's cell and facing. */
const playerFacing = (engine: GameEngine): { cell: Cell; dir: Direction } => ({ cell: playerCell(engine), dir: engine.getPlayer().dir });

/** The state a straight run and a restored one must share: the snapshot and the hidden key. */
const stateKey = (engine: GameEngine): string => `${JSON.stringify(engine.captureState())}|${engine.getRuntimeKeyExtra()}`;

const E: Keys = ['E'];
const W: Keys = ['W'];
const N: Keys = ['N'];
const S: Keys = ['S'];

describe('CC2 wave 35 (a-c): a turning floor draws when the step ends (RFM, RFP, RFB)', () => {
  it('draws the walker its way at its arrival, not at its step start (Lexy lane w32_rfd_walker_a_m0p0_ne)', async () => {
    const engine = await load('rfd_walker_a_m0p0_ne', PREFIX_W32);
    const seen = sample(engine, NO_INPUT, [1, 3, 7], (e) => ({ player: playerCell(e), walker: stateOf(WALKER)(e) }));
    // Call 1: the step onto the turning floor is under way; the walker still faces its travel way (it drew nothing yet). With RFM
    // removed it faces north (drawn at the step start) and goes to (6,3) by call 3.
    expect(seen[0].walker).toEqual({ cell: [6, 4], dir: 'S' });
    expect(seen[1]).toMatchObject({ player: [10, 9], walker: { cell: [7, 4] } });
    expect(seen[2]).toMatchObject({ player: [10, 9], walker: { cell: [7, 4] } });
  });

  it('turns Chip the way the floor drew at his arrival (Lexy lane w32_rfd_walker_b_m0p1_ne)', async () => {
    const engine = await load('rfd_walker_b_m0p1_ne', PREFIX_W32);
    const seen = sample(engine, NO_INPUT, [3, 5, 9], (e) => ({ chip: playerFacing(e), walker: cellOf(WALKER)(e) }));
    // With RFP removed Chip faces east at call 3 (drawn at his step start) and stands at (10,3) at call 9.
    expect(seen[0].chip).toEqual({ cell: [10, 4], dir: 'S' });
    expect(seen[1].chip.cell).toEqual([11, 4]);
    expect(seen[2]).toMatchObject({ chip: { cell: [11, 4] }, walker: [6, 10] });
  });

  it('draws the dirt block its way at its arrival (Lexy lane w32_rfd_dirt_block_a_m0p0_ne)', async () => {
    const engine = await load('rfd_dirt_block_a_m0p0_ne', PREFIX_W32);
    const seen = sample(engine, NO_INPUT, [1, 3, 7], (e) => ({ player: playerCell(e), block: stateOf(DIRT_BLOCK)(e) }));
    // With RFB removed the block faces north at call 1 and stands at (6,3) with Chip at (11,10) at call 3.
    expect(seen[0].block).toEqual({ cell: [6, 4], dir: 'S' });
    expect(seen[1]).toMatchObject({ player: [10, 9], block: { cell: [7, 4] } });
    expect(seen[2]).toMatchObject({ player: [10, 9], block: { cell: [7, 4] } });
  });
});

describe('CC2 wave 35 (d): a pushed block refused on a turning floor bonks at once (RFB)', () => {
  it('bonks into Chip in the tic it is refused: failure at call 5 (Lexy lane w35_push_dirt_block_a_o2)', async () => {
    const engine = await load('push_dirt_block_a_o2', PREFIX_W35);
    const inputs = plan([[2, E], [4, W], [8, W], [12, W]]);
    play(engine, inputs, 4);
    expect(engine.getPlayer().alive).toBe(true);
    play(engine, inputs, 5, 4);
    // The block bonks west into Chip in tic 4 (call 5); with RFB removed it goes south and he dies one call later.
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.getPlayer().deathReasonKey).toBe('hud.messages.death_block');
    expect(cellOf(DIRT_BLOCK)(engine)).toEqual([9, 10]);
  });
});

describe('CC2 wave 35 (e): an actor loaded on a fixed force floor first slides in frame 1 (LFF)', () => {
  it('slides the walker in frame 1 of tic 0, so its arrival and Chip draw in the Lexy order (Lexy lane w32_rfd_walker_a_m0p0_ne)', async () => {
    const engine = await load('rfd_walker_a_m0p0_ne', PREFIX_W32);
    const seen = sample(engine, NO_INPUT, [2, 4, 8], (e) => ({ player: playerCell(e), walker: stateOf(WALKER)(e) }));
    // With LFF removed the walker faces north at call 2 and stands at (6,3) with Chip at (11,10) at call 4.
    expect(seen[0].walker).toEqual({ cell: [6, 4], dir: 'S' });
    expect(seen[1]).toMatchObject({ player: [10, 9], walker: { cell: [7, 4] } });
    expect(seen[2]).toMatchObject({ player: [10, 9], walker: { cell: [7, 4] } });
  });
});

describe('CC2 wave 35 (f, g): an actor loaded on a turning floor draws in tic 0 (LRF)', () => {
  it('draws Chip and the walker loaded on turning floors in the first tic (Lexy lane w35_start_player_walker_a_n)', async () => {
    const engine = await load('start_player_walker_a_n', PREFIX_W35);
    const seen = sample(engine, NO_INPUT, [1, 3, 7], (e) => ({ chip: playerFacing(e), walker: cellOf(WALKER)(e) }));
    // With LRF removed Chip faces south at call 1 and the walker stands at (10,10) at call 7.
    expect(seen[0].chip).toEqual({ cell: [6, 4], dir: 'W' });
    expect(seen[1]).toMatchObject({ chip: { cell: [6, 3] }, walker: [10, 10] });
    expect(seen[2].walker).toEqual([10, 9]);
  });

  it('draws the ball and the walker loaded on turning floors in the first tic (Lexy lane w35_start_walker_ball_a_n)', async () => {
    const engine = await load('start_walker_ball_a_n', PREFIX_W35);
    const seen = sample(engine, NO_INPUT, [4, 6, 10], (e) => ({ walker: cellOf(WALKER)(e), ball: stateOf(BALL)(e) }));
    // With LRF removed the ball faces east at call 4 and leaves (10,10) for (10,9) by call 6.
    expect(seen[0].ball).toEqual({ cell: [10, 10], dir: 'S' });
    expect(seen[1].ball.cell).toEqual([10, 10]);
    expect(seen[2]).toMatchObject({ walker: [6, 4], ball: { cell: [10, 10] } });
  });
});

describe('CC2 wave 35 (h): suction boots cancel the floor and it draws nothing (BTS)', () => {
  it('leaves the shared turn alone for Chip in boots: the walker draws the next ways (Lexy lane w35_boots_a_o4)', async () => {
    const engine = await load('boots_a_o4', PREFIX_W35);
    const inputs = plan([[0, E], [4, E], [12, N], [20, S], [28, W]]);
    const seen = sample(engine, inputs, [21, 23], (e) => ({ chip: playerCell(e), walker: cellOf(WALKER)(e) }));
    // With BTS removed Chip's arrival draws once more, so the walker stands at (6,3) at call 21 and (6,4) at call 23.
    expect(seen[0]).toEqual({ chip: [10, 10], walker: [6, 4] });
    expect(seen[1]).toEqual({ chip: [10, 10], walker: [6, 3] });
  });
});

describe('CC2 wave 35 (i, k): the pending draw is state', () => {
  it('goes through a snapshot: the pending draws of both actors survive an undo round trip (Lexy lane w32_rfd_walker_a_m0p0_ne)', async () => {
    const straight = await load('rfd_walker_a_m0p0_ne', PREFIX_W32);
    play(straight, NO_INPUT, 10);
    const engine = await load('rfd_walker_a_m0p0_ne', PREFIX_W32);
    play(engine, NO_INPUT, 2);
    // Both actors stepped onto the turning floor in frame 1 of tic 0 and hold their draw for the arrival frame.
    const walker = entitiesOfType(engine, WALKER)[0];
    expect(walker.cc2RffDue ?? walker.cc2RffStart).toBeDefined();
    expect(engine.getPlayer().cc2RffDue ?? engine.getPlayer().cc2RffStart).toBeDefined();
    const snap = engine.captureState();
    expect(snap.player.cc2RffDue ?? snap.player.cc2RffStart).toBeDefined();
    play(engine, NO_INPUT, 10, 2);
    engine.restoreState(snap);
    play(engine, NO_INPUT, 10, 2);
    expect(playerCell(engine)).toEqual(playerCell(straight));
    expect(cellOf(WALKER)(engine)).toEqual(cellOf(WALKER)(straight));
    expect(stateKey(engine)).toBe(stateKey(straight));
  });

  it('keeps the same hidden key for the same position reached at another time (Lexy lane w32_rfd_walker_a_m0p1_n)', async () => {
    const engine = await load('rfd_walker_a_m0p1_n', PREFIX_W32);
    const seen = sample(engine, NO_INPUT, [17, 31, 45], (e) => ({ chip: playerCell(e), walker: stateOf(WALKER)(e), key: e.getRuntimeKeyExtra() }));
    expect(seen[1].chip).toEqual(seen[0].chip);
    expect(seen[2].chip).toEqual(seen[0].chip);
    expect(seen[1].walker).toEqual(seen[0].walker);
    expect(seen[2].walker).toEqual(seen[0].walker);
    // The draw state is in the key (here Chip holds a draw due in 3 frames), relative to the running pass, so the key repeats.
    expect(seen[0].key).toMatch(/;D\S*d\d/);
    expect(seen[1].key).toBe(seen[0].key);
    expect(seen[2].key).toBe(seen[0].key);
  });
});

describe('CC2 wave 35 (j): a level with a parked player keeps the old timing', () => {
  it('draws at the step start when Melinda and a parked Chip share the level (Lexy lane w35_parked_a_m0p0)', async () => {
    const engine = await load('parked_a_m0p0', PREFIX_W35);
    const seen = sample(engine, NO_INPUT, [20, 21], (e) => ({
      melinda: playerFacing(e),
      sliding: e.getPlayer().isSliding,
      parked: (e.getParkedPlayers() ?? []).map((p) => ({ cell: [p.x, p.y] as Cell, dir: p.dir }))
    }));
    // No rule of the wave acts here (cc2ActorOrder is false): the values are those of the old code.
    expect(seen[0]).toMatchObject({ melinda: { cell: [6, 4], dir: 'E' }, sliding: true, parked: [{ cell: [10, 9], dir: 'S' }] });
    expect(seen[1]).toMatchObject({ melinda: { cell: [6, 3], dir: 'S' }, parked: [{ cell: [10, 9], dir: 'S' }] });
  });
});

describe('CC2 wave 35 (l): a clone released onto a turning floor draws at its arrival', () => {
  it('faces east at call 6 and stands at (7,5) at call 8 (Lexy lane w35t_clone_o0)', async () => {
    const engine = await load('clone_o0', PREFIX_W35T);
    const inputs = plan([[0, S]]);
    const seen = sample(engine, inputs, [6, 8], (e) => entitiesOfType(e, TANK).map((t) => ({ cell: [t.x, t.y] as Cell, dir: t.dir })));
    // The released tank (the one not on the cloner cell (5,5)) drew east at its arrival (t5 f2); with RFM removed it faces west at
    // call 6. Its cell is not asserted at call 6: Lexy has it at (6,5) and Epoxy at (7,5), because the clone's own step runs a tick
    // early (the leftover "clone due"), so only its facing is read there.
    const clone = seen[0].find((t) => t.cell[0] !== 5 || t.cell[1] !== 5);
    expect(clone?.dir).toBe('E');
    expect(seen[1]).toContainEqual({ cell: [7, 5], dir: 'E' });
  });
});

describe('CC2 wave 35 (m-q): a yellow tank is carried by a turning floor as any monster (RFY)', () => {
  it('draws the tank alone on a loop at its arrival and bonks (Lexy lane w35y_alone_n)', async () => {
    const engine = await load('alone_n', PREFIX_W35Y);
    const seen = sample(engine, NO_INPUT, [3, 5], (e) => stateOf(YELLOW_TANK)(e));
    // With RFY removed the tank stands at (6,5) facing north at both calls.
    expect(seen[0]).toEqual({ cell: [6, 4], dir: 'N' });
    expect(seen[1]).toEqual({ cell: [6, 5], dir: 'S' });
  });

  it('draws the tank listed after a walker in the Lexy order (Lexy lane w35y_pair_walker_a_n)', async () => {
    const engine = await load('pair_walker_a_n', PREFIX_W35Y);
    const seen = sample(engine, NO_INPUT, [3, 5], (e) => ({ walker: stateOf(WALKER)(e), tank: stateOf(YELLOW_TANK)(e) }));
    expect(seen[0]).toEqual({ walker: { cell: [11, 4], dir: 'W' }, tank: { cell: [6, 8], dir: 'N' } });
    expect(seen[1]).toEqual({ walker: { cell: [11, 3], dir: 'N' }, tank: { cell: [6, 9], dir: 'S' } });
  });

  it('carries the tank from a fixed force row onto a turning floor (Lexy lane w35y_fixed_rff)', async () => {
    const engine = await load('fixed_rff', PREFIX_W35Y);
    const seen = sample(engine, NO_INPUT, [11, 13], (e) => stateOf(YELLOW_TANK)(e));
    // With RFY removed the tank stands at (8,5) facing east at both calls.
    expect(seen).toEqual([{ cell: [8, 6], dir: 'S' }, { cell: [8, 6], dir: 'S' }]);
  });

  it('carries the tank onto the turning floor after the yellow button steered it (Lexy lane w35y_btn_o0_d8)', async () => {
    const engine = await load('btn_o0_d8', PREFIX_W35Y);
    const inputs = plan([[0, E], [4, W], [8, E]]);
    const seen = sample(engine, inputs, [7, 9], (e) => ({ chip: playerCell(e), tank: stateOf(YELLOW_TANK)(e) }));
    // With RFY removed the tank stands at (7,5) at both calls.
    expect(seen[0].tank).toEqual({ cell: [6, 5], dir: 'W' });
    expect(seen[1]).toMatchObject({ chip: [3, 9], tank: { cell: [6, 5], dir: 'W' } });
  });

  it('draws the tank listed before the player in the Lexy order (Lexy lane w35y_pair_player_b_n)', async () => {
    const engine = await load('pair_player_b_n', PREFIX_W35Y);
    const seen = sample(engine, NO_INPUT, [4, 10], (e) => ({ chip: playerFacing(e), tank: stateOf(YELLOW_TANK)(e) }));
    // With RFY removed the tank faces east at both calls and Chip stands at (11,9) at call 10.
    expect(seen[0]).toEqual({ chip: { cell: [11, 8], dir: 'S' }, tank: { cell: [6, 3], dir: 'N' } });
    expect(seen[1]).toMatchObject({ chip: { cell: [11, 8] }, tank: { cell: [6, 4], dir: 'S' } });
  });
});

