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

import { describe, expect, it } from 'vitest';
import { iceBendGeometry, QUARTER_TURN } from './iceBend';
import { createTestBundle } from '../test/loadTestConfigs';
import { OPPOSITE_DIRECTION } from '../core/coreConstants';
import { Direction, TileDefinition } from '../core/types';

const tiles = createTestBundle().tiles.tiles as Record<string, TileDefinition>;
const CORNERS = ['ice_nw', 'ice_ne', 'ice_sw', 'ice_se'] as const;

/** Point of the arc at the given angle, in tile units. */
function arcPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

/** The cell edge a point of the cell boundary lies on. */
function edgeOf(point: { x: number; y: number }): Direction {
  const eps = 1e-9;
  if (Math.abs(point.y) < eps) return 'N';
  if (Math.abs(point.y - 1) < eps) return 'S';
  if (Math.abs(point.x) < eps) return 'W';
  if (Math.abs(point.x - 1) < eps) return 'E';
  throw new Error(`point (${point.x}, ${point.y}) is not on the cell boundary`);
}

describe('iceBendGeometry', () => {
  it('returns null for plain ice and for non-ice tiles', () => {
    expect(iceBendGeometry(tiles.ice)).toBeNull();
    expect(iceBendGeometry(tiles.floor)).toBeNull();
  });

  it('refuses a corridor that blocks two opposite edges', () => {
    const corridor: TileDefinition = { ...tiles.ice, blockedEntryDirections: ['N', 'S'] };
    expect(iceBendGeometry(corridor)).toBeNull();
  });

  it.each(CORNERS)('%s: the arc joins the two edges a slide may use, with the wall on the other two', (id) => {
    const tile = tiles[id];
    const bend = iceBendGeometry(tile);
    expect(bend).not.toBeNull();
    if (!bend) return;

    const walled = tile.blockedEntryDirections!.map((dir) => OPPOSITE_DIRECTION[dir]);
    for (const edge of bend.openEdges) expect(walled).not.toContain(edge);

    // The centre line of the bend reaches the cell boundary exactly on the two open edges.
    const start = arcPoint(bend.cx, bend.cy, 0.5, bend.startAngle);
    const end = arcPoint(bend.cx, bend.cy, 0.5, bend.startAngle + QUARTER_TURN);
    expect(new Set([edgeOf(start), edgeOf(end)])).toEqual(new Set(bend.openEdges));

    // The arc centre is the cell corner shared by the two open edges, away from the walls.
    expect(bend.cx).toBe(bend.openEdges.includes('E') ? 1 : 0);
    expect(bend.cy).toBe(bend.openEdges.includes('S') ? 1 : 0);

    // The middle of the arc points into the cell, never through a wall.
    const middle = arcPoint(bend.cx, bend.cy, 0.5, bend.startAngle + QUARTER_TURN / 2);
    expect(middle.x).toBeGreaterThan(0);
    expect(middle.x).toBeLessThan(1);
    expect(middle.y).toBeGreaterThan(0);
    expect(middle.y).toBeLessThan(1);
  });

  it.each(CORNERS)('%s: both travel directions of the deflection map run through the drawn bend', (id) => {
    const tile = tiles[id];
    const bend = iceBendGeometry(tile)!;
    const entries = Object.entries(tile.deflectionMap!) as [Direction, Direction][];
    expect(entries).toHaveLength(2);
    for (const [moving, deflectedTo] of entries) {
      // Moving north, the slide enters through the south edge and leaves through the exit edge.
      const enteredThrough = OPPOSITE_DIRECTION[moving];
      expect(new Set([enteredThrough, deflectedTo])).toEqual(new Set(bend.openEdges));
    }
  });
});
