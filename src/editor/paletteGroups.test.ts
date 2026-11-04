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
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { arrangeMechanismSections, entityMechanismGroup, MECHANISM_GROUPS, tileMechanismGroup, wireToolMechanismGroup } from './paletteGroups';

const MECHANISMS_CATEGORY = 'mechanisms';
const WIRE_BRUSH_KINDS: readonly string[] = ['wire_trap', 'wire_cloner'];

function lookup(locale: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale);
}

const mechanismTiles = () => Object.values(ConfigRegistry.getTiles().tiles).filter((tile) => tile.category === MECHANISMS_CATEGORY);
const mechanismEntities = () => Object.values(ConfigRegistry.getMonsters().entities).filter((ent) => ent.category === MECHANISMS_CATEGORY);

beforeEach(() => {
  loadTestConfigs();
});

describe('Mechanisms palette groups', () => {
  it('places every Mechanisms tile, entity and wire tool in exactly one known group', () => {
    expect(mechanismTiles().length).toBeGreaterThan(0);
    expect(mechanismEntities().length).toBeGreaterThan(0);
    const known = new Set(MECHANISM_GROUPS.map((group) => group.id));
    expect(known.size).toBe(MECHANISM_GROUPS.length);
    for (const tile of mechanismTiles()) expect(known.has(tileMechanismGroup(tile)!), `tile ${tile.id}`).toBe(true);
    for (const ent of mechanismEntities()) expect(known.has(entityMechanismGroup(ent)!), `entity ${ent.id}`).toBe(true);
    for (const kind of WIRE_BRUSH_KINDS) expect(known.has(wireToolMechanismGroup(kind)!), `wire ${kind}`).toBe(true);
  });

  it('has no group without a member, so no heading is ever empty', () => {
    const used = new Set<string | null>();
    for (const tile of mechanismTiles()) used.add(tileMechanismGroup(tile));
    for (const ent of mechanismEntities()) used.add(entityMechanismGroup(ent));
    for (const group of MECHANISM_GROUPS) expect(used.has(group.id), group.id).toBe(true);
  });

  it('classifies by config fields', () => {
    const tile = (id: string) => ConfigRegistry.getTiles().tiles[id];
    expect(tileMechanismGroup(tile('button_red'))).toBe('buttons');
    expect(tileMechanismGroup(tile('trap'))).toBe('buttons');
    expect(tileMechanismGroup(tile('teleport_red'))).toBe('teleports');
    expect(tileMechanismGroup(tile('laser_gate_red_open'))).toBe('lasers');
    expect(tileMechanismGroup(tile('pressure_plate_red'))).toBe('colour');
    expect(tileMechanismGroup(tile('toggle_wall_red_open'))).toBe('colour');
    expect(tileMechanismGroup(tile('toggle_wall_closed'))).toBe('toggles');
    expect(tileMechanismGroup(tile('flame_jet_on'))).toBe('toggles');
    const entity = (id: string) => ConfigRegistry.getMonsters().entities[id];
    expect(entityMechanismGroup(entity('mirror_slash'))).toBe('lasers');
    expect(entityMechanismGroup(entity('turret_cw'))).toBe('blocks');
    expect(entityMechanismGroup(entity('color_block_red'))).toBe('colour');
    expect(entityMechanismGroup(entity('dirt_block'))).toBe('blocks');
  });

  it('puts each colour toggle button with its walls and keeps the plain toggle button with the buttons', () => {
    const tile = (id: string) => ConfigRegistry.getTiles().tiles[id];
    for (const id of ['toggle_button_red', 'toggle_button_blue', 'toggle_button_yellow']) {
      expect(tileMechanismGroup(tile(id)), id).toBe('colour');
    }
    expect(tileMechanismGroup(tile('button_green'))).toBe('buttons');
  });

  it('shows an Other section after the groups only when an entry has no group', () => {
    const withoutOther = arrangeMechanismSections([{ group: 'buttons', item: 'a' }]);
    expect(withoutOther.map((section) => section.group.id)).toEqual(['buttons']);
    const withOther = arrangeMechanismSections([
      { group: null, item: 'x' },
      { group: 'toggles', item: 'b' }
    ]);
    expect(withOther.map((section) => section.group.id)).toEqual(['toggles', 'other']);
    expect(withOther[1].items).toEqual(['x']);
    expect(typeof lookup(enLocale, withOther[1].group.labelKey)).toBe('string');
    expect(typeof lookup(frLocale, withOther[1].group.labelKey)).toBe('string');
  });

  it('names every group in both locales', () => {
    for (const group of MECHANISM_GROUPS) {
      expect(typeof lookup(enLocale, group.labelKey), `en ${group.labelKey}`).toBe('string');
      expect(typeof lookup(frLocale, group.labelKey), `fr ${group.labelKey}`).toBe('string');
    }
  });

  it('gives no group to a brush kind that is not a wire tool', () => {
    expect(wireToolMechanismGroup('terrain')).toBeNull();
  });
});
