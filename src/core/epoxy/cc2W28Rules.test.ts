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
 * CC2 wave 28: a bowling ball set down that rolls onto a teleporter goes through when its first step ends (rows a, c); on a level
 * without actor order the ball set down by a drop is counted down from the frame-2 decision (rows b, c); teeth leave a teleporter pad
 * at once whatever their window (row d); a block or a monster other than a ghost standing on a plain bomb when the level starts is
 * blown up at load (rows e, f, g, h1 to h5). Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefix w28_).
 *
 * tick() k plays the Lexy tic k - 1, so "after N ticks" is the end of Lexy tic N - 1; an input of Lexy tic t is given before the
 * tick() call t + 1. The values of the rows are the end-of-tic values of the Lexy lane named next to each case (actor oracle),
 * except where a case says it asserts Epoxy's own value. The G cases are engine invariants (values of the real engine, not Lexy): the
 * gates of the rules (CC1 levels, green pad, uid scope, blocked exit, undo and restart).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Direction, RuntimeEntity } from '../types';
import { droppedActorId } from './epoxyRollingBall';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const LANE_PREFIX = 'w28_';
const BALL_TYPE = 'rolling_ball';
const TEETH_TYPE = 'teeth';
const PLAIN_BOMB = 'bomb';
/** What an input of a case can be: a held direction, or the drop of the bowling ball held. */
type Input = Direction | 'drop';
/** The tick() calls an input comes before (1-based). */
type Inputs = Readonly<Record<number, Input>>;
type Cell = [number, number];

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

/** The cell of the first entity of a type, or null. */
function cellOf(engine: GameEngine, type: string): Cell | null {
  const e = engine.getEntities().find((entity: RuntimeEntity) => entity.type === type);
  return e === undefined ? null : [e.x, e.y];
}

const player = (engine: GameEngine): Cell => [engine.getPlayer().x, engine.getPlayer().y];

/** Plays on from tick `from` to each tick of `ticks` (in order) and reads `read` there. */
function sample<T>(engine: GameEngine, inputs: Inputs, ticks: readonly number[], read: (engine: GameEngine) => T, from = 0): T[] {
  const out: T[] = [];
  let at = from;
  for (const tick of ticks) {
    play(engine, inputs, tick, at);
    at = tick;
    out.push(read(engine));
  }
  return out;
}

const DROP_AT_6: Inputs = { 1: 'E', 7: 'drop' };
const EAST_FROM_0_TO_7: Inputs = { 1: 'E', 2: 'E', 3: 'E', 4: 'E', 5: 'E', 6: 'E', 7: 'E', 8: 'E' };

describe('CC2 wave 28 (a): a ball set down onto a teleporter goes through when its first step ends', () => {
  it('lands on the destination pad at the step end, not at the drop (Lexy lane w28_rbt_blue_g0_p1_d6)', async () => {
    const engine = await load('rbt_blue_g0_p1_d6');
    // k10 is Epoxy's own value: the end-of-tick view of Lexy's t10f0 landing (Lexy shows (4,4) there).
    expect(sample(engine, DROP_AT_6, [8, 10, 11, 15], (e) => cellOf(e, BALL_TYPE))).toEqual([
      [4, 4],
      [6, 7],
      [7, 7],
      [8, 7]
    ]);
    expect(player(engine)).toEqual([3, 4]);
  });
});

describe('CC2 wave 28 (b): on a level without actor order the dropped ball is counted down from the frame-2 decision', () => {
  it('rolls its second step one tick later (Lexy lane w28_fdc_p2_d6)', async () => {
    const engine = await load('fdc_p2_d6');
    expect(world(engine).cc2ActorOrder).not.toBe(true);
    expect(sample(engine, DROP_AT_6, [10, 11, 14, 15], (e) => cellOf(e, BALL_TYPE))).toEqual([
      [4, 4],
      [5, 4],
      [5, 4],
      [6, 4]
    ]);
  });
});

describe('CC2 wave 28 (c): both rules together', () => {
  it('goes through the pad at the step end and keeps the one-tick delay (Lexy lane w28_rbt_yellow_g0_p2_d6)', async () => {
    const engine = await load('rbt_yellow_g0_p2_d6');
    expect(sample(engine, DROP_AT_6, [10, 11, 14, 15], (e) => cellOf(e, BALL_TYPE))).toEqual([
      [4, 4],
      [7, 7],
      [7, 7],
      [8, 7]
    ]);
  });
});

describe('CC2 wave 28 (d): teeth leave a teleporter pad at once whatever their window', () => {
  it('takes the forced exit step in the tic after the teleport (Lexy lane w28_ttx_x5_w0)', async () => {
    const engine = await load('ttx_x5_w0');
    expect(sample(engine, {}, [24, 25, 27, 28], (e) => cellOf(e, TEETH_TYPE))).toEqual([
      [5, 7],
      [5, 7],
      [5, 7],
      [6, 7]
    ]);
  });
});

describe('CC2 wave 28 (e, f, g): an actor standing on a plain bomb when the level starts', () => {
  it('blows up a block and takes the bomb with it (Lexy lane w28_lbo_dirt_block)', async () => {
    const engine = await load('lbo_dirt_block');
    play(engine, {}, 1);
    expect(engine.getEntities()).toEqual([]);
    expect(world(engine).items[5][5]).toBeNull();
    play(engine, {}, 2, 1);
    expect(engine.getEntities()).toEqual([]);
  });

  it('removes a monster and the bomb (Lexy lane w28_lbo_glider)', async () => {
    const engine = await load('lbo_glider');
    play(engine, {}, 1);
    expect(engine.getEntities()).toEqual([]);
    expect(world(engine).items[5][6]).toBeNull();
    play(engine, {}, 2, 1);
    expect(engine.getEntities()).toEqual([]);
  });

  it('spares a ghost (Lexy lane w28_lbo_ghost)', async () => {
    const engine = await load('lbo_ghost');
    expect(sample(engine, {}, [1, 2], (e) => cellOf(e, 'ghost'))).toEqual([
      [6, 5],
      [6, 5]
    ]);
  });
});

describe('CC2 wave 28 (h1, h2): the green bomb has no stand effect', () => {
  it('keeps a block on a green bomb (Lexy lane w28_lbo_green_bomb_dirt_block)', async () => {
    const engine = await load('lbo_green_bomb_dirt_block');
    expect(sample(engine, {}, [1, 5], (e) => cellOf(e, 'dirt_block'))).toEqual([
      [5, 5],
      [5, 5]
    ]);
  });

  it('keeps a monster on a green bomb (Lexy lane w28_lbo_green_bomb_glider)', async () => {
    const engine = await load('lbo_green_bomb_glider');
    expect(sample(engine, {}, [1, 5], (e) => cellOf(e, 'glider'))).toEqual([
      [6, 5],
      [7, 5]
    ]);
  });
});

describe('CC2 wave 28 (h3, h4): the blast comes before any push', () => {
  const EXPECTED: Cell[] = [
    [4, 5],
    [4, 5],
    [5, 5],
    [5, 5]
  ];

  it.each([
    ['w28_lbo_push_p2, no actor order', 'lbo_push_p2'],
    ['w28_lbo_push_p1, actor order', 'lbo_push_p1']
  ])('blows the block up at load and holds the player until its blast ends (Lexy lane %s)', async (_label, lane) => {
    const engine = await load(lane);
    expect(sample(engine, EAST_FROM_0_TO_7, [1, 5, 6, 7], player)).toEqual(EXPECTED);
    expect(engine.getEntities()).toEqual([]);
  });
});

describe('CC2 wave 28 (h5): a monster on a load bomb is gone before the player walks over the cell', () => {
  it('leaves no glider behind (Lexy lane w28_lbo_walk_glider)', async () => {
    const engine = await load('lbo_walk_glider');
    const inputs: Inputs = { 1: 'E', 5: 'E', 9: 'E', 13: 'E' };
    expect(sample(engine, inputs, [1, 13], player)).toEqual([
      [4, 5],
      [7, 5]
    ]);
    expect(engine.getEntities()).toEqual([]);
  });
});

describe('CC2 wave 28 (h6): off the CC2 engine and for the player, nothing changes', () => {
  const BOMB_X = 6;
  const bombCell = `${BOMB_X},${ROOM_ROW}`;

  it.each(['cc', 'native'] as const)('keeps a block on a bomb after load and tick 1 in a %s room', (mode) => {
    const engine = new GameEngine();
    engine.loadLevel(
      room({ mode, startX: 2, items: { [bombCell]: PLAIN_BOMB }, entities: [{ type: 'dirt_block', x: BOMB_X, y: ROOM_ROW, dir: 'W' }] })
    );
    expect(world(engine).items[ROOM_ROW][BOMB_X]).toBe(PLAIN_BOMB);
    engine.tick();
    expect(engine.getEntities().map((e) => e.type)).toContain('dirt_block');
    expect(world(engine).items[ROOM_ROW][BOMB_X]).toBe(PLAIN_BOMB);
  });

  it('never touches a player starting on a bomb', () => {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', startX: BOMB_X, items: { [bombCell]: PLAIN_BOMB } }));
    expect(world(engine).items[ROOM_ROW][BOMB_X]).toBe(PLAIN_BOMB);
    expect(engine.getPlayer().alive).toBe(true);
  });
});

describe('CC2 wave 28 (G1): a CC1 level keeps the old teeth gate', () => {
  it('holds teeth that wait on a destination pad until their window opens', () => {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc', startX: 2, entities: [{ type: TEETH_TYPE, x: 6, y: ROOM_ROW, dir: 'W' }] }));
    play(engine, {}, 5);
    // A teleporter put the teeth on its pad: they leave east, but the window of the teeth is closed from tick 5 to 8.
    const teeth = engine.getEntities().find((e) => e.type === TEETH_TYPE) as RuntimeEntity;
    teeth.teleportExit = 'E';
    const x = teeth.x;
    expect(sample(engine, {}, [6, 7, 8], (e) => cellOf(e, TEETH_TYPE), 5)).toEqual([
      [x, ROOM_ROW],
      [x, ROOM_ROW],
      [x, ROOM_ROW]
    ]);
    play(engine, {}, 9, 8);
    expect(cellOf(engine, TEETH_TYPE)).toEqual([x + 1, ROOM_ROW]);
  });
});

describe('CC2 wave 28 (G2): a ball dropped toward a green pad still jumps when its step starts', () => {
  const GREEN_PAD = 'teleport_random';
  const BLUE_PAD = 'teleport_forward';

  function dropOnto(pad: string): GameEngine {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', startX: 2, terrain: { [`4,${ROOM_ROW}`]: pad, [`9,${ROOM_ROW}`]: pad, [`6,${ROOM_ROW + 3}`]: pad } }));
    // No actor order: the drop is played before the tick, outside the tick flag.
    world(engine).cc2ActorOrder = undefined;
    world(engine).player.keys.hurl_stone = 1;
    expect(engine.dropItem('hurl_stone')).toBe(true);
    return engine;
  }

  it('lands off the green pad at the arrival, while a blue pad holds the ball until its step ends', () => {
    const green = dropOnto(GREEN_PAD);
    play(green, {}, 5);
    expect(cellOf(green, BALL_TYPE)).toEqual([5, 8]);
    const blue = dropOnto(BLUE_PAD);
    play(blue, {}, 7);
    expect(cellOf(blue, BALL_TYPE)).toEqual([4, ROOM_ROW]);
  });
});

describe('CC2 wave 28 (G3): the launch flag does not outlive the drop', () => {
  it('leaves cc2BallLaunchUid undefined after a drop that goes through a pad', async () => {
    const engine = await load('rbt_yellow_g0_p2_d6');
    expect(world(engine).cc2BallLaunchUid).toBeUndefined();
    play(engine, DROP_AT_6, 7);
    expect(world(engine).cc2BallLaunchUid).toBeUndefined();
    expect(cellOf(engine, BALL_TYPE)).toEqual([4, 4]);
  });
});

describe('CC2 wave 28 (G4): a blocked forced exit spends the decision, the next one waits for the window', () => {
  it('keeps the teeth on the landing cell until the window of the next decision', async () => {
    const engine = await load('ttx_x5_w0');
    play(engine, {}, 23);
    // The teeth landed on (4,7) with an exit east; the way out closes before they use it.
    expect(cellOf(engine, TEETH_TYPE)).toEqual([4, 7]);
    world(engine).terrain[7][5] = 'wall';
    expect(sample(engine, {}, [24, 25, 26, 27], (e) => cellOf(e, TEETH_TYPE), 23)).toEqual([
      [4, 7],
      [4, 7],
      [4, 7],
      [4, 7]
    ]);
    play(engine, {}, 28, 27);
    expect(cellOf(engine, TEETH_TYPE)).not.toEqual([4, 7]);
  });
});

describe('CC2 wave 28 (G5): an undo or a restart to tick 0 plays the load blast again', () => {
  it('gives the same world and hidden state as the first load', async () => {
    const level = await loadCc2Lane('lbo_dirt_block', LANE_PREFIX);
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    const first = cc2HiddenStateKey(world(engine));
    play(engine, { 1: 'W', 2: 'W', 3: 'W' }, 6);
    while (engine.undo()) {
      // Back to the state the level started in.
    }
    expect(engine.getEntities()).toEqual([]);
    expect(world(engine).items[5][5]).toBeNull();
    expect(cc2HiddenStateKey(world(engine))).toBe(first);
    engine.loadLevel(level, SEED);
    expect(engine.getEntities()).toEqual([]);
    expect(world(engine).items[5][5]).toBeNull();
    expect(cc2HiddenStateKey(world(engine))).toBe(first);
  });
});

describe('CC2 wave 28 (G6): a ball pushed off a full belt keeps the old timing', () => {
  it('goes through the pad at its step end with no extra count, on a level without actor order', () => {
    const engine = new GameEngine();
    engine.loadLevel(
      room({ mode: 'cc2', startX: 2, items: { [`3,${ROOM_ROW}`]: 'pocket_gate' }, terrain: { [`5,${ROOM_ROW}`]: 'teleport_forward', '9,8': 'teleport_forward' } })
    );
    const w = world(engine);
    w.cc2ActorOrder = undefined;
    // A full belt, the bowling ball the oldest tool: picking up a fifth tool puts the ball down on the player's cell.
    w.player.belt = ['hurl_stone', 'boots_fire', 'boots_pull', 'ward'];
    w.player.keys.hurl_stone = 1;
    w.player.keys.ward = 1;
    w.player.boots.add('boots_fire');
    w.player.boots.add('boots_pull');
    expect(sample(engine, { 1: 'E' }, [4, 6, 7, 8], (e) => cellOf(e, BALL_TYPE))).toEqual([
      [5, ROOM_ROW],
      [5, ROOM_ROW],
      [9, 8],
      [10, 8]
    ]);
    expect(player(engine)).toEqual([3, ROOM_ROW]);
  });
});
