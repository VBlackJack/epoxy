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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { createTestBundle, loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, EntityPlacement } from './types';

const BYPASS = 'validator.issues.socket_bypass.label';
const UNREACHABLE_CHIPS = 'validator.issues.unreachable_chips.label';
const UNREACHABLE_EXIT = 'validator.issues.unreachable_exit.label';
/** Generous wall-clock bound for validating a big level, as in the targets budget test. */
const FAST_VALIDATE_MS = 2000;
/** Side of the comb level of the timing test. */
const COMB_SIDE = 128;
/** Distance between two teeth of the comb (a wall column separates them). */
const COMB_TOOTH_STRIDE = 2;
/** Rows of a tooth that hold a door. */
const COMB_DOOR_ROWS: readonly number[] = [4, 44, 84];
/** Rows of a tooth that are ice, and the row of its water cell. */
const COMB_ICE_ROWS: readonly number[] = [10, 11, 12, 50, 51, 90, 91];
const COMB_WATER_ROW = 120;

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  E: 'exit',
  S: 'socket',
  W: 'water',
  F: 'fire',
  I: 'ice',
  Y: 'door_yellow',
  A: 'appearing_wall'
};
const ITEM_CODES: Record<string, { terrain: string; item: string }> = {
  c: { terrain: 'floor', item: 'chip' },
  y: { terrain: 'floor', item: 'key_yellow' },
  b: { terrain: 'floor', item: 'boots_water' },
  f: { terrain: 'floor', item: 'boots_fire' }
};

function grid(rows: string[], extra: { chipsRequired?: number; entities?: EntityPlacement[] } = {}): CompiledLevel {
  let start = { x: -1, y: -1 };
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  rows.forEach((row, y) => {
    terrain.push([]);
    items.push([]);
    [...row].forEach((ch, x) => {
      if (ch === 'P') start = { x, y };
      const withItem = ITEM_CODES[ch];
      terrain[y].push(withItem ? withItem.terrain : TERRAIN_CODES[ch]);
      items[y].push(withItem ? withItem.item : null);
    });
  });
  return {
    id: 'door_ranking_grid',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: extra.chipsRequired ?? 0,
    playerStart: { ...start, dir: 'S' },
    terrain,
    items,
    entities: extra.entities ?? [],
    trapLinks: [],
    cloneLinks: []
  };
}

const keys = (level: CompiledLevel): string[] => LevelValidator.validate(level).issues.map((i) => i.i18nKey);

describe('which scarce-key door opens first', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('keeps the key from a door that joins two rooms already reached', () => {
    // One yellow key, two yellow doors. The left door joins two cells the walk already reaches; the right one
    // opens the chip room. Water between the rooms must not make the left door look as rewarding.
    const level = grid(
      ['###########', '#Py.......#', '#.####Y#Y##', '#......W.c#', '########S##', '########E##', '###########'],
      { chipsRequired: 1 }
    );
    const found = keys(level);
    expect(found).not.toContain(UNREACHABLE_CHIPS);
    expect(found).not.toContain(UNREACHABLE_EXIT);
    expect(LevelValidator.validate(level).stats.reachableChips).toBe(1);
  });

  it('keeps the key from a door whose entry slides on ice into water', () => {
    // The left door shows an ice column ending in water: the slide drowns. The right door leads to the chip.
    const level = grid(
      ['###########', '#P.y.....##', '###Y###Y###', '###I###cSE#', '###I###.###', '###WWWW.###', '###########'],
      { chipsRequired: 1 }
    );
    const found = keys(level);
    expect(found).not.toContain(UNREACHABLE_CHIPS);
    expect(found).not.toContain(UNREACHABLE_EXIT);
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(true);
  });

  it('survives both traps in one level, with the real door listed last', () => {
    // One key; the joining door and the drowning door are met before the door that leads to the chip.
    const level = grid(
      [
        '#############',
        '#Py.........#',
        '#.##Y#Y###Y##',
        '#....#I###.c#',
        '######I###E##',
        '######WWWW.##',
        '#############'
      ],
      { chipsRequired: 1 }
    );
    const found = keys(level);
    expect(found).not.toContain(UNREACHABLE_CHIPS);
    expect(found).not.toContain(UNREACHABLE_EXIT);
  });
});

describe('socket bypass and hazards', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('does not cross water without boots when the level has no block', () => {
    expect(keys(grid(['########', '#P.cWE##', '########'], { chipsRequired: 1 }))).not.toContain(BYPASS);
  });

  it('crosses water with the boots picked up on the way', () => {
    expect(keys(grid(['########', '#PbcWE##', '########'], { chipsRequired: 1 }))).toContain(BYPASS);
  });

  it('keeps water walkable when the level has a block, which can fill it', () => {
    const block: EntityPlacement = { type: 'dirt_block', x: 2, y: 2, dir: 'S' };
    const level = grid(['########', '#P.cWE##', '#..#####', '########'], { chipsRequired: 1, entities: [block] });
    expect(keys(level)).toContain(BYPASS);
  });

  it('does not cross fire with water boots', () => {
    expect(keys(grid(['########', '#PbcFE##', '########'], { chipsRequired: 1 }))).not.toContain(BYPASS);
    expect(keys(grid(['########', '#PfcFE##', '########'], { chipsRequired: 1 }))).toContain(BYPASS);
  });

  it('judges a touch-revealed cell like the main walk', () => {
    const plain = grid(['########', '#P.cAE##', '########'], { chipsRequired: 1 });
    expect(keys(plain)).not.toContain(BYPASS);
    expect(keys(plain)).toContain(UNREACHABLE_EXIT);

    // A tile that reveals ground on touch is crossed by both walks.
    const bundle = createTestBundle();
    bundle.tiles.tiles.appearing_wall = { ...bundle.tiles.tiles.appearing_wall, revealsToOnTouch: 'floor' };
    ConfigRegistry.applyConfigs(bundle);
    const found = keys(plain);
    expect(found).toContain(BYPASS);
    expect(found).not.toContain(UNREACHABLE_EXIT);
  });
});

/** A comb: a spine along the top, teeth going down with scarce-key doors, ice runs and a water cell each. */
function combLevel(): CompiledLevel {
  const terrain: string[][] = Array.from({ length: COMB_SIDE }, () => new Array<string>(COMB_SIDE).fill('wall'));
  const items: (string | null)[][] = Array.from({ length: COMB_SIDE }, () => new Array<string | null>(COMB_SIDE).fill(null));
  for (let x = 1; x < COMB_SIDE - 1; x++) terrain[1][x] = 'floor';
  let bootToggle = false;
  for (let x = 1; x < COMB_SIDE - 1; x += COMB_TOOTH_STRIDE) {
    for (let y = 2; y < COMB_SIDE - 1; y++) terrain[y][x] = 'floor';
    for (const y of COMB_DOOR_ROWS) terrain[y][x] = 'door_yellow';
    for (const y of COMB_ICE_ROWS) terrain[y][x] = 'ice';
    terrain[COMB_WATER_ROW][x] = bootToggle ? 'fire' : 'water';
    // One key per tooth on the spine and a boot of one of two kinds just below the first door.
    items[1][x] = 'key_yellow';
    items[COMB_DOOR_ROWS[0] - 1][x] = bootToggle ? 'boots_fire' : 'boots_water';
    bootToggle = !bootToggle;
  }
  terrain[COMB_SIDE - 2][COMB_SIDE - 2] = 'exit';
  return {
    id: 'comb',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items,
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
}

describe('door ranking cost', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('validates a big comb of scarce-key doors, ice and boots fast', () => {
    const level = combLevel();
    const doors = level.terrain.flat().filter((id) => id === 'door_yellow').length;
    expect(doors).toBeGreaterThanOrEqual(150);
    const started = performance.now();
    const report = LevelValidator.validate(level);
    expect(performance.now() - started).toBeLessThan(FAST_VALIDATE_MS);
    expect(report.stats.exitCount).toBe(1);
  });
});
