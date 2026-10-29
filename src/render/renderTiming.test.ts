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
import { frameScaleFromDelta, REFERENCE_FRAME_MS, scaleDecay, scaleLerpFactor } from './renderTiming';

const MAX_DELTA_MS = 100;

/** Runs `frames` lerp steps of `dtMs` each and returns the remaining distance to the target. */
function remainingAfter(factor: number, dtMs: number, frames: number): number {
  let value = 0;
  const k = scaleLerpFactor(factor, frameScaleFromDelta(dtMs, MAX_DELTA_MS));
  for (let i = 0; i < frames; i++) value += (1 - value) * k;
  return 1 - value;
}

describe('frameScaleFromDelta', () => {
  it('is 1 for one reference frame', () => {
    expect(frameScaleFromDelta(REFERENCE_FRAME_MS, MAX_DELTA_MS)).toBeCloseTo(1, 10);
  });

  it('clamps long pauses and rejects non-positive deltas', () => {
    expect(frameScaleFromDelta(5000, MAX_DELTA_MS)).toBeCloseTo(MAX_DELTA_MS / REFERENCE_FRAME_MS, 10);
    expect(frameScaleFromDelta(0, MAX_DELTA_MS)).toBe(0);
    expect(frameScaleFromDelta(-3, MAX_DELTA_MS)).toBe(0);
    expect(frameScaleFromDelta(Number.NaN, MAX_DELTA_MS)).toBe(0);
  });
});

describe('scaleLerpFactor', () => {
  it('keeps the authored factor at the reference frame rate', () => {
    expect(scaleLerpFactor(0.22, 1)).toBeCloseTo(0.22, 10);
  });

  it('covers the same distance per second at 60, 120 and 144 Hz', () => {
    const at60 = remainingAfter(0.22, 1000 / 60, 30);
    const at120 = remainingAfter(0.22, 1000 / 120, 60);
    const at144 = remainingAfter(0.22, 1000 / 144, 72);
    expect(at120).toBeCloseTo(at60, 10);
    expect(at144).toBeCloseTo(at60, 10);
  });

  it('saturates outside [0, 1]', () => {
    expect(scaleLerpFactor(1, 0.5)).toBe(1);
    expect(scaleLerpFactor(1.5, 2)).toBe(1);
    expect(scaleLerpFactor(0, 2)).toBe(0);
  });
});

describe('scaleDecay', () => {
  it('composes: two half frames equal one full frame', () => {
    const half = scaleDecay(0.85, 0.5);
    expect(half * half).toBeCloseTo(scaleDecay(0.85, 1), 10);
    expect(scaleDecay(0.85, 1)).toBeCloseTo(0.85, 10);
  });
});
