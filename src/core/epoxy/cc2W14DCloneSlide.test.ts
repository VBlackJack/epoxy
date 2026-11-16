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
 * CC2 engine, wave 14 (SFM, devices): a block cloned onto ice by a press of frame p takes its out-of-turn 6-frame step then and
 * slides in frame p two ticks later; a block cloned onto a plain cell by a press of frame 0 or 1 ends its 12-frame step at p + 11;
 * a press of frame 2 keeps the base timing (Lexy attempt_out_of_turn_step, game.js:2218-2242; MAP123 t24-t26, map045 t1541). A
 * level that is not CC2 is unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { spawnFromCloner } from './epoxyDevices';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const CLONER_X = 7;
const SPAWN_X = CLONER_X + 1;
const BLOCK = 'dirt_block';
const ICE = 'ice';
const FRAME_0 = 0;
const FRAME_1 = 1;
const FRAME_2 = 2;
/** Frames per tick, and frames from the press to the end of the 12-frame plain step of a clone (p + 11). */
const FRAMES_PER_TICK = 3;
const PLAIN_CLONE_STEP_END_FRAMES = 11;
/** Ticks before the first slide step of a block cloned onto a slide. */
const CLONE_SLIDE_TICKS = 2;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

beforeEach(() => {
  loadTestConfigs();
});

function cloneBlock(mode: RoomMode, onIce: boolean, frame: 0 | 1 | 2) {
  const terrain: Record<string, string> = { [`${CLONER_X},${ROOM_ROW}`]: 'clone_machine' };
  if (onIce) terrain[`${SPAWN_X},${ROOM_ROW}`] = ICE;
  const engine = new GameEngine();
  engine.loadLevel(room({ mode, terrain, entities: [{ type: BLOCK, x: CLONER_X, y: ROOM_ROW, dir: 'E' }] }));
  worldOf(engine).cc2ReleaseFrame = frame;
  spawnFromCloner(ctxOf(engine), CLONER_X, ROOM_ROW, BLOCK, 'E');
  return engine.getEntities().find((e) => e.type === BLOCK && e.x === SPAWN_X && e.y === ROOM_ROW);
}

describe('CC2 engine: a block cloned onto ice slides in the frame of its press', () => {
  // MAP123 t24-t26: the clone slides in frame p two ticks later.
  it.each([FRAME_0, FRAME_1] as const)('tags the slide with the press frame %i', (frame) => {
    const block = cloneBlock('cc2', true, frame);
    expect(block?.isSliding).toBe(true);
    expect(block?.cc2SlideFrame).toBe(frame);
    expect(block?.cc2SlideDue).toBeGreaterThanOrEqual(CLONE_SLIDE_TICKS);
    expect(block?.cc2ArrivalWait).toBeUndefined();
  });

  it('keeps the base timing for a press of frame 2', () => {
    const block = cloneBlock('cc2', true, FRAME_2);
    expect(block?.cc2SlideFrame).toBeUndefined();
    expect(block?.cc2SlideDue).toBeUndefined();
  });

  it('tags nothing on a level that is not CC2', () => {
    const block = cloneBlock('native', true, FRAME_1);
    expect(block?.cc2SlideFrame).toBeUndefined();
    expect(block?.cc2SlideDue).toBeUndefined();
  });
});

describe('CC2 engine: a block cloned onto a plain cell holds its arrival to the frame it ends in', () => {
  // game.js:2218-2242: a 12-frame step out of turn from frame p ends at p + 11.
  it.each([FRAME_0, FRAME_1] as const)('holds the arrival of a press of frame %i', (frame) => {
    const block = cloneBlock('cc2', false, frame);
    const total = frame + PLAIN_CLONE_STEP_END_FRAMES;
    expect(block?.arrivalTicks).toBeDefined();
    expect(block?.cc2ArrivalFrame).toBe(total % FRAMES_PER_TICK);
    expect(block?.cc2ArrivalWait).toBeGreaterThanOrEqual(Math.floor(total / FRAMES_PER_TICK));
  });

  it('keeps the base timing for a press of frame 2', () => {
    const block = cloneBlock('cc2', false, FRAME_2);
    expect(block?.cc2ArrivalWait).toBeUndefined();
    expect(block?.cc2ArrivalFrame).toBeUndefined();
  });

  it('holds nothing on a level that is not CC2', () => {
    const block = cloneBlock('native', false, FRAME_1);
    expect(block?.cc2ArrivalWait).toBeUndefined();
    expect(block?.cc2ArrivalFrame).toBeUndefined();
  });
});
