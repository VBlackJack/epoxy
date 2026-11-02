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

import { describe, expect, it } from 'vitest';
import { RENDER_STYLES } from '../render/styles/renderStyles';
import { parseGraphicsStyle, resolveSavedLevel, resolveSavedLevelIndex, sanitizeHighScores } from './persistedState';
import { formatMegabytes, isImportSizeAllowed } from '../ui/importLimits';

const GOOD = { bestTimeRemaining: 50, minSteps: 12, bestScore: 900 };

describe('sanitizeHighScores', () => {
  it('drops only the invalid records', () => {
    const result = sanitizeHighScores({
      a: GOOD,
      b: null,
      c: 'text',
      d: { ...GOOD, minSteps: 'x' },
      e: { ...GOOD, bestScore: Number.NaN }
    });
    expect(Object.keys(result)).toEqual(['a']);
  });

  it('returns an empty table for anything that is not an object', () => {
    expect(sanitizeHighScores(null)).toEqual({});
    expect(sanitizeHighScores([GOOD])).toEqual({});
    expect(sanitizeHighScores('x')).toEqual({});
  });

  it('keeps legacy fields and drops a malformed timed replay', () => {
    const result = sanitizeHighScores({
      a: { ...GOOD, replayMoves: ['N', 'E'], replayTimedMoves: [{ tick: 1, dir: 'bogus' }] },
      b: { ...GOOD, replayTimedMoves: [{ tick: 1, dir: 'N' }] }
    });
    expect(result.a.replayMoves).toEqual(['N', 'E']);
    expect(result.a.replayTimedMoves).toBeUndefined();
    expect(result.b.replayTimedMoves).toEqual([{ tick: 1, dir: 'N' }]);
  });

  it('accepts records written without replayMoves', () => {
    const result = sanitizeHighScores({ a: { ...GOOD, replayTimedMoves: [{ tick: 0, dir: 'S' }] } });
    expect('replayMoves' in result.a).toBe(false);
    expect(result.a.replayTimedMoves).toHaveLength(1);
  });
});

describe('resolveSavedLevelIndex', () => {
  it('restores an integer index inside the pack', () => {
    expect(resolveSavedLevelIndex({ packId: 'p', levelIndex: 3 }, 'p', 10)).toBe(3);
    expect(resolveSavedLevelIndex({ packId: 'p', levelIndex: 0 }, 'p', 10)).toBe(0);
  });

  it('rejects fractions, out of range values and other packs', () => {
    expect(resolveSavedLevelIndex({ packId: 'p', levelIndex: 1.5 }, 'p', 10)).toBeNull();
    expect(resolveSavedLevelIndex({ packId: 'p', levelIndex: -1 }, 'p', 10)).toBeNull();
    expect(resolveSavedLevelIndex({ packId: 'p', levelIndex: 10 }, 'p', 10)).toBeNull();
    expect(resolveSavedLevelIndex({ packId: 'p', levelIndex: Number.NaN }, 'p', 10)).toBeNull();
    expect(resolveSavedLevelIndex({ packId: 'q', levelIndex: 2 }, 'p', 10)).toBeNull();
    expect(resolveSavedLevelIndex(null, 'p', 10)).toBeNull();
    expect(resolveSavedLevelIndex({ packId: 'p', levelIndex: '2' }, 'p', 10)).toBeNull();
  });
});

describe('resolveSavedLevel', () => {
  const levels = (...ids: string[]) => ids.map((id) => ({ id }));

  it('follows the saved level id after a reorder', () => {
    const saved = { packId: 'p', levelIndex: 1, levelId: 'b' };
    expect(resolveSavedLevel(saved, 'p', levels('a', 'b', 'c'))).toBe(1);
    expect(resolveSavedLevel(saved, 'p', levels('c', 'a', 'b'))).toBe(2);
    expect(resolveSavedLevel(saved, 'p', levels('b', 'c'))).toBe(0);
  });

  it('falls back to the index for a save without an id', () => {
    expect(resolveSavedLevel({ packId: 'p', levelIndex: 2 }, 'p', levels('a', 'b', 'c'))).toBe(2);
    expect(resolveSavedLevel({ packId: 'p', levelIndex: 5 }, 'p', levels('a', 'b', 'c'))).toBeNull();
  });

  it('falls back to the index when the saved level left the pack', () => {
    expect(resolveSavedLevel({ packId: 'p', levelIndex: 1, levelId: 'gone' }, 'p', levels('a', 'b'))).toBe(1);
    expect(resolveSavedLevel({ packId: 'p', levelIndex: 9, levelId: 'gone' }, 'p', levels('a', 'b'))).toBeNull();
  });

  it('ignores a save of another pack and a non-string id', () => {
    expect(resolveSavedLevel({ packId: 'q', levelIndex: 0, levelId: 'a' }, 'p', levels('a'))).toBeNull();
    expect(resolveSavedLevel({ packId: 'p', levelIndex: 0, levelId: 4 }, 'p', levels('a'))).toBe(0);
    expect(resolveSavedLevel(null, 'p', levels('a'))).toBeNull();
  });
});

describe('parseGraphicsStyle', () => {
  it('accepts the known styles only', () => {
    expect(parseGraphicsStyle('modern')).toBe('modern');
    expect(parseGraphicsStyle('retro')).toBe('retro');
    expect(parseGraphicsStyle('retro32')).toBe('retro32');
    expect(parseGraphicsStyle('Retro32')).toBeUndefined();
    expect(parseGraphicsStyle('neon')).toBeUndefined();
    expect(parseGraphicsStyle(3)).toBeUndefined();
    expect(parseGraphicsStyle(undefined)).toBeUndefined();
  });

  it('round-trips every registered style through JSON settings', () => {
    for (const style of RENDER_STYLES) {
      const stored = JSON.parse(JSON.stringify({ graphicsStyle: style.id })) as { graphicsStyle: unknown };
      expect(parseGraphicsStyle(stored.graphicsStyle)).toBe(style.id);
    }
  });
});

describe('import size check', () => {
  const LIMIT = 1000;

  it('allows a file up to the limit', () => {
    expect(isImportSizeAllowed(0, LIMIT)).toBe(true);
    expect(isImportSizeAllowed(LIMIT, LIMIT)).toBe(true);
  });

  it('rejects a file over the limit and invalid sizes', () => {
    expect(isImportSizeAllowed(LIMIT + 1, LIMIT)).toBe(false);
    expect(isImportSizeAllowed(-1, LIMIT)).toBe(false);
    expect(isImportSizeAllowed(Number.NaN, LIMIT)).toBe(false);
  });

  it('formats the limit in megabytes', () => {
    expect(formatMegabytes(4 * 1024 * 1024)).toBe('4');
    expect(formatMegabytes(1.5 * 1024 * 1024)).toBe('1.5');
  });
});
