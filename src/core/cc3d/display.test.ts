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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CC3D_DISPLAY_IDS, displayItemId, displayMobId, displayTerrainId } from './display';
import type {
  Cc3dCell,
  Cc3dColor,
  Cc3dItemKind,
  Cc3dMob,
  Cc3dMobKind,
  Cc3dTerrain,
  Cc3dTerrainKind
} from './model';
import type { Direction } from '../types';

const CONFIGS = join(__dirname, '..', '..', '..', 'public', 'configs');
const tileIds = new Set<string>(
  Object.keys((JSON.parse(readFileSync(join(CONFIGS, 'tiles.json'), 'utf8')) as { tiles: object }).tiles)
);
const monsterIds = new Set<string>(
  Object.keys((JSON.parse(readFileSync(join(CONFIGS, 'monsters.json'), 'utf8')) as { entities: object }).entities)
);

// Record types force these lists to name every kind of the model.
const TERRAIN_KINDS: Record<Cc3dTerrainKind, true> = {
  floor: true, wall: true, water: true, fire: true, ice: true, ice_corner: true, force: true, force_random: true,
  exit: true, socket: true, socket_red: true, slime: true, turtle: true, dirt: true, gravel: true, sand: true,
  teleport_blue: true, teleport_red: true, push_up_wall: true, appearing_wall: true, false_wall: true, door: true,
  toggle_door: true, toggle_control: true, hold_door: true, plate: true, trap: true, trap_control: true,
  clone_machine: true, clone_switch: true, golem_control_blue: true, golem_control_yellow: true,
  laser_controller: true, bomb: true, gate_tools: true, gate_keys: true
};
const ITEM_KINDS: Record<Cc3dItemKind, true> = {
  fish: true, fish_extra: true, key: true, orb_ice: true, orb_force: true, orb_fire: true, orb_water: true, orb_speed: true
};
const MOB_KINDS: Record<Cc3dMobKind, true> = {
  block_dirt: true, block_ice: true, block_color: true, reflector: true, walker: true, legs_green: true,
  legs_red: true, blinky: true, baby_blinky: true, limpa: true, limpy: true, bouncer: true, omni: true,
  screamer: true, baby_screamer: true, snappy: true, nibble: true, golem_blue: true, golem_yellow: true,
  laser_shooter: true, bot_static: true, bot_cw: true, bot_ccw: true, bot_multi: true, shot: true
};
const COLORS: Cc3dColor[] = ['red', 'green', 'blue', 'yellow'];
const DIRS: Direction[] = ['N', 'E', 'S', 'W'];
const MIRRORS = ['LU', 'DL', 'UR', 'RD'];
const NEW_PREFIX = 'cc3d_';

/** Every terrain variant the mapping must handle: all kinds, and each colour, direction, state and corner. */
function allTerrains(): Cc3dTerrain[] {
  const out: Cc3dTerrain[] = [];
  for (const kind of Object.keys(TERRAIN_KINDS) as Cc3dTerrainKind[]) {
    switch (kind) {
      case 'door':
      case 'toggle_control':
      case 'plate':
        COLORS.forEach((color) => out.push({ kind, color }));
        break;
      case 'toggle_door':
      case 'hold_door':
        COLORS.forEach((color) => [true, false].forEach((open) => out.push({ kind, color, open })));
        break;
      case 'force':
        DIRS.forEach((dir) => out.push({ kind, dir }));
        break;
      case 'ice_corner':
        out.push(
          { kind, corner: ['S', 'W'] },
          { kind, corner: ['N', 'W'] },
          { kind, corner: ['N', 'E'] },
          { kind, corner: ['E', 'S'] }
        );
        break;
      default:
        out.push({ kind });
    }
  }
  return out;
}

function allMobs(): Cc3dMob[] {
  const out: Cc3dMob[] = [];
  for (const kind of Object.keys(MOB_KINDS) as Cc3dMobKind[]) {
    if (kind === 'block_color') COLORS.forEach((color) => out.push({ kind, x: 0, y: 0, dir: 'N', color }));
    else if (kind === 'reflector') MIRRORS.forEach((mirror) => out.push({ kind, x: 0, y: 0, dir: 'N', mirror }));
    else out.push({ kind, x: 0, y: 0, dir: 'N' });
  }
  return out;
}

function allItemIds(): string[] {
  const out: string[] = [];
  for (const kind of Object.keys(ITEM_KINDS) as Cc3dItemKind[]) {
    if (kind === 'key') COLORS.forEach((color) => out.push(displayItemId({ kind, color }) as string));
    else out.push(displayItemId({ kind }) as string);
  }
  return out;
}

const cellOf = (terrain: Cc3dTerrain, panels: Direction[] = []): Cc3dCell => ({ terrain: [terrain], panels, item: null });

describe('cc3d display ids', () => {
  const terrainIds = allTerrains().map((t) => displayTerrainId(cellOf(t)));
  const mobIds = allMobs().map(displayMobId);
  const itemIds = allItemIds();

  it('reuses only ids that exist in tiles.json or monsters.json', () => {
    for (const id of [...terrainIds, ...itemIds].filter((i) => !i.startsWith(NEW_PREFIX))) {
      expect(tileIds.has(id), id).toBe(true);
    }
    for (const id of mobIds.filter((i) => !i.startsWith(NEW_PREFIX))) {
      expect(monsterIds.has(id), id).toBe(true);
    }
  });

  it('lists exactly the new cc3d_ ids the mapping returns', () => {
    const produced = new Set([...terrainIds, ...mobIds, ...itemIds].filter((i) => i.startsWith(NEW_PREFIX)));
    expect(new Set(CC3D_DISPLAY_IDS)).toEqual(produced);
    expect(new Set(CC3D_DISPLAY_IDS).size).toBe(CC3D_DISPLAY_IDS.length);
  });

  it('maps the contract examples', () => {
    expect(displayTerrainId(cellOf({ kind: 'toggle_door', color: 'green', open: true }))).toBe('toggle_wall_open');
    expect(displayTerrainId(cellOf({ kind: 'toggle_door', color: 'red', open: false }))).toBe('cc3d_toggle_door_red_closed');
    expect(displayTerrainId(cellOf({ kind: 'toggle_control', color: 'green' }))).toBe('button_green');
    expect(displayTerrainId(cellOf({ kind: 'ice_corner', corner: ['N', 'E'] }))).toBe('ice_ne');
    expect(displayTerrainId(cellOf({ kind: 'ice_corner', corner: ['E', 'S'] }))).toBe('ice_se');
    expect(displayTerrainId(cellOf({ kind: 'force', dir: 'W' }))).toBe('force_w');
    expect(displayMobId({ kind: 'reflector', x: 0, y: 0, dir: 'N', mirror: 'LU' })).toBe('cc3d_reflector_lu');
    expect(displayMobId({ kind: 'snappy', x: 0, y: 0, dir: 'N' })).toBe('teeth');
    expect(displayItemId(null)).toBeNull();
    expect(displayItemId({ kind: 'key', color: 'blue' })).toBe('key_blue');
  });

  it('shows the top of the stack', () => {
    const cell: Cc3dCell = {
      terrain: [{ kind: 'ice' }, { kind: 'bomb' }, { kind: 'door', color: 'red' }],
      panels: ['N'],
      item: null
    };
    expect(displayTerrainId(cell)).toBe('door_red');
    cell.terrain.pop();
    expect(displayTerrainId(cell)).toBe('bomb');
  });

  it('draws thin walls on plain floor for every panel combination', () => {
    for (let mask = 1; mask < 16; mask++) {
      const panels = DIRS.filter((_, i) => (mask >> i) & 1);
      const id = displayTerrainId(cellOf({ kind: 'floor' }, panels));
      expect(id.startsWith('thin_wall_'), id).toBe(true);
      expect(tileIds.has(id), id).toBe(true);
    }
    expect(displayTerrainId(cellOf({ kind: 'floor' }, ['N', 'E', 'S']))).toBe('thin_wall_nes');
    expect(displayTerrainId(cellOf({ kind: 'floor' }, ['E', 'S']))).toBe('thin_wall_se');
    expect(displayTerrainId(cellOf({ kind: 'ice' }, ['N']))).toBe('ice');
  });

  it('throws on a missing required field', () => {
    expect(() => displayTerrainId(cellOf({ kind: 'door' }))).toThrow();
    expect(() => displayMobId({ kind: 'block_color', x: 0, y: 0, dir: 'N' })).toThrow();
  });
});
