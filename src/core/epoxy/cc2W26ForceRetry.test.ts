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
 * CC2 wave 26: a block refused on a fixed force floor by another actor or block retries in the next frame (frame 0 of the next tic
 * after a main-pass refusal, frame 1 after a frame-0 one) and keeps that frame; turning and random force floors keep the after-pass
 * retry; a block loaded on a fixed force floor first slides in frame 1 of tic 0; a monster refused both ways on ice in a pre-pass
 * frame faces the bounce way. Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w24_ and w26_).
 *
 * tick() k plays the Lexy tic k - 1, so "after N ticks" is the end of Lexy tic N - 1. Every expected value is the end-of-tic value of
 * the Lexy lane named next to it (actor oracle, harness checked). The w26_r7_* lanes need one held east input (the player pushes a
 * ball into the room) before tick() call p + 1, p being the number in the lane name.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 3;
const BALL = 'pink_ball';
const FORCE_CYCLE = 'force_cycle';
const WALL = 'wall';
const DIRT_BLOCK = 'dirt_block';
const LANE_PREFIX = 'w26_';
const PAIR_PREFIX = 'w24_';
/** The unit room of the turning-floor guard. */
const TURN_X = 5;
const TURN_BLOCK_EAST_X = 6;
const TURN_TICKS = 6;

async function load(lane: string, prefix: string = LANE_PREFIX): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  return engine;
}

function world(engine: GameEngine): EpoxyWorld {
  return (engine as unknown as { w: EpoxyWorld }).w;
}

/** Plays `count` more ticks. */
function play(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

/** Plays the ticks `from` to `ticks` of a w26_r7_* lane: the east key is held for the tick call pushTick + 1. */
function playPushed(engine: GameEngine, pushTick: number, ticks: number, from = 0): void {
  for (let k = from; k < ticks; k++) {
    if (k === pushTick) engine.attemptPlayerMoveHeld(['E']);
    engine.tick();
  }
}

/** The (x, y) of every entity of a kind and type, sorted by y then x. */
function cells(engine: GameEngine, kind: 'block' | 'monster', type?: string): [number, number][] {
  return engine
    .getEntities()
    .filter((e: RuntimeEntity) => e.kind === kind && (type === undefined || e.type === type))
    .map((e): [number, number] => [e.x, e.y])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function blocks(engine: GameEngine): [number, number][] {
  return cells(engine, 'block');
}

function balls(engine: GameEngine): [number, number][] {
  return cells(engine, 'monster', BALL);
}

describe('CC2 wave 26: a block refused on a fixed force floor retries in the next frame', () => {
  it('main-pass half: refused in frames 1 and 2 of tic 14, it goes in frame 0 of tic 15 (Lexy lane w26_r7_4_7_p0)', async () => {
    const engine = await load('r7_4_7_p0');
    playPushed(engine, 0, 15);
    expect(blocks(engine)).toEqual([[4, 4]]);
    playPushed(engine, 0, 16, 15);
    expect(blocks(engine)).toEqual([[5, 4]]);
    playPushed(engine, 0, 70, 16);
    expect(blocks(engine)).toEqual([[5, 4]]);
    expect(balls(engine)).toEqual([
      [7, 2],
      [5, 3]
    ]);
  });

  it('frame-0 half: refused in frame 0 of tic 64, it goes in frame 1 (Lexy lane w26_r7_1_3_p1)', async () => {
    const engine = await load('r7_1_3_p1');
    playPushed(engine, 1, 65);
    expect(blocks(engine)).toEqual([[5, 4]]);
    expect(balls(engine)).toEqual([
      [5, 3],
      [5, 6]
    ]);
  });

  it('keeps the block at its cell one tick earlier on the same lane (Lexy lane w26_r7_1_3_p1)', async () => {
    const engine = await load('r7_1_3_p1');
    playPushed(engine, 1, 44);
    expect(blocks(engine)).toEqual([[4, 4]]);
    expect(balls(engine)).toEqual([
      [5, 3],
      [5, 5]
    ]);
  });
});

describe('CC2 wave 26: a monster refused both ways on ice in a pre-pass frame faces the bounce way', () => {
  it('ball (5,3) refused both ways in frame 1 of tic 38 goes north in frame 2 (Lexy lane w26_r7_3_5_p2)', async () => {
    const engine = await load('r7_3_5_p2');
    playPushed(engine, 2, 39);
    expect(balls(engine)).toEqual([
      [5, 2],
      [6, 2]
    ]);
    expect(blocks(engine)).toEqual([[4, 4]]);
  });
});

describe('CC2 wave 26: a block loaded on a fixed force floor first slides in frame 1 of tic 0', () => {
  it('two loaded blocks: the bounce into the rear block tagged for the retry is refused (Lexy lane w26_t7_1_3)', async () => {
    const engine = await load('t7_1_3');
    play(engine, 1);
    expect(blocks(engine)).toEqual([
      [4, 4],
      [5, 4]
    ]);
    expect(balls(engine)).toEqual([
      [5, 2],
      [5, 6]
    ]);
    play(engine, 2);
    expect(blocks(engine)).toEqual([
      [4, 4],
      [5, 4]
    ]);
    expect(balls(engine)).toEqual([
      [6, 2],
      [6, 6]
    ]);
    play(engine, 2);
    expect(blocks(engine)).toEqual([
      [4, 4],
      [5, 4]
    ]);
    expect(balls(engine)).toEqual([
      [7, 2],
      [7, 6]
    ]);
  });

  it('the rear block of a pair goes in frame 2 of tic 0, behind the block ahead (Lexy lane w24_ff_pair_w)', async () => {
    const engine = await load('ff_pair_w', PAIR_PREFIX);
    const xs = (): number[] => blocks(engine).map((c) => c[0]);
    play(engine, 1);
    expect(xs()).toEqual([7, 8]);
    play(engine, 2);
    expect(xs()).toEqual([6, 7]);
    play(engine, 2);
    expect(xs()).toEqual([5, 6]);
  });

  it('a block that slides off the floor onto plain floor in frame 1 arrives in frame 0 of tic 4 (Lexy lane w26_ff_off)', async () => {
    const engine = await load('ff_off');
    const block = engine.getEntities().find((e) => e.kind === 'block') as RuntimeEntity;
    play(engine, 1);
    expect(block.x).toBe(6);
    expect(block.cc2ArrivalWait).toBe(4);
    expect(block.cc2ArrivalFrame).toBe(0);
    play(engine, 4);
    expect(block.arrivalTicks).toBeUndefined();
  });
});

describe('CC2 wave 26: a turning force floor keeps the after-pass retry', () => {
  it('a block refused on a turning floor by a block keeps the turn count and its position, with no slide frame', () => {
    const level = room({
      mode: 'cc2',
      startX: 1,
      terrain: {
        [`${TURN_X},${ROOM_ROW}`]: FORCE_CYCLE,
        [`${TURN_X - 1},${ROOM_ROW}`]: WALL,
        [`${TURN_X},${ROOM_ROW - 1}`]: WALL,
        [`${TURN_X},${ROOM_ROW + 1}`]: WALL
      },
      // The east block is listed first, so the pass reaches the block on the floor second.
      entities: [
        { type: DIRT_BLOCK, x: TURN_BLOCK_EAST_X, y: ROOM_ROW, dir: 'E' },
        { type: DIRT_BLOCK, x: TURN_X, y: ROOM_ROW, dir: 'E' }
      ]
    });
    const engine = new GameEngine();
    engine.loadLevel(level, SEED);
    const turnBefore = world(engine).forceCycleTurn;
    play(engine, TURN_TICKS);
    expect(world(engine).forceCycleTurn - turnBefore).toBe(TURN_TICKS);
    const onFloor = engine.getEntities().find((e) => e.x === TURN_X && e.y === ROOM_ROW) as RuntimeEntity;
    const east = engine.getEntities().find((e) => e.x === TURN_BLOCK_EAST_X && e.y === ROOM_ROW) as RuntimeEntity;
    expect(onFloor.dir).toBe('S');
    expect(onFloor.cc2SlideFrame).toBeUndefined();
    expect(east.cc2SlideFrame).toBeUndefined();
  });
});
