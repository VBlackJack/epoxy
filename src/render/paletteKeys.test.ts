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
import rendererSource from './PixelRenderer.ts?raw';
import { createTestBundle } from '../test/loadTestConfigs';
import {
  BOOT_COLOR_KEYS,
  BUTTON_COLOR_KEYS,
  BUTTON_GLYPH_KEYS,
  DEFAULT_BOOT_COLOR_KEY,
  DEFAULT_COLOR_KEY,
  DEFAULT_MONSTER_COLOR_KEY,
  FX_COLOR_KEYS,
  MONSTER_COLOR_KEYS,
  teleporterGlyphKey
} from './paletteKeys';

const palette = createTestBundle().game.palette;

/** Hue band, in degrees, read as green rather than the yellow-orange of the fire boots. */
const GREEN_HUE_MIN_DEG = 90;
const GREEN_HUE_MAX_DEG = 165;
const HEX_RGB_DIGITS = 6;
const CHANNEL_MAX = 255;
const DEGREES_PER_SEXTANT = 60;
const FULL_TURN_DEG = 360;

/** Hue in degrees of a #rrggbb colour. */
function hueOf(hex: string): number {
  const digits = hex.replace('#', '');
  expect(digits).toHaveLength(HEX_RGB_DIGITS);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / CHANNEL_MAX);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) return 0;
  const sextant = max === r ? (g - b) / span : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (sextant * DEGREES_PER_SEXTANT + FULL_TURN_DEG) % FULL_TURN_DEG;
}

describe('renderer palette usage', () => {
  it('reads only palette keys that game.json defines', () => {
    const used = new Set<string>();
    for (const match of rendererSource.matchAll(/\bpal\.([A-Za-z_]\w*)/g)) {
      used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((key) => !(key in palette));
    expect(missing).toEqual([]);
  });

  it('maps identifiers only to palette keys that game.json defines', () => {
    const mapped = [
      ...Object.values(FX_COLOR_KEYS),
      ...Object.values(BUTTON_COLOR_KEYS),
      ...Object.values(BUTTON_GLYPH_KEYS),
      ...Object.values(BOOT_COLOR_KEYS),
      ...Object.values(MONSTER_COLOR_KEYS),
      DEFAULT_BOOT_COLOR_KEY,
      DEFAULT_COLOR_KEY,
      DEFAULT_MONSTER_COLOR_KEY
    ];
    const missing = mapped.filter((key) => !(key in palette));
    expect(missing).toEqual([]);
  });

  it('draws each pair of boots in its own colour, the force floor boots in green', () => {
    const colours = Object.values(BOOT_COLOR_KEYS).map((key) => palette[key]);
    expect(new Set(colours).size).toBe(colours.length);
    const forceHue = hueOf(palette[BOOT_COLOR_KEYS.boots_force]);
    expect(forceHue).toBeGreaterThanOrEqual(GREEN_HUE_MIN_DEG);
    expect(forceHue).toBeLessThanOrEqual(GREEN_HUE_MAX_DEG);
  });

  it('gives a glyph to colour teleporters only', () => {
    const tiles = createTestBundle().tiles.tiles;
    expect(teleporterGlyphKey(tiles.teleport)).toBeNull();
    expect(teleporterGlyphKey(tiles.floor)).toBeNull();
    for (const [id, def] of Object.entries(tiles)) {
      if (!def.isTeleporter || !def.colorKey) continue;
      expect(teleporterGlyphKey(def), id).toBe(def.colorKey);
      expect(def.colorKey in palette).toBe(true);
    }
    expect(teleporterGlyphKey(tiles.teleport_red)).toBe('red');
  });

  it('keeps colour literals out of the renderer', () => {
    const literals = rendererSource.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
    expect(literals).toEqual([]);
  });
});
