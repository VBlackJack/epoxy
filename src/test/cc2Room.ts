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

import type { Cc2LevelData, CompiledLevel, Direction, EntityPlacement } from '../core/types';

/** A CC2 record marking a compiled level as running on the CC2 engine. */
export const CC2_TEST_RECORD = { v: 1, sha256: 'ab'.repeat(32), file: 'one.c2m', order: 1, gridHash: 'x' } as Cc2LevelData;

export const ROOM_SIZE = 13;
export const ROOM_ROW = 5;

export type RoomMode = 'cc2' | 'cc' | 'native';

export interface RoomOptions {
  mode: RoomMode;
  startX?: number;
  dir?: Direction;
  /** Terrain overrides, keyed "x,y". */
  terrain?: Record<string, string>;
  /** Item overrides, keyed "x,y". */
  items?: Record<string, string>;
  entities?: EntityPlacement[];
  chipsRequired?: number;
}

/** A walled room of plain floor on row ROOM_ROW, with the cells of `terrain` and `items` overridden. */
export function room(opts: RoomOptions): CompiledLevel {
  const terrain: string[][] = Array.from({ length: ROOM_SIZE }, (_, y) =>
    Array.from({ length: ROOM_SIZE }, (_, x) => (x === 0 || y === 0 || x === ROOM_SIZE - 1 || y === ROOM_SIZE - 1 ? 'wall' : 'floor'))
  );
  const items: (string | null)[][] = Array.from({ length: ROOM_SIZE }, () => Array.from({ length: ROOM_SIZE }, () => null));
  for (const [key, id] of Object.entries(opts.terrain ?? {})) {
    const [x, y] = key.split(',').map(Number);
    terrain[y][x] = id;
  }
  for (const [key, id] of Object.entries(opts.items ?? {})) {
    const [x, y] = key.split(',').map(Number);
    items[y][x] = id;
  }
  const base: CompiledLevel = {
    id: `room_${opts.mode}`,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: opts.chipsRequired ?? 0,
    playerStart: { x: opts.startX ?? 2, y: ROOM_ROW, dir: opts.dir ?? 'E' },
    terrain,
    items,
    entities: opts.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
  if (opts.mode === 'cc2') return { ...base, cc2: CC2_TEST_RECORD };
  return opts.mode === 'cc' ? { ...base, rulesFlavor: 'cc' } : base;
}
