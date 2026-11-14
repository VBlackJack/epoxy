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

/** CC2 wave 8 review fixes: relative search keys, the ghost bar edit test, dynamite under a canopy and over a barred cell. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => import('../../test/silentAudio'));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { CELL_EDGE_CANOPY_BIT, DYNAMITE_ITEM_ID, FLOOR_TILE_ID } from '../coreConstants';
import { GameEngine } from '../GameEngine';
import type { Cc2LevelData, CellEdge, CompiledLevel } from '../types';
import { cc2HiddenStateKey, ghostBarEdited, type EpoxyContext, type EpoxyWorld } from './epoxyWorld';

const SIZE = 15;
const CENTRE = { x: 7, y: 7 };
const FAR_CELL = { x: 13, y: 13 };
const FUSE_TICKS = 85;
const BLAST_MARGIN_TICKS = 3;
const CC2_STUB = { v: 1 } as unknown as Cc2LevelData;
const CANOPY_CELL = { x: 6, y: 7 };
const BARRED_CELL = { x: 8, y: 7 };
const SAFE_CELL = { x: 7, y: 6 };
const MONSTER_CELL = { x: 3, y: 3 };
const LATER_CLOCK_SHIFT = 7;
const ARRIVAL_DELAY = 2;
const OUT_OF_BOUNDS_CELL = SIZE * SIZE + 4;
const HELD_ITEM = 'chip';
const RECORDED_CELL = 5;

function room(extra: Partial<CompiledLevel> = {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : FLOOR_TILE_ID))
  );
  const cellEdges: CellEdge[] = [{ x: CANOPY_CELL.x, y: CANOPY_CELL.y, sides: ['E'], canopy: true }];
  return {
    id: 'wave8_review_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 200,
    chipsRequired: 0,
    playerStart: { ...CENTRE, dir: 'E' },
    terrain,
    items: Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null)),
    entities: [{ type: 'fireball', x: MONSTER_CELL.x, y: MONSTER_CELL.y, dir: 'E' }],
    trapLinks: [],
    cloneLinks: [],
    cellEdges,
    cc2: CC2_STUB,
    ...extra
  };
}

const ctxOf = (engine: GameEngine): EpoxyContext => (engine as unknown as { ctx: EpoxyContext }).ctx;
const worldOf = (engine: GameEngine): EpoxyWorld => ctxOf(engine).world;

function load(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function setDownAndLeave(engine: GameEngine): void {
  engine.getPlayer().keys[DYNAMITE_ITEM_ID] = 1;
  expect(engine.dropItem(DYNAMITE_ITEM_ID)).toBe(true);
  worldOf(engine).player.x = FAR_CELL.x;
  worldOf(engine).player.y = FAR_CELL.y;
  engine.tick();
}

function blast(engine: GameEngine): void {
  for (let i = 0; i < FUSE_TICKS + BLAST_MARGIN_TICKS; i++) engine.tick();
}

beforeEach(() => {
  loadTestConfigs();
});

describe('F1: the search key holds relative passes', () => {
  function keyAt(clockShift: number): string {
    const engine = load(room());
    const w = worldOf(engine);
    w.ccMonsterClock += clockShift;
    const pass = w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1;
    const uid = w.entities[0].uid;
    w.entities[0].stepEndedPass = pass - 1;
    w.entities[0].stepEndedCell = RECORDED_CELL;
    w.ccArrivals.push({ uid, x: 1, y: 1, due: pass + ARRIVAL_DELAY, pulse: true } as EpoxyWorld['ccArrivals'][number]);
    w.ccArrivals.push({ uid, x: 1, y: 1, due: pass + ARRIVAL_DELAY, teleport: true } as EpoxyWorld['ccArrivals'][number]);
    return cc2HiddenStateKey(w);
  }

  it('gives the same key for the same position reached at two different times', () => {
    expect(keyAt(0)).toBe(keyAt(LATER_CLOCK_SHIFT));
    expect(keyAt(0)).toContain('e');
  });

  it('leaves out a step end older than the previous pass', () => {
    const engine = load(room());
    const w = worldOf(engine);
    const fresh = cc2HiddenStateKey(w);
    w.ccMonsterClock += LATER_CLOCK_SHIFT;
    w.entities[0].stepEndedPass = 0;
    w.entities[0].stepEndedCell = RECORDED_CELL;
    expect(cc2HiddenStateKey(w)).toBe(fresh);
  });
});

describe('F2: the ghost bar edit test ignores cells outside the map', () => {
  it('is not edited at load although a listed cell lies outside the map', () => {
    const cell = BARRED_CELL.y * SIZE + BARRED_CELL.x;
    const engine = load(room({ cc2: { ...CC2_STUB, ghostBarCells: [cell, OUT_OF_BOUNDS_CELL] } as Cc2LevelData }));
    const w = worldOf(engine);
    expect((w.ghostBar as Set<number>).size).toBe(1);
    expect(ghostBarEdited(w)).toBe(false);
    (w.ghostBar as Set<number>).delete(cell);
    expect(ghostBarEdited(w)).toBe(true);
  });
});

describe('F3: dynamite under a canopy and over a barred cell', () => {
  it('removes only the canopy: the item and the thin walls of that cell survive', () => {
    const level = room({ entities: [] });
    level.items[CANOPY_CELL.y][CANOPY_CELL.x] = HELD_ITEM;
    const engine = load(level);
    const sides = (worldOf(engine).edgeMask as Uint8Array)[CANOPY_CELL.y * SIZE + CANOPY_CELL.x] & ~CELL_EDGE_CANOPY_BIT;
    expect(sides).not.toBe(0);
    setDownAndLeave(engine);
    blast(engine);
    const w = worldOf(engine);
    expect((w.edgeMask as Uint8Array)[CANOPY_CELL.y * SIZE + CANOPY_CELL.x]).toBe(sides);
    expect(w.items[CANOPY_CELL.y][CANOPY_CELL.x]).toBe(HELD_ITEM);
    expect(w.items[SAFE_CELL.y][SAFE_CELL.x]).toBeNull();
  });

  it('spares the actor under a canopy', () => {
    const engine = load(room({ entities: [{ type: 'dirt_block', x: CANOPY_CELL.x, y: CANOPY_CELL.y, dir: 'N' }] }));
    setDownAndLeave(engine);
    blast(engine);
    expect(worldOf(engine).entities.some((e) => e.x === CANOPY_CELL.x && e.y === CANOPY_CELL.y)).toBe(true);
  });

  it('does not turn a barred floor to fire under an actor and keeps it barred', () => {
    const cell = BARRED_CELL.y * SIZE + BARRED_CELL.x;
    const engine = load(room({
      entities: [{ type: 'dirt_block', x: BARRED_CELL.x, y: BARRED_CELL.y, dir: 'N' }],
      cc2: { ...CC2_STUB, ghostBarCells: [cell] } as Cc2LevelData
    }));
    setDownAndLeave(engine);
    blast(engine);
    expect(engine.getTerrain()[BARRED_CELL.y][BARRED_CELL.x]).toBe(FLOOR_TILE_ID);
    expect((worldOf(engine).ghostBar as Set<number>).has(cell)).toBe(true);
  });
});
