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

import { describe, expect, it } from 'vitest';
import type { Cc3dLevel } from '../core/cc3d/model';
import { cellAt } from '../core/cc3d/model';
import type { Direction } from '../core/types';
import { editableCc3dModel } from './cc3dEditorFixtures';
import { DEFAULT_CC3D_ATTRIBUTES, findCc3dEntry, type Cc3dBrushAttributes } from './cc3dPalette';
import {
  applyCc3dTool,
  cc3dContinuesOnDrag,
  type Cc3dToolInput,
  eraseTopmost,
  MESSAGE_CC3D_FILL_NEEDS_LAYER,
  MESSAGE_CC3D_MOB_ON_START,
  MESSAGE_CC3D_START_ON_MOB,
  nearestSide,
  pickCc3dCell
} from './cc3dTools';

/** A 5x4 room: walls around, floor inside, the player at (1, 1), a walker at (3, 1). */
function room(): Cc3dLevel {
  return editableCc3dModel(['#####', '#@.M#', '#...#', '#####']);
}

function input(level: Cc3dLevel, entryId: string | null, patch: Partial<Cc3dToolInput> = {}): Cc3dToolInput {
  return {
    level,
    tool: 'brush',
    entry: entryId ? (findCc3dEntry(entryId) ?? null) : null,
    attrs: DEFAULT_CC3D_ATTRIBUTES,
    dir: 'N',
    x: 2,
    y: 2,
    side: 'N',
    ...patch
  };
}

describe('brush on a CC3D level', () => {
  it('places a layer, with the colour of the chooser and the facing of the direction control', () => {
    const attrs: Cc3dBrushAttributes = { ...DEFAULT_CC3D_ATTRIBUTES, color: 'blue' };
    const door = applyCc3dTool(input(room(), 'layer:door', { attrs }));
    expect(door.changed).toBe(true);
    expect(cellAt(door.level, 2, 2)?.terrain).toEqual([{ kind: 'floor' }, { kind: 'door', color: 'blue' }]);
    const force = applyCc3dTool(input(room(), 'layer:force', { dir: 'W' }));
    expect(cellAt(force.level, 2, 2)?.terrain[0]).toEqual({ kind: 'force', dir: 'W' });
  });

  it('places an ice corner on its chosen corner and an open toggle door open', () => {
    const attrs: Cc3dBrushAttributes = { ...DEFAULT_CC3D_ATTRIBUTES, corner: ['S', 'W'] };
    expect(cellAt(applyCc3dTool(input(room(), 'layer:ice_corner', { attrs })).level, 2, 2)?.terrain[0]).toEqual({ kind: 'ice_corner', corner: ['S', 'W'] });
    const open = applyCc3dTool(input(room(), 'layer:toggle_door:open'));
    expect(cellAt(open.level, 2, 2)?.terrain[1]).toEqual({ kind: 'toggle_door', color: 'red', open: true });
  });

  it('places items, mobs and the player start', () => {
    expect(cellAt(applyCc3dTool(input(room(), 'item:key', { attrs: { ...DEFAULT_CC3D_ATTRIBUTES, color: 'green' } })).level, 2, 2)?.item).toEqual({
      kind: 'key',
      color: 'green'
    });
    const mob = applyCc3dTool(input(room(), 'mob:reflector', { dir: 'E' })).level.mobs.at(-1);
    expect(mob).toEqual({ kind: 'reflector', x: 2, y: 2, dir: 'E', mirror: DEFAULT_CC3D_ATTRIBUTES.mirror });
    const start = applyCc3dTool(input(room(), 'player:player', { dir: 'S' })).level.player;
    expect(start).toEqual({ x: 2, y: 2, dir: 'S' });
  });

  it('says why a creature cannot go on the start nor the start on a creature', () => {
    const onStart = applyCc3dTool(input(room(), 'mob:walker', { x: 1, y: 1 }));
    expect(onStart.changed).toBe(false);
    expect(onStart.messages).toEqual([{ key: MESSAGE_CC3D_MOB_ON_START }]);
    const onMob = applyCc3dTool(input(room(), 'player:player', { x: 3, y: 1 }));
    expect(onMob.changed).toBe(false);
    expect(onMob.messages).toEqual([{ key: MESSAGE_CC3D_START_ON_MOB }]);
  });

  it('does nothing without an entry, and reports no change when the cell already holds it', () => {
    const level = room();
    expect(applyCc3dTool(input(level, null)).level).toBe(level);
    const once = applyCc3dTool(input(level, 'layer:water')).level;
    expect(applyCc3dTool(input(once, 'layer:water')).changed).toBe(false);
  });

  it('toggles the side of the pointer in the thin wall mode, and the side of the direction control by keyboard', () => {
    const on = applyCc3dTool(input(room(), 'panel:panel', { side: 'E' }));
    expect(cellAt(on.level, 2, 2)?.panels).toEqual(['E']);
    const more = applyCc3dTool(input(on.level, 'panel:panel', { side: 'N' }));
    expect(cellAt(more.level, 2, 2)?.panels).toEqual(['N', 'E']);
    const off = applyCc3dTool(input(more.level, 'panel:panel', { side: 'E' }));
    expect(cellAt(off.level, 2, 2)?.panels).toEqual(['N']);
  });

  it('leaves select and the picker without effect', () => {
    const level = room();
    for (const tool of ['select', 'picker'] as const) {
      expect(applyCc3dTool(input(level, 'layer:wall', { tool })).level).toBe(level);
    }
  });
});

describe('eraser on a CC3D level', () => {
  /** (2, 2) holds a wall over floor, a key and a thin wall; (3, 1) holds the walker. */
  function loaded(): Cc3dLevel {
    let level = room();
    level = applyCc3dTool(input(level, 'layer:wall')).level;
    level = applyCc3dTool(input(level, 'item:fish')).level;
    level = applyCc3dTool(input(level, 'panel:panel', { side: 'S' })).level;
    return level;
  }

  it('takes the creature, then the item, then the top layer, then the thin walls', () => {
    let level = applyCc3dTool(input(loaded(), 'mob:walker')).level;
    expect(level.mobs.some((mob) => mob.x === 2 && mob.y === 2)).toBe(true);
    const erase = (current: Cc3dLevel): Cc3dLevel => applyCc3dTool(input(current, null, { tool: 'eraser' })).level;
    level = erase(level);
    expect(level.mobs.some((mob) => mob.x === 2 && mob.y === 2)).toBe(false);
    expect(cellAt(level, 2, 2)?.item).not.toBeNull();
    level = erase(level);
    expect(cellAt(level, 2, 2)?.item).toBeNull();
    expect(cellAt(level, 2, 2)?.terrain).toHaveLength(2);
    level = erase(level);
    expect(cellAt(level, 2, 2)?.terrain).toEqual([{ kind: 'floor' }]);
    expect(cellAt(level, 2, 2)?.panels).toEqual(['S']);
    level = erase(level);
    expect(cellAt(level, 2, 2)?.panels).toEqual([]);
    expect(erase(level)).toBe(level);
  });

  it('clears the whole cell with Shift, the creature included', () => {
    const withMob = applyCc3dTool(input(loaded(), 'mob:walker')).level;
    const cleared = applyCc3dTool(input(withMob, null, { tool: 'eraser', wholeCell: true })).level;
    expect(cellAt(cleared, 2, 2)).toEqual({ terrain: [{ kind: 'floor' }], panels: [], item: null });
    expect(cleared.mobs.some((mob) => mob.x === 2 && mob.y === 2)).toBe(false);
  });

  it('erases with the secondary button whatever the tool is, and keeps the start', () => {
    const level = loaded();
    const erased = applyCc3dTool(input(level, 'layer:water', { tool: 'brush', forceErase: true })).level;
    expect(cellAt(erased, 2, 2)?.item).toBeNull();
    expect(eraseTopmost(level, 1, 1)).toBe(level);
    expect(erased.player).toEqual(level.player);
  });
});

describe('picker on a CC3D level', () => {
  it('picks the creature first, with its facing', () => {
    const picked = pickCc3dCell(room(), 3, 1);
    expect(picked?.entryId).toBe('mob:walker');
    expect(picked?.dir).toBe('N');
  });

  it('picks the item before the layers, with its colour', () => {
    let level = applyCc3dTool(input(room(), 'layer:wall')).level;
    level = applyCc3dTool(input(level, 'item:key', { attrs: { ...DEFAULT_CC3D_ATTRIBUTES, color: 'yellow' } })).level;
    expect(pickCc3dCell(level, 2, 2)).toEqual({ entryId: 'item:key', attrs: { color: 'yellow' } });
  });

  it('picks the top layer with its colour, direction and corner', () => {
    const door = applyCc3dTool(input(room(), 'layer:door', { attrs: { ...DEFAULT_CC3D_ATTRIBUTES, color: 'green' } })).level;
    expect(pickCc3dCell(door, 2, 2)).toEqual({ entryId: 'layer:door', attrs: { color: 'green' } });
    const force = applyCc3dTool(input(room(), 'layer:force', { dir: 'S' })).level;
    expect(pickCc3dCell(force, 2, 2)).toEqual({ entryId: 'layer:force', attrs: {}, dir: 'S' });
    const corner = applyCc3dTool(input(room(), 'layer:ice_corner', { attrs: { ...DEFAULT_CC3D_ATTRIBUTES, corner: ['E', 'S'] } })).level;
    expect(pickCc3dCell(corner, 2, 2)?.attrs).toEqual({ corner: ['E', 'S'] });
    const open = applyCc3dTool(input(room(), 'layer:toggle_door:open')).level;
    expect(pickCc3dCell(open, 2, 2)?.entryId).toBe('layer:toggle_door:open');
  });

  it('picks an ice corner stored in the old order in the canonical order', () => {
    const base = applyCc3dTool(input(room(), 'layer:ice_corner', { attrs: { ...DEFAULT_CC3D_ATTRIBUTES, corner: ['E', 'S'] } })).level;
    const old = { ...base, cells: base.cells.map((cell) => ({ ...cell, terrain: cell.terrain.map((layer) => (layer.corner ? { ...layer, corner: ['S', 'E'] as [Direction, Direction] } : layer)) })) };
    expect(pickCc3dCell(old, 2, 2)?.attrs).toEqual({ corner: ['E', 'S'] });
  });

  it('refuses a cell outside the grid', () => {
    expect(pickCc3dCell(room(), 9, 9)).toBeNull();
  });
});

describe('tool helpers', () => {
  it('fills the region around the cell with a layer entry, and answers a message for any other entry', () => {
    const filled = applyCc3dTool(input(room(), 'layer:water', { tool: 'fill' }));
    expect(filled.changed).toBe(true);
    expect([cellAt(filled.level, 1, 1), cellAt(filled.level, 2, 2), cellAt(filled.level, 3, 2)].map((cell) => cell?.terrain.at(-1)?.kind)).toEqual([
      'water',
      'water',
      'water'
    ]);
    expect(cellAt(filled.level, 0, 0)?.terrain.at(-1)?.kind).toBe('wall');
    const refused = applyCc3dTool(input(room(), 'item:fish', { tool: 'fill' }));
    expect(refused.changed).toBe(false);
    expect(refused.messages).toEqual([{ key: MESSAGE_CC3D_FILL_NEEDS_LAYER }]);
    expect(applyCc3dTool(input(room(), null, { tool: 'fill' })).messages).toEqual([{ key: MESSAGE_CC3D_FILL_NEEDS_LAYER }]);
    expect(applyCc3dTool(input(room(), 'layer:water', { tool: 'select' })).changed).toBe(false);
  });

  it('keeps acting on drag except for a thin wall', () => {
    const wall = findCc3dEntry('layer:wall') ?? null;
    const panel = findCc3dEntry('panel:panel') ?? null;
    expect(cc3dContinuesOnDrag('brush', wall, false)).toBe(true);
    expect(cc3dContinuesOnDrag('brush', panel, false)).toBe(false);
    expect(cc3dContinuesOnDrag('brush', panel, true)).toBe(true);
    expect(cc3dContinuesOnDrag('eraser', panel, false)).toBe(true);
    expect(cc3dContinuesOnDrag('brush', null, false)).toBe(false);
    expect(cc3dContinuesOnDrag('picker', wall, false)).toBe(false);
  });

  it('finds the side of a cell nearest to a point', () => {
    const cases: Array<[number, number, Direction]> = [
      [0.5, 0.05, 'N'],
      [0.95, 0.5, 'E'],
      [0.5, 0.95, 'S'],
      [0.05, 0.5, 'W'],
      [0.2, 0.1, 'N'],
      [0.1, 0.2, 'W'],
      [0.5, 0.5, 'N']
    ];
    for (const [fx, fy, side] of cases) expect(nearestSide(fx, fy), `${fx},${fy}`).toBe(side);
  });
});
