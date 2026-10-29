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
import { LevelValidator } from './LevelValidator';
import { ProceduralGenerator } from './ProceduralGenerator';
import { CloneLink, CompiledLevel, EntityPlacement } from './types';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** One-letter codes for hand-built grids. */
const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  E: 'exit',
  S: 'socket',
  T: 'thief',
  W: 'water',
  F: 'fire',
  I: 'ice',
  v: 'force_s',
  R: 'button_red',
  M: 'clone_machine'
};
const ITEM_CODES: Record<string, { terrain: string; item: string }> = {
  c: { terrain: 'floor', item: 'chip' },
  b: { terrain: 'floor', item: 'boots_water' }
};

function grid(
  rows: string[],
  extra: { chipsRequired?: number; entities?: EntityPlacement[]; cloneLinks?: CloneLink[] } = {}
): CompiledLevel {
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
    id: 'grid',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: extra.chipsRequired ?? 0,
    playerStart: { ...start, dir: 'S' },
    terrain,
    items,
    entities: extra.entities ?? [],
    trapLinks: [],
    cloneLinks: extra.cloneLinks ?? []
  };
}

const keys = (level: CompiledLevel): string[] =>
  LevelValidator.validate(level).issues.map((i) => i.i18nKey);

describe('LevelValidator', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('accepts a plain solvable level', () => {
    const report = LevelValidator.validate(grid(['#######', '#P.cSE#', '#######'], { chipsRequired: 1 }));
    expect(report.valid).toBe(true);
  });

  it('reports a socket bypass with its own key', () => {
    const level = grid(['#######', '#P.cSE#', '#.....#', '#######'], { chipsRequired: 1 });
    const found = keys(level);
    expect(found).toContain('validator.issues.socket_bypass.label');
    expect(found).not.toContain('validator.issues.unreachable_exit.label');
  });

  it('reports a start outside the grid without throwing', () => {
    const level = grid(['#####', '#.E.#', '#####']);
    level.playerStart = { x: 40, y: 40, dir: 'S' };
    const report = LevelValidator.validate(level);
    expect(report.valid).toBe(false);
    expect(report.issues.map((i) => i.i18nKey)).toContain('validator.issues.invalid_start.label');
  });

  it('accounts for a thief taking the boots', () => {
    expect(LevelValidator.validate(grid(['#######', '#Pb.WE#', '#######'])).valid).toBe(true);
    const robbed = LevelValidator.validate(grid(['#######', '#PbTWE#', '#######']));
    expect(robbed.valid).toBe(false);
    expect(robbed.stats.reachableExit).toBe(false);
  });

  it('keeps boots picked up after the thief', () => {
    expect(LevelValidator.validate(grid(['#######', '#PTbWE#', '#######'])).valid).toBe(true);
  });

  it('loses boots again when crossing back over the thief', () => {
    expect(LevelValidator.validate(grid(['#######', '#EWPTb#', '#######'])).valid).toBe(false);
  });

  it('follows a force floor instead of treating it as floor', () => {
    const level = grid(['######', '#PvE##', '##W###', '######']);
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(false);
  });

  it('rejects an ice slide that ends in fire', () => {
    const level = grid(['########', '#PIIFE##', '########']);
    expect(LevelValidator.validate(level).stats.reachableExit).toBe(false);
  });

  it('accepts an ice slide that ends on safe floor', () => {
    const level = grid(['########', '#PII.E##', '########']);
    expect(LevelValidator.validate(level).valid).toBe(true);
  });

  it('only counts cloned blocks when the cloner button is reachable', () => {
    const rows = ['#########', '#P.W.E###', '#########', '#R#M#####', '#########'];
    const cloneLinks: CloneLink[] = [
      { buttonX: 1, buttonY: 3, clonerX: 3, clonerY: 3, templateType: 'dirt_block', templateDir: 'S' }
    ];
    const entities: EntityPlacement[] = [{ x: 3, y: 3, type: 'dirt_block', dir: 'S' }];
    expect(LevelValidator.validate(grid(rows, { cloneLinks, entities })).valid).toBe(false);

    const reachable = [...rows];
    reachable[1] = '#P.W.E###';
    reachable[2] = '#.#######';
    expect(LevelValidator.validate(grid(reachable, { cloneLinks, entities })).valid).toBe(true);
  });
});

describe('ProceduralGenerator', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('is deterministic for a seed and puts the seed in the id', () => {
    const a = ProceduralGenerator.generateLevel(3, 1234);
    const b = ProceduralGenerator.generateLevel(3, 1234);
    expect(a).toEqual(b);
    expect(a.id.startsWith('proc_')).toBe(true);
  });

  it('only returns levels that validate', () => {
    const pack = ProceduralGenerator.generatePack(5, 42);
    expect(pack).toHaveLength(5);
    for (const level of pack) {
      expect(LevelValidator.validate(level).valid).toBe(true);
    }
  });

  it('falls back to a valid built-in level when generation keeps failing', () => {
    const bundle = loadTestConfigs();
    // A grid too small for the sector layout makes every attempt fail
    bundle.game.grid.mapWidth = 20;
    const level = ProceduralGenerator.generateLevel(1, 7);
    expect(level.id.startsWith('proc_fallback_')).toBe(true);
  });
});
