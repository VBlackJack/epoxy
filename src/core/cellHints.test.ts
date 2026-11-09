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
import { clampLevelText, isCompiledLevelShape, normalizeCellHints, sanitizeStoredLevels } from '../config/ConfigValidation';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { hintTextAt } from './cellHints';
import { LevelValidator } from './LevelValidator';
import type { CompiledLevel } from './types';

const OFF_TILE_WARNING = 'validator.issues.cell_hint_off_tile.label';

beforeEach(() => {
  loadTestConfigs();
});

/** A 5 x 3 room with an exit, a start and a hint tile at (2, 1). */
function room(overrides: Partial<CompiledLevel> = {}): CompiledLevel {
  const terrain = [
    ['wall', 'wall', 'wall', 'wall', 'wall'],
    ['wall', 'floor', 'hint', 'exit', 'wall'],
    ['wall', 'wall', 'wall', 'wall', 'wall']
  ];
  return {
    ...makeLevel('hints', { terrain }),
    ...overrides
  };
}

describe('hintTextAt', () => {
  const key = (k: string) => `T(${k})`;

  it('shows the text of the tile when it has one', () => {
    expect(hintTextAt({ customHint: 'level', cellHints: [{ x: 2, y: 1, text: 'tile' }] }, 2, 1, key)).toBe('tile');
  });

  it('falls back to the level hint, custom text first then the translated key', () => {
    const cellHints = [{ x: 2, y: 1, text: 'tile' }];
    expect(hintTextAt({ customHint: 'level', cellHints }, 3, 1, key)).toBe('level');
    expect(hintTextAt({ hintKey: 'a.b', cellHints }, 3, 1, key)).toBe('T(a.b)');
    expect(hintTextAt({}, 3, 1, key)).toBe('');
  });
});

describe('normalizeCellHints', () => {
  it('keeps entries inside the grid with a text, one per cell, sorted by row then column', () => {
    const result = normalizeCellHints(
      [
        { x: 3, y: 1, text: 'c' },
        { x: 1, y: 0, text: 'a' },
        { x: 1, y: 0, text: 'a2' },
        { x: 9, y: 0, text: 'outside' },
        { x: 0, y: 0, text: '   ' },
        { x: 0, y: 1, text: 5 },
        'junk'
      ],
      5,
      3
    );
    expect(result).toEqual([
      { x: 1, y: 0, text: 'a2' },
      { x: 3, y: 1, text: 'c' }
    ]);
  });

  it('returns null when nothing is left or the value is not a list', () => {
    expect(normalizeCellHints([], 5, 3)).toBeNull();
    expect(normalizeCellHints(undefined, 5, 3)).toBeNull();
    expect(normalizeCellHints([{ x: 5, y: 0, text: 'x' }], 5, 3)).toBeNull();
  });
});

describe('level loading', () => {
  it('compiles the cell hints of a blueprint and drops the ones outside the grid', () => {
    const level = makeLevel('c', {
      terrain: [['wall', 'wall', 'wall'], ['wall', 'hint', 'exit'], ['wall', 'wall', 'wall']],
      cellHints: [
        { x: 1, y: 1, text: 'here' },
        { x: 7, y: 0, text: 'gone' }
      ]
    } as never);
    expect(level.cellHints).toEqual([{ x: 1, y: 1, text: 'here' }]);
    expect(makeLevel('plain').cellHints).toBeUndefined();
  });

  it('strips a malformed field from a stored level and keeps a good one', () => {
    const good = room({ cellHints: [{ x: 2, y: 1, text: 'ok' }] });
    const bad = { ...room(), cellHints: 'nope' } as unknown as CompiledLevel;
    const [kept, stripped] = sanitizeStoredLevels([good, bad], ConfigRegistry.getLevelSizeBounds());
    expect(kept.cellHints).toEqual([{ x: 2, y: 1, text: 'ok' }]);
    expect('cellHints' in stripped).toBe(false);
  });

  it('refuses, under the strict check, a list longer than the grid', () => {
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const many = Array.from({ length: 16 }, (_, i) => ({ x: i % 5, y: 0, text: 'x' }));
    expect(isCompiledLevelShape(room({ cellHints: many }), bounds, true)).toBe(false);
    expect(isCompiledLevelShape(room({ cellHints: many }), bounds, false)).toBe(true);
  });

  it('cuts a cell hint to the hint length limit', () => {
    const limits = { ...ConfigRegistry.getLevelTextLimits(), hintMaxLength: 5 };
    const cut = clampLevelText(room({ cellHints: [{ x: 2, y: 1, text: 'abcdefghij' }] }), limits);
    expect(cut.cellHints).toEqual([{ x: 2, y: 1, text: 'abcde' }]);
  });
});

describe('validator', () => {
  const warnings = (level: CompiledLevel) => LevelValidator.validate(level).issues.filter((i) => i.i18nKey === OFF_TILE_WARNING);

  it('does not warn about a text on a hint tile', () => {
    expect(warnings(room({ cellHints: [{ x: 2, y: 1, text: 'ok' }] }))).toEqual([]);
  });

  it('warns, without invalidating the level, about a text on a cell that is not a hint tile', () => {
    const level = room({ cellHints: [{ x: 1, y: 1, text: 'lost' }] });
    const found = warnings(level);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
    expect(found[0].params).toEqual({ x: 1, y: 1 });
  });
});
