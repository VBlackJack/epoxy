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
import { storedSolutionWins } from '../generator/SolutionReplay';
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
  X: 'forbid_key_red',
  e: 'thin_wall_e',
  n: 'thin_wall_n',
  Y: 'door_yellow',
  H: 'hint'
};
const ITEM_CODES: Record<string, { terrain: string; item: string }> = {
  c: { terrain: 'floor', item: 'chip' },
  b: { terrain: 'floor', item: 'boots_water' },
  r: { terrain: 'floor', item: 'key_red' },
  y: { terrain: 'floor', item: 'key_yellow' }
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

/** Fetch the red key, come back, then take the south door to the exit. */
const WINNING_TRAP_SOLUTION = 'EWSSS';

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

  describe('socket bypass', () => {
    const BYPASS = 'validator.issues.socket_bypass.label';

    it('ignores a detour that a thin wall closes', () => {
      // The lower corridor would reach the exit, but the thin wall stops it east of its third cell.
      const level = grid(['#######', '#P.cSE#', '#..e..#', '#######'], { chipsRequired: 1 });
      expect(keys(level)).not.toContain(BYPASS);
      expect(LevelValidator.validate(level).valid).toBe(true);
    });

    it('still reports a bypass past a thin wall that does not face the route', () => {
      const level = grid(['#######', '#P.cSE#', '#..n..#', '#######'], { chipsRequired: 1 });
      expect(keys(level)).toContain(BYPASS);
    });

    it('does not count a door whose key lies behind the socket', () => {
      const level = grid(['########', '#P.cSr##', '#...DE##', '########'], { chipsRequired: 1 });
      expect(keys(level)).not.toContain(BYPASS);
      expect(LevelValidator.validate(level).valid).toBe(true);
    });

    it('reports a bypass through a door whose key is reachable without the socket', () => {
      const level = grid(['########', '#P.cS###', '#r..DE##', '########'], { chipsRequired: 1 });
      expect(keys(level)).toContain(BYPASS);
    });

    it('reports a bypass through a flame jet the player can switch off', () => {
      // No boots and no block: the lit jet is deadly to walk, but the orange button turns it off.
      const level = grid(['#######', '#P.cSE#', '#O.J..#', '#######'], { chipsRequired: 1 });
      expect(keys(level)).toContain(BYPASS);
    });

    it('does not count a bypass through a fire with no boots and no block', () => {
      const level = grid(['#######', '#P.cSE#', '#..F..#', '#######'], { chipsRequired: 1 });
      expect(keys(level)).not.toContain(BYPASS);
    });

    it('keeps hazards walkable when a clone link templates a block', () => {
      const rows = ['#######', '#P.cSE#', '#R.W..#', '#######'];
      const cloneLinks: CloneLink[] = [
        { buttonX: 1, buttonY: 2, clonerX: 5, clonerY: 2, templateType: 'dirt_block', templateDir: 'S' }
      ];
      expect(keys(grid(rows, { chipsRequired: 1 }))).not.toContain(BYPASS);
      expect(keys(grid(rows, { chipsRequired: 1, cloneLinks }))).toContain(BYPASS);
    });
  });

  describe('key order trap', () => {
    // Two red doors, one reachable red key (the other is walled in): the north room holds a yellow key that opens only a dead-end yellow door, the south door leads to the exit.
    const trap = (solution?: string): CompiledLevel => {
      const level = grid(['#####', '#yY.#', '#D###', '#Pr.#', '#D###', '#E#r#', '#####']);
      if (solution !== undefined) level.solution = solution;
      return level;
    };
    const UNREACHABLE = 'validator.issues.unreachable_exit.label';
    const PROVEN = 'validator.issues.unreachable_exit_proven.label';

    it('finds the south door by retrying the other door order, with no stored solution', () => {
      const report = LevelValidator.validate(trap());
      expect(report.valid).toBe(true);
      expect(report.stats.reachableExit).toBe(true);
      const found = report.issues.map((i) => i.i18nKey);
      expect(found).not.toContain(UNREACHABLE);
      expect(found).not.toContain(PROVEN);
    });

    it('needs no stored solution to be valid, and a winning one changes nothing', () => {
      const report = LevelValidator.validate(trap(WINNING_TRAP_SOLUTION), storedSolutionWins);
      expect(report.valid).toBe(true);
      expect(report.issues.map((i) => i.i18nKey)).not.toContain(PROVEN);
    });

    it('keeps the greedy verdict when the door order search is off', () => {
      const report = LevelValidator.validate(trap(), undefined, { doorOrderSearch: false });
      expect(report.valid).toBe(false);
      expect(report.issues.map((i) => i.i18nKey)).toContain(UNREACHABLE);
    });
  });

  describe('a miss no door order explains', () => {
    // The thief west of the start is not on the way, but the walk assumes it is crossed: it takes the red key
    // fetched first, so the door two cells on never opens. No door order changes that (the door is not scarce).
    const thiefTrap = (solution?: string): CompiledLevel => {
      const level = grid(['#KPr.DE#']);
      if (solution !== undefined) level.solution = solution;
      return level;
    };
    const UNREACHABLE = 'validator.issues.unreachable_exit.label';
    const PROVEN = 'validator.issues.unreachable_exit_proven.label';
    /** Fetch the red key and walk east through the door to the exit, never stepping on the thief. */
    const WINNING_SOLUTION = 'EEEE';

    it('errors when no solution proves the level', () => {
      const report = LevelValidator.validate(thiefTrap());
      expect(report.valid).toBe(false);
      expect(report.issues.map((i) => i.i18nKey)).toContain(UNREACHABLE);
    });

    it('only warns when the stored solution wins', () => {
      const report = LevelValidator.validate(thiefTrap(WINNING_SOLUTION), storedSolutionWins);
      expect(report.valid).toBe(true);
      const found = report.issues.find((i) => i.i18nKey === PROVEN);
      expect(found?.severity).toBe('warning');
      expect(report.issues.map((i) => i.i18nKey)).not.toContain(UNREACHABLE);
    });

    it('keeps the error when the stored solution does not win', () => {
      const report = LevelValidator.validate(thiefTrap('EEE'), storedSolutionWins);
      expect(report.valid).toBe(false);
      expect(report.issues.map((i) => i.i18nKey)).toContain(UNREACHABLE);
    });
  });

  describe('key scarcity', () => {
    // One red door leads nowhere, the other holds the second key and the exit: the spare key must go to the second.
    const rooms = (rows: string[]): boolean => LevelValidator.validate(grid(rows)).valid;

    it('opens the rewarding door first with no stored solution (dead end north)', () => {
      expect(rooms(['#####', '#...#', '#D###', '#Pr.#', '#D###', '#Er.#', '#####'])).toBe(true);
    });

    it('opens the rewarding door first with no stored solution (dead end south)', () => {
      expect(rooms(['#####', '#Er.#', '#D###', '#Pr.#', '#D###', '#...#', '#####'])).toBe(true);
    });

    it('opens every door of a long corridor when the keys cover them', () => {
      const doors = 90;
      const row = `#P${'r'.repeat(doors)}${'D'.repeat(doors)}E#`;
      const wall = '#'.repeat(row.length);
      expect(rooms([wall, row, wall])).toBe(true);
    });
  });

  describe('items hidden by pushable blocks', () => {
    const HIDDEN = 'validator.issues.hidden_by_block.label';
    const block: EntityPlacement = { type: 'dirt_block', x: 2, y: 1, dir: 'S' };

    it('warns about a chip on a cell a block can reach', () => {
      const level = grid(['#######', '#P.c.E#', '#######'], { entities: [block] });
      const issue = LevelValidator.validate(level).issues.find((i) => i.i18nKey === HIDDEN);
      expect(issue?.severity).toBe('warning');
      expect(issue?.params).toEqual({ count: 1 });
    });

    it('warns about a hint tile on a cell a block can reach', () => {
      expect(keys(grid(['#######', '#P.H.E#', '#######'], { entities: [block] }))).toContain(HIDDEN);
    });

    it('stays silent when a wall cuts the block off from the item', () => {
      expect(keys(grid(['########', '#P.#cE.#', '########'], { entities: [block] }))).not.toContain(HIDDEN);
    });

    it('stays silent for an item behind a water moat, since the block sinks there', () => {
      expect(keys(grid(['########', '#P.Wc.E#', '########'], { entities: [block] }))).not.toContain(HIDDEN);
    });

    it('stays silent where the block type refuses the hazard', () => {
      const mirror: EntityPlacement = { type: 'mirror_slash', x: 2, y: 1, dir: 'S' };
      expect(keys(grid(['########', '#P.Wc.E#', '########'], { entities: [mirror] }))).not.toContain(HIDDEN);
    });

    it('ignores a bomb lying in reach, which is not collectible', () => {
      const level = grid(['#######', '#P.c.E#', '#######'], { entities: [block] });
      level.items[1][3] = 'bomb';
      expect(keys(level)).not.toContain(HIDDEN);
    });

    it('stays silent for a chip in a side pocket no push can send a block into', () => {
      // A wall lies below the pocket, so nobody can stand there to push the block up into it.
      const level = grid(['###c###', '#P...E#', '#######'], { entities: [block] });
      expect(keys(level)).not.toContain(HIDDEN);
    });

    it('still warns for a chip in a pocket that has room below it for the pusher', () => {
      const level = grid(['###c###', '#P...E#', '#.....#', '#######'], { entities: [{ ...block, x: 3, y: 1 }] });
      expect(keys(level)).toContain(HIDDEN);
    });

    it('still warns for a chip in the straight push line of the block', () => {
      expect(keys(grid(['#######', '#P.c..#', '#######'], { entities: [block] }))).toContain(HIDDEN);
    });

    it('still warns when the pusher would stand in a doorway', () => {
      const level = grid(['###c###', '#P...E#', '###D###', '#######'], { entities: [{ ...block, x: 3, y: 1 }] });
      expect(keys(level)).toContain(HIDDEN);
    });

    it('stays silent when the cell behind the block is a blue wall that stays solid', () => {
      const level = grid(['###c###', '#P...E#', '#######'], { entities: [block] });
      level.terrain[2][3] = 'blue_wall_real';
      expect(keys(level)).not.toContain(HIDDEN);
    });

    it('stays silent without any block', () => {
      expect(keys(grid(['#######', '#P.cHE#', '#######']))).not.toContain(HIDDEN);
    });
  });

  describe('info about buttons with no effect', () => {
    const TRAP_KEY = 'validator.issues.trap_button_no_trap.label';
    const CLONE_KEY = 'validator.issues.clone_button_nothing.label';
    const BUTTON_X = 2;
    const OTHER_X = 4;
    const infoKeys = (level: CompiledLevel): string[] =>
      LevelValidator.validate(level).issues.filter((i) => i.severity === 'info').map((i) => i.i18nKey);
    const base = (): CompiledLevel => grid(['#######', '#P.E..#', '#######']);

    it('flags a brown button when the level has no trap', () => {
      const level = base();
      level.terrain[1][BUTTON_X] = 'button_brown';
      expect(infoKeys(level)).toContain(TRAP_KEY);
      expect(LevelValidator.validate(level).valid).toBe(true);
    });

    it('stays silent when a trap exists, hidden or not', () => {
      const level = base();
      level.terrain[1][BUTTON_X] = 'button_brown';
      level.terrain[1][OTHER_X] = 'trap';
      expect(infoKeys(level)).not.toContain(TRAP_KEY);
    });

    it('flags a red button with no link and no loaded machine', () => {
      const level = base();
      level.terrain[1][BUTTON_X] = 'button_red';
      expect(infoKeys(level)).toContain(CLONE_KEY);
      expect(LevelValidator.validate(level).valid).toBe(true);
    });

    it('stays silent for a red button with a link', () => {
      const level = base();
      level.terrain[1][BUTTON_X] = 'button_red';
      level.terrain[1][OTHER_X] = 'clone_machine';
      level.cloneLinks = [{ buttonX: BUTTON_X, buttonY: 1, clonerX: OTHER_X, clonerY: 1, templateType: 'dirt_block', templateDir: 'S' }];
      expect(infoKeys(level)).not.toContain(CLONE_KEY);
    });

    it('stays silent for a red button when a machine holds a template', () => {
      const level = base();
      level.terrain[1][BUTTON_X] = 'button_red';
      level.terrain[1][OTHER_X] = 'clone_machine';
      level.entities = [{ type: 'dirt_block', x: OTHER_X, y: 1, dir: 'S' }];
      expect(infoKeys(level)).not.toContain(CLONE_KEY);
    });

    it('does not apply to Lynx levels', () => {
      const level = base();
      level.ruleset = 'lynx';
      level.terrain[1][BUTTON_X] = 'button_brown';
      level.terrain[1][OTHER_X] = 'button_red';
      expect(infoKeys(level)).toEqual([]);
    });
  });
});
