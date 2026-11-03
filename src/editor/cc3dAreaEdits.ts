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

import type { LevelSizeBounds } from '../config/ConfigValidation';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { PLAYER_START_FACING } from '../core/cc3d/cc3dConstants';
import { type Cc3dCell, type Cc3dLevel, type Cc3dMob, type Cc3dMobKind, placeTerrain, type Cc3dTerrain } from '../core/cc3d/model';
import { OPPOSITE_DIRECTION } from '../core/coreConstants';
import type { Direction } from '../core/types';
import { canonicalJson } from './canonicalJson';
import { emptyCell, normalizeLayer } from './cc3dEdits';
import { type CellRect, clampMoveStep, clipRectToGrid, rectContains } from './selectionEdits';

/**
 * Pure, immutable area edits of a CC3D level: rectangle copy, cut, clear, paste and move, flood fill and
 * resize. Every function returns the very same level (by reference) when nothing changes or the request is
 * refused, shares every cell and mob it did not touch, and reports the counts the editor announces.
 */

/** Status keys the editor shows for these edits (the locale files are filled by the integration lot). */
export const MESSAGE_CC3D_AREA_MOBS_REMOVED = 'editor.cc3d.status.area_mobs_removed';
export const MESSAGE_CC3D_AREA_MOBS_SKIPPED = 'editor.cc3d.status.area_mobs_skipped';
export const MESSAGE_CC3D_AREA_PLAYER_KEPT = 'editor.cc3d.status.area_player_kept';
export const MESSAGE_CC3D_RESIZE_MOBS_DROPPED = 'editor.cc3d.status.resize_mobs_dropped';
export const MESSAGE_CC3D_RESIZE_PLAYER_MOVED = 'editor.cc3d.status.resize_player_moved';

/** A mob of a clip: its coordinates are relative to the clip's top-left cell. */
export type Cc3dClipMob = Cc3dMob;

/** The content of a rectangle of cells, detached from the level. */
export interface Cc3dClip {
  width: number;
  height: number;
  /** Row-major, width * height cells (shared with the level they came from: cells are immutable). */
  cells: Cc3dCell[];
  /** In level.mobs order, positioned relative to the clip, so deriveDisplayLayers(clip) draws a preview. */
  mobs: Cc3dClipMob[];
  /** The player start, relative to the clip, when the clip carries it (a cut); null otherwise. */
  player: { dx: number; dy: number; dir: Direction } | null;
}

/** Outcome of an area edit. `level` is the input level itself when `changed` is false. */
export interface Cc3dAreaResult {
  level: Cc3dLevel;
  changed: boolean;
  /** Mobs taken out of the level: cleared, overwritten by a paste or a move, or standing on a moved start. */
  removedMobs: number;
  /** Mobs that would have landed on a player start that stays: left out, and counted. */
  skippedMobs: number;
  /** True when the edit hit the player start cell and left the start in place (clear, paste, move). */
  playerKept: boolean;
  /** True when the player start moved (a paste of a clip that carries it, a move of its rectangle). */
  playerMoved: boolean;
  /** The cells the edit targeted or produced, clipped to the grid; null when none are inside it. */
  rect: CellRect | null;
}

/** Outcome of a flood fill. */
export interface Cc3dFillResult {
  level: Cc3dLevel;
  /** Cells of the region that were rewritten; 0 when the fill was refused or changed nothing. */
  filled: number;
}

/** Outcome of a resize. */
export interface Cc3dResizeResult {
  level: Cc3dLevel;
  changed: boolean;
  width: number;
  height: number;
  /** Mobs cut off by a smaller grid, plus a mob that stood where the start was clamped to. */
  droppedMobs: number;
  playerMoved: boolean;
}

const NO_ROOM = 0;

/** How the corpus files group the mobs: the `tiles` section, then `enemies`, then `blocks`. */
const SECTION_TILES = 0;
const SECTION_ENEMIES = 1;
const SECTION_BLOCKS = 2;
const TILES_SECTION_KINDS: readonly Cc3dMobKind[] = ['reflector', 'block_ice', 'block_color'];
const BLOCKS_SECTION_KINDS: readonly Cc3dMobKind[] = ['block_dirt'];

function sectionClass(kind: Cc3dMobKind): number {
  if (TILES_SECTION_KINDS.includes(kind)) return SECTION_TILES;
  if (BLOCKS_SECTION_KINDS.includes(kind)) return SECTION_BLOCKS;
  return SECTION_ENEMIES;
}

/**
 * The canonical position of a mob in level.mobs: mobs are grouped by section class (as the corpus files
 * group them: tiles-section kinds, then enemies-section kinds, then the dirt block) and read in reading
 * order (y * width + x) inside a group. A new mob is inserted after the last existing mob that sorts before
 * it, so a pasted mob lands where the level file would hold it instead of at the end.
 */
function mobSortKey(mob: Cc3dMob, width: number): [number, number] {
  return [sectionClass(mob.kind), mob.y * width + mob.x];
}

function sortsBefore(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
}

function sameCellContent(a: Cc3dCell, b: Cc3dCell): boolean {
  return a === b || canonicalJson(a) === canonicalJson(b);
}

function sameMob(a: Cc3dMob, b: Cc3dMob): boolean {
  return a === b || canonicalJson(a) === canonicalJson(b);
}

function facingOf(player: Cc3dLevel['player']): Direction {
  return player.dir ?? PLAYER_START_FACING;
}

function unchanged(level: Cc3dLevel, rect: CellRect | null = null): Cc3dAreaResult {
  return { level, changed: false, removedMobs: 0, skippedMobs: 0, playerKept: false, playerMoved: false, rect };
}

function sameMobList(a: readonly Cc3dMob[], b: readonly Cc3dMob[]): boolean {
  return a.length === b.length && a.every((mob, i) => mob === b[i]);
}

/** The level assembled from edited parts, or the original when the parts equal it. */
function assemble(
  level: Cc3dLevel,
  cells: Cc3dCell[],
  mobs: Cc3dMob[],
  player: Cc3dLevel['player'],
  touched: Iterable<number>
): Cc3dLevel {
  let cellsChanged = false;
  for (const index of touched) {
    if (cells[index] !== level.cells[index] && sameCellContent(cells[index], level.cells[index])) cells[index] = level.cells[index];
    else if (cells[index] !== level.cells[index]) cellsChanged = true;
  }
  const mobsChanged = !sameMobList(mobs, level.mobs);
  const playerChanged = player !== level.player;
  if (!cellsChanged && !mobsChanged && !playerChanged) return level;
  return {
    ...level,
    cells: cellsChanged ? cells : level.cells,
    mobs: mobsChanged ? mobs : level.mobs,
    player
  };
}

function* cellsOf(rect: CellRect, width: number): Generator<number> {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) yield y * width + x;
  }
}

/**
 * Copies the content of a rectangle (clipped to the grid). The player start is unique: it goes into the clip
 * only when `includePlayer` is set (a cut) and the start is inside the rectangle. A rectangle wholly outside
 * the grid gives an empty clip.
 */
export function extractCc3dClip(level: Cc3dLevel, rect: CellRect, includePlayer: boolean): Cc3dClip {
  const area = clipRectToGrid(rect, level.width, level.height);
  if (!area) return { width: NO_ROOM, height: NO_ROOM, cells: [], mobs: [], player: null };
  const cells: Cc3dCell[] = [];
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) cells.push(level.cells[y * level.width + x]);
  }
  const mobs = level.mobs.filter((mob) => rectContains(area, mob.x, mob.y)).map((mob) => ({ ...mob, x: mob.x - area.x, y: mob.y - area.y }));
  const { player } = level;
  const carried =
    includePlayer && rectContains(area, player.x, player.y)
      ? { dx: player.x - area.x, dy: player.y - area.y, dir: facingOf(player) }
      : null;
  return { width: area.width, height: area.height, cells, mobs, player: carried };
}

/**
 * Resets the cells of a rectangle to plain floor (thin walls and item included) and removes the mobs
 * standing in it; the other mobs keep their order. The player start stays where it is, and the result says so.
 */
export function clearCc3dRect(level: Cc3dLevel, rect: CellRect): Cc3dAreaResult {
  const area = clipRectToGrid(rect, level.width, level.height);
  if (!area) return unchanged(level);
  const cells = level.cells.slice();
  const touched = [...cellsOf(area, level.width)];
  for (const index of touched) cells[index] = emptyCell();
  const mobs = level.mobs.filter((mob) => !rectContains(area, mob.x, mob.y));
  const next = assemble(level, cells, mobs, level.player, touched);
  const playerKept = rectContains(area, level.player.x, level.player.y);
  if (next === level) return { ...unchanged(level, area), playerKept };
  return { ...unchanged(next, area), changed: true, removedMobs: level.mobs.length - mobs.length, playerKept };
}

/**
 * Inserts mobs at their canonical position (see mobSortKey), in canonical order among themselves, after the
 * last mob of `list` that sorts before each. Returns a new array.
 */
function insertCanonically(list: readonly Cc3dMob[], fresh: readonly Cc3dMob[], width: number): Cc3dMob[] {
  const out = list.slice();
  const ordered = fresh.slice().sort((a, b) => {
    const ka = mobSortKey(a, width);
    const kb = mobSortKey(b, width);
    return sortsBefore(ka, kb) ? -1 : sortsBefore(kb, ka) ? 1 : 0;
  });
  for (const mob of ordered) {
    const key = mobSortKey(mob, width);
    let at = 0;
    for (let i = out.length - 1; i >= 0; i--) {
      if (sortsBefore(mobSortKey(out[i], width), key)) {
        at = i + 1;
        break;
      }
    }
    out.splice(at, 0, mob);
  }
  return out;
}

/**
 * Writes a clip with its top-left cell on (ox, oy), clipped to the grid. Each written cell is replaced whole
 * (terrain, thin walls, item). A clip mob landing where a mob stands replaces it in place (the mob keeps its
 * index); a mob on a written cell that receives no clip mob is removed; a new clip mob is inserted at its
 * canonical position (see mobSortKey). A clip mob landing on a player start that stays is skipped and
 * counted; a clip that carries the player moves the start, and a mob standing on that target cell goes. A
 * paste of a copy back onto its own place changes nothing.
 */
export function pasteCc3dClip(level: Cc3dLevel, clip: Cc3dClip, ox: number, oy: number): Cc3dAreaResult {
  const area = clipRectToGrid({ x: ox, y: oy, width: clip.width, height: clip.height }, level.width, level.height);
  if (!area) return unchanged(level);
  const cells = level.cells.slice();
  const touched = [...cellsOf(area, level.width)];
  for (const index of touched) {
    const x = index % level.width;
    const y = Math.floor(index / level.width);
    cells[index] = clip.cells[(y - oy) * clip.width + (x - ox)];
  }

  let player = level.player;
  let playerMoved = false;
  if (clip.player) {
    const px = ox + clip.player.dx;
    const py = oy + clip.player.dy;
    if (rectContains(area, px, py) && (player.x !== px || player.y !== py || facingOf(player) !== clip.player.dir)) {
      player = { x: px, y: py, dir: clip.player.dir };
      playerMoved = true;
    }
  }
  const playerKept = !playerMoved && rectContains(area, level.player.x, level.player.y);

  // Clip mobs in absolute coordinates, one per cell; a mob on the player start or off the grid is left out.
  let skippedMobs = 0;
  const incoming = new Map<number, Cc3dMob>();
  for (const mob of clip.mobs) {
    const x = ox + mob.x;
    const y = oy + mob.y;
    if (!rectContains(area, x, y)) continue;
    const key = y * level.width + x;
    if ((x === player.x && y === player.y) || incoming.has(key)) {
      skippedMobs++;
      continue;
    }
    incoming.set(key, { ...mob, x, y });
  }

  let removedMobs = 0;
  const placed = new Set<number>();
  const kept: Cc3dMob[] = [];
  for (const mob of level.mobs) {
    const key = mob.y * level.width + mob.x;
    if (!rectContains(area, mob.x, mob.y)) {
      kept.push(mob);
      continue;
    }
    const replacement = incoming.get(key);
    if (!replacement) {
      removedMobs++;
      continue;
    }
    placed.add(key);
    kept.push(sameMob(mob, replacement) ? mob : replacement);
  }
  const fresh = [...incoming].filter(([key]) => !placed.has(key)).map(([, mob]) => mob);
  const mobs = fresh.length > 0 ? insertCanonically(kept, fresh, level.width) : kept;

  const next = assemble(level, cells, mobs, player, touched);
  if (next === level) return { ...unchanged(level, area), skippedMobs, playerKept };
  return { level: next, changed: true, removedMobs, skippedMobs, playerKept, playerMoved, rect: area };
}

/**
 * Moves the content of a rectangle by a step (clamped so the rectangle stays on the grid), leaving plain
 * floor behind and overwriting the destination. Moved mobs keep their index with their new position; mobs on
 * destination cells outside the source are removed; the player start moves along when it is inside the
 * rectangle. A moved mob that would land on a player start that stays is skipped (removed) and counted, the
 * same rule as a paste. `rect` of the result is the destination.
 */
export function moveCc3dRect(level: Cc3dLevel, rect: CellRect, dx: number, dy: number): Cc3dAreaResult {
  const source = clipRectToGrid(rect, level.width, level.height);
  if (!source) return unchanged(level);
  const step = clampMoveStep(source, dx, dy, level.width, level.height);
  if (step.dx === 0 && step.dy === 0) return unchanged(level, source);
  const destination: CellRect = { ...source, x: source.x + step.dx, y: source.y + step.dy };

  const cells = level.cells.slice();
  const sourceIndices = [...cellsOf(source, level.width)];
  for (const index of sourceIndices) cells[index] = emptyCell();
  const destinationIndices = [...cellsOf(destination, level.width)];
  for (const index of destinationIndices) {
    const x = index % level.width;
    const y = Math.floor(index / level.width);
    cells[index] = level.cells[(y - step.dy) * level.width + (x - step.dx)];
  }

  let player = level.player;
  const playerMoves = rectContains(source, player.x, player.y);
  if (playerMoves) player = { ...player, x: player.x + step.dx, y: player.y + step.dy };
  const playerKept = !playerMoves && rectContains(destination, player.x, player.y);

  let removedMobs = 0;
  let skippedMobs = 0;
  const mobs: Cc3dMob[] = [];
  for (const mob of level.mobs) {
    if (rectContains(source, mob.x, mob.y)) {
      const x = mob.x + step.dx;
      const y = mob.y + step.dy;
      if (!playerMoves && x === player.x && y === player.y) {
        skippedMobs++;
        continue;
      }
      mobs.push({ ...mob, x, y });
    } else if (rectContains(destination, mob.x, mob.y)) {
      removedMobs++;
    } else {
      mobs.push(mob);
    }
  }

  const next = assemble(level, cells, mobs, player, [...sourceIndices, ...destinationIndices]);
  const playerMoved = playerMoves && next !== level;
  if (next === level) return { ...unchanged(level, destination), playerKept };
  return { level: next, changed: true, removedMobs, skippedMobs, playerKept, playerMoved, rect: destination };
}

function opposite(side: Direction): Direction {
  return OPPOSITE_DIRECTION[side];
}

/**
 * Replaces the layer of kind/class `layer` on every cell of the region around (x, y): the 4-connected cells
 * whose terrain stack equals the clicked cell's (canonical comparison). A thin wall on either cell blocks the
 * flood across the side it closes; items and mobs do not bound the region. Each region cell gets
 * placeTerrain(stack, layer); thin walls, items and mobs stay. Refused (same level) for an outside cell, an
 * invalid layer, or when nothing would change. One copy of the cells array is built, whatever the region size.
 */
export function floodFillCc3d(level: Cc3dLevel, x: number, y: number, layer: Cc3dTerrain): Cc3dFillResult {
  const refused: Cc3dFillResult = { level, filled: 0 };
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= level.width || y >= level.height) return refused;
  const wanted = normalizeLayer(layer);
  if (!wanted) return refused;
  const { width, height, cells } = level;
  const startIndex = y * width + x;
  const targetStack = cells[startIndex].terrain;
  const targetKey = canonicalJson(targetStack);
  const replacement = placeTerrain(targetStack, wanted);
  if (canonicalJson(replacement) === targetKey) return refused;

  const keys: Array<string | undefined> = new Array(cells.length);
  const keyOf = (index: number): string => (keys[index] ??= canonicalJson(cells[index].terrain));
  const visited = new Uint8Array(cells.length);
  const queue = new Int32Array(cells.length);
  let tail = 0;
  queue[tail++] = startIndex;
  visited[startIndex] = 1;
  for (let head = 0; head < tail; head++) {
    const index = queue[head];
    const cell = cells[index];
    const cx = index % width;
    const cy = (index - cx) / width;
    for (const side of ORDERED_DIRECTIONS) {
      const nx = cx + DIRECTION_VECTORS[side].dx;
      const ny = cy + DIRECTION_VECTORS[side].dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (visited[next] === 1) continue;
      if (cell.panels.includes(side) || cells[next].panels.includes(opposite(side))) continue;
      if (keyOf(next) !== targetKey) continue;
      visited[next] = 1;
      queue[tail++] = next;
    }
  }

  const copy = cells.slice();
  for (let i = 0; i < tail; i++) {
    const index = queue[i];
    copy[index] = { ...cells[index], terrain: replacement.slice() };
  }
  return { level: { ...level, cells: copy }, filled: tail };
}

function clampSize(value: number, current: number, bounds: LevelSizeBounds): number {
  if (!Number.isFinite(value)) return current;
  return Math.min(bounds.maxSize, Math.max(bounds.minSize, Math.floor(value)));
}

/**
 * Resizes the grid, anchored on the top-left cell and clamped to the size bounds. New cells are plain floor,
 * mobs outside the new grid are dropped (the rest keep their order), the player start is clamped inside, and
 * a mob standing on the clamped start is dropped too. There is no wall-border rule. Same level when the
 * clamped size equals the current one.
 */
export function resizeCc3d(level: Cc3dLevel, width: number, height: number, bounds: LevelSizeBounds): Cc3dResizeResult {
  const newWidth = clampSize(width, level.width, bounds);
  const newHeight = clampSize(height, level.height, bounds);
  if (newWidth === level.width && newHeight === level.height) {
    return { level, changed: false, width: newWidth, height: newHeight, droppedMobs: 0, playerMoved: false };
  }
  const cells: Cc3dCell[] = [];
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      cells.push(x < level.width && y < level.height ? level.cells[y * level.width + x] : emptyCell());
    }
  }
  const px = Math.min(level.player.x, newWidth - 1);
  const py = Math.min(level.player.y, newHeight - 1);
  const playerMoved = px !== level.player.x || py !== level.player.y;
  const player = playerMoved ? { ...level.player, x: px, y: py } : level.player;
  const mobs = level.mobs.filter((mob) => mob.x < newWidth && mob.y < newHeight && !(mob.x === player.x && mob.y === player.y));
  const droppedMobs = level.mobs.length - mobs.length;
  return {
    level: { ...level, width: newWidth, height: newHeight, cells, mobs: droppedMobs > 0 ? mobs : level.mobs, player },
    changed: true,
    width: newWidth,
    height: newHeight,
    droppedMobs,
    playerMoved
  };
}
