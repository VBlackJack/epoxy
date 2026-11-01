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
import { loadTestConfigs } from '../test/loadTestConfigs';
import { stepTerrainOf } from './stepTerrain';

beforeAll(() => {
  loadTestConfigs();
});

const NO_BOOTS: ReadonlySet<string> = new Set();
const tile = (id: string) => ConfigRegistry.getTile(id);

describe('stepTerrainOf', () => {
  it('is null on a plain floor, with or without boots', () => {
    expect(stepTerrainOf(tile('floor'), NO_BOOTS)).toBeNull();
    expect(stepTerrainOf(tile('floor'), new Set(['boots_water']))).toBeNull();
  });

  it('is ice on every ice tile, boots or not', () => {
    for (const id of ['ice', 'ice_nw', 'ice_ne', 'ice_sw', 'ice_se']) {
      expect(stepTerrainOf(tile(id), NO_BOOTS)).toBe('ice');
      expect(stepTerrainOf(tile(id), new Set(['boots_ice']))).toBe('ice');
    }
  });

  it('is force on a force floor, even when the boots cancel the push', () => {
    expect(stepTerrainOf(tile('force_n'), NO_BOOTS)).toBe('force');
    expect(stepTerrainOf(tile('force_n'), new Set(['boots_force']))).toBe('force');
  });

  it('is the hazard on water and fire only with the protecting boots', () => {
    expect(stepTerrainOf(tile('water'), NO_BOOTS)).toBeNull();
    expect(stepTerrainOf(tile('water'), new Set(['boots_fire']))).toBeNull();
    expect(stepTerrainOf(tile('water'), new Set(['boots_water']))).toBe('water');
    expect(stepTerrainOf(tile('fire'), NO_BOOTS)).toBeNull();
    expect(stepTerrainOf(tile('fire'), new Set(['boots_fire']))).toBe('fire');
  });
});
