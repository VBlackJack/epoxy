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
 * CC2 engine, wave 16 (BMA): a block's slide step of the main pass (frame 2) off the slide onto a plain cell is a 12-frame step that
 * ends at frame 1 of the fourth tick after (2 + 11 frames), before that tick's decisions, as the pre-pass already does for its own
 * slide steps (Lexy game.js:2218-2242 step cooldown, 869-888 arrivals of frames 0 and 1 come before the decisions; ftrace Species
 * t790-t800: an ice block slides off ice onto a red button, the clone it releases is a press of frame 1).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { ccStepTicks } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const ICE = 'ice';
const FORCE_EAST = 'force_e';
const BUTTON = 'button_red';
const CLONE_MACHINE = 'clone_machine';
const ICE_BLOCK = 'ice_block';
const DIRT_BLOCK = 'dirt_block';
const FIREBALL = 'fireball';
const SLIDE_X = 5;
const LAND_X = SLIDE_X + 1;
const CLONER_X = 9;
const CLONE_X = CLONER_X + 1;
const PLAYER_START_X = 2;
/** Frames per tick, the decision frame, and the frames of a plain step (Lexy walk cooldown): the step ends 2 + 11 = 13 frames on. */
const FRAMES_PER_TICK = 3;
const DECISION_FRAME = 2;
const PLAIN_STEP_FRAMES = 12;
const END_TOTAL_FRAMES = DECISION_FRAME + PLAIN_STEP_FRAMES - 1;
/** Ticks the held step waits (the main pass has run its pre-pass already), and the frame it ends in. */
const HELD_WAIT_TICKS = Math.floor(END_TOTAL_FRAMES / FRAMES_PER_TICK);
const END_FRAME = END_TOTAL_FRAMES % FRAMES_PER_TICK;
/** The tick the block slid off the ice in, and the tick the held arrival settles in (its pre-pass, before the decisions). */
const SLIDE_TICK = 1;
const SETTLE_TICK = SLIDE_TICK + HELD_WAIT_TICKS;
/** The cc2Frame of a clone released by a press of frame 1: (p + 2) mod 3 (tagCloneFrame). */
const CLONE_FRAME_OF_PRESS_1 = 0;

const blockOf = (engine: GameEngine, type: string): RuntimeEntity => engine.getEntities().find((e) => e.type === type) as RuntimeEntity;

/** An ice block sliding east off one ice cell onto a red button wired to a cloner of a dirt block (the Species shape). */
function loadSpecies(mode: RoomMode): GameEngine {
  const level = room({
    mode,
    startX: PLAYER_START_X,
    terrain: { [`${SLIDE_X},${ROOM_ROW}`]: ICE, [`${LAND_X},${ROOM_ROW}`]: BUTTON, [`${CLONER_X},${ROOM_ROW}`]: CLONE_MACHINE },
    entities: [
      { type: ICE_BLOCK, x: SLIDE_X, y: ROOM_ROW, dir: 'E' },
      { type: DIRT_BLOCK, x: CLONER_X, y: ROOM_ROW, dir: 'E' }
    ]
  });
  level.cloneLinks = [{ buttonX: LAND_X, buttonY: ROOM_ROW, clonerX: CLONER_X, clonerY: ROOM_ROW, templateType: DIRT_BLOCK, templateDir: 'E' }];
  const engine = new GameEngine();
  engine.loadLevel(level);
  const slider = blockOf(engine, ICE_BLOCK);
  slider.isSliding = true;
  slider.cooldownTicks = 0;
  slider.dir = 'E';
  return engine;
}

const cloneOf = (engine: GameEngine): RuntimeEntity | undefined => engine.getEntities().find((e) => e.type === DIRT_BLOCK && e.x === CLONE_X && e.y === ROOM_ROW);

describe('CC2 engine: a main-pass slide step off the slide onto a plain cell holds its arrival', () => {
  it('holds the arrival to frame 1 of the fourth tick after', () => {
    const engine = loadSpecies('cc2');
    engine.tick();
    const block = blockOf(engine, ICE_BLOCK);
    expect(block.x).toBe(LAND_X);
    expect(block.arrivalTicks).toBeDefined();
    expect(block.cc2ArrivalWait).toBe(HELD_WAIT_TICKS);
    expect(block.cc2ArrivalFrame).toBe(END_FRAME);
  });

  it('presses the button in that pre-pass, not earlier: the clone is a press of frame 1 (Species t790-t800)', () => {
    const engine = loadSpecies('cc2');
    for (let tick = SLIDE_TICK; tick < SETTLE_TICK; tick++) {
      engine.tick();
      expect(engine.getTick()).toBe(tick);
      expect(cloneOf(engine), `tick ${tick}`).toBeUndefined();
      expect(blockOf(engine, ICE_BLOCK).arrivalTicks, `tick ${tick}`).toBeDefined();
    }
    engine.tick();
    expect(engine.getTick()).toBe(SETTLE_TICK);
    expect(blockOf(engine, ICE_BLOCK).arrivalTicks).toBeUndefined();
    expect(blockOf(engine, ICE_BLOCK).cc2ArrivalWait).toBeUndefined();
    expect(cloneOf(engine)?.cc2Frame).toBe(CLONE_FRAME_OF_PRESS_1);
  });

  it('holds nothing on a classic-rules or a native level', () => {
    for (const mode of ['cc', 'native'] as const) {
      const engine = loadSpecies(mode);
      engine.tick();
      expect(blockOf(engine, ICE_BLOCK).cc2ArrivalWait, mode).toBeUndefined();
      expect(blockOf(engine, ICE_BLOCK).cc2ArrivalFrame, mode).toBeUndefined();
    }
  });
});

describe('CC2 engine: what the main-pass hold does not touch', () => {
  it('leaves the pre-pass twin as it was: a pre-pass slide step off the ice holds frame + 11', () => {
    const engine = loadSpecies('cc2');
    const slider = blockOf(engine, ICE_BLOCK);
    // Tagged for frame 0 and due at once: the pre-pass of the first tick takes the step, a 12-frame step from frame 0 ends in frame 2.
    slider.cc2SlideFrame = 0;
    slider.cc2SlideDue = 1;
    engine.tick();
    const prePassEnd = 0 + PLAIN_STEP_FRAMES - 1;
    expect(slider.x).toBe(LAND_X);
    expect(slider.cc2ArrivalWait).toBe(Math.floor(prePassEnd / FRAMES_PER_TICK));
    expect(slider.cc2ArrivalFrame).toBe(prePassEnd % FRAMES_PER_TICK);
  });

  it('holds the arrival of a block refused on a force floor at frame 2 of tic 0 behind a monster that then leaves: it goes in frame 0 of tic 1 (Lexy lane w26_ff_fireball)', () => {
    const level = room({
      mode: 'cc2',
      startX: PLAYER_START_X,
      terrain: { [`${SLIDE_X},${ROOM_ROW}`]: FORCE_EAST },
      // The fireball is listed first, so it moves after the block (the pass runs the list backwards): the block is refused first.
      entities: [
        { type: FIREBALL, x: LAND_X, y: ROOM_ROW, dir: 'E' },
        { type: DIRT_BLOCK, x: SLIDE_X, y: ROOM_ROW, dir: 'E' }
      ]
    });
    const engine = new GameEngine();
    engine.loadLevel(level);
    const block = blockOf(engine, DIRT_BLOCK);
    block.isSliding = true;
    block.cooldownTicks = 0;
    block.dir = 'E';
    // Lexy lane w26_ff_fireball: the block is refused in frames 1 and 2 of tic 0 (the fireball leaves in frame 2, after the block),
    // goes in frame 0 of tic 1 (cd 12) and arrives in frame 2 of tic 4. The old value (block at LAND_X after tick 1, no hold) pinned
    // the step one frame early.
    engine.tick();
    expect(blockOf(engine, FIREBALL).x).toBe(LAND_X + 1);
    expect(block.x).toBe(SLIDE_X);
    expect(block.cc2SlideFrame).toBe(0);
    engine.tick();
    expect(block.x).toBe(LAND_X);
    expect(block.arrivalTicks).toBeDefined();
    expect(block.cc2ArrivalWait).toBe(3);
    expect(block.cc2ArrivalFrame).toBe(2);
    for (let i = 0; i < 3; i++) engine.tick();
    expect(block.arrivalTicks).toBeUndefined();
  });

  it('does not hold a monster stepping off ice onto a plain cell in the main pass: it keeps its tick timing', () => {
    const level = room({
      mode: 'cc2',
      startX: PLAYER_START_X,
      terrain: { [`${SLIDE_X},${ROOM_ROW}`]: ICE },
      entities: [{ type: FIREBALL, x: SLIDE_X, y: ROOM_ROW, dir: 'E' }]
    });
    const engine = new GameEngine();
    engine.loadLevel(level);
    const fireball = blockOf(engine, FIREBALL);
    fireball.cooldownTicks = 0;
    engine.tick();
    expect(fireball.x).toBe(LAND_X);
    expect(fireball.cc2ArrivalWait).toBeUndefined();
    expect(fireball.arrivalTicks).toBeUndefined();
    expect(fireball.cooldownTicks).toBe(ccStepTicks(FIREBALL) - 1);
  });
});
