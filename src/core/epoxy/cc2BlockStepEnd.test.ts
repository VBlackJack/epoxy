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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel, Direction } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const WATER_X = 3;
/** Most passes a test waits for something that must happen. */
const MAX_WAIT_PASSES = 20;

type Mode = 'cc2' | 'cc';

interface BlockWorld {
  terrain: string[][];
  entities: { uid: number; type: string; kind: string; x: number; y: number; dir: Direction; isSliding: boolean; cooldownTicks: number; arrivalTicks?: number }[];
}

function room(mode: Mode, rows: string[], blocks: { x: number; dir?: Direction }[], type = 'dirt_block'): CompiledLevel {
  const built = buildTestLevel(rows, { entities: blocks.map((b) => ({ type, x: b.x, y: ROW, dir: b.dir ?? 'E' })) });
  return mode === 'cc2' ? { ...built, cc2: CC2_RECORD } : { ...built, rulesFlavor: 'cc' };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

const worldOf = (engine: GameEngine): BlockWorld => (engine as unknown as { w: BlockWorld }).w;

/** Passes run after the push until the water ahead is filled (null when it never is). */
function passesToFill(mode: Mode): number | null {
  const engine = load(room(mode, ['#########', '#@.W....#', '#########'], [{ x: 2 }]));
  expect(engine.attemptPlayerMove('E')).toBe(true);
  for (let pass = 0; pass <= MAX_WAIT_PASSES; pass++) {
    if (engine.getTerrain()[ROW][WATER_X] !== 'water') return pass;
    engine.tick();
  }
  return null;
}

describe('CC2 block arrival at the end of the step', () => {
  it('fills the water when the pushed block step ends, not when it starts', () => {
    expect(passesToFill('cc')).toBe(0);
    const cc2 = passesToFill('cc2');
    expect(cc2).not.toBeNull();
    expect(cc2 as number).toBeGreaterThan(0);
  });

  it('lets a block slide into the cell a block ahead of it is leaving by sinking', () => {
    const engine = load(room('cc2', ['#########', '#@..II...#', '#########'], [{ x: 6 }, { x: 5 }], 'ice_block'));
    const w = worldOf(engine);
    const ahead = w.entities.find((e) => e.x === 6) as BlockWorld['entities'][number];
    const behind = w.entities.find((e) => e.x === 5) as BlockWorld['entities'][number];
    w.terrain[ROW][6] = 'water';
    ahead.arrivalTicks = 1;
    behind.isSliding = true;
    behind.dir = 'E';
    behind.cooldownTicks = 0;
    engine.tick();
    expect(w.terrain[ROW][6]).not.toBe('water');
    expect(w.entities.some((e) => e.uid === ahead.uid)).toBe(false);
    expect(behind.x).toBe(6);
  });
});
