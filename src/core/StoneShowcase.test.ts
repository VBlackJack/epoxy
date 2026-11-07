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
import stoneShowcase from '../test/fixtures/stoneShowcase.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel, LevelBlueprint } from './types';

/** Index of the only level of the stone showcase pack: the bomb in the corridor. */
const CORRIDOR_LEVEL_INDEX = 0;
const STONE = 'hurl_stone';
const FLOOR = 'floor';

function compileShowcase(index: number): CompiledLevel {
  return ConfigRegistry.compileBlueprint((stoneShowcase as { levels: LevelBlueprint[] }).levels[index]);
}

/** The level with every stone taken off the map. */
function withoutStones(level: CompiledLevel): CompiledLevel {
  return { ...level, items: level.items.map((row) => row.map((id) => (id === STONE ? null : id))) };
}

describe('stone showcase level', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('has no validator issue and an open way to the exit', () => {
    const level = compileShowcase(CORRIDOR_LEVEL_INDEX);
    expect(isCompiledLevelShape(level, ConfigRegistry.getLevelSizeBounds())).toBe(true);
    const report = LevelValidator.validate(level);
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(report.issues.map((issue) => issue.i18nKey)).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.stats.reachableExit).toBe(true);
  });

  it('carries a stored solution that wins, and fails once the stone is gone', () => {
    const level = compileShowcase(CORRIDOR_LEVEL_INDEX);
    expect(level.items.flat()).toContain(STONE);
    expect(storedSolutionWins(level)).toBe(true);
    expect(storedSolutionWins(withoutStones(level))).toBe(false);
  });

  it('cannot be won by walking into the bomb: the corridor has no other way', () => {
    const level = compileShowcase(CORRIDOR_LEVEL_INDEX);
    expect(level.items.flat()).toContain('bomb');
    expect(level.terrain[2].every((id) => id !== FLOOR)).toBe(true);
    expect(level.terrain[4].every((id) => id !== FLOOR)).toBe(true);
  });
});
