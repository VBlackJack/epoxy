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
import { ProceduralGenerator } from '../core/ProceduralGenerator';
import {
  parseSeedInput,
  parseStartLevelInput,
  readStoredEndlessProgress,
  readStoredSeed,
  recordReachedLevel,
  SEED_MAX_VALUE,
  suggestStartLevel
} from './proceduralPack';

describe('parseSeedInput', () => {
  it('treats empty or blank input as a random seed request', () => {
    expect(parseSeedInput('')).toEqual({ valid: true, seed: null });
    expect(parseSeedInput('   ')).toEqual({ valid: true, seed: null });
  });

  it('accepts decimal seeds, trimmed, including the bounds', () => {
    expect(parseSeedInput(' 12345 ')).toEqual({ valid: true, seed: 12345 });
    expect(parseSeedInput('0')).toEqual({ valid: true, seed: 0 });
    expect(parseSeedInput(String(SEED_MAX_VALUE))).toEqual({ valid: true, seed: SEED_MAX_VALUE });
  });

  it('rejects values outside uint32 and non decimal text', () => {
    expect(parseSeedInput(String(SEED_MAX_VALUE + 1))).toEqual({ valid: false });
    expect(parseSeedInput('-5')).toEqual({ valid: false });
    expect(parseSeedInput('12.5')).toEqual({ valid: false });
    expect(parseSeedInput('abc')).toEqual({ valid: false });
    expect(parseSeedInput('1e3')).toEqual({ valid: false });
    expect(parseSeedInput('99999999999999999999999')).toEqual({ valid: false });
  });

  it('accepts every seed createSeed produces', () => {
    const seed = ProceduralGenerator.createSeed();
    expect(parseSeedInput(String(seed))).toEqual({ valid: true, seed });
  });
});

describe('parseStartLevelInput', () => {
  it('treats empty input as level 1', () => {
    expect(parseStartLevelInput('')).toEqual({ valid: true, level: 1 });
    expect(parseStartLevelInput('  ')).toEqual({ valid: true, level: 1 });
  });

  it('accepts any whole level from 1 with no upper bound', () => {
    expect(parseStartLevelInput('1')).toEqual({ valid: true, level: 1 });
    expect(parseStartLevelInput(' 250 ')).toEqual({ valid: true, level: 250 });
    expect(parseStartLevelInput('1000000')).toEqual({ valid: true, level: 1000000 });
  });

  it('rejects zero, negatives, decimals, text and unsafe integers', () => {
    for (const raw of ['0', '-3', '2.5', 'abc', '1e3', '99999999999999999999999']) {
      expect(parseStartLevelInput(raw)).toEqual({ valid: false });
    }
  });
});

describe('endless progress', () => {
  it('reads back a stored run and rejects malformed values', () => {
    expect(readStoredEndlessProgress('{"seed":42,"reachedLevel":7}')).toEqual({ seed: 42, reachedLevel: 7 });
    expect(readStoredEndlessProgress(null)).toBeNull();
    expect(readStoredEndlessProgress('not json')).toBeNull();
    expect(readStoredEndlessProgress('{"seed":-1,"reachedLevel":7}')).toBeNull();
    expect(readStoredEndlessProgress('{"seed":42,"reachedLevel":0}')).toBeNull();
    expect(readStoredEndlessProgress('{"seed":42}')).toBeNull();
    expect(readStoredEndlessProgress('null')).toBeNull();
  });

  it('keeps the best level of a seed and restarts on a new seed', () => {
    const first = recordReachedLevel(null, 5, 3);
    expect(first).toEqual({ seed: 5, reachedLevel: 3 });
    expect(recordReachedLevel(first, 5, 2)).toEqual({ seed: 5, reachedLevel: 3 });
    expect(recordReachedLevel(first, 5, 9)).toEqual({ seed: 5, reachedLevel: 9 });
    expect(recordReachedLevel(first, 6, 1)).toEqual({ seed: 6, reachedLevel: 1 });
  });

  it('proposes the reached level only when the seed field holds the last seed', () => {
    const progress = { seed: 123, reachedLevel: 14 };
    expect(suggestStartLevel(progress, '123')).toBe(14);
    expect(suggestStartLevel(progress, ' 123 ')).toBe(14);
    expect(suggestStartLevel(progress, '124')).toBe(1);
    expect(suggestStartLevel(progress, '')).toBe(1);
    expect(suggestStartLevel(progress, 'abc')).toBe(1);
    expect(suggestStartLevel(null, '123')).toBe(1);
  });
});
describe('readStoredSeed', () => {
  it('returns the seed only for valid stored values', () => {
    expect(readStoredSeed('42')).toBe(42);
    expect(readStoredSeed(null)).toBeNull();
    expect(readStoredSeed('garbage')).toBeNull();
    expect(readStoredSeed('')).toBeNull();
  });
});
