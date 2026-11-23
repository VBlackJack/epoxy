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
 * CC2 wave 31: a player holding two keys does not take a way an actor held when he decided (rows a to a5); a mirror does not copy the
 * release of the player from a trap (row b); a block presses a brown button when its step ends (row c) and the trap ejects at once what
 * it holds: a player (c2), a walker (c3), a yellow tank (c4), a block (c5), two traps (c6), a force floor arrival (c7), a teleporter
 * pushed block (c8), a teeth out of its phase (d, d2); a bomb under a brown button keeps the press (d3); the ejection of an arrival
 * settled in the frame pre-pass lasts one tic more (e); a fireball retries after the pass only when its bump melted ice (f, f2, f3);
 * guards g1 to g3. Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w31_, w31b_, w31r2_, w30_, w24_).
 *
 * tick() call k plays the Lexy tic k - 1, so "after N calls" is the end of Lexy tic N - 1; an input of Lexy tic t is given before the
 * tick() call t + 1. The values are the end-of-tic values of the Lexy lane named next to each case (actor oracle), read from the lane
 * run, not from the engine. The rows a and d also assert a precondition that holds with the rule on and off.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const PREFIX_W31 = 'w31_';
const PREFIX_W31B = 'w31b_';
const PREFIX_W31R2 = 'w31r2_';
const PREFIX_W30 = 'w30_';
const PREFIX_W24 = 'w24_';
const BALL = 'pink_ball';
const BUG = 'bug';
const TEETH = 'teeth';
const WALKER = 'walker';
const YELLOW_TANK = 'puppet';
const TANK = 'tank';
const GLIDER = 'glider';
const MIRROR = 'mirror_chip';
const FIREBALL = 'fireball';
const DIRT_BLOCK = 'dirt_block';
const ICE_BLOCK = 'ice_block';
type Keys = readonly Direction[];
type Inputs = Readonly<Record<number, Keys>>;
type Cell = [number, number];
type Placed = [number, number, Direction];

async function load(lane: string, prefix: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  return engine;
}

/** Plays the tick() calls `from` + 1 to `ticks`; an input of the map is given before the call it names. */
function play(engine: GameEngine, inputs: Inputs, ticks: number, from = 0): void {
  for (let call = from + 1; call <= ticks; call++) {
    const keys = inputs[call];
    if (keys !== undefined) engine.attemptPlayerMoveHeld(keys);
    engine.tick();
  }
}

/** Plays on to each tick of `ticks` (in order) and reads `read` there. */
function sample<T>(engine: GameEngine, inputs: Inputs, ticks: readonly number[], read: (engine: GameEngine) => T): T[] {
  const out: T[] = [];
  let at = 0;
  for (const tick of ticks) {
    play(engine, inputs, tick, at);
    at = tick;
    out.push(read(engine));
  }
  return out;
}

/** The keys `keys` given at each Lexy tic of `tics` (each one before the tick() call tic + 1). */
function pressed(keys: Keys, ...tics: number[]): Inputs {
  return Object.fromEntries(tics.map((tic) => [tic + 1, keys]));
}

/** The keys `keys` held at every Lexy tic from `fromTic` to `toTic`. */
function heldTics(keys: Keys, fromTic: number, toTic: number): Inputs {
  const inputs: Record<number, Keys> = {};
  for (let tic = fromTic; tic <= toTic; tic++) inputs[tic + 1] = keys;
  return inputs;
}

const playerPlaced = (engine: GameEngine): Placed => [engine.getPlayer().x, engine.getPlayer().y, engine.getPlayer().dir];

/** The cells of the entities of a type, in uid order. */
const cellsOfType = (type: string) => (engine: GameEngine): Cell[] =>
  engine
    .getEntities()
    .filter((e) => e.type === type)
    .sort((a, b) => a.uid - b.uid)
    .map((e) => [e.x, e.y]);

/** The place and facing of the entities of a type, in uid order. */
const placedOfType = (type: string) => (engine: GameEngine): Placed[] =>
  engine
    .getEntities()
    .filter((e) => e.type === type)
    .sort((a, b) => a.uid - b.uid)
    .map((e) => [e.x, e.y, e.dir]);

const playerAnd = (type: string) => (engine: GameEngine): { player: Placed; others: Placed[] } => ({
  player: playerPlaced(engine),
  others: placedOfType(type)(engine)
});

describe('CC2 wave 31 (a): a held pair does not take the key an actor held at the decision', () => {
  it('keeps going south while the ball held the east cell (Lexy lane w31b_pdh_ball_s_h1_t11)', async () => {
    const engine = await load('pdh_ball_s_h1_t11', PREFIX_W31B);
    const inputs = { ...pressed(['S'], 0), ...heldTics(['S', 'E'], 11, 20) };
    const seen = sample(engine, inputs, [20, 21, 24], playerAnd(BALL));
    // Precondition, the same with the rule off: the player faces south at (6,7) at call 20.
    expect(seen[0]).toEqual({ player: [6, 7, 'S'], others: [[7, 7, 'E']] });
    expect(seen[1]).toEqual({ player: [6, 7, 'S'], others: [[8, 7, 'E']] });
    expect(seen[2]).toEqual({ player: [6, 7, 'S'], others: [[8, 7, 'E']] });
  });

  it('steps east once the blue tank left the east cell, not south into it (Lexy lane w31r2_pdh_tank_s_h0_t12)', async () => {
    const engine = await load('pdh_tank_s_h0_t12', PREFIX_W31R2);
    const inputs = { ...pressed(['S'], 0), ...heldTics(['S', 'E'], 12, 21) };
    const seen = sample(engine, inputs, [12, 13], playerAnd(TANK));
    expect(seen[0]).toEqual({ player: [5, 6, 'S'], others: [[5, 7, 'E']] });
    expect(seen[1]).toEqual({ player: [6, 6, 'E'], others: [[6, 7, 'E']] });
  });

  it('takes the vertical key when the ball held the horizontal one the player faces (Lexy lane w31r2_pdh_hb_s_h0_t16)', async () => {
    const engine = await load('pdh_hb_s_h0_t16', PREFIX_W31R2);
    const inputs = { ...pressed(['E'], 0), ...heldTics(['N', 'E'], 16, 25) };
    const seen = sample(engine, inputs, [16, 17], playerAnd(BALL));
    expect(seen[0].player).toEqual([5, 6, 'E']);
    expect(seen[1]).toEqual({ player: [5, 5, 'N'], others: [[6, 5, 'N']] });
  });

  it('falls back to the horizontal key when the vertical way is walled (Lexy lane w31r2_pdh_hfb_s_h0_t16)', async () => {
    const engine = await load('pdh_hfb_s_h0_t16', PREFIX_W31R2);
    const inputs = { ...pressed(['E'], 0), ...heldTics(['N', 'E'], 16, 25) };
    const seen = sample(engine, inputs, [16, 17], playerPlaced);
    expect(seen).toEqual([
      [5, 6, 'E'],
      [6, 6, 'E']
    ]);
  });

  it('keeps the old order when both keys were held by monsters listed after the player (Lexy lane w31r2_pdh_boths_a2_o0_t3)', async () => {
    const engine = await load('pdh_boths_a2_o0_t3', PREFIX_W31R2);
    const inputs = { ...pressed(['S'], 0), ...heldTics(['S', 'E'], 3, 12) };
    const seen = sample(engine, inputs, [13, 16], (e) => ({ player: playerPlaced(e), balls: placedOfType(BALL)(e) }));
    expect(seen[0]).toEqual({ player: [6, 6, 'E'], balls: [[4, 7, 'W'], [6, 8, 'S']] });
    expect(seen[1]).toEqual({ player: [6, 6, 'E'], balls: [[3, 7, 'W'], [6, 8, 'S']] });
  });
});

describe('CC2 wave 31 (b): a mirror does not copy the release of the player from a trap', () => {
  it('leaves the mirror in place while the player is ejected east (Lexy lane w31_mir_d1_d0_open)', async () => {
    const engine = await load('mir_d1_d0_open', PREFIX_W31);
    const seen = sample(engine, pressed(['E'], 0), [5, 6, 9], playerAnd(MIRROR));
    for (const s of seen) expect(s).toEqual({ player: [5, 5, 'E'], others: [[4, 3, 'E']] });
  });
});

describe('CC2 wave 31 (c): a block works a brown button when its step ends, and the trap ejects what it holds at once', () => {
  it('lets the bug out of the trap when the pushed dirt block arrives (Lexy lane w31_bba_dirt_bug_p)', async () => {
    const engine = await load('bba_dirt_bug_p', PREFIX_W31);
    const seen = sample(engine, pressed(['E'], 0), [1, 4, 5], (e) => ({ block: cellsOfType(DIRT_BLOCK)(e), bug: cellsOfType(BUG)(e) }));
    expect(seen).toEqual([
      { block: [[5, 4]], bug: [[6, 8]] },
      { block: [[5, 4]], bug: [[6, 8]] },
      { block: [[5, 4]], bug: [[7, 8]] }
    ]);
  });

  it('ejects the player standing in the trap, through his forced step (Lexy lane w31r2_bba_player_ice_p)', async () => {
    const engine = await load('bba_player_ice_p', PREFIX_W31R2);
    const seen = sample(engine, pressed(['E'], 0), [10, 11, 14], (e) => ({ player: playerPlaced(e), ice: cellsOfType(ICE_BLOCK)(e) }));
    expect(seen).toEqual([
      { player: [6, 8, 'E'], ice: [[5, 4], [6, 4]] },
      { player: [7, 8, 'E'], ice: [[5, 4], [6, 4]] },
      { player: [7, 8, 'E'], ice: [[5, 4], [6, 4]] }
    ]);
  });

  it('ejects a walker held in the trap (Lexy lane w31r2_bba_occ_walker_p)', async () => {
    const engine = await load('bba_occ_walker_p', PREFIX_W31R2);
    expect(sample(engine, pressed(['E'], 0), [1, 5], cellsOfType(WALKER))).toEqual([[[6, 8]], [[7, 8]]]);
  });

  it('ejects a yellow tank held in the trap (Lexy lane w31r2_bba_occ_tank_yellow_p)', async () => {
    const engine = await load('bba_occ_tank_yellow_p', PREFIX_W31R2);
    expect(sample(engine, pressed(['E'], 0), [4, 5, 8], cellsOfType(YELLOW_TANK))).toEqual([[[6, 8]], [[7, 8]], [[7, 8]]]);
  });

  it('pushes a block held in the trap out of it (Lexy lane w31r2_bba_occ_dirt_block_p)', async () => {
    const engine = await load('bba_occ_dirt_block_p', PREFIX_W31R2);
    const seen = sample(engine, pressed(['E'], 0), [5, 8], (e) => cellsOfType(DIRT_BLOCK)(e).sort((a, b) => a[0] - b[0]));
    expect(seen).toEqual([
      [[5, 4], [7, 8]],
      [[5, 4], [7, 8]]
    ]);
  });

  it('ejects the bug of the trap its button opens and leaves the other trap alone (Lexy lane w31r2_bba_twotraps_o0)', async () => {
    const engine = await load('bba_twotraps_o0', PREFIX_W31R2);
    const seen = sample(engine, pressed(['E'], 0), [1, 4, 5], (e) => ({ bug: cellsOfType(BUG)(e), glider: cellsOfType(GLIDER)(e) }));
    expect(seen).toEqual([
      { bug: [[6, 8]], glider: [[6, 11]] },
      { bug: [[6, 8]], glider: [[6, 11]] },
      { bug: [[7, 8]], glider: [[6, 11]] }
    ]);
  });

  it('ejects the bug when a block carried by a force floor arrives on the button (Lexy lane w31r2_bba_force_bug_n1)', async () => {
    const engine = await load('bba_force_bug_n1', PREFIX_W31R2);
    expect(sample(engine, {}, [1, 4, 5], cellsOfType(BUG))).toEqual([[[6, 8]], [[6, 8]], [[7, 8]]]);
  });

  it('ejects the bug when a block that went through a teleporter arrives on the button (Lexy lane w31r2_bba_btp_red_bug)', async () => {
    const engine = await load('bba_btp_red_bug', PREFIX_W31R2);
    const seen = sample(engine, pressed(['E'], 0), [5, 8], (e) => ({ block: cellsOfType(DIRT_BLOCK)(e), bug: cellsOfType(BUG)(e) }));
    expect(seen).toEqual([
      { block: [[12, 2]], bug: [[6, 10]] },
      { block: [[12, 2]], bug: [[6, 10]] }
    ]);
  });
});

describe('CC2 wave 31 (d, d2): a teeth ejected from a trap steps out whatever its phase', () => {
  it('steps east at the arrival of the pushed block (Lexy lane w31_bba_dirt_teeth_p)', async () => {
    const engine = await load('bba_dirt_teeth_p', PREFIX_W31);
    const seen = sample(engine, pressed(['E'], 0), [4, 5, 7], placedOfType(TEETH));
    // Precondition, the same with the rule off: the teeth still waits in the trap at call 4.
    expect(seen[0]).toEqual([[6, 8, 'E']]);
    expect(seen[1]).toEqual([[7, 8, 'E']]);
    expect(seen[2]).toEqual([[7, 8, 'E']]);
  });

  it('steps east at the arrival of a block carried by a force floor (Lexy lane w31r2_bba_force_teeth_n3)', async () => {
    const engine = await load('bba_force_teeth_n3', PREFIX_W31R2);
    expect(sample(engine, {}, [9, 12], placedOfType(TEETH))).toEqual([[[7, 8, 'E']], [[7, 8, 'E']]]);
  });
});

describe('CC2 wave 31 (d3): a bomb under a brown button keeps the press and the trap ejects', () => {
  it('lets the bug out when the block is destroyed on the button (Lexy lane w31r2_bba_bomb_bug)', async () => {
    const engine = await load('bba_bomb_bug', PREFIX_W31R2);
    const seen = sample(engine, pressed(['E'], 0), [5, 8], (e) => ({ block: cellsOfType(DIRT_BLOCK)(e), bug: cellsOfType(BUG)(e) }));
    expect(seen).toEqual([
      { block: [], bug: [[7, 8]] },
      { block: [], bug: [[7, 8]] }
    ]);
  });
});

describe('CC2 wave 31 (e): the ejection of an arrival settled in the frame pre-pass lasts one tic more', () => {
  it('keeps the bug at (7,8) one tic longer (Lexy lane w31_bba_dirt_bug_s)', async () => {
    const engine = await load('bba_dirt_bug_s', PREFIX_W31);
    expect(sample(engine, pressed(['E'], 0), [9, 10], cellsOfType(BUG))).toEqual([[[7, 8]], [[7, 8]]]);
  });
});

describe('CC2 wave 31 (f, f2, f3): a fireball retries after the pass only when its bump melted ice', () => {
  it('waits for the next pre-pass when the refused fireball melted nothing (Lexy lane w30_lcm_fireball_ice_nw_k0)', async () => {
    const engine = await load('lcm_fireball_ice_nw_k0', PREFIX_W30);
    expect(sample(engine, {}, [5, 6, 9], placedOfType(FIREBALL))).toEqual([[[2, 4, 'E']], [[3, 4, 'E']], [[3, 4, 'E']]]);
  });

  it('melts the ice block against the wall and goes on east (guard, Lexy lane w24_fire_iceblk_wall)', async () => {
    const engine = await load('fire_iceblk_wall', PREFIX_W24);
    const seen = sample(engine, {}, [2, 4], (e) => ({ ice: cellsOfType(ICE_BLOCK)(e), fireball: placedOfType(FIREBALL)(e) }));
    expect(seen).toEqual([
      { ice: [], fireball: [[6, 4, 'E']] },
      { ice: [], fireball: [[6, 4, 'E']] }
    ]);
  });

  it('keeps a melt of the frame pre-pass out of the set (guard, Lexy lane w31r2_fbr_prepass_melt_k1_wall)', async () => {
    const engine = await load('fbr_prepass_melt_k1_wall', PREFIX_W31R2);
    const seen = sample(engine, {}, [2, 4, 8], (e) => ({ fireball: placedOfType(FIREBALL)(e), ice: cellsOfType(ICE_BLOCK)(e) }));
    expect(seen).toEqual([
      { fireball: [[3, 4, 'E']], ice: [[5, 4]] },
      { fireball: [[4, 4, 'E']], ice: [[5, 4]] },
      { fireball: [[2, 4, 'W']], ice: [[5, 4]] }
    ]);
  });
});

describe("CC2 wave 31 (g1): a block pushed onto a brown button opens the trap as before in a CC1 or native room, and at the block's arrival in a CC2 room", () => {
  const BUTTON = { x: 4, y: ROOM_ROW };
  const TRAP = { x: 6, y: 8 };
  const WALLS: Cell[] = [[5, 7], [5, 8], [5, 9], [6, 7], [6, 9]];

  function trapRoom(mode: RoomMode): GameEngine {
    const terrain: Record<string, string> = { [`${BUTTON.x},${BUTTON.y}`]: 'button_brown', [`${TRAP.x},${TRAP.y}`]: 'trap' };
    for (const [x, y] of WALLS) terrain[`${x},${y}`] = 'wall';
    const level = room({
      mode,
      startX: 2,
      terrain,
      entities: [
        { type: DIRT_BLOCK, x: 3, y: ROOM_ROW, dir: 'E' },
        { type: BUG, x: TRAP.x, y: TRAP.y, dir: 'E' }
      ]
    });
    level.trapLinks = [{ buttonX: BUTTON.x, buttonY: BUTTON.y, trapX: TRAP.x, trapY: TRAP.y }];
    const engine = new GameEngine();
    engine.loadLevel(level);
    engine.attemptPlayerMove('E');
    return engine;
  }

  const bugAndBlock = (engine: GameEngine): { bug: Cell[]; block: Cell[] } => ({ bug: cellsOfType(BUG)(engine), block: cellsOfType(DIRT_BLOCK)(engine) });

  it.each([
    ['cc' as const, [[7, 8], [7, 8], [7, 8], [7, 8], [7, 7], [7, 7]]],
    ['native' as const, [[6, 8], [6, 8], [6, 8], [6, 8], [6, 8], [7, 8]]],
    ['cc2' as const, [[6, 8], [6, 8], [6, 8], [6, 8], [7, 8], [7, 8]]]
  ])('plays the bug of the %s room cell by cell', (mode, bugCells) => {
    const engine = trapRoom(mode);
    const seen = sample(engine, {}, [1, 2, 3, 4, 5, 6], bugAndBlock);
    expect(seen).toEqual(bugCells.map((cell) => ({ bug: [cell], block: [[BUTTON.x, BUTTON.y]] })));
  });
});

describe('CC2 wave 31 (g2): a monster press of a brown button is unchanged', () => {
  it('keeps the bug in the trap while the ball walks past the button (Lexy lane w31_bba_ctl_bug)', async () => {
    const engine = await load('bba_ctl_bug', PREFIX_W31);
    const seen = sample(engine, {}, [4, 8, 12], (e) => ({ ball: cellsOfType(BALL)(e), bug: cellsOfType(BUG)(e) }));
    expect(seen).toEqual([
      { ball: [[3, 2]], bug: [[6, 8]] },
      { ball: [[4, 2]], bug: [[6, 8]] },
      { ball: [[5, 2]], bug: [[6, 8]] }
    ]);
  });
});

describe('CC2 wave 31 (g3): two keys with no actor in either cell decide as before', () => {
  it('goes north and keeps going while the ball is elsewhere (Lexy lane w31_pdh_ball_ne_h1_k2)', async () => {
    const engine = await load('pdh_ball_ne_h1_k2', PREFIX_W31);
    const inputs = { ...pressed(['N'], 0), ...heldTics(['N', 'E'], 6, 17) };
    const seen = sample(engine, inputs, [6, 7, 10], playerAnd(BALL));
    expect(seen).toEqual([
      { player: [5, 6, 'N'], others: [[4, 5, 'E']] },
      { player: [5, 5, 'N'], others: [[4, 5, 'E']] },
      { player: [5, 5, 'N'], others: [[3, 5, 'W']] }
    ]);
  });
});
