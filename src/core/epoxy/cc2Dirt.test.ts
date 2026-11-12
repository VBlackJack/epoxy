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
 * The dirt of Chip's Challenge 2 bars the dirt block only (Lexy's Labyrinth, tiletypes.js): ice, frame, boulder and
 * glass blocks pack it down. The converter places dirt_cc2; the shared dirt keeps barring every block.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { GameEngine } from '../GameEngine';
import type { CompiledLevel, Direction, EntityPlacement } from '../types';

const SIZE = 11;
const ROW = 5;
const PLAYER_X = 2;
const BLOCK_X = 3;
const DIRT_X = 4;
const BEYOND_X = 5;
const MAX_WAIT_TICKS = 40;
const MAX_TICKS = 120;
const CC2_DIRT = 'dirt_cc2';
const NATIVE_DIRT = 'dirt';
const FLOOR = 'floor';
const DIRT_BLOCK = 'dirt_block';
const PACKING_BLOCKS = ['ice_block', 'color_block_red', 'arrow_block_cross'];

/** A walled room with the player at the left of the row, a block next to him and a dirt tile after it. */
function room(dirt: string, block: string): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : FLOOR))
  );
  terrain[ROW][DIRT_X] = dirt;
  const entities: EntityPlacement[] = [{ type: block, x: BLOCK_X, y: ROW, dir: 'E' }];
  return {
    id: 'cc2_dirt_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: PLAYER_X, y: ROW, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function step(engine: GameEngine, dir: Direction): boolean {
  for (let waited = 0; waited <= MAX_WAIT_TICKS; waited++) {
    if (engine.getPlayer().moveCooldown === 0) return engine.attemptPlayerMove(dir);
    engine.tick();
  }
  throw new Error('the player never became able to move');
}

/** Pushes the block east from the player's cell and lets it settle. */
function push(engine: GameEngine): void {
  step(engine, 'E');
  for (let i = 0; i < MAX_TICKS; i++) engine.tick();
}

const blockOf = (engine: GameEngine, type: string) => engine.getEntities().find((e) => e.type === type);

beforeEach(() => {
  loadTestConfigs();
});

describe('dirt_cc2: blocks', () => {
  it.each(PACKING_BLOCKS)('lets a %s pack it down into floor, and survive', (blockType) => {
    const engine = load(room(CC2_DIRT, blockType));
    push(engine);
    expect(engine.getTerrain()[ROW][DIRT_X]).toBe(FLOOR);
    expect(blockOf(engine, blockType)).toMatchObject({ kind: 'block', x: DIRT_X, y: ROW });
  });

  it('bars the dirt block: it neither enters nor changes the tile', () => {
    const engine = load(room(CC2_DIRT, DIRT_BLOCK));
    push(engine);
    expect(engine.getTerrain()[ROW][DIRT_X]).toBe(CC2_DIRT);
    expect(blockOf(engine, DIRT_BLOCK)).toMatchObject({ x: BLOCK_X, y: ROW });
    expect(engine.getPlayer().x).toBe(PLAYER_X);
  });

  it('keeps the shared dirt barring every block', () => {
    for (const blockType of [DIRT_BLOCK, ...PACKING_BLOCKS]) {
      const engine = load(room(NATIVE_DIRT, blockType));
      push(engine);
      expect(engine.getTerrain()[ROW][DIRT_X], blockType).toBe(NATIVE_DIRT);
      expect(blockOf(engine, blockType), blockType).toMatchObject({ x: BLOCK_X, y: ROW });
    }
  });

  it('lets a block go on over the packed floor', () => {
    const engine = load(room(CC2_DIRT, 'ice_block'));
    push(engine);
    step(engine, 'E');
    for (let i = 0; i < MAX_TICKS; i++) engine.tick();
    expect(blockOf(engine, 'ice_block')?.x).toBeGreaterThanOrEqual(BEYOND_X);
  });
});

describe('dirt_cc2: the player', () => {
  it('clears it by walking in, as the shared dirt', () => {
    const level = room(CC2_DIRT, DIRT_BLOCK);
    level.entities = [];
    const engine = load(level);
    step(engine, 'E');
    step(engine, 'E');
    expect(engine.getPlayer().x).toBe(DIRT_X);
    expect(engine.getTerrain()[ROW][DIRT_X]).toBe(FLOOR);
  });
});

describe('dirt_cc2: monsters', () => {
  it('keeps a monster out, as the shared dirt', () => {
    const level = room(CC2_DIRT, DIRT_BLOCK);
    level.entities = [{ type: 'glider', x: DIRT_X - 1, y: ROW, dir: 'E' }];
    for (let y = 1; y < SIZE - 1; y++) {
      if (y !== ROW) for (let x = 1; x < SIZE - 1; x++) level.terrain[y][x] = 'wall';
    }
    level.playerStart = { x: SIZE - 2, y: ROW, dir: 'W' };
    const engine = load(level);
    let furthest = 0;
    for (let i = 0; i < MAX_TICKS; i++) {
      engine.tick();
      furthest = Math.max(furthest, engine.getEntities().find((e) => e.kind === 'monster')?.x ?? 0);
    }
    expect(furthest).toBeLessThan(DIRT_X);
  });
});
