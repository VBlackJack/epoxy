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
 * CC2 engine, wave 15 world state: the wired blue pad networks read at load (buildCc2PadNets) and the player frame marks
 * (cc2SlideFrame, cc2FrameRetry, cc2PrePassMoved) in the hidden state key and cleared by a swap. The marks follow the frame rules
 * of Lexy (game.js:869-888 the pre-pass, game.js:1127-1162 the refused forced step).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CC2_TEST_RECORD, room, ROOM_ROW } from '../../test/cc2Room';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';
import { buildCc2PadNets, cc2HiddenStateKey, rotatePlayers } from './epoxyWorld';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const PAD = 'teleport_blue';
const WIDTH = 13;
const cell = (x: number, y: number): number => y * WIDTH + x;
const PAD_A = { x: 3, y: 3 };
const PAD_B = { x: 9, y: 3 };
const PAD_C = { x: 3, y: 8 };
const PAD_TERRAIN = { [`${PAD_A.x},${PAD_A.y}`]: PAD, [`${PAD_B.x},${PAD_B.y}`]: PAD, [`${PAD_C.x},${PAD_C.y}`]: PAD };
const CONTROLLED_X = 6;
const PARKED_X = 4;

function padLevel(nets: unknown): CompiledLevel {
  const level = room({ mode: 'cc2', terrain: PAD_TERRAIN });
  return { ...level, cc2: { ...CC2_TEST_RECORD, teleportNets: nets as number[][] } };
}

const worldOf = (engine: GameEngine): EpoxyWorld => (engine as unknown as { w: EpoxyWorld }).w;

describe('buildCc2PadNets', () => {
  it('maps every listed pad to its network index', () => {
    const level = padLevel([[cell(PAD_A.x, PAD_A.y), cell(PAD_C.x, PAD_C.y)], [cell(PAD_B.x, PAD_B.y)]]);
    const map = buildCc2PadNets(level, level.terrain);
    expect(map?.get(cell(PAD_A.x, PAD_A.y))).toBe(0);
    expect(map?.get(cell(PAD_C.x, PAD_C.y))).toBe(0);
    expect(map?.get(cell(PAD_B.x, PAD_B.y))).toBe(1);
    expect(map?.size).toBe(3);
  });

  it('is undefined without the field', () => {
    const level = room({ mode: 'cc2', terrain: PAD_TERRAIN });
    expect(buildCc2PadNets(level, level.terrain)).toBeUndefined();
  });

  it('ignores the whole list when a cell lies outside the grid', () => {
    for (const bad of [WIDTH * WIDTH, -1]) {
      const level = padLevel([[cell(PAD_A.x, PAD_A.y)], [bad]]);
      expect(buildCc2PadNets(level, level.terrain)).toBeUndefined();
    }
  });

  it('ignores the whole list when a listed cell is not a blue pad (a moved pad)', () => {
    const level = padLevel([[cell(PAD_A.x, PAD_A.y), cell(PAD_A.x + 1, PAD_A.y)]]);
    expect(buildCc2PadNets(level, level.terrain)).toBeUndefined();
  });

  it('ignores the whole list when a cell is listed twice', () => {
    const level = padLevel([[cell(PAD_A.x, PAD_A.y)], [cell(PAD_A.x, PAD_A.y), cell(PAD_B.x, PAD_B.y)]]);
    expect(buildCc2PadNets(level, level.terrain)).toBeUndefined();
  });

  it('ignores a malformed list: not a list, an empty network, a non-integer cell', () => {
    for (const bad of ['x', [[]], [[1.5]], [['a']], [7], { 0: [1] }]) {
      const level = padLevel(bad);
      expect(buildCc2PadNets(level, level.terrain)).toBeUndefined();
    }
  });

  it('is read at world load, and ignored once the grid no longer holds the pads', () => {
    const engine = new GameEngine();
    engine.loadLevel(padLevel([[cell(PAD_A.x, PAD_A.y), cell(PAD_B.x, PAD_B.y)]]));
    expect(worldOf(engine).cc2PadNets?.get(cell(PAD_B.x, PAD_B.y))).toBe(0);
    const level = padLevel([[cell(PAD_A.x, PAD_A.y), cell(PAD_B.x, PAD_B.y)]]);
    const narrow = { ...level, terrain: level.terrain.map((row) => row.slice(0, PAD_B.x)) };
    expect(buildCc2PadNets(narrow, narrow.terrain)).toBeUndefined();
  });
});

describe('player frame marks', () => {
  function twoPlayers(): EpoxyWorld {
    const engine = new GameEngine();
    const base = room({ mode: 'cc2', startX: CONTROLLED_X });
    engine.loadLevel({ ...base, extraPlayers: [{ x: PARKED_X, y: ROOM_ROW, dir: 'W' as const, character: 'chip' as const }] });
    return worldOf(engine);
  }

  it('the hidden state key differs with and without each mark', () => {
    const w = twoPlayers();
    const bare = cc2HiddenStateKey(w);
    w.player.cc2SlideFrame = 0;
    const slide0 = cc2HiddenStateKey(w);
    w.player.cc2SlideFrame = 1;
    const slide1 = cc2HiddenStateKey(w);
    delete w.player.cc2SlideFrame;
    w.player.cc2FrameRetry = true;
    const retry = cc2HiddenStateKey(w);
    delete w.player.cc2FrameRetry;
    w.player.cc2PrePassMoved = true;
    const moved = cc2HiddenStateKey(w);
    delete w.player.cc2PrePassMoved;
    expect(new Set([bare, slide0, slide1, retry, moved]).size).toBe(5);
    expect(cc2HiddenStateKey(w)).toBe(bare);
  });

  it('the hidden state key carries the marks of a parked player', () => {
    const w = twoPlayers();
    const bare = cc2HiddenStateKey(w);
    w.parked[0].cc2FrameRetry = true;
    expect(cc2HiddenStateKey(w)).not.toBe(bare);
  });

  it('a swap clears the marks of every player', () => {
    const w = twoPlayers();
    for (const p of [w.player, ...w.parked]) {
      p.cc2SlideFrame = 1;
      p.cc2FrameRetry = true;
      p.cc2PrePassMoved = true;
    }
    expect(rotatePlayers(w)).toBe(true);
    for (const p of [w.player, ...w.parked]) {
      expect('cc2SlideFrame' in p).toBe(false);
      expect('cc2FrameRetry' in p).toBe(false);
      expect('cc2PrePassMoved' in p).toBe(false);
    }
  });
});
