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
 * CC2 wave 30: a flame jet that lights spares what stands on real fire (row a); a block entering a teleporter goes through when its
 * step ends and takes its exit step (rows b, c, d, d2, e, e2); a yellow tank steps onto ice at the sliding pace (row f); a monster
 * loaded on ice decides with its whole preference list, from the facing the ice corner turned (rows g, h, h2, h3); a yellow press made
 * by a monster lands when its step ends, after a press made in between (row i); a monster a trap ejects presses when its step ends
 * (row j). Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w30_ and w30r2_).
 *
 * tick() k plays the Lexy tic k - 1, so "after N ticks" is the end of Lexy tic N - 1; an input of Lexy tic t is given before the
 * tick() call t + 1. The values of the rows are the end-of-tic values of the Lexy lane named next to each case (actor oracle); the
 * K cases are engine invariants (CC1 and native rooms, the unpowered red pad, the snapshot round trip, the hidden key).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction } from '../types';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const LANE_PREFIX = 'w30_';
const LANE_PREFIX_R2 = 'w30r2_';
const ICE_BLOCK = 'ice_block';
const DIRT_BLOCK = 'dirt_block';
const FIREBALL = 'fireball';
const TANK_UID = 2;
const MONSTER_UID = 1;
const YTI_TANK_UID = 1;
const MAX_CALLS = 40;
const AFTER_CALLS = 6;
type Inputs = Readonly<Record<number, Direction>>;
type Cell = [number, number];
type Placed = [number, number, Direction];

const world = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

async function load(lane: string, prefix: string = LANE_PREFIX): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  return engine;
}

/** Plays the tick() calls `from` + 1 to `ticks`; an input of the map is given before the call it names. */
function play(engine: GameEngine, inputs: Inputs, ticks: number, from = 0): void {
  for (let call = from + 1; call <= ticks; call++) {
    const input = inputs[call];
    if (input !== undefined) engine.attemptPlayerMoveHeld([input]);
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

/** The inputs of the Lexy tics `tics` (each one before the tick() call tic + 1). */
function pressed(dir: Direction, ...tics: number[]): Inputs {
  return Object.fromEntries(tics.map((tic) => [tic + 1, dir]));
}

/** An input held every tic from Lexy tic `fromTic` to the tick() call `until`. */
function heldFrom(dir: Direction, fromTic: number, until: number): Inputs {
  const inputs: Record<number, Direction> = {};
  for (let call = fromTic + 1; call <= until; call++) inputs[call] = dir;
  return inputs;
}

const playerCell = (engine: GameEngine): Cell => [engine.getPlayer().x, engine.getPlayer().y];

/** The cells of the entities of a type, in uid order. */
const cellsOfType = (type: string) => (engine: GameEngine): Cell[] =>
  engine
    .getEntities()
    .filter((e) => e.type === type)
    .sort((a, b) => a.uid - b.uid)
    .map((e) => [e.x, e.y]);

const uidPlaced = (uid: number) => (engine: GameEngine): Placed => {
  const e = engine.getEntities().find((entity) => entity.uid === uid);
  if (e === undefined) throw new Error(`no entity ${uid}`);
  return [e.x, e.y, e.dir];
};

const uidCell = (uid: number) => (engine: GameEngine): Cell => {
  const e = engine.getEntities().find((entity) => entity.uid === uid);
  if (e === undefined) throw new Error(`no entity ${uid}`);
  return [e.x, e.y];
};

const blockAndPlayer = (type: string) => (engine: GameEngine): { player: Cell; blocks: Cell[] } => ({
  player: playerCell(engine),
  blocks: cellsOfType(type)(engine)
});

describe('CC2 wave 30 (a): a flame jet that lights spares an entity standing on real fire', () => {
  it('lets the ice block pushed onto real fire melt on its arrival, and holds the player (Lexy lane w30_rfs_walk_k2_e1)', async () => {
    const engine = await load('rfs_walk_k2_e1');
    const seen = sample(engine, heldFrom('E', 1, 13), [9, 10, 13], blockAndPlayer(ICE_BLOCK));
    expect(seen[0].blocks).toEqual([[4, 3]]);
    expect(seen[1]).toEqual({ player: [3, 3], blocks: [] });
    expect(seen[2]).toEqual({ player: [3, 3], blocks: [] });
  });
});

describe('CC2 wave 30 (b, c, d, d2): a block entering a teleporter goes through when its step ends', () => {
  it('holds the pushed ice block on the red pad through its step, then melts it on the exit fire (Lexy lane w30_btp_red_fire_d0)', async () => {
    const engine = await load('btp_red_fire_d0');
    expect(sample(engine, { ...pressed('E', 0), ...pressed('N', 8) }, [1, 4, 5, 6], cellsOfType(ICE_BLOCK))).toEqual([
      [[4, 4]],
      [[4, 4]],
      [[11, 7]],
      [[11, 7]]
    ]);
  });

  it('teleports the first block of a chain push at its step end and melts it on the exit fire (Lexy lane w30_btp_chainw_red_fire)', async () => {
    const engine = await load('btp_chainw_red_fire');
    expect(sample(engine, pressed('W', 0), [1, 5, 9], cellsOfType(ICE_BLOCK))).toEqual([
      [[8, 4], [9, 4]],
      [[2, 8], [9, 4]],
      [[9, 4]]
    ]);
  });

  it('teleports a block that slid onto the pad at its step end (Lexy lane w30_btp_slide_red_n1)', async () => {
    const engine = await load('btp_slide_red_n1');
    expect(sample(engine, pressed('E', 0), [3, 8, 12], cellsOfType(ICE_BLOCK))).toEqual([[[5, 4]], [[11, 7]], []]);
  });

  it('takes the exit frame from the pre-pass for a block a slider pushed onto the pad (Lexy lane w30r2_btp_slider_red_n1_fire)', async () => {
    const engine = await load('btp_slider_red_n1_fire', LANE_PREFIX_R2);
    expect(sample(engine, pressed('E', 0), [3, 5, 7], cellsOfType(ICE_BLOCK))).toEqual([
      [[5, 4], [6, 4]],
      [[5, 4], [6, 4]],
      [[5, 4], [13, 8]]
    ]);
  });
});

describe('CC2 wave 30 (e, e2): the player lands on the pad beside a block whose exit step ends first', () => {
  it('judges the exit block as at rest when its arrival ends in frame 0, and pushes it (Lexy lane w30_btp_follow_blue_g0)', async () => {
    const engine = await load('btp_follow_blue_g0');
    expect(sample(engine, pressed('E', 0, 4, 8, 12), [9, 13], blockAndPlayer(DIRT_BLOCK))).toEqual([
      { player: [11, 7], blocks: [[12, 7]] },
      { player: [12, 7], blocks: [[13, 7]] }
    ]);
  });

  it('judges the exit block as at rest when its arrival ends in frame 1 listed after the player (Lexy lane w30r2_btp_followice_blue_g2)', async () => {
    const engine = await load('btp_followice_blue_g2', LANE_PREFIX_R2);
    expect(sample(engine, pressed('E', 0, 6, 10, 14, 18), [11, 14], blockAndPlayer(DIRT_BLOCK))).toEqual([
      { player: [11, 7], blocks: [[12, 7]] },
      { player: [11, 7], blocks: [[12, 7]] }
    ]);
  });
});

describe('CC2 wave 30 (f): a yellow tank steered onto ice steps at the sliding pace', () => {
  it('reaches the next cell a tic sooner on each step (Lexy lane w30_yti_ice_n3_d0)', async () => {
    const engine = await load('yti_ice_n3_d0');
    expect(sample(engine, pressed('S', 0), [5, 7, 9], uidCell(YTI_TANK_UID))).toEqual([
      [6, 4],
      [6, 5],
      [6, 6]
    ]);
  });
});

describe('CC2 wave 30 (g, h, h2, h3): a monster loaded on ice decides with its whole preference list', () => {
  it('bonks and slides off its load cell instead of staying put (Lexy lane w30_lcm_glider_ice_nw_k1)', async () => {
    const engine = await load('lcm_glider_ice_nw_k1');
    expect(sample(engine, {}, [1, 5, 9], uidPlaced(MONSTER_UID))).toEqual([
      [1, 4, 'S'],
      [2, 4, 'E'],
      [2, 4, 'E']
    ]);
  });

  it('turns the glider by the ice corner before its decision (Lexy lane w30_lcm_glider_ice_nw_k0)', async () => {
    const engine = await load('lcm_glider_ice_nw_k0');
    expect(sample(engine, {}, [1, 2, 6], uidPlaced(MONSTER_UID))).toEqual([
      [1, 4, 'S'],
      [2, 4, 'E'],
      [3, 4, 'E']
    ]);
  });

  it('takes the first open way of the list for a glider on plain ice (Lexy lane w30r2_lcm_glider_ice_opens)', async () => {
    const engine = await load('lcm_glider_ice_opens', LANE_PREFIX_R2);
    expect(sample(engine, {}, [1, 5], uidPlaced(MONSTER_UID))).toEqual([
      [2, 5, 'S'],
      [2, 6, 'S']
    ]);
  });

  it('takes the first open way of the list for a bug on plain ice (Lexy lane w30r2_lcm_bug_ice_openn)', async () => {
    const engine = await load('lcm_bug_ice_openn', LANE_PREFIX_R2);
    expect(sample(engine, {}, [1, 5], uidPlaced(MONSTER_UID))).toEqual([
      [2, 3, 'N'],
      [1, 3, 'W']
    ]);
  });
});

describe('CC2 wave 30 (i): a monster press of the yellow button lands when its step ends', () => {
  it('keeps the ball press over the player press made in between (Lexy lane w30_ybo_k2_d1)', async () => {
    const engine = await load('ybo_k2_d1');
    expect(sample(engine, pressed('S', 1), [9, 10, 13], uidPlaced(TANK_UID))).toEqual([
      [10, 10, 'S'],
      [11, 10, 'E'],
      [11, 10, 'E']
    ]);
  });
});

describe('CC2 wave 30 (j): a monster a trap ejects presses when its step ends', () => {
  it('spawns the clone when the ball arrives on the red button, not when it steps out (Lexy lane w30_oop_near_d0)', async () => {
    const engine = await load('oop_near_d0');
    const fireballs = (e: GameEngine): Placed[] =>
      e
        .getEntities()
        .filter((entity) => entity.type === FIREBALL)
        .sort((a, b) => a.uid - b.uid)
        .map((entity) => [entity.x, entity.y, entity.dir]);
    const seen = sample(engine, pressed('S', 0), [5, 8, 9], fireballs);
    const cells = (placed: Placed[]): Cell[] => placed.map(([x, y]): Cell => [x, y]).sort((a, b) => a[0] - b[0]);
    expect(cells(seen[0])).toEqual([[9, 9]]);
    expect(cells(seen[1])).toEqual([[9, 9]]);
    expect(cells(seen[2])).toEqual([[8, 9], [9, 9]]);
    expect(seen[2].find(([x]) => x === 8)?.[2]).toBe('W');
  });
});

describe('CC2 wave 30 (k1): other engines and the unpowered red pad keep the step-start jump of a block', () => {
  const PAD_X = 3;
  const EXIT_X = 9;
  const UNPOWERED_RED_PAD = 'teleport_red_cc2_off';

  function pushOnto(mode: 'cc' | 'native' | 'cc2', pad: string): GameEngine {
    const engine = new GameEngine();
    engine.loadLevel(
      room({
        mode,
        startX: 1,
        terrain: { [`${PAD_X},${ROOM_ROW}`]: pad, [`${EXIT_X},${ROOM_ROW}`]: pad },
        entities: [{ type: DIRT_BLOCK, x: 2, y: ROOM_ROW, dir: 'E' }]
      })
    );
    expect(engine.attemptPlayerMove('E')).toBe(true);
    return engine;
  }

  const blockX = (engine: GameEngine): number | undefined => engine.getEntities().find((e) => e.type === DIRT_BLOCK)?.x;

  it.each(['cc', 'native'] as const)('jumps a block pushed onto a pad in the tick it is pushed (%s room)', (mode) => {
    const engine = pushOnto(mode, 'teleport_random');
    engine.tick();
    expect(blockX(engine)).not.toBe(PAD_X);
  });

  it('keeps the old path for a block pushed onto the unpowered red pad of a CC2 level', () => {
    const engine = pushOnto('cc2', UNPOWERED_RED_PAD);
    engine.tick();
    // The pad acts at once: the block is already past it (a wired pad holds it until its step ends, next case).
    expect(blockX(engine)).toBe(PAD_X + 1);
    expect(world(engine).ccArrivals.filter((a) => a.teleport === true)).toEqual([]);
  });

  it('holds a block pushed onto a wired CC2 pad until its step ends', () => {
    const engine = pushOnto('cc2', 'teleport_random');
    engine.tick();
    expect(blockX(engine)).toBe(PAD_X);
  });
});

describe('CC2 wave 30 (k2, k3): a queued yellow press survives a snapshot and is part of the hidden key', () => {
  const queueOf = (engine: GameEngine) => engine.getEntities().find((e) => e.uid === TANK_UID)?.cc2SteerQueue;

  /** Plays the lane until the tank holds a queued press. */
  async function untilQueued(): Promise<{ engine: GameEngine; call: number }> {
    const engine = await load('ybo_k2_d1');
    let call = 0;
    while ((queueOf(engine)?.length ?? 0) === 0) {
      if (++call > MAX_CALLS) throw new Error('no queued press to capture');
      play(engine, pressed('S', 1), call, call - 1);
    }
    return { engine, call };
  }

  it('plays the same tank positions after a restore between the press and its due', async () => {
    const { engine, call } = await untilQueued();
    const snap = engine.captureState();
    const key = cc2HiddenStateKey(world(engine));
    const run = (): Placed[] => {
      const reads: Placed[] = [];
      for (let c = call + 1; c <= call + AFTER_CALLS; c++) {
        play(engine, pressed('S', 1), c, c - 1);
        reads.push(uidPlaced(TANK_UID)(engine));
      }
      return reads;
    };
    const reads = run();
    engine.restoreState(snap);
    expect(cc2HiddenStateKey(world(engine))).toBe(key);
    expect(queueOf(engine)?.length).toBeGreaterThan(0);
    expect(run()).toEqual(reads);
  });

  it('does not share the queue array between the live tank and its snapshot', async () => {
    const { engine } = await untilQueued();
    const snap = engine.captureState();
    const live = queueOf(engine);
    if (live === undefined) throw new Error('no queue');
    live[0].due += 5;
    engine.restoreState(snap);
    expect(queueOf(engine)?.[0].due).not.toBe(live[0].due);
  });

  it('tells a tank with a queued press from one without, and two dues apart', async () => {
    const { engine } = await untilQueued();
    const tank = engine.getEntities().find((e) => e.uid === TANK_UID);
    if (tank?.cc2SteerQueue === undefined) throw new Error('no queue');
    const queued = cc2HiddenStateKey(world(engine));
    tank.cc2SteerQueue[0].due += 1;
    const later = cc2HiddenStateKey(world(engine));
    const queue = tank.cc2SteerQueue;
    delete tank.cc2SteerQueue;
    const without = cc2HiddenStateKey(world(engine));
    tank.cc2SteerQueue = queue;
    expect(new Set([queued, later, without]).size).toBe(3);
  });
});
