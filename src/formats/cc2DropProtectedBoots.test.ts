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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { GameEngine } from '../core/GameEngine';
import type { CompiledLevel, Direction } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { C2M_TAGS, type Cc2RawSection } from './cc2Model';
import { CC2_FRAMES_PER_TICK, CC2_REPLAY_ACTION_BITS, CC2_REPLAY_KEY_BITS, decodeCc2Replay } from './cc2Replay';
import { checkCc2Replay } from './cc2ReplayCheck';
import { FLOOR_CODE, makeMap, player, put } from './cc2TestMaps';
import { convertCc2Map } from './cc2ToEpoxy';

const CODE_FIRE = 0x09;
const CODE_FIRE_BOOTS = 0x3d;
const CODE_NO_SIGN = 0x7f;
const CODE_EXIT = 0x14;
const FIRE_BOOTS_ID = 'boots_fire';
const MAP_WIDTH = 6;
const FIRE_X = 2;
const BARRED_X = 3;
const EXIT_X = 4;
const STEP_FRAMES = 4 * CC2_FRAMES_PER_TICK;
const MOVE_WAIT_TICKS = 20;
const RUN_TICKS = 60;

/** Floor, fire boots, fire, a cell barred to fire boots (a no-sign over the boots), the exit. */
function fireLevel(): CompiledLevel {
  const map = makeMap(MAP_WIDTH, 1, [
    player(0, 0),
    put(1, 0, { code: CODE_FIRE_BOOTS }, { code: FLOOR_CODE }),
    put(FIRE_X, 0, { code: CODE_FIRE }),
    put(BARRED_X, 0, { code: CODE_FIRE_BOOTS }, { code: CODE_NO_SIGN }, { code: FLOOR_CODE }),
    put(EXIT_X, 0, { code: CODE_EXIT })
  ]);
  return convertCc2Map(map, { file: 'synthetic.c2m', order: 1, sha256: 'ef'.repeat(32) }).level;
}

function step(engine: GameEngine, dir: Direction): void {
  let waited = 0;
  while (!engine.attemptPlayerMove(dir)) {
    engine.tick();
    if (++waited > MOVE_WAIT_TICKS) throw new Error(`move ${dir} refused`);
  }
  engine.tick();
}

function standOnFireWithBoots(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (let i = 0; i < FIRE_X; i++) step(engine, 'E');
  expect(engine.getPlayer()).toMatchObject({ x: FIRE_X, alive: true });
  expect(engine.holdsItem(FIRE_BOOTS_ID)).toBe(true);
  return engine;
}

beforeAll(() => {
  loadTestConfigs();
});

describe('dropping the boots that protect the current cell', () => {
  it('is allowed on a level imported from CC2, and the player lives on', () => {
    const level = fireLevel();
    expect(level.cc2).toBeDefined();
    const engine = standOnFireWithBoots(level);
    expect(engine.dropItem(FIRE_BOOTS_ID)).toBe(true);
    for (let i = 0; i < MOVE_WAIT_TICKS; i++) engine.tick();
    expect(engine.getPlayer()).toMatchObject({ x: FIRE_X, alive: true });
    expect(engine.getItems()[0][FIRE_X]).toBe(FIRE_BOOTS_ID);
    // Walks on through the cell barred to fire boots, then to the exit.
    step(engine, 'E');
    step(engine, 'E');
    for (let i = 0; i < MOVE_WAIT_TICKS; i++) engine.tick();
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('leaves the dropped boots on the fire cell, where they can be picked up again', () => {
    const engine = standOnFireWithBoots(fireLevel());
    engine.dropItem(FIRE_BOOTS_ID);
    step(engine, 'W');
    expect(engine.getItems()[0][FIRE_X]).toBe(FIRE_BOOTS_ID);
    step(engine, 'E');
    expect(engine.getPlayer().x).toBe(FIRE_X);
    expect(engine.getPlayer().alive).toBe(true);
    expect(engine.holdsItem(FIRE_BOOTS_ID)).toBe(true);
  });

  it('is still refused on a native level', () => {
    const { cc2: _record, ...native } = fireLevel();
    const engine = standOnFireWithBoots(native as CompiledLevel);
    expect(engine.dropItem(FIRE_BOOTS_ID)).toBe(false);
    expect(engine.getStatusBannerKey()).toBe('hud.messages.drop_protected');
    expect(engine.holdsItem(FIRE_BOOTS_ID)).toBe(true);
  });
});

describe('replay check and the drop key', () => {
  it('plays the drop of the oldest boots', () => {
    const { E } = CC2_REPLAY_KEY_BITS;
    const stream = Uint8Array.from([
      0, 0, 0,
      0, E,
      FIRE_X * STEP_FRAMES, 0,
      CC2_FRAMES_PER_TICK, CC2_REPLAY_ACTION_BITS.drop,
      CC2_FRAMES_PER_TICK, 0,
      CC2_FRAMES_PER_TICK, E,
      RUN_TICKS * CC2_FRAMES_PER_TICK, 0
    ]);
    const section: Cc2RawSection = { kind: 'raw', tag: C2M_TAGS.replay, data: stream };
    const replay = decodeCc2Replay(section);
    const level = fireLevel();
    expect(checkCc2Replay(level, replay, 'held').won).toBe(true);
    expect(checkCc2Replay(level, replay, 'steps').won).toBe(false);
  });
});
