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

import { describe, expect, it, vi } from 'vitest';

// Pass-through spy: the real canonicalJson runs, calls from other modules are counted.
vi.mock('./canonicalJson', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./canonicalJson')>();
  return { ...actual, canonicalJson: vi.fn(actual.canonicalJson) };
});

import { canonicalJson } from './canonicalJson';
import { deriveDisplayLayers } from '../core/cc3d/cc3dLayers';
import { cc3dModel, panelled, type GlyphMeaning } from '../core/cc3d/cc3dTestMaps';
import { cellAt, normalizeCell, type Cc3dCell, type Cc3dLevel, type Cc3dMob } from '../core/cc3d/model';
import {
  type Cc3dClip,
  clearCc3dRect,
  extractCc3dClip,
  fillCc3dRect,
  floodFillCc3d,
  moveCc3dRect,
  pasteCc3dClip,
  resizeCc3d
} from './cc3dAreaEdits';
import { emptyCell, placeLayer } from './cc3dEdits';

const BOUNDS = { minSize: 1, maxSize: 128 };
const BIG_SIZE = 128;

const GLYPHS: Record<string, GlyphMeaning> = {
  '|': panelled('E'),
  '-': panelled('S')
};

function level(rows: string[]): Cc3dLevel {
  const model = cc3dModel(rows, GLYPHS);
  return {
    ...model,
    cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })),
    player: { ...model.player, dir: 'S' }
  };
}

function mobsOf(l: Cc3dLevel): string[] {
  return l.mobs.map((mob) => `${mob.kind}@${mob.x},${mob.y}`);
}

function kindsAt(l: Cc3dLevel, x: number, y: number): string[] {
  return cellAt(l, x, y)!.terrain.map((layer) => layer.kind);
}

function withMobs(l: Cc3dLevel, mobs: Cc3dMob[]): Cc3dLevel {
  return { ...l, mobs };
}

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

/** A clip of `width` plain cells holding the given mobs (positions relative to the clip). */
function plainClip(width: number, mobs: Cc3dMob[], cell: Cc3dCell = emptyCell()): Cc3dClip {
  return { width, height: 1, cells: Array.from({ length: width }, () => cell), mobs, player: null };
}

const walker = (x: number, y: number): Cc3dMob => ({ kind: 'walker', x, y, dir: 'N' });
const dirtBlock = (x: number, y: number): Cc3dMob => ({ kind: 'block_dirt', x, y, dir: 'N' });
const iceBlock = (x: number, y: number): Cc3dMob => ({ kind: 'block_ice', x, y, dir: 'N' });
const bouncer = (x: number, y: number): Cc3dMob => ({ kind: 'bouncer', x, y, dir: 'N' });
const reflector = (x: number, y: number): Cc3dMob => ({ kind: 'reflector', x, y, dir: 'N', mirror: 'LU' });

describe('extractCc3dClip', () => {
  const l = level(['#######', '#@.iK.#', '#.WMZ.#', '#######']);

  it('copies cells and mobs relative to the clip, in level order, and leaves the player out', () => {
    const clip = extractCc3dClip(l, rect(0, 1, 5, 2), false);
    expect([clip.width, clip.height, clip.cells.length]).toEqual([5, 2, 10]);
    expect(clip.cells[0]).toBe(l.cells[7]);
    expect(clip.cells[9]).toBe(l.cells[2 * 7 + 4]);
    expect(clip.mobs.map((mob) => `${mob.kind}@${mob.x},${mob.y}`)).toEqual(['block_dirt@4,0', 'walker@3,1', 'block_ice@4,1']);
    expect(clip.player).toBeNull();
  });

  it('carries the player start, relative, only on request and only when inside', () => {
    expect(extractCc3dClip(l, rect(0, 1, 3, 1), true).player).toEqual({ dx: 1, dy: 0, dir: 'S' });
    expect(extractCc3dClip(l, rect(0, 1, 3, 1), false).player).toBeNull();
    expect(extractCc3dClip(l, rect(2, 1, 3, 1), true).player).toBeNull();
  });

  it('gives the west facing to a start that has none', () => {
    const bare = { ...l, player: { x: 1, y: 1 } };
    expect(extractCc3dClip(bare, rect(1, 1, 1, 1), true).player).toEqual({ dx: 0, dy: 0, dir: 'W' });
  });

  it('clips to the grid and gives an empty clip outside it', () => {
    const clip = extractCc3dClip(l, rect(5, 2, 9, 9), false);
    expect([clip.width, clip.height, clip.cells.length]).toEqual([2, 2, 4]);
    expect(extractCc3dClip(l, rect(20, 20, 2, 2), true)).toEqual({ width: 0, height: 0, cells: [], mobs: [], player: null });
  });

  it('can be drawn as a preview', () => {
    const layers = deriveDisplayLayers(extractCc3dClip(l, rect(2, 1, 3, 2), false));
    expect(layers.terrain).toHaveLength(2);
    expect(layers.entities.map((e) => [e.x, e.y])).toEqual([
      [2, 0],
      [1, 1],
      [2, 1]
    ]);
  });
});

describe('clearCc3dRect', () => {
  const l = level(['#######', '#@.iK.#', '#.WMZ.#', '#######']);

  it('resets cells, thin walls and items, removes the mobs and shares the other cells', () => {
    const r = clearCc3dRect(l, rect(2, 1, 3, 2));
    expect(r.changed).toBe(true);
    expect(r.removedMobs).toBe(3);
    expect(r.level.mobs).toEqual([]);
    expect(cellAt(r.level, 3, 1)).toEqual(emptyCell());
    expect(cellAt(r.level, 2, 2)).toEqual(emptyCell());
    expect(r.level.cells[0]).toBe(l.cells[0]);
    expect(r.level.cells[7]).toBe(l.cells[7]);
    expect(r.rect).toEqual(rect(2, 1, 3, 2));
  });

  it('removes only the mobs inside and keeps the order and identity of the others', () => {
    const r = clearCc3dRect(l, rect(3, 1, 1, 2));
    expect(mobsOf(r.level)).toEqual(['block_dirt@4,1', 'block_ice@4,2']);
    expect(r.level.mobs[0]).toBe(l.mobs[0]);
    expect(r.level.mobs[1]).toBe(l.mobs[2]);
    expect(r.removedMobs).toBe(1);
  });

  it('keeps the player start and says so', () => {
    const r = clearCc3dRect(l, rect(0, 1, 2, 1));
    expect(r.level.player).toBe(l.player);
    expect(r.playerKept).toBe(true);
    expect(clearCc3dRect(l, rect(3, 1, 1, 1)).playerKept).toBe(false);
  });

  it('returns the same level when the area is already plain floor, or outside the grid', () => {
    const floor = clearCc3dRect(l, rect(1, 2, 1, 1));
    expect(floor.level).toBe(l);
    expect(floor.changed).toBe(false);
    const onStart = clearCc3dRect(l, rect(1, 1, 1, 1));
    expect(onStart.level).toBe(l);
    expect(onStart.playerKept).toBe(true);
    expect(clearCc3dRect(l, rect(9, 9, 2, 2))).toMatchObject({ level: l, changed: false, rect: null });
  });

  it('clips a rectangle that sticks out and reports the clipped one', () => {
    const r = clearCc3dRect(l, rect(5, 0, 4, 4));
    expect(r.rect).toEqual(rect(5, 0, 2, 4));
    expect(cellAt(r.level, 5, 0)).toEqual(emptyCell());
    expect(cellAt(r.level, 6, 3)).toEqual(emptyCell());
  });

  it('clears a thin wall and an item that were the only content', () => {
    const w = level(['####', '#@|i', '####']);
    const r = clearCc3dRect(w, rect(2, 1, 2, 1));
    expect(cellAt(r.level, 2, 1)!.panels).toEqual([]);
    expect(cellAt(r.level, 3, 1)!.item).toBeNull();
  });
});

describe('pasteCc3dClip', () => {
  const l = level(['########', '#@.iK..#', '#.WMZ..#', '#......#', '########']);

  it('returns the same level when a copy is pasted back on its own place', () => {
    const r = pasteCc3dClip(l, extractCc3dClip(l, rect(1, 1, 5, 2), false), 1, 1);
    expect(r.level).toBe(l);
    expect(r.changed).toBe(false);
    expect(r.removedMobs).toBe(0);
    expect(pasteCc3dClip(l, extractCc3dClip(l, rect(0, 0, 8, 5), false), 0, 0).level).toBe(l);
  });

  it('replaces each written cell whole and shares the others', () => {
    const clip = extractCc3dClip(l, rect(2, 1, 2, 1), false);
    const r = pasteCc3dClip(l, clip, 5, 3);
    expect(r.changed).toBe(true);
    expect(r.level.cells[3 * 8 + 6]).toBe(clip.cells[1]);
    expect(cellAt(r.level, 6, 3)!.item).toEqual({ kind: 'fish' });
    expect(r.level.cells[0]).toBe(l.cells[0]);
    expect(r.level.cells[3 * 8 + 5]).toBe(l.cells[3 * 8 + 5]);
    expect(r.rect).toEqual(rect(5, 3, 2, 1));
    const over = pasteCc3dClip(l, extractCc3dClip(l, rect(2, 2, 1, 1), false), 3, 1);
    expect(kindsAt(over.level, 3, 1)).toEqual(['water']);
    expect(cellAt(over.level, 3, 1)!.item).toBeNull();
  });

  it('clips on every edge', () => {
    const clip = extractCc3dClip(l, rect(1, 1, 3, 2), false);
    expect(pasteCc3dClip(l, clip, -1, -1).rect).toEqual(rect(0, 0, 2, 1));
    expect(pasteCc3dClip(l, clip, 6, 3).rect).toEqual(rect(6, 3, 2, 2));
    expect(pasteCc3dClip(l, clip, -2, 3).rect).toEqual(rect(0, 3, 1, 2));
    expect(pasteCc3dClip(l, clip, 7, -1).rect).toEqual(rect(7, 0, 1, 1));
    expect(pasteCc3dClip(l, clip, 40, 40)).toMatchObject({ level: l, changed: false, rect: null });
    expect(pasteCc3dClip(l, extractCc3dClip(l, rect(20, 20, 1, 1), false), 0, 0).level).toBe(l);
  });

  it('does not place a mob that falls off the grid, and places the one that stays', () => {
    const clip = extractCc3dClip(l, rect(3, 1, 3, 2), false); // dirt block at 1,0 ; walker at 0,1 ; ice block at 1,1
    const r = pasteCc3dClip(l, clip, 7, 3);
    expect(mobsOf(r.level)).toEqual(['block_dirt@4,1', 'walker@3,2', 'block_ice@4,2', 'walker@7,4']);
    expect(r.skippedMobs).toBe(0);
  });

  it('replaces a mob in place, keeping its index', () => {
    const clip = plainClip(1, [{ kind: 'bouncer', x: 0, y: 0, dir: 'E' }]);
    const r = pasteCc3dClip(l, clip, 4, 1);
    expect(r.level.mobs[0]).toEqual({ kind: 'bouncer', x: 4, y: 1, dir: 'E' });
    expect(r.level.mobs[1]).toBe(l.mobs[1]);
    expect(r.level.mobs[2]).toBe(l.mobs[2]);
    expect(r.level.mobs).toHaveLength(3);
    expect(r.removedMobs).toBe(1);
  });

  it('does not count the replacement of a mob by an identical one', () => {
    const r = pasteCc3dClip(l, plainClip(1, [{ ...l.mobs[0], x: 0, y: 0 }]), l.mobs[0].x, l.mobs[0].y);
    expect(r.removedMobs).toBe(0);
    expect(r.level.mobs[0]).toBe(l.mobs[0]);
  });

  it('removes a mob on a written cell that receives none, and counts it', () => {
    const r = pasteCc3dClip(l, extractCc3dClip(l, rect(1, 3, 1, 1), false), 3, 2);
    expect(mobsOf(r.level)).toEqual(['block_dirt@4,1', 'block_ice@4,2']);
    expect(r.level.mobs[1]).toBe(l.mobs[2]);
    expect(r.removedMobs).toBe(1);
  });

  it('inserts a new mob at its canonical position, not at the end', () => {
    const base = withMobs(l, [reflector(2, 1), iceBlock(5, 1), walker(3, 2), bouncer(6, 2), dirtBlock(4, 1)]);
    const clip = plainClip(1, [walker(0, 0)]);
    // enemies group in reading order: (1,2) sorts before the walker at (3,2), (5,2) after it
    expect(mobsOf(pasteCc3dClip(base, clip, 1, 2).level)).toEqual([
      'reflector@2,1',
      'block_ice@5,1',
      'walker@1,2',
      'walker@3,2',
      'bouncer@6,2',
      'block_dirt@4,1'
    ]);
    expect(mobsOf(pasteCc3dClip(base, clip, 5, 2).level)).toEqual([
      'reflector@2,1',
      'block_ice@5,1',
      'walker@3,2',
      'walker@5,2',
      'bouncer@6,2',
      'block_dirt@4,1'
    ]);
    expect(pasteCc3dClip(base, clip, 1, 2).level.mobs[0]).toBe(base.mobs[0]);
  });

  it('puts a new mob after the tiles group, before the dirt blocks, and a reflector first', () => {
    const solo = withMobs(l, [iceBlock(5, 1), dirtBlock(4, 1)]);
    expect(mobsOf(pasteCc3dClip(solo, plainClip(1, [walker(0, 0)]), 1, 2).level)).toEqual(['block_ice@5,1', 'walker@1,2', 'block_dirt@4,1']);
    expect(mobsOf(pasteCc3dClip(solo, plainClip(1, [reflector(0, 0)]), 6, 3).level)).toEqual(['block_ice@5,1', 'reflector@6,3', 'block_dirt@4,1']);
    expect(mobsOf(pasteCc3dClip(solo, plainClip(1, [reflector(0, 0)]), 2, 1).level)).toEqual(['reflector@2,1', 'block_ice@5,1', 'block_dirt@4,1']);
    expect(mobsOf(pasteCc3dClip(solo, plainClip(1, [dirtBlock(0, 0)]), 1, 3).level)).toEqual(['block_ice@5,1', 'block_dirt@4,1', 'block_dirt@1,3']);
  });

  it('inserts several new mobs in canonical order among themselves', () => {
    const clip = plainClip(3, [dirtBlock(0, 0), walker(2, 0), reflector(1, 0)]);
    expect(mobsOf(pasteCc3dClip(withMobs(l, []), clip, 1, 3).level)).toEqual(['reflector@2,3', 'walker@3,3', 'block_dirt@1,3']);
  });

  it('skips and counts a mob that lands on the player start that stays', () => {
    const water = l.cells[2 * 8 + 2];
    const clip = plainClip(1, [walker(0, 0)], water);
    const r = pasteCc3dClip(l, clip, 1, 1);
    expect(r.skippedMobs).toBe(1);
    expect(r.playerKept).toBe(true);
    expect(r.playerMoved).toBe(false);
    expect(r.level.player).toBe(l.player);
    expect(r.level.mobs).toBe(l.mobs);
    expect(kindsAt(r.level, 1, 1)).toEqual(['water']);
    expect(r.changed).toBe(true);
  });

  it('moves the start with a clip that carries it, removing a mob already there', () => {
    const cut = extractCc3dClip(l, rect(1, 1, 2, 1), true);
    expect(cut.player).toEqual({ dx: 0, dy: 0, dir: 'S' });
    const r = pasteCc3dClip(l, cut, 4, 1);
    expect(r.level.player).toEqual({ x: 4, y: 1, dir: 'S' });
    expect(r.playerMoved).toBe(true);
    expect(r.playerKept).toBe(false);
    expect(mobsOf(r.level)).toEqual(['walker@3,2', 'block_ice@4,2']);
    expect(r.removedMobs).toBe(1);
  });

  it('leaves the start alone when the carried start would fall off the grid', () => {
    const cut = extractCc3dClip(l, rect(0, 1, 3, 1), true);
    expect(cut.player).toEqual({ dx: 1, dy: 0, dir: 'S' });
    const r = pasteCc3dClip(l, cut, 7, 1);
    expect(r.level.player).toBe(l.player);
    expect(r.playerMoved).toBe(false);
  });

  it('does not report a moved start when it lands where it is', () => {
    const r = pasteCc3dClip(l, extractCc3dClip(l, rect(1, 1, 2, 1), true), 1, 1);
    expect(r.level).toBe(l);
    expect(r.playerMoved).toBe(false);
  });

  it('skips a second clip mob on one cell', () => {
    const r = pasteCc3dClip(withMobs(l, []), plainClip(1, [walker(0, 0), bouncer(0, 0)]), 1, 3);
    expect(mobsOf(r.level)).toEqual(['walker@1,3']);
    expect(r.skippedMobs).toBe(1);
  });
});

describe('moveCc3dRect', () => {
  const l = level(['#########', '#@.iK...#', '#.WMZ...#', '#.......#', '#########']);

  it('moves cells, leaves plain floor behind, keeps mob indices and moves the start along', () => {
    const r = moveCc3dRect(l, rect(1, 1, 4, 2), 3, 1);
    expect(r.changed).toBe(true);
    expect(r.rect).toEqual(rect(4, 2, 4, 2));
    expect(cellAt(r.level, 6, 2)!.item).toEqual({ kind: 'fish' });
    expect(cellAt(r.level, 3, 1)!.item).toBeNull();
    expect(kindsAt(r.level, 5, 3)).toEqual(['water']);
    expect(cellAt(r.level, 2, 1)).toEqual(emptyCell());
    expect(r.level.player).toEqual({ x: 4, y: 2, dir: 'S' });
    expect(r.playerMoved).toBe(true);
    expect(mobsOf(r.level)).toEqual(['block_dirt@7,2', 'walker@6,3', 'block_ice@7,3']);
    expect(r.level.cells[0]).toBe(l.cells[0]);
    expect(r.removedMobs).toBe(0);
    expect(r.skippedMobs).toBe(0);
  });

  it('moves a rectangle onto its own overlapping place', () => {
    const r = moveCc3dRect(l, rect(1, 1, 4, 1), 1, 0);
    expect(r.rect).toEqual(rect(2, 1, 4, 1));
    expect(cellAt(r.level, 1, 1)).toEqual(emptyCell());
    expect(cellAt(r.level, 4, 1)!.item).toEqual({ kind: 'fish' });
    expect(mobsOf(r.level)).toEqual(['block_dirt@5,1', 'walker@3,2', 'block_ice@4,2']);
    expect(r.level.mobs[1]).toBe(l.mobs[1]);
    expect(r.removedMobs).toBe(0);
    expect(r.level.player).toEqual({ x: 2, y: 1, dir: 'S' });
  });

  it('removes the mobs on destination cells outside the source and counts them', () => {
    const quiet = moveCc3dRect(l, rect(1, 3, 1, 1), 0, -1);
    expect(quiet.removedMobs).toBe(0);
    const over = moveCc3dRect(l, rect(5, 1, 1, 1), -1, 0);
    expect(mobsOf(over.level)).toEqual(['walker@3,2', 'block_ice@4,2']);
    expect(over.removedMobs).toBe(1);
  });

  it('clamps the step to the grid', () => {
    expect(moveCc3dRect(l, rect(6, 1, 2, 2), 10, 10).rect).toEqual(rect(7, 3, 2, 2));
    const left = moveCc3dRect(l, rect(3, 2, 2, 1), -10, 0);
    expect(left.rect).toEqual(rect(0, 2, 2, 1));
    expect(mobsOf(left.level)).toEqual(['block_dirt@4,1', 'walker@0,2', 'block_ice@1,2']);
  });

  it('is a no-op for a zero step, a step clamped to zero, or a rectangle outside the grid', () => {
    expect(moveCc3dRect(l, rect(1, 1, 2, 2), 0, 0)).toMatchObject({ level: l, changed: false });
    expect(moveCc3dRect(l, rect(0, 0, 9, 5), 3, 3)).toMatchObject({ level: l, changed: false });
    expect(moveCc3dRect(l, rect(30, 30, 2, 2), 1, 1)).toMatchObject({ level: l, changed: false, rect: null });
  });

  it('returns the same level when plain floor moves onto plain floor', () => {
    const r = moveCc3dRect(l, rect(1, 3, 3, 1), 1, 0);
    expect(r.level).toBe(l);
    expect(r.changed).toBe(false);
  });

  it('skips a moved mob that would land on a start that stays', () => {
    const fine = moveCc3dRect(l, rect(3, 1, 2, 1), -2, 0);
    expect(mobsOf(fine.level)).toEqual(['block_dirt@2,1', 'walker@3,2', 'block_ice@4,2']);
    expect(fine.skippedMobs).toBe(0);
    const clash = moveCc3dRect(l, rect(4, 1, 1, 1), -3, 0);
    expect(clash.skippedMobs).toBe(1);
    expect(mobsOf(clash.level)).toEqual(['walker@3,2', 'block_ice@4,2']);
    expect(clash.level.player).toBe(l.player);
    expect(clash.playerKept).toBe(true);
    expect(clash.playerMoved).toBe(false);
    expect(clash.changed).toBe(true);
  });

  it('does not skip a mob that moves together with the start', () => {
    const together = withMobs(l, [walker(2, 1)]);
    const r = moveCc3dRect(together, rect(1, 1, 2, 1), 1, 0);
    expect(r.skippedMobs).toBe(0);
    expect(r.level.player).toEqual({ x: 2, y: 1, dir: 'S' });
    expect(mobsOf(r.level)).toEqual(['walker@3,1']);
  });
});

describe('floodFillCc3d', () => {
  it('fills the connected cells with the same stack, keeping items, mobs and thin walls', () => {
    const l = level(['#######', '#@.iK.#', '#..M..#', '#######']);
    const r = floodFillCc3d(l, 2, 1, { kind: 'water' });
    expect(r.filled).toBe(10);
    expect(kindsAt(r.level, 5, 2)).toEqual(['water']);
    expect(kindsAt(r.level, 0, 0)).toEqual(['floor', 'wall']);
    expect(cellAt(r.level, 3, 1)!.item).toEqual({ kind: 'fish' });
    expect(r.level.mobs).toBe(l.mobs);
    expect(r.level.cells[0]).toBe(l.cells[0]);
    expect(r.level.player).toBe(l.player);
  });

  it('treats an ice corner stored in the old order as the same region', () => {
    const corner = (sides: ['S', 'E'] | ['E', 'S']): Cc3dCell => ({ ...emptyCell(), terrain: [{ kind: 'floor' }, { kind: 'ice_corner', corner: sides }] });
    const base = level(['#####', '#@..#', '#####']);
    const cells = base.cells.slice();
    cells[1 * 5 + 2] = corner(['S', 'E']);
    cells[1 * 5 + 3] = corner(['E', 'S']);
    const r = floodFillCc3d({ ...base, cells }, 2, 1, { kind: 'water' });
    expect(r.filled).toBe(2);
    expect(kindsAt(r.level, 3, 1)).toEqual(['water']);
  });

  it('stops at a different stack', () => {
    const l = level(['#######', '#@.W..#', '#.WW..#', '#######']);
    const r = floodFillCc3d(l, 1, 1, { kind: 'fire' });
    expect(r.filled).toBe(3);
    expect(kindsAt(r.level, 4, 1)).toEqual(['floor']);
    expect(kindsAt(r.level, 3, 1)).toEqual(['water']);
    expect(kindsAt(r.level, 2, 1)).toEqual(['fire']);
  });

  it('is blocked by a thin wall on either cell of a shared side', () => {
    const east = level(['#####', '#@|.#', '#####']);
    const fromWest = floodFillCc3d(east, 1, 1, { kind: 'water' });
    expect(fromWest.filled).toBe(2);
    expect(kindsAt(fromWest.level, 3, 1)).toEqual(['floor']);
    expect(floodFillCc3d(east, 3, 1, { kind: 'water' }).filled).toBe(1);
    const south = level(['###', '#@#', '#-#', '#.#', '###']);
    expect(floodFillCc3d(south, 1, 3, { kind: 'water' }).filled).toBe(1);
    expect(floodFillCc3d(south, 1, 2, { kind: 'water' }).filled).toBe(2);
    const open = level(['####', '#@.#', '####']);
    expect(floodFillCc3d(open, 1, 1, { kind: 'water' }).filled).toBe(2);
  });

  it('only blocks across the closed side, not around it', () => {
    const l = level(['#####', '#@-.#', '#...#', '#####']);
    const r = floodFillCc3d(l, 2, 1, { kind: 'water' });
    expect(r.filled).toBe(6);
    expect(kindsAt(r.level, 2, 2)).toEqual(['water']);
  });

  it('places a device on top of the stack of each region cell', () => {
    const l = level(['####', '#@.#', '####']);
    const r = floodFillCc3d(l, 1, 1, { kind: 'bomb' });
    expect(kindsAt(r.level, 2, 1)).toEqual(['floor', 'bomb']);
    expect(r.filled).toBe(2);
  });

  it('normalizes the layer it fills with', () => {
    const l = level(['####', '#@.#', '####']);
    const corner = floodFillCc3d(l, 1, 1, { kind: 'ice_corner', corner: ['S', 'E'] });
    expect(cellAt(corner.level, 2, 1)!.terrain[0]).toEqual({ kind: 'ice_corner', corner: ['E', 'S'] });
    const door = floodFillCc3d(l, 1, 1, { kind: 'toggle_door', color: 'red' });
    expect(cellAt(door.level, 1, 1)!.terrain[1]).toEqual({ kind: 'toggle_door', color: 'red', open: false });
  });

  it('is refused for an invalid layer, an outside cell or a fill that changes nothing', () => {
    const l = level(['####', '#@.#', '####']);
    expect(floodFillCc3d(l, 1, 1, { kind: 'door' })).toEqual({ level: l, filled: 0 });
    expect(floodFillCc3d(l, 1, 1, { kind: 'door' }).level).toBe(l);
    expect(floodFillCc3d(l, 1, 1, { kind: 'nonsense' as never }).level).toBe(l);
    expect(floodFillCc3d(l, 9, 9, { kind: 'water' }).level).toBe(l);
    expect(floodFillCc3d(l, -1, 0, { kind: 'water' }).level).toBe(l);
    expect(floodFillCc3d(l, 1.5, 1, { kind: 'water' }).level).toBe(l);
    expect(floodFillCc3d(l, 1, 1, { kind: 'floor' }).level).toBe(l);
    const water = floodFillCc3d(l, 1, 1, { kind: 'water' }).level;
    expect(floodFillCc3d(water, 1, 1, { kind: 'water' })).toEqual({ level: water, filled: 0 });
  });

  it('treats a stack with a blocker as a different region from a bare floor', () => {
    const l = level(['#####', '#@.1.#', '#####']);
    const r = floodFillCc3d(l, 3, 1, { kind: 'water' });
    expect(r.filled).toBe(1);
    expect(kindsAt(r.level, 3, 1)).toEqual(['water', 'door']);
    expect(kindsAt(r.level, 2, 1)).toEqual(['floor']);
  });

  it('flood fills a big area keying each cell once', () => {
    const cells: Cc3dCell[] = Array.from({ length: BIG_SIZE * BIG_SIZE }, () => emptyCell());
    const big: Cc3dLevel = { width: BIG_SIZE, height: BIG_SIZE, cells, mobs: [], player: { x: 0, y: 0, dir: 'S' } };
    vi.mocked(canonicalJson).mockClear();
    const r = floodFillCc3d(big, 5, 5, { kind: 'water' });
    // One key for the target (reused by the start cell), one for the replacement,
    // and one for each of the other cells: each cell is keyed exactly once.
    const keyBuilds = vi.mocked(canonicalJson).mock.calls.length;
    expect(keyBuilds).toBeGreaterThan(0);
    expect(keyBuilds).toBe(BIG_SIZE * BIG_SIZE + 1);
    expect(r.filled).toBe(BIG_SIZE * BIG_SIZE);
    expect(r.level.cells).not.toBe(cells);
    expect(r.level.cells.every((cell) => cell.terrain[0].kind === 'water')).toBe(true);
  });
});

describe('resizeCc3d', () => {
  const l = level(['#######', '#@.iK.#', '#.WMZ.#', '#######']);

  it('grows with plain floor, anchored on the top-left cell, and shares the old cells', () => {
    const r = resizeCc3d(l, 9, 6, BOUNDS);
    expect(r).toMatchObject({ changed: true, width: 9, height: 6, droppedMobs: 0, playerMoved: false });
    expect(r.level.cells).toHaveLength(54);
    expect(r.level.cells[1 * 9 + 3]).toBe(l.cells[1 * 7 + 3]);
    expect(r.level.cells[8]).toEqual(emptyCell());
    expect(r.level.cells[5 * 9 + 5]).toEqual(emptyCell());
    expect(r.level.mobs).toBe(l.mobs);
    expect(r.level.player).toBe(l.player);
  });

  it('crops, dropping the mobs outside and keeping the order of the rest', () => {
    const r = resizeCc3d(l, 4, 3, BOUNDS);
    expect(r.droppedMobs).toBe(2);
    expect(mobsOf(r.level)).toEqual(['walker@3,2']);
    expect(r.level.mobs[0]).toBe(l.mobs[1]);
    expect(r.level.cells).toHaveLength(12);
    expect(r.level.cells[2 * 4 + 3]).toBe(l.cells[2 * 7 + 3]);
  });

  it('clamps to the bounds and ignores a non-finite or fractional size', () => {
    expect(resizeCc3d(l, 500, 500, BOUNDS)).toMatchObject({ width: 128, height: 128 });
    expect(resizeCc3d(l, 0, -4, BOUNDS)).toMatchObject({ width: 1, height: 1 });
    expect(resizeCc3d(l, 5.9, 3.2, BOUNDS)).toMatchObject({ width: 5, height: 3 });
    expect(resizeCc3d(l, Number.NaN, Number.POSITIVE_INFINITY, BOUNDS)).toMatchObject({ width: 7, height: 4, changed: false });
  });

  it('returns the same level for the same size', () => {
    const r = resizeCc3d(l, 7, 4, BOUNDS);
    expect(r.level).toBe(l);
    expect(r.changed).toBe(false);
    expect(resizeCc3d(l, 7.9, 4.9, BOUNDS).level).toBe(l);
  });

  it('clamps the player start inside and drops a mob standing on the clamped cell', () => {
    const far = { ...l, player: { x: 5, y: 2, dir: 'N' as const } };
    const r = resizeCc3d(far, 3, 2, BOUNDS);
    expect(r.level.player).toEqual({ x: 2, y: 1, dir: 'N' });
    expect(r.playerMoved).toBe(true);
    const crowded = withMobs(far, [walker(2, 1), bouncer(1, 0)]);
    const c = resizeCc3d(crowded, 3, 2, BOUNDS);
    expect(mobsOf(c.level)).toEqual(['bouncer@1,0']);
    expect(c.droppedMobs).toBe(1);
  });

  it('shrinks to one cell', () => {
    const r = resizeCc3d(l, 1, 1, BOUNDS);
    expect(r.level.cells).toHaveLength(1);
    expect(r.level.cells[0]).toBe(l.cells[0]);
    expect(r.level.mobs).toEqual([]);
    expect(r.droppedMobs).toBe(3);
    expect(r.level.player).toEqual({ x: 0, y: 0, dir: 'S' });
    expect(r.playerMoved).toBe(true);
  });
});

describe('resizeCc3d with an anchor', () => {
  const l = level(['#######', '#@.iK.#', '#.WMZ.#', '#######']);
  const CENTRE = { col: 1, row: 1 } as const;
  const BOTTOM_RIGHT = { col: 2, row: 2 } as const;

  it('translates cells, mobs (order kept) and the player when growing around the centre', () => {
    const r = resizeCc3d(l, 9, 6, BOUNDS, CENTRE);
    expect(r.changed).toBe(true);
    expect(r.level.cells).toHaveLength(54);
    expect(r.level.cells[2 * 9 + 2]).toBe(l.cells[1 * 7 + 1]);
    expect(r.level.cells[0]).toEqual(emptyCell());
    expect(mobsOf(r.level)).toEqual(l.mobs.map((mob) => `${mob.kind}@${mob.x + 1},${mob.y + 1}`));
    expect(r.level.player).toMatchObject({ x: l.player.x + 1, y: l.player.y + 1 });
    expect(r.playerMoved).toBe(false);
    expect(r.droppedMobs).toBe(0);
  });

  it('clamps the player and drops the mob left standing on the clamped start', () => {
    const base = withMobs(l, [walker(3, 1), walker(6, 2), walker(5, 2)]);
    const r = resizeCc3d(base, 4, 3, BOUNDS, BOTTOM_RIGHT);
    // dx = -3, dy = -1: the start (1, 1) lands outside and clamps to (0, 0), where the first mob arrives.
    expect(r.level.player).toMatchObject({ x: 0, y: 0 });
    expect(r.playerMoved).toBe(true);
    expect(mobsOf(r.level)).toEqual(['walker@3,1', 'walker@2,1']);
    expect(r.droppedMobs).toBe(1);
    expect(r.level.cells[0]).toBe(base.cells[1 * 7 + 3]);
  });

  it('returns the same level for the same size whatever the anchor', () => {
    expect(resizeCc3d(l, 7, 4, BOUNDS, BOTTOM_RIGHT).level).toBe(l);
    expect(resizeCc3d(l, 7, 4, BOUNDS, CENTRE).changed).toBe(false);
  });
});

describe('purity', () => {
  it('never mutates its input', () => {
    const l = level(['#######', '#@.iK.#', '#.WMZ.#', '#######']);
    const snapshot = JSON.stringify(l);
    resizeCc3d(l, 2, 2, BOUNDS);
    floodFillCc3d(l, 2, 1, { kind: 'water' });
    moveCc3dRect(l, rect(1, 1, 2, 2), 1, 1);
    clearCc3dRect(l, rect(0, 0, 7, 4));
    pasteCc3dClip(l, extractCc3dClip(l, rect(0, 0, 3, 3), true), 3, 1);
    expect(JSON.stringify(l)).toBe(snapshot);
  });

  it('keeps a stacked cell whole through a copy and paste', () => {
    const l = level(['####', '#@O.', '####']);
    const clip = extractCc3dClip(l, rect(2, 1, 1, 1), false);
    expect(clip.cells[0].terrain.map((layer) => layer.kind)).toEqual(['floor', 'bomb']);
    expect(kindsAt(pasteCc3dClip(l, clip, 3, 1).level, 3, 1)).toEqual(['floor', 'bomb']);
  });
});

describe('fillCc3dRect', () => {
  const l = level(['#######', '#@.iK.#', '#.WMZ.#', '#######']);
  const wall = { action: 'layer', layer: { kind: 'wall' } } as const;

  it('returns the very same level when every cell already holds the layer', () => {
    const result = fillCc3dRect(l, rect(2, 1, 2, 1), { action: 'layer', layer: { kind: 'floor' } });
    expect(result.changed).toBe(false);
    expect(result.refused).toBe(false);
    expect(result.level).toBe(l);
    expect(result.rect).toEqual(rect(2, 1, 2, 1));
  });

  it('places the layer on every cell of the rectangle and shares the cells it did not touch', () => {
    const result = fillCc3dRect(l, rect(1, 2, 2, 1), wall);
    expect(result.changed).toBe(true);
    expect(kindsAt(result.level, 1, 2)).toContain('wall');
    expect(kindsAt(result.level, 2, 2)).toContain('wall');
    for (let i = 0; i < l.cells.length; i++) {
      const inside = i === 2 * 7 + 1 || i === 2 * 7 + 2;
      expect(result.level.cells[i] === l.cells[i]).toBe(!inside);
    }
    expect(result.level.mobs).toBe(l.mobs);
  });

  it('places a layer in class order, exactly as placing it cell by cell does', () => {
    const door = { action: 'layer', layer: { kind: 'door', color: 'red' } } as const;
    const result = fillCc3dRect(l, rect(1, 1, 5, 2), door);
    let expected = l;
    for (let y = 1; y <= 2; y++) {
      for (let x = 1; x <= 5; x++) expected = placeLayer(expected, x, y, { kind: 'door', color: 'red' });
    }
    expect(result.level.cells).toEqual(expected.cells);
    expect(kindsAt(result.level, 2, 2)).toEqual(kindsAt(expected, 2, 2));
  });

  it('refuses a layer without the attribute its kind needs, leaving the level alone', () => {
    const result = fillCc3dRect(l, rect(1, 1, 2, 2), { action: 'layer', layer: { kind: 'door' } });
    expect(result.refused).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.level).toBe(l);
  });

  it('writes an item on every cell, a key needing a colour', () => {
    const result = fillCc3dRect(l, rect(1, 2, 2, 1), { action: 'item', item: { kind: 'key', color: 'blue' } });
    expect(result.level.cells[2 * 7 + 1].item).toEqual({ kind: 'key', color: 'blue' });
    expect(result.level.cells[2 * 7 + 2].item).toEqual({ kind: 'key', color: 'blue' });
    expect(result.level.cells[2 * 7 + 3]).toBe(l.cells[2 * 7 + 3]);
    const refused = fillCc3dRect(l, rect(1, 2, 2, 1), { action: 'item', item: { kind: 'key' } });
    expect(refused.refused).toBe(true);
    expect(refused.level).toBe(l);
    const same = fillCc3dRect(l, rect(3, 1, 1, 1), { action: 'item', item: { kind: 'fish' } });
    expect(same.level).toBe(l);
  });

  it('replaces a creature in place and inserts a new one at its canonical position', () => {
    expect(mobsOf(l)).toEqual(['block_dirt@4,1', 'walker@3,2', 'block_ice@4,2']);
    const result = fillCc3dRect(l, rect(2, 2, 3, 1), { action: 'mob', mob: { kind: 'bouncer', x: 0, y: 0, dir: 'E' } });
    expect(result.changed).toBe(true);
    expect(result.removedMobs).toBe(2);
    // The walker and the ice block keep their index; the new bouncer is an enemy, so it lands before the dirt block, which the level files list last.
    expect(mobsOf(result.level)).toEqual(['bouncer@2,2', 'block_dirt@4,1', 'bouncer@3,2', 'bouncer@4,2']);
    expect(result.level.mobs.every((mob) => mob.kind !== 'bouncer' || mob.dir === 'E')).toBe(true);
    expect(result.level.cells).toBe(l.cells);
  });

  it('replaces only the first creature found on a cell', () => {
    const stacked = withMobs(l, [...l.mobs, { kind: 'block_ice', x: 3, y: 2, dir: 'N' }]);
    const result = fillCc3dRect(stacked, rect(3, 2, 1, 1), { action: 'mob', mob: { kind: 'bouncer', x: 0, y: 0, dir: 'E' } });
    expect(result.removedMobs).toBe(1);
    expect(mobsOf(result.level).filter((mob) => mob.endsWith('@3,2')).sort()).toEqual(['block_ice@3,2', 'bouncer@3,2']);
    expect(result.level.mobs).toHaveLength(stacked.mobs.length);
  });

  it('skips the player start cell and counts it', () => {
    const result = fillCc3dRect(l, rect(1, 1, 2, 1), { action: 'mob', mob: { kind: 'bouncer', x: 0, y: 0, dir: 'N' } });
    expect(result.skippedMobs).toBe(1);
    expect(mobsOf(result.level)).toContain('bouncer@2,1');
    expect(mobsOf(result.level)).not.toContain('bouncer@1,1');
    expect(result.level.player).toBe(l.player);
  });

  it('keeps a creature identical to the one it would place, and returns the same level when nothing changes', () => {
    const result = fillCc3dRect(l, rect(3, 2, 1, 1), { action: 'mob', mob: { ...l.mobs[1] } });
    expect(result.changed).toBe(false);
    expect(result.level).toBe(l);
  });

  it('refuses a creature that lacks its colour or its mirror', () => {
    for (const mob of [
      { kind: 'block_color', x: 0, y: 0, dir: 'N' },
      { kind: 'reflector', x: 0, y: 0, dir: 'N' }
    ] as const) {
      const result = fillCc3dRect(l, rect(1, 2, 2, 1), { action: 'mob', mob });
      expect(result.refused).toBe(true);
      expect(result.level).toBe(l);
    }
  });

  it('clips the rectangle to the grid and does nothing outside it', () => {
    const outside = fillCc3dRect(l, rect(20, 20, 2, 2), wall);
    expect(outside.level).toBe(l);
    expect(outside.refused).toBe(false);
    const partial = fillCc3dRect(l, rect(5, 1, 6, 1), wall);
    expect(partial.rect).toEqual(rect(5, 1, 2, 1));
  });

  it('does not modify its input', () => {
    const before = JSON.stringify(l);
    fillCc3dRect(l, rect(1, 1, 5, 2), wall);
    fillCc3dRect(l, rect(1, 1, 5, 2), { action: 'mob', mob: { kind: 'bouncer', x: 0, y: 0, dir: 'N' } });
    expect(JSON.stringify(l)).toBe(before);
  });
});
