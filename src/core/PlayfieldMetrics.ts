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

import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { GridPoint } from './types';

/** Neighbour count from which a playfield cell is a junction. */
const JUNCTION_MIN_NEIGHBOURS = 3;
/** Cell offsets of the 2x2 squares a cell can be a corner of. */
const SQUARE_ORIGIN_OFFSETS = [-1, 0];

/**
 * Shape of the area the player can actually walk, measured on the cells
 * reachable from the start rather than on the whole map, so empty wall does
 * not dilute the numbers. All shares are in [0, 1].
 */
export interface PlayfieldMetrics {
  cells: number;
  boundsWidth: number;
  boundsHeight: number;
  /** Playfield cells over the area of their bounding box. */
  fill: number;
  /** Share of cells that belong to an open 2x2 square. */
  openShare: number;
  /** Share of cells with exactly one walkable neighbour. */
  deadShare: number;
  /** Share of cells with three or more walkable neighbours. */
  junctionShare: number;
  /** Best match of the playfield with its horizontal, vertical or 180 degree mirror image. */
  symmetry: number;
}

const EMPTY_PLAYFIELD: PlayfieldMetrics = {
  cells: 0,
  boundsWidth: 0,
  boundsHeight: 0,
  fill: 0,
  openShare: 0,
  deadShare: 0,
  junctionShare: 0,
  symmetry: 0
};

/** Cells reachable from `start` over walkable cells, 4-connected. */
export function reachableCells(walkable: boolean[][], start: GridPoint): boolean[][] {
  const height = walkable.length;
  const width = height > 0 ? walkable[0].length : 0;
  const reached = walkable.map((row) => row.map(() => false));
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height || !walkable[start.y][start.x]) {
    return reached;
  }
  reached[start.y][start.x] = true;
  const queue: GridPoint[] = [{ x: start.x, y: start.y }];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    for (const dir of ORDERED_DIRECTIONS) {
      const x = cell.x + DIRECTION_VECTORS[dir].dx;
      const y = cell.y + DIRECTION_VECTORS[dir].dy;
      if (x < 0 || y < 0 || x >= width || y >= height || reached[y][x] || !walkable[y][x]) continue;
      reached[y][x] = true;
      queue.push({ x, y });
    }
  }
  return reached;
}

/** Measures the playfield reachable from `start` on a walkability grid. */
export function measurePlayfield(walkable: boolean[][], start: GridPoint): PlayfieldMetrics {
  const field = reachableCells(walkable, start);
  const height = field.length;
  const width = height > 0 ? field[0].length : 0;
  const inField = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && field[y][x];

  let cells = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!field[y][x]) continue;
      cells++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (cells === 0) return EMPTY_PLAYFIELD;

  const boundsWidth = maxX - minX + 1;
  const boundsHeight = maxY - minY + 1;
  let open = 0;
  let dead = 0;
  let junction = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!field[y][x]) continue;
      const neighbours = ORDERED_DIRECTIONS.filter((d) =>
        inField(x + DIRECTION_VECTORS[d].dx, y + DIRECTION_VECTORS[d].dy)
      ).length;
      if (neighbours === 1) dead++;
      if (neighbours >= JUNCTION_MIN_NEIGHBOURS) junction++;
      if (inOpenSquare(inField, x, y)) open++;
    }
  }

  const matchWith = (mirror: (x: number, y: number) => GridPoint): number => {
    let matching = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const m = mirror(x, y);
        if (inField(x, y) === inField(m.x, m.y)) matching++;
      }
    }
    return matching / (boundsWidth * boundsHeight);
  };
  const symmetry = Math.max(
    matchWith((x, y) => ({ x: minX + maxX - x, y })),
    matchWith((x, y) => ({ x, y: minY + maxY - y })),
    matchWith((x, y) => ({ x: minX + maxX - x, y: minY + maxY - y }))
  );

  return {
    cells,
    boundsWidth,
    boundsHeight,
    fill: cells / (boundsWidth * boundsHeight),
    openShare: open / cells,
    deadShare: dead / cells,
    junctionShare: junction / cells,
    symmetry
  };
}

/** Whether the cell is one corner of some fully walkable 2x2 square. */
function inOpenSquare(inField: (x: number, y: number) => boolean, x: number, y: number): boolean {
  for (const ox of SQUARE_ORIGIN_OFFSETS) {
    for (const oy of SQUARE_ORIGIN_OFFSETS) {
      if (
        inField(x + ox, y + oy) &&
        inField(x + ox + 1, y + oy) &&
        inField(x + ox, y + oy + 1) &&
        inField(x + ox + 1, y + oy + 1)
      ) {
        return true;
      }
    }
  }
  return false;
}
