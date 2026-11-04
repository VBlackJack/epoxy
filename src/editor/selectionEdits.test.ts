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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { editableCc3dModel } from './cc3dEditorFixtures';
import { EditorMap } from './editorDocument';
import { EPOXY_ONLY_REASON_KEY } from './paletteAvailability';
import {
  clampMoveStep,
  clearRect,
  clipRectToGrid,
  extractClip,
  fillBrushRefusal,
  fillRect,
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

  it('never writes the outer ring and counts the ring cells it left alone', () => {
    const map = bordered(9, 9);
    const source = bordered(9, 9);
    source.entities = [{ x: 3, y: 3, type: 'dirt_block', dir: 'S' }, { x: 4, y: 4, type: 'dirt_block', dir: 'S' }];
    const clip = extractClip(source, { x: 3, y: 3, width: 3, height: 3 }, false);
    const result = pasteClip(map, clip, 6, 6, 'epoxy');
    expect(result.borderSkipped).toBe(5);
    expect(result.map.terrain[7][8]).toBe('wall');
    expect(result.map.terrain[8][8]).toBe('wall');
    expect(result.map.terrain[6][8]).toBe('wall');
    expect(result.map.entities).toEqual([{ x: 6, y: 6, type: 'dirt_block', dir: 'S' }, { x: 7, y: 7, type: 'dirt_block', dir: 'S' }]);
  });

  it('does not move the player start onto the ring', () => {
    const map = populated();
    const clip = extractClip(map, { x: 0, y: 0, width: 3, height: 3 }, true);
    const result = pasteClip(map, clip, 7, 7, 'epoxy');
    expect(result.map.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
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

  it('does not write onto the ring when a move reaches it, and counts the cells', () => {
    const map = bordered(9, 9);
    map.items[6][6] = 'key_red';
    map.items[7][7] = 'key_blue';
    const result = moveRect(map, { x: 6, y: 6, width: 2, height: 2 }, 1, 1);
    expect(result.borderSkipped).toBe(3);
    expect(result.map.terrain[8][8]).toBe('wall');
    expect(result.map.terrain[7][8]).toBe('wall');
    expect(result.map.items[7][7]).toBe('key_red');
    expect(result.map.items[6][6]).toBeNull();
  });

  it('leaves ring cells of the selection in place when they are moved', () => {
    const result = moveRect(bordered(9, 9), { x: 0, y: 0, width: 3, height: 3 }, 2, 2);
    expect(result.map.terrain[0][0]).toBe('wall');
    expect(result.map.terrain[0][1]).toBe('wall');
    expect(result.map.terrain[1][0]).toBe('wall');
    expect(result.map.terrain[2][2]).toBe('floor');
    expect(result.map.terrain[3][3]).toBe('floor');
    expect(result.borderSkipped).toBe(5);
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

describe('fillRect', () => {
  const INTERIOR = { x: 2, y: 2, width: 3, height: 3 };

  beforeEach(() => {
    loadTestConfigs();
  });

  it('paints every interior cell of the rectangle with a terrain tile', () => {
    const result = fillRect(bordered(9, 9), INTERIOR, { kind: 'terrain', id: 'water' }, 'S', 'epoxy');
    expect(result.refusal).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.rect).toEqual(INTERIOR);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) expect(result.map.terrain[y][x]).toBe('water');
    expect(result.map.terrain[1][1]).toBe('floor');
    expect(result.map.terrain[5][5]).toBe('floor');
  });

  it('never writes the outer ring and counts the cells it left alone', () => {
    const result = fillRect(bordered(9, 9), { x: 0, y: 0, width: 3, height: 3 }, { kind: 'terrain', id: 'water' }, 'S', 'epoxy');
    expect(result.borderSkipped).toBe(5);
    expect(result.map.terrain[0][0]).toBe('wall');
    expect(result.map.terrain[2][0]).toBe('wall');
    expect(result.map.terrain[1][1]).toBe('water');
    expect(result.map.terrain[2][2]).toBe('water');
  });

  it('keeps the links of a cell whose terrain is already the tile', () => {
    const map = populated();
    const result = fillRect(map, { x: 2, y: 2, width: 1, height: 1 }, { kind: 'terrain', id: 'button_brown' }, 'S', 'epoxy');
    expect(result.changed).toBe(false);
    expect(result.map.trapLinks).toHaveLength(1);
  });

  it('drops links only on the cells whose terrain changes', () => {
    const map = populated();
    // (4,2) is already the trap: only (3,2) changes, so the link from the button to the trap stays.
    const kept = fillRect(map, { x: 3, y: 2, width: 2, height: 1 }, { kind: 'terrain', id: 'trap' }, 'S', 'epoxy');
    expect(kept.droppedLinks).toBe(0);
    expect(kept.map.trapLinks).toHaveLength(1);
    // (2,2) is the button: turning it to another tile drops the link.
    const dropped = fillRect(map, { x: 2, y: 2, width: 3, height: 1 }, { kind: 'terrain', id: 'water' }, 'S', 'epoxy');
    expect(dropped.droppedLinks).toBe(1);
    expect(dropped.map.trapLinks).toHaveLength(0);
    expect(dropped.map.cloneLinks).toHaveLength(1);
  });

  it('keeps the launcher links of a device that stays hidden under the new top, and drops them once it is gone', () => {
    const map = bordered(9, 9);
    map.terrain[2][2] = 'door_red';
    map.terrain[2][5] = 'door_red';
    map.underlays = [
      { x: 2, y: 2, terrain: 'shot_trigger' },
      { x: 5, y: 2, terrain: 'shot_launcher_w' }
    ];
    map.launcherLinks = [{ buttonX: 2, buttonY: 2, launcherX: 5, launcherY: 2 }];
    const kept = fillRect(map, { x: 2, y: 2, width: 4, height: 1 }, { kind: 'terrain', id: 'door_blue' }, 'S', 'epoxy');
    expect(kept.map.launcherLinks).toEqual(map.launcherLinks);
    expect(kept.droppedLinks).toBe(0);
    const gone = fillRect(map, { x: 2, y: 2, width: 4, height: 1 }, { kind: 'terrain', id: 'wall' }, 'S', 'epoxy');
    expect(gone.map.launcherLinks).toBeUndefined();
    expect(gone.droppedLinks).toBe(1);
  });

  it('writes an item on the item layer only, keeping the links', () => {
    const map = populated();
    const result = fillRect(map, { x: 2, y: 2, width: 3, height: 1 }, { kind: 'item', id: 'key_red' }, 'S', 'epoxy');
    expect(result.changed).toBe(true);
    expect(result.droppedLinks).toBe(0);
    expect(result.map.items[2].slice(2, 5)).toEqual(['key_red', 'key_red', 'key_red']);
    expect(result.map.terrain).toEqual(map.terrain);
    expect(result.map.trapLinks).toEqual(map.trapLinks);
  });

  it('replaces whatever stands on the cells with the entity, facing the given direction', () => {
    const result = fillRect(populated(), { x: 4, y: 4, width: 3, height: 3 }, { kind: 'entity', id: 'dirt_block' }, 'E', 'epoxy');
    expect(result.map.entities).toHaveLength(9);
    expect(result.map.entities.every((e) => e.type === 'dirt_block' && e.dir === 'E')).toBe(true);
    expect(result.map.entities.filter((e) => e.x === 5 && e.y === 5)).toHaveLength(1);
  });

  it('keeps the order of entities that already match the fill', () => {
    const map = bordered(9, 9);
    map.entities = [
      { x: 3, y: 3, type: 'dirt_block', dir: 'E' },
      { x: 2, y: 3, type: 'dirt_block', dir: 'E' }
    ];
    const result = fillRect(map, { x: 2, y: 3, width: 2, height: 1 }, { kind: 'entity', id: 'dirt_block' }, 'E', 'epoxy');
    expect(result.changed).toBe(false);
    expect(result.map.entities).toEqual(map.entities);
  });

  it('leaves the player start cell alone when filling with an entity, and says so', () => {
    const result = fillRect(bordered(9, 9), { x: 1, y: 1, width: 2, height: 1 }, { kind: 'entity', id: 'dirt_block' }, 'S', 'epoxy');
    expect(result.playerStartKept).toBe(true);
    expect(result.skipped).toBe(1);
    expect(result.map.entities).toEqual([{ x: 2, y: 1, type: 'dirt_block', dir: 'S' }]);
    expect(result.map.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
  });

  it('does paint the terrain of the player start cell', () => {
    const result = fillRect(bordered(9, 9), { x: 1, y: 1, width: 1, height: 1 }, { kind: 'terrain', id: 'water' }, 'S', 'epoxy');
    expect(result.playerStartKept).toBe(false);
    expect(result.map.terrain[1][1]).toBe('water');
  });

  it('keeps the thin walls of the cells, as painting does', () => {
    const map = { ...bordered(9, 9), cellEdges: [{ x: 3, y: 3, sides: ['N' as const, 'E' as const] }] };
    for (const brush of [
      { kind: 'terrain' as const, id: 'water' },
      { kind: 'item' as const, id: 'key_red' },
      { kind: 'entity' as const, id: 'dirt_block' }
    ]) {
      const result = fillRect(map, INTERIOR, brush, 'S', 'epoxy');
      expect(result.changed).toBe(true);
      expect(result.map.cellEdges).toEqual(map.cellEdges);
    }
  });

  it('is a no-op when the cells already hold the tile', () => {
    const result = fillRect(bordered(9, 9), INTERIOR, { kind: 'terrain', id: 'floor' }, 'S', 'epoxy');
    expect(result.changed).toBe(false);
    expect(result.refusal).toBeNull();
    expect(result.rect).toEqual(INTERIOR);
  });

  it('refuses the whole fill when the ruleset cannot play the entry, with its reason', () => {
    const map = bordered(9, 9);
    const mirror = Object.entries(ConfigRegistry.getMonsters().entities).find(([, def]) => def.mirrorAxis !== undefined)?.[0] ?? '';
    expect(mirror).not.toBe('');
    for (const brush of [
      { kind: 'terrain' as const, id: 'laser_emitter_n' },
      { kind: 'item' as const, id: 'laser_emitter_n' },
      { kind: 'entity' as const, id: mirror }
    ]) {
      const result = fillRect(map, INTERIOR, brush, 'S', 'lynx');
      expect(result.refusal).toEqual({ reason: 'unavailable', reasonKey: EPOXY_ONLY_REASON_KEY });
      expect(result.changed).toBe(false);
      expect(result.map).toBe(map);
    }
    expect(fillRect(map, INTERIOR, { kind: 'terrain', id: 'laser_emitter_n' }, 'S', 'epoxy').refusal).toBeNull();
  });

  it('refuses the player start and the thin wall brush', () => {
    const map = bordered(9, 9);
    for (const kind of ['player_start'] as const) {
      const result = fillRect(map, INTERIOR, { kind, id: kind }, 'S', 'epoxy');
      expect(result.refusal).toEqual({ reason: 'unsupported' });
      expect(result.changed).toBe(false);
    }
    const edge = fillRect(map, INTERIOR, { kind: 'cell_edge', id: 'cell_edge' }, 'S', 'epoxy');
    expect(edge.refusal).toEqual({ reason: 'cell_edge' });
    expect(edge.map).toBe(map);
    expect(fillBrushRefusal({ kind: 'cell_edge', id: 'cell_edge' }, 'lynx')).toEqual({ reason: 'cell_edge' });
    expect(fillBrushRefusal({ kind: 'terrain', id: 'wall' }, 'lynx')).toBeNull();
  });

  it('keeps the launcher links of launchers filled with another facing, and drops those of any other change', () => {
    const map = bordered(9, 9);
    map.terrain[2][2] = 'shot_trigger';
    map.terrain[2][5] = 'shot_launcher_w';
    map.launcherLinks = [{ buttonX: 2, buttonY: 2, launcherX: 5, launcherY: 2 }];
    const area = { x: 5, y: 2, width: 1, height: 1 };
    const turned = fillRect(map, area, { kind: 'terrain', id: 'shot_launcher_n' }, 'S', 'epoxy');
    expect(turned.map.terrain[2][5]).toBe('shot_launcher_n');
    expect(turned.map.launcherLinks).toEqual(map.launcherLinks);
    expect(turned.droppedLinks).toBe(0);
    const replaced = fillRect(map, area, { kind: 'terrain', id: 'floor' }, 'S', 'epoxy');
    expect(replaced.map.launcherLinks).toBeUndefined();
    expect(replaced.droppedLinks).toBe(1);
    expect(map.launcherLinks).toHaveLength(1);
  });

  it('leaves a CC3D map alone', () => {
    const map: EditorMap = { ...bordered(5, 5), cc3d: editableCc3dModel(['###', '#@#', '###']) };
    const result = fillRect(map, INTERIOR, { kind: 'terrain', id: 'water' }, 'S', 'epoxy');
    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
  });

  it('does not modify its input', () => {
    const map = populated();
    const before = JSON.stringify(map);
    fillRect(map, { x: 2, y: 2, width: 4, height: 4 }, { kind: 'terrain', id: 'water' }, 'S', 'epoxy');
    fillRect(map, { x: 2, y: 2, width: 4, height: 4 }, { kind: 'entity', id: 'dirt_block' }, 'S', 'epoxy');
    expect(JSON.stringify(map)).toBe(before);
  });
});

describe('clone templates in selections', () => {
  it('a fill with a creature updates the templates of the clone machines it covers', () => {
    const map = populated();
    const result = fillRect(map, { x: 4, y: 4, width: 1, height: 1 }, { kind: 'entity', id: 'turret_fixed' }, 'W', 'epoxy');
    expect(result.map.cloneLinks[0]).toMatchObject({ templateType: 'turret_fixed', templateDir: 'W' });
    expect(result.clonerTemplates).toEqual([{ x: 4, y: 4, type: 'turret_fixed', dir: 'W' }]);
  });

  it('a fill with the same creature and facing re-syncs a drifted template and reports it, else changes nothing', () => {
    const map = populated();
    map.entities.push({ x: 4, y: 4, type: 'walker', dir: 'E' });
    const rect = { x: 4, y: 4, width: 1, height: 1 };
    const drifted = fillRect(map, rect, { kind: 'entity', id: 'walker' }, 'E', 'epoxy');
    expect(drifted.changed).toBe(true);
    expect(drifted.map.cloneLinks[0]).toMatchObject({ templateType: 'walker', templateDir: 'E' });
    expect(drifted.clonerTemplates).toEqual([{ x: 4, y: 4, type: 'walker', dir: 'E' }]);
    const aligned = fillRect(drifted.map, rect, { kind: 'entity', id: 'walker' }, 'E', 'epoxy');
    expect(aligned.changed).toBe(false);
    expect(aligned.clonerTemplates).toBeUndefined();
  });

  it('a move carries a clone machine with its link and creature, template intact', () => {
    const map = populated();
    map.entities.push({ x: 4, y: 4, type: 'walker', dir: 'E' });
    map.cloneLinks[0] = { ...map.cloneLinks[0], templateType: 'walker', templateDir: 'E' };
    const moved = moveRect(map, { x: 2, y: 4, width: 3, height: 1 }, 0, 1);
    expect(moved.map.cloneLinks[0]).toMatchObject({ clonerY: 5, templateType: 'walker', templateDir: 'E' });
    expect(moved.map.entities.find((e) => e.type === 'walker')).toMatchObject({ x: 4, y: 5, dir: 'E' });
  });

  it('a paste over a clone machine drops its link instead of leaving a stale template', () => {
    const map = populated();
    const clip = extractClip(map, { x: 5, y: 5, width: 1, height: 1 }, false);
    const pasted = pasteClip(map, clip, 4, 4, 'epoxy');
    expect(pasted.map.cloneLinks).toEqual([]);
    expect(pasted.droppedLinks).toBe(1);
  });
});
