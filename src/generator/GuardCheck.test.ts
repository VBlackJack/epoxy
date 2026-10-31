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
import { exitReachableWithout } from './GuardCheck';
import { buildTestLevel } from '../test/buildTestLevel';
import { loadTestConfigs } from '../test/loadTestConfigs';

describe('exitReachableWithout', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('proves a key needed when its door is the only way to the exit', () => {
    const level = buildTestLevel(['@.rRE']);
    expect(exitReachableWithout(level, 'key_red')).toBe(false);
  });

  it('leaves the exit reachable without an unrelated key', () => {
    const level = buildTestLevel(['@.rRE']);
    expect(exitReachableWithout(level, 'key_blue')).toBe(true);
  });

  it('finds a way around the door', () => {
    const level = buildTestLevel(['@.RE', '....']);
    expect(exitReachableWithout(level, 'key_red')).toBe(true);
  });

  it('proves boots needed when water blocks the way', () => {
    const level = buildTestLevel(['@.WE']);
    expect(exitReachableWithout(level, 'boots_water')).toBe(false);
    expect(exitReachableWithout(level, 'boots_fire')).toBe(true);
  });

  it('proves fire boots needed, but not when a block could be pushed into water', () => {
    expect(exitReachableWithout(buildTestLevel(['@.FE']), 'boots_fire')).toBe(false);
    const withBlock = buildTestLevel(['@.WE'], { entities: [{ x: 1, y: 0, type: 'dirt_block', dir: 'E' }] });
    expect(exitReachableWithout(withBlock, 'boots_water')).toBe(true);
  });

  it('does not count ice as closed to a player without boots', () => {
    expect(exitReachableWithout(buildTestLevel(['@.IE']), 'boots_ice')).toBe(true);
  });

  it('jumps through teleporters of the same group only', () => {
    expect(exitReachableWithout(buildTestLevel(['@O#EO']), 'key_red')).toBe(true);
    const split = buildTestLevel(['@O#EO']);
    split.terrain[0][4] = 'teleport_red';
    expect(exitReachableWithout(split, 'key_red')).toBe(false);
  });

  it('is false when the walls cut the exit off', () => {
    expect(exitReachableWithout(buildTestLevel(['@#E']), 'key_red')).toBe(false);
  });
});
