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
import type { Cc2LevelData, CompiledLevel } from '../types';

beforeEach(() => {
  loadTestConfigs();
});

const CC2_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;
/** Passes a splash bars the real player (Lexy: 16 frames at three frames a pass, gone on the fifth). */
const SPLASH_PASSES = 5;
/** Most passes the block's step takes to end. */
const SINK_WAIT_PASSES = 8;
const BLOCK_X = 2;
const WATER_X = 3;
const ROW = 1;

type Mode = 'cc2' | 'cc' | 'plain';

interface SplashWorld {
  blockSplashes: Map<number, number>;
  ccMonsterClock: number;
}

function room(mode: Mode, rows: string[] = ['#########', '#@.W....#', '#########']): CompiledLevel {
  const built = buildTestLevel(rows, { entities: [{ type: 'dirt_block', x: BLOCK_X, y: ROW, dir: 'E' }] });
  if (mode === 'cc2') return { ...built, cc2: CC2_RECORD };
  return mode === 'cc' ? { ...built, rulesFlavor: 'cc' } : built;
}

const worldOf = (engine: GameEngine): SplashWorld => (engine as unknown as { w: SplashWorld }).w;

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** Pushes the block into the water and runs the passes until its step ends and it sinks; the player ends on the block's old cell. */
function sinkBlock(engine: GameEngine): void {
  expect(engine.attemptPlayerMove('E')).toBe(true);
  for (let pass = 0; pass < SINK_WAIT_PASSES && engine.getTerrain()[ROW][WATER_X] === 'water'; pass++) engine.tick();
  expect(engine.getTerrain()[ROW][WATER_X]).not.toBe('water');
}

/** Whether the player can step east from the cell he stands on (his cooldown is cleared first). */
function canStepEast(engine: GameEngine): boolean {
  engine.getPlayer().moveCooldown = 0;
  return engine.attemptPlayerMove('E');
}

describe('CC2 block splash', () => {
  it('bars the real player for five passes, then lets him in', () => {
    const engine = load(room('cc2'));
    sinkBlock(engine);
    expect(worldOf(engine).blockSplashes.size).toBe(1);
    for (let pass = 0; pass < SPLASH_PASSES; pass++) {
      expect(canStepEast(engine), `pass ${pass}`).toBe(false);
      engine.tick();
    }
    expect(canStepEast(engine)).toBe(true);
    expect(engine.getPlayer().x).toBe(WATER_X);
  });

  it('is never made on a classic-rules or a native level', () => {
    for (const mode of ['cc', 'plain'] as const) {
      const engine = load(room(mode));
      sinkBlock(engine);
      expect(worldOf(engine).blockSplashes.size, mode).toBe(0);
      expect(canStepEast(engine), mode).toBe(true);
    }
  });

  it('is put back by undo and gone with the move that made it', () => {
    const engine = load(room('cc2'));
    sinkBlock(engine);
    const clockAtSink = worldOf(engine).ccMonsterClock;
    engine.getPlayer().moveCooldown = 0;
    expect(engine.attemptPlayerMove('W')).toBe(true);
    for (let i = 0; i < SPLASH_PASSES + 2; i++) engine.tick();
    expect(engine.undo()).toBe(true);
    expect(worldOf(engine).ccMonsterClock).toBe(clockAtSink);
    expect(worldOf(engine).blockSplashes.size).toBe(1);
    expect(engine.undo()).toBe(true);
    expect(worldOf(engine).blockSplashes.size).toBe(0);
    expect(engine.getTerrain()[ROW][WATER_X]).toBe('water');
  });

  it('is gone after a restart', () => {
    const level = room('cc2');
    const engine = load(level);
    sinkBlock(engine);
    engine.loadLevel(level);
    expect(worldOf(engine).blockSplashes.size).toBe(0);
    expect(engine.getTerrain()[ROW][WATER_X]).toBe('water');
  });

  it('is erased by a block that moves into its cell', () => {
    const engine = load(room('cc2', ['#########', '#@......#', '#########']));
    const w = worldOf(engine);
    w.blockSplashes.set(ROW * engine.getMapWidth() + WATER_X, w.ccMonsterClock + SPLASH_PASSES);
    expect(w.blockSplashes.size).toBe(1);
    expect(engine.attemptPlayerMove('E')).toBe(true);
    expect(w.blockSplashes.size).toBe(0);
  });
});
