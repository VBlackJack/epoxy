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

import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { Direction, RelativeTurn } from '../types';

export interface Cell {
  x: number;
  y: number;
}

const QUARTER_TURNS: Record<RelativeTurn, number> = {
  FORWARD: 0,
  RIGHT: 1,
  BACK: 2,
  LEFT: 3
};

/** Turns a facing clockwise by a number of quarter turns (negative turns go counter-clockwise). */
export function turnClockwise(dir: Direction, quarterTurns = 1): Direction {
  const count = ORDERED_DIRECTIONS.length;
  const index = ORDERED_DIRECTIONS.indexOf(dir);
  return ORDERED_DIRECTIONS[(((index + quarterTurns) % count) + count) % count];
}

export function opposite(dir: Direction): Direction {
  return turnClockwise(dir, QUARTER_TURNS.BACK);
}

/** The direction reached from a facing by a relative turn (forward, left, right, back). */
export function relativeTo(facing: Direction, turn: RelativeTurn): Direction {
  return turnClockwise(facing, QUARTER_TURNS[turn]);
}

/** The cell next to a cell in a direction. */
export function neighbour(cell: Cell, dir: Direction): Cell {
  const v = DIRECTION_VECTORS[dir];
  return { x: cell.x + v.dx, y: cell.y + v.dy };
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}
