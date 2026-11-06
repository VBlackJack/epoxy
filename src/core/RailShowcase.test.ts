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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isCompiledLevelShape } from '../config/ConfigValidation';
import { storedSolutionWins } from '../generator/SolutionReplay';
import railShowcase from '../test/fixtures/railShowcase.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel, LevelBlueprint } from './types';

/** Indexes of the two levels of the rail showcase pack: the tank on the track, then the switch. */
const TRACK_LEVEL_INDEX = 0;
const SWITCH_LEVEL_INDEX = 1;
const GREEN_BUTTON = 'button_green';
const FLOOR = 'floor';
const SWITCH_NO_BUTTON_KEY = 'validator.issues.rail_switch_no_button.label';

function compileShowcase(index: number): CompiledLevel {
  return ConfigRegistry.compileBlueprint((railShowcase as { levels: LevelBlueprint[] }).levels[index]);
}

/** The level with every cell the predicate accepts turned into plain floor. */
function withFloorWhere(level: CompiledLevel, replaced: (id: string) => boolean): CompiledLevel {
  return { ...level, terrain: level.terrain.map((row) => row.map((id) => (replaced(id) ? FLOOR : id))) };
}

const isRail = (id: string): boolean => ConfigRegistry.getTile(id).railSides !== undefined;

describe('rail showcase levels', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it.each([TRACK_LEVEL_INDEX, SWITCH_LEVEL_INDEX])('level %i has no validator issue and an open way to the exit', (index) => {
    const level = compileShowcase(index);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    const report = LevelValidator.validate(level);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.issues.map((issue) => issue.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('carries a stored solution on the track level that wins, and fails once the rails are floor', () => {
    const level = compileShowcase(TRACK_LEVEL_INDEX);
    expect(level.terrain.flat().some(isRail)).toBe(true);
    expect(storedSolutionWins(level)).toBe(true);
    expect(storedSolutionWins(withFloorWhere(level, isRail))).toBe(false);
  });

  it('carries a stored solution on the switch level that wins, and fails without the green button', () => {
    const level = compileShowcase(SWITCH_LEVEL_INDEX);
    expect(level.terrain.flat()).toEqual(expect.arrayContaining(['rail_switch_b', GREEN_BUTTON]));
    expect(storedSolutionWins(level)).toBe(true);
    expect(storedSolutionWins(withFloorWhere(level, (id) => id === GREEN_BUTTON))).toBe(false);
  });

  it('notes a rail switch with no green button', () => {
    const level = withFloorWhere(compileShowcase(SWITCH_LEVEL_INDEX), (id) => id === GREEN_BUTTON);
    const issues = LevelValidator.validate(level).issues.filter((issue) => issue.i18nKey === SWITCH_NO_BUTTON_KEY);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(LevelValidator.validate(compileShowcase(SWITCH_LEVEL_INDEX)).issues.some((i) => i.i18nKey === SWITCH_NO_BUTTON_KEY)).toBe(false);
  });
});
