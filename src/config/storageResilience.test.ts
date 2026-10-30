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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigRegistry } from './ConfigRegistry';
import {
  ensureUniqueLevelIds,
  isCompiledLevelShape,
  sanitizeStoredLevels,
  stripInvalidTextFields
} from './ConfigValidation';
import { CompiledLevel, LevelBlueprint } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';

function blueprint(overrides: Partial<LevelBlueprint> = {}): LevelBlueprint {
  return {
    id: 'res_level',
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

function level(id: string | undefined): CompiledLevel {
  const compiled = ConfigRegistry.compileBlueprint(blueprint());
  return { ...compiled, id: id as string };
}

describe('level text fields', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('drops a non-string titleKey when compiling a blueprint', () => {
    const compiled = ConfigRegistry.compileBlueprint(
      blueprint({ titleKey: 5 as unknown as string, customHint: 'Keep me' })
    );
    expect('titleKey' in compiled).toBe(false);
    expect(compiled.customHint).toBe('Keep me');
  });

  it('keeps the text fields that are strings', () => {
    const compiled = ConfigRegistry.compileBlueprint(
      blueprint({ titleKey: 'a.b.c', customTitle: 'T', hintKey: 'h.k', customHint: 'H' })
    );
    expect(compiled).toMatchObject({ titleKey: 'a.b.c', customTitle: 'T', hintKey: 'h.k', customHint: 'H' });
  });

  it('strips a bad field from a persisted level instead of dropping the level', () => {
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const stored = { ...level('a'), titleKey: 5, hintKey: { x: 1 }, customTitle: 'Fine' };
    expect(isCompiledLevelShape(stored, bounds)).toBe(true);
    const [kept] = sanitizeStoredLevels([stored, { nonsense: true }], bounds);
    expect(kept.id).toBe('a');
    expect('titleKey' in kept).toBe(false);
    expect('hintKey' in kept).toBe(false);
    expect(kept.customTitle).toBe('Fine');
  });

  it('does not mutate the level it strips', () => {
    const stored = { ...level('a'), titleKey: 5 } as unknown as CompiledLevel;
    stripInvalidTextFields(stored);
    expect((stored as unknown as Record<string, unknown>).titleKey).toBe(5);
  });
});

describe('ensureUniqueLevelIds', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('keeps distinct ids untouched', () => {
    const input = [level('a'), level('b')];
    expect(ensureUniqueLevelIds(input, 'p').map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('numbers repeated ids and keeps the first holder', () => {
    const ids = ensureUniqueLevelIds([level('a'), level('a'), level('a')], 'p').map((l) => l.id);
    expect(ids).toEqual(['a', 'a_2', 'a_3']);
  });

  it('gives missing ids a unique prefixed id', () => {
    const ids = ensureUniqueLevelIds([level(undefined), level(''), level('p_1')], 'p').map((l) => l.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(ids[2]).toBe('p_1');
  });

  it('does not reuse an id another level already holds', () => {
    const ids = ensureUniqueLevelIds([level('a'), level('a'), level('a_2')], 'p').map((l) => l.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[2]).toBe('a_2');
  });

  it('registers an imported pack with unique ids', async () => {
    const { pack } = await ConfigRegistry.registerImportedPack('DUP', [level('x'), level('x')]);
    expect(new Set(pack.levels.map((l) => l.id)).size).toBe(2);
  });
});

describe('persistence failures', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports persisted false but keeps the level when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      }
    });
    const result = ConfigRegistry.addOrUpdateCustomLevel(level('custom_fail'));
    expect(result.persisted).toBe(false);
    expect(ConfigRegistry.getLevels().some((l) => l.id === 'custom_fail')).toBe(true);
  });

  it('reports persisted true when the write succeeds', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value)
    });
    expect(ConfigRegistry.addOrUpdateCustomLevel(level('custom_ok')).persisted).toBe(true);
    expect(store.size).toBeGreaterThan(0);
  });

  it('reports persisted false for an imported pack when the store is unavailable', async () => {
    const { persisted, pack } = await ConfigRegistry.registerImportedPack('NOSTORE', [level('z')]);
    expect(persisted).toBe(false);
    expect(ConfigRegistry.getAllPacks().some((p) => p.id === pack.id)).toBe(true);
  });
});

describe('game.json keybindings', () => {
  it('binds no action to Tab, which the browser keeps for focus', () => {
    const { keybindings } = loadTestConfigs().game;
    for (const [action, codes] of Object.entries(keybindings)) {
      expect(codes, action).not.toContain('Tab');
    }
  });

  it('defines a positive integer import size limit', () => {
    const { maxFileBytes } = loadTestConfigs().game.import;
    expect(Number.isInteger(maxFileBytes) && maxFileBytes > 0).toBe(true);
  });
});
