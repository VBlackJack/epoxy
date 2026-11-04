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
 * Geometry of the laser beam overlay. Pure module (no DOM): from the cells the engine reports it
 * decides which half-lines of a cell the beam draws, and turns them into rectangles in tile units,
 * so the rules can be tested in node and every render style draws the same beam.
 */

import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { OPPOSITE_DIRECTION, reflectOnMirror } from '../core/coreConstants';
import { BeamCell, Direction, MirrorAxis, MirrorCorner } from '../core/types';

/** Which of the four half-lines from the centre of a cell to its edges the beam draws. */
export type BeamArms = Readonly<Record<Direction, boolean>>;

/** Rectangle in tile units, from the top-left corner of the cell. */
export interface BeamRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What the beam geometry needs to know about the board around a cell. */
export interface BeamBoard {
  /** The beam cell at a position, if the beam crosses it. */
  beamAt(x: number, y: number): BeamCell | undefined;
  /** Axis of the mirror standing on a position, if any. */
  mirrorAt(x: number, y: number): MirrorAxis | undefined;
  /** The reflecting corner of a one-sided mirror; undefined for a double-sided mirror or no mirror. */
  mirrorFrontAt?(x: number, y: number): MirrorCorner | undefined;
  /** Direction the emitter on a position fires in, if any. */
  emitterAt(x: number, y: number): Direction | undefined;
}

/** Thickness of the beam halo and of its bright core, in tile units (whole pixels on a 16-px sprite). */
export const BEAM_HALO_TILE = 0.25;
export const BEAM_CORE_TILE = 0.125;

const CELL_CENTRE = 0.5;
const NO_ARMS: BeamArms = { N: false, E: false, S: false, W: false };

function isHorizontal(dir: Direction): boolean {
  return dir === 'E' || dir === 'W';
}

/**
 * Whether the neighbour on `side` of (x, y) sends a beam into the cell, travelling `dir`: an emitter
 * firing that way, or a beam cell along that axis. A neighbouring mirror is judged by the axes it
 * carries only, which is exact except where two mirrors touch.
 */
function feedsFrom(board: BeamBoard, x: number, y: number, side: Direction, dir: Direction): boolean {
  const nx = x + DIRECTION_VECTORS[side].dx;
  const ny = y + DIRECTION_VECTORS[side].dy;
  if (board.emitterAt(nx, ny) === dir) return true;
  const neighbour = board.beamAt(nx, ny);
  if (!neighbour) return false;
  return isHorizontal(dir) ? neighbour.horizontal : neighbour.vertical;
}

/**
 * The half-lines the beam draws in a cell. A plain cell draws a line (or a cross where two beams
 * meet). A mirror cell draws the corner of every beam that enters it: a beam travelling `dir`
 * comes in from the side opposite `dir` and leaves on the side the mirror turns it to.
 */
export function beamArms(cell: BeamCell, board: BeamBoard): BeamArms {
  const lines: BeamArms = {
    N: cell.vertical,
    S: cell.vertical,
    E: cell.horizontal,
    W: cell.horizontal
  };
  const axis = board.mirrorAt(cell.x, cell.y);
  if (!axis) return lines;
  const arms: Record<Direction, boolean> = { ...NO_ARMS };
  for (const dir of ORDERED_DIRECTIONS) {
    const entry = OPPOSITE_DIRECTION[dir];
    if (!feedsFrom(board, cell.x, cell.y, entry, dir)) continue;
    // A beam that meets the back of a one-sided mirror draws no corner there.
    const out = reflectOnMirror(axis, board.mirrorFrontAt?.(cell.x, cell.y), dir);
    if (out === null) continue;
    arms[entry] = true;
    arms[out] = true;
  }
  // No neighbour could be traced to the beam (touching mirrors): show the axes it carries rather than nothing.
  return ORDERED_DIRECTIONS.some((dir) => arms[dir]) ? arms : lines;
}

/** Rectangles, in tile units, that draw the given arms with a line `thickness` thick. */
export function armRects(arms: BeamArms, thickness: number): BeamRect[] {
  const near = CELL_CENTRE - thickness / 2;
  const far = CELL_CENTRE + thickness / 2;
  const rects: BeamRect[] = [];
  if (arms.N) rects.push({ x: near, y: 0, w: thickness, h: far });
  if (arms.S) rects.push({ x: near, y: near, w: thickness, h: 1 - near });
  if (arms.W) rects.push({ x: 0, y: near, w: far, h: thickness });
  if (arms.E) rects.push({ x: near, y: near, w: 1 - near, h: thickness });
  return rects;
}
