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

/**
 * Room fingerprint for small block-pushing rooms. The window fingerprint of
 * OriginalityGuard is blind to blocks and targets and needs big maps; here a
 * level is reduced to its playable room (walls dropped, blocks and targets
 * kept), cropped to its bounding box, and two rooms are compared under
 * translation and the 8 rotations/reflections of the square grid.
 */

import { BLOCK_TARGET_TILE_ID } from '../core/coreConstants';
import { CompiledLevel, EntityDefinition, TileDefinition } from '../core/types';
import { XsbLevel } from '../formats/XsbCodec';
import { CellClass, classifyCell } from './OriginalityGuard';

/** Class of one room cell; walls are everything outside the playable room. */
export enum RoomCell {
  Wall = 0,
  Floor = 1,
  Hazard = 2,
  Door = 3,
  Item = 4,
  Other = 5,
  Target = 6,
  Block = 7,
  BlockOnTarget = 8
}

export interface RoomLayout {
  label: string;
  width: number;
  height: number;
  cells: Uint8Array;
  /** Cells that are not walls. */
  open: number;
  targets: number;
  blocks: number;
}

export interface RoomComparison {
  /** Matching open cells over the union of open cells, at the best alignment. */
  similarity: number;
  matchedCells: number;
}

export interface SimilarRoomPair extends RoomComparison {
  candidate: string;
  reference: string;
}

/** Characters of the XSB format that matter for a room. */
const XSB_WALL = '#';
const XSB_BOX = '$';
const XSB_GOAL = '.';
const XSB_BOX_ON_GOAL = '*';
const XSB_PLAYER = '@';
const XSB_PLAYER_ON_GOAL = '+';
const XSB_SPACE = ' ';
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
];
/** Quarter turns and mirror states that make the 8 symmetries of the square grid. */
const QUARTER_TURNS = 4;
const MIRROR_STATES = 2;

/** Crops a raw cell array to the bounding box of its non-wall cells. */
function buildLayout(label: string, width: number, height: number, raw: Uint8Array): RoomLayout {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (raw[y * width + x] === RoomCell.Wall) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { label, width: 0, height: 0, cells: new Uint8Array(0), open: 0, targets: 0, blocks: 0 };
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cells = new Uint8Array(w * h);
  let open = 0;
  let targets = 0;
  let blocks = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const value = raw[(y + minY) * width + x + minX];
      cells[y * w + x] = value;
      if (value === RoomCell.Wall) continue;
      open++;
      if (value === RoomCell.Target || value === RoomCell.BlockOnTarget) targets++;
      if (value === RoomCell.Block || value === RoomCell.BlockOnTarget) blocks++;
    }
  }
  return { label, width: w, height: h, cells, open, targets, blocks };
}

function roomCellOf(cls: CellClass): RoomCell {
  switch (cls) {
    case CellClass.Wall:
      return RoomCell.Wall;
    case CellClass.Floor:
      return RoomCell.Floor;
    case CellClass.Hazard:
      return RoomCell.Hazard;
    case CellClass.Door:
      return RoomCell.Door;
    case CellClass.Item:
      return RoomCell.Item;
    default:
      return RoomCell.Other;
  }
}

/** Reduces a compiled level to its room: terrain classes, targets, and pushable blocks. */
export function layoutFromLevel(
  label: string,
  level: CompiledLevel,
  getTile: (id: string) => TileDefinition,
  getEntity: (id: string) => EntityDefinition | undefined
): RoomLayout {
  const height = level.terrain.length;
  const width = height > 0 ? level.terrain[0].length : 0;
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const terrainId = level.terrain[y][x];
      const itemId = level.items[y]?.[x] ?? null;
      raw[y * width + x] =
        terrainId === BLOCK_TARGET_TILE_ID
          ? RoomCell.Target
          : roomCellOf(classifyCell(getTile(terrainId), itemId ? getTile(itemId) : null));
    }
  }
  for (const entity of level.entities) {
    if (getEntity(entity.type)?.kind !== 'block') continue;
    if (entity.x < 0 || entity.y < 0 || entity.x >= width || entity.y >= height) continue;
    const index = entity.y * width + entity.x;
    if (raw[index] === RoomCell.Wall) continue;
    raw[index] = raw[index] === RoomCell.Target ? RoomCell.BlockOnTarget : RoomCell.Block;
  }
  return buildLayout(label, width, height, raw);
}

/**
 * Reduces an XSB puzzle to its room without any size limit: the room is what
 * the player reaches ignoring blocks (every non-wall cell when there is no player).
 */
export function layoutFromXsb(label: string, level: XsbLevel): RoomLayout {
  const height = level.lines.length;
  const width = height > 0 ? Math.max(...level.lines.map((l) => l.length)) : 0;
  const at = (x: number, y: number) => level.lines[y]?.[x] ?? XSB_SPACE;
  const inside = new Uint8Array(width * height);
  let start: { x: number; y: number } | null = null;
  for (let y = 0; y < height && !start; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) === XSB_PLAYER || at(x, y) === XSB_PLAYER_ON_GOAL) {
        start = { x, y };
        break;
      }
    }
  }
  if (start) {
    const queue = [start];
    inside[start.y * width + start.x] = 1;
    for (let i = 0; i < queue.length; i++) {
      const { x, y } = queue[i];
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (at(nx, ny) === XSB_WALL || inside[ny * width + nx]) continue;
        inside[ny * width + nx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (at(x, y) !== XSB_WALL && at(x, y) !== XSB_SPACE) inside[y * width + x] = 1;
      }
    }
  }
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside[y * width + x]) continue;
      const ch = at(x, y);
      let cell = RoomCell.Floor;
      if (ch === XSB_BOX) cell = RoomCell.Block;
      else if (ch === XSB_BOX_ON_GOAL) cell = RoomCell.BlockOnTarget;
      else if (ch === XSB_GOAL || ch === XSB_PLAYER_ON_GOAL) cell = RoomCell.Target;
      raw[y * width + x] = cell;
    }
  }
  return buildLayout(label, width, height, raw);
}

function rotateQuarter(layout: RoomLayout): RoomLayout {
  const { width, height, cells } = layout;
  const out = new Uint8Array(cells.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[x * height + (height - 1 - y)] = cells[y * width + x];
  }
  return { ...layout, width: height, height: width, cells: out };
}

function mirror(layout: RoomLayout): RoomLayout {
  const { width, height, cells } = layout;
  const out = new Uint8Array(cells.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + (width - 1 - x)] = cells[y * width + x];
  }
  return { ...layout, cells: out };
}

/** The 8 rotations and reflections of a layout. */
export function orientations(layout: RoomLayout): RoomLayout[] {
  const result: RoomLayout[] = [];
  for (let m = 0; m < MIRROR_STATES; m++) {
    let current = m === 0 ? layout : mirror(layout);
    for (let t = 0; t < QUARTER_TURNS; t++) {
      result.push(current);
      current = rotateQuarter(current);
    }
  }
  return result;
}

/**
 * Best similarity of two rooms over translations and the 8 orientations of
 * `b`: matching open cells (same class) over the union of open cells.
 * Returns null when the open-cell counts alone rule out reaching `floor`.
 */
export function compareRooms(a: RoomLayout, b: RoomLayout, floor = 0): RoomComparison | null {
  if (a.open === 0 || b.open === 0) return { similarity: 0, matchedCells: 0 };
  if (Math.min(a.open, b.open) / Math.max(a.open, b.open) < floor) return null;
  let bestMatched = 0;
  for (const rotated of orientations(b)) {
    for (let dy = -(rotated.height - 1); dy < a.height; dy++) {
      for (let dx = -(rotated.width - 1); dx < a.width; dx++) {
        let matched = 0;
        const y1 = Math.min(a.height, dy + rotated.height);
        const x1 = Math.min(a.width, dx + rotated.width);
        for (let y = Math.max(0, dy); y < y1; y++) {
          for (let x = Math.max(0, dx); x < x1; x++) {
            const value = a.cells[y * a.width + x];
            if (value !== RoomCell.Wall && value === rotated.cells[(y - dy) * rotated.width + (x - dx)]) matched++;
          }
        }
        if (matched > bestMatched) bestMatched = matched;
      }
    }
  }
  return { similarity: bestMatched / (a.open + b.open - bestMatched), matchedCells: bestMatched };
}

/** Pairs of candidate and reference rooms at or above `minSimilarity`, most similar first. */
export function findSimilarRooms(candidates: RoomLayout[], references: RoomLayout[], minSimilarity: number): SimilarRoomPair[] {
  const pairs: SimilarRoomPair[] = [];
  for (const candidate of candidates) {
    for (const reference of references) {
      const comparison = compareRooms(candidate, reference, minSimilarity);
      if (comparison && comparison.similarity >= minSimilarity) {
        pairs.push({ candidate: candidate.label, reference: reference.label, ...comparison });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}

/** Every pair inside one list at or above `minSimilarity`, most similar first. */
export function findSimilarRoomsWithin(rooms: RoomLayout[], minSimilarity: number): SimilarRoomPair[] {
  const pairs: SimilarRoomPair[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const comparison = compareRooms(rooms[i], rooms[j], minSimilarity);
      if (comparison && comparison.similarity >= minSimilarity) {
        pairs.push({ candidate: rooms[i].label, reference: rooms[j].label, ...comparison });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}
