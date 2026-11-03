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

import { beforeEach, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EditorMap } from './editorDocument';
import {
  clampMoveStep,
  clearRect,
  clipRectToGrid,
  extractClip,
  moveRect,
  pasteClip,
  rectContains,
  rectFromCells,
  shiftRect
} from './selectionEdits';

/** A bordered map: wall ring, floor inside, player at (1, 1). */
function bordered(width: number, height: number): EditorMap {
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  for (let y = 0; y < height; y++) {
    terrain.push([]);
    items.push([]);
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      terrain[y].push(edge ? 'wall' : 'floor');
      items[y].push(null);
    }
  }
  return { terrain, items, entities: [], trapLinks: [], cloneLinks: [], playerStart: { x: 1, y: 1, dir: 'S' } };
}

/** A map with a trap pair at (2,2)-(4,2), a clone pair at (2,4)-(4,4), a key at (3,3), a block at (5,5). */
function populated(): EditorMap {
  const map = bordered(9, 9);
  map.terrain[2][2] = 'button_brown';
  map.terrain[2][4] = 'trap';
  map.terrain[4][2] = 'button_red';
  map.terrain[4][4] = 'clone_machine';
  map.items[3][3] = 'key_red';
  map.entities = [{ x: 5, y: 5, type: 'dirt_block', dir: 'S' }];
  map.trapLinks = [{ buttonX: 2, buttonY: 2, trapX: 4, trapY: 2 }];
  map.cloneLinks = [{ buttonX: 2, buttonY: 4, clonerX: 4, clonerY: 4, templateType: 'dirt_block', templateDir: 'S' }];
  return map;
}

describe('rectangles', () => {
  it('normalises two cells given in any order and clips them to the grid', () => {
    expect(rectFromCells({ x: 4, y: 3 }, { x: 2, y: 5 }, 9, 9)).toEqual({ x: 2, y: 3, width: 3, height: 3 });
    expect(rectFromCells({ x: -3, y: 2 }, { x: 40, y: 2 }, 9, 9)).toEqual({ x: 0, y: 2, width: 9, height: 1 });
    expect(rectFromCells({ x: 2, y: 2 }, { x: 2, y: 2 }, 9, 9)).toEqual({ x: 2, y: 2, width: 1, height: 1 });
  });

  it('tests membership, shifts, clamps a step and clips to the grid', () => {
    const rect = { x: 2, y: 2, width: 3, height: 2 };
    expect(rectContains(rect, 2, 2)).toBe(true);
    expect(rectContains(rect, 4, 3)).toBe(true);
    expect(rectContains(rect, 5, 2)).toBe(false);
    expect(rectContains(rect, 2, 4)).toBe(false);
    expect(shiftRect(rect, 1, -1)).toEqual({ x: 3, y: 1, width: 3, height: 2 });
    expect(clampMoveStep(rect, -5, 20, 9, 9)).toEqual({ dx: -2, dy: 5 });
    expect(clipRectToGrid({ x: 7, y: -1, width: 4, height: 3 }, 9, 9)).toEqual({ x: 7, y: 0, width: 2, height: 2 });
    expect(clipRectToGrid({ x: 9, y: 0, width: 2, height: 2 }, 9, 9)).toBeNull();
  });
});

describe('extractClip', () => {
  it('takes terrain, items and entities of the rectangle, relative to its corner', () => {
    const clip = extractClip(populated(), { x: 3, y: 3, width: 3, height: 3 }, false);
    expect(clip.width).toBe(3);
    expect(clip.height).toBe(3);
    expect(clip.items[0][0]).toBe('key_red');
    expect(clip.entities).toEqual([{ dx: 2, dy: 2, type: 'dirt_block', dir: 'S' }]);
  });

  it('leaves the player start out of a copy and carries it in a cut', () => {
    const rect = { x: 0, y: 0, width: 3, height: 3 };
    expect(extractClip(populated(), rect, false).playerStart).toBeNull();
    expect(extractClip(populated(), rect, true).playerStart).toEqual({ dx: 1, dy: 1, dir: 'S' });
    expect(extractClip(populated(), { x: 4, y: 4, width: 2, height: 2 }, true).playerStart).toBeNull();
  });

  it('does not alias the map', () => {
    const map = populated();
    const clip = extractClip(map, { x: 3, y: 3, width: 3, height: 3 }, false);
    clip.terrain[0][0] = 'wall';
    expect(map.terrain[3][3]).toBe('floor');
  });
});

describe('clearRect', () => {
  it('turns the cells to floor and removes items and entities', () => {
    const result = clearRect(populated(), { x: 3, y: 3, width: 3, height: 3 });
    expect(result.changed).toBe(true);
    expect(result.map.items[3][3]).toBeNull();
    expect(result.map.entities).toEqual([]);
  });

  it('drops the links that end inside and counts them', () => {
    const result = clearRect(populated(), { x: 4, y: 1, width: 2, height: 4 });
    expect(result.map.trapLinks).toEqual([]);
    expect(result.map.cloneLinks).toEqual([]);
    expect(result.droppedLinks).toBe(2);
  });

  it('keeps the player start and says so', () => {
    const result = clearRect(populated(), { x: 0, y: 0, width: 3, height: 3 });
    expect(result.playerStartKept).toBe(true);
    expect(result.map.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
  });

  it('is not a change on cells that are already empty, and leaves the input alone', () => {
    const map = populated();
    const before = JSON.stringify(map);
    expect(clearRect(map, { x: 6, y: 1, width: 1, height: 1 }).changed).toBe(false);
    clearRect(map, { x: 3, y: 3, width: 3, height: 3 });
    expect(JSON.stringify(map)).toBe(before);
  });
});

describe('pasteClip', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('writes the clip at the origin, replacing what was there', () => {
    const map = populated();
    const clip = extractClip(map, { x: 3, y: 3, width: 3, height: 3 }, false);
    const result = pasteClip(map, clip, 1, 5, 'epoxy');
    expect(result.changed).toBe(true);
    expect(result.rect).toEqual({ x: 1, y: 5, width: 3, height: 3 });
    expect(result.map.items[5][1]).toBe('key_red');
    expect(result.map.entities).toContainEqual({ x: 3, y: 7, type: 'dirt_block', dir: 'S' });
    // The source is untouched by a paste.
    expect(result.map.items[3][3]).toBe('key_red');
  });

  it('replaces an entity standing on a destination cell', () => {
    const map = bordered(9, 9);
    map.entities = [{ x: 2, y: 2, type: 'dirt_block', dir: 'S' }];
    const clip = extractClip(bordered(9, 9), { x: 4, y: 4, width: 1, height: 1 }, false);
    const result = pasteClip(map, clip, 2, 2, 'epoxy');
    expect(result.map.entities).toEqual([]);
  });

  it('never duplicates the player start of a copy', () => {
    const map = populated();
    const clip = extractClip(map, { x: 0, y: 0, width: 3, height: 3 }, false);
    const result = pasteClip(map, clip, 4, 4, 'epoxy');
    expect(result.map.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
  });

  it('moves the player start when the clip carries it', () => {
    const map = populated();
    const clip = extractClip(map, { x: 0, y: 0, width: 3, height: 3 }, true);
    const result = pasteClip(map, clip, 4, 4, 'epoxy');
    expect(result.map.playerStart).toEqual({ x: 5, y: 5, dir: 'S' });
  });

  it('does not copy links, and drops the links ending on a cell it overwrites', () => {
    const map = populated();
    const clip = extractClip(map, { x: 2, y: 2, width: 3, height: 1 }, false);
    const pasted = pasteClip(bordered(9, 9), clip, 2, 6, 'epoxy');
    expect(pasted.map.trapLinks).toEqual([]);
    expect(pasted.map.terrain[6][2]).toBe('button_brown');
    const over = pasteClip(map, extractClip(bordered(9, 9), { x: 1, y: 1, width: 1, height: 1 }, false), 2, 2, 'epoxy');
    expect(over.map.trapLinks).toEqual([]);
    expect(over.droppedLinks).toBe(1);
    expect(over.map.cloneLinks).toHaveLength(1);
  });

  it('clips what falls outside the map and does nothing when all of it does', () => {
    const map = bordered(9, 9);
    const source = populated();
    const clip = extractClip(source, { x: 3, y: 3, width: 3, height: 3 }, false);
    const clipped = pasteClip(map, clip, 7, 7, 'epoxy');
    expect(clipped.rect).toEqual({ x: 7, y: 7, width: 2, height: 2 });
    expect(clipped.map.items[7][7]).toBe('key_red');
    const outside = pasteClip(map, clip, 20, 20, 'epoxy');
    expect(outside.changed).toBe(false);
    expect(outside.rect).toBeNull();
  });

  it('skips Epoxy-only terrain, items and entities under Lynx and counts them', () => {
    const map = bordered(9, 9);
    map.terrain[2][2] = 'laser_emitter_n';
    map.entities = [
      { x: 3, y: 2, type: 'mirror_slash', dir: 'N' },
      { x: 4, y: 2, type: 'dirt_block', dir: 'S' }
    ];
    const clip = extractClip(map, { x: 2, y: 2, width: 3, height: 1 }, false);
    const target = bordered(9, 9);
    target.entities = [{ x: 3, y: 5, type: 'dirt_block', dir: 'E' }];
    const result = pasteClip(target, clip, 2, 5, 'lynx');
    expect(result.skipped).toBe(2);
    expect(result.map.terrain[5][2]).toBe('floor');
    // The mirror cell keeps what it had, the playable block is placed.
    expect(result.map.entities).toContainEqual({ x: 3, y: 5, type: 'dirt_block', dir: 'E' });
    expect(result.map.entities).toContainEqual({ x: 4, y: 5, type: 'dirt_block', dir: 'S' });
    const epoxy = pasteClip(target, clip, 2, 5, 'epoxy');
    expect(epoxy.skipped).toBe(0);
    expect(epoxy.map.terrain[5][2]).toBe('laser_emitter_n');
  });

  it('is not a change when the destination already matches', () => {
    const map = populated();
    const clip = extractClip(map, { x: 5, y: 5, width: 3, height: 3 }, false);
    expect(pasteClip(map, clip, 5, 5, 'epoxy').changed).toBe(false);
  });

  it('drops a link whose end is written over, even with the same tile', () => {
    const map = populated();
    const clip = extractClip(map, { x: 4, y: 4, width: 1, height: 1 }, false);
    const result = pasteClip(map, clip, 4, 4, 'epoxy');
    expect(result.map.cloneLinks).toEqual([]);
    expect(result.droppedLinks).toBe(1);
    expect(result.changed).toBe(true);
  });

  it('skips the whole cell, entity included, when its terrain is unplayable under Lynx', () => {
    const source = bordered(9, 9);
    source.terrain[2][2] = 'laser_emitter_n';
    source.items[2][2] = 'key_red';
    source.entities = [{ x: 2, y: 2, type: 'dirt_block', dir: 'S' }];
    const clip = extractClip(source, { x: 2, y: 2, width: 1, height: 1 }, false);
    const target = bordered(9, 9);
    const result = pasteClip(target, clip, 4, 4, 'lynx');
    expect(result.skipped).toBe(1);
    expect(result.map.terrain[4][4]).toBe('floor');
    expect(result.map.items[4][4]).toBeNull();
    expect(result.map.entities).toEqual([]);
  });
});

describe('moveRect', () => {
  it('moves terrain, item and entity and leaves floor behind', () => {
    const result = moveRect(populated(), { x: 3, y: 3, width: 3, height: 3 }, 1, 0);
    expect(result.changed).toBe(true);
    expect(result.rect).toEqual({ x: 4, y: 3, width: 3, height: 3 });
    expect(result.map.items[3][3]).toBeNull();
    expect(result.map.items[3][4]).toBe('key_red');
    expect(result.map.entities).toEqual([{ x: 6, y: 5, type: 'dirt_block', dir: 'S' }]);
  });

  it('shifts the links whose two ends are inside', () => {
    const result = moveRect(populated(), { x: 2, y: 2, width: 3, height: 1 }, 0, 1);
    expect(result.map.trapLinks).toEqual([{ buttonX: 2, buttonY: 3, trapX: 4, trapY: 3 }]);
    expect(result.map.terrain[3][2]).toBe('button_brown');
    expect(result.map.terrain[2][2]).toBe('floor');
    expect(result.droppedLinks).toBe(0);
    expect(result.map.cloneLinks).toHaveLength(1);
  });

  it('drops the links with one end inside and counts them', () => {
    const result = moveRect(populated(), { x: 2, y: 2, width: 1, height: 1 }, 1, 0);
    expect(result.map.trapLinks).toEqual([]);
    expect(result.droppedLinks).toBe(1);
    expect(result.map.terrain[2][3]).toBe('button_brown');
  });

  it('carries the player start', () => {
    const result = moveRect(populated(), { x: 0, y: 0, width: 3, height: 3 }, 2, 2);
    expect(result.map.playerStart).toEqual({ x: 3, y: 3, dir: 'S' });
  });

  it('keeps the start where it is when it is outside the selection', () => {
    const result = moveRect(populated(), { x: 3, y: 3, width: 3, height: 3 }, 1, 1);
    expect(result.map.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
  });

  it('handles overlapping source and destination', () => {
    const map = bordered(9, 9);
    map.items[2][2] = 'key_red';
    map.items[2][3] = 'key_blue';
    const result = moveRect(map, { x: 2, y: 2, width: 2, height: 1 }, 1, 0);
    expect(result.map.items[2][2]).toBeNull();
    expect(result.map.items[2][3]).toBe('key_red');
    expect(result.map.items[2][4]).toBe('key_blue');
  });

  it('refuses to push the selection out of the map and treats a zero step as no change', () => {
    const map = populated();
    expect(moveRect(map, { x: 6, y: 6, width: 3, height: 3 }, 1, 0).changed).toBe(false);
    expect(moveRect(map, { x: 3, y: 3, width: 2, height: 2 }, 0, 0).changed).toBe(false);
  });

  it('reports the shifted rectangle even when moving empty cells changes nothing', () => {
    const result = moveRect(bordered(9, 9), { x: 3, y: 3, width: 2, height: 2 }, 1, 0);
    expect(result.changed).toBe(false);
    expect(result.rect).toEqual({ x: 4, y: 3, width: 2, height: 2 });
  });

  it('does not modify its input', () => {
    const map = populated();
    const before = JSON.stringify(map);
    moveRect(map, { x: 2, y: 2, width: 3, height: 3 }, 1, 1);
    expect(JSON.stringify(map)).toBe(before);
  });
});
