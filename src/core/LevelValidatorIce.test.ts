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
import { CompiledLevel, EntityPlacement } from './types';

const HIDDEN = 'validator.issues.hidden_by_block.label';
const CHIP_ITEM = 'chip';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  $: 'floor',
  c: 'floor',
  E: 'exit',
  W: 'water',
  I: 'ice',
  '4': 'ice_se'
};

/** Rows: # wall, . floor, P player, $ block, c chip on floor, E exit, W water, I ice, 4 ice_se corner. */
function grid(rows: string[], block: EntityPlacement): CompiledLevel {
  let start = { x: 0, y: 0 };
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      return TERRAIN_CODES[ch];
    })
  );
  const items = rows.map((row) => [...row].map((ch) => (ch === 'c' ? CHIP_ITEM : null)));
  return {
    id: 'ice_grid',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'S' },
    terrain,
    items,
    entities: [block],
    trapLinks: [],
    cloneLinks: []
  };
}

function hiddenCount(level: CompiledLevel): number {
  const issue = LevelValidator.validate(level).issues.find((i) => i.i18nKey === HIDDEN);
  return (issue?.params?.count as number | undefined) ?? 0;
}

const LANE_BLOCK: EntityPlacement = { type: 'dirt_block', x: 2, y: 1, dir: 'S' };
const CORNER_BLOCK: EntityPlacement = { type: 'dirt_block', x: 2, y: 2, dir: 'S' };

describe('hidden_by_block follows a slide on ice', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('flags a chip at the far end of an ice lane a block can enter', () => {
    expect(hiddenCount(grid(['#########', '#P$IIIIc#', '#########'], LANE_BLOCK))).toBe(1);
  });

  it('flags a chip only a slide can reach, past an ice corner the pusher cannot stand behind', () => {
    const rows = ['#####c#', '#####I#', '#P$II4#', '#######'];
    expect(hiddenCount(grid(rows, CORNER_BLOCK))).toBe(1);
  });

  it('does not flag that chip when the lane is plain floor', () => {
    const rows = ['#####c#', '#####.#', '#P$...#', '#######'];
    expect(hiddenCount(grid(rows, CORNER_BLOCK))).toBe(0);
  });

  it('does not flag a chip beside the lane that the slide never reaches', () => {
    const rows = ['###c###', '#P$IIII', '#######'];
    expect(hiddenCount(grid(rows, LANE_BLOCK))).toBe(0);
  });

  it('does not flag a chip behind water at the end of the lane, since the block sinks there', () => {
    expect(hiddenCount(grid(['#########', '#P$IIIWc#', '#########'], LANE_BLOCK))).toBe(0);
  });
});
