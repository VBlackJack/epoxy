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

import { LevelSizeBounds } from '../config/ConfigValidation';
import { FLOOR_TILE_ID, WALL_TILE_ID } from '../core/coreConstants';
import { Direction } from '../core/types';
import {
  EDITOR_CLONE_BUTTON_TILE,
  EDITOR_CLONER_TILE,
  EDITOR_DEFAULT_CLONE_TEMPLATE,
  EDITOR_TRAP_BUTTON_TILE,
  EDITOR_TRAP_TILE
} from '../ui/uiConstants';
import { edgesAt, removeEdgesWhere, replaceEdges, toggleSide } from './editorCellEdges';
import { cloneMap, EditorMap } from './editorDocument';
import { pruneUnderlays, removeUnderlaysWhere, replaceUnderlays, underlayAt } from './editorUnderlays';

/** Outcome of a map edit. The input map is never modified; `map` is a new state. */
export interface MapEditResult {
  map: EditorMap;
  /** False when the edit left the map as it was (out of the grid, same tile, refused). */
  changed: boolean;
  /** Trap and clone links removed because one of their cells was overwritten or erased. */
  removedLinks: number;
  /** Hidden terrain removed because the terrain on top of it changed to something that can no longer hide it, or its cell was erased. */
  removedUnderlays: number;
  /** True when the edit hit the player start cell and left the start in place (eraser). */
  playerStartKept: boolean;
}

/** Which kind of link a wire tool draws. */
export type WireKind = 'trap' | 'clone';

/** Outcome of closing a wire. */
export interface WireResult extends MapEditResult {
  /** True when the wire was refused; `refusal` says why. */
  refused: boolean;
  /** Why the wire was refused, when it was. */
  refusal?: WireRefusal;
}

/** 'same_cell': source and target are one cell. 'missing_button': the source no longer holds the wire's button. */
export type WireRefusal = 'same_cell' | 'missing_button';

/** What a resize dropped or moved, so the UI can say it. */
export interface ResizeReport {
  droppedEntities: number;
  droppedTrapLinks: number;
  droppedCloneLinks: number;
  /** Cells that lost their thin walls: cropped away, or turned to wall by the new border. */
  droppedEdges: number;
  /** Cells that lost their hidden terrain: cropped away, turned to wall by the new border, or no longer under a top that can hide it. */
  droppedUnderlays: number;
  /** True when the player start had to be moved to stay inside the new map. */
  playerStartMoved: boolean;
  /** True when the outer ring of the new map was set to wall. */
  borderKept: boolean;
}

export interface ResizeResult {
  map: EditorMap;
  /** Width and height actually applied, after clamping to the bounds. */
  width: number;
  height: number;
  /** False when the requested size equals the current one. */
  changed: boolean;
  report: ResizeReport;
}

/** Number of columns of a map. */
export function mapWidthOf(map: EditorMap): number {
  return map.terrain[0]?.length ?? 0;
}

/** Number of rows of a map. */
export function mapHeightOf(map: EditorMap): number {
  return map.terrain.length;
}

function inGrid(map: EditorMap, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < mapWidthOf(map) && y < mapHeightOf(map);
}

function unchanged(map: EditorMap): MapEditResult {
  return { map, changed: false, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/** Removes every link that has an end on the cell; returns how many were removed. */
export function dropLinksAt(map: EditorMap, x: number, y: number): number {
  const trapBefore = map.trapLinks.length;
  const cloneBefore = map.cloneLinks.length;
  map.trapLinks = map.trapLinks.filter(
    (l) => !(l.buttonX === x && l.buttonY === y) && !(l.trapX === x && l.trapY === y)
  );
  map.cloneLinks = map.cloneLinks.filter(
    (l) => !(l.buttonX === x && l.buttonY === y) && !(l.clonerX === x && l.clonerY === y)
  );
  return trapBefore - map.trapLinks.length + (cloneBefore - map.cloneLinks.length);
}

/**
 * Paints a terrain tile. Overwriting a cell that is the button or the target
 * of a trap or clone link with another tile removes those links, so none is
 * left dangling. Painting the tile already there keeps them. Hidden terrain under the cell stays only while the
 * new tile can still hide it; otherwise it is removed and counted.
 */
export function paintTerrain(source: EditorMap, x: number, y: number, tileId: string): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y) || source.terrain[y][x] === tileId) return unchanged(source);
  const map = cloneMap(source);
  map.terrain[y][x] = tileId;
  const removedLinks = dropLinksAt(map, x, y);
  const removedUnderlays = pruneUnderlays(map);
  return { map, changed: true, removedLinks, removedUnderlays, playerStartKept: false };
}

/** Paints an item (key, chip, boots...) on the item layer. */
export function paintItem(source: EditorMap, x: number, y: number, itemId: string): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y) || source.items[y][x] === itemId) return unchanged(source);
  const map = cloneMap(source);
  map.items[y][x] = itemId;
  return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/**
 * Toggles the thin wall on one side of a cell (Epoxy levels). The wall is one line shared by two cells: a
 * closed line (the cell's own wall, or the neighbour's matching one) is removed from both cells, an open one
 * is added to the cell only; a border side belongs to its cell. Terrain such as thin_wall_* is untouched.
 */
export function toggleCellEdge(source: EditorMap, x: number, y: number, side: Direction): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map keeps its thin walls in its own layers
  if (!inGrid(source, x, y)) return unchanged(source);
  const map = cloneMap(source);
  toggleSide(map, x, y, side);
  return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/** Places an entity, replacing the one already on the cell. */
export function paintEntity(source: EditorMap, x: number, y: number, type: string, dir: Direction): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y)) return unchanged(source);
  const present = source.entities.filter((e) => e.x === x && e.y === y);
  if (present.length === 1 && present[0].type === type && present[0].dir === dir) return unchanged(source);
  const map = cloneMap(source);
  map.entities = map.entities.filter((e) => !(e.x === x && e.y === y));
  map.entities.push({ x, y, type, dir });
  return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/** Moves the player start. */
export function paintPlayerStart(source: EditorMap, x: number, y: number, dir: Direction): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y)) return unchanged(source);
  const start = source.playerStart;
  if (start.x === x && start.y === y && start.dir === dir) return unchanged(source);
  const map = cloneMap(source);
  map.playerStart = { x, y, dir };
  return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/**
 * Erases a cell: floor terrain, no item, no entity, no link, no thin wall, no hidden terrain. The player start
 * is never erased; when it sits on the cell the result reports `playerStartKept`.
 */
export function eraseCell(source: EditorMap, x: number, y: number): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y)) return unchanged(source);
  const playerStartKept = source.playerStart.x === x && source.playerStart.y === y;
  const empty =
    source.terrain[y][x] === FLOOR_TILE_ID &&
    source.items[y][x] === null &&
    !source.entities.some((e) => e.x === x && e.y === y) &&
    edgesAt(source, x, y).length === 0 &&
    underlayAt(source, x, y) === undefined &&
    !source.trapLinks.some((l) => (l.buttonX === x && l.buttonY === y) || (l.trapX === x && l.trapY === y)) &&
    !source.cloneLinks.some((l) => (l.buttonX === x && l.buttonY === y) || (l.clonerX === x && l.clonerY === y));
  if (empty) return { ...unchanged(source), playerStartKept };
  const map = cloneMap(source);
  map.terrain[y][x] = FLOOR_TILE_ID;
  map.items[y][x] = null;
  map.entities = map.entities.filter((e) => !(e.x === x && e.y === y));
  removeEdgesWhere(map, (ex, ey) => ex === x && ey === y);
  const removedUnderlays = removeUnderlaysWhere(map, (ux, uy) => ux === x && uy === y);
  const removedLinks = dropLinksAt(map, x, y);
  return { map, changed: true, removedLinks, removedUnderlays, playerStartKept };
}

/**
 * Replaces the 4-connected region of identical terrain that contains the cell
 * with `tileId`. Links that end on a replaced cell are removed, and so is hidden terrain the new tile cannot hide.
 */
export function floodFillTerrain(source: EditorMap, x: number, y: number, tileId: string): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y)) return unchanged(source);
  const target = source.terrain[y][x];
  if (target === tileId) return unchanged(source);
  const map = cloneMap(source);
  const width = mapWidthOf(map);
  const height = mapHeightOf(map);
  const visited = new Set<number>();
  const queue: number[] = [y * width + x];
  let removedLinks = 0;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    if (visited.has(index)) continue;
    visited.add(index);
    const cx = index % width;
    const cy = Math.floor(index / width);
    if (map.terrain[cy][cx] !== target) continue;
    map.terrain[cy][cx] = tileId;
    removedLinks += dropLinksAt(map, cx, cy);
    if (cx + 1 < width) queue.push(index + 1);
    if (cx > 0) queue.push(index - 1);
    if (cy + 1 < height) queue.push(index + width);
    if (cy > 0) queue.push(index - width);
  }
  const removedUnderlays = pruneUnderlays(map);
  return { map, changed: true, removedLinks, removedUnderlays, playerStartKept: false };
}

/** Terrain placed at the button end and at the target end of a wire. */
function wireTiles(kind: WireKind): { button: string; target: string } {
  return kind === 'trap'
    ? { button: EDITOR_TRAP_BUTTON_TILE, target: EDITOR_TRAP_TILE }
    : { button: EDITOR_CLONE_BUTTON_TILE, target: EDITOR_CLONER_TILE };
}

/** First click of a wire tool: puts the button tile on the source cell. */
export function placeWireButton(source: EditorMap, kind: WireKind, x: number, y: number): MapEditResult {
  return paintTerrain(source, x, y, wireTiles(kind).button);
}

/**
 * Second click of a wire tool: puts the target tile on the target cell and
 * records the link. A wire whose source is its target is refused and changes
 * nothing, and so is a wire whose source no longer holds the button. A link already joining the same two cells is replaced, not doubled.
 * A clone link copies the entity standing on the cloner, else the default
 * template facing `fallbackDir`.
 */
export function placeWireLink(
  source: EditorMap,
  kind: WireKind,
  from: { x: number; y: number },
  to: { x: number; y: number },
  fallbackDir: Direction
): WireResult {
  if (source.cc3d) return { ...unchanged(source), refused: false }; // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, from.x, from.y) || !inGrid(source, to.x, to.y)) return { ...unchanged(source), refused: false };
  if (from.x === to.x && from.y === to.y) return { ...unchanged(source), refused: true, refusal: 'same_cell' };
  const tiles = wireTiles(kind);
  if (source.terrain[from.y][from.x] !== tiles.button) {
    return { ...unchanged(source), refused: true, refusal: 'missing_button' };
  }
  const painted = paintTerrain(source, to.x, to.y, tiles.target);
  const map = cloneMap(painted.map);
  if (kind === 'trap') {
    map.trapLinks = map.trapLinks.filter((l) => !(l.buttonX === from.x && l.buttonY === from.y && l.trapX === to.x && l.trapY === to.y));
    map.trapLinks.push({ buttonX: from.x, buttonY: from.y, trapX: to.x, trapY: to.y });
  } else {
    const onCloner = map.entities.find((e) => e.x === to.x && e.y === to.y);
    map.cloneLinks = map.cloneLinks.filter((l) => !(l.buttonX === from.x && l.buttonY === from.y && l.clonerX === to.x && l.clonerY === to.y));
    map.cloneLinks.push({
      buttonX: from.x,
      buttonY: from.y,
      clonerX: to.x,
      clonerY: to.y,
      templateType: onCloner?.type ?? EDITOR_DEFAULT_CLONE_TEMPLATE,
      templateDir: onCloner?.dir ?? fallbackDir
    });
  }
  // The map was copied from the painted one, which already pruned the hidden terrain of the target cell.
  return { map, changed: true, removedLinks: painted.removedLinks, removedUnderlays: painted.removedUnderlays, playerStartKept: false, refused: false };
}

function hasWallBorder(map: EditorMap): boolean {
  const width = mapWidthOf(map);
  const height = mapHeightOf(map);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (onBorder && map.terrain[y][x] !== WALL_TILE_ID) return false;
    }
  }
  return true;
}

/** Smallest side that still has an inside once ringed with walls. */
const MIN_BORDERED_SIZE = 3;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Resizes the map keeping the top-left corner. New cells are floor. When the
 * old map was closed by a wall border, the new one is too: an old border that
 * becomes interior turns to floor (an entity on it is dropped; a cell holding an item stays wall), and the new outer
 * ring is walled (items, entities and links on a cell that becomes wall are
 * dropped). Thin walls and hidden terrain stay with their cell: those outside the new bounds, on a cell that
 * becomes wall, or (hidden terrain) under a top that can no longer hide it are dropped and counted. Entities and links outside the new bounds are dropped; the player
 * start is clamped inside. The requested size is clamped to `bounds`.
 */
export function resizeMap(source: EditorMap, width: number, height: number, bounds: LevelSizeBounds): ResizeResult {
  if (source.cc3d) return { map: source, width: mapWidthOf(source), height: mapHeightOf(source), changed: false, report: { droppedEntities: 0, droppedTrapLinks: 0, droppedCloneLinks: 0, droppedEdges: 0, droppedUnderlays: 0, playerStartMoved: false, borderKept: false } }; // a CC3D map is edited through cc3dEdits only
  const oldWidth = mapWidthOf(source);
  const oldHeight = mapHeightOf(source);
  const newWidth = clamp(Math.floor(width), bounds.minSize, bounds.maxSize);
  const newHeight = clamp(Math.floor(height), bounds.minSize, bounds.maxSize);
  const report: ResizeReport = {
    droppedEntities: 0,
    droppedTrapLinks: 0,
    droppedCloneLinks: 0,
    droppedEdges: 0,
    droppedUnderlays: 0,
    playerStartMoved: false,
    borderKept: false
  };
  if (newWidth === oldWidth && newHeight === oldHeight) {
    return { map: source, width: newWidth, height: newHeight, changed: false, report };
  }

  const bordered = hasWallBorder(source);
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  // Old border cells turned to floor: an entity standing there is dropped.
  const opened = new Set<string>();
  for (let y = 0; y < newHeight; y++) {
    terrain.push([]);
    items.push([]);
    for (let x = 0; x < newWidth; x++) {
      const kept = x < oldWidth && y < oldHeight;
      let tile = kept ? source.terrain[y][x] : FLOOR_TILE_ID;
      const item = kept ? source.items[y][x] : null;
      const wasOldBorder = kept && (x === oldWidth - 1 || y === oldHeight - 1);
      const growsPastIt = (x === oldWidth - 1 && newWidth > oldWidth) || (y === oldHeight - 1 && newHeight > oldHeight);
      if (bordered && wasOldBorder && growsPastIt && tile === WALL_TILE_ID && item === null) {
        tile = FLOOR_TILE_ID;
        opened.add(`${x},${y}`);
      }
      terrain[y].push(tile);
      items[y].push(item);
    }
  }

  // With a wall border the start stays inside it, when the side is big enough to have an inside.
  const lowX = bordered && newWidth >= MIN_BORDERED_SIZE ? 1 : 0;
  const lowY = bordered && newHeight >= MIN_BORDERED_SIZE ? 1 : 0;
  const startX = clamp(source.playerStart.x, lowX, newWidth - 1 - lowX);
  const startY = clamp(source.playerStart.y, lowY, newHeight - 1 - lowY);
  report.playerStartMoved = startX !== source.playerStart.x || startY !== source.playerStart.y;

  // Cells that turn to wall to close the new map.
  const walled = new Set<string>();
  if (bordered) {
    report.borderKept = true;
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        const onBorder = x === 0 || y === 0 || x === newWidth - 1 || y === newHeight - 1;
        if (!onBorder || terrain[y][x] === WALL_TILE_ID) continue;
        if (x === startX && y === startY) continue;
        terrain[y][x] = WALL_TILE_ID;
        items[y][x] = null;
        walled.add(`${x},${y}`);
      }
    }
  }

  const alive = (x: number, y: number): boolean => x < newWidth && y < newHeight && !walled.has(`${x},${y}`);
  const entities = source.entities
    .filter((e) => alive(e.x, e.y) && !opened.has(`${e.x},${e.y}`))
    .map((e) => ({ ...e }));
  report.droppedEntities = source.entities.length - entities.length;
  const trapLinks = source.trapLinks
    .filter((l) => alive(l.buttonX, l.buttonY) && alive(l.trapX, l.trapY))
    .map((l) => ({ ...l }));
  report.droppedTrapLinks = source.trapLinks.length - trapLinks.length;
  const cloneLinks = source.cloneLinks
    .filter((l) => alive(l.buttonX, l.buttonY) && alive(l.clonerX, l.clonerY))
    .map((l) => ({ ...l }));
  report.droppedCloneLinks = source.cloneLinks.length - cloneLinks.length;

  const kept = (source.cellEdges ?? []).filter((e) => alive(e.x, e.y));
  report.droppedEdges = (source.cellEdges?.length ?? 0) - kept.length;

  const resized: EditorMap = { terrain, items, entities, trapLinks, cloneLinks, playerStart: { x: startX, y: startY, dir: source.playerStart.dir } };
  replaceEdges(resized, kept);
  // The hidden terrain stays with its cell, then only what the new terrain on top can still hide is kept.
  replaceUnderlays(resized, (source.underlays ?? []).filter((u) => alive(u.x, u.y)));
  report.droppedUnderlays = (source.underlays?.length ?? 0) - (resized.underlays?.length ?? 0);
  return {
    map: resized,
    width: newWidth,
    height: newHeight,
    changed: true,
    report
  };
}
