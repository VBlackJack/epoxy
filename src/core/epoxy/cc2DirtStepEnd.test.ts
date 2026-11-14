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
 * CC2 engine: the dirt the player packs down turns to floor when his step ends, not when it starts (Lexy tiletypes.js
 * dirt on_arrive). Until then monsters find the cell shut.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { buildTestLevel } from '../../test/buildTestLevel';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { FLOOR_TILE_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel } from '../types';
import { canMonsterEnter } from './epoxyMonsters';
import type { EpoxyWorld } from './epoxyWorld';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROWS = ['#######', '#@....#', '#######'];
const DIRT = { x: 2, y: 1 };
const GLIDER_CELL = { x: 3, y: 1 };
const DIRT_TILES = ['dirt', 'dirt_cc2'] as const;
const MAX_STEP_TICKS = 40;

type Mode = 'cc2' | 'cc' | 'native';

function fixture(mode: Mode, dirt: string): { engine: GameEngine; w: EpoxyWorld } {
  const built = buildTestLevel(ROWS, { entities: [{ type: 'glider', ...GLIDER_CELL, dir: 'W' }] });
  const level: CompiledLevel = {
    ...built,
    ...(mode === 'cc2' ? { cc2: CC2_RECORD } : mode === 'cc' ? { rulesFlavor: 'cc' as const } : {})
  };
  const engine = new GameEngine();
  engine.loadLevel(level);
  const w = (engine as unknown as { w: EpoxyWorld }).w;
  w.terrain[DIRT.y][DIRT.x] = dirt;
  return { engine, w };
}

function terrainAtDirt(w: EpoxyWorld): string {
  return w.terrain[DIRT.y][DIRT.x];
}

describe.each(DIRT_TILES)('%s packed down by the player', (dirt) => {
  it('stays dirt and shut to monsters until his step ends, then turns to floor (CC2 engine)', () => {
    const { engine, w } = fixture('cc2', dirt);
    const glider = w.entities.find((e) => e.kind === 'monster');
    if (glider === undefined) throw new Error('the glider is missing');
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect({ x: w.player.x, y: w.player.y }).toEqual(DIRT);
    expect(terrainAtDirt(w)).toBe(dirt);
    expect(w.player.cc3dArrival?.opening).toEqual(DIRT);
    expect(canMonsterEnter(w, glider, 'W')).toBe(false);
    let ticks = 0;
    while (w.player.cc3dArrival !== undefined && ticks < MAX_STEP_TICKS) {
      expect(terrainAtDirt(w)).toBe(dirt);
      engine.tick();
      ticks++;
    }
    expect(w.player.cc3dArrival).toBeUndefined();
    expect(terrainAtDirt(w)).toBe(FLOOR_TILE_ID);
  });

  it.each(['cc', 'native'] as const)('turns to floor at the start of the step on a %s level', (mode) => {
    const { engine, w } = fixture(mode, dirt);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(terrainAtDirt(w)).toBe(FLOOR_TILE_ID);
    expect(w.player.cc3dArrival?.opening).toBeUndefined();
  });
});
