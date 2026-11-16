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
 * CC2 wave 14, placement of the frame pre-pass in the engine. Lexy runs the frame-0 and frame-1 moves of tic t right after the cleanup
 * of tic t-1 and before the input of tic t (game.js:872-889), a death in them belongs to tic t (game.js:1507), and a tic that times
 * out ends before any frame (game.js:1507-1510). A CC2 level with parked players has no actor order, so its pre-pass runs at the end
 * of the previous tick; a level with actor order runs it at the start of the entity pass. The undo snapshot carries the done mark.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { buildTestLevel } from '../../test/buildTestLevel';
import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction, RuntimeEntity } from '../types';
import type { EpoxyWorld } from './epoxyWorld';
import { holdFrameArrival } from './epoxyFrames';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const ROWS = ['#########', '#@......#', '#########'];
const BLOCK_X = 6;
const PARKED_X = 5;
const BLOCK_TYPE = 'dirt_block';
const ICE_TILE = 'ice';
/** Frames from frame 0 of the first pre-pass to the end of a plain step pushed by a decision: frame 0 of tic t+4 (game.js:2218-2242). */
const HELD_FRAMES = 60;
/** A hold that outlasts any test run. */
const LONG_HOLD_FRAMES = 3000;
const MAX_TICKS = 40;
const MAX_WALK_TICKS = 12;
/** Two pre-passes before the first slide step: one runs at the first tick's start, the next at that tick's end. */
const SLIDE_DUE = 2;
const TIME_LIMIT_SECONDS = 2;
const RUN_GUARD_TICKS = 1000;

type Lane = 'two' | 'one';
const LANES: readonly Lane[] = ['two', 'one'];

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const blockOf = (engine: GameEngine): RuntimeEntity => worldOf(engine).entities.find((e) => e.kind === 'block') as RuntimeEntity;

/** `two`: a second player is parked, so there is no actor order. `one`: a single player, which plays in actor order. */
function load(lane: Lane, ice: boolean = false, timeLimitSeconds: number = 0): GameEngine {
  const built = buildTestLevel(ROWS, { entities: [{ type: BLOCK_TYPE, x: BLOCK_X, y: ROW, dir: ice ? ('W' as Direction) : ('E' as Direction) }] });
  if (ice) built.terrain[ROW][BLOCK_X] = ICE_TILE;
  const level: CompiledLevel = {
    ...built,
    cc2: CC2_RECORD,
    timeLimitSeconds,
    ...(lane === 'two' ? { extraPlayers: [{ x: PARKED_X, y: ROW, dir: 'E' as Direction, character: 'chip' as const }] } : {})
  };
  const engine = new GameEngine();
  engine.loadLevel(level, 1);
  return engine;
}

/** The block takes a plain step that ends in frame 0, four tics on, as a decision push onto a floor cell leaves it. */
function holdPlainStep(engine: GameEngine, frames: number = HELD_FRAMES): void {
  const block = blockOf(engine);
  block.arrivalTicks = 1;
  holdFrameArrival(worldOf(engine), block, frames);
}

/**
 * The block slides west in frame 0 and, on its first step, lands on whoever stands west of it: the parked player on the two player
 * lane, the controlled player (moved next to it) on the single player lane.
 */
function armSlide(engine: GameEngine, lane: Lane, due: number): void {
  const w = worldOf(engine);
  const block = blockOf(engine);
  if (lane === 'one') {
    block.x = w.player.x + 1;
    w.terrain[ROW][block.x] = ICE_TILE;
  }
  block.isSliding = true;
  block.cc2SlideFrame = 0;
  block.cc2SlideDue = due;
}

/** One step: the input is given again after each tick until the walk cooldown lets it through. */
function walk(engine: GameEngine, dir: Direction): void {
  for (let i = 0; i < MAX_WALK_TICKS; i++) if (playMove(engine, dir).accepted) return;
  throw new Error('the step was never accepted');
}

const landed = (engine: GameEngine): boolean => {
  const block = blockOf(engine);
  return block.arrivalTicks === undefined && block.cc2ArrivalWait === undefined;
};

/** Plays the script, then idle ticks until the held step is gone; the tick count at that moment. */
function landingTick(engine: GameEngine, script: (e: GameEngine) => void): number {
  script(engine);
  for (let i = 0; i < MAX_TICKS && !landed(engine); i++) engine.tick();
  expect(landed(engine)).toBe(true);
  return engine.getTick();
}

describe.each(LANES)('undo carries the frame pre-pass (%s player lane)', (lane) => {
  it('has the actor order the lane is named for', () => {
    expect(load(lane).playsInActorOrder()).toBe(lane === 'one');
  });

  // Without the done mark in the snapshot the restored state runs its pre-pass twice and the block lands a tick early.
  it('replays a held arrival to the same landing tick after an undo', () => {
    const plain = load(lane);
    holdPlainStep(plain);
    const expected = landingTick(plain, (e) => {
      walk(e, 'E');
      walk(e, 'W');
    });

    const undone = load(lane);
    holdPlainStep(undone);
    const replayed = landingTick(undone, (e) => {
      walk(e, 'E');
      walk(e, 'W');
      expect(e.undo()).toBe(true);
      walk(e, 'W');
    });
    expect(replayed).toBe(expected);
  });

  it('restores the held arrival and the done mark exactly', () => {
    const engine = load(lane);
    holdPlainStep(engine);
    walk(engine, 'E');
    while (engine.getPlayer().moveCooldown > 0) engine.tick();
    const before = JSON.stringify(engine.captureState());
    const wait = blockOf(engine).cc2ArrivalWait;
    walk(engine, 'W');
    expect(engine.undo()).toBe(true);
    expect(blockOf(engine).cc2ArrivalWait).toBe(wait);
    expect(JSON.stringify(engine.captureState())).toBe(before);
  });
});

describe('a rejected input changes nothing', () => {
  // Placement C acts on a level with parked players, where the input is judged at once; a level with actor order stores it.
  it('two player lane', () => {
    const engine = load('two');
    holdPlainStep(engine);
    // One step east, then back to the wall and out of the walk cooldown: the next west input is refused by the wall.
    walk(engine, 'E');
    walk(engine, 'W');
    while (engine.getPlayer().moveCooldown > 0) engine.tick();
    const before = JSON.stringify(engine.captureState());
    const tick = engine.getTick();
    expect(engine.attemptPlayerMove('W')).toBe(false);
    expect(JSON.stringify(engine.captureState())).toBe(before);
    expect(engine.getTick()).toBe(tick);
    expect(blockOf(engine).cc2ArrivalWait).toBeDefined();
  });
});

describe('a death in the frame pre-pass', () => {
  // game.js:1507: the death belongs to the coming tick; Lexy runs frames 0-1 of it before its input.
  it('two player lane: the block lands on the parked player at the end of tick 1, and the coming tick counts', () => {
    const engine = load('two', true);
    armSlide(engine, 'two', SLIDE_DUE);
    const w = worldOf(engine);
    expect(w.cc2ActorOrder).not.toBe(true);
    engine.tick();
    expect(w.player.alive).toBe(false);
    // Tick 1 plus the coming tick 2, in which the death belongs.
    expect(engine.getTick()).toBe(2);
  });

  it('two player lane: a parked player killed there ends the run like a main-tick death', () => {
    const engine = load('two', true);
    armSlide(engine, 'two', SLIDE_DUE);
    engine.tick();
    expect(engine.getPlayer().alive).toBe(false);
    expect(engine.isLevelCompleted()).toBe(false);
    const tick = engine.getTick();
    engine.tick();
    expect(engine.getTick()).toBe(tick);
    expect(engine.attemptPlayerMove('E')).toBe(false);
  });

  it('single player lane: the pass-start pre-pass kills in its own tick', () => {
    const engine = load('one', true);
    armSlide(engine, 'one', 1);
    engine.tick();
    expect(worldOf(engine).player.alive).toBe(false);
    expect(engine.getTick()).toBe(1);
  });

  it.each([
    { lane: 'two' as Lane, due: SLIDE_DUE },
    { lane: 'one' as Lane, due: 1 }
  ])('restarting after the death leaves no stale pre-pass state ($lane player lane)', ({ lane, due }) => {
    const engine = load(lane, true);
    armSlide(engine, lane, due);
    engine.tick();
    expect(worldOf(engine).player.alive).toBe(false);
    engine.loadLevel({ ...buildTestLevel(ROWS), cc2: CC2_RECORD }, 1);
    const w = worldOf(engine);
    expect(w.cc2PrePassDone).toBeUndefined();
    expect(w.cc2PrePassArrived).toBeUndefined();
    expect(w.cc2PrePassStepping).toBeUndefined();
    expect(w.cc2PrePassFrame).toBeUndefined();
    expect(w.player.alive).toBe(true);
    expect(engine.getTick()).toBe(0);
    engine.tick();
    expect(engine.getTick()).toBe(1);
  });
});

describe('the end-of-tick pre-pass', () => {
  it('runs on a level without actor order only: actor order waits for the pass start', () => {
    for (const lane of LANES) {
      const engine = load(lane);
      holdPlainStep(engine, LONG_HOLD_FRAMES);
      engine.tick();
      // Between ticks the done mark is set by the end-of-tick call (two) or cleared by the end of the pass (one).
      expect(worldOf(engine).cc2PrePassDone === true).toBe(lane === 'two');
    }
  });

  it('is skipped when the coming tick times out (game.js:1507-1510)', () => {
    const engine = load('two', false, TIME_LIMIT_SECONDS);
    holdPlainStep(engine, LONG_HOLD_FRAMES);
    const marks: boolean[] = [];
    for (let i = 0; i < RUN_GUARD_TICKS && worldOf(engine).player.alive; i++) {
      engine.tick();
      marks.push(worldOf(engine).cc2PrePassDone === true);
    }
    // The last tick of the run is the one that timed out: it ran nothing. The one before it did not run the pre-pass of that tick.
    expect(worldOf(engine).player.alive).toBe(false);
    const played = marks.slice(0, -1);
    expect(played.slice(0, -1).every((m) => m)).toBe(true);
    expect(played[played.length - 1]).toBe(false);
  });

  it('does not act on a native level', () => {
    const built = buildTestLevel(ROWS, { entities: [{ type: BLOCK_TYPE, x: BLOCK_X, y: ROW, dir: 'E' as Direction }] });
    const engine = new GameEngine();
    engine.loadLevel({ ...built, extraPlayers: [{ x: PARKED_X, y: ROW, dir: 'E', character: 'chip' }] }, 1);
    engine.tick();
    expect(worldOf(engine).cc2PrePassDone).toBeUndefined();
  });
});
