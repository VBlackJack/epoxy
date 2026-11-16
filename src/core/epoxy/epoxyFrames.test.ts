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
 * CC2 wave 14, the frame module: the frame arithmetic of the helpers (Lexy game.js:2218-2242, 12-frame plain step and 6-frame
 * slide step, three frames per tic, 869-888) and the way the state rides an entity copy and an undo snapshot.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine, copyEntity } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, RuntimeEntity } from '../types';
import { cc2HiddenStateKey, type EpoxyWorld } from './epoxyWorld';
import { frameModelOn, holdFrameArrival, resetFrameWorld, tagPushedBlock, tagSlideFrame } from './epoxyFrames';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const BLOCK_X = 3;
const ICE_TILE = 'ice';
/** Frames in one tic. */
const FRAMES = 3;

type Mode = 'cc2' | 'native';

function load(mode: Mode): { engine: GameEngine; w: EpoxyWorld; block: RuntimeEntity } {
  const built = buildTestLevel(['#########', '#@..d...#', '#########'], { entities: [{ type: 'dirt_block', x: BLOCK_X, y: ROW, dir: 'E' }] });
  const level: CompiledLevel = mode === 'cc2' ? { ...built, cc2: CC2_RECORD } : built;
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = (engine as unknown as { w: EpoxyWorld }).w;
  const block = w.entities.find((e) => e.kind === 'block') as RuntimeEntity;
  return { engine, w, block };
}

/** Puts the block on ice and makes it a slider, as a push onto ice leaves it. */
function slideOnIce(w: EpoxyWorld, block: RuntimeEntity): void {
  w.terrain[block.y][block.x] = ICE_TILE;
  block.isSliding = true;
  delete block.arrivalTicks;
}

/** Makes the block take a plain step, as a push onto a floor cell leaves it. */
function plainStep(block: RuntimeEntity): void {
  block.isSliding = false;
  block.arrivalTicks = 1;
}

/** The frame of a tick count from frame 0: total frames after it. */
const ticksOf = (total: number): number => Math.floor(total / FRAMES);
const frameOf = (total: number): number => total % FRAMES;

describe('frame model gate', () => {
  it('runs on a CC2 level only', () => {
    expect(frameModelOn(load('cc2').w)).toBe(true);
    expect(frameModelOn(load('native').w)).toBe(false);
  });

  it('never runs on cc3dPace', () => {
    const { w } = load('cc2');
    w.cc3dPace = true;
    expect(frameModelOn(w)).toBe(false);
  });

  it('sets nothing on a native level', () => {
    const { w, block } = load('native');
    slideOnIce(w, block);
    tagPushedBlock(w, block, true, false, false, undefined);
    plainStep(block);
    holdFrameArrival(w, block, 5);
    expect(block.cc2SlideFrame).toBeUndefined();
    expect(block.cc2SlideDue).toBeUndefined();
    expect(block.cc2ArrivalWait).toBeUndefined();
    expect(block.cc2ArrivalFrame).toBeUndefined();
  });
});

describe('frame arithmetic', () => {
  // Lexy game.js:2218-2242: a walk onto a plain cell takes 12 frames, a step onto a slide 6.
  it('a decision push onto ice slides in frame 1 two ticks later', () => {
    const { w, block } = load('cc2');
    w.cc2PrePassDone = true;
    slideOnIce(w, block);
    tagPushedBlock(w, block, true, false, false, undefined);
    expect(block.cc2SlideFrame).toBe(1);
    expect(block.cc2SlideDue).toBe(2);
  });

  it('counts the pre-pass still to come when the coming tick has not run its own', () => {
    const { w, block } = load('cc2');
    slideOnIce(w, block);
    tagPushedBlock(w, block, true, false, false, undefined);
    expect(block.cc2SlideDue).toBe(3);
  });

  it('a decision push onto a floor lands in frame 0 of tic t+4', () => {
    const { w, block } = load('cc2');
    w.cc2PrePassDone = true;
    plainStep(block);
    tagPushedBlock(w, block, true, false, false, undefined);
    expect(block.cc2ArrivalWait).toBe(ticksOf(12));
    expect(block.cc2ArrivalFrame).toBe(frameOf(12));
    expect(block.cc2ArrivalWait).toBe(4);
    expect(block.cc2ArrivalFrame).toBe(0);
  });

  it.each([
    { frame: 0 as const, later: false, ticks: ticksOf(0 + 6), slide: frameOf(0 + 6) },
    { frame: 1 as const, later: false, ticks: ticksOf(1 + 6), slide: frameOf(1 + 6) },
    { frame: 0 as const, later: true, ticks: ticksOf(0 + 6 - 1), slide: frameOf(0 + 6 - 1) },
    { frame: 1 as const, later: true, ticks: ticksOf(1 + 6 - 1), slide: frameOf(1 + 6 - 1) }
  ])('a slider of frame $frame pushes onto ice (later $later): s + 6 - d', ({ frame, later, ticks, slide }) => {
    const { w, block } = load('cc2');
    w.cc2PrePassDone = true;
    slideOnIce(w, block);
    tagPushedBlock(w, block, false, false, later, frame);
    if (slide === 2) {
      expect(block.cc2SlideFrame).toBeUndefined();
    } else {
      expect(block.cc2SlideFrame).toBe(slide);
      expect(block.cc2SlideDue).toBe(ticks);
    }
  });

  it.each([
    { frame: 0 as const, later: false },
    { frame: 1 as const, later: false },
    { frame: 1 as const, later: true }
  ])('a slider of frame $frame pushes onto a floor (later $later): s + 11 - d', ({ frame, later }) => {
    const { w, block } = load('cc2');
    w.cc2PrePassDone = true;
    w.cc2PrePassStepping = true;
    plainStep(block);
    tagPushedBlock(w, block, false, false, later, frame);
    const total = frame + 11 - (later ? 1 : 0);
    expect(block.cc2ArrivalWait).toBe(ticksOf(total));
    expect(block.cc2ArrivalFrame).toBe(frameOf(total));
  });

  it.each([0, 1])('off the slide from frame %i the plain step ends at f + 11', (frame) => {
    const { w, block } = load('cc2');
    w.cc2PrePassDone = true;
    plainStep(block);
    holdFrameArrival(w, block, frame + 11, false);
    expect(block.cc2ArrivalWait).toBe(ticksOf(frame + 11));
    expect(block.cc2ArrivalFrame).toBe(frameOf(frame + 11));
  });

  it('frame 2 is the base timing: no slide frame is kept', () => {
    const { w, block } = load('cc2');
    slideOnIce(w, block);
    block.cc2SlideFrame = 0;
    block.cc2SlideDue = 1;
    tagSlideFrame(w, block, 2, 1);
    expect(block.cc2SlideFrame).toBeUndefined();
    expect(block.cc2SlideDue).toBeUndefined();
  });
});

describe('snapshot round trip', () => {
  it('copyEntity keeps the frame fields as plain scalars', () => {
    const { block } = load('cc2');
    block.cc2SlideFrame = 1;
    block.cc2SlideDue = 2;
    block.cc2ArrivalWait = 3;
    block.cc2ArrivalFrame = 2;
    block.cc2PrePassMoved = true;
    const copy = copyEntity(block);
    expect(copy.cc2SlideFrame).toBe(1);
    expect(copy.cc2SlideDue).toBe(2);
    expect(copy.cc2ArrivalWait).toBe(3);
    expect(copy.cc2ArrivalFrame).toBe(2);
    expect(copy.cc2PrePassMoved).toBe(true);
    // Counting the copy down never reaches the original: nothing is shared.
    copy.cc2ArrivalWait = 0;
    copy.cc2SlideDue = 1;
    expect(block.cc2ArrivalWait).toBe(3);
    expect(block.cc2SlideDue).toBe(2);
    for (const field of [copy.cc2SlideFrame, copy.cc2SlideDue, copy.cc2ArrivalWait, copy.cc2ArrivalFrame, copy.cc2PrePassMoved]) {
      expect(typeof field).not.toBe('object');
    }
  });

  it('captureState and restoreState give the held arrival back', () => {
    const { engine, w, block } = load('cc2');
    plainStep(block);
    block.cc2ArrivalWait = 2;
    block.cc2ArrivalFrame = 1;
    const snap = engine.captureState();
    block.cc2ArrivalWait = 0;
    delete block.cc2ArrivalFrame;
    engine.restoreState(snap);
    const restored = w.entities.find((e) => e.kind === 'block') as RuntimeEntity;
    expect(restored.cc2ArrivalWait).toBe(2);
    expect(restored.cc2ArrivalFrame).toBe(1);
  });

  it('puts the frame state in the hidden state key only when set', () => {
    const { w, block } = load('cc2');
    const bare = cc2HiddenStateKey(w);
    block.cc2ArrivalWait = 2;
    block.cc2ArrivalFrame = 1;
    const held = cc2HiddenStateKey(w);
    expect(held).not.toBe(bare);
    block.cc2ArrivalWait = 1;
    expect(cc2HiddenStateKey(w)).not.toBe(held);
    delete block.cc2ArrivalWait;
    delete block.cc2ArrivalFrame;
    expect(cc2HiddenStateKey(w)).toBe(bare);
    w.cc2PrePassDone = true;
    expect(cc2HiddenStateKey(w)).not.toBe(bare);
    delete w.cc2PrePassDone;
    block.cc2PrePassMoved = true;
    expect(cc2HiddenStateKey(w)).not.toBe(bare);
  });

  it('resetFrameWorld clears every world field', () => {
    const { w } = load('cc2');
    w.cc2PrePassDone = true;
    w.cc2PrePassArrived = true;
    w.cc2PrePassStepping = true;
    w.cc2PrePassFrame = 1;
    resetFrameWorld(w);
    expect(w.cc2PrePassDone).toBeUndefined();
    expect(w.cc2PrePassArrived).toBeUndefined();
    expect(w.cc2PrePassStepping).toBeUndefined();
    expect(w.cc2PrePassFrame).toBeUndefined();
  });

  it('loading a level resets a pre-pass left over from the last one', () => {
    const { engine, w } = load('cc2');
    w.cc2PrePassDone = true;
    w.cc2PrePassArrived = true;
    engine.loadLevel({ ...buildTestLevel(['#####', '#@..#', '#####']), cc2: CC2_RECORD });
    const next = (engine as unknown as { w: EpoxyWorld }).w;
    expect(next.cc2PrePassDone).toBeUndefined();
    expect(next.cc2PrePassArrived).toBeUndefined();
  });
});
