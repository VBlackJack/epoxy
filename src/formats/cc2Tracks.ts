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
 * The modifier of a Chip's Challenge 2 railroad tile, read as Lexy's Labyrinth does (js/format-c2g.js, tile 0x4f):
 * bits 0-5 are the track segments (north-east, south-east, south-west, north-west, east-west, north-south), bit 0x40
 * says the cell has a switch, bits 8-11 hold the active segment of that switch and bits 12-13 the direction an actor
 * standing on the cell at the start was moving when it came in (north, east, south, west).
 */

import { OPPOSITE_DIRECTION, RAIL_DEFAULT_ENTRY, RAIL_TRACK_COUNT, RAIL_TRACK_MASK_ALL } from '../core/coreConstants';
import type { Direction, RailTrackCell } from '../core/types';

/** Flag of a cell with a switch. */
export const TRACK_SWITCH_FLAG = 0x40;
/** Where the active segment sits, and its width. */
const TRACK_ACTIVE_SHIFT = 8;
const TRACK_ACTIVE_MASK = 0x0f;
/** Where the direction of the actor on the cell sits, and its width. */
const TRACK_ENTRY_SHIFT = 12;
const TRACK_ENTRY_MASK = 0x03;
/** The direction each value of the entry bits stands for (Lexy's DIRECTION_ORDER). */
const TRACK_ENTRY_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];

/** The track data of a cell, without its place. */
export type Cc2TrackData = Omit<RailTrackCell, 'x' | 'y'>;

/**
 * The tracks of a railroad modifier. `active` is set only when the cell has a switch and names a segment (0 to 5); the
 * entry side is the one opposite the direction the actor was moving, and is left out when it is the default one.
 * A modifier that holds no segment and no switch gives mask 0, which lets nobody in.
 */
export function decodeCc2Track(mod: number | undefined): Cc2TrackData {
  const value = mod ?? 0;
  const mask = value & RAIL_TRACK_MASK_ALL;
  const active = (value & TRACK_SWITCH_FLAG) !== 0 ? (value >> TRACK_ACTIVE_SHIFT) & TRACK_ACTIVE_MASK : undefined;
  const entry = OPPOSITE_DIRECTION[TRACK_ENTRY_DIRECTIONS[(value >> TRACK_ENTRY_SHIFT) & TRACK_ENTRY_MASK]];
  return {
    mask,
    ...(active !== undefined && active < RAIL_TRACK_COUNT ? { active } : {}),
    ...(entry !== RAIL_DEFAULT_ENTRY ? { entry } : {})
  };
}

/** Whether the cell is a junction in the sense of the coverage table: several segments, or a switch. */
export function isCc2Junction(mod: number | undefined): boolean {
  const data = decodeCc2Track(mod);
  let segments = 0;
  for (let bit = 0; bit < RAIL_TRACK_COUNT; bit++) if ((data.mask & (1 << bit)) !== 0) segments++;
  return segments > 1 || data.active !== undefined;
}
