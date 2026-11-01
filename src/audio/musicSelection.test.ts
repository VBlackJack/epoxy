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
import { customIdsForStorage, pickTrack, sanitizeMusicSettings, TrackPickContext } from './musicSelection';

const ALL = ['a', 'b', 'c'];

/** Deterministic generator (mulberry32) so the tests do not depend on Math.random. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function context(overrides: Partial<TrackPickContext> = {}): TrackPickContext {
  return {
    themeTrackId: 'b',
    allIds: ALL,
    customIds: ALL,
    previousId: null,
    excludedIds: new Set(),
    random: seeded(1),
    ...overrides
  };
}

describe('pickTrack', () => {
  it('returns the theme track in default mode', () => {
    expect(pickTrack('default', context())).toBe('b');
  });

  it('returns null in default mode when the theme track is unknown, missing or excluded', () => {
    expect(pickTrack('default', context({ themeTrackId: 'zzz' }))).toBeNull();
    expect(pickTrack('default', context({ themeTrackId: null }))).toBeNull();
    expect(pickTrack('default', context({ excludedIds: new Set(['b']) }))).toBeNull();
  });

  it('never repeats the previous track in random mode over many picks', () => {
    const random = seeded(42);
    let previous: string | null = 'a';
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id: string | null = pickTrack('random', context({ previousId: previous, random }));
      expect(id).not.toBeNull();
      expect(id).not.toBe(previous);
      seen.add(id as string);
      previous = id;
    }
    expect(seen.size).toBe(ALL.length);
  });

  it('never repeats the previous track in custom mode and stays among the ticked ones', () => {
    const random = seeded(7);
    let previous: string | null = 'a';
    for (let i = 0; i < 300; i++) {
      const id: string | null = pickTrack('custom', context({ customIds: ['a', 'c'], previousId: previous, random }));
      expect(['a', 'c']).toContain(id);
      expect(id).not.toBe(previous);
      previous = id;
    }
  });

  it('allows the only eligible track to repeat', () => {
    expect(pickTrack('custom', context({ customIds: ['c'], previousId: 'c' }))).toBe('c');
    expect(pickTrack('random', context({ allIds: ['a'], previousId: 'a' }))).toBe('a');
  });

  it('skips excluded tracks and returns null when none is left', () => {
    const random = seeded(3);
    for (let i = 0; i < 100; i++) {
      expect(pickTrack('random', context({ excludedIds: new Set(['a', 'b']), random }))).toBe('c');
    }
    expect(pickTrack('random', context({ excludedIds: new Set(ALL) }))).toBeNull();
    expect(pickTrack('custom', context({ customIds: ['a'], excludedIds: new Set(['a']) }))).toBeNull();
  });

  it('ignores custom ids that are not real tracks and stays in range for a random close to 1', () => {
    expect(pickTrack('custom', context({ customIds: ['nope'] }))).toBeNull();
    expect(pickTrack('random', context({ random: () => 0.9999999 }))).toBeTruthy();
  });
});

describe('sanitizeMusicSettings', () => {
  it('keeps a valid mode and a valid list', () => {
    expect(sanitizeMusicSettings('custom', ['b', 'a'], ALL, 'default')).toEqual({ mode: 'custom', customIds: ['b', 'a'] });
  });

  it('replaces an unknown mode with the default mode', () => {
    expect(sanitizeMusicSettings('shuffle', ['a'], ALL, 'random').mode).toBe('random');
    expect(sanitizeMusicSettings(undefined, undefined, ALL, 'default').mode).toBe('default');
    expect(sanitizeMusicSettings(42, undefined, ALL, 'default').mode).toBe('default');
  });

  it('drops non-strings, duplicates and unknown ids', () => {
    expect(sanitizeMusicSettings('custom', ['a', 3, null, 'a', 'zzz', 'c'], ALL, 'default').customIds).toEqual(['a', 'c']);
  });

  it('falls back to every track when nothing valid is left', () => {
    expect(sanitizeMusicSettings('custom', [], ALL, 'default').customIds).toEqual(ALL);
    expect(sanitizeMusicSettings('custom', ['zzz'], ALL, 'default').customIds).toEqual(ALL);
    expect(sanitizeMusicSettings('custom', 'a', ALL, 'default').customIds).toEqual(ALL);
  });
});

describe('customIdsForStorage', () => {
  it('stores an empty list when every track is ticked, and reads it back as every track', () => {
    expect(customIdsForStorage(['a', 'b', 'c'], ALL)).toEqual([]);
    expect(sanitizeMusicSettings('custom', customIdsForStorage(ALL, ALL), [...ALL, 'd'], 'default').customIds).toEqual([
      'a',
      'b',
      'c',
      'd'
    ]);
  });

  it('stores a partial selection as it is', () => {
    expect(customIdsForStorage(['c', 'a'], ALL)).toEqual(['c', 'a']);
  });
});
