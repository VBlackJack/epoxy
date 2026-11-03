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
import { loadTestConfigs } from '../../test/loadTestConfigs';
import { LevelValidator } from '../LevelValidator';
import type { CompiledLevel, ValidationIssue } from '../types';
import { cc3dValidationReport, validateCc3dLevel } from './cc3dValidator';
import { deriveDisplayLayers } from './cc3dLayers';
import type { Cc3dCell, Cc3dLevel, Cc3dMob, Cc3dTerrain } from './model';

const WIDTH = 6;
const HEIGHT = 3;
const KEY_PREFIX = 'validator.issues.cc3d_';
const SUFFIX = '.label';

/** A valid level: exit at (5, 2), player at (0, 0). `put` replaces the whole stack of a cell. */
function levelWith(put: Record<string, Cc3dTerrain[]> = {}, mobs: Cc3dMob[] = []): Cc3dLevel {
  const cells: Cc3dCell[] = Array.from({ length: WIDTH * HEIGHT }, () => ({ terrain: [{ kind: 'floor' }], panels: [], item: null }));
  cells[WIDTH * HEIGHT - 1].terrain = [{ kind: 'exit' }];
  for (const [key, layers] of Object.entries(put)) {
    const [x, y] = key.split(',').map(Number);
    cells[y * WIDTH + x].terrain = layers;
  }
  return { width: WIDTH, height: HEIGHT, cells, mobs, player: { x: 0, y: 0, dir: 'S' } };
}

const keys = (issues: ValidationIssue[], severity?: 'error' | 'warning'): string[] =>
  issues.filter((i) => severity === undefined || i.severity === severity).map((i) => i.i18nKey.slice(KEY_PREFIX.length, -SUFFIX.length));

describe('validateCc3dLevel: valid levels', () => {
  it('accepts a minimal level without any issue', () => {
    expect(validateCc3dLevel(levelWith())).toEqual([]);
  });

  it('accepts a fully wired level', () => {
    const level = levelWith(
      {
        '1,0': [{ kind: 'floor' }, { kind: 'trap' }],
        '2,0': [{ kind: 'floor' }, { kind: 'trap_control' }],
        '3,0': [{ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' }],
        '4,0': [{ kind: 'floor' }, { kind: 'clone_switch' }],
        '1,1': [{ kind: 'teleport_blue' }],
        '2,1': [{ kind: 'teleport_blue' }],
        '0,2': [{ kind: 'floor' }, { kind: 'door', color: 'red' }]
      },
      [{ kind: 'walker', x: 3, y: 0, dir: 'E' }]
    );
    level.cells[1].item = { kind: 'key', color: 'red' };
    expect(validateCc3dLevel(level)).toEqual([]);
  });
});

describe('validateCc3dLevel: errors', () => {
  it('rejects a grid whose size does not match its cells', () => {
    const level = levelWith();
    level.cells.pop();
    expect(keys(validateCc3dLevel(level), 'error')).toEqual(['bad_grid']);
  });

  it('rejects an empty stack', () => {
    expect(keys(validateCc3dLevel(levelWith({ '1,1': [] })), 'error')).toContain('empty_stack');
  });

  it('rejects an unknown terrain kind', () => {
    const level = levelWith({ '1,1': [{ kind: 'floor' }, { kind: 'lava' } as unknown as Cc3dTerrain] });
    expect(keys(validateCc3dLevel(level), 'error')).toEqual(['unknown_terrain']);
  });

  it('rejects a base layer that is not floor-like', () => {
    expect(keys(validateCc3dLevel(levelWith({ '1,1': [{ kind: 'wall' }] })), 'error')).toEqual(['base_not_floor']);
    expect(keys(validateCc3dLevel(levelWith({ '1,1': [{ kind: 'trap' }, { kind: 'wall' }] })), 'error')).toEqual(['base_not_floor']);
  });

  it('rejects a stack out of class order or with a second floor', () => {
    const blockerFirst = levelWith({ '1,1': [{ kind: 'floor' }, { kind: 'wall' }, { kind: 'trap' }] });
    expect(keys(validateCc3dLevel(blockerFirst), 'error')).toEqual(['stack_order']);
    const twoFloors = levelWith({ '1,1': [{ kind: 'floor' }, { kind: 'water' }] });
    expect(keys(validateCc3dLevel(twoFloors), 'error')).toEqual(['stack_order']);
  });

  it('requires a colour on doors, toggles, hold doors, plates, keys and colour blocks', () => {
    for (const kind of ['door', 'toggle_door', 'toggle_control', 'hold_door', 'plate'] as const) {
      const level = levelWith({ '1,1': [{ kind: 'floor' }, { kind }] });
      expect(keys(validateCc3dLevel(level), 'error'), kind).toEqual(['missing_color']);
    }
    const key = levelWith();
    key.cells[1].item = { kind: 'key' };
    expect(keys(validateCc3dLevel(key), 'error')).toEqual(['missing_color']);
    const block = levelWith({}, [{ kind: 'block_color', x: 1, y: 1, dir: 'N' }]);
    expect(keys(validateCc3dLevel(block), 'error')).toEqual(['missing_color']);
  });

  it('requires a direction on force floors and on mobs, a corner on ice corners and a mirror on reflectors', () => {
    expect(keys(validateCc3dLevel(levelWith({ '1,1': [{ kind: 'force' }] })), 'error')).toEqual(['missing_dir']);
    const noDir = levelWith({}, [{ kind: 'walker', x: 1, y: 1 } as unknown as Cc3dMob]);
    expect(keys(validateCc3dLevel(noDir), 'error')).toEqual(['missing_dir']);
    expect(keys(validateCc3dLevel(levelWith({ '1,1': [{ kind: 'ice_corner' }] })), 'error')).toEqual(['missing_corner']);
    const mirror = levelWith({}, [{ kind: 'reflector', x: 1, y: 1, dir: 'N' }]);
    expect(keys(validateCc3dLevel(mirror), 'error')).toEqual(['missing_mirror']);
  });

  it('rejects values the display cannot map', () => {
    const badColour = levelWith({ '1,1': [{ kind: 'floor' }, { kind: 'door', color: 'pink' as never }] });
    expect(keys(validateCc3dLevel(badColour), 'error')).toEqual(['invalid_value']);
    const badCorner = levelWith({ '1,1': [{ kind: 'ice_corner', corner: ['N', 'S'] }] });
    expect(keys(validateCc3dLevel(badCorner), 'error')).toEqual(['invalid_value']);
    const goodCorner = levelWith({ '1,1': [{ kind: 'ice_corner', corner: ['S', 'E'] }] });
    expect(validateCc3dLevel(goodCorner)).toEqual([]);
    const badMirror = levelWith({}, [{ kind: 'reflector', x: 1, y: 1, dir: 'N', mirror: 'XX' }]);
    expect(keys(validateCc3dLevel(badMirror), 'error')).toEqual(['invalid_value']);
    const goodMirror = levelWith({}, [{ kind: 'reflector', x: 1, y: 1, dir: 'N', mirror: 'lu' }]);
    expect(validateCc3dLevel(goodMirror)).toEqual([]);
    const badPanels = levelWith();
    badPanels.cells[1].panels = ['N', 'N'];
    expect(keys(validateCc3dLevel(badPanels), 'error')).toEqual(['invalid_value']);
  });

  it('rejects unknown items and unknown mobs, including the runtime-only shot', () => {
    const item = levelWith();
    item.cells[1].item = { kind: 'gem' as never };
    expect(keys(validateCc3dLevel(item), 'error')).toEqual(['unknown_item']);
    expect(keys(validateCc3dLevel(levelWith({}, [{ kind: 'dragon' as never, x: 1, y: 1, dir: 'N' }])), 'error')).toEqual(['unknown_mob']);
    expect(keys(validateCc3dLevel(levelWith({}, [{ kind: 'shot', x: 1, y: 1, dir: 'N' }])), 'error')).toEqual(['unknown_mob']);
  });

  it('rejects a mob outside the grid and two mobs in one cell', () => {
    expect(keys(validateCc3dLevel(levelWith({}, [{ kind: 'walker', x: 9, y: 1, dir: 'N' }])), 'error')).toEqual(['mob_off_grid']);
    const two = levelWith({}, [
      { kind: 'walker', x: 1, y: 1, dir: 'N' },
      { kind: 'blinky', x: 1, y: 1, dir: 'N' }
    ]);
    expect(keys(validateCc3dLevel(two), 'error')).toEqual(['two_mobs']);
  });

  it('rejects a missing or misplaced player and a level without exit', () => {
    const none = levelWith();
    (none as { player?: unknown }).player = undefined;
    expect(keys(validateCc3dLevel(none), 'error')).toEqual(['no_player']);
    const off = levelWith();
    off.player = { x: 6, y: 0 };
    expect(keys(validateCc3dLevel(off), 'error')).toEqual(['player_off_grid']);
    const noExit = levelWith({ '5,2': [{ kind: 'floor' }] });
    expect(keys(validateCc3dLevel(noExit), 'error')).toEqual(['no_exit']);
  });

  it('does not report warnings while an error stands', () => {
    const level = levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'trap_control' }], '1,1': [{ kind: 'wall' }] });
    expect(keys(validateCc3dLevel(level))).toEqual(['base_not_floor']);
  });
});

describe('validateCc3dLevel: warnings', () => {
  const only = (level: Cc3dLevel): string[] => {
    const issues = validateCc3dLevel(level);
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    return keys(issues);
  };

  it('warns about a trap control without a trap', () => {
    expect(only(levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'trap_control' }] }))).toEqual(['trap_control_no_trap']);
  });

  it('warns about a clone switch without a machine and a machine without a template', () => {
    expect(only(levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'clone_switch' }] }))).toEqual(['clone_switch_no_machine']);
    expect(only(levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'clone_machine', dir: 'E' }] }))).toEqual(['machine_no_template']);
  });

  it('warns about a toggle control or a plate without a door of its colour', () => {
    const toggle = levelWith({
      '2,0': [{ kind: 'floor' }, { kind: 'toggle_control', color: 'red' }],
      '3,0': [{ kind: 'floor' }, { kind: 'toggle_door', color: 'blue' }]
    });
    expect(only(toggle)).toEqual(['toggle_control_no_door']);
    const plate = levelWith({
      '2,0': [{ kind: 'floor' }, { kind: 'plate', color: 'red' }],
      '3,0': [{ kind: 'floor' }, { kind: 'hold_door', color: 'red' }],
      '4,0': [{ kind: 'floor' }, { kind: 'plate', color: 'green' }]
    });
    expect(only(plate)).toEqual(['plate_no_door']);
  });

  it('warns once per colour, not once per control', () => {
    const level = levelWith({
      '1,1': [{ kind: 'floor' }, { kind: 'toggle_control', color: 'red' }],
      '2,1': [{ kind: 'floor' }, { kind: 'toggle_control', color: 'red' }],
      '3,1': [{ kind: 'floor' }, { kind: 'plate', color: 'blue' }],
      '4,1': [{ kind: 'floor' }, { kind: 'plate', color: 'blue' }]
    });
    const issues = validateCc3dLevel(level);
    expect(keys(issues)).toEqual(['toggle_control_no_door', 'plate_no_door']);
    expect(issues[0].params).toEqual({ x: 1, y: 1, color: 'red' });
  });

  it('warns about a golem control without a golem and a laser controller without a shooter', () => {
    expect(only(levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'golem_control_blue' }] }))).toEqual(['golem_control_no_golem']);
    const yellow = levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'golem_control_yellow' }] }, [{ kind: 'golem_blue', x: 3, y: 0, dir: 'E' }]);
    expect(only(yellow)).toEqual(['golem_control_no_golem']);
    expect(only(levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'laser_controller' }] }))).toEqual(['laser_controller_no_shooter']);
  });

  it('warns about a key colour without a door of that colour', () => {
    const level = levelWith({ '3,0': [{ kind: 'floor' }, { kind: 'door', color: 'blue' }] });
    level.cells[1].item = { kind: 'key', color: 'red' };
    level.cells[2].item = { kind: 'key', color: 'blue' };
    const issues = validateCc3dLevel(level);
    expect(keys(issues)).toEqual(['key_no_door']);
    expect(issues[0].params).toEqual({ color: 'red' });
  });

  it('warns about a single teleport of a colour, once per colour', () => {
    const level = levelWith({ '1,1': [{ kind: 'teleport_red' }], '2,1': [{ kind: 'teleport_blue' }], '3,1': [{ kind: 'teleport_blue' }] });
    const issues = validateCc3dLevel(level);
    expect(keys(issues)).toEqual(['single_teleport']);
    expect(issues[0].params).toEqual({ color: 'red' });
  });

  it('warns about a start on a closed blocker or a hazard, not on an open door', () => {
    const wall = levelWith({ '0,0': [{ kind: 'floor' }, { kind: 'wall' }] });
    expect(only(wall)).toEqual(['start_on_blocker']);
    const water = levelWith({ '0,0': [{ kind: 'water' }] });
    expect(only(water)).toEqual(['start_on_hazard']);
    const fire = levelWith({ '0,0': [{ kind: 'fire' }] });
    expect(only(fire)).toEqual(['start_on_hazard']);
    const open = levelWith({ '0,0': [{ kind: 'floor' }, { kind: 'toggle_door', color: 'red', open: true }] });
    expect(keys(validateCc3dLevel(open))).not.toContain('start_on_blocker');
  });
});

describe('cc3dValidationReport and LevelValidator', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  function compiled(cc3d: Cc3dLevel): CompiledLevel {
    const layers = deriveDisplayLayers(cc3d);
    return {
      id: 'test',
      ruleset: 'cc3d',
      cc3d,
      number: 1,
      password: 'AAAA',
      timeLimitSeconds: 0,
      chipsRequired: 1,
      playerStart: { x: 0, y: 0, dir: 'S' },
      terrain: layers.terrain,
      items: layers.items,
      entities: layers.entities,
      trapLinks: [],
      cloneLinks: []
    };
  }

  it('reports validity, counts and issues in the LevelValidator format', () => {
    const level = levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'trap_control' }] });
    level.cells[1].item = { kind: 'fish' };
    const report = cc3dValidationReport(compiled(level));
    expect(report.valid).toBe(true);
    expect(report.issues.map((i) => i.i18nKey)).toEqual(['validator.issues.cc3d_trap_control_no_trap.label']);
    expect(report.stats).toMatchObject({ chipsPlaced: 1, chipsRequired: 1, exitCount: 1 });
  });

  it('is invalid when an error stands', () => {
    const report = cc3dValidationReport(compiled(levelWith({ '5,2': [{ kind: 'floor' }] })));
    expect(report.valid).toBe(false);
    expect(report.issues[0]).toMatchObject({ severity: 'error', i18nKey: 'validator.issues.cc3d_no_exit.label' });
  });

  it('is what LevelValidator.validate returns for a cc3d level', () => {
    const level = compiled(levelWith({ '2,0': [{ kind: 'floor' }, { kind: 'laser_controller' }] }));
    expect(LevelValidator.validate(level)).toEqual(cc3dValidationReport(level));
  });
});
