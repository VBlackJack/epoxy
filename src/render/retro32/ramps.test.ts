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
import { createTestBundle } from '../../test/loadTestConfigs';
import { RETRO_DEFAULT_THEME_ID, resolveRetroRamps } from '../retroSprites';
import { isFifteenBitColour, luminance, parseHexColour } from './colour';
import { RETRO32_RAMP_TONES, deriveRetro32Ramps } from './ramps';

const palettes = createTestBundle().game.retroPalettes as Record<string, Record<string, string[]>>;
const ramps16 = resolveRetroRamps(palettes, RETRO_DEFAULT_THEME_ID);
const lum = (hex: string): number => luminance(parseHexColour(hex));

describe('isFifteenBitColour', () => {
  it('accepts expanded 5-bit levels and rejects the rest', () => {
    expect(isFifteenBitColour(0, 0, 0)).toBe(true);
    expect(isFifteenBitColour(255, 255, 255)).toBe(true);
    expect(isFifteenBitColour(0x21, 0, 0)).toBe(true);
    expect(isFifteenBitColour(9, 16, 24)).toBe(false);
    expect(isFifteenBitColour(1, 0, 0)).toBe(false);
    expect(isFifteenBitColour(256, 0, 0)).toBe(false);
    expect(isFifteenBitColour(0.5, 0, 0)).toBe(false);
  });
});

describe('deriveRetro32Ramps', () => {
  const derived = deriveRetro32Ramps(ramps16);

  it('keeps every ramp name', () => {
    expect(Object.keys(derived).sort()).toEqual(Object.keys(ramps16).sort());
  });

  it('gives 8 tones to multi-tone ramps and keeps single-tone ramps single', () => {
    for (const [name, tones] of Object.entries(ramps16)) {
      expect(derived[name], name).toHaveLength(tones.length > 1 ? RETRO32_RAMP_TONES : 1);
    }
  });

  it('orders multi-tone ramps from light to dark at the ends', () => {
    for (const [name, tones] of Object.entries(derived)) {
      if (tones.length < 2) continue;
      expect(lum(tones[0]), name).toBeGreaterThan(lum(tones[tones.length - 1]));
    }
  });

  it('extends beyond the 16-bit ends', () => {
    const water = derived.water.map(lum);
    const source = ramps16.water.map(lum);
    expect(water[0]).toBeGreaterThanOrEqual(Math.max(...source));
    expect(water[water.length - 1]).toBeLessThanOrEqual(Math.min(...source));
  });

  it('quantises every colour to 15 bits', () => {
    for (const tones of Object.values(derived)) {
      for (const hex of tones) {
        const [r, g, b] = parseHexColour(hex);
        expect(isFifteenBitColour(r, g, b), hex).toBe(true);
      }
    }
  });

  it('is deterministic and does not mutate its input', () => {
    const before = JSON.stringify(ramps16);
    expect(deriveRetro32Ramps(ramps16)).toEqual(derived);
    expect(JSON.stringify(ramps16)).toBe(before);
  });

  it('lets overrides replace whole ramps, quantised to 15 bits', () => {
    const merged = deriveRetro32Ramps(ramps16, { floor: ['#ffffff', '#080808'], extra: ['#123456'] });
    expect(merged.floor).toHaveLength(2);
    expect(merged.floor[0]).toBe('#ffffff');
    expect(merged.extra).toHaveLength(1);
    expect(merged.wall).toEqual(derived.wall);
  });
});
