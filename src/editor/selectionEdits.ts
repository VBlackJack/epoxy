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

import { FLOOR_TILE_ID } from '../core/coreConstants';
import { CellEdge, CloneLink, Direction, TrapLink } from '../core/types';
import { canonicalEdges, removeEdgesWhere, replaceEdges } from './editorCellEdges';
import { cloneMap, EditorMap } from './editorDocument';
import { dropLinksAt, mapHeightOf, mapWidthOf } from './mapEdits';
import { EditableRuleset, entityAvailability, tileAvailability } from './paletteAvailability';

/** A rectangle of cells: its top-left cell and its size, both at least 1 once normalised. */
export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An entity of a clip, positioned relative to the clip's top-left cell. */
export interface ClipEntity {
  dx: number;
  dy: number;
  type: string;
  dir: Direction;
}

/** The thin walls of one cell of a clip, positioned relative to the clip's top-left cell. */
export interface ClipEdge {
  dx: number;
  dy: number;
  sides: Direction[];
}

/** The content of a rectangle of cells, detached from the map. Links are never part of it. */
export interface Clip {
  width: number;
  height: number;
  terrain: string[][];
  items: (string | null)[][];
  entities: ClipEntity[];
  /** Thin walls of the clipped cells; absent when none has any. A Lynx level has no such walls, so they are dropped there. */
  edges?: ClipEdge[];
  /** The player start, relative to the clip, when the clip carries it; null otherwise. */
  playerStart: { dx: number; dy: number; dir: Direction } | null;
}

/** Outcome of a selection edit. The input map is never modified. */
export interface SelectionEditResult {
  map: EditorMap;
  /** False when the edit left the map as it was. */
  changed: boolean;
  /** Links dropped because one end was cleared, overwritten, or left behind by a move. */
  droppedLinks: number;
  /** Palette entries of a clip skipped because the level's ruleset cannot play them. */
  skipped: number;
  /** Cells left alone because they sit on the outer ring of the map, which a paste or a move never writes. */
  borderSkipped: number;
  /** True when the edit hit the player start cell and left the start in place (clear). */
  playerStartKept: boolean;
  /** The cells the edit produced or targeted, clipped to the map; null when none are inside it. */
  rect: CellRect | null;
}

/** A step of a move, in cells. */
export interface MoveStep {
  dx: number;
  dy: number;
}

/** True for the cells of the outer ring: first and last row, first and last column. */
function onRing(map: EditorMap, x: number, y: number): boolean {
  return x === 0 || y === 0 || x === mapWidthOf(map) - 1 || y === mapHeightOf(map) - 1;
}

function inGrid(map: EditorMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < mapWidthOf(map) && y < mapHeightOf(map);
}

/** True when the cell lies inside the rectangle. */
export function rectContains(rect: CellRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/** The rectangle spanned by two cells in any order, clipped to a width by height grid. */
export function rectFromCells(
  a: { x: number; y: number },
  b: { x: number; y: number },
  gridWidth: number,
  gridHeight: number
): CellRect {
  const clamp = (value: number, size: number): number => Math.min(Math.max(0, size - 1), Math.max(0, value));
  const x0 = clamp(Math.min(a.x, b.x), gridWidth);
  const y0 = clamp(Math.min(a.y, b.y), gridHeight);
  const x1 = clamp(Math.max(a.x, b.x), gridWidth);
  const y1 = clamp(Math.max(a.y, b.y), gridHeight);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The rectangle shifted by a step. */
export function shiftRect(rect: CellRect, dx: number, dy: number): CellRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/** Reduces a step so the rectangle stays inside the grid. */
export function clampMoveStep(rect: CellRect, dx: number, dy: number, gridWidth: number, gridHeight: number): MoveStep {
  const clamp = (step: number, origin: number, size: number, grid: number): number =>
    Math.min(grid - (origin + size), Math.max(-origin, step));
  return { dx: clamp(dx, rect.x, rect.width, gridWidth), dy: clamp(dy, rect.y, rect.height, gridHeight) };
}

/** The part of a rectangle that lies inside the grid, or null when none does. */
export function clipRectToGrid(rect: CellRect, gridWidth: number, gridHeight: number): CellRect | null {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(gridWidth, rect.x + rect.width);
  const y1 = Math.min(gridHeight, rect.y + rect.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Whether two maps hold the same layers; the order of the entities does not matter. */
function sameMapLayers(a: EditorMap, b: EditorMap): boolean {
  const normalize = (map: EditorMap): string =>
    JSON.stringify({
      terrain: map.terrain,
      items: map.items,
      entities: [...map.entities].sort((l, m) => l.y - m.y || l.x - m.x || l.type.localeCompare(m.type)),
      trapLinks: map.trapLinks,
      cloneLinks: map.cloneLinks,
      playerStart: map.playerStart,
      cellEdges: canonicalEdges(map.cellEdges, map.terrain) ?? []
    });
  return normalize(a) === normalize(b);
}

/**
 * Copies the content of the cells of a rectangle inside the map. The player
 * start is unique: it goes into the clip only when `includePlayerStart` is set
 * (cut), and a copy leaves it out.
 */
export function extractClip(map: EditorMap, rect: CellRect, includePlayerStart: boolean): Clip {
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  for (let cy = 0; cy < rect.height; cy++) {
    terrain.push([]);
    items.push([]);
    for (let cx = 0; cx < rect.width; cx++) {
      terrain[cy].push(map.terrain[rect.y + cy][rect.x + cx]);
      items[cy].push(map.items[rect.y + cy][rect.x + cx]);
    }
  }
  const entities: ClipEntity[] = map.entities
    .filter((e) => rectContains(rect, e.x, e.y))
    .map((e) => ({ dx: e.x - rect.x, dy: e.y - rect.y, type: e.type, dir: e.dir }));
  const edges: ClipEdge[] = (map.cellEdges ?? [])
    .filter((e) => rectContains(rect, e.x, e.y))
    .map((e) => ({ dx: e.x - rect.x, dy: e.y - rect.y, sides: [...e.sides] }));
  const start = map.playerStart;
  const playerStart =
    includePlayerStart && rectContains(rect, start.x, start.y)
      ? { dx: start.x - rect.x, dy: start.y - rect.y, dir: start.dir }
      : null;
  return { width: rect.width, height: rect.height, terrain, items, entities, ...(edges.length > 0 ? { edges } : {}), playerStart };
}

function clearCells(map: EditorMap, rect: CellRect, keep: (x: number, y: number) => boolean = () => false): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (keep(x, y)) continue;
      map.terrain[y][x] = FLOOR_TILE_ID;
      map.items[y][x] = null;
    }
  }
  map.entities = map.entities.filter((e) => !rectContains(rect, e.x, e.y) || keep(e.x, e.y));
  removeEdgesWhere(map, (x, y) => rectContains(rect, x, y) && !keep(x, y));
}

/**
 * Clears the cells of a rectangle to floor, removes their thin walls and drops the links that end in
 * it. The player start stays where it is, and the result says so.
 */
export function clearRect(source: EditorMap, rect: CellRect): SelectionEditResult {
  if (source.cc3d) return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect: null }; // a CC3D map is edited through cc3dEdits only
  const map = cloneMap(source);
  clearCells(map, rect);
  let droppedLinks = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) droppedLinks += dropLinksAt(map, x, y);
  }
  const playerStartKept = rectContains(rect, source.playerStart.x, source.playerStart.y);
  return { map, changed: !sameMapLayers(source, map), droppedLinks, skipped: 0, borderSkipped: 0, playerStartKept, rect };
}

/**
 * Writes a clip onto the map with its top-left cell on (originX, originY).
 * Cells outside the map are clipped. Writing a cell drops the links ending
 * there, whatever the tile. With a ruleset, a cell whose terrain that ruleset
 * cannot play is left out whole (it keeps what it had, entity included) and
 * counted once; an item or entity it cannot play is left out alone and counted.
 * The outer ring of the map is never written: its cells are left out whole and
 * counted apart. A written cell takes the thin walls of the clip (none when the clip has none there);
 * under Lynx, which has no thin walls, the clip's are dropped and each counts as skipped. With `sourceOrigin` (a move), clip cells that came from the
 * ring are left out too, so the ring stays where it is.
 */
function stampClip(
  map: EditorMap,
  clip: Clip,
  originX: number,
  originY: number,
  ruleset: EditableRuleset | null,
  sourceOrigin: { x: number; y: number } | null = null
): { skipped: number; borderSkipped: number; droppedLinks: number } {
  let skipped = 0;
  let borderSkipped = 0;
  let droppedLinks = 0;
  const fromRing = (cx: number, cy: number): boolean =>
    sourceOrigin !== null && onRing(map, sourceOrigin.x + cx, sourceOrigin.y + cy);
  const ringCells = new Set<string>();
  const tileOk = (id: string): boolean => ruleset === null || tileAvailability(ruleset, id).available;
  const keepEntities = new Set<string>();
  const skippedCells = new Set<string>();
  const writtenCells = new Set<string>();
  for (let cy = 0; cy < clip.height; cy++) {
    for (let cx = 0; cx < clip.width; cx++) {
      const x = originX + cx;
      const y = originY + cy;
      if (!inGrid(map, x, y)) continue;
      if (onRing(map, x, y) || fromRing(cx, cy)) {
        ringCells.add(`${x},${y}`);
        keepEntities.add(`${x},${y}`);
      } else if (!tileOk(clip.terrain[cy][cx])) {
        skippedCells.add(`${x},${y}`);
        keepEntities.add(`${x},${y}`);
      }
    }
  }
  for (const e of clip.entities) {
    const x = originX + e.dx;
    const y = originY + e.dy;
    if (inGrid(map, x, y) && ruleset !== null && !entityAvailability(ruleset, e.type).available) keepEntities.add(`${x},${y}`);
  }
  for (let cy = 0; cy < clip.height; cy++) {
    for (let cx = 0; cx < clip.width; cx++) {
      const x = originX + cx;
      const y = originY + cy;
      if (!inGrid(map, x, y)) continue;
      if (ringCells.has(`${x},${y}`)) {
        borderSkipped++;
        continue;
      }
      if (skippedCells.has(`${x},${y}`)) {
        skipped++;
        continue;
      }
      map.terrain[y][x] = clip.terrain[cy][cx];
      writtenCells.add(`${x},${y}`);
      droppedLinks += dropLinksAt(map, x, y);
      const item = clip.items[cy][cx];
      if (item === null || tileOk(item)) map.items[y][x] = item;
      else skipped++;
    }
  }
  map.entities = map.entities.filter((e) => {
    const inside = e.x >= originX && e.y >= originY && e.x < originX + clip.width && e.y < originY + clip.height;
    return !inside || keepEntities.has(`${e.x},${e.y}`);
  });
  for (const e of clip.entities) {
    const x = originX + e.dx;
    const y = originY + e.dy;
    if (!inGrid(map, x, y)) continue;
    if (keepEntities.has(`${x},${y}`)) {
      if (!skippedCells.has(`${x},${y}`) && !ringCells.has(`${x},${y}`)) skipped++;
      continue;
    }
    map.entities.push({ x, y, type: e.type, dir: e.dir });
  }
  const keptEdges = (map.cellEdges ?? []).filter((e) => !writtenCells.has(`${e.x},${e.y}`));
  const pastedEdges: CellEdge[] = [];
  for (const e of clip.edges ?? []) {
    const x = originX + e.dx;
    const y = originY + e.dy;
    if (!writtenCells.has(`${x},${y}`)) continue;
    if (ruleset === 'lynx') skipped++;
    else pastedEdges.push({ x, y, sides: [...e.sides] });
  }
  if (keptEdges.length !== (map.cellEdges?.length ?? 0) || pastedEdges.length > 0) replaceEdges(map, [...keptEdges, ...pastedEdges]);
  if (clip.playerStart) {
    const x = originX + clip.playerStart.dx;
    const y = originY + clip.playerStart.dy;
    if (inGrid(map, x, y) && !ringCells.has(`${x},${y}`)) map.playerStart = { x, y, dir: clip.playerStart.dir };
  }
  return { skipped, borderSkipped, droppedLinks };
}

/**
 * Pastes a clip with its top-left cell on (originX, originY). Links are not
 * pasted. A clip that carries the player start moves the start; a copy never
 * does. The ruleset of the level decides which entries are skipped.
 */
export function pasteClip(
  source: EditorMap,
  clip: Clip,
  originX: number,
  originY: number,
  ruleset: EditableRuleset
): SelectionEditResult {
  if (source.cc3d) return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect: null }; // a CC3D map is edited through cc3dEdits only
  const rect = clipRectToGrid(
    { x: originX, y: originY, width: clip.width, height: clip.height },
    mapWidthOf(source),
    mapHeightOf(source)
  );
  if (!rect) return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect: null };
  const map = cloneMap(source);
  const { skipped, borderSkipped, droppedLinks } = stampClip(map, clip, originX, originY, ruleset);
  return { map, changed: !sameMapLayers(source, map), droppedLinks, skipped, borderSkipped, playerStartKept: false, rect };
}

/**
 * Moves the content of a rectangle by a step, leaving floor behind and
 * overwriting what is at the destination. A selection that would leave the
 * map does not move. Links with both ends in the rectangle move with it; links
 * with one end in it are dropped, and so are links ending on a cell the move
 * overwrites. The player start moves when it is inside the rectangle.
 */
export function moveRect(source: EditorMap, rect: CellRect, dx: number, dy: number): SelectionEditResult {
  if (source.cc3d) return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect: null }; // a CC3D map is edited through cc3dEdits only
  const destination = shiftRect(rect, dx, dy);
  const fits =
    destination.x >= 0 &&
    destination.y >= 0 &&
    destination.x + destination.width <= mapWidthOf(source) &&
    destination.y + destination.height <= mapHeightOf(source);
  if (!fits || (dx === 0 && dy === 0)) {
    return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect };
  }
  const clip = extractClip(source, rect, true);
  const map = cloneMap(source);

  // Source cells on the ring stay where they are and do not move.
  const inSource = (x: number, y: number): boolean => rectContains(rect, x, y) && !onRing(source, x, y);
  let droppedLinks = 0;
  const keptTrap: TrapLink[] = [];
  const movedTrap: TrapLink[] = [];
  for (const l of map.trapLinks) {
    const button = inSource(l.buttonX, l.buttonY);
    const target = inSource(l.trapX, l.trapY);
    if (button && target) {
      movedTrap.push({ buttonX: l.buttonX + dx, buttonY: l.buttonY + dy, trapX: l.trapX + dx, trapY: l.trapY + dy });
    } else if (button || target) {
      droppedLinks++;
    } else {
      keptTrap.push(l);
    }
  }
  const keptClone: CloneLink[] = [];
  const movedClone: CloneLink[] = [];
  for (const l of map.cloneLinks) {
    const button = inSource(l.buttonX, l.buttonY);
    const target = inSource(l.clonerX, l.clonerY);
    if (button && target) {
      movedClone.push({ ...l, buttonX: l.buttonX + dx, buttonY: l.buttonY + dy, clonerX: l.clonerX + dx, clonerY: l.clonerY + dy });
    } else if (button || target) {
      droppedLinks++;
    } else {
      keptClone.push(l);
    }
  }
  map.trapLinks = keptTrap;
  map.cloneLinks = keptClone;

  clearCells(map, rect, (x, y) => onRing(source, x, y));
  const stamped = stampClip(map, clip, destination.x, destination.y, null, { x: rect.x, y: rect.y });
  droppedLinks += stamped.droppedLinks;
  map.trapLinks.push(...movedTrap);
  map.cloneLinks.push(...movedClone);
  return {
    map,
    changed: !sameMapLayers(source, map),
    droppedLinks,
    skipped: 0,
    borderSkipped: stamped.borderSkipped,
    playerStartKept: false,
    rect: destination
  };
}
