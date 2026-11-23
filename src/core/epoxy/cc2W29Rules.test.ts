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
 * CC2 wave 29: a monster's green button press toggles the walls after the Lexy frame its step ends in (rows a, a2, b, c, c2); a monster
 * or a bowling ball entering the green teleporter goes through when its step ends, at that frame (rows d, f, g); a failed green jump
 * spends the next decision (row e); a ghost is barred by a no-sign over a tool it holds (row h) and bonks round at once on ice unless
 * it holds cleats (rows i, i2, j). Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefix w29_).
 *
 * tick() k plays the Lexy tic k - 1, so "after N ticks" is the end of Lexy tic N - 1; an input of Lexy tic t is given before the
 * tick() call t + 1. The values of the rows are the end-of-tic values of the Lexy lane named next to each case (actor oracle); the
 * K cases are engine invariants (CC1 and native rooms, blocks, the snapshot round trip, the hidden key).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';
import { droppedActorId } from './epoxyRollingBall';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const LANE_PREFIX = 'w29_';
const BALL_TYPE = 'rolling_ball';
const WALL_CLOSED = 'toggle_wall_closed';
const WALL_OPEN = 'toggle_wall_open';
/** The cell of the toggle wall on the w29_gtf_* lanes: (x, y). */
const LANE_WALL = { x: 10, y: 5 };
type Input = Direction | 'drop';
/** The tick() calls an input comes before (1-based). */
type Inputs = Readonly<Record<number, Input>>;
type Cell = [number, number];
type Placed = [number, number, Direction];

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

async function load(lane: string): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, LANE_PREFIX), SEED);
  return engine;
}

/** The id of the bowling ball the player holds. */
function heldBall(engine: GameEngine): string {
  const id = Object.keys(world(engine).player.keys).find((key) => droppedActorId(key) !== undefined);
  if (id === undefined) throw new Error('the player holds no bowling ball');
  return id;
}

/** Plays the tick() calls `from` + 1 to `ticks`; an input of the map is given before the call it names. */
function play(engine: GameEngine, inputs: Inputs, ticks: number, from = 0): void {
  for (let call = from + 1; call <= ticks; call++) {
    const input = inputs[call];
    if (input === 'drop') engine.dropItem(heldBall(engine));
    else if (input !== undefined) engine.attemptPlayerMoveHeld([input]);
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

/** An input held every tic from tic 0 to the tick() call `until`. */
function held(dir: Direction, until: number): Inputs {
  const inputs: Record<number, Input> = {};
  for (let call = 1; call <= until; call++) inputs[call] = dir;
  return inputs;
}

const uidCell = (uid: number) => (engine: GameEngine): Cell => {
  const e = engine.getEntities().find((entity) => entity.uid === uid);
  if (e === undefined) throw new Error(`no entity ${uid}`);
  return [e.x, e.y];
};

const uidPlaced = (uid: number) => (engine: GameEngine): Placed => {
  const e = engine.getEntities().find((entity) => entity.uid === uid);
  if (e === undefined) throw new Error(`no entity ${uid}`);
  return [e.x, e.y, e.dir];
};

/** The cell of an entity at each tick, and its facing where the case lists one (a missing facing is not asserted). */
function expectPlaced(engine: GameEngine, inputs: Inputs, ticks: readonly number[], uid: number, expected: ReadonlyArray<readonly [number, number, Direction?]>): void {
  const seen = sample(engine, inputs, ticks, uidPlaced(uid));
  expect(seen.map(([x, y]) => [x, y])).toEqual(expected.map(([x, y]) => [x, y]));
  expected.forEach(([, , dir], i) => {
    if (dir !== undefined) expect(seen[i][2]).toBe(dir);
  });
}

const ballCell = (engine: GameEngine): Cell | null => {
  const e = engine.getEntities().find((entity) => entity.type === BALL_TYPE);
  return e === undefined ? null : [e.x, e.y];
};

const ballPlaced = (engine: GameEngine): Placed | null => {
  const e = engine.getEntities().find((entity) => entity.type === BALL_TYPE);
  return e === undefined ? null : [e.x, e.y, e.dir];
};

const wallOf = (engine: GameEngine): string => engine.getTerrain()[LANE_WALL.y][LANE_WALL.x];

const DROP_AT_6: Inputs = { 1: 'E', 7: 'drop' };
const OBSERVER = 3;
const HELD_BALL = 2;
/** How many tick() calls the k3 and k4 cases look for a pending arrival, and how many they play after the capture. */
const MAX_CALLS = 40;
const AFTER_CALLS = 6;

describe('CC2 wave 29 (a, a2): a monster press of the green button toggles after the frame its step ends in', () => {
  it('lets the observer ball meet the held ball for a tic more (Lexy lane w29_gtf_walk_k2_j2)', async () => {
    const engine = await load('gtf_walk_k2_j2');
    expectPlaced(engine, held('E', 13), [8, 9, 10, 13], OBSERVER, [[10, 7], [10, 8, 'S'], [10, 8], [10, 9]]);
  });

  it('moves the held ball on when the wall opens, one tic after the observer turned (same lane)', async () => {
    const engine = await load('gtf_walk_k2_j2');
    expect(sample(engine, held('E', 9), [8, 9], uidCell(HELD_BALL))).toEqual([
      [10, 6],
      [10, 5]
    ]);
  });

  it('toggles the wall at Lexy t8f1: closed after tick 8, open after tick 9 (same lane)', async () => {
    const engine = await load('gtf_walk_k2_j2');
    expect(sample(engine, held('E', 9), [8, 9], wallOf)).toEqual([WALL_CLOSED, WALL_OPEN]);
  });
});

describe('CC2 wave 29 (b, c): the press of a step that ends in frame 0 or 1 of a slide, and two presses', () => {
  it('reverses the observer at the same tics on the slide path (Lexy lane w29_gtf_slide_n2_j2)', async () => {
    const engine = await load('gtf_slide_n2_j2');
    expect(sample(engine, held('E', 13), [8, 9, 13], uidCell(OBSERVER))).toEqual([
      [10, 7],
      [10, 8],
      [10, 9]
    ]);
  });

  it('applies both presses of the pair at their frames (Lexy lane w29_gtf_pair_d1_j2)', async () => {
    const engine = await load('gtf_pair_d1_j2');
    expect(sample(engine, held('E', 13), [9, 13], uidCell(4))).toEqual([
      [10, 8],
      [10, 9]
    ]);
  });
});

describe('CC2 wave 29 (c2): a clone released by a pass-start press ends its step in frame 0', () => {
  it('lets the walking ball enter the cell the toggle vacated (Lexy lane w29_gtfclone_f2_j4)', async () => {
    const engine = await load('gtfclone_f2_j4');
    expectPlaced(engine, {}, [12, 13], 3, [[11, 8], [10, 8, 'W']]);
    const walking = await load('gtfclone_f2_j4');
    expectPlaced(walking, {}, [12, 13], 4, [[12, 8], [11, 8, 'W']]);
  });
});

describe('CC2 wave 29 (d): a monster on the green pad goes through when its step ends', () => {
  it('holds the walker on the entry pad until the step end, then exits (Lexy lane w29_grt_walk_p2_k2)', async () => {
    const engine = await load('grt_walk_p2_k2');
    expectPlaced(engine, {}, [5, 8, 9, 12], 1, [[4, 2], [4, 2], [9, 6, 'W'], [9, 6]]);
  });
});

describe('CC2 wave 29 (e): a failed green jump spends the next decision', () => {
  it('keeps the ball on its way back one decision later (Lexy lane w29_grt_clog_b_k1)', async () => {
    const engine = await load('grt_clog_b_k1');
    expect(sample(engine, {}, [5, 9, 13], uidCell(1))).toEqual([
      [3, 2],
      [2, 2],
      [1, 2]
    ]);
  });
});

describe('CC2 wave 29 (f, g): a bowling ball set down toward a green pad', () => {
  it('goes through when its step ends, on a level without actor order (Lexy lane w29_grt_drop_g0_p2_d6)', async () => {
    const engine = await load('grt_drop_g0_p2_d6');
    expect(world(engine).cc2ActorOrder).not.toBe(true);
    const seen = sample(engine, DROP_AT_6, [7, 10, 11, 12], ballPlaced);
    expect(seen.map((ball) => ball?.slice(0, 2))).toEqual([[4, 4], [4, 4], [5, 7], [5, 7]]);
    expect(seen[2]?.[2]).toBe('W');
  });

  it('goes through when its step ends, with actor order (Lexy lane w29_grt_drop_g0_p1_d6)', async () => {
    const engine = await load('grt_drop_g0_p1_d6');
    expect(world(engine).cc2ActorOrder).toBe(true);
    expect(sample(engine, DROP_AT_6, [7, 11], ballCell)).toEqual([
      [4, 4],
      [5, 7]
    ]);
  });
});

describe('CC2 wave 29 (h): a no-sign over a tool bars a ghost that holds the tool', () => {
  it('is barred by the flippers no-sign it holds (Lexy lane w29_gns_flippers_take)', async () => {
    const engine = await load('gns_flippers_take');
    expectPlaced(engine, {}, [20, 21, 25], 1, [[7, 2], [7, 1, 'N'], [7, 0]]);
  });
});

describe('CC2 wave 29 (i, i2, j): a ghost bonks round at once on ice unless it holds cleats', () => {
  it('turns round at the bump and walks back in the same decision (Lexy lane w29_gib_plain_k2)', async () => {
    const engine = await load('gib_plain_k2');
    expectPlaced(engine, {}, [12, 13, 16, 17], 1, [[5, 4], [4, 4, 'W'], [4, 4], [3, 4]]);
  });

  it('decides on the cell ahead when it decides, not when it moves (Lexy lane w29_gibv_before)', async () => {
    const engine = await load('gibv_before');
    expectPlaced(engine, {}, [1, 5], 1, [[4, 4, 'W'], [3, 4, 'W']]);
  });

  it('keeps facing the wall with cleats on (Lexy lane w29_gib_cleats_k2)', async () => {
    const engine = await load('gib_cleats_k2');
    expectPlaced(engine, {}, [13, 17], 1, [[5, 4, 'E'], [5, 4, 'E']]);
  });
});

describe('CC2 wave 29 (k1): a block on a pad stays on it until its step ends (wave 30)', () => {
  const PAD_X = 3;
  const GREEN_PAD = 'teleport_random';
  const UNFLAGGED_PAD = 'teleport_green';

  function pushOnto(pad: string): GameEngine {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode: 'cc2',
        startX: 1,
        terrain: { [`${PAD_X},${ROOM_ROW}`]: pad, [`9,${ROOM_ROW}`]: pad },
        entities: [{ type: 'dirt_block', x: 2, y: ROOM_ROW, dir: 'E' }]
      })
    );
    expect(engine.attemptPlayerMove('E')).toBe(true);
    return engine;
  }

  it.each([GREEN_PAD, UNFLAGGED_PAD])('stays on the pad until its step ends, queuing no teleport for its own turn (%s)', (pad) => {
    const engine = pushOnto(pad);
    engine.tick();
    const block = engine.getEntities().find((e) => e.type === 'dirt_block');
    expect(block?.x).toBe(PAD_X);
    // The block's teleport runs from its deferred arrival, never from a queued teleport.
    expect(world(engine).ccArrivals.filter((a) => a.teleport === true)).toEqual([]);
  });
});

describe('CC2 wave 29 (k2): CC1 and native rooms keep the old green rules', () => {
  const BUTTON_X = 6;
  const WALL_CELL = { x: 3, y: 3 };
  const WATCH_TICKS = 30;

  function toggleTick(mode: 'cc' | 'native'): { tick: number; arrival: number } {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode,
        startX: 1,
        terrain: { [`${BUTTON_X},${ROOM_ROW}`]: 'button_green', [`${BUTTON_X + 1},${ROOM_ROW}`]: 'wall', [`${WALL_CELL.x},${WALL_CELL.y}`]: WALL_CLOSED },
        entities: [{ type: 'pink_ball', x: BUTTON_X - 1, y: ROOM_ROW, dir: 'E' }]
      })
    );
    let tick = 0;
    let arrival = 0;
    for (let i = 1; i <= WATCH_TICKS && tick === 0; i++) {
      engine.tick();
      if (arrival === 0 && (engine.getEntities().find((e) => e.type === 'pink_ball')?.x ?? 0) > BUTTON_X - 1) arrival = i;
      if (engine.getTerrain()[WALL_CELL.y][WALL_CELL.x] === WALL_OPEN) tick = i;
    }
    return { tick, arrival };
  }

  it('applies a monster press of the green button with the old timing', () => {
    expect(toggleTick('cc')).toEqual({ tick: 4, arrival: 1 });
    expect(toggleTick('native')).toEqual({ tick: 6, arrival: 6 });
  });

  it.each(['cc', 'native'] as const)('jumps a monster on the green pad at the start of its step (%s room)', (mode) => {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode,
        startX: 11,
        terrain: { [`3,${ROOM_ROW}`]: 'teleport_random', [`9,${ROOM_ROW}`]: 'teleport_random' },
        entities: [{ type: 'walker', x: 2, y: ROOM_ROW, dir: 'E' }]
      })
    );
    const walkerX = (): number => engine.getEntities().find((e) => e.type === 'walker')?.x ?? -1;
    for (let i = 0; i < 12 && walkerX() === 2; i++) engine.tick();
    expect(walkerX()).not.toBe(2);
    expect(walkerX()).not.toBe(3);
    expect(world(engine).ccArrivals.filter((a) => a.teleport === true)).toEqual([]);
  });
});

describe('CC2 wave 29 (k3): a snapshot round trip keeps a pending green press and a pending green jump', () => {
  /** Plays until `pending` holds, captures the state, plays on and reads; restores and plays the same again. */
  async function roundTrip(lane: string, inputs: Inputs, pending: (engine: GameEngine) => boolean, read: (engine: GameEngine) => unknown): Promise<void> {
    const engine = await load(lane);
    let call = 0;
    while (!pending(engine)) {
      if (++call > MAX_CALLS) throw new Error('no pending arrival to capture');
      play(engine, inputs, call, call - 1);
    }
    const start = call;
    const snap = engine.captureState();
    const arrivals = JSON.stringify(world(engine).ccArrivals);
    const key = cc2HiddenStateKey(world(engine));
    const run = (): unknown[] => {
      const reads: unknown[] = [];
      for (let c = start + 1; c <= start + AFTER_CALLS; c++) {
        play(engine, inputs, c, c - 1);
        reads.push(read(engine));
      }
      return reads;
    };
    const reads = run();
    engine.restoreState(snap);
    expect(JSON.stringify(world(engine).ccArrivals)).toBe(arrivals);
    expect(cc2HiddenStateKey(world(engine))).toBe(key);
    expect(run()).toEqual(reads);
  }

  it('keeps a tagged green press', async () => {
    await roundTrip('gtf_walk_k2_j2', held('E', MAX_CALLS + AFTER_CALLS), (e) => world(e).ccArrivals.some((a) => a.cc2EndFrame !== undefined && a.greenPad !== true), (e) => [uidCell(OBSERVER)(e), wallOf(e)]);
  });

  it('keeps a pending green pad jump', async () => {
    await roundTrip('grt_walk_p2_k2', {}, (e) => world(e).ccArrivals.some((a) => a.greenPad === true), uidCell(1));
  });
});

describe('CC2 wave 29 (k4): the hidden key tells the end frames apart', () => {
  it('differs between a pending green press of end frame 0 and one of end frame 1 at the same due', async () => {
    const engine = await load('gtf_walk_k2_j2');
    let call = 0;
    while (!world(engine).ccArrivals.some((a) => a.cc2EndFrame !== undefined && a.greenPad !== true)) {
      if (++call > MAX_CALLS) throw new Error('no pending green press');
      play(engine, held('E', MAX_CALLS + AFTER_CALLS), call, call - 1);
    }
    const press = world(engine).ccArrivals.find((a) => a.cc2EndFrame !== undefined && a.greenPad !== true);
    if (press === undefined) throw new Error('no pending green press');
    const keys = ([0, 1, 2] as const).map((frame) => {
      press.cc2EndFrame = frame;
      return cc2HiddenStateKey(world(engine));
    });
    expect(new Set(keys).size).toBe(3);
  });

  it('differs between a green pad jump and a blue pad jump at the same due', async () => {
    const engine = await load('grt_walk_p2_k2');
    let call = 0;
    while (!world(engine).ccArrivals.some((a) => a.greenPad === true)) {
      if (++call > MAX_CALLS) throw new Error('no pending green jump');
      play(engine, {}, call, call - 1);
    }
    const jump = world(engine).ccArrivals.find((a) => a.greenPad === true);
    if (jump === undefined) throw new Error('no pending green jump');
    const green = cc2HiddenStateKey(world(engine));
    delete jump.greenPad;
    delete jump.cc2EndFrame;
    expect(cc2HiddenStateKey(world(engine))).not.toBe(green);
  });
});
