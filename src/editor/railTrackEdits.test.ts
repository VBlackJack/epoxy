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

import { beforeEach, describe, expect, it } from 'vitest';
import { RAIL_TRACK_COUNT } from '../core/coreConstants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import type { EditorMap } from './editorDocument';
import { eraseCell, floodFillTerrain, paintTerrain } from './mapEdits';
import {
  canHoldSwitch,
  clearRailTracksAt,
  defaultRailTrackCell,
  RAIL_DEFAULT_MASK,
  railTrackAt,
  rotateMask,
  rotateRailTrackCell,
  rotateRailTracksAt,
  segmentsOfMask,
  setRailActiveSegment,
  toggleRailSegment,
  toggleSegment,
  withActiveSegment
} from './railTrackEdits';

const JUNCTION = 'rail_junction';
const NORTH_EAST = 0;
const SOUTH_EAST = 1;
const SOUTH_WEST = 2;
const NORTH_WEST = 3;
const EAST_WEST = 4;
const NORTH_SOUTH = 5;
const bit = (segment: number): number => 1 << segment;

beforeEach(() => {
  loadTestConfigs();
});

/** A bordered 7 x 6 map with a track cell at (3, 2) holding the default tracks. */
function mapWithTrack(): EditorMap {
  const terrain: string[][] = Array.from({ length: 6 }, (_, y) =>
    Array.from({ length: 7 }, (_, x) => (x === 0 || y === 0 || x === 6 || y === 5 ? 'wall' : 'floor'))
  );
  const map: EditorMap = {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' }
  };
  return paintTerrain(map, 3, 2, JUNCTION).map;
}

describe('mask turns', () => {
  it('sends each segment to the next one clockwise', () => {
    expect(rotateMask(bit(NORTH_EAST))).toBe(bit(SOUTH_EAST));
    expect(rotateMask(bit(SOUTH_EAST))).toBe(bit(SOUTH_WEST));
    expect(rotateMask(bit(SOUTH_WEST))).toBe(bit(NORTH_WEST));
    expect(rotateMask(bit(NORTH_WEST))).toBe(bit(NORTH_EAST));
    expect(rotateMask(bit(EAST_WEST))).toBe(bit(NORTH_SOUTH));
    expect(rotateMask(bit(NORTH_SOUTH))).toBe(bit(EAST_WEST));
  });

  it('comes back to the start after four quarter turns, for every mask', () => {
    for (let mask = 0; mask < 1 << RAIL_TRACK_COUNT; mask++) {
      let turned = mask;
      for (let turn = 0; turn < 4; turn++) turned = rotateMask(turned);
      expect(turned).toBe(mask);
    }
  });

  it('turns the open segment and the entry side with the cell, and drops a default entry', () => {
    const cell = { x: 1, y: 1, mask: bit(NORTH_EAST) | bit(EAST_WEST), active: EAST_WEST, entry: 'E' as const };
    expect(rotateRailTrackCell(cell)).toEqual({ x: 1, y: 1, mask: bit(SOUTH_EAST) | bit(NORTH_SOUTH), active: NORTH_SOUTH });
    expect(rotateRailTrackCell({ x: 1, y: 1, mask: bit(NORTH_SOUTH), entry: 'W' })).toEqual({ x: 1, y: 1, mask: bit(EAST_WEST), entry: 'N' });
  });
});

describe('segments of one cell', () => {
  it('starts with the straight north-south segment', () => {
    expect(defaultRailTrackCell(2, 3)).toEqual({ x: 2, y: 3, mask: RAIL_DEFAULT_MASK });
    expect(segmentsOfMask(RAIL_DEFAULT_MASK)).toEqual([NORTH_SOUTH]);
  });

  it('switches a segment on and off, and only two or more can hold a switch', () => {
    const two = toggleSegment(defaultRailTrackCell(1, 1), EAST_WEST);
    expect(two.mask).toBe(bit(NORTH_SOUTH) | bit(EAST_WEST));
    expect(canHoldSwitch(two.mask)).toBe(true);
    expect(canHoldSwitch(bit(NORTH_SOUTH))).toBe(false);
    expect(toggleSegment(two, EAST_WEST).mask).toBe(bit(NORTH_SOUTH));
  });

  it('keeps the open segment while it stays, moves it when it goes, and drops the switch below two segments', () => {
    const switched = { x: 1, y: 1, mask: bit(NORTH_EAST) | bit(EAST_WEST) | bit(NORTH_SOUTH), active: EAST_WEST };
    expect(toggleSegment(switched, NORTH_EAST).active).toBe(EAST_WEST);
    expect(toggleSegment(switched, EAST_WEST).active).toBe(NORTH_EAST);
    const pair = { x: 1, y: 1, mask: bit(EAST_WEST) | bit(NORTH_SOUTH), active: NORTH_SOUTH };
    expect(toggleSegment(pair, EAST_WEST).active).toBeUndefined();
  });

  it('sets the open segment only among the segments the cell holds, and removes the switch with null', () => {
    const pair = { x: 1, y: 1, mask: bit(EAST_WEST) | bit(NORTH_SOUTH) };
    expect(withActiveSegment(pair, EAST_WEST)?.active).toBe(EAST_WEST);
    expect(withActiveSegment(pair, NORTH_EAST)).toBeUndefined();
    expect(withActiveSegment(defaultRailTrackCell(1, 1), NORTH_SOUTH)).toBeUndefined();
    expect(withActiveSegment({ ...pair, active: EAST_WEST }, null)?.active).toBeUndefined();
  });
});

describe('painting and erasing track cells', () => {
  it('writes the default tracks when a track cell is painted', () => {
    const map = mapWithTrack();
    expect(map.terrain[2][3]).toBe(JUNCTION);
    expect(map.railTracks).toEqual([{ x: 3, y: 2, mask: RAIL_DEFAULT_MASK }]);
  });

  it('leaves the tracks alone when the same tile is painted again', () => {
    const edited = toggleRailSegment(mapWithTrack(), 3, 2, EAST_WEST)!;
    const again = paintTerrain(edited, 3, 2, JUNCTION);
    expect(again.changed).toBe(false);
    expect(railTrackAt(edited, 3, 2)?.mask).toBe(bit(NORTH_SOUTH) | bit(EAST_WEST));
  });

  it('removes the tracks when the cell is replaced or erased', () => {
    expect(paintTerrain(mapWithTrack(), 3, 2, 'floor').map.railTracks).toBeUndefined();
    expect(eraseCell(mapWithTrack(), 3, 2).map.railTracks).toBeUndefined();
  });

  it('gives every cell of a flood fill the default tracks', () => {
    const filled = floodFillTerrain(mapWithTrack(), 2, 2, JUNCTION).map;
    const cells = (filled.railTracks ?? []).map((entry) => `${entry.x},${entry.y}`);
    expect(cells).toHaveLength(filled.terrain.flat().filter((id) => id === JUNCTION).length);
    expect(cells).toContain('3,2');
    expect(cells).toContain('2,2');
    expect((filled.railTracks ?? []).every((entry) => entry.mask === RAIL_DEFAULT_MASK)).toBe(true);
  });
});

describe('editing the tracks of a map', () => {
  it('toggles a segment without changing the input map', () => {
    const map = mapWithTrack();
    const before = JSON.stringify(map);
    const edited = toggleRailSegment(map, 3, 2, NORTH_EAST)!;
    expect(JSON.stringify(map)).toBe(before);
    expect(railTrackAt(edited, 3, 2)?.mask).toBe(bit(NORTH_SOUTH) | bit(NORTH_EAST));
  });

  it('refuses a cell that is not a track cell', () => {
    expect(toggleRailSegment(mapWithTrack(), 2, 2, NORTH_SOUTH)).toBeNull();
    expect(rotateRailTracksAt(mapWithTrack(), 2, 2)).toBeNull();
  });

  it('sets and removes the open segment', () => {
    const pair = toggleRailSegment(mapWithTrack(), 3, 2, EAST_WEST)!;
    const withSwitch = setRailActiveSegment(pair, 3, 2, EAST_WEST)!;
    expect(railTrackAt(withSwitch, 3, 2)?.active).toBe(EAST_WEST);
    expect(setRailActiveSegment(pair, 3, 2, NORTH_EAST)).toBeNull();
    expect(railTrackAt(setRailActiveSegment(withSwitch, 3, 2, null)!, 3, 2)?.active).toBeUndefined();
  });

  it('turns the tracks a quarter turn', () => {
    const turned = rotateRailTracksAt(mapWithTrack(), 3, 2)!;
    expect(railTrackAt(turned, 3, 2)?.mask).toBe(bit(EAST_WEST));
  });

  it('clears the tracks: the cell stays a track cell with no entry', () => {
    const cleared = clearRailTracksAt(mapWithTrack(), 3, 2)!;
    expect(cleared.terrain[2][3]).toBe(JUNCTION);
    expect(cleared.railTracks).toBeUndefined();
    expect(clearRailTracksAt(cleared, 3, 2)).toBeNull();
    // A cleared cell cannot be turned: there is nothing to turn.
    expect(rotateRailTracksAt(cleared, 3, 2)).toBeNull();
  });

  it('removing the last segment clears the cell', () => {
    const emptied = toggleRailSegment(mapWithTrack(), 3, 2, NORTH_SOUTH)!;
    expect(emptied.railTracks).toBeUndefined();
    expect(railTrackAt(toggleRailSegment(emptied, 3, 2, SOUTH_WEST)!, 3, 2)?.mask).toBe(bit(SOUTH_WEST));
  });
});
