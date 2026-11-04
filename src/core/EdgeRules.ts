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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CELL_EDGE_BITS, OPPOSITE_DIRECTION } from './coreConstants';
import { CompiledLevel, Direction } from './types';

/**
 * Whether a thin wall or a one-way tile stops a step between two adjacent
 * cells. An edge is blocked from either side.
 */
function tileEdgeBlocked(fromId: string, toId: string, dir: Direction): boolean {
  const fromTile = ConfigRegistry.getTile(fromId);
  const toTile = ConfigRegistry.getTile(toId);
  const opposite = OPPOSITE_DIRECTION[dir];

  if (fromTile.blockedEdges?.includes(dir)) return true;
  if (toTile.blockedEdges?.includes(opposite)) return true;
  if (fromTile.blockedEntryDirections?.includes(opposite)) return true;
  if (toTile.blockedEntryDirections?.includes(dir)) return true;
  return false;
}

interface MaskMemo {
  width: number;
  height: number;
  mask: Uint8Array | null;
}

const maskMemo = new WeakMap<object, MaskMemo>();

/**
 * The thin walls a level carries on any terrain (`cellEdges`) as one bit per
 * side per cell, indexed by y * width + x; null when the level has none. Never
 * throws: an entry that is not a record, lies outside the grid or names an
 * unknown side is skipped. The result is memoised on the `cellEdges` array.
 */
export function cellEdgeMask(level: CompiledLevel): Uint8Array | null {
  const edges: unknown = level.cellEdges;
  if (!Array.isArray(edges) || edges.length === 0) return null;
  const height = Array.isArray(level.terrain) ? level.terrain.length : 0;
  const width = height > 0 && Array.isArray(level.terrain[0]) ? level.terrain[0].length : 0;
  const memo = maskMemo.get(edges);
  if (memo && memo.width === width && memo.height === height) return memo.mask;

  let mask: Uint8Array | null = null;
  if (width > 0 && height > 0) {
    const bits = new Uint8Array(width * height);
    let any = false;
    for (const entry of edges as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { x, y, sides } = entry as { x?: unknown; y?: unknown; sides?: unknown };
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) continue;
      if (x < 0 || x >= width || y < 0 || y >= height || !Array.isArray(sides)) continue;
      for (const side of sides as unknown[]) {
        const bit = typeof side === 'string' ? CELL_EDGE_BITS[side as Direction] : undefined;
        if (bit === undefined) continue;
        bits[y * width + x] |= bit;
        any = true;
      }
    }
    mask = any ? bits : null;
  }
  maskMemo.set(edges, { width, height, mask });
  return mask;
}

/**
 * Whether a step between two adjacent cells is stopped by a thin wall: the
 * terrain of either cell (thin wall and one-way tiles) or a cell edge of the
 * level, from either side. Shared by the engine, the validator and the solvers
 * so they all read the edges the same way.
 */
export function isEdgeBlockedAt(
  terrain: readonly (readonly string[])[],
  mask: Uint8Array | null,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  dir: Direction
): boolean {
  return isEdgeBlockedBetween(terrain[fromY][fromX], terrain[toY][toX], mask, terrain[0].length, fromX, fromY, toX, toY, dir);
}

/**
 * The same verdict as `isEdgeBlockedAt` for tile ids given by the caller, so a check can read an edge as if a
 * cell held another tile without writing into the terrain.
 */
export function isEdgeBlockedBetween(
  fromId: string,
  toId: string,
  mask: Uint8Array | null,
  width: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  dir: Direction
): boolean {
  if (tileEdgeBlocked(fromId, toId, dir)) return true;
  if (mask === null) return false;
  return (
    (mask[fromY * width + fromX] & CELL_EDGE_BITS[dir]) !== 0 ||
    (mask[toY * width + toX] & CELL_EDGE_BITS[OPPOSITE_DIRECTION[dir]]) !== 0
  );
}
