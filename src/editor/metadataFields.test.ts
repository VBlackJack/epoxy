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
import { parseChipsRequired, parseTimeLimit } from './metadataFields';

const CURRENT = 180;

describe('parseTimeLimit', () => {
  it('keeps the current value for an empty entry', () => {
    expect(parseTimeLimit('', CURRENT)).toBe(CURRENT);
    expect(parseTimeLimit('   ', CURRENT)).toBe(CURRENT);
  });

  it('accepts 0 as untimed instead of falling back', () => {
    expect(parseTimeLimit('0', CURRENT)).toBe(0);
  });

  it('floors a finite number and clamps it to zero or more', () => {
    expect(parseTimeLimit('90.9', CURRENT)).toBe(90);
    expect(parseTimeLimit('-5', CURRENT)).toBe(0);
    expect(parseTimeLimit('300', CURRENT)).toBe(300);
  });

  it('keeps the current value for an invalid entry', () => {
    expect(parseTimeLimit('abc', CURRENT)).toBe(CURRENT);
    expect(parseTimeLimit('Infinity', CURRENT)).toBe(CURRENT);
    expect(parseTimeLimit('NaN', CURRENT)).toBe(CURRENT);
  });
});

describe('parseChipsRequired', () => {
  it('follows the same rules', () => {
    expect(parseChipsRequired('', 4)).toBe(4);
    expect(parseChipsRequired('0', 4)).toBe(0);
    expect(parseChipsRequired('2.7', 4)).toBe(2);
    expect(parseChipsRequired('-1', 4)).toBe(0);
    expect(parseChipsRequired('x', 4)).toBe(4);
  });
});
