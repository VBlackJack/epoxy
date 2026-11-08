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
import { CloneLink, CompiledLevel, EntityPlacement } from './types';

const UNREACHABLE_EXIT = 'validator.issues.unreachable_exit.label';
const BOMB_ITEM = 'bomb';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  B: 'floor',
  E: 'exit',
  W: 'water',
  G: 'button_green',
  Z: 'toggle_wall_closed',
  R: 'button_red',
  M: 'clone_machine'
};

/** Rows: # wall, . floor, P player, E exit, G green button, Z closed toggle wall, B bomb, R red button, M cloner. */
function grid(rows: string[], entities: EntityPlacement[] = [], cloneLinks: CloneLink[] = []): CompiledLevel {
  let start = { x: 0, y: 0 };
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      return TERRAIN_CODES[ch];
    })
  );
  const items = rows.map((row) => [...row].map((ch) => (ch === 'B' ? BOMB_ITEM : null)));
  return {
    id: 'grid',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'S' },
    terrain,
    items,
    entities,
    trapLinks: [],
    cloneLinks
  };
}

const unreachable = (level: CompiledLevel): boolean =>
  LevelValidator.validate(level).issues.some((i) => i.severity === 'error' && i.i18nKey === UNREACHABLE_EXIT);

describe('LevelValidator over-approximation for things the player does not drive', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('counts a green button a monster can reach as opening the toggle walls', () => {
    const rows = ['#######', '#PZ..E#', '####G##', '####.##', '#######'];
    const monster: EntityPlacement = { type: 'pink_ball', x: 4, y: 3, dir: 'N' };
    expect(unreachable(grid(rows, [monster]))).toBe(false);
    expect(unreachable(grid(rows))).toBe(true);
  });

  it('keeps a toggle wall shut when the monster is walled off from the green button', () => {
    const rows = ['#######', '#PZ..E#', '####G##', '###.#.#', '#######'];
    const monster: EntityPlacement = { type: 'pink_ball', x: 5, y: 3, dir: 'N' };
    expect(unreachable(grid(rows, [monster]))).toBe(true);
  });

  it('counts a green button a block can flood to as opening the toggle walls', () => {
    const rows = ['#######', '#PZ..E#', '####G##', '####.##', '#######'];
    const block: EntityPlacement = { type: 'dirt_block', x: 4, y: 3, dir: 'N' };
    expect(unreachable(grid(rows, [block]))).toBe(false);
  });

  it('does not let a monster that presses no plates open the toggle walls', () => {
    const rows = ['#######', '#PZ..E#', '####G##', '####.##', '#######'];
    const phasing: EntityPlacement = { type: 'wisp', x: 4, y: 3, dir: 'N' };
    expect(unreachable(grid(rows, [phasing]))).toBe(true);
  });

  it('counts a bomb a monster can reach as set off', () => {
    const rows = ['#######', '#P.B.E#', '#######'];
    const monster: EntityPlacement = { type: 'pink_ball', x: 4, y: 1, dir: 'W' };
    expect(unreachable(grid(rows, [monster]))).toBe(false);
    expect(unreachable(grid(rows))).toBe(true);
  });

  it('counts a cloner button a monster can reach as granting the clone', () => {
    const rows = ['#########', '#P.W.E###', '#########', '#R#M#####', '#########'];
    const cloneLinks: CloneLink[] = [
      { buttonX: 1, buttonY: 3, clonerX: 3, clonerY: 3, templateType: 'dirt_block', templateDir: 'S' }
    ];
    const block: EntityPlacement = { x: 3, y: 3, type: 'dirt_block', dir: 'S' };
    const monster: EntityPlacement = { type: 'pink_ball', x: 2, y: 3, dir: 'W' };
    expect(unreachable(grid(rows, [block, monster], cloneLinks))).toBe(false);
    expect(unreachable(grid(rows, [block], cloneLinks))).toBe(true);
  });
});
