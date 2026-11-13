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

import { loadTestConfigs } from '../test/loadTestConfigs';
import { C2M_TAGS, type Cc2RawSection } from './cc2Model';
import { CC2_FRAMES_PER_TICK, CC2_REPLAY_ACTION_BITS, CC2_REPLAY_KEY_BITS, decodeCc2Replay } from './cc2Replay';
import { checkCc2Replay } from './cc2ReplayCheck';
import { FLOOR_CODE, makeMap, player, put } from './cc2TestMaps';
import { convertCc2Map } from './cc2ToEpoxy';

const CODE_WATER = 0x08;
const CODE_EXIT = 0x14;
const CODE_DYNAMITE = 0x51;
const CODE_FIRE_BOOTS = 0x3d;
const CODE_FLIPPERS = 0x3e;
const STEP_FRAMES = 4 * CC2_FRAMES_PER_TICK;
const HALF_STEP_FRAMES = STEP_FRAMES / 2;
/** The pickups are behind the player by tick 12; it decides again every fourth tick, before the water. */
const FIRST_PRESS_FRAMES = 12 * CC2_FRAMES_PER_TICK;
const RELEASE_FRAMES = 14 * STEP_FRAMES;
const LEVEL_WIDTH = 12;
const WATER_X = 8;
const EXIT_X = 11;

const { E } = CC2_REPLAY_KEY_BITS;
const { cycleInventory, drop } = CC2_REPLAY_ACTION_BITS;

type Entry = [delay: number, keys: number];

function replayOf(entries: readonly Entry[]) {
  const stream = Uint8Array.from([0, 0, 0, ...entries.flat()]);
  const section: Cc2RawSection = { kind: 'raw', tag: C2M_TAGS.replay, data: stream };
  return decodeCc2Replay(section);
}

/**
 * Dynamite, then flippers, then fire boots on the way to water: the belt holds them in that order, so the oldest tool is
 * the dynamite, while the oldest pair of boots is the flippers. Only the flippers get the player across.
 */
function beltRun() {
  return convertCc2Map(
    makeMap(LEVEL_WIDTH, 1, [
      player(0, 0),
      put(1, 0, { code: CODE_DYNAMITE }, { code: FLOOR_CODE }),
      put(2, 0, { code: CODE_FLIPPERS }, { code: FLOOR_CODE }),
      put(3, 0, { code: CODE_FIRE_BOOTS }, { code: FLOOR_CODE }),
      put(WATER_X, 0, { code: CODE_WATER }),
      put(EXIT_X, 0, { code: CODE_EXIT })
    ]),
    { file: 'synthetic.c2m', order: 1, sha256: 'cd'.repeat(32) }
  ).level;
}

const dropOnly = () => replayOf([[0, E], [FIRST_PRESS_FRAMES, E | drop], [RELEASE_FRAMES, 0]]);

/** Presses cycle `cycles` times, each press after a release, then the drop key. */
const cycleThenDrop = (cycles: number) => {
  const entries: Entry[] = [[0, E], [FIRST_PRESS_FRAMES, E | cycleInventory]];
  // Each key goes up for two ticks and comes down again at the next decision, four ticks after the one before.
  for (let i = 1; i < cycles; i++) entries.push([HALF_STEP_FRAMES, E], [HALF_STEP_FRAMES, E | cycleInventory]);
  entries.push([HALF_STEP_FRAMES, E], [HALF_STEP_FRAMES, E | drop], [RELEASE_FRAMES, 0]);
  return replayOf(entries);
};

beforeAll(() => {
  loadTestConfigs();
});

describe('the tool belt of the held strategy on a CC2-engine level', () => {
  it('drops the oldest tool, the dynamite, and keeps both pairs of boots', () => {
    expect(checkCc2Replay(beltRun(), dropOnly(), 'held').won).toBe(true);
  });

  it('cycles the oldest tool to the end, so that the drop puts down the flippers', () => {
    expect(checkCc2Replay(beltRun(), cycleThenDrop(1), 'held').won).toBe(false);
  });

  it('puts down the fire boots after two cycles, which keeps the flippers', () => {
    expect(checkCc2Replay(beltRun(), cycleThenDrop(2), 'held').won).toBe(true);
  });
});

describe('the tool belt off the CC2 engine', () => {
  it('keeps dropping the oldest pair of boots, which here are the flippers', () => {
    const level = beltRun();
    level.cc2 = undefined;
    expect(checkCc2Replay(level, dropOnly(), 'held').won).toBe(false);
  });
});
