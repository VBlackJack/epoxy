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
import {
  effectiveVolume,
  sanitizeVolumePercent,
  VOLUME_PERCENT_DEFAULT,
  VOLUME_PERCENT_MAX,
  VOLUME_PERCENT_MIN,
  VOLUME_PERCENT_STEP
} from './volumeSettings';

describe('sanitizeVolumePercent', () => {
  it('uses the default for anything that is not a finite number', () => {
    for (const raw of [undefined, null, '50', true, {}, [], Number.NaN, Infinity, -Infinity]) {
      expect(sanitizeVolumePercent(raw), String(raw)).toBe(VOLUME_PERCENT_DEFAULT);
    }
  });

  it('clamps out-of-range numbers', () => {
    expect(sanitizeVolumePercent(-5)).toBe(VOLUME_PERCENT_MIN);
    expect(sanitizeVolumePercent(103)).toBe(VOLUME_PERCENT_MAX);
    expect(sanitizeVolumePercent(10_000)).toBe(VOLUME_PERCENT_MAX);
  });

  it('snaps to the slider step', () => {
    expect(sanitizeVolumePercent(37)).toBe(35);
    expect(sanitizeVolumePercent(38)).toBe(40);
    expect(sanitizeVolumePercent(0)).toBe(0);
    expect(sanitizeVolumePercent(100)).toBe(100);
    expect(sanitizeVolumePercent(VOLUME_PERCENT_STEP)).toBe(VOLUME_PERCENT_STEP);
  });

  it('defaults to today loudness', () => {
    expect(VOLUME_PERCENT_DEFAULT).toBe(VOLUME_PERCENT_MAX);
  });
});

describe('effectiveVolume', () => {
  it('multiplies master volume, category volume and the percentage', () => {
    expect(effectiveVolume(0.25, 0.6, 100)).toBeCloseTo(0.15, 10);
    expect(effectiveVolume(0.25, 0.6, 50)).toBeCloseTo(0.075, 10);
    expect(effectiveVolume(0.25, 0.6, 0)).toBe(0);
  });
});
