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
import { ConfigRegistry } from '../config/ConfigRegistry';
import { validateCc3dLevel } from '../core/cc3d/cc3dValidator';
import {
  CC3D_BLOCKER_KINDS,
  CC3D_DEVICE_KINDS,
  CC3D_FLOOR_LIKE_KINDS,
  CC3D_ITEM_KINDS,
  CC3D_MOB_KINDS
} from '../core/cc3d/model';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { applyCc3dTool } from './cc3dTools';
import {
  CC3D_CATEGORIES,
  CC3D_CORNERS,
  CC3D_MIRRORS,
  CC3D_PALETTE,
  cc3dEntriesOf,
  DEFAULT_CC3D_ATTRIBUTES,
  entryDisplay,
  findCc3dEntry,
  needsAttribute
} from './cc3dPalette';
import { emptyCc3dRoom } from './cc3dRoom';

const ROOM_SIZE = 9;
const PLACE_AT = 3;

function entriesOfAction(action: string): string[] {
  return CC3D_PALETTE.filter((entry) => entry.action === action).map((entry) => entry.kind);
}

describe('CC3D palette entries', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('covers every terrain, item and mob kind the validator accepts', () => {
    const layers = entriesOfAction('layer');
    for (const kind of [...CC3D_FLOOR_LIKE_KINDS, ...CC3D_DEVICE_KINDS, ...CC3D_BLOCKER_KINDS]) expect(layers, kind).toContain(kind);
    for (const kind of CC3D_ITEM_KINDS) expect(entriesOfAction('item'), kind).toContain(kind);
    // The laser shot is runtime only: no level file holds one, so the palette has no entry for it.
    for (const kind of CC3D_MOB_KINDS) expect(entriesOfAction('mob'), kind).toContain(kind);
    expect(entriesOfAction('mob')).not.toContain('shot');
    expect(entriesOfAction('player')).toHaveLength(1);
    expect(entriesOfAction('panel')).toHaveLength(1);
  });

  it('gives every entry a unique id and a known category, and puts each in the category of its class', () => {
    const ids = CC3D_PALETTE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = CC3D_CATEGORIES.map((category) => category.id);
    for (const entry of CC3D_PALETTE) {
      expect(known, entry.id).toContain(entry.category);
      expect(findCc3dEntry(entry.id)).toBe(entry);
    }
    expect(cc3dEntriesOf('floors').every((entry) => CC3D_FLOOR_LIKE_KINDS.includes(entry.kind as never))).toBe(true);
    expect(cc3dEntriesOf('devices').every((entry) => CC3D_DEVICE_KINDS.includes(entry.kind as never))).toBe(true);
    expect(cc3dEntriesOf('items').map((entry) => entry.kind)).toEqual([...CC3D_ITEM_KINDS]);
    expect(cc3dEntriesOf('player')).toHaveLength(1);
    expect(CC3D_CATEGORIES.every((category) => cc3dEntriesOf(category.id).length > 0)).toBe(true);
  });

  it('asks for the attributes the validator requires', () => {
    const needs = (id: string): string[] => findCc3dEntry(id)?.attributes.slice().sort() ?? [];
    expect(needs('layer:door')).toEqual(['color']);
    expect(needs('layer:plate')).toEqual(['color']);
    expect(needs('layer:toggle_control')).toEqual(['color']);
    expect(needs('layer:hold_door')).toEqual(['color']);
    expect(needs('layer:force')).toEqual(['dir']);
    expect(needs('layer:ice_corner')).toEqual(['corner']);
    expect(needs('item:key')).toEqual(['color']);
    expect(needs('mob:block_color')).toEqual(['color', 'dir']);
    expect(needs('mob:reflector')).toEqual(['dir', 'mirror']);
    expect(needs('mob:walker')).toEqual(['dir']);
    expect(needs('layer:wall')).toEqual([]);
    expect(needsAttribute(findCc3dEntry('panel:panel')!, 'dir')).toBe(true);
    expect(findCc3dEntry('layer:toggle_door:open')?.open).toBe(true);
  });

  it('places every entry on a room with its default attributes and leaves the validator no error', () => {
    for (const entry of CC3D_PALETTE) {
      const level = emptyCc3dRoom(ROOM_SIZE, ROOM_SIZE);
      const outcome = applyCc3dTool({
        level,
        tool: 'brush',
        entry,
        attrs: DEFAULT_CC3D_ATTRIBUTES,
        dir: 'E',
        x: PLACE_AT,
        y: PLACE_AT,
        side: 'N'
      });
      // Plain floor on a plain floor changes nothing; every other entry changes the cell.
      expect(outcome.changed, entry.id).toBe(entry.id !== 'layer:floor');
      const errors = validateCc3dLevel(outcome.level).filter((issue) => issue.severity === 'error');
      expect(errors, entry.id).toEqual([]);
    }
  });

  it('draws every entry, with each colour, corner and mirror, with an id the configs name', () => {
    const check = (id: string, kind: string): void => {
      const definition = kind === 'entity' ? (ConfigRegistry.getEntityDef(id) ?? ConfigRegistry.getTile(id)) : ConfigRegistry.getTile(id);
      expect(definition, `${kind} ${id}`).toBeDefined();
    };
    for (const entry of CC3D_PALETTE) {
      const variants = [DEFAULT_CC3D_ATTRIBUTES];
      if (needsAttribute(entry, 'color')) {
        variants.push(...(['red', 'green', 'blue', 'yellow'] as const).map((color) => ({ ...DEFAULT_CC3D_ATTRIBUTES, color })));
      }
      if (needsAttribute(entry, 'corner')) variants.push(...CC3D_CORNERS.map((corner) => ({ ...DEFAULT_CC3D_ATTRIBUTES, corner })));
      if (needsAttribute(entry, 'mirror')) variants.push(...CC3D_MIRRORS.map((mirror) => ({ ...DEFAULT_CC3D_ATTRIBUTES, mirror })));
      for (const attrs of variants) {
        for (const dir of ['N', 'E', 'S', 'W'] as const) {
          const display = entryDisplay(entry, attrs, dir);
          if (display.kind !== 'player') check(display.id, display.kind === 'entity' ? 'entity' : 'tile');
        }
      }
    }
  });

  it('shows a force floor and a thin wall facing the direction control', () => {
    const force = findCc3dEntry('layer:force')!;
    expect(entryDisplay(force, DEFAULT_CC3D_ATTRIBUTES, 'W').id).toBe('force_w');
    const panel = findCc3dEntry('panel:panel')!;
    expect(entryDisplay(panel, DEFAULT_CC3D_ATTRIBUTES, 'E').id).toBe('thin_wall_e');
  });
});
