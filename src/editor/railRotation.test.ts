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
import { normalizeUnderlays } from '../config/ConfigValidation';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { nextRailPiece } from './railRotation';

describe('nextRailPiece', () => {
  beforeEach(async () => {
    await loadTestConfigs();
  });

  const next = (id: string): string | null => {
    const tiles = ConfigRegistry.getTiles().tiles;
    return nextRailPiece(tiles[id], tiles);
  };

  it('turns the straight pieces back and forth', () => {
    expect(next('rail_ns')).toBe('rail_ew');
    expect(next('rail_ew')).toBe('rail_ns');
  });

  it('turns the bends clockwise through the four corners', () => {
    expect(next('rail_ne')).toBe('rail_se');
    expect(next('rail_se')).toBe('rail_sw');
    expect(next('rail_sw')).toBe('rail_nw');
    expect(next('rail_nw')).toBe('rail_ne');
  });

  it('swaps a rail switch with its twin', () => {
    expect(next('rail_switch_a')).toBe('rail_switch_b');
    expect(next('rail_switch_b')).toBe('rail_switch_a');
  });

  it('leaves other tiles alone', () => {
    expect(next('floor')).toBeNull();
  });

  it('keeps a rail from being hidden as an underlay, where a plain terrain is kept', () => {
    // A door is a removable top, so only the hidden terrain decides whether the entry survives.
    const terrain = [['door_red']];
    expect(normalizeUnderlays([{ x: 0, y: 0, terrain: 'floor' }], terrain, 'epoxy')).not.toBeNull();
    expect(normalizeUnderlays([{ x: 0, y: 0, terrain: 'rail_ns' }], terrain, 'epoxy')).toBeNull();
  });
});
