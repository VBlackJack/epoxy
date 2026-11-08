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
 * The track cells (`railTracks`) of an editor map. The editor does not author them in this release: it carries them
 * through load, copy, undo, resize and save without changing them, and drops an entry whose cell no longer holds a
 * track cell tile. Pure module: no DOM.
 */

import { normalizeRailTracks } from '../config/ConfigValidation';
import type { RailTrackCell, Ruleset } from '../core/types';

/** Track cells belong to the Epoxy ruleset only; this is the ruleset their canonical form is computed for. */
const RAIL_RULESET: Ruleset = 'epoxy';

/** The track cells of a map, as the editor reads and rewrites them (Epoxy levels only, never CC3D). */
export interface RailTrackHolder {
  terrain: string[][];
  railTracks?: RailTrackCell[];
}

/** The track cells in canonical form (see normalizeRailTracks), or undefined when none is left. */
export function canonicalRailTracks(
  tracks: readonly RailTrackCell[] | undefined,
  terrain: readonly (readonly string[])[]
): RailTrackCell[] | undefined {
  if (!tracks || tracks.length === 0) return undefined;
  return normalizeRailTracks(tracks, terrain, RAIL_RULESET) ?? undefined;
}

/** Deep copy of a list of track cells; undefined when it is absent or empty. */
export function cloneRailTracks(tracks: readonly RailTrackCell[] | undefined): RailTrackCell[] | undefined {
  if (!tracks || tracks.length === 0) return undefined;
  return tracks.map((entry) => ({ ...entry }));
}

/** The track cells moved by (dx, dy), with the ones that leave the new grid dropped. */
export function translateRailTracks(
  tracks: readonly RailTrackCell[],
  dx: number,
  dy: number,
  width: number,
  height: number
): RailTrackCell[] {
  return tracks
    .map((entry) => ({ ...entry, x: entry.x + dx, y: entry.y + dy }))
    .filter((entry) => entry.x >= 0 && entry.x < width && entry.y >= 0 && entry.y < height);
}

/** Replaces the track cells of a map by the canonical form of `tracks`; the field is removed when none is left. */
export function replaceRailTracks(map: RailTrackHolder, tracks: readonly RailTrackCell[]): void {
  const canonical = canonicalRailTracks(tracks, map.terrain);
  if (canonical) map.railTracks = canonical;
  else delete map.railTracks;
}
