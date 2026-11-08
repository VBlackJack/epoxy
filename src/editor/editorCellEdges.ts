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

import { normalizeCellEdges } from '../config/ConfigValidation';
import { OPPOSITE_DIRECTION } from '../core/coreConstants';
import type { CellEdge, Direction, Ruleset } from '../core/types';

/** Thin walls belong to the Epoxy ruleset only; this is the ruleset their canonical form is computed for. */
const EDGE_RULESET: Ruleset = 'epoxy';

/** The thin walls of a map, as the editor reads and rewrites them (Epoxy levels only, never CC3D). */
export interface CellEdgeHolder {
  terrain: string[][];
  cellEdges?: CellEdge[];
}

/** A rectangle of cells, as the selection edits use it. */
export interface EdgeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The thin walls in canonical form (see normalizeCellEdges), or undefined when none is left. */
export function canonicalEdges(edges: readonly CellEdge[] | undefined, terrain: readonly (readonly string[])[]): CellEdge[] | undefined {
  if (!edges || edges.length === 0) return undefined;
  return normalizeCellEdges(edges, terrain, EDGE_RULESET) ?? undefined;
}

/** Deep copy of a list of thin walls; undefined when it is absent or empty. */
export function cloneEdges(edges: readonly CellEdge[] | undefined): CellEdge[] | undefined {
  if (!edges || edges.length === 0) return undefined;
  return edges.map((entry) => ({ x: entry.x, y: entry.y, sides: [...entry.sides], ...(entry.canopy === true ? { canopy: true as const } : {}) }));
}

/** True when the map carries at least one thin wall. */
export function hasCellEdges(map: Pick<CellEdgeHolder, 'cellEdges'>): boolean {
  return (map.cellEdges?.length ?? 0) > 0;
}

/** The blocked sides of one cell, in N, E, S, W order; empty when it has none. */
export function edgesAt(map: Pick<CellEdgeHolder, 'cellEdges'>, x: number, y: number): Direction[] {
  const entry = map.cellEdges?.find((e) => e.x === x && e.y === y);
  return entry ? [...entry.sides] : [];
}

/** Step of the neighbour across each side, as a column and row offset. */
const SIDE_STEP: Readonly<Record<Direction, { dx: number; dy: number }>> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 }
};

/** Sides in the order the walls are listed and spoken. */
const SIDE_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];

/** The cell across a side, or null when that side is the border of the grid. */
function neighbourAcross(
  map: Pick<CellEdgeHolder, 'terrain'>,
  x: number,
  y: number,
  side: Direction
): { x: number; y: number } | null {
  const nx = x + SIDE_STEP[side].dx;
  const ny = y + SIDE_STEP[side].dy;
  const row = map.terrain[ny];
  return row && nx >= 0 && nx < row.length ? { x: nx, y: ny } : null;
}

/** True when a side of a cell is closed: its own wall, or the matching wall of the neighbour across it. */
export function isSideClosed(map: CellEdgeHolder, x: number, y: number, side: Direction): boolean {
  if (edgesAt(map, x, y).includes(side)) return true;
  const across = neighbourAcross(map, x, y, side);
  return across !== null && edgesAt(map, across.x, across.y).includes(OPPOSITE_DIRECTION[side]);
}

/** The closed sides of a cell as the drawing shows them (own walls and the neighbours' matching walls), in N, E, S, W order. */
export function closedSidesAt(map: CellEdgeHolder, x: number, y: number): Direction[] {
  return SIDE_ORDER.filter((side) => isSideClosed(map, x, y, side));
}

/**
 * Toggles one side of a cell, treating the line between two cells as one wall: a closed line (own wall or the
 * neighbour's matching one) is opened by removing it from both cells, an open one is closed on the own cell only.
 * The map is changed in place.
 */
export function toggleSide(map: CellEdgeHolder, x: number, y: number, side: Direction): void {
  if (isSideClosed(map, x, y, side)) {
    const own = edgesAt(map, x, y);
    if (own.includes(side)) setEdgesAt(map, x, y, own.filter((s) => s !== side));
    const across = neighbourAcross(map, x, y, side);
    if (across) {
      const opposite = OPPOSITE_DIRECTION[side];
      const theirs = edgesAt(map, across.x, across.y);
      if (theirs.includes(opposite)) setEdgesAt(map, across.x, across.y, theirs.filter((s) => s !== opposite));
    }
  } else {
    setEdgesAt(map, x, y, [...edgesAt(map, x, y), side]);
  }
}

/** Stores the edges of a map in canonical form, or removes the field when none is left. */
function commit(map: CellEdgeHolder, edges: readonly CellEdge[]): void {
  const canonical = canonicalEdges(edges, map.terrain);
  if (canonical) map.cellEdges = canonical;
  else delete map.cellEdges;
}

/** Sets the blocked sides of one cell (an empty list clears them). The map is changed in place. */
export function setEdgesAt(map: CellEdgeHolder, x: number, y: number, sides: readonly Direction[]): void {
  const own = (map.cellEdges ?? []).find((e) => e.x === x && e.y === y);
  const others = (map.cellEdges ?? []).filter((e) => !(e.x === x && e.y === y));
  // The canopy of the cell stays: only its thin walls change.
  const canopy = own?.canopy === true ? { canopy: true as const } : {};
  commit(map, sides.length > 0 || own?.canopy === true ? [...others, { x, y, sides: [...sides], ...canopy }] : others);
}

/** Removes the edges of every cell the predicate accepts; returns how many cells lost theirs. The map is changed in place. */
export function removeEdgesWhere(map: CellEdgeHolder, predicate: (x: number, y: number) => boolean): number {
  const before = map.cellEdges ?? [];
  const kept = before.filter((e) => !predicate(e.x, e.y));
  if (kept.length !== before.length) commit(map, kept);
  return before.length - kept.length;
}

/** Removes the edges of the cells inside a rectangle; returns how many cells lost theirs. The map is changed in place. */
export function withoutCells(map: CellEdgeHolder, rect: EdgeRect): number {
  return removeEdgesWhere(map, (x, y) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height);
}

/** The edges moved by a step; entries leaving the grid are dropped. */
export function translate(edges: readonly CellEdge[], dx: number, dy: number, width: number, height: number): CellEdge[] {
  return edges
    .map((e) => ({ x: e.x + dx, y: e.y + dy, sides: [...e.sides], ...(e.canopy === true ? { canopy: true as const } : {}) }))
    .filter((e) => e.x >= 0 && e.y >= 0 && e.x < width && e.y < height);
}

/** Replaces the edges of a map by a list that may be in any order; stored canonical, field removed when empty. */
export function replaceEdges(map: CellEdgeHolder, edges: readonly CellEdge[]): void {
  commit(map, edges);
}

/** The cells whose blocked sides differ between two lists of edges, as grid positions. */
export function differingEdgeCells(
  before: readonly CellEdge[] | undefined,
  after: readonly CellEdge[] | undefined
): Array<{ x: number; y: number }> {
  const sidesOf = (edges: readonly CellEdge[] | undefined): Map<string, string> => {
    const map = new Map<string, string>();
    for (const e of edges ?? []) map.set(`${e.x},${e.y}`, [...e.sides].sort().join('') + (e.canopy === true ? '+' : ''));
    return map;
  };
  const was = sidesOf(before);
  const now = sidesOf(after);
  const cells = new Map<string, { x: number; y: number }>();
  for (const e of [...(before ?? []), ...(after ?? [])]) {
    const key = `${e.x},${e.y}`;
    if ((was.get(key) ?? '') !== (now.get(key) ?? '')) cells.set(key, { x: e.x, y: e.y });
  }
  return [...cells.values()];
}
