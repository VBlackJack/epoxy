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
 * CC2 engine, wired blue pads (wave 15): a wired pad jumps only within its wire network and an unwired pad only to unwired
 * pads [Lexy's Labyrinth tiletypes.js:1877-1960, teleport_blue teleport_dest_order]. The lesson 6 shape: four pads, two networks
 * that cross. Native and classic levels, and levels without the field, keep the level-wide group.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { idleTicks, playMove } from '../../test/cc2Play';
import { CC2_TEST_RECORD, room } from '../../test/cc2Room';
import type { RoomMode } from '../../test/cc2Room';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const PAD = 'teleport_blue';
const WIDTH = 13;
const cell = (pad: { x: number; y: number }): number => pad.y * WIDTH + pad.x;
// Four pads in reading order: A, B on row 3, C, D on row 8. The player enters A (3,3) from the west, facing east.
const PAD_A = { x: 3, y: 3 };
const PAD_B = { x: 9, y: 3 };
const PAD_C = { x: 3, y: 8 };
const PAD_D = { x: 9, y: 8 };
const ENTRY_X = 2;
// The jump lands a few ticks after the step: the player walks onto the pad, the teleport settles and he steps out east.
const SETTLE_TICKS = 6;
const east = (pad: { x: number; y: number }) => ({ x: pad.x + 1, y: pad.y });
const PADS = [PAD_A, PAD_B, PAD_C, PAD_D];
const CROSSING_NETS = [[cell(PAD_A), cell(PAD_C)], [cell(PAD_B), cell(PAD_D)]];

function levelOf(mode: RoomMode, nets?: unknown): CompiledLevel {
  const terrain = Object.fromEntries(PADS.map((pad) => [`${pad.x},${pad.y}`, PAD]));
  const base = room({ mode, startX: ENTRY_X, terrain });
  const placed: CompiledLevel = { ...base, playerStart: { x: ENTRY_X, y: PAD_A.y, dir: 'E' } };
  if (nets === undefined) return placed;
  const record = { ...(placed.cc2 ?? CC2_TEST_RECORD), teleportNets: nets as number[][] };
  return { ...placed, cc2: record };
}

/** Enters the pad at A going east and returns the cell the player stands on once the jump has settled (the exit cell east of the destination pad). */
function jump(level: CompiledLevel): { x: number; y: number } {
  const engine = new GameEngine();
  engine.loadLevel(level);
  playMove(engine, 'E');
  idleTicks(engine, SETTLE_TICKS);
  const player = engine.getPlayer();
  return { x: player.x, y: player.y };
}

describe('wired blue pads on the CC2 engine', () => {
  it('without networks the ring is level-wide: from A the previous pad in reading order is D', () => {
    expect(jump(levelOf('cc2'))).toEqual(east(PAD_D));
  });

  it('jumps within its network: A and C share one, so the jump lands on C, not on D (lesson 6)', () => {
    expect(jump(levelOf('cc2', CROSSING_NETS))).toEqual(east(PAD_C));
  });

  it('the other pairing lands on B: A and B share one network', () => {
    expect(jump(levelOf('cc2', [[cell(PAD_A), cell(PAD_B)], [cell(PAD_C), cell(PAD_D)]]))).toEqual(east(PAD_B));
  });

  it('a pad alone in its network has no destination: he stays on the pad', () => {
    const nets = [[cell(PAD_A)], [cell(PAD_B), cell(PAD_C), cell(PAD_D)]];
    expect(jump(levelOf('cc2', nets))).toEqual(PAD_A);
  });

  it('an unwired pad skips every networked pad: from A it lands on C although D comes first in the ring', () => {
    expect(jump(levelOf('cc2', [[cell(PAD_B), cell(PAD_D)]]))).toEqual(east(PAD_C));
  });

  it('ignores a list that no longer fits the grid (a moved pad)', () => {
    expect(jump(levelOf('cc2', [[cell(PAD_A), cell({ x: PAD_C.x, y: PAD_C.y + 1 })]]))).toEqual(east(PAD_D));
  });

  it('ignores a list when a cell lies outside a resized grid', () => {
    expect(jump(levelOf('cc2', [[cell(PAD_A), cell(PAD_C)], [WIDTH * WIDTH + 5]]))).toEqual(east(PAD_D));
  });
});

describe('the same pads on the other rulesets', () => {
  // Only a CC2 record carries networks, and the record is what selects the CC2 engine: a native or classic level has none.
  it('a native level keeps the level-wide ring', () => {
    expect(levelOf('native').cc2).toBeUndefined();
    expect(jump(levelOf('native'))).not.toEqual(east(PAD_C));
  });

  it('a classic level keeps the level-wide ring', () => {
    expect(levelOf('cc').cc2).toBeUndefined();
    expect(jump(levelOf('cc'))).not.toEqual(east(PAD_C));
  });
});
