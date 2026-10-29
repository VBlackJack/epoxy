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
import { clampStartLevel, parseSeedInput, readStoredSeed, SEED_MAX_VALUE } from './proceduralPack';

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

describe('clampStartLevel', () => {
  it('keeps values inside 1..count', () => {
    expect(clampStartLevel(5, 10)).toBe(5);
    expect(clampStartLevel(0, 10)).toBe(1);
    expect(clampStartLevel(11, 10)).toBe(10);
    expect(clampStartLevel(3.9, 10)).toBe(3);
  });

  it('falls back to 1 for non numbers and tiny packs', () => {
    expect(clampStartLevel(Number.NaN, 10)).toBe(1);
    expect(clampStartLevel(4, 0)).toBe(1);
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
