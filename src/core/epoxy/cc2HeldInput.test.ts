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
import type { Direction } from '../types';
import { CC2_MAX_HELD_KEYS, hasOpposingPair, resolveCc2HeldOrder } from './cc2HeldInput';

describe('hasOpposingPair', () => {
  it('detects both opposing pairs, alone or inside three keys', () => {
    expect(hasOpposingPair(['N', 'S'])).toBe(true);
    expect(hasOpposingPair(['W', 'E'])).toBe(true);
    expect(hasOpposingPair(['N', 'E', 'S'])).toBe(true);
  });

  it('is false for orthogonal or single keys', () => {
    expect(hasOpposingPair(['N', 'E'])).toBe(false);
    expect(hasOpposingPair(['S'])).toBe(false);
    expect(hasOpposingPair([])).toBe(false);
  });
});

describe('resolveCc2HeldOrder (pure resolution)', () => {
  it('puts the horizontal key first when neither key matches the facing', () => {
    expect(resolveCc2HeldOrder(['N', 'W'], 'S')).toEqual(['W', 'N']);
  });

  it('does not mutate its input', () => {
    const held: Direction[] = ['N', 'E'];
    resolveCc2HeldOrder(held, 'W');
    expect(held).toEqual(['N', 'E']);
  });

  it('reads at most two keys', () => {
    expect(CC2_MAX_HELD_KEYS).toBe(2);
  });
});
