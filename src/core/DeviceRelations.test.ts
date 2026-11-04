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
import { loadTestConfigs } from '../test/loadTestConfigs';
import laserShowcase from '../test/fixtures/laserShowcase.json';
import mechanicsShowcase from '../test/fixtures/mechanicsShowcase.json';
import { DeviceRole, deviceRelations, isDeviceCell } from './DeviceRelations';
import { CompiledLevel, LevelBlueprint } from './types';

const LEVEL_WIDTH = 8;
const LEVEL_HEIGHT = 6;
const FLOOR_ID = 'floor';

interface Extra {
  items?: Record<string, string>;
  entities?: Array<{ x: number; y: number; type: string }>;
  underlays?: Array<{ x: number; y: number; terrain: string }>;
  trapLinks?: CompiledLevel['trapLinks'];
  cloneLinks?: CompiledLevel['cloneLinks'];
  launcherLinks?: CompiledLevel['launcherLinks'];
  ruleset?: CompiledLevel['ruleset'];
}

/** A small floor level with the given terrain at "x,y" keys. */
function makeLevel(terrain: Record<string, string>, extra: Extra = {}): CompiledLevel {
  const items = Array.from({ length: LEVEL_HEIGHT }, () => Array<string | null>(LEVEL_WIDTH).fill(null));
  for (const [key, id] of Object.entries(extra.items ?? {})) {
    const [x, y] = key.split(',').map(Number);
    items[y][x] = id;
  }
  return {
    id: 'device_relations_test',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 0, y: 0, dir: 'S' },
    terrain: Array.from({ length: LEVEL_HEIGHT }, (_, y) =>
      Array.from({ length: LEVEL_WIDTH }, (_, x) => terrain[`${x},${y}`] ?? FLOOR_ID)
    ),
    items,
    entities: (extra.entities ?? []).map((e) => ({ ...e, dir: 'S' as const })),
    trapLinks: extra.trapLinks ?? [],
    cloneLinks: extra.cloneLinks ?? [],
    ...(extra.launcherLinks ? { launcherLinks: extra.launcherLinks } : {}),
    ...(extra.underlays ? { underlays: extra.underlays } : {}),
    ...(extra.ruleset ? { ruleset: extra.ruleset } : {})
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('deviceRelations', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('names a role for every device tile', () => {
    const expected: Record<string, DeviceRole> = {
      button_brown: 'trap_button',
      trap: 'trap',
      button_red: 'clone_button',
      clone_machine: 'clone_machine',
      shot_trigger: 'shot_trigger',
      shot_launcher_n: 'shot_launcher',
      pressure_plate_red: 'pressure_plate',
      hold_door_red_closed: 'hold_door',
      toggle_button_red: 'toggle_button',
      button_green: 'toggle_button',
      toggle_wall_closed: 'toggle_wall',
      toggle_wall_red_closed: 'toggle_wall',
      teleport: 'teleporter',
      button_blue: 'tank_button',
      button_orange: 'flame_button',
      flame_jet_on: 'flame_jet',
      button_gray: 'swap_button',
      puppet_control: 'puppet_control',
      laser_emitter_n: 'laser_emitter',
      laser_receiver_red: 'laser_receiver',
      laser_gate_red_closed: 'laser_gate'
    };
    for (const [tile, role] of Object.entries(expected)) {
      const level = makeLevel({ '1,1': tile });
      expect(deviceRelations(level, 1, 1).role, tile).toBe(role);
      expect(isDeviceCell(level, 1, 1), tile).toBe(true);
    }
    expect(isDeviceCell(makeLevel({}), 1, 1)).toBe(false);
    expect(deviceRelations(makeLevel({}), 1, 1)).toEqual({ role: null, controls: [], controlledBy: [] });
  });

  it('names entity roles for tanks and puppets', () => {
    const level = makeLevel({}, { entities: [{ x: 2, y: 2, type: 'tank' }, { x: 3, y: 2, type: 'puppet' }] });
    expect(deviceRelations(level, 2, 2).role).toBe('tank');
    expect(deviceRelations(level, 3, 2).role).toBe('puppet');
  });

  it('reports explicit links in both directions', () => {
    const level = makeLevel(
      { '0,0': 'button_brown', '3,0': 'trap', '0,1': 'button_red', '3,1': 'clone_machine', '0,2': 'shot_trigger', '3,2': 'shot_launcher_e' },
      {
        trapLinks: [{ buttonX: 0, buttonY: 0, trapX: 3, trapY: 0 }],
        cloneLinks: [{ buttonX: 0, buttonY: 1, clonerX: 3, clonerY: 1, templateType: 'tank', templateDir: 'E' }],
        launcherLinks: [{ buttonX: 0, buttonY: 2, launcherX: 3, launcherY: 2 }]
      }
    );
    for (const row of [0, 1, 2]) {
      expect(deviceRelations(level, 0, row).controls).toEqual([{ x: 3, y: row, kind: 'link' }]);
      expect(deviceRelations(level, 3, row).controlledBy).toEqual([{ x: 0, y: row, kind: 'link' }]);
    }
  });

  it('wires plates to the hold doors of their colour', () => {
    const level = makeLevel({ '0,0': 'pressure_plate_red', '4,0': 'hold_door_red_closed', '5,0': 'hold_door_red_open', '6,0': 'hold_door_blue_closed' });
    expect(deviceRelations(level, 0, 0).controls).toEqual([
      { x: 4, y: 0, kind: 'colour', channel: 'red' },
      { x: 5, y: 0, kind: 'colour', channel: 'red' }
    ]);
    expect(deviceRelations(level, 6, 0).controlledBy).toEqual([]);
  });

  it('wires toggle buttons to the walls of their channel only', () => {
    const level = makeLevel({
      '0,0': 'button_green',
      '1,0': 'toggle_button_red',
      '4,0': 'toggle_wall_closed',
      '5,0': 'toggle_wall_red_open',
      '6,0': 'toggle_wall_blue_closed'
    });
    expect(deviceRelations(level, 0, 0).controls).toEqual([{ x: 4, y: 0, kind: 'colour', channel: 'green' }]);
    expect(deviceRelations(level, 1, 0).controls).toEqual([{ x: 5, y: 0, kind: 'colour', channel: 'red' }]);
    expect(deviceRelations(level, 6, 0).controlledBy).toEqual([]);
  });

  it('relates the teleporters of a group to each other and keeps groups apart', () => {
    const level = makeLevel({ '0,0': 'teleport_red', '3,0': 'teleport_red', '5,0': 'teleport_blue', '0,2': 'teleport', '2,2': 'teleport' });
    expect(deviceRelations(level, 0, 0).controls).toEqual([{ x: 3, y: 0, kind: 'colour', channel: 'red' }]);
    expect(deviceRelations(level, 3, 0).controlledBy).toEqual([{ x: 0, y: 0, kind: 'colour', channel: 'red' }]);
    expect(deviceRelations(level, 5, 0).controls).toEqual([]);
    expect(deviceRelations(level, 0, 2).controls).toEqual([{ x: 2, y: 2, kind: 'colour' }]);
  });

  it('wires laser receivers to the gates of their group', () => {
    const level = makeLevel({ '0,0': 'laser_receiver_red', '4,0': 'laser_gate_red_closed', '5,0': 'laser_gate_blue_open' });
    expect(deviceRelations(level, 0, 0).controls).toEqual([{ x: 4, y: 0, kind: 'colour', channel: 'red' }]);
    expect(deviceRelations(level, 4, 0).controlledBy).toEqual([{ x: 0, y: 0, kind: 'colour', channel: 'red' }]);
    expect(deviceRelations(level, 5, 0).controlledBy).toEqual([]);
    expect(deviceRelations(makeLevel({ '1,1': 'laser_emitter_n' }), 1, 1).controls).toEqual([]);
  });

  it('applies the level-wide actions', () => {
    const level = makeLevel(
      { '0,0': 'button_blue', '0,1': 'button_orange', '0,2': 'puppet_control', '4,1': 'flame_jet_off', '5,1': 'flame_jet_on' },
      { entities: [{ x: 6, y: 3, type: 'tank' }, { x: 7, y: 3, type: 'puppet' }, { x: 7, y: 4, type: 'tank' }] }
    );
    expect(deviceRelations(level, 0, 0).controls).toEqual([
      { x: 6, y: 3, kind: 'level' },
      { x: 7, y: 4, kind: 'level' }
    ]);
    expect(deviceRelations(level, 0, 1).controls).toEqual([
      { x: 4, y: 1, kind: 'level' },
      { x: 5, y: 1, kind: 'level' }
    ]);
    expect(deviceRelations(level, 0, 2).controls).toEqual([{ x: 7, y: 3, kind: 'level' }]);
    expect(deviceRelations(level, 7, 3).controlledBy).toEqual([{ x: 0, y: 2, kind: 'level' }]);
  });

  it('lists the chips and bombs a gray button swaps within its radius', () => {
    const level = makeLevel(
      { '3,2': 'button_gray' },
      { items: { '1,2': 'chip', '5,4': 'bomb', '6,2': 'chip', '3,3': 'key_red' } }
    );
    expect(deviceRelations(level, 3, 2).controls).toEqual([
      { x: 1, y: 2, kind: 'level', channel: 'swap_radius' },
      { x: 5, y: 4, kind: 'level', channel: 'swap_radius' }
    ]);
    expect(deviceRelations(level, 1, 2)).toEqual({
      role: null,
      controls: [],
      controlledBy: [{ x: 3, y: 2, kind: 'level', channel: 'swap_radius' }]
    });
  });

  it('falls back for unlinked brown buttons and traps', () => {
    const level = makeLevel(
      { '0,0': 'button_brown', '1,0': 'button_brown', '4,0': 'trap', '5,0': 'trap' },
      { trapLinks: [{ buttonX: 1, buttonY: 0, trapX: 5, trapY: 0 }] }
    );
    // The unlinked trap answers to every brown button; the linked trap to its link, plus nothing else.
    expect(deviceRelations(level, 4, 0).controlledBy).toEqual([
      { x: 0, y: 0, kind: 'level' },
      { x: 1, y: 0, kind: 'level' }
    ]);
    expect(deviceRelations(level, 5, 0).controlledBy).toEqual([{ x: 1, y: 0, kind: 'link' }]);
    expect(deviceRelations(level, 0, 0).controls).toEqual([{ x: 4, y: 0, kind: 'level' }]);
    expect(deviceRelations(level, 1, 0).controls).toEqual([
      { x: 4, y: 0, kind: 'level' },
      { x: 5, y: 0, kind: 'link' }
    ]);
  });

  it('falls back for an unlinked red button to the machines holding a template', () => {
    const level = makeLevel(
      { '0,0': 'button_red', '1,0': 'button_red', '4,0': 'clone_machine', '5,0': 'clone_machine' },
      {
        cloneLinks: [{ buttonX: 1, buttonY: 0, clonerX: 5, clonerY: 0, templateType: 'tank', templateDir: 'E' }],
        entities: [{ x: 4, y: 0, type: 'tank' }]
      }
    );
    expect(deviceRelations(level, 0, 0).controls).toEqual([{ x: 4, y: 0, kind: 'level' }]);
    expect(deviceRelations(level, 1, 0).controls).toEqual([{ x: 5, y: 0, kind: 'link' }]);
    expect(deviceRelations(level, 4, 0).controlledBy).toEqual([{ x: 0, y: 0, kind: 'level' }]);
  });

  it('reports a device hidden under a removable top, the visible top winning the role', () => {
    const hiddenOnly = makeLevel({ '2,2': 'door_red' }, { underlays: [{ x: 2, y: 2, terrain: 'pressure_plate_red' }], });
    const withDoor = makeLevel({ '2,2': 'door_red', '5,2': 'hold_door_red_closed' }, { underlays: [{ x: 2, y: 2, terrain: 'pressure_plate_red' }] });
    expect(deviceRelations(hiddenOnly, 2, 2).role).toBe('pressure_plate');
    expect(deviceRelations(withDoor, 2, 2).controls).toEqual([{ x: 5, y: 2, kind: 'colour', channel: 'red' }]);
    const bothDevices = makeLevel({ '2,2': 'button_green', '5,2': 'hold_door_red_closed' }, { underlays: [{ x: 2, y: 2, terrain: 'pressure_plate_red' }] });
    const both = deviceRelations(bothDevices, 2, 2);
    expect(both.role).toBe('toggle_button');
    expect(both.controls).toEqual([{ x: 5, y: 2, kind: 'colour', channel: 'red' }]);
  });

  it('returns nothing for Lynx and CC3D levels', () => {
    for (const ruleset of ['lynx', 'cc3d'] as const) {
      const level = makeLevel({ '1,1': 'button_brown', '2,1': 'trap' }, { ruleset });
      expect(deviceRelations(level, 1, 1)).toEqual({ role: null, controls: [], controlledBy: [] });
      expect(isDeviceCell(level, 1, 1)).toBe(false);
    }
  });

  it('never mutates the level', () => {
    const level = deepFreeze(
      makeLevel(
        { '0,0': 'button_brown', '4,0': 'trap', '0,1': 'button_gray', '1,1': 'door_red' },
        { items: { '1,2': 'chip' }, entities: [{ x: 5, y: 5, type: 'tank' }], underlays: [{ x: 1, y: 1, terrain: 'pressure_plate_red' }] }
      )
    );
    const snapshot = JSON.stringify(level);
    for (let y = 0; y < LEVEL_HEIGHT; y++) {
      for (let x = 0; x < LEVEL_WIDTH; x++) {
        deviceRelations(level, x, y);
        isDeviceCell(level, x, y);
      }
    }
    expect(JSON.stringify(level)).toBe(snapshot);
  });

  it('is symmetric and complete over the showcase fixtures', () => {
    let devices = 0;
    const packs = [laserShowcase, mechanicsShowcase] as Array<{ levels: LevelBlueprint[] }>;
    for (const pack of packs) {
      for (const blueprint of pack.levels) {
        const level = ConfigRegistry.compileBlueprint(blueprint);
        for (let y = 0; y < level.terrain.length; y++) {
          for (let x = 0; x < level.terrain[y].length; x++) {
            const rel = deviceRelations(level, x, y);
            if (isDeviceCell(level, x, y)) {
              devices++;
              expect(rel.role, `${level.id} ${x},${y}`).not.toBeNull();
            }
            for (const c of rel.controls) {
              const back = deviceRelations(level, c.x, c.y).controlledBy;
              expect(back, `${level.id} ${x},${y} -> ${c.x},${c.y}`).toContainEqual({ x, y, kind: c.kind, ...(c.channel !== undefined ? { channel: c.channel } : {}) });
            }
            for (const c of rel.controlledBy) {
              const forth = deviceRelations(level, c.x, c.y).controls;
              expect(forth, `${level.id} ${x},${y} <- ${c.x},${c.y}`).toContainEqual({ x, y, kind: c.kind, ...(c.channel !== undefined ? { channel: c.channel } : {}) });
            }
          }
        }
      }
    }
    expect(devices).toBeGreaterThan(0);
  });
});
