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
import { CONVERTED_ID_SUFFIX } from './cc3d/cc3dConstants';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel, EntityPlacement } from './types';

const UNREACHABLE_EXIT = 'validator.issues.unreachable_exit.label';
const NO_MATCHING_KEY = 'validator.issues.no_matching_key.label';
const KEYLESS_DOORS = 'validator.issues.keyless_doors.label';
const KEY_ITEM = 'key_red';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  E: 'exit',
  Y: 'toggle_button_yellow',
  y: 'toggle_wall_yellow_closed',
  U: 'toggle_button_blue',
  u: 'toggle_wall_blue_closed',
  T: 'turtle',
  F: 'fire',
  D: 'door_red',
  G: 'door_green',
  K: 'floor',
  H: 'thief_keys',
  I: 'ice'
};

/**
 * Rows: # wall, . floor, P player, E exit, Y yellow button, y closed yellow wall, U blue button, u closed blue wall,
 * T turtle, F fire, D red door, G green door, K red key on floor, H key thief, I ice.
 */
function grid(rows: string[], entities: EntityPlacement[] = [], converted = false): CompiledLevel {
  let start = { x: 0, y: 0 };
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      return TERRAIN_CODES[ch];
    })
  );
  const items = rows.map((row) => [...row].map((ch) => (ch === 'K' ? KEY_ITEM : null)));
  return {
    id: converted ? `grid${CONVERTED_ID_SUFFIX}` : 'grid',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { ...start, dir: 'S' },
    terrain,
    items,
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

const errorKeys = (level: CompiledLevel): string[] =>
  LevelValidator.validate(level)
    .issues.filter((i) => i.severity === 'error')
    .map((i) => i.i18nKey);

const warningKeys = (level: CompiledLevel): string[] =>
  LevelValidator.validate(level)
    .issues.filter((i) => i.severity === 'warning')
    .map((i) => i.i18nKey);

const unreachable = (level: CompiledLevel): boolean => errorKeys(level).includes(UNREACHABLE_EXIT);

describe('LevelValidator movers and channel buttons', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  const buttonRows = ['#######', '#Py..E#', '####Y##', '####.##', '#######'];

  it('counts a colour button a monster can reach as opening the walls of its channel', () => {
    const monster: EntityPlacement = { type: 'bouncer', x: 4, y: 3, dir: 'N' };
    expect(unreachable(grid(buttonRows))).toBe(true);
    expect(unreachable(grid(buttonRows, [monster]))).toBe(false);
  });

  it('counts a colour button a block can reach as opening the walls of its channel', () => {
    const block: EntityPlacement = { type: 'dirt_block', x: 4, y: 3, dir: 'N' };
    expect(unreachable(grid(buttonRows, [block]))).toBe(false);
  });

  it('does not let a monster that works no button open the walls of a channel', () => {
    const blinky: EntityPlacement = { type: 'blinky', x: 4, y: 3, dir: 'N' };
    expect(unreachable(grid(buttonRows, [blinky]))).toBe(true);
  });

  it('lets a monster that enters turtles cross them to a colour button, and one that does not stays out', () => {
    const rows = ['#######', '#Py..E#', '####Y##', '####T##', '####.##', '#######'];
    const bouncer: EntityPlacement = { type: 'bouncer', x: 4, y: 4, dir: 'N' };
    const pinkBall: EntityPlacement = { type: 'pink_ball', x: 4, y: 4, dir: 'N' };
    expect(unreachable(grid(rows, [bouncer]))).toBe(false);
    expect(unreachable(grid(rows, [pinkBall]))).toBe(true);
  });

  it('lets a monster immune to fire cross it to a colour button, and one that is not stays out', () => {
    const rows = ['#######', '#Py..E#', '####Y##', '####F##', '####.##', '#######'];
    const immune: EntityPlacement = { type: 'baby_screamer', x: 4, y: 4, dir: 'N' };
    const vulnerable: EntityPlacement = { type: 'bouncer', x: 4, y: 4, dir: 'N' };
    expect(unreachable(grid(rows, [immune]))).toBe(false);
    expect(unreachable(grid(rows, [vulnerable]))).toBe(true);
  });
});

describe('LevelValidator reading of a converted CC3D level', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('warns about a door no key opens in a converted level and still errors in a native one', () => {
    const rows = ['#####', '#PGE#', '#####'];
    const converted = grid(rows, [], true);
    expect(errorKeys(converted)).not.toContain(NO_MATCHING_KEY);
    expect(warningKeys(converted)).toContain(KEYLESS_DOORS);
    expect(errorKeys(grid(rows))).toContain(NO_MATCHING_KEY);
    expect(warningKeys(grid(rows))).not.toContain(KEYLESS_DOORS);
  });

  it('takes a key thief beside the way as avoidable in a converted level only', () => {
    const rows = ['##H####', '#PK.DE#', '#######'];
    expect(unreachable(grid(rows, [], true))).toBe(false);
    expect(unreachable(grid(rows))).toBe(true);
  });

  it('lets a mover stop a slide anywhere on the ice in a converted level only', () => {
    const rows = ['###E###', '#PIII.#', '#.#####', '#######'];
    const block: EntityPlacement = { type: 'dirt_block', x: 1, y: 2, dir: 'N' };
    expect(unreachable(grid(rows, [block], true))).toBe(false);
    expect(unreachable(grid(rows, [], true))).toBe(true);
    expect(unreachable(grid(rows, [block]))).toBe(true);
  });

  it('lets the movers use the walls the player opens in a converted level only', () => {
    // The yellow button lies behind fire and a blue wall: only the player's blue button, then a fire-proof monster, reach it.
    const rows = [
      '###########',
      '#PU.y..E###',
      '###########',
      '####YFu.###',
      '###########'
    ];
    const monster: EntityPlacement = { type: 'baby_screamer', x: 7, y: 3, dir: 'W' };
    expect(unreachable(grid(rows, [monster], true))).toBe(false);
    expect(unreachable(grid(rows, [monster]))).toBe(true);
  });
});
