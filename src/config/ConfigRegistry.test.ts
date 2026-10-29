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
import { ConfigRegistry } from './ConfigRegistry';
import { assertConfigShape, ConfigLoadError, InvalidLevelError } from './ConfigValidation';
import { DEFAULT_LEVEL_PASSWORD } from './constants';
import { LevelBlueprint } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';

function blueprint(overrides: Partial<LevelBlueprint> = {}): LevelBlueprint {
  return {
    id: 'test_level',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    playerStart: { x: 1, y: 1, dir: 'S' },
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    ...overrides
  };
}

describe('ConfigRegistry.compileBlueprint', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('compiles every shipped campaign level', () => {
    const campaign = ConfigRegistry.getLevels();
    expect(campaign.length).toBeGreaterThan(0);
    for (const level of campaign) {
      expect(level.terrain.length).toBe(ConfigRegistry.getGame().grid.mapHeight);
    }
  });

  it('rejects a level without a player start', () => {
    const bp = blueprint();
    delete (bp as Partial<LevelBlueprint>).playerStart;
    expect(() => ConfigRegistry.compileBlueprint(bp)).toThrow(InvalidLevelError);
  });

  it('rejects a player start outside the grid', () => {
    const bp = blueprint({ playerStart: { x: 40, y: 40, dir: 'N' } });
    expect(() => ConfigRegistry.compileBlueprint(bp)).toThrow(InvalidLevelError);
  });

  it('drops entities and links outside the grid', () => {
    const level = ConfigRegistry.compileBlueprint(
      blueprint({
        entities: [
          { x: 2, y: 2, type: 'bug', dir: 'N' },
          { x: 40, y: 40, type: 'bug', dir: 'N' }
        ],
        trapLinks: [{ buttonX: 1, buttonY: 2, trapX: -1, trapY: 3 }],
        cloneLinks: [
          { buttonX: 1, buttonY: 2, clonerX: 3, clonerY: 3, templateType: 'bug', templateDir: 'E' }
        ]
      })
    );
    expect(level.entities).toHaveLength(1);
    expect(level.trapLinks).toHaveLength(0);
    expect(level.cloneLinks).toHaveLength(1);
  });

  it('normalizes missing numeric fields and password', () => {
    const bp = blueprint({ password: '' });
    (bp as unknown as Record<string, unknown>).timeLimitSeconds = 'soon';
    (bp as unknown as Record<string, unknown>).chipsRequired = -4;
    const level = ConfigRegistry.compileBlueprint(bp);
    expect(level.timeLimitSeconds).toBe(0);
    expect(level.chipsRequired).toBe(0);
    expect(level.password).toBe(DEFAULT_LEVEL_PASSWORD);
  });

  it('gives procedural and custom packs a translation key', () => {
    ConfigRegistry.setProceduralLevels([ConfigRegistry.compileBlueprint(blueprint())]);
    const procedural = ConfigRegistry.getAllPacks().find((p) => p.levels.length === 1);
    expect(procedural?.i18nKey).toBeTruthy();
  });
});

describe('assertConfigShape', () => {
  it('reports the missing keys', () => {
    expect(() => assertConfigShape('game.json', { grid: {} }, ['grid', 'timing'])).toThrow(
      ConfigLoadError
    );
  });

  it('rejects a non-object payload', () => {
    expect(() => assertConfigShape('game.json', [], ['grid'])).toThrow(ConfigLoadError);
  });
});
