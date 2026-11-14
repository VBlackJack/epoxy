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
import { CC2_DYNAMITE_LIGHT_TICK_OFFSET, CELL_EDGE_CANOPY_BIT, DYNAMITE_ITEM_ID, FLOOR_TILE_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CellEdge, CompiledLevel } from '../types';
import type { EpoxyContext } from './epoxyWorld';

const SIZE = 15;
const CENTRE = { x: 7, y: 7 };
const FAR_CELL = { x: 13, y: 13 };
const FUSE_TICKS = 85;
const BLAST_MARGIN_TICKS = 3;
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;
const SIDE_WALL = { x: 8, y: 7 };
const CANOPY_WALL = { x: 6, y: 7 };
const OUTSIDE_WALL = { x: 7, y: 11 };
const BARRED = { x: 7, y: 6 };
const BARRED_TERRAIN = 'dirt';
const OUTSIDE_BARRED_CELL = 1 * SIZE + 1;

function room(cc2: boolean, extra: Partial<CompiledLevel> = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : FLOOR_TILE_ID))
  );
  const cellEdges: CellEdge[] = [
    { x: SIDE_WALL.x, y: SIDE_WALL.y, sides: ['N', 'W'] },
    { x: CANOPY_WALL.x, y: CANOPY_WALL.y, sides: ['E'], canopy: true },
    { x: OUTSIDE_WALL.x, y: OUTSIDE_WALL.y, sides: ['S'] }
  ];
  return {
    id: 'dynamite_wave8_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 200,
    chipsRequired: 0,
    playerStart: { ...CENTRE, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    cellEdges,
    ...(cc2 ? { cc2: CC2_STUB } : {}),
    ...extra
  };
}

const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function setDownAndLeave(engine: GameEngine): void {
  engine.getPlayer().keys[DYNAMITE_ITEM_ID] = 1;
  expect(engine.dropItem(DYNAMITE_ITEM_ID)).toBe(true);
  ctxOf(engine).world.player.x = FAR_CELL.x;
  ctxOf(engine).world.player.y = FAR_CELL.y;
  engine.tick();
}

function tickN(engine: GameEngine, count: number): void {
  for (let i = 0; i < count; i++) engine.tick();
}

const maskAt = (engine: GameEngine, cell: { x: number; y: number }): number =>
  (ctxOf(engine).world.edgeMask as Uint8Array)[cell.y * SIZE + cell.x];

beforeEach(() => {
  loadTestConfigs();
});

describe('CC2 dynamite fuse offset', () => {
  /** Ticks after the lighting tick at which the lit charge is gone. */
  function blastTick(cc2: boolean): number {
    const engine = load(room(cc2));
    setDownAndLeave(engine);
    for (let t = 1; t <= FUSE_TICKS + BLAST_MARGIN_TICKS * 2; t++) {
      engine.tick();
      if (ctxOf(engine).world.litCharges.length === 0) return t;
    }
    throw new Error('the dynamite never blasted');
  }

  it('blasts one tick later on a CC2 level only', () => {
    expect(blastTick(true) - blastTick(false)).toBe(CC2_DYNAMITE_LIGHT_TICK_OFFSET);
  });
});

describe('CC2 dynamite blast and thin walls', () => {
  it('removes the side walls of a blasted cell and keeps the ones outside the blast', () => {
    const engine = load(room(true));
    const levelMask = ctxOf(engine).world.edgeMask as Uint8Array;
    setDownAndLeave(engine);
    tickN(engine, FUSE_TICKS + BLAST_MARGIN_TICKS);
    expect(maskAt(engine, SIDE_WALL)).toBe(0);
    expect(maskAt(engine, OUTSIDE_WALL)).not.toBe(0);
    // The level's memoized mask is never mutated.
    expect(levelMask[SIDE_WALL.y * SIZE + SIDE_WALL.x]).not.toBe(0);
    expect(ctxOf(engine).world.blastedEdgeMask).toBe(ctxOf(engine).world.edgeMask);
    expect(ctxOf(engine).world.blastedEdgeMask).not.toBe(levelMask);
  });

  it('under a canopy clears only the canopy and keeps the thin walls', () => {
    const engine = load(room(true));
    expect(maskAt(engine, CANOPY_WALL) & CELL_EDGE_CANOPY_BIT).not.toBe(0);
    const sides = maskAt(engine, CANOPY_WALL) & ~CELL_EDGE_CANOPY_BIT;
    expect(sides).not.toBe(0);
    setDownAndLeave(engine);
    tickN(engine, FUSE_TICKS + BLAST_MARGIN_TICKS);
    expect(maskAt(engine, CANOPY_WALL)).toBe(sides);
  });

  it('is restored by an undo snapshot', () => {
    const engine = load(room(true));
    const before = maskAt(engine, SIDE_WALL);
    setDownAndLeave(engine);
    const snap = engine.captureState();
    tickN(engine, FUSE_TICKS + BLAST_MARGIN_TICKS);
    expect(maskAt(engine, SIDE_WALL)).toBe(0);
    engine.restoreState(snap);
    expect(maskAt(engine, SIDE_WALL)).toBe(before);
    expect(ctxOf(engine).world.blastedEdgeMask).toBeUndefined();
  });

  it('leaves thin walls alone on a non-CC2 level', () => {
    const engine = load(room(false));
    const before = maskAt(engine, SIDE_WALL);
    setDownAndLeave(engine);
    tickN(engine, FUSE_TICKS + BLAST_MARGIN_TICKS);
    expect(maskAt(engine, SIDE_WALL)).toBe(before);
    expect(ctxOf(engine).world.blastedEdgeMask).toBeUndefined();
  });
});

describe('CC2 dynamite blast and the ghost bar', () => {
  it('frees a barred cell the blast turned to floor', () => {
    const barredCell = BARRED.y * SIZE + BARRED.x;
    const level = room(true, { cc2: { ...CC2_STUB, ghostBarCells: [OUTSIDE_BARRED_CELL, barredCell] } as Cc2LevelData });
    level.terrain[BARRED.y][BARRED.x] = BARRED_TERRAIN;
    const engine = load(level);
    const bar = ctxOf(engine).world.ghostBar as Set<number>;
    expect(bar.has(barredCell)).toBe(true);
    setDownAndLeave(engine);
    tickN(engine, FUSE_TICKS + BLAST_MARGIN_TICKS);
    expect(engine.getTerrain()[BARRED.y][BARRED.x]).toBe(FLOOR_TILE_ID);
    expect(bar.has(barredCell)).toBe(false);
    expect(bar.has(OUTSIDE_BARRED_CELL)).toBe(true);
  });
});
