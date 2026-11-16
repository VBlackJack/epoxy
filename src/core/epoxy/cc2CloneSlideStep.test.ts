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
 * CC2 engine, wave 16 (CSS): a monster let out of a clone machine onto ice or a force floor takes the slide step time, a share of the
 * plain step, because Lexy takes the step speed from the destination (game.js:2177-2194, attempt_out_of_turn_step tiletypes.js:1703-1731;
 * MAP099 t349f1, a clone tank onto force_floor_all, cd 6). The late-release (frame 2) adjustment stacks on it; the before-pass tick the
 * 12-frame clone needs does not (MAP099 ftrace t65f1 press, 6-frame step, arrival t67f0, leaves t67: stacking it leaves at t68).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC2_FLOOR_STEP_DIVISOR, ccStepTicks } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { RuntimeEntity } from '../types';
import { spawnFromCloner } from './epoxyDevices';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
  PLAIN_STEP = ccStepTicks(FIREBALL);
  SLIDE_STEP = Math.floor(PLAIN_STEP / CC2_FLOOR_STEP_DIVISOR);
});

const CLONER_X = 7;
const SPAWN_X = CLONER_X + 1;
const CLONE_MACHINE = 'clone_machine';
const FORCE_CYCLE = 'force_cycle';
const FORCE_EAST = 'force_e';
const FLOOR = 'floor';
const FIREBALL = 'fireball';
/** A monster no floor affects (ignoresFloorEffects) and one no slide carries (ignoresSlidingFloors): both keep the full step. */
const GHOST = 'ghost';
const BLINKY = 'blinky';
const PLAYER_START_X = 2;
const PRESS_FRAME_1 = 1;
const LATE_RELEASE_FRAME = 2;
/** The one tick a clone released before the pass takes more than a slide-step clone does when the stretch stacks (the MAP099 t67/t68 gap). */
const BEFORE_PASS_TICKS = 1;
const WATCH_TICKS = 8;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

let SLIDE_STEP = 0;
let PLAIN_STEP = 0;

interface Release {
  type?: string;
  mode?: RoomMode;
  floor: string;
  beforePass?: boolean;
  frame?: 0 | 1 | 2;
}

/** Releases a clone onto `floor` east of the machine, as a press does; returns the engine and the clone. */
function release(opts: Release): { engine: GameEngine; clone: RuntimeEntity } {
  const type = opts.type ?? FIREBALL;
  const engine = new GameEngine();
  engine.loadLevel(
    room({
      mode: opts.mode ?? 'cc2',
      startX: PLAYER_START_X,
      terrain: { [`${CLONER_X},${ROOM_ROW}`]: CLONE_MACHINE, [`${SPAWN_X},${ROOM_ROW}`]: opts.floor },
      entities: [{ type, x: CLONER_X, y: ROOM_ROW, dir: 'E' }]
    })
  );
  if (opts.beforePass === true) worldOf(engine).cc2BeforePass = true;
  if (opts.frame !== undefined) worldOf(engine).cc2ReleaseFrame = opts.frame;
  spawnFromCloner(ctxOf(engine), CLONER_X, ROOM_ROW, type, 'E');
  const clone = engine.getEntities().find((e) => e.type === type && e.x === SPAWN_X && e.y === ROOM_ROW) as RuntimeEntity;
  return { engine, clone };
}

/** The tick (counted from 1) in which the clone first leaves its cell. */
function leavesAt(engine: GameEngine, clone: RuntimeEntity): number {
  for (let tick = 1; tick <= WATCH_TICKS; tick++) {
    engine.tick();
    if (clone.x !== SPAWN_X) return tick;
  }
  return -1;
}

describe('CC2 engine: a clone let out onto a slide takes the slide step time', () => {
  it.each([FORCE_EAST, FORCE_CYCLE, 'ice'])('gets the half step onto %s', (floor) => {
    expect(release({ floor }).clone.cooldownTicks).toBe(SLIDE_STEP - 1);
  });

  it('keeps the full step onto a plain cell', () => {
    expect(release({ floor: FLOOR }).clone.cooldownTicks).toBe(PLAIN_STEP - 1);
  });

  it('keeps the full step for a monster no floor or no slide affects', () => {
    for (const type of [GHOST, BLINKY]) {
      expect(release({ type, floor: FORCE_EAST }).clone.cooldownTicks, type).toBe(ccStepTicks(type) - 1);
    }
  });

  it('keeps the full step on a classic-rules level that is not on the CC2 engine', () => {
    expect(release({ mode: 'cc', floor: FORCE_EAST }).clone.cooldownTicks).toBe(PLAIN_STEP - 1);
  });
});

describe('CC2 engine: the release adjustments stack on the slide step', () => {
  it('a release before the pass onto a force floor gets the half step and no before-pass tick (MAP099 t65-t67)', () => {
    const { clone } = release({ floor: FORCE_CYCLE, beforePass: true, frame: PRESS_FRAME_1 });
    expect(clone.cooldownTicks).toBe(SLIDE_STEP - 1);
  });

  it('a release before the pass onto a plain cell keeps the full step plus the before-pass tick', () => {
    const { clone } = release({ floor: FLOOR, beforePass: true, frame: PRESS_FRAME_1 });
    expect(clone.cooldownTicks).toBe(PLAIN_STEP - 1 + BEFORE_PASS_TICKS);
  });

  it('a floor-free clone released before the pass keeps the full step plus the before-pass tick', () => {
    const { clone } = release({ type: GHOST, floor: FORCE_EAST, beforePass: true, frame: PRESS_FRAME_1 });
    expect(clone.cooldownTicks).toBe(ccStepTicks(GHOST) - 1 + BEFORE_PASS_TICKS);
  });

  it('a late release (frame 2) onto a force floor takes one tick off the half step', () => {
    const { clone } = release({ floor: FORCE_EAST, frame: LATE_RELEASE_FRAME });
    expect(clone.cooldownTicks).toBe(SLIDE_STEP - 1 - 1);
  });

  it('a late release onto a plain cell takes one tick off the full step', () => {
    const { clone } = release({ floor: FLOOR, frame: LATE_RELEASE_FRAME });
    expect(clone.cooldownTicks).toBe(PLAIN_STEP - 1 - 1);
  });

  it('the clone released before the pass onto a force floor leaves in the tick Lexy does, the plain clone a tick after its step', () => {
    const slide = release({ floor: FORCE_EAST, beforePass: true, frame: PRESS_FRAME_1 });
    const slideLeaves = leavesAt(slide.engine, slide.clone);
    const plain = release({ floor: FLOOR, beforePass: true, frame: PRESS_FRAME_1 });
    const plainLeaves = leavesAt(plain.engine, plain.clone);
    // The stretch would give the slide clone the same extra tick as the plain one: the half step of the plain clone plus one.
    expect(slideLeaves).toBe(SLIDE_STEP);
    expect(plainLeaves).toBe(PLAIN_STEP + BEFORE_PASS_TICKS);
  });
});
