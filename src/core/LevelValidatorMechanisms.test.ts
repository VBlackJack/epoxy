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
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import { CompiledLevel, EntityPlacement, ValidationIssue } from './types';

const WIDTH = 9;
const HEIGHT = 5;
const EXIT = { x: 7, y: 3 };
const PREFIX = 'validator.issues.';

const KEY_STEERING_NO_PUPPET = `${PREFIX}steering_pad_no_puppet.label`;
const KEY_PUPPET_NO_STEERING = `${PREFIX}puppet_no_steering_pad.label`;
const KEY_TRAP_BUTTON = `${PREFIX}trap_button_no_trap.label`;
const KEY_HOLD_DOOR = `${PREFIX}hold_door_no_plate.label`;
const KEY_CHANNEL_WALLS = `${PREFIX}channel_walls_no_button.label`;
const KEY_TRAP_NO_BUTTON = `${PREFIX}trap_no_button.label`;
const KEY_TELEPORT = `${PREFIX}teleport_alone.label`;
const KEY_TELEPORT_PLAIN = `${PREFIX}teleport_alone_plain.label`;
const KEY_GATE = `${PREFIX}laser_gate_no_receiver.label`;
const KEY_JETS = `${PREFIX}flame_jets_no_button.label`;
const KEY_SWIVEL = `${PREFIX}swivel_sealed.label`;

/** A walled room with the player at (1, 1) and an exit; setup writes into the terrain. */
function room(setup: (level: CompiledLevel) => void = () => {}): CompiledLevel {
  const terrain: string[][] = Array.from({ length: HEIGHT }, (_row, y) =>
    Array.from({ length: WIDTH }, (_cell, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  terrain[EXIT.y][EXIT.x] = 'exit';
  const level: CompiledLevel = {
    id: 'mechanisms',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: []
  };
  setup(level);
  return level;
}

const issuesOf = (level: CompiledLevel, key: string): ValidationIssue[] =>
  LevelValidator.validate(level).issues.filter((issue) => issue.i18nKey === key);

const hasKey = (level: CompiledLevel, key: string): boolean => issuesOf(level, key).length > 0;

const entity = (type: string, x: number, y: number): EntityPlacement => ({ type, x, y, dir: 'E' });

/** Every x, y and count param must be an in-grid integer (x, y) or a positive integer (count). */
function expectInGridParams(issue: ValidationIssue): void {
  const { x, y, count } = issue.params ?? {};
  expect(Number.isInteger(x) && (x as number) >= 0 && (x as number) < WIDTH).toBe(true);
  expect(Number.isInteger(y) && (y as number) >= 0 && (y as number) < HEIGHT).toBe(true);
  expect(Number.isInteger(count) && (count as number) >= 1).toBe(true);
}

describe('validator locations on existing checks', () => {
  beforeEach(() => loadTestConfigs());

  it('locates the first Puppet Control in row-major order and counts them', () => {
    const level = room((l) => {
      l.terrain[3][2] = 'puppet_control';
      l.terrain[1][5] = 'puppet_control';
      l.terrain[1][4] = 'puppet_control';
    });
    const [issue] = issuesOf(level, KEY_STEERING_NO_PUPPET);
    expect(issue.params).toEqual({ x: 4, y: 1, count: 3 });
  });

  it('counts a Puppet Control under a removable top at its cell', () => {
    const level = room((l) => {
      l.terrain[2][3] = 'door_red';
      l.underlays = [{ x: 3, y: 2, terrain: 'puppet_control' }];
    });
    const [issue] = issuesOf(level, KEY_STEERING_NO_PUPPET);
    expect(issue.params).toEqual({ x: 3, y: 2, count: 1 });
  });

  it('stays silent when a puppet exists', () => {
    const level = room((l) => {
      l.terrain[1][4] = 'puppet_control';
      l.entities = [entity('puppet', 6, 3)];
    });
    expect(hasKey(level, KEY_STEERING_NO_PUPPET)).toBe(false);
    expect(hasKey(level, KEY_PUPPET_NO_STEERING)).toBe(false);
  });

  it('locates a puppet with no control, and a cloned template at its machine', () => {
    const placed = room((l) => {
      l.entities = [entity('puppet', 6, 3), entity('puppet', 5, 2)];
    });
    expect(issuesOf(placed, KEY_PUPPET_NO_STEERING)[0].params).toEqual({ x: 5, y: 2, count: 2 });
    const cloned = room((l) => {
      l.terrain[3][3] = 'clone_machine';
      l.terrain[1][3] = 'button_red';
      l.cloneLinks = [{ buttonX: 3, buttonY: 1, clonerX: 3, clonerY: 3, templateType: 'puppet', templateDir: 'E' }];
    });
    expect(issuesOf(cloned, KEY_PUPPET_NO_STEERING)[0].params).toEqual({ x: 3, y: 3, count: 1 });
  });

  it('locates brown buttons when the level has no trap', () => {
    const level = room((l) => {
      l.terrain[3][2] = 'button_brown';
      l.terrain[2][6] = 'button_brown';
    });
    expect(issuesOf(level, KEY_TRAP_BUTTON)[0].params).toEqual({ x: 6, y: 2, count: 2 });
  });

  it('locates a hold door with no plate, hidden doors included', () => {
    const plain = room((l) => {
      l.terrain[3][4] = 'hold_door_red_closed';
      l.terrain[2][5] = 'hold_door_red_closed';
    });
    expect(issuesOf(plain, KEY_HOLD_DOOR)[0].params).toMatchObject({ x: 5, y: 2, count: 2 });
    const hidden = room((l) => {
      l.terrain[2][3] = 'door_red';
      l.underlays = [{ x: 3, y: 2, terrain: 'hold_door_blue_closed' }];
    });
    expect(issuesOf(hidden, KEY_HOLD_DOOR)[0].params).toMatchObject({ x: 3, y: 2, count: 1 });
    const mixed = room((l) => {
      l.terrain[1][6] = 'hold_door_red_closed';
      l.terrain[2][3] = 'door_red';
      l.underlays = [{ x: 3, y: 2, terrain: 'hold_door_red_closed' }];
    });
    expect(issuesOf(mixed, KEY_HOLD_DOOR)).toHaveLength(1);
    expect(issuesOf(mixed, KEY_HOLD_DOOR)[0].params).toMatchObject({ x: 6, y: 1, count: 2 });
  });

  it('stays silent for a hold door with a plate', () => {
    const level = room((l) => {
      l.terrain[3][4] = 'hold_door_red_closed';
      l.terrain[1][3] = 'pressure_plate_red';
    });
    expect(hasKey(level, KEY_HOLD_DOOR)).toBe(false);
  });

  it('locates toggle walls with no button, and stays silent with one', () => {
    const level = room((l) => {
      l.terrain[3][2] = 'toggle_wall_red_closed';
      l.terrain[2][6] = 'toggle_wall_red_open';
    });
    expect(issuesOf(level, KEY_CHANNEL_WALLS)[0].params).toMatchObject({ x: 6, y: 2, count: 2 });
    level.terrain[1][3] = 'toggle_button_red';
    expect(hasKey(level, KEY_CHANNEL_WALLS)).toBe(false);
  });

  it('keeps every param an in-grid integer', () => {
    const level = room((l) => {
      l.terrain[1][4] = 'puppet_control';
      l.terrain[3][2] = 'button_brown';
      l.terrain[2][5] = 'hold_door_red_closed';
      l.terrain[2][6] = 'toggle_wall_blue_closed';
    });
    for (const key of [KEY_STEERING_NO_PUPPET, KEY_TRAP_BUTTON, KEY_HOLD_DOOR, KEY_CHANNEL_WALLS]) {
      const issues = issuesOf(level, key);
      expect(issues.length, key).toBeGreaterThan(0);
      issues.forEach(expectInGridParams);
    }
  });
});

describe('validator mechanism checks', () => {
  beforeEach(() => loadTestConfigs());

  it('flags a trap with no brown button, hidden or not', () => {
    const level = room((l) => {
      l.terrain[3][2] = 'trap';
      l.terrain[2][5] = 'trap';
    });
    const [issue] = issuesOf(level, KEY_TRAP_NO_BUTTON);
    expect(issue.severity).toBe('info');
    expect(issue.params).toEqual({ x: 5, y: 2, count: 2 });
    level.terrain[1][4] = 'button_brown';
    expect(hasKey(level, KEY_TRAP_NO_BUTTON)).toBe(false);
    const hiddenButton = room((l) => {
      l.terrain[3][2] = 'trap';
      l.terrain[1][4] = 'door_red';
      l.underlays = [{ x: 4, y: 1, terrain: 'button_brown' }];
    });
    expect(hasKey(hiddenButton, KEY_TRAP_NO_BUTTON)).toBe(false);
    const hiddenTrap = room((l) => {
      l.terrain[1][4] = 'door_red';
      l.underlays = [{ x: 4, y: 1, terrain: 'trap' }];
    });
    expect(issuesOf(hiddenTrap, KEY_TRAP_NO_BUTTON)[0].params).toEqual({ x: 4, y: 1, count: 1 });
  });

  it('flags a lone coloured teleporter and a lone plain one', () => {
    const level = room((l) => {
      l.terrain[2][3] = 'teleport_red';
      l.terrain[1][5] = 'teleport';
    });
    const [coloured] = issuesOf(level, KEY_TELEPORT);
    expect(coloured.severity).toBe('warning');
    expect(coloured.params).toMatchObject({ x: 3, y: 2, count: 1 });
    expectInGridParams(coloured);
    const [plain] = issuesOf(level, KEY_TELEPORT_PLAIN);
    expect(plain.severity).toBe('warning');
    expect(plain.params).toEqual({ x: 5, y: 1, count: 1 });
  });

  it('stays silent for teleporters in pairs, and counts a hidden one', () => {
    const pair = room((l) => {
      l.terrain[2][3] = 'teleport_red';
      l.terrain[2][5] = 'teleport_red';
      l.terrain[1][2] = 'teleport';
      l.terrain[3][6] = 'teleport';
    });
    expect(hasKey(pair, KEY_TELEPORT)).toBe(false);
    expect(hasKey(pair, KEY_TELEPORT_PLAIN)).toBe(false);
    const hiddenMate = room((l) => {
      l.terrain[2][3] = 'teleport_blue';
      l.terrain[2][5] = 'door_red';
      l.underlays = [{ x: 5, y: 2, terrain: 'teleport_blue' }];
    });
    expect(hasKey(hiddenMate, KEY_TELEPORT)).toBe(false);
    const hiddenLone = room((l) => {
      l.terrain[2][5] = 'door_red';
      l.underlays = [{ x: 5, y: 2, terrain: 'teleport_green' }];
    });
    expect(issuesOf(hiddenLone, KEY_TELEPORT)[0].params).toMatchObject({ x: 5, y: 2 });
  });

  it('flags a laser gate with no receiver, with or without an emitter', () => {
    const noEmitter = room((l) => {
      l.terrain[2][3] = 'laser_gate_red_closed';
      l.terrain[3][5] = 'laser_gate_red_open';
    });
    const [issue] = issuesOf(noEmitter, KEY_GATE);
    expect(issue.severity).toBe('warning');
    expect(issue.params).toMatchObject({ x: 3, y: 2, count: 2, group: 'red' });
    const withEmitter = room((l) => {
      l.terrain[2][3] = 'laser_gate_red_closed';
      l.terrain[1][2] = 'laser_emitter_e';
    });
    expect(hasKey(withEmitter, KEY_GATE)).toBe(true);
  });

  it('stays silent when the gate group has a receiver, even under an underlay', () => {
    const plain = room((l) => {
      l.terrain[2][3] = 'laser_gate_red_closed';
      l.terrain[3][5] = 'laser_receiver_red';
    });
    expect(hasKey(plain, KEY_GATE)).toBe(false);
    const hidden = room((l) => {
      l.terrain[2][3] = 'laser_gate_blue_closed';
      l.terrain[3][5] = 'door_red';
      l.underlays = [{ x: 5, y: 3, terrain: 'laser_receiver_blue' }];
    });
    expect(hasKey(hidden, KEY_GATE)).toBe(false);
    const otherGroup = room((l) => {
      l.terrain[2][3] = 'laser_gate_blue_closed';
      l.terrain[3][5] = 'laser_receiver_red';
    });
    expect(hasKey(otherGroup, KEY_GATE)).toBe(true);
  });

  it('flags flame jets with no orange button', () => {
    const level = room((l) => {
      l.terrain[3][2] = 'flame_jet_off';
      l.terrain[2][5] = 'flame_jet_on';
    });
    const [issue] = issuesOf(level, KEY_JETS);
    expect(issue.severity).toBe('info');
    expect(issue.params).toEqual({ x: 5, y: 2, count: 2 });
    level.terrain[1][4] = 'button_orange';
    expect(hasKey(level, KEY_JETS)).toBe(false);
    const hiddenButton = room((l) => {
      l.terrain[3][2] = 'flame_jet_on';
      l.terrain[1][4] = 'door_red';
      l.underlays = [{ x: 4, y: 1, terrain: 'button_orange' }];
    });
    expect(hasKey(hiddenButton, KEY_JETS)).toBe(false);
  });

  describe('sealed swivel doors', () => {
    /** swivel_door_ne is closed north and east, so it opens south and west. */
    const SWIVEL = 'swivel_door_ne';
    const withSwivel = (x: number, y: number, setup: (l: CompiledLevel) => void = () => {}): CompiledLevel =>
      room((l) => {
        l.terrain[y][x] = SWIVEL;
        setup(l);
      });

    it('flags a swivel whose open sides face walls or the map edge', () => {
      const level = withSwivel(1, 3);
      const [issue] = issuesOf(level, KEY_SWIVEL);
      expect(issue.severity).toBe('info');
      expect(issue.params).toEqual({ x: 1, y: 3, count: 1 });
    });

    it('stays silent when an open side faces floor', () => {
      expect(hasKey(withSwivel(2, 3), KEY_SWIVEL)).toBe(false);
      expect(hasKey(withSwivel(1, 2), KEY_SWIVEL)).toBe(false);
    });

    it('counts thin edges from the mask and from thin wall tiles', () => {
      const viaMask = withSwivel(2, 3, (l) => {
        l.cellEdges = [
          { x: 2, y: 3, sides: ['W'] },
          { x: 2, y: 4, sides: ['N'] }
        ];
      });
      expect(hasKey(viaMask, KEY_SWIVEL)).toBe(true);
      const viaTile = withSwivel(2, 3, (l) => {
        l.terrain[3][1] = 'thin_wall_e';
      });
      expect(hasKey(viaTile, KEY_SWIVEL)).toBe(true);
      const wrongSide = withSwivel(2, 3, (l) => {
        l.terrain[3][1] = 'thin_wall_n';
      });
      expect(hasKey(wrongSide, KEY_SWIVEL)).toBe(false);
    });

    it('counts emitters and receivers as sealing, but not doors, machines or other swivels', () => {
      const solid = withSwivel(2, 3, (l) => {
        l.terrain[3][1] = 'laser_emitter_n';
        l.terrain[4][2] = 'laser_receiver_red';
      });
      expect(hasKey(solid, KEY_SWIVEL)).toBe(true);
      for (const id of ['door_red', 'clone_machine', 'toggle_wall_closed', 'swivel_door_sw']) {
        const level = withSwivel(2, 3, (l) => {
          l.terrain[3][1] = id;
        });
        expect(hasKey(level, KEY_SWIVEL), id).toBe(false);
      }
    });

    it('does not count a neighbour that hides an underlay', () => {
      const level = withSwivel(2, 3, (l) => {
        l.terrain[3][1] = 'door_red';
        l.underlays = [{ x: 1, y: 3, terrain: 'floor' }];
      });
      expect(hasKey(level, KEY_SWIVEL)).toBe(false);
    });
  });

  it('skips Lynx and CC3D levels', () => {
    for (const ruleset of ['lynx', 'cc3d'] as const) {
      const level = room((l) => {
        l.ruleset = ruleset;
        l.terrain[3][2] = 'trap';
        l.terrain[2][3] = 'teleport_red';
        l.terrain[2][4] = 'laser_gate_red_closed';
        l.terrain[3][5] = 'flame_jet_on';
        l.terrain[3][1] = 'swivel_door_ne';
      });
      const keys = LevelValidator.validate(level).issues.map((issue) => issue.i18nKey);
      for (const key of [KEY_TRAP_NO_BUTTON, KEY_TELEPORT, KEY_GATE, KEY_JETS, KEY_SWIVEL]) {
        expect(keys, `${ruleset} ${key}`).not.toContain(key);
      }
    }
  });
});
