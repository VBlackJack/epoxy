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

/** CC2 engine: lit dynamite is an actor that bars the player from its cell (Lexy tiletypes.js dynamite_lit blocks_collision). */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { buildTestLevel } from '../../test/buildTestLevel';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { playMove } from '../../test/cc2Play';
import { DYNAMITE_ITEM_ID, DYNAMITE_LIT_ITEM_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROWS = ['#######', '#@....#', '#######'];
const LIT_CELL = { x: 2, y: 1 };
const FAR_FUSE_TICK = 100000;

type Mode = 'cc2' | 'cc' | 'native';

function fixture(mode: Mode): { engine: GameEngine; w: EpoxyWorld } {
  const built = buildTestLevel(ROWS);
  const level: CompiledLevel = {
    ...built,
    ...(mode === 'cc2' ? { cc2: CC2_RECORD } : mode === 'cc' ? { rulesFlavor: 'cc' as const } : {})
  };
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = (engine as unknown as { w: EpoxyWorld }).w;
  return { engine, w };
}

function lightAt(w: EpoxyWorld, awaitingDeparture: boolean): void {
  w.items[LIT_CELL.y][LIT_CELL.x] = awaitingDeparture ? DYNAMITE_ITEM_ID : DYNAMITE_LIT_ITEM_ID;
  w.litCharges.push({
    ...LIT_CELL,
    detonateTick: FAR_FUSE_TICK,
    dynamite: true,
    ...(awaitingDeparture ? { awaitingDeparture: true as const } : {})
  });
}

describe('lit dynamite bars the player (CC2 engine)', () => {
  it('refuses the step into a lit dynamite on a CC2 level', () => {
    const { engine, w } = fixture('cc2');
    lightAt(w, false);
    const from = { x: w.player.x, y: w.player.y };
    expect(playMove(engine, 'E').moved).toBe(false);
    expect({ x: w.player.x, y: w.player.y }).toEqual(from);
  });

  // A set-down charge is under the player who set it: he cannot step onto it, he steps off it and it lights (Lexy tiletypes.js
  // dynamite on_depart -> dynamite_lit), so the step off the charge succeeds and leaves a lit charge behind.
  it('lets the player step off a dynamite he set down, which lights as he leaves', () => {
    const { engine, w } = fixture('cc2');
    w.player.x = LIT_CELL.x;
    lightAt(w, true);
    expect(playMove(engine, 'E').moved).toBe(true);
    expect({ x: w.player.x, y: w.player.y }).toEqual({ x: LIT_CELL.x + 1, y: LIT_CELL.y });
    expect(w.items[LIT_CELL.y][LIT_CELL.x]).toBe(DYNAMITE_LIT_ITEM_ID);
    expect(w.litCharges.some((c) => c.x === LIT_CELL.x && c.y === LIT_CELL.y && c.awaitingDeparture !== true)).toBe(true);
  });

  it.each(['cc', 'native'] as const)('does not bar the player on a %s level', (mode) => {
    const { engine, w } = fixture(mode);
    lightAt(w, false);
    expect(playMove(engine, 'E').accepted).toBe(true);
    expect({ x: w.player.x, y: w.player.y }).toEqual(LIT_CELL);
  });
});
