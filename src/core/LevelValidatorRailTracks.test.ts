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

import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel, RailTrackCell } from './types';

const EMPTY_TRACK_WARNING = 'validator.issues.rail_track_empty.label';
const NORTH_SOUTH_MASK = 1 << 5;

/** A small room with an exit and two track cells, at (2, 1) and (3, 1). */
function room(tracks: RailTrackCell[]): CompiledLevel {
  const terrain = [
    ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    ['wall', 'floor', 'rail_junction', 'rail_junction', 'exit', 'wall'],
    ['wall', 'wall', 'wall', 'wall', 'wall', 'wall']
  ];
  return {
    id: 'rail_warning',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'E' },
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...(tracks.length > 0 ? { railTracks: tracks } : {})
  };
}

const warnings = (level: CompiledLevel) => LevelValidator.validate(level).issues.filter((issue) => issue.i18nKey === EMPTY_TRACK_WARNING);

beforeAll(() => {
  loadTestConfigs();
});

describe('a track cell with no segment', () => {
  it('draws one warning per cell, with its position', () => {
    const found = warnings(room([]));
    expect(found.map((issue) => issue.params)).toEqual([{ x: 2, y: 1 }, { x: 3, y: 1 }]);
    expect(found.every((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('warns only about the cell that holds no segment', () => {
    const found = warnings(room([{ x: 2, y: 1, mask: NORTH_SOUTH_MASK }]));
    expect(found.map((issue) => issue.params)).toEqual([{ x: 3, y: 1 }]);
  });

  it('is quiet when every track cell holds a segment', () => {
    const tracks = [
      { x: 2, y: 1, mask: NORTH_SOUTH_MASK },
      { x: 3, y: 1, mask: 1 << 4 }
    ];
    expect(warnings(room(tracks))).toEqual([]);
  });
});
