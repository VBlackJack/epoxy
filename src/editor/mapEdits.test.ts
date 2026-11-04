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
import { emptyCc3dRoom } from './cc3dRoom';
import { EditorMap } from './editorDocument';
import { ResizeAnchor } from './resizeAnchor';
import {
  eraseCell,
  floodFillTerrain,
  keepsLauncherLinks,
  paintEntity,
  paintItem,
  paintPlayerStart,
  paintTerrain,
  placeWireButton,
  placeWireLink,
  resizeMap,
  startLauncherWire,
  toggleCellEdge,
  toggleLauncherLink,
  wireButtonTile
} from './mapEdits';

const BOUNDS = { minSize: 5, maxSize: 12 };

// Edits read the tile config (hidden terrain, launcher roles), as the editor does.
beforeEach(() => {
  loadTestConfigs();
});

/** A bordered map of the given size: wall ring, floor inside, player at (1, 1). */
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

function withLinks(): EditorMap {
  const map = bordered(8, 8);
  map.terrain[2][2] = 'button_brown';
  map.terrain[2][4] = 'trap';
  map.terrain[4][2] = 'button_red';
  map.terrain[4][4] = 'clone_machine';
  map.trapLinks = [{ buttonX: 2, buttonY: 2, trapX: 4, trapY: 2 }];
  map.cloneLinks = [{ buttonX: 2, buttonY: 4, clonerX: 4, clonerY: 4, templateType: 'dirt_block', templateDir: 'S' }];
  return map;
}

describe('painting', () => {
  it('never modifies its input', () => {
    const map = bordered(7, 7);
    const snapshot = JSON.stringify(map);
    paintTerrain(map, 3, 3, 'water');
    paintItem(map, 3, 3, 'chip');
    paintEntity(map, 3, 3, 'dirt_block', 'N');
    paintPlayerStart(map, 3, 3, 'E');
    eraseCell(map, 0, 0);
    floodFillTerrain(map, 2, 2, 'ice');
    expect(JSON.stringify(map)).toBe(snapshot);
  });

  it('paints terrain, items, entities and the player start', () => {
    let map = bordered(7, 7);
    map = paintTerrain(map, 3, 3, 'water').map;
    map = paintItem(map, 2, 2, 'chip').map;
    map = paintEntity(map, 4, 4, 'dirt_block', 'N').map;
    map = paintEntity(map, 4, 4, 'tank', 'E').map;
    map = paintPlayerStart(map, 5, 5, 'W').map;
    expect(map.terrain[3][3]).toBe('water');
    expect(map.items[2][2]).toBe('chip');
    expect(map.entities).toEqual([{ x: 4, y: 4, type: 'tank', dir: 'E' }]);
    expect(map.playerStart).toEqual({ x: 5, y: 5, dir: 'W' });
  });

  it('ignores a cell outside the grid', () => {
    const map = bordered(7, 7);
    const result = paintTerrain(map, 9, 0, 'water');
    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
    expect(paintEntity(map, -1, 0, 'tank', 'N').changed).toBe(false);
  });

  it('removes the links of an overwritten button or trap', () => {
    const map = withLinks();
    const overButton = paintTerrain(map, 2, 2, 'floor');
    expect(overButton.map.trapLinks).toEqual([]);
    expect(overButton.removedLinks).toBe(1);
    expect(overButton.map.cloneLinks).toHaveLength(1);
    expect(paintTerrain(map, 4, 2, 'wall').map.trapLinks).toEqual([]);
  });

  it('removes the links of an overwritten clone button or cloner', () => {
    const map = withLinks();
    expect(paintTerrain(map, 2, 4, 'floor').map.cloneLinks).toEqual([]);
    expect(paintTerrain(map, 4, 4, 'floor').map.cloneLinks).toEqual([]);
    expect(paintTerrain(map, 4, 4, 'floor').map.trapLinks).toHaveLength(1);
  });

  it('keeps the links when the same tile is painted again', () => {
    const map = withLinks();
    const result = paintTerrain(map, 2, 2, 'button_brown');
    expect(result.changed).toBe(false);
    expect(result.map.trapLinks).toHaveLength(1);
  });
});

describe('no-op edits', () => {
  it('report changed false when the map would be identical', () => {
    const map = bordered(7, 7);
    map.entities.push({ x: 3, y: 3, type: 'tank', dir: 'N' });
    expect(eraseCell(map, 4, 4).changed).toBe(false);
    expect(eraseCell(map, 4, 4).map).toBe(map);
    expect(eraseCell(map, 3, 3).changed).toBe(true);
    expect(paintEntity(map, 3, 3, 'tank', 'N').changed).toBe(false);
    expect(paintEntity(map, 3, 3, 'tank', 'S').changed).toBe(true);
    expect(paintEntity(map, 3, 3, 'dirt_block', 'N').changed).toBe(true);
    expect(paintPlayerStart(map, 1, 1, 'S').changed).toBe(false);
    expect(paintPlayerStart(map, 1, 1, 'N').changed).toBe(true);
    expect(paintPlayerStart(map, 2, 1, 'S').changed).toBe(true);
  });

  it('still reports the kept player start on an empty start cell', () => {
    expect(eraseCell(bordered(7, 7), 1, 1)).toMatchObject({ changed: false, playerStartKept: true });
  });
});

describe('eraseCell', () => {
  it('clears terrain, item, entity and links', () => {
    const map = withLinks();
    map.items[2][4] = 'chip';
    map.entities.push({ x: 4, y: 2, type: 'tank', dir: 'N' });
    const result = eraseCell(map, 4, 2);
    expect(result.map.terrain[2][4]).toBe('floor');
    expect(result.map.items[2][4]).toBeNull();
    expect(result.map.entities).toEqual([]);
    expect(result.map.trapLinks).toEqual([]);
    expect(result.removedLinks).toBe(1);
    expect(result.playerStartKept).toBe(false);
  });

  it('does not erase the player start and says so', () => {
    const map = bordered(7, 7);
    map.items[1][1] = 'chip';
    const result = eraseCell(map, 1, 1);
    expect(result.playerStartKept).toBe(true);
    expect(result.map.playerStart).toEqual({ x: 1, y: 1, dir: 'S' });
    expect(result.map.items[1][1]).toBeNull();
  });
});

describe('floodFillTerrain', () => {
  it('fills a 4-connected region only', () => {
    const map = bordered(7, 7);
    for (let y = 0; y < 7; y++) map.terrain[y][3] = 'wall';
    const result = floodFillTerrain(map, 1, 1, 'ice');
    expect(result.map.terrain[1][1]).toBe('ice');
    expect(result.map.terrain[5][2]).toBe('ice');
    expect(result.map.terrain[1][5]).toBe('floor');
    expect(result.map.terrain[3][3]).toBe('wall');
  });

  it('does nothing when the cell already has the tile', () => {
    const map = bordered(7, 7);
    expect(floodFillTerrain(map, 2, 2, 'floor').changed).toBe(false);
  });

  it('removes links ending on a filled cell', () => {
    const map = bordered(8, 8);
    map.terrain[2][2] = 'button_brown';
    map.terrain[5][5] = 'trap';
    map.trapLinks = [{ buttonX: 2, buttonY: 2, trapX: 5, trapY: 5 }];
    expect(floodFillTerrain(map, 3, 3, 'ice').map.trapLinks).toHaveLength(1);
    const result = floodFillTerrain(map, 5, 5, 'ice');
    expect(result.map.trapLinks).toEqual([]);
    expect(result.removedLinks).toBe(1);
  });
});

describe('wires', () => {
  it('places the button, then links it to the target', () => {
    let map = bordered(8, 8);
    map = placeWireButton(map, 'trap', 2, 2).map;
    const result = placeWireLink(map, 'trap', { x: 2, y: 2 }, { x: 5, y: 5 }, 'S');
    expect(result.refused).toBe(false);
    expect(result.map.terrain[2][2]).toBe('button_brown');
    expect(result.map.terrain[5][5]).toBe('trap');
    expect(result.map.trapLinks).toEqual([{ buttonX: 2, buttonY: 2, trapX: 5, trapY: 5 }]);
  });

  it('refuses a wire whose source is its target', () => {
    const map = bordered(8, 8);
    const result = placeWireLink(map, 'clone', { x: 3, y: 3 }, { x: 3, y: 3 }, 'S');
    expect(result.refused).toBe(true);
    expect(result.refusal).toBe('same_cell');
    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
  });

  it('refuses a wire whose source no longer holds the button', () => {
    const map = bordered(8, 8);
    const result = placeWireLink(map, 'trap', { x: 2, y: 2 }, { x: 5, y: 5 }, 'S');
    expect(result.refused).toBe(true);
    expect(result.refusal).toBe('missing_button');
    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
    const wrongKind = placeWireButton(map, 'clone', 2, 2).map;
    expect(placeWireLink(wrongKind, 'trap', { x: 2, y: 2 }, { x: 5, y: 5 }, 'S').refusal).toBe('missing_button');
  });

  it('copies the entity on the cloner into a clone link, else the default template', () => {
    const map = placeWireButton(bordered(8, 8), 'clone', 2, 2).map;
    map.entities.push({ x: 5, y: 5, type: 'tank', dir: 'W' });
    const withEntity = placeWireLink(map, 'clone', { x: 2, y: 2 }, { x: 5, y: 5 }, 'N');
    expect(withEntity.map.cloneLinks[0]).toMatchObject({ clonerX: 5, clonerY: 5, templateType: 'tank', templateDir: 'W' });
    expect(withEntity.map.terrain[5][5]).toBe('clone_machine');
    const without = placeWireLink(placeWireButton(bordered(8, 8), 'clone', 2, 2).map, 'clone', { x: 2, y: 2 }, { x: 4, y: 4 }, 'N');
    expect(without.map.cloneLinks[0]).toMatchObject({ templateType: 'dirt_block', templateDir: 'N' });
  });

  it('replaces a link joining the same cells instead of doubling it', () => {
    let map = bordered(8, 8);
    map = placeWireButton(map, 'trap', 2, 2).map;
    map = placeWireLink(map, 'trap', { x: 2, y: 2 }, { x: 5, y: 5 }, 'S').map;
    map = placeWireLink(map, 'trap', { x: 2, y: 2 }, { x: 5, y: 5 }, 'S').map;
    expect(map.trapLinks).toHaveLength(1);
  });
});

describe('resizeMap', () => {
  it('grows with floor inside and a wall border', () => {
    const map = bordered(7, 7);
    const result = resizeMap(map, 10, 9, BOUNDS);
    expect(result.width).toBe(10);
    expect(result.height).toBe(9);
    expect(result.map.terrain).toHaveLength(9);
    expect(result.map.terrain[0]).toHaveLength(10);
    expect(result.map.terrain[4][6]).toBe('floor');
    expect(result.map.terrain[4][9]).toBe('wall');
    expect(result.map.terrain[8][4]).toBe('wall');
    expect(result.map.terrain[7][3]).toBe('floor');
    expect(result.report.borderKept).toBe(true);
  });

  it('shrinks, dropping what lies outside and reporting it', () => {
    const map = withLinks();
    map.entities.push({ x: 6, y: 6, type: 'tank', dir: 'N' }, { x: 2, y: 3, type: 'tank', dir: 'N' });
    map.trapLinks.push({ buttonX: 2, buttonY: 2, trapX: 6, trapY: 1 });
    const result = resizeMap(map, 6, 6, BOUNDS);
    expect(result.map.terrain).toHaveLength(6);
    expect(result.map.entities).toEqual([{ x: 2, y: 3, type: 'tank', dir: 'N' }]);
    expect(result.report.droppedEntities).toBe(1);
    expect(result.report.droppedTrapLinks).toBe(1);
    expect(result.report.droppedCloneLinks).toBe(0);
    expect(result.map.terrain[5][2]).toBe('wall');
    expect(result.map.terrain[2][5]).toBe('wall');
  });

  it('clamps the player start inside and reports the move', () => {
    const map = bordered(10, 10);
    map.playerStart = { x: 8, y: 8, dir: 'E' };
    const result = resizeMap(map, 6, 6, BOUNDS);
    expect(result.map.playerStart).toEqual({ x: 4, y: 4, dir: 'E' });
    expect(result.report.playerStartMoved).toBe(true);
    expect(result.map.terrain[4][4]).toBe('floor');
  });

  it('clamps the requested size to the bounds', () => {
    const map = bordered(8, 8);
    const small = resizeMap(map, 1, 2, BOUNDS);
    expect([small.width, small.height]).toEqual([5, 5]);
    const large = resizeMap(map, 99, 99, BOUNDS);
    expect([large.width, large.height]).toEqual([12, 12]);
  });

  it('reports no change for the same size', () => {
    const map = bordered(8, 8);
    const result = resizeMap(map, 8, 8, BOUNDS);
    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
  });

  it('does not wall a map that had no border', () => {
    const map = bordered(7, 7);
    map.terrain[0][3] = 'floor';
    const result = resizeMap(map, 9, 9, BOUNDS);
    expect(result.report.borderKept).toBe(false);
    expect(result.map.terrain[8][8]).toBe('floor');
    expect(result.map.terrain[6][6]).toBe('wall');
  });

  it('keeps a full border when the start sat on what becomes the ring', () => {
    const map = bordered(10, 10);
    map.playerStart = { x: 5, y: 5, dir: 'S' };
    const result = resizeMap(map, 6, 10, BOUNDS);
    expect(result.report.borderKept).toBe(true);
    expect(result.map.playerStart).toEqual({ x: 4, y: 5, dir: 'S' });
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 6; x++) {
        const edge = x === 0 || y === 0 || x === 5 || y === 9;
        if (edge) expect(result.map.terrain[y][x]).toBe('wall');
      }
    }
  });

  it('keeps the start inside a map of width 1 or 2', () => {
    const tiny = { minSize: 1, maxSize: 12 };
    const map = bordered(6, 6);
    map.playerStart = { x: 4, y: 4, dir: 'N' };
    const one = resizeMap(map, 1, 6, tiny);
    expect(one.map.playerStart.x).toBe(0);
    const two = resizeMap(map, 2, 2, tiny);
    expect(two.map.playerStart).toEqual({ x: 1, y: 1, dir: 'N' });
    expect(two.map.terrain[1][1]).toBe('floor');
  });

  it('drops an entity on an old border that opens up, and reports it', () => {
    const map = bordered(6, 6);
    map.entities.push({ x: 5, y: 2, type: 'tank', dir: 'N' }, { x: 2, y: 2, type: 'tank', dir: 'N' });
    const result = resizeMap(map, 9, 6, BOUNDS);
    expect(result.map.terrain[2][5]).toBe('floor');
    expect(result.map.entities).toEqual([{ x: 2, y: 2, type: 'tank', dir: 'N' }]);
    expect(result.report.droppedEntities).toBe(1);
  });

  it('never modifies its input', () => {
    const map = withLinks();
    const snapshot = JSON.stringify(map);
    resizeMap(map, 5, 5, BOUNDS);
    expect(JSON.stringify(map)).toBe(snapshot);
  });
});

describe('resizeMap with an anchor', () => {
  const CENTRE: ResizeAnchor = { col: 1, row: 1 };
  const RIGHT: ResizeAnchor = { col: 2, row: 1 };
  const BOTTOM_RIGHT: ResizeAnchor = { col: 2, row: 2 };
  const BOTTOM_LEFT: ResizeAnchor = { col: 0, row: 2 };

  it('opens both side borders when a bordered map grows around its centre, and walls the new ring', () => {
    const result = resizeMap(bordered(7, 7), 9, 7, BOUNDS, CENTRE);
    expect(result.map.terrain[3]).toEqual(['wall', 'floor', 'floor', 'floor', 'floor', 'floor', 'floor', 'floor', 'wall']);
    expect(result.map.terrain[0].every((tile) => tile === 'wall')).toBe(true);
    expect(result.map.terrain[6].every((tile) => tile === 'wall')).toBe(true);
    expect(result.map.playerStart).toMatchObject({ x: 2, y: 1 });
    expect(result.report.playerStartMoved).toBe(false);
  });

  it.each([
    [9, 9, 1, 1],
    [9, 7, 1, 1],
    [7, 9, 0, 1]
  ])('top-left growth to %ix%i drops a thin wall (%i) and an entity (%i) on the old right/bottom ring that ends on the new ring', (w, h, edgesDropped, entitiesDropped) => {
    const map = bordered(7, 7);
    map.cellEdges = [{ x: 6, y: 0, sides: ['N'] }];
    map.entities.push({ x: 6, y: 6, type: 'tank', dir: 'N' });
    const result = resizeMap(map, w, h, BOUNDS);
    expect(result.report.droppedEdges).toBe(edgesDropped);
    expect(result.report.droppedEntities).toBe(entitiesDropped);
    expect(result.map.entities).toEqual([]);
  });

  it('centre growth to 9x9 opens the old ring and drops the entity that stood on it, keeping the thin wall on its floor cell', () => {
    const map = bordered(7, 7);
    map.cellEdges = [{ x: 6, y: 0, sides: ['N'] }];
    map.entities.push({ x: 6, y: 6, type: 'tank', dir: 'N' });
    const result = resizeMap(map, 9, 9, BOUNDS, CENTRE);
    expect(result.report.droppedEntities).toBe(1);
    expect(result.map.entities).toEqual([]);
    expect(result.map.terrain[7][7]).toBe('floor');
    expect(result.report.droppedEdges).toBe(0);
    expect(result.map.cellEdges).toEqual([{ x: 7, y: 1, sides: ['N'] }]);
  });

  it('rounds an odd growth toward zero, leaving the extra column on the end side', () => {
    const map = bordered(7, 7);
    map.entities.push({ x: 3, y: 3, type: 'tank', dir: 'N' });
    const result = resizeMap(map, 10, 7, BOUNDS, CENTRE);
    expect(result.map.entities[0]).toMatchObject({ x: 4, y: 3 });
    expect(result.map.playerStart.x).toBe(2);
  });

  it('crops the left side on a right-anchored shrink and translates what stays', () => {
    const map = bordered(10, 7);
    map.entities.push({ x: 2, y: 3, type: 'tank', dir: 'N' }, { x: 5, y: 3, type: 'tank', dir: 'N' });
    map.terrain[3][6] = 'exit';
    const result = resizeMap(map, 7, 7, BOUNDS, RIGHT);
    expect(result.map.terrain[3][3]).toBe('exit');
    expect(result.map.terrain[3][0]).toBe('wall');
    expect(result.map.terrain[3][6]).toBe('wall');
    expect(result.map.entities).toEqual([{ x: 2, y: 3, type: 'tank', dir: 'N' }]);
    expect(result.report.droppedEntities).toBe(1);
  });

  it('translates both ends of the links and drops those that land on the new ring', () => {
    const grown = resizeMap(withLinks(), 10, 8, BOUNDS, RIGHT);
    expect(grown.map.trapLinks).toEqual([{ buttonX: 4, buttonY: 2, trapX: 6, trapY: 2 }]);
    expect(grown.map.cloneLinks[0]).toMatchObject({ buttonX: 4, buttonY: 4, clonerX: 6, clonerY: 4 });
    expect(grown.map.terrain[2][4]).toBe('button_brown');
    const shrunk = resizeMap(withLinks(), 6, 8, BOUNDS, RIGHT);
    expect(shrunk.map.trapLinks).toEqual([]);
    expect(shrunk.map.cloneLinks).toEqual([]);
    expect(shrunk.report.droppedTrapLinks).toBe(1);
    expect(shrunk.report.droppedCloneLinks).toBe(1);
    const centred = resizeMap(withLinks(), 6, 8, BOUNDS, CENTRE);
    expect(centred.map.trapLinks).toEqual([{ buttonX: 1, buttonY: 2, trapX: 3, trapY: 2 }]);
  });

  it('translates then clamps the player start, reporting a start that had to move', () => {
    const result = resizeMap(bordered(8, 8), 5, 5, BOUNDS, BOTTOM_RIGHT);
    expect(result.map.playerStart).toMatchObject({ x: 1, y: 1 });
    expect(result.report.playerStartMoved).toBe(true);
    const inner = bordered(8, 8);
    inner.playerStart = { x: 3, y: 3, dir: 'S' };
    const kept = resizeMap(inner, 6, 6, BOUNDS, CENTRE);
    expect(kept.map.playerStart).toMatchObject({ x: 2, y: 2 });
    expect(kept.report.playerStartMoved).toBe(false);
    const pushed = resizeMap(bordered(8, 8), 6, 6, BOUNDS, CENTRE);
    expect(pushed.map.playerStart).toMatchObject({ x: 1, y: 1 });
    expect(pushed.report.playerStartMoved).toBe(true);
  });

  it('keeps a wall that holds an item when the old border becomes interior', () => {
    const map = bordered(7, 7);
    map.items[3][6] = 'key_red';
    const result = resizeMap(map, 9, 7, BOUNDS, CENTRE);
    expect(result.map.terrain[3][7]).toBe('wall');
    expect(result.map.items[3][7]).toBe('key_red');
    expect(result.map.terrain[2][7]).toBe('floor');
  });

  it('drops an entity standing on an old border cell that opens', () => {
    const map = bordered(7, 7);
    map.entities.push({ x: 6, y: 3, type: 'tank', dir: 'N' });
    const result = resizeMap(map, 9, 7, BOUNDS, CENTRE);
    expect(result.map.entities).toEqual([]);
    expect(result.report.droppedEntities).toBe(1);
  });

  it('opens only the old border facing the grown axis for a one-axis, corner-anchored growth', () => {
    const result = resizeMap(bordered(7, 7), 7, 9, BOUNDS, BOTTOM_LEFT);
    expect(result.map.terrain[2][3]).toBe('floor');
    expect(result.map.terrain[2][0]).toBe('wall');
    expect(result.map.terrain[2][6]).toBe('wall');
    expect(result.map.terrain[0][3]).toBe('wall');
    expect(result.map.terrain[8][3]).toBe('wall');
    expect(result.map.playerStart).toMatchObject({ x: 1, y: 3 });
  });

  it('returns the same map for the same size whatever the anchor', () => {
    const map = bordered(7, 7);
    for (const anchor of [CENTRE, RIGHT, BOTTOM_RIGHT, BOTTOM_LEFT]) {
      const result = resizeMap(map, 7, 7, BOUNDS, anchor);
      expect(result.changed).toBe(false);
      expect(result.map).toBe(map);
    }
  });

  it('moves thin walls and hidden terrain with their cell around a centre and a right anchor', () => {
    const map = bordered(7, 7);
    map.terrain[3][3] = 'door_red';
    map.cellEdges = [{ x: 3, y: 3, sides: ['E'] }];
    map.underlays = [{ x: 3, y: 3, terrain: 'ice' }];
    const centred = resizeMap(map, 9, 7, BOUNDS, CENTRE);
    expect(centred.map.terrain[3][4]).toBe('door_red');
    expect(centred.map.cellEdges).toEqual([{ x: 4, y: 3, sides: ['E'] }]);
    expect(centred.map.underlays).toEqual([{ x: 4, y: 3, terrain: 'ice' }]);
    const right = resizeMap(map, 9, 7, BOUNDS, RIGHT);
    expect(right.map.cellEdges).toEqual([{ x: 5, y: 3, sides: ['E'] }]);
    expect(right.map.underlays).toEqual([{ x: 5, y: 3, terrain: 'ice' }]);
    expect(right.report.droppedEdges).toBe(0);
    expect(right.report.droppedUnderlays).toBe(0);
  });

  it('drops and counts thin walls and hidden terrain that land outside the new bounds', () => {
    const map = bordered(10, 7);
    map.terrain[3][2] = 'door_red';
    map.terrain[3][5] = 'door_red';
    map.cellEdges = [{ x: 2, y: 3, sides: ['E'] }, { x: 5, y: 3, sides: ['N'] }];
    map.underlays = [{ x: 2, y: 3, terrain: 'ice' }, { x: 5, y: 3, terrain: 'ice' }];
    const result = resizeMap(map, 7, 7, BOUNDS, RIGHT);
    expect(result.map.cellEdges).toEqual([{ x: 2, y: 3, sides: ['N'] }]);
    expect(result.map.underlays).toEqual([{ x: 2, y: 3, terrain: 'ice' }]);
    expect(result.report.droppedEdges).toBe(1);
    expect(result.report.droppedUnderlays).toBe(1);
  });
});

describe('toggleCellEdge', () => {
  const edgesOf = (map: EditorMap): unknown => map.cellEdges;

  it('adds a side to the cell, then removes it, leaving the field absent', () => {
    const map = bordered(8, 8);
    const added = toggleCellEdge(map, 3, 3, 'E');
    expect(added.changed).toBe(true);
    expect(edgesOf(added.map)).toEqual([{ x: 3, y: 3, sides: ['E'] }]);
    const removed = toggleCellEdge(added.map, 3, 3, 'E');
    expect(removed.changed).toBe(true);
    expect(removed.map.cellEdges).toBeUndefined();
  });

  it('keeps the walls in canonical order, merged per cell', () => {
    let map = bordered(8, 8);
    map = toggleCellEdge(map, 4, 4, 'W').map;
    map = toggleCellEdge(map, 2, 2, 'S').map;
    map = toggleCellEdge(map, 4, 4, 'N').map;
    expect(edgesOf(map)).toEqual([
      { x: 2, y: 2, sides: ['S'] },
      { x: 4, y: 4, sides: ['N', 'W'] }
    ]);
  });

  it('treats the line between two cells as one wall: closed by the neighbour, it is removed from both', () => {
    const map = bordered(8, 8);
    map.cellEdges = [
      { x: 3, y: 3, sides: ['E'] },
      { x: 4, y: 3, sides: ['W', 'S'] }
    ];
    const result = toggleCellEdge(map, 4, 3, 'W');
    expect(edgesOf(result.map)).toEqual([{ x: 4, y: 3, sides: ['S'] }]);
    // A wall stored on the neighbour alone also counts as closed from the other cell.
    const only = bordered(8, 8);
    only.cellEdges = [{ x: 3, y: 3, sides: ['E'] }];
    expect(toggleCellEdge(only, 4, 3, 'W').map.cellEdges).toBeUndefined();
  });

  it('adds an open line to the own cell only', () => {
    const result = toggleCellEdge(bordered(8, 8), 3, 3, 'S');
    expect(edgesOf(result.map)).toEqual([{ x: 3, y: 3, sides: ['S'] }]);
  });

  it('lets a border side belong to its own cell', () => {
    const map = toggleCellEdge(bordered(8, 8), 0, 0, 'N').map;
    expect(edgesOf(map)).toEqual([{ x: 0, y: 0, sides: ['N'] }]);
    expect(toggleCellEdge(map, 0, 0, 'N').map.cellEdges).toBeUndefined();
  });

  it('leaves thin_wall terrain untouched', () => {
    const map = bordered(8, 8);
    map.terrain[3][3] = 'thin_wall_n';
    const result = toggleCellEdge(map, 3, 3, 'N');
    expect(result.map.terrain[3][3]).toBe('thin_wall_n');
    expect(edgesOf(result.map)).toEqual([{ x: 3, y: 3, sides: ['N'] }]);
  });

  it('changes nothing outside the grid or on a CC3D map', () => {
    const map = bordered(8, 8);
    for (const [x, y] of [[-1, 0], [0, -1], [8, 0], [0, 8], [1.5, 1]]) {
      const result = toggleCellEdge(map, x, y, 'N');
      expect(result.changed).toBe(false);
      expect(result.map).toBe(map);
    }
    const cc3d = { ...map, cc3d: emptyCc3dRoom(5, 5) };
    const result = toggleCellEdge(cc3d, 2, 2, 'N');
    expect(result.changed).toBe(false);
    expect(result.map).toBe(cc3d);
  });

  it('does not modify its input', () => {
    const map = bordered(8, 8);
    map.cellEdges = [{ x: 3, y: 3, sides: ['E'] }];
    const snapshot = JSON.stringify(map);
    toggleCellEdge(map, 3, 3, 'E');
    toggleCellEdge(map, 4, 3, 'W');
    toggleCellEdge(map, 2, 2, 'N');
    expect(JSON.stringify(map)).toBe(snapshot);
  });
});

describe('clone templates', () => {
  /** A clone machine at (4, 4) holding a walker facing east, wired to a red button at (2, 4). */
  function withWalkerCloner(): EditorMap {
    const map = withLinks();
    map.entities = [{ x: 4, y: 4, type: 'walker', dir: 'E' }];
    map.cloneLinks = [{ buttonX: 2, buttonY: 4, clonerX: 4, clonerY: 4, templateType: 'walker', templateDir: 'E' }];
    return map;
  }

  it('follows a quarter turn of the creature on the clone machine', () => {
    const map = withWalkerCloner();
    const turned = paintEntity(map, 4, 4, 'walker', 'S');
    expect(turned.map.cloneLinks[0]).toMatchObject({ templateType: 'walker', templateDir: 'S' });
    expect(turned.clonerTemplates).toEqual([{ x: 4, y: 4, type: 'walker', dir: 'S' }]);
    expect(map.cloneLinks[0].templateDir).toBe('E');
  });

  it('follows a different creature painted over it, and a stale template of a stored level', () => {
    const map = withWalkerCloner();
    map.cloneLinks[0] = { ...map.cloneLinks[0], templateType: 'dirt_block', templateDir: 'N' };
    const repainted = paintEntity(map, 4, 4, 'turret_fixed', 'W');
    expect(repainted.map.cloneLinks[0]).toMatchObject({ templateType: 'turret_fixed', templateDir: 'W' });
  });

  it('reports nothing when the cell is not a linked clone machine, or the template already matches', () => {
    const map = withWalkerCloner();
    expect(paintEntity(map, 5, 5, 'walker', 'N').clonerTemplates).toBeUndefined();
    const stale = withWalkerCloner();
    stale.entities = [];
    expect(paintEntity(stale, 4, 4, 'walker', 'E').clonerTemplates).toBeUndefined();
  });

  it('repainting the same creature and facing re-syncs a drifted template and reports it, else stays a no-op', () => {
    const drifted = withWalkerCloner();
    drifted.cloneLinks[0] = { ...drifted.cloneLinks[0], templateType: 'dirt_block', templateDir: 'N' };
    const synced = paintEntity(drifted, 4, 4, 'walker', 'E');
    expect(synced.changed).toBe(true);
    expect(synced.map.cloneLinks[0]).toMatchObject({ templateType: 'walker', templateDir: 'E' });
    expect(synced.clonerTemplates).toEqual([{ x: 4, y: 4, type: 'walker', dir: 'E' }]);
    expect(drifted.cloneLinks[0].templateType).toBe('dirt_block');
    const aligned = withWalkerCloner();
    const same = paintEntity(aligned, 4, 4, 'walker', 'E');
    expect(same.changed).toBe(false);
    expect(same.map).toBe(aligned);
  });

  it('leaves no link behind when the clone machine is erased or repainted', () => {
    const map = withWalkerCloner();
    expect(eraseCell(map, 4, 4).map.cloneLinks).toEqual([]);
    expect(paintTerrain(map, 4, 4, 'floor').map.cloneLinks).toEqual([]);
  });

  it('warns when a clone wire ends on an empty clone machine, and not when a creature stands there', () => {
    const empty = withLinks();
    empty.cloneLinks = [];
    const warned = placeWireLink(empty, 'clone', { x: 2, y: 4 }, { x: 4, y: 4 }, 'W');
    expect(warned.emptyCloner).toBe(true);
    expect(warned.map.cloneLinks[0]).toMatchObject({ templateType: 'dirt_block', templateDir: 'W' });
    const occupied = withWalkerCloner();
    occupied.cloneLinks = [];
    expect(placeWireLink(occupied, 'clone', { x: 2, y: 4 }, { x: 4, y: 4 }, 'W').emptyCloner).toBeUndefined();
    expect(placeWireLink(withLinks(), 'trap', { x: 2, y: 2 }, { x: 4, y: 2 }, 'W').emptyCloner).toBeUndefined();
  });
});

describe('launcher wire edits', () => {
  function wiredRoom(): EditorMap {
    const map = bordered(10, 8);
    map.terrain[2][2] = 'shot_trigger';
    map.terrain[2][6] = 'shot_launcher_w';
    map.terrain[4][6] = 'shot_launcher_n';
    return map;
  }
  const FROM = { x: 2, y: 2 };

  it('names the button tile of each wire, the shot trigger for the launcher wire', () => {
    expect(wireButtonTile('trap')).toBe('button_brown');
    expect(wireButtonTile('clone')).toBe('button_red');
    expect(wireButtonTile('launcher')).toBe('shot_trigger');
  });

  it('places a shot trigger on the first click', () => {
    const map = bordered(8, 8);
    const placed = startLauncherWire(map, 3, 3);
    expect(placed.changed).toBe(true);
    expect(placed.map.terrain[3][3]).toBe('shot_trigger');
    expect(map.terrain[3][3]).toBe('floor');
    expect(startLauncherWire(placed.map, 3, 3).changed).toBe(false);
  });

  it('links a launcher that stands on the map, keeping its tile and facing', () => {
    const map = wiredRoom();
    const linked = toggleLauncherLink(map, FROM, { x: 6, y: 2 }, 'S');
    expect(linked.refused).toBe(false);
    expect(linked.action).toBe('linked');
    expect(linked.count).toBe(1);
    expect(linked.map.terrain[2][6]).toBe('shot_launcher_w');
    expect(linked.map.launcherLinks).toEqual([{ buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 2 }]);
    expect(map.launcherLinks).toBeUndefined();
  });

  it('paints a launcher facing the given direction on any other cell and links it', () => {
    for (const [dir, tile] of [['N', 'shot_launcher_n'], ['E', 'shot_launcher_e'], ['S', 'shot_launcher_s'], ['W', 'shot_launcher_w']] as const) {
      const linked = toggleLauncherLink(wiredRoom(), FROM, { x: 4, y: 5 }, dir);
      expect(linked.map.terrain[5][4]).toBe(tile);
      expect(linked.map.launcherLinks).toEqual([{ buttonX: 2, buttonY: 2, launcherX: 4, launcherY: 5 }]);
    }
  });

  it('unlinks a launcher already linked to the trigger and leaves its tile', () => {
    const map = wiredRoom();
    map.launcherLinks = [
      { buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 2 },
      { buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 4 }
    ];
    const unlinked = toggleLauncherLink(map, FROM, { x: 6, y: 2 }, 'S');
    expect(unlinked.action).toBe('unlinked');
    expect(unlinked.count).toBe(1);
    expect(unlinked.map.launcherLinks).toEqual([{ buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 4 }]);
    expect(unlinked.map.terrain[2][6]).toBe('shot_launcher_w');
    expect(map.launcherLinks).toHaveLength(2);
    const none = toggleLauncherLink(unlinked.map, FROM, { x: 6, y: 4 }, 'S');
    expect(none.map.launcherLinks).toBeUndefined();
    expect('launcherLinks' in none.map).toBe(false);
  });

  it('keeps one trigger firing several launchers and one launcher fired by several triggers, in canonical order', () => {
    const map = wiredRoom();
    map.terrain[5][2] = 'shot_trigger';
    const first = toggleLauncherLink(map, { x: 2, y: 5 }, { x: 6, y: 2 }, 'S');
    const second = toggleLauncherLink(first.map, FROM, { x: 6, y: 4 }, 'S');
    const third = toggleLauncherLink(second.map, FROM, { x: 6, y: 2 }, 'S');
    expect(third.map.launcherLinks).toEqual([
      { buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 2 },
      { buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 4 },
      { buttonX: 2, buttonY: 5, launcherX: 6, launcherY: 2 }
    ]);
  });

  it('refuses the trigger itself and a trigger that is gone, changing nothing', () => {
    const map = wiredRoom();
    const same = toggleLauncherLink(map, FROM, FROM, 'S');
    expect(same).toMatchObject({ refused: true, refusal: 'same_cell', changed: false });
    expect(same.map).toBe(map);
    map.terrain[2][2] = 'floor';
    const gone = toggleLauncherLink(map, FROM, { x: 6, y: 2 }, 'S');
    expect(gone).toMatchObject({ refused: true, refusal: 'missing_button', changed: false });
    expect(gone.map).toBe(map);
  });

  it('leaves the map alone outside the grid and on a CC3D map', () => {
    const map = wiredRoom();
    expect(toggleLauncherLink(map, FROM, { x: 40, y: 2 }, 'S').changed).toBe(false);
    const cc3d: EditorMap = { ...map, cc3d: emptyCc3dRoom(6, 6) };
    expect(toggleLauncherLink(cc3d, FROM, { x: 6, y: 2 }, 'S').changed).toBe(false);
  });

  it('works with a trigger and a launcher hidden under a door, and paints a launcher over other terrain', () => {
    const map = bordered(10, 8);
    map.terrain[2][2] = 'door_red';
    map.terrain[2][6] = 'door_red';
    map.underlays = [
      { x: 2, y: 2, terrain: 'shot_trigger' },
      { x: 6, y: 2, terrain: 'shot_launcher_w' }
    ];
    const linked = toggleLauncherLink(map, FROM, { x: 6, y: 2 }, 'S');
    expect(linked.map.terrain[2][6]).toBe('door_red');
    expect(linked.map.launcherLinks).toEqual([{ buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 2 }]);
    const onTrigger = bordered(10, 8);
    onTrigger.terrain[2][2] = 'shot_trigger';
    onTrigger.terrain[5][5] = 'ice';
    const iced = toggleLauncherLink(onTrigger, FROM, { x: 5, y: 5 }, 'N');
    expect(iced.map.terrain[5][5]).toBe('shot_launcher_n');
  });

  it('keeps the launcher links of a launcher repainted with another facing and of a trigger repainted as a trigger', () => {
    const map = wiredRoom();
    map.launcherLinks = [{ buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 2 }];
    expect(keepsLauncherLinks('shot_launcher_w', 'shot_launcher_n')).toBe(true);
    expect(keepsLauncherLinks('shot_trigger', 'shot_trigger')).toBe(true);
    expect(keepsLauncherLinks('shot_launcher_w', 'shot_trigger')).toBe(false);
    expect(keepsLauncherLinks('shot_launcher_w', 'floor')).toBe(false);
    expect(keepsLauncherLinks('floor', 'shot_launcher_w')).toBe(false);
    const turned = paintTerrain(map, 6, 2, 'shot_launcher_e');
    expect(turned.map.terrain[2][6]).toBe('shot_launcher_e');
    expect(turned.map.launcherLinks).toEqual(map.launcherLinks);
    expect(turned.removedLinks).toBe(0);
    const filled = floodFillTerrain(map, 6, 2, 'shot_launcher_s');
    expect(filled.map.terrain[2][6]).toBe('shot_launcher_s');
    expect(filled.map.launcherLinks).toEqual(map.launcherLinks);
  });

  it('drops the launcher links of a launcher or trigger painted over by something else, and counts them', () => {
    const map = wiredRoom();
    map.launcherLinks = [{ buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 2 }];
    const wall = paintTerrain(map, 6, 2, 'wall');
    expect(wall.map.launcherLinks).toBeUndefined();
    expect(wall.removedLinks).toBe(1);
    const swapped = paintTerrain(map, 2, 2, 'shot_launcher_n');
    expect(swapped.map.launcherLinks).toBeUndefined();
    expect(swapped.removedLinks).toBe(1);
  });

  it('keeps the launcher links of a device that stays hidden under a removable top, and drops them once it is gone', () => {
    const map = bordered(10, 8);
    map.terrain[2][2] = 'door_red';
    map.terrain[2][6] = 'door_red';
    map.underlays = [
      { x: 2, y: 2, terrain: 'shot_trigger' },
      { x: 6, y: 2, terrain: 'shot_launcher_w' }
    ];
    map.launcherLinks = [{ buttonX: 2, buttonY: 2, launcherX: 6, launcherY: 2 }];
    const painted = paintTerrain(map, 2, 2, 'door_blue');
    expect(painted.map.underlays).toHaveLength(2);
    expect(painted.map.launcherLinks).toEqual(map.launcherLinks);
    expect(painted.removedLinks).toBe(0);
    const filled = floodFillTerrain(map, 6, 2, 'door_blue');
    expect(filled.map.launcherLinks).toEqual(map.launcherLinks);
    expect(filled.removedLinks).toBe(0);
    const walled = paintTerrain(map, 6, 2, 'wall');
    expect(walled.map.underlays).toHaveLength(1);
    expect(walled.map.launcherLinks).toBeUndefined();
    expect(walled.removedLinks).toBe(1);
  });
});
