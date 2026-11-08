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
 * Edits of the Chip's Challenge 2 track cells (`railTracks`) of an editor map: the default tracks of a freshly placed
 * track cell, one segment switched on or off, the open segment of a switch, and a quarter turn of every track of a cell.
 * Every map function returns a new map (or null when nothing changes) and leaves its input alone. Pure module: no DOM.
 */

import { RAIL_DEFAULT_ENTRY, RAIL_TRACK_COUNT, RAIL_TRACK_SIDES } from '../core/coreConstants';
import type { Direction, RailTrackCell } from '../core/types';
import { cloneMap, type EditorMap } from './editorDocument';
import { rotateClockwise } from './editorKeyboard';
import { replaceRailTracks } from './editorRailTracks';

/** The segment a new track cell starts with: north-south (bit 5 of the mask, see RAIL_TRACK_SIDES). */
export const RAIL_DEFAULT_SEGMENT = 5;

/** Mask of the default tracks of a new cell. */
export const RAIL_DEFAULT_MASK = 1 << RAIL_DEFAULT_SEGMENT;

/** Fewest segments a cell needs before it can hold a switch (a lone segment has nothing to switch to). */
export const RAIL_SWITCH_MIN_SEGMENTS = 2;

/**
 * The segment each segment turns into under a quarter turn clockwise (north-east to south-east to south-west to
 * north-west, and east-west to north-south and back), by segment number.
 */
const ROTATED_SEGMENT: readonly number[] = [1, 2, 3, 0, 5, 4];

/** The tracks a freshly placed track cell holds: one straight north-south segment. */
export function defaultRailTrackCell(x: number, y: number): RailTrackCell {
  return { x, y, mask: RAIL_DEFAULT_MASK };
}

/** The track cell entry at a position, or undefined when the cell has none. */
export function railTrackAt(map: Pick<EditorMap, 'railTracks'>, x: number, y: number): RailTrackCell | undefined {
  return map.railTracks?.find((entry) => entry.x === x && entry.y === y);
}

/** The segments of a mask, as segment numbers in mask order. */
export function segmentsOfMask(mask: number): number[] {
  const segments: number[] = [];
  for (let segment = 0; segment < RAIL_TRACK_COUNT; segment++) if ((mask & (1 << segment)) !== 0) segments.push(segment);
  return segments;
}

/** Whether a mask has enough segments to hold a switch. */
export function canHoldSwitch(mask: number): boolean {
  return segmentsOfMask(mask).length >= RAIL_SWITCH_MIN_SEGMENTS;
}

/** The two sides a segment joins. */
export function sidesOfSegment(segment: number): readonly [Direction, Direction] {
  return RAIL_TRACK_SIDES[segment];
}

/** A quarter turn clockwise of a mask. */
export function rotateMask(mask: number): number {
  let turned = 0;
  for (const segment of segmentsOfMask(mask)) turned |= 1 << ROTATED_SEGMENT[segment];
  return turned;
}

/** A track cell turned a quarter turn clockwise: its segments, its open segment and the side it was entered by. */
export function rotateRailTrackCell(cell: RailTrackCell): RailTrackCell {
  const turned: RailTrackCell = { x: cell.x, y: cell.y, mask: rotateMask(cell.mask) };
  if (cell.active !== undefined) turned.active = ROTATED_SEGMENT[cell.active];
  if (cell.entry !== undefined) {
    const turnedEntry = rotateClockwise(cell.entry);
    if (turnedEntry !== RAIL_DEFAULT_ENTRY) turned.entry = turnedEntry;
  }
  return turned;
}

/** The cell with one segment switched on or off; a switch that no longer has two segments to choose between is dropped. */
export function toggleSegment(cell: RailTrackCell, segment: number): RailTrackCell {
  const mask = cell.mask ^ (1 << segment);
  const next: RailTrackCell = { ...cell, mask };
  delete next.active;
  if (cell.active !== undefined && canHoldSwitch(mask)) {
    // The open segment stays while it is still there; else the first remaining segment opens.
    next.active = (mask & (1 << cell.active)) !== 0 ? cell.active : segmentsOfMask(mask)[0];
  }
  return next;
}

/** The cell with the open segment of its switch set, or the switch removed (null). A segment the cell does not hold is refused (undefined). */
export function withActiveSegment(cell: RailTrackCell, segment: number | null): RailTrackCell | undefined {
  const next: RailTrackCell = { ...cell };
  delete next.active;
  if (segment === null) return next;
  if ((cell.mask & (1 << segment)) === 0 || !canHoldSwitch(cell.mask)) return undefined;
  next.active = segment;
  return next;
}

/**
 * Applies a change to the track cell at a position of a map. `change` gets the cell's entry (an empty one when the cell
 * has none) and returns the new entry, null to remove it, or undefined to refuse. Returns the new map, or null when the
 * map is a CC3D one, the change was refused or it leaves the map as it was.
 */
export function editRailTrackAt(
  map: EditorMap,
  x: number,
  y: number,
  change: (cell: RailTrackCell) => RailTrackCell | null | undefined
): EditorMap | null {
  if (map.cc3d) return null;
  const next = change(railTrackAt(map, x, y) ?? { x, y, mask: 0 });
  if (next === undefined) return null;
  const others = (map.railTracks ?? []).filter((entry) => !(entry.x === x && entry.y === y));
  const result = cloneMap(map);
  replaceRailTracks(result, next === null ? others : [...others, next]);
  return JSON.stringify(result.railTracks ?? null) === JSON.stringify(map.railTracks ?? null) ? null : result;
}

/** The map with one segment of the track cell at (x, y) switched on or off. */
export function toggleRailSegment(map: EditorMap, x: number, y: number, segment: number): EditorMap | null {
  return editRailTrackAt(map, x, y, (cell) => toggleSegment(cell, segment));
}

/** The map with the open segment of the switch at (x, y) set (null removes the switch). */
export function setRailActiveSegment(map: EditorMap, x: number, y: number, segment: number | null): EditorMap | null {
  return editRailTrackAt(map, x, y, (cell) => withActiveSegment(cell, segment));
}

/** The map with every track of the cell at (x, y) turned a quarter turn clockwise. */
export function rotateRailTracksAt(map: EditorMap, x: number, y: number): EditorMap | null {
  return editRailTrackAt(map, x, y, (cell) => (cell.mask === 0 ? undefined : rotateRailTrackCell(cell)));
}

/** The map with every track of the cell at (x, y) removed; the cell stays a track cell with no segment. */
export function clearRailTracksAt(map: EditorMap, x: number, y: number): EditorMap | null {
  return editRailTrackAt(map, x, y, () => null);
}
