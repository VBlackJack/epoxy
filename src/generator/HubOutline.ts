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

import { Direction, HubOutlineGrowthConfig } from '../core/types';

/** Floor character of hub outlines in game.json. */
export const HUB_FLOOR_CHAR = '.';
/** Wall character of hub outlines in game.json. */
const HUB_WALL_CHAR = '#';
/** Rows and columns of floor are added to the outline round these sides in turn, when the hub is centred. */
const GROWTH_SIDES: Direction[] = ['E', 'S', 'W', 'N'];

/** What the growth of an outline is measured against: the plan's puzzles and the map. */
export interface OutlineRoom {
  /** Cells of the map inside its margin. */
  interior: number;
  /** Box cells of every puzzle of the plan, the finale included. */
  boxArea: number;
  pieceCount: number;
  /** Widest and tallest an outline may be, so the wall ring and a gate still fit beside it. */
  widest: number;
  tallest: number;
}

/** Floor cells of a drawn outline. */
export function outlineFloor(rows: string[]): number {
  return rows.reduce((sum, row) => sum + [...row].filter((ch) => ch === HUB_FLOOR_CHAR).length, 0);
}

/**
 * Floor cells the outline should gain: its share of the free area (the interior
 * less the puzzle boxes and a corridor allowance per puzzle), less what it has,
 * capped by the rule. Zero or less when the drawn outline is large enough.
 */
export function wantedGrowth(drawn: string[], room: OutlineRoom, rule: HubOutlineGrowthConfig): number {
  const free = room.interior - room.boxArea - rule.cellsPerPiece * room.pieceCount;
  return Math.min(rule.maxCells, Math.round(free * rule.freeAreaShare) - outlineFloor(drawn));
}

/**
 * The sides of the outline in growth order for a hub shifted by `shiftX` and
 * `shiftY` from the map centre: the side nearest the map edge first, as the
 * band between the hub and that edge is too narrow for a wing anyway, then
 * the others by their offset. Sides at equal offset keep the drawn order.
 */
export function growthSides(shiftX: number, shiftY: number): Direction[] {
  const offset = (side: Direction): number => {
    if (side === 'E') return shiftX;
    if (side === 'W') return -shiftX;
    return side === 'S' ? shiftY : -shiftY;
  };
  return [...GROWTH_SIDES].sort((a, b) => offset(b) - offset(a));
}

/**
 * The drawn outline grown by `wanted` floor cells or thereabouts: whole rows and
 * columns of floor are added round it, side after side in the order given,
 * while each brings the floor count nearer the target than leaving it. A side
 * that would take the outline past the room's width or height is skipped.
 */
export function growOutline(drawn: string[], wanted: number, room: OutlineRoom, sides: Direction[] = GROWTH_SIDES): string[] {
  if (wanted <= 0) return drawn;
  let width = Math.max(...drawn.map((r) => r.length));
  let rows = drawn.map((r) => r.padEnd(width, HUB_WALL_CHAR));
  let added = 0;
  // Every side is given a turn after the last one that fit; two full rounds without a fit end it.
  let skipped = 0;
  for (let i = 0; skipped < 2 * sides.length; i++) {
    const side = sides[i % sides.length];
    const vertical = side === 'E' || side === 'W';
    if (vertical ? width >= room.widest : rows.length >= room.tallest) {
      skipped++;
      continue;
    }
    skipped = 0;
    const strip = vertical ? rows.length : width;
    if (strip > 2 * (wanted - added)) break;
    if (vertical) {
      rows = rows.map((r) => (side === 'E' ? r + HUB_FLOOR_CHAR : HUB_FLOOR_CHAR + r));
      width++;
    } else {
      const row = HUB_FLOOR_CHAR.repeat(width);
      rows = side === 'S' ? [...rows, row] : [row, ...rows];
    }
    added += strip;
  }
  return rows;
}
