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
 * CC2 engine, wave 11 (FT, FTM): a clone released by a wire edge of press frame p ends its out-of-turn step at frame p - 1
 * (Lexy attempt_out_of_turn_step spends a frame at once, game.js:2218-2242; the tic runs frames 0, 1 and 2, game.js:869-888).
 * A frame-2 release takes one tick less; the clone carries frame (p + 2) mod 3 for its own press unless that is the default
 * frame 1. The release frame is consumed on read. The full chain rhythm is tested with the engine. Other levels are unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { ROOM_ROW, room, type RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import { spawnFromCloner } from './epoxyDevices';
import type { EpoxyContext, EpoxyWorld } from './epoxyWorld';

const CLONER_X = 7;
const CLONER_Y = 8;
const SPAWN_X = CLONER_X + 1;
const PUSHED_BLOCK_X = 3;
const PUSH_WAIT_TICKS = 20;
const MONSTER = 'bouncer';
const BLOCK = 'dirt_block';
const FRAME_0 = 0;
const FRAME_1 = 1;
const FRAME_2 = 2;
/** The clone of a press at frame p carries frame (p + 2) mod 3: 2 after frame 0, 0 after frame 1, the default 1 after frame 2. */
const CARRIED_AFTER_FRAME_0 = 2;
const CARRIED_AFTER_FRAME_1 = 0;
/** The measured waits of a clone with no release frame (the reference). */
const MONSTER_WAIT = 3;
const BLOCK_ARRIVAL_WAIT = 4;

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;
const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function clone(mode: RoomMode, type: string, frame?: 0 | 1 | 2) {
  const engine = new GameEngine();
  engine.loadLevel(
    room({ mode, terrain: { [`${CLONER_X},${CLONER_Y}`]: 'clone_machine' }, entities: [{ type, x: CLONER_X, y: CLONER_Y, dir: 'E' }] })
  );
  const w = worldOf(engine);
  if (frame !== undefined) w.cc2ReleaseFrame = frame;
  spawnFromCloner(ctxOf(engine), CLONER_X, CLONER_Y, type, 'E');
  return { w, spawned: engine.getEntities().find((e) => e.type === type && e.x === SPAWN_X && e.y === CLONER_Y) };
}

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 engine: the release frame of a clone', () => {
  it('leaves a clone with no release frame as it was', () => {
    const monster = clone('cc2', MONSTER).spawned;
    expect(monster?.cooldownTicks).toBe(MONSTER_WAIT);
    expect(monster?.cc2Frame).toBeUndefined();
    const block = clone('cc2', BLOCK).spawned;
    expect(block?.arrivalTicks).toBe(BLOCK_ARRIVAL_WAIT);
    expect(block?.cc2Frame).toBeUndefined();
  });

  it.each([
    [FRAME_0, MONSTER_WAIT, CARRIED_AFTER_FRAME_0],
    [FRAME_1, MONSTER_WAIT, CARRIED_AFTER_FRAME_1],
    [FRAME_2, MONSTER_WAIT - 1, undefined]
  ] as const)('a monster clone of a frame %i release waits %i and carries frame %s', (frame, wait, carried) => {
    const { spawned } = clone('cc2', MONSTER, frame);
    expect(spawned?.cooldownTicks).toBe(wait);
    expect(spawned?.cc2Frame).toBe(carried);
  });

  it.each([
    [FRAME_0, BLOCK_ARRIVAL_WAIT, CARRIED_AFTER_FRAME_0],
    [FRAME_1, BLOCK_ARRIVAL_WAIT, CARRIED_AFTER_FRAME_1],
    [FRAME_2, BLOCK_ARRIVAL_WAIT - 1, undefined]
  ] as const)('a block clone of a frame %i release arrives in %i and carries frame %s', (frame, wait, carried) => {
    const { spawned } = clone('cc2', BLOCK, frame);
    expect(spawned?.arrivalTicks).toBe(wait);
    expect(spawned?.cc2Frame).toBe(carried);
  });

  it.each([MONSTER, BLOCK])('consumes the release frame of a %s clone on read', (type) => {
    const { w } = clone('cc2', type, FRAME_2);
    expect(w.cc2ReleaseFrame).toBeUndefined();
  });

  it.each(['cc', 'native'] as RoomMode[])('ignores the release frame outside the CC2 engine (%s)', (mode) => {
    const reference = clone(mode, MONSTER).spawned;
    const tagged = clone(mode, MONSTER, FRAME_2).spawned;
    expect(tagged?.cooldownTicks).toBe(reference?.cooldownTicks);
    expect(tagged?.cc2Frame).toBeUndefined();
    const referenceBlock = clone(mode, BLOCK).spawned;
    const taggedBlock = clone(mode, BLOCK, FRAME_0).spawned;
    expect(taggedBlock?.arrivalTicks).toBe(referenceBlock?.arrivalTicks);
    expect(taggedBlock?.cc2Frame).toBeUndefined();
  });

  it('forgets the carried frame when a block takes a new step', () => {
    const engine = new GameEngine();
    engine.loadLevel(room({ mode: 'cc2', entities: [{ type: BLOCK, x: PUSHED_BLOCK_X, y: ROOM_ROW, dir: 'E' }] }));
    const block = worldOf(engine).entities.find((e) => e.type === BLOCK);
    if (block === undefined) throw new Error('the room has a block');
    block.cc2Frame = CARRIED_AFTER_FRAME_0;
    const push = engine.attemptPlayerMove('E');
    expect(push).toBe(true);
    for (let i = 0; i < PUSH_WAIT_TICKS && block.x === PUSHED_BLOCK_X; i++) engine.tick();
    expect(block.x).toBe(PUSHED_BLOCK_X + 1);
    expect(block.cc2Frame).toBeUndefined();
  });
});