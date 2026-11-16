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

/**
 * The wired blue teleport networks of a CC2 record (Cc2LevelData.teleportNets): a malformed list drops only that field, never the
 * record, so the level keeps its other CC2 data.
 */

import { describe, expect, it } from 'vitest';
import { isCc2LevelData, isTeleportNetList, stripInvalidTextFields, withValidTeleportNets } from './ConfigValidation';
import { room } from '../test/cc2Room';
import type { Cc2LevelData, CompiledLevel } from '../core/types';

const VALID_RECORD: Cc2LevelData = {
  v: 1,
  sha256: 'ab'.repeat(32),
  file: 'one.c2m',
  order: 1,
  gridHash: 'x',
  coverage: { verdict: 'approx', lost: [], approx: ['teleport_blue_wired'] }
};

const MALFORMED_LISTS: readonly unknown[] = ['x', [[]], [[1.5]], [['a']], [-1], [7], { 0: [1] }, [[1], 'y']];

describe('teleport network lists', () => {
  it('accepts a list of non-empty integer lists, and nothing else', () => {
    expect(isTeleportNetList([[1, 2], [3]])).toBe(true);
    expect(isTeleportNetList([])).toBe(true);
    for (const bad of MALFORMED_LISTS) expect(isTeleportNetList(bad), JSON.stringify(bad)).toBe(false);
  });

  it('drops only a malformed teleportNets and keeps the rest of the record', () => {
    for (const bad of MALFORMED_LISTS) {
      const kept = withValidTeleportNets({ ...VALID_RECORD, teleportNets: bad as number[][] });
      expect('teleportNets' in kept, JSON.stringify(bad)).toBe(false);
      expect(kept).toEqual(VALID_RECORD);
    }
  });

  it('returns a well formed or absent field untouched, the same object', () => {
    const wired = { ...VALID_RECORD, teleportNets: [[4, 9], [5]] };
    expect(withValidTeleportNets(wired)).toBe(wired);
    expect(withValidTeleportNets(VALID_RECORD)).toBe(VALID_RECORD);
  });

  it('still reads the record as a CC2 record when the list is malformed', () => {
    expect(isCc2LevelData({ ...VALID_RECORD, teleportNets: 'x' })).toBe(true);
  });
});

describe('a stored level with a malformed teleportNets', () => {
  const levelWith = (nets: unknown): CompiledLevel => ({ ...room({ mode: 'native' }), cc2: { ...VALID_RECORD, teleportNets: nets as number[][] } });

  it('keeps its cc2 record without the field', () => {
    const cleaned = stripInvalidTextFields(levelWith('x'));
    expect(cleaned.cc2).toEqual(VALID_RECORD);
  });

  it('returns a level with a good list as is', () => {
    const level = levelWith([[3, 4]]);
    expect(stripInvalidTextFields(level)).toBe(level);
  });

  it('never mutates its input', () => {
    const level = levelWith('x');
    stripInvalidTextFields(level);
    expect(level.cc2?.teleportNets).toBe('x');
  });
});
