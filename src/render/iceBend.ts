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

import { Direction, TileDefinition } from '../core/types';
import { OPPOSITE_DIRECTION } from '../core/coreConstants';

/** A quarter turn, the angular span of every ice bend. */
export const QUARTER_TURN = Math.PI / 2;

const QUARTERS_PER_TURN = 4;

/** Edges in a fixed order, so the open edges of a bend always come out the same way. */
const EDGE_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];

/**
 * Whole quarter turns, clockwise from east in canvas space (y down), of a unit vector pointing
 * in each direction. Integers keep the arc selection exact; the angle is derived at the end.
 */
const DIRECTION_QUARTER: Readonly<Record<Direction, number>> = {
  E: 0,
  S: 1,
  W: 2,
  N: 3
};

/**
 * Geometry of an ice bend inside its cell, in tile units (0..1 along each axis).
 *
 * The slide path through a corner tile is a quarter circle centred on the cell corner where
 * the two open edges meet. The arc runs from `startAngle` to `startAngle + QUARTER_TURN` with
 * the canvas' default (clockwise) winding, so a point at angle `a` and radius `r` sits at
 * `(cx + r * cos(a), cy + r * sin(a))`.
 */
export interface IceBendGeometry {
  /** Arc centre, the open corner of the cell. */
  cx: number;
  cy: number;
  /** Start of the arc; it ends a quarter turn later. */
  startAngle: number;
  /** The two edges a slide can enter or leave through, in `EDGE_ORDER`. */
  openEdges: readonly [Direction, Direction];
}

/**
 * Derives the bend drawn for a corner ice tile from the edges its definition blocks, so the
 * picture always follows the engine: a slide may not enter through a blocked direction, hence
 * the wall sits on the opposite edge and the two remaining edges are joined by the curve.
 * Returns null for plain ice or any tile that does not block exactly two adjacent edges.
 */
export function iceBendGeometry(tile: TileDefinition): IceBendGeometry | null {
  const blockedEntries = tile.blockedEntryDirections;
  if (!blockedEntries || blockedEntries.length !== 2) return null;
  const walled = new Set<Direction>(blockedEntries.map((dir) => OPPOSITE_DIRECTION[dir]));
  const open = EDGE_ORDER.filter((dir) => !walled.has(dir));
  if (open.length !== 2) return null;
  const [first, second] = open;
  // Opposite edges (N and S, or E and W) make a corridor, not a bend.
  if (OPPOSITE_DIRECTION[first] === second) return null;

  const cx = open.includes('E') ? 1 : 0;
  const cy = open.includes('S') ? 1 : 0;
  // The arc meets the first open edge in the direction away from the second one, and vice versa.
  const onFirst = DIRECTION_QUARTER[OPPOSITE_DIRECTION[second]];
  const onSecond = DIRECTION_QUARTER[OPPOSITE_DIRECTION[first]];
  // The arc starts at whichever end is one quarter turn clockwise before the other.
  const clockwiseGap = (onSecond - onFirst + QUARTERS_PER_TURN) % QUARTERS_PER_TURN;
  const startQuarter = clockwiseGap === 1 ? onFirst : onSecond;
  return { cx, cy, startAngle: startQuarter * QUARTER_TURN, openEdges: [first, second] };
}
