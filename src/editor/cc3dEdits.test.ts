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
import { cc3dModel } from '../core/cc3d/cc3dTestMaps';
import { validateCc3dLevel } from '../core/cc3d/cc3dValidator';
import { cellAt, normalizeCell, type Cc3dLevel } from '../core/cc3d/model';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { decodeCc3dLevel } from '../formats/Cc3dXmlCodec';
import {
  eraseCell,
  eraseTop,
  normalizeLayer,
  placeLayer,
  placeMob,
  removeMob,
  rotateMob,
  setItem,
  setPanelSide,
  setPlayer
} from './cc3dEdits';
import { CC3D_CORNERS, DEFAULT_CC3D_ATTRIBUTES, findCc3dEntry, layerOf } from './cc3dPalette';

function base(): Cc3dLevel {
  const model = cc3dModel(['#####', '#@..X', '#.K.M', '#####']);
  // The test glyph for a wall is a bare wall: give every stack the floor base a real level has.
  return { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
}

function errors(level: Cc3dLevel): string[] {
  return validateCc3dLevel(level)
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.i18nKey);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('placeLayer', () => {
  it('replaces the base with a floor-like kind and shares every other cell', () => {
    const level = base();
    const next = placeLayer(level, 2, 1, { kind: 'water' });
    expect(cellAt(next, 2, 1)?.terrain).toEqual([{ kind: 'water' }]);
    expect(next.cells[0]).toBe(level.cells[0]);
    expect(next.cells[1 * 5 + 3]).toBe(level.cells[1 * 5 + 3]);
    expect(next.mobs).toBe(level.mobs);
  });

  it('stacks a device on the base in class order', () => {
    const next = placeLayer(placeLayer(base(), 2, 1, { kind: 'wall' }), 2, 1, { kind: 'bomb' });
    expect(cellAt(next, 2, 1)?.terrain.map((l) => l.kind)).toEqual(['floor', 'bomb', 'wall']);
    expect(errors(next)).toEqual([]);
  });

  it('returns the same level when the cell would not change', () => {
    const level = base();
    expect(placeLayer(level, 2, 1, { kind: 'floor' })).toBe(level);
    const walled = placeLayer(level, 2, 1, { kind: 'wall' });
    expect(placeLayer(walled, 2, 1, { kind: 'wall' })).toBe(walled);
  });

  it('refuses what the validator would reject', () => {
    const level = base();
    expect(placeLayer(level, 2, 1, { kind: 'door' })).toBe(level);
    expect(placeLayer(level, 2, 1, { kind: 'force' })).toBe(level);
    expect(placeLayer(level, 2, 1, { kind: 'ice_corner', corner: ['N', 'S'] })).toBe(level);
    expect(placeLayer(level, 9, 9, { kind: 'water' })).toBe(level);
    expect(placeLayer(level, 2, 1, { kind: 'nonsense' as never })).toBe(level);
  });

  it('keeps only the attributes of the kind', () => {
    const next = placeLayer(base(), 2, 1, { kind: 'door', color: 'red', dir: 'N', open: true });
    expect(cellAt(next, 2, 1)?.terrain[1]).toEqual({ kind: 'door', color: 'red' });
    expect(errors(next)).toEqual([]);
  });
});

describe('eraseTop and eraseCell', () => {
  it('removes the top layer, then falls back to plain floor', () => {
    const stacked = placeLayer(placeLayer(base(), 2, 1, { kind: 'water' }), 2, 1, { kind: 'wall' });
    const once = eraseTop(stacked, 2, 1);
    expect(cellAt(once, 2, 1)?.terrain).toEqual([{ kind: 'water' }]);
    const twice = eraseTop(once, 2, 1);
    expect(cellAt(twice, 2, 1)?.terrain).toEqual([{ kind: 'floor' }]);
    expect(eraseTop(twice, 2, 1)).toBe(twice);
  });

  it('resets a cell to bare floor and drops the mob on it', () => {
    const level = setItem(setPanelSide(base(), 2, 2, 'N', true), 2, 2, { kind: 'fish' });
    const next = eraseCell(level, 2, 2);
    expect(cellAt(next, 2, 2)).toEqual({ terrain: [{ kind: 'floor' }], panels: [], item: null });
    expect(next.mobs.map((m) => m.kind)).toEqual(['walker']);
    expect(eraseCell(next, 2, 2)).toBe(next);
  });
});

describe('setItem and setPanelSide', () => {
  it('needs a colour for a key and ignores a repeated item', () => {
    const level = base();
    expect(setItem(level, 1, 2, { kind: 'key' })).toBe(level);
    const keyed = setItem(level, 1, 2, { kind: 'key', color: 'red' });
    expect(cellAt(keyed, 1, 2)?.item).toEqual({ kind: 'key', color: 'red' });
    expect(setItem(keyed, 1, 2, { kind: 'key', color: 'red' })).toBe(keyed);
    expect(cellAt(setItem(keyed, 1, 2, null), 1, 2)?.item).toBeNull();
  });

  it('keeps the panels in the order N, E, S, W without duplicates', () => {
    let level = setPanelSide(base(), 1, 2, 'W', true);
    level = setPanelSide(level, 1, 2, 'N', true);
    expect(cellAt(level, 1, 2)?.panels).toEqual(['N', 'W']);
    expect(setPanelSide(level, 1, 2, 'N', true)).toBe(level);
    expect(cellAt(setPanelSide(level, 1, 2, 'N', false), 1, 2)?.panels).toEqual(['W']);
    expect(errors(level)).toEqual([]);
  });
});

describe('setPlayer', () => {
  it('moves the start, keeps the facing by default and refuses the outside', () => {
    const level = base();
    const moved = setPlayer(level, 3, 1);
    expect(moved.player).toEqual({ x: 3, y: 1, dir: 'W' });
    expect(setPlayer(moved, 3, 1)).toBe(moved);
    expect(setPlayer(moved, 3, 1, 'N').player.dir).toBe('N');
    expect(setPlayer(level, -1, 0)).toBe(level);
  });
});

describe('mobs', () => {
  it('replaces a mob in place and appends a new one', () => {
    const level = base();
    expect(level.mobs.map((m) => m.kind)).toEqual(['block_dirt', 'walker']);
    const replaced = placeMob(level, { kind: 'bouncer', x: 2, y: 2, dir: 'E' });
    expect(replaced.mobs.map((m) => m.kind)).toEqual(['bouncer', 'walker']);
    const appended = placeMob(replaced, { kind: 'omni', x: 3, y: 1, dir: 'S' });
    expect(appended.mobs.map((m) => m.kind)).toEqual(['bouncer', 'walker', 'omni']);
    expect(errors(appended)).toEqual([]);
  });

  it('does nothing for an identical mob and refuses an incomplete one', () => {
    const level = base();
    const same = { ...level.mobs[0] };
    expect(placeMob(level, same)).toBe(level);
    expect(placeMob(level, { kind: 'block_color', x: 3, y: 1, dir: 'N' })).toBe(level);
    expect(placeMob(level, { kind: 'reflector', x: 3, y: 1, dir: 'N' })).toBe(level);
    expect(placeMob(level, { kind: 'walker', x: 9, y: 1, dir: 'N' })).toBe(level);
    const colored = placeMob(level, { kind: 'block_color', x: 3, y: 1, dir: 'N', color: 'red' });
    expect(colored.mobs[2]).toEqual({ kind: 'block_color', x: 3, y: 1, dir: 'N', color: 'red' });
    const mirror = placeMob(level, { kind: 'reflector', x: 3, y: 1, dir: 'N', mirror: 'LU' });
    expect(errors(mirror)).toEqual([]);
  });

  it('removes a mob and keeps the others in order', () => {
    const level = base();
    const next = removeMob(level, 2, 2);
    expect(next.mobs.map((m) => m.kind)).toEqual(['walker']);
    expect(removeMob(next, 2, 2)).toBe(next);
  });

  it('rotates a quarter turn clockwise or to a direction, keeping the index', () => {
    const level = base();
    expect(level.mobs[0].dir).toBe('N');
    const turned = rotateMob(level, 2, 2);
    expect(turned.mobs[0].dir).toBe('E');
    expect(turned.mobs[1]).toBe(level.mobs[1]);
    expect(rotateMob(turned, 2, 2, 'E')).toBe(turned);
    expect(rotateMob(level, 0, 0)).toBe(level);
    expect(rotateMob(level, 2, 2, 'W').mobs[0].dir).toBe('W');
  });
});

describe('conflicts with the player start', () => {
  it('refuses a reflector whose mirror the validator would not accept, and upper-cases a valid one', () => {
    const level = base();
    expect(placeMob(level, { kind: 'reflector', x: 3, y: 1, dir: 'N', mirror: 'XX' })).toBe(level);
    expect(placeMob(level, { kind: 'reflector', x: 3, y: 1, dir: 'N', mirror: 'ZZ' })).toBe(level);
    expect(placeMob(level, { kind: 'reflector', x: 3, y: 1, dir: 'N', mirror: '' })).toBe(level);
    const lower = placeMob(level, { kind: 'reflector', x: 3, y: 1, dir: 'N', mirror: 'lu' });
    expect(lower.mobs[2].mirror).toBe('LU');
    expect(errors(lower)).toEqual([]);
  });

  it('refuses a player start on a mob and a mob on the player start', () => {
    const level = base();
    expect(setPlayer(level, 2, 2)).toBe(level);
    expect(placeMob(level, { kind: 'walker', x: 1, y: 1, dir: 'N' })).toBe(level);
  });
});

const XML_CELL = 64;
const PLAYER_TYPE = 22;
const TOGGLE_DOOR_GREEN_OPEN_TYPE = 15;
const ICE_CORNER_TYPES = [4, 5, 6, 7];
const ICE_CORNER_PAIRS: ReadonlyArray<readonly ['N' | 'S' | 'E' | 'W', 'N' | 'S' | 'E' | 'W']> = [
  ['S', 'W'],
  ['N', 'W'],
  ['N', 'E'],
  ['E', 'S']
];

/** The cells of a one-row level, decoded from a level file: the reference form a brushed layer must equal. */
function decodedRow(types: number[]) {
  const tile = (type: number, x: number): string =>
    `<tile image_index="${type}" x="${x * XML_CELL}" y="0" direction="0" type="${type}"><attributes flags="0" editor_category="0" name="" /></tile>`;
  const player = `<tile image_index="${PLAYER_TYPE}" x="0" y="${XML_CELL}" direction="3" type="${PLAYER_TYPE}"><attributes flags="0" editor_category="0" name="" /></tile>`;
  const xml = `<?xml version="1.0" encoding="utf-16"?><map name="T" author="A" width="${types.length}" height="2" background="0"><player>${player}</player><tiles>${types.map(tile).join('')}</tiles></map>`;
  return decodeCc3dLevel(xml, { packName: 'pack', mapId: '1', number: 1 }).cc3d!.cells.slice(0, types.length);
}

describe('canonical layers', () => {
  it('gives a closed toggle door the explicit open: false the decoder writes', () => {
    const decoded = decodedRow([TOGGLE_DOOR_GREEN_OPEN_TYPE])[0].terrain[1];
    const entry = findCc3dEntry('layer:toggle_door')!;
    const brushed = layerOf(entry, { ...DEFAULT_CC3D_ATTRIBUTES, color: 'green' }, 'N');
    expect(brushed.open).toBeUndefined();
    expect(normalizeLayer(brushed)).toEqual(decoded);
    expect(normalizeLayer(brushed)).toEqual({ kind: 'toggle_door', color: 'green', open: false });
    const placed = placeLayer(base(), 2, 1, brushed);
    expect(cellAt(placed, 2, 1)?.terrain[1]).toEqual(decoded);
  });

  it('keeps an open toggle door open and leaves a hold door without a state alone', () => {
    expect(normalizeLayer({ kind: 'toggle_door', color: 'red', open: true })).toEqual({ kind: 'toggle_door', color: 'red', open: true });
    expect(normalizeLayer({ kind: 'hold_door', color: 'red' })).toEqual({ kind: 'hold_door', color: 'red' });
    expect(normalizeLayer({ kind: 'hold_door', color: 'red', open: true })).toEqual({ kind: 'hold_door', color: 'red', open: true });
  });

  it('writes every palette ice corner in the decoder order, the south-east one included', () => {
    const decoded = decodedRow(ICE_CORNER_TYPES).map((cell) => cell.terrain[0]);
    expect(decoded.map((layer) => layer.corner)).toEqual(ICE_CORNER_PAIRS);
    const entry = findCc3dEntry('layer:ice_corner')!;
    const brushed = CC3D_CORNERS.map((corner) => normalizeLayer(layerOf(entry, { ...DEFAULT_CC3D_ATTRIBUTES, corner }, 'N')));
    expect(brushed).toHaveLength(decoded.length);
    for (const layer of brushed) expect(decoded).toContainEqual(layer);
    const southEast = CC3D_CORNERS.find((corner) => corner.includes('S') && corner.includes('E'))!;
    expect(southEast).toEqual(['E', 'S']);
  });

  it('rewrites a corner given in any order to the decoder order and refuses a non-corner', () => {
    expect(normalizeLayer({ kind: 'ice_corner', corner: ['W', 'S'] })?.corner).toEqual(['S', 'W']);
    expect(normalizeLayer({ kind: 'ice_corner', corner: ['W', 'N'] })?.corner).toEqual(['N', 'W']);
    expect(normalizeLayer({ kind: 'ice_corner', corner: ['E', 'N'] })?.corner).toEqual(['N', 'E']);
    expect(normalizeLayer({ kind: 'ice_corner', corner: ['S', 'E'] })?.corner).toEqual(['E', 'S']);
    expect(normalizeLayer({ kind: 'ice_corner', corner: ['E', 'S'] })?.corner).toEqual(['E', 'S']);
    expect(normalizeLayer({ kind: 'ice_corner', corner: ['N', 'S'] })).toBeNull();
  });

  it('does not touch the level when the same corner is placed twice in different orders', () => {
    const first = placeLayer(base(), 2, 1, { kind: 'ice_corner', corner: ['S', 'E'] });
    expect(placeLayer(first, 2, 1, { kind: 'ice_corner', corner: ['E', 'S'] })).toBe(first);
  });
});
