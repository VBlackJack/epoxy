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
 * CC2 wave 27 (map089 becomes a win): a block boxed in on ice tries again in the next frame (frame 1 after frame 0, frame 0 of the
 * next tic after the main pass); the controlled player's red-button press at the end of a decision step acts at his place in frame 1
 * of the pre-pass, after the actors listed after him, and a press the pre-pass missed acts as his main-pass turn opens; a block that
 * press releases from a template listed before him slides one frame sooner and a clone arriving on a plain cell does so one frame
 * sooner; his push of a block sliding on ice that moves in the main pass is a pending push, only for a block listed after him.
 * Played on the Lexy lanes of src/core/epoxy/__fixtures__/cc2-lanes (prefixes w24_ and w27_).
 *
 * tick() k plays the Lexy tic k - 1, so "after N ticks" is the end of Lexy tic N - 1; an input of Lexy tic t is
 * attemptPlayerMoveHeld before tick() call t + 1 (the `@k` of a case is the tick() call it comes before). Every expected value is
 * the end-of-tic value of the Lexy lane named next to it (actor oracle, harness checked). Positions only: the block at 7,4 of
 * w24_sbrp_3_3 faces west in Epoxy and east in Lexy at 12 and 17 ticks, which no assertion reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room } from '../../test/cc2Room';
import { loadCc2Lane } from '../../test/cc2LaneFixture';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playMove } from '../../test/cc2Play';
import { GameEngine } from '../GameEngine';
import type { Direction, RuntimeEntity } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const SEED = 0;
const SBR_PREFIX = 'w24_';
const LANE_PREFIX = 'w27_';
/** The row of the ice lanes the SBR case reads. */
const ICE_ROW = 4;

type Cell = [number, number];
/** The tick() calls an input comes before (1-based), by direction. */
type Inputs = Readonly<Record<number, Direction>>;

async function load(lane: string, prefix: string = LANE_PREFIX): Promise<GameEngine> {
  const engine = new GameEngine();
  engine.loadLevel(await loadCc2Lane(lane, prefix), SEED);
  return engine;
}

/** Plays the ticks `from` + 1 to `ticks`; an input of the map is held before the tick() call it names. */
function play(engine: GameEngine, inputs: Inputs, ticks: number, from = 0): void {
  for (let call = from + 1; call <= ticks; call++) {
    const dir = inputs[call];
    if (dir !== undefined) engine.attemptPlayerMoveHeld([dir]);
    engine.tick();
  }
}

/** The (x, y) of every block, sorted by x then y. */
function blocks(engine: GameEngine): Cell[] {
  return engine
    .getEntities()
    .filter((e: RuntimeEntity) => e.kind === 'block')
    .map((e): Cell => [e.x, e.y])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const player = (engine: GameEngine): Cell => [engine.getPlayer().x, engine.getPlayer().y];

/** The x of every block of a row, sorted. */
function rowXs(engine: GameEngine, row: number): number[] {
  return blocks(engine)
    .filter(([, y]) => y === row)
    .map(([x]) => x);
}

describe('CC2 wave 27 (8a): a block boxed in on ice tries again in the next frame', () => {
  it('goes in frame 1 after a frame-0 refusal and in frame 0 of the next tic after a main-pass one (Lexy lane w24_sbrp_3_3)', async () => {
    const engine = await load('sbrp_3_3', SBR_PREFIX);
    play(engine, {}, 10);
    expect(rowXs(engine, ICE_ROW)).toEqual([4, 5, 6]);
    play(engine, {}, 12, 10);
    expect(rowXs(engine, ICE_ROW)).toEqual([5, 6, 7]);
    play(engine, {}, 17, 12);
    expect(rowXs(engine, ICE_ROW)).toEqual([5, 6, 7]);
  });
});

describe('CC2 wave 27 (8b): the press of the player acts at his place in frame 1 of the pre-pass', () => {
  it('refuses the release when a block enters the exit cell in frame 1 of the press tic (Lexy lane w27_A4_press_k16)', async () => {
    const engine = await load('A4_press_k16');
    const inputs: Inputs = { 1: 'E', 5: 'S', 17: 'N' };
    play(engine, inputs, 21);
    expect(player(engine)).toEqual([4, 2]);
    expect(blocks(engine)).toEqual([
      [6, 4],
      [7, 4]
    ]);
    play(engine, inputs, 23, 21);
    expect(blocks(engine)).toEqual([
      [5, 4],
      [7, 4]
    ]);
  });
});

describe('CC2 wave 27 (8c): a block released from a template listed before the player slides one frame sooner', () => {
  it('enters the exit cell in frame 0 of the press tic and the release is refused (Lexy lane w27_B4_press_k16)', async () => {
    const engine = await load('B4_press_k16');
    const inputs: Inputs = { 1: 'E', 5: 'N', 17: 'S' };
    play(engine, inputs, 21);
    expect(player(engine)).toEqual([4, 4]);
    expect(blocks(engine)).toEqual([
      [6, 2],
      [7, 2]
    ]);
    play(engine, inputs, 23, 21);
    expect(blocks(engine)).toEqual([
      [5, 2],
      [7, 2]
    ]);
  });
});

describe('CC2 wave 27 (8d): a clone arriving on a plain cell does so one frame sooner than the press frame plus eleven', () => {
  it('releases the second machine at p + 10, the first clone arrival (Lexy lane w27_cltp_chain)', async () => {
    const engine = await load('cltp_chain');
    const inputs: Inputs = { 1: 'E' };
    play(engine, inputs, 8);
    // The second clone, released at t7f2; the templates stay on the cells next to the machines.
    expect(blocks(engine)).toContainEqual([2, ICE_ROW]);
    play(engine, inputs, 10, 8);
    expect(blocks(engine)).toContainEqual([3, ICE_ROW]);
    expect(blocks(engine)).not.toContainEqual([2, ICE_ROW]);
  });
});

describe('CC2 wave 27 (8e): the push of a block sliding on ice that moves in the main pass is a pending push', () => {
  it('turns the block that moves in this pass, listed after the player (Lexy lane w27_A4_push2_k10_p24)', async () => {
    const engine = await load('A4_push2_k10_p24');
    const inputs: Inputs = { 1: 'E', 5: 'S', 11: 'N', 15: 'S', 25: 'S' };
    play(engine, inputs, 25);
    expect(player(engine)).toEqual([4, 4]);
    expect(blocks(engine)).toEqual([
      [2, 4],
      [4, 5],
      [7, 4]
    ]);
    play(engine, inputs, 27, 25);
    expect(player(engine)).toEqual([4, 3]);
    expect(blocks(engine)).toEqual([
      [3, 4],
      [4, 5],
      [7, 4]
    ]);
    play(engine, inputs, 31, 27);
    expect(blocks(engine)).toEqual([
      [4, 5],
      [5, 4],
      [7, 4]
    ]);
  });

  it('pushes a block listed before the player directly, not as a pending push (Lexy lane w27_B4_push2_k38_p66)', async () => {
    const engine = await load('B4_push2_k38_p66');
    const inputs: Inputs = { 1: 'E', 5: 'N', 39: 'S', 43: 'N', 67: 'N' };
    play(engine, inputs, 67);
    expect(player(engine)).toEqual([4, 2]);
    expect(blocks(engine)).toEqual([
      [4, 1],
      [6, 2],
      [7, 2]
    ]);
    play(engine, inputs, 69, 67);
    expect(player(engine)).toEqual([4, 3]);
    expect(blocks(engine)).toEqual([
      [4, 1],
      [5, 2],
      [7, 2]
    ]);
    play(engine, inputs, 71, 69);
    expect(blocks(engine)).toEqual([
      [4, 1],
      [4, 2],
      [7, 2]
    ]);
  });
});

describe('CC2 wave 27 (8f): a press the pre-pass missed acts as the main-pass turn of the player opens', () => {
  const PLAYER_X = 2;
  const BUTTON_X = 3;
  const CLONER_X = 7;
  const CLONER_Y = 8;
  const SPAWN_X = CLONER_X + 1;
  const MAX_TICKS = 40;
  /** The wait of a monster clone and the arrival wait of a block clone after the tick that let it out. */
  const FALLBACK_WAIT = 4;

  function loadRoom(type: string): GameEngine {
    const level = room({
      mode: 'cc2',
      startX: PLAYER_X,
      terrain: { [`${BUTTON_X},${ROOM_ROW}`]: 'button_red', [`${CLONER_X},${CLONER_Y}`]: 'clone_machine' },
      entities: [{ type, x: CLONER_X, y: CLONER_Y, dir: 'E' }]
    });
    level.cloneLinks = [{ buttonX: BUTTON_X, buttonY: ROOM_ROW, clonerX: CLONER_X, clonerY: CLONER_Y, templateType: type, templateDir: 'E' }];
    const engine = new GameEngine();
    engine.loadLevel(level);
    return engine;
  }

  /** The step onto the button is played out and flushed, then the pre-pass of the next tick is marked as already run. */
  function missedPrePass(type: string): GameEngine {
    const engine = loadRoom(type);
    expect(playMove(engine, 'E').accepted).toBe(true);
    let guard = 0;
    while (engine.getPlayer().moveCooldown > 0 && guard++ < MAX_TICKS) engine.tick();
    engine.attemptPlayerMove('N');
    engine.flushPendingStepEnd();
    (engine as unknown as { w: EpoxyWorld }).w.cc2PrePassDone = true;
    return engine;
  }

  const clone = (engine: GameEngine, kind: 'monster' | 'block', type: string) =>
    engine.getEntities().find((e) => e.kind === kind && e.type === type && e.x === SPAWN_X && e.y === CLONER_Y);

  it('lets a monster clone out in the tick the pre-pass was skipped', () => {
    const engine = missedPrePass('bouncer');
    expect(clone(engine, 'monster', 'bouncer')).toBeUndefined();
    engine.tick();
    expect(clone(engine, 'monster', 'bouncer')?.cooldownTicks).toBe(FALLBACK_WAIT);
  });

  it('lets a block clone out in the tick the pre-pass was skipped', () => {
    const engine = missedPrePass('dirt_block');
    expect(clone(engine, 'block', 'dirt_block')).toBeUndefined();
    engine.tick();
    expect(clone(engine, 'block', 'dirt_block')?.cc2ArrivalWait).toBe(FALLBACK_WAIT);
  });
});
