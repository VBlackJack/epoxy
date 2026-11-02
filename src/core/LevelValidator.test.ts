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
  L: 'slime',
  F: 'fire',
  I: 'ice',
  v: 'force_s',
  R: 'button_red',
  M: 'clone_machine',
  O: 'button_orange',
  J: 'flame_jet_on',
  j: 'flame_jet_off',
  K: 'thief_keys',
  D: 'door_red',
  X: 'forbid_key_red'
};
const ITEM_CODES: Record<string, { terrain: string; item: string }> = {
  c: { terrain: 'floor', item: 'chip' },
  b: { terrain: 'floor', item: 'boots_water' },
  r: { terrain: 'floor', item: 'key_red' }
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

  it('accepts an exit behind a lit flame jet when the orange button is reachable', () => {
    expect(LevelValidator.validate(grid(['#######', '#P.JE.#', '#######'])).valid).toBe(false);
    const withButton = LevelValidator.validate(grid(['#######', '#PO.JE#', '#######']));
    expect(withButton.valid).toBe(true);
    expect(withButton.stats.reachableExit).toBe(true);
    // An off jet stays passable: the button is never forced.
    expect(LevelValidator.validate(grid(['#######', '#POjE.#', '#######'])).valid).toBe(true);
  });

  it('blocks the way at slime until a block can be pushed into it', () => {
    expect(LevelValidator.validate(grid(['#######', '#P.LE.#', '#######'])).valid).toBe(false);
    const withBlock = grid(['########', '#P..LE.#', '########'], {
      entities: [{ x: 3, y: 1, type: 'dirt_block', dir: 'E' }]
    });
    expect(LevelValidator.validate(withBlock).valid).toBe(true);
  });

  it('loses the keys to a reachable key thief', () => {
    expect(LevelValidator.validate(grid(['#######', '#Pr.DE#', '#######'])).valid).toBe(true);
    const robbed = LevelValidator.validate(grid(['#######', '#PrKDE#', '#######']));
    expect(robbed.valid).toBe(false);
    expect(robbed.stats.reachableExit).toBe(false);
  });

  it('does not rob a key picked up after the thief again on a later pass', () => {
    // The key lies on a spur reached after the door was first tried, so the door only opens on the
    // second pass. The thief next to the start must not strip the key then: the player never crosses it.
    const level = grid(['#######', '#ED.PK#', '####.r#', '#######']);
    const report = LevelValidator.validate(level);
    expect(report.stats.reachableExit).toBe(true);
    expect(report.valid).toBe(true);
  });

  it('keeps a barrier against a held key passable, since the key can be put down', () => {
    expect(LevelValidator.validate(grid(['#######', '#PrXE.#', '#######'])).valid).toBe(true);
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

  describe('link and start warnings', () => {
    const warns = (level: CompiledLevel, key: string): boolean =>
      LevelValidator.validate(level).issues.some((i) => i.i18nKey === key && i.severity === 'warning');

    it('warns about a trap link whose button or trap is gone, without invalidating the level', () => {
      const level = grid(['#######', '#P.E..#', '#######']);
      level.trapLinks = [{ buttonX: 2, buttonY: 1, trapX: 4, trapY: 1 }];
      expect(warns(level, 'validator.issues.trap_link_button.label')).toBe(true);
      expect(warns(level, 'validator.issues.trap_link_target.label')).toBe(true);
      expect(LevelValidator.validate(level).valid).toBe(true);
    });

    it('accepts a trap link between a brown button and a trap', () => {
      const level = grid(['#######', '#P.E..#', '#######']);
      level.terrain[1][2] = 'button_brown';
      level.terrain[1][4] = 'trap';
      level.trapLinks = [{ buttonX: 2, buttonY: 1, trapX: 4, trapY: 1 }];
      const found = keys(level);
      expect(found).not.toContain('validator.issues.trap_link_button.label');
      expect(found).not.toContain('validator.issues.trap_link_target.label');
    });

    it('warns about a clone link whose button or cloner is gone', () => {
      const level = grid(['#######', '#P.E..#', '#######']);
      level.cloneLinks = [
        { buttonX: 2, buttonY: 1, clonerX: 4, clonerY: 1, templateType: 'dirt_block', templateDir: 'S' }
      ];
      expect(warns(level, 'validator.issues.clone_link_button.label')).toBe(true);
      expect(warns(level, 'validator.issues.clone_link_target.label')).toBe(true);
    });

    it('accepts a clone link between a red button and a clone machine', () => {
      const level = grid(['#######', '#PRE.M#', '#######']);
      level.cloneLinks = [
        { buttonX: 2, buttonY: 1, clonerX: 5, clonerY: 1, templateType: 'dirt_block', templateDir: 'S' }
      ];
      const found = keys(level);
      expect(found).not.toContain('validator.issues.clone_link_button.label');
      expect(found).not.toContain('validator.issues.clone_link_target.label');
    });

    it('warns when the player starts on a wall or on an entity', () => {
      const onWall = grid(['#####', '#P.E#', '#####']);
      onWall.terrain[1][1] = 'wall';
      expect(warns(onWall, 'validator.issues.start_on_wall.label')).toBe(true);
      const onEntity = grid(['#####', '#P.E#', '#####'], { entities: [{ x: 1, y: 1, type: 'dirt_block', dir: 'S' }] });
      expect(warns(onEntity, 'validator.issues.start_on_entity.label')).toBe(true);
      expect(keys(grid(['#####', '#P.E#', '#####']))).not.toContain('validator.issues.start_on_wall.label');
    });
  });
});
