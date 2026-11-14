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

import { playMove } from '../../test/cc2Play';
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { buildTestLevel } from '../../test/buildTestLevel';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
const ROW = 1;
const BLOCK_X = 2;
const WATER_X = 3;
const RUN_PASSES = 12;
const ICE_START_ROW = 3;
/** The ice block ends on the sunk-water cell over CC2 dirt, one cell short of it behind plain dirt. */
const ICE_ROW_ON_DIRT = 1;
const ICE_ROW_BELOW_DIRT = 2;
const WALK_WAIT_PASSES = 10;
/** The uid the first entity of a level gets. */
const FIRST_BLOCK_UID = 1;

interface SpentWorld {
  turnSpent: Map<number, number>;
  ccMonsterClock: number;
}

const worldOf = (engine: GameEngine): SpentWorld => (engine as unknown as { w: SpentWorld }).w;

function room(mode: 'cc2' | 'cc', blockType: string, rows: string[]): CompiledLevel {
  const built = buildTestLevel(rows, { entities: [{ type: blockType, x: BLOCK_X, y: ROW, dir: 'E' }] });
  return mode === 'cc2' ? { ...built, cc2: CC2_RECORD } : { ...built, rulesFlavor: 'cc' };
}

/** Pushes east once and records where the first block is after each pass. */
function trace(engine: GameEngine): string[] {
  const out: string[] = [];
  engine.getPlayer().moveCooldown = 0;
  engine.attemptPlayerMove('E');
  for (let i = 0; i < RUN_PASSES; i++) {
    engine.tick();
    const block = engine.getEntities().find((e) => e.kind === 'block');
    out.push(block === undefined ? 'gone' : `${block.x},${block.y}`);
  }
  return out;
}

describe('CC2 turn-spent bookkeeping', () => {
  it('leaves nothing behind after a pass', () => {
    const engine = new GameEngine();
    engine.loadLevel(room('cc2', 'dirt_block', ['#########', '#@......#', '#########']));
    trace(engine);
    expect(worldOf(engine).turnSpent.size).toBe(0);
  });

  it('gives the same result on a restart as on the first run', () => {
    const level = room('cc2', 'dirt_block', ['#########', '#@......#', '#########']);
    const engine = new GameEngine();
    engine.loadLevel(level);
    const first = trace(engine);
    engine.loadLevel(level);
    expect(trace(engine)).toEqual(first);
  });

  it('drops a stale entry on a level load', () => {
    const level = room('cc2', 'dirt_block', ['#########', '#@......#', '#########']);
    const engine = new GameEngine();
    engine.loadLevel(level);
    const first = trace(engine);
    worldOf(engine).turnSpent.set(FIRST_BLOCK_UID, worldOf(engine).ccMonsterClock);
    engine.loadLevel(level);
    expect(worldOf(engine).turnSpent.size).toBe(0);
    expect(trace(engine)).toEqual(first);
  });

  it('does not make a block of a classic-rules level skip its turn after a CC2 level', () => {
    const rows = ['#########', '#@.IIII.#', '#########'];
    const fresh = new GameEngine();
    fresh.loadLevel(room('cc', 'dirt_block', rows));
    const expected = trace(fresh);

    const engine = new GameEngine();
    engine.loadLevel(room('cc2', 'dirt_block', ['#########', '#@......#', '#########']));
    trace(engine);
    engine.loadLevel(room('cc', 'dirt_block', rows));
    worldOf(engine).turnSpent.set(FIRST_BLOCK_UID, worldOf(engine).ccMonsterClock);
    expect(trace(engine)).toEqual(expected);
  });
});

describe('CC2 dirt block sunk in water', () => {
  it('fills the water with CC2 dirt on a CC2 level and with plain dirt elsewhere', () => {
    const rows = ['#########', '#@.W....#', '#########'];
    for (const [mode, expected] of [['cc2', 'dirt_cc2'], ['cc', 'dirt']] as const) {
      const engine = new GameEngine();
      engine.loadLevel(room(mode, 'dirt_block', rows));
      trace(engine);
      expect(engine.getTerrain()[ROW][WATER_X], mode).toBe(expected);
    }
  });

  it('lets an ice block cross the CC2 dirt it left, where plain dirt would stop it', () => {
    const rows = ['#########', '#@.W....#', '#.......#', '#.......#', '#.......#', '#########'];
    for (const [mode, expectedY] of [['cc2', ICE_ROW_ON_DIRT], ['cc', ICE_ROW_BELOW_DIRT]] as const) {
      const built = buildTestLevel(rows, {
        entities: [
          { type: 'dirt_block', x: BLOCK_X, y: ROW, dir: 'E' },
          { type: 'ice_block', x: WATER_X, y: ICE_START_ROW, dir: 'N' }
        ]
      });
      const engine = new GameEngine();
      engine.loadLevel(mode === 'cc2' ? { ...built, cc2: CC2_RECORD } : { ...built, rulesFlavor: 'cc' });
      trace(engine);
      for (const dir of ['S', 'S', 'S', 'E', 'N', 'N', 'N'] as const) {
        for (let i = 0; i < WALK_WAIT_PASSES; i++) {
          engine.getPlayer().moveCooldown = 0;
          if (playMove(engine, dir).moved) break;
        }
      }
      for (let i = 0; i < RUN_PASSES; i++) engine.tick();
      const ice = engine.getEntities().find((e) => e.type === 'ice_block');
      expect(ice?.x, mode).toBe(WATER_X);
      expect(ice?.y, mode).toBe(expectedY);
    }
  });
});
