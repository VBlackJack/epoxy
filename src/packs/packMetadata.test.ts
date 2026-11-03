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
import { LevelPack } from '../core/types';
import { clampPackMetadata, normalizePackAuthor, normalizePackDescription, withPackMetadata } from './packMetadata';

const LIMITS = { authorMaxLength: 10, descriptionMaxLength: 20 };

function pack(extra: Partial<LevelPack> = {}): LevelPack {
  return { id: 'p', name: 'P', builtIn: false, userCreated: true, levels: [], ...extra };
}

describe('packMetadata', () => {
  it('trims and cuts the author, and unifies line breaks of the description', () => {
    expect(normalizePackAuthor('  A very long author name ', LIMITS)).toBe('A very lon');
    expect(normalizePackDescription('a\r\nb\rc', LIMITS)).toBe('a\nb\nc');
    expect(normalizePackDescription('x'.repeat(50), LIMITS)).toHaveLength(LIMITS.descriptionMaxLength);
  });

  it('clamps an untrusted record and drops non-string and blank fields', () => {
    expect(clampPackMetadata({ author: 'Bob', description: 'Hi' }, LIMITS)).toEqual({ author: 'Bob', description: 'Hi' });
    expect(clampPackMetadata({ author: 42, description: ['x'] }, LIMITS)).toEqual({});
    expect(clampPackMetadata({ author: '   ', description: '' }, LIMITS)).toEqual({});
    expect(clampPackMetadata(null, LIMITS)).toEqual({});
    expect(clampPackMetadata({ author: 'x'.repeat(99) }, LIMITS).author).toHaveLength(LIMITS.authorMaxLength);
  });

  it('sets, keeps and clears fields on a pack', () => {
    const base = pack();
    const withAuthor = withPackMetadata(base, { author: ' Ann ' }, LIMITS);
    expect(withAuthor.author).toBe('Ann');
    expect('description' in withAuthor).toBe(false);
    const both = withPackMetadata(withAuthor, { description: 'Line 1\nLine 2' }, LIMITS);
    expect(both).toMatchObject({ author: 'Ann', description: 'Line 1\nLine 2' });
    const cleared = withPackMetadata(both, { author: '  ' }, LIMITS);
    expect('author' in cleared).toBe(false);
    expect(cleared.description).toBe('Line 1\nLine 2');
  });

  it('returns the same pack when nothing changes', () => {
    const base = pack({ author: 'Ann' });
    expect(withPackMetadata(base, { author: 'Ann ' }, LIMITS)).toBe(base);
    expect(withPackMetadata(base, {}, LIMITS)).toBe(base);
    expect(withPackMetadata(pack(), { description: '  ' }, LIMITS)).toEqual(pack());
  });
});
