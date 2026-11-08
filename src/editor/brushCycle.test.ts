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
import { nextBrushTile } from './brushCycle';
import { VARIANT_FAMILY, familyMembers, paletteTilesOf, variantFamilyOf } from './paletteVariants';

const ITEMS = 'items';
const MECHANISMS = 'mechanisms';

describe('variant families', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  const tiles = () => ConfigRegistry.getTiles().tiles;

  it('finds each family from the config fields', () => {
    const t = tiles();
    expect(variantFamilyOf(t.no_sign_key_red)).toBe(VARIANT_FAMILY.noSign);
    expect(variantFamilyOf(t.signal_counter_3)).toBe(VARIANT_FAMILY.signalCounter);
    expect(variantFamilyOf(t.swivel_door_cc2_ne)).toBe(VARIANT_FAMILY.swivelCc2);
    expect(variantFamilyOf(t.swivel_door_ne)).toBe(VARIANT_FAMILY.swivel);
    expect(variantFamilyOf(t.toggle_switch_on)).toBe(VARIANT_FAMILY.toggleSwitch);
    expect(variantFamilyOf(t.floor)).toBeNull();
    expect(variantFamilyOf(t.forbid_key_red)).toBeNull();
  });

  it('lists the members of a family in config order', () => {
    const counters = familyMembers(tiles(), VARIANT_FAMILY.signalCounter, MECHANISMS).map((tile) => tile.id);
    expect(counters.length).toBeGreaterThan(1);
    expect(counters).toEqual(Object.keys(tiles()).filter((id) => tiles()[id].signalCounterStart !== undefined));
  });

  it('keeps one entry per family, showing the chosen variant, else the first', () => {
    const items = Object.values(tiles()).filter((tile) => tile.category === ITEMS);
    const members = familyMembers(tiles(), VARIANT_FAMILY.noSign, ITEMS);
    const first = paletteTilesOf(items, ITEMS, new Map());
    expect(first.filter((tile) => variantFamilyOf(tile) === VARIANT_FAMILY.noSign).map((tile) => tile.id)).toEqual([members[0].id]);
    const chosen = paletteTilesOf(items, ITEMS, new Map([[`${ITEMS}:${VARIANT_FAMILY.noSign}`, members[1].id]]));
    expect(chosen.filter((tile) => variantFamilyOf(tile) === VARIANT_FAMILY.noSign).map((tile) => tile.id)).toEqual([members[1].id]);
    expect(first.length).toBe(items.length - members.length + 1);
  });
});

describe('nextBrushTile', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('walks a family in config order and wraps from the last to the first', () => {
    const t = ConfigRegistry.getTiles().tiles;
    const members = familyMembers(t, VARIANT_FAMILY.signalCounter, MECHANISMS);
    members.forEach((tile, index) => {
      const step = nextBrushTile(tile, t);
      const wrapped = (index + 1) % members.length;
      expect(step).toEqual({ id: members[wrapped].id, rail: false, position: wrapped + 1, count: members.length });
    });
  });

  it('turns the swivel doors clockwise through the four corners', () => {
    const t = ConfigRegistry.getTiles().tiles;
    expect(nextBrushTile(t.swivel_door_cc2_ne, t)?.id).toBe(t.swivel_door_cc2_ne.swivelTurns?.cw);
  });

  it('keeps the rail pieces on their quarter turn', () => {
    const t = ConfigRegistry.getTiles().tiles;
    expect(nextBrushTile(t.rail_ns, t)).toEqual({ id: 'rail_ew', rail: true, position: 0, count: 0 });
  });

  it('has nothing to cycle for a standalone tile', () => {
    const t = ConfigRegistry.getTiles().tiles;
    expect(nextBrushTile(t.floor, t)).toBeNull();
  });
});
