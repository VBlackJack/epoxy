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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CompiledLevel, LevelBlueprint } from '../core/types';

/** Legend character used to pad the hand-drawn rows up to the map size. */
const PADDING_CHAR = '#';
/** Marks the player start in hand-drawn rows; the cell itself is floor. */
const START_CHAR = '@';
const FLOOR_CHAR = '.';

/**
 * Builds a full-size level from a few rows drawn with the levels.json legend.
 * The rows sit in the top-left corner and the rest of the map is wall, so
 * measures are not diluted by open space. '@' marks the player start.
 */
export function buildTestLevel(
  rows: string[],
  extra: Partial<Pick<LevelBlueprint, 'chipsRequired' | 'timeLimitSeconds' | 'entities'>> = {}
): CompiledLevel {
  const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
  let start = { x: 0, y: 0 };
  const padded = Array.from({ length: mapHeight }, (_, y) => {
    const row = rows[y] ?? '';
    const startX = row.indexOf(START_CHAR);
    if (startX >= 0) start = { x: startX, y };
    return row.replace(START_CHAR, FLOOR_CHAR).padEnd(mapWidth, PADDING_CHAR);
  });
  return ConfigRegistry.compileBlueprint({
    id: 'test_level',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: extra.timeLimitSeconds ?? 0,
    chipsRequired: extra.chipsRequired ?? 0,
    playerStart: { ...start, dir: 'S' },
    rows: padded,
    entities: extra.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  });
}
