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
import { CompiledLevel } from './types';

const UNREACHABLE_KEYS = [
  'validator.issues.unreachable_exit.label',
  'validator.issues.unreachable_exit_proven.label',
  'validator.issues.unreachable_chips.label',
  'validator.issues.unreachable_chips_proven.label'
];

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  c: 'floor',
  E: 'exit',
  // Closed on the north and east sides at the start: the east exit of the cell is shut until it turns.
  N: 'swivel_door_ne'
};

function row(text: string, y: number, level: { start: { x: number; y: number } }): string[] {
  return [...text].map((ch, x) => {
    if (ch === 'P') level.start = { x, y };
    return TERRAIN_CODES[ch];
  });
}

function grid(rows: string[], chipsRequired = 0): CompiledLevel {
  const holder = { start: { x: 0, y: 0 } };
  const terrain = rows.map((text, y) => row(text, y, holder));
  return {
    id: 'swivel_grid',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired,
    playerStart: { ...holder.start, dir: 'E' },
    terrain,
    items: rows.map((text) => [...text].map((ch) => (ch === 'c' ? 'chip' : null))),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

function unreachableKeys(level: CompiledLevel): string[] {
  return LevelValidator.validate(level)
    .issues.map((i) => i.i18nKey)
    .filter((key) => UNREACHABLE_KEYS.includes(key));
}

describe('swivel doors count as open on every side for reachability', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('reports no unreachable exit when the only way is through a swivel closed on that side', () => {
    expect(unreachableKeys(grid(['#######', '#P.N.E#', '#######']))).toEqual([]);
  });

  it('counts a chip that sits behind a swivel', () => {
    expect(unreachableKeys(grid(['#######', '#P.NcE#', '#######'], 1))).toEqual([]);
  });

  it('still reports an exit sealed off by a wall beyond the swivel', () => {
    expect(unreachableKeys(grid(['#######', '#P.N#E#', '#######']))).toContain('validator.issues.unreachable_exit.label');
  });

  it('leaves a level without swivels unchanged', () => {
    const plain = grid(['#######', '#P...E#', '#######']);
    expect(unreachableKeys(plain)).toEqual([]);
    expect(unreachableKeys(grid(['#######', '#P.#.E#', '#######']))).toContain('validator.issues.unreachable_exit.label');
  });

  it('restores the terrain after checking', () => {
    const level = grid(['#######', '#P.N.E#', '#######']);
    LevelValidator.validate(level);
    expect(level.terrain[1][3]).toBe('swivel_door_ne');
  });
});
