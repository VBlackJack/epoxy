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
import {
  RETRO_CHAR_PREFIXES,
  RETRO_DEFAULT_THEME_ID,
  RETRO_GLYPH_PREFIX,
  RETRO_SHEET,
  RETRO_SPRITE_NAMES,
  RETRO_SPRITE_SIZE,
  type RetroSprite,
  resolveRetroRamps
} from '../retroSprites';
import { RETRO_SWAP_RAMPS } from '../paletteKeys';
import { isFifteenBitColour, parseHexColour } from './colour';
import { MATERIAL_NONE, buildMaterialMap } from './materials';
import { RETRO32_SPRITE_SIZE, rasterizeSprite32 } from './rasterize';
import { deriveRetro32Ramps } from './ramps';
import { scale2x } from './scale2x';

const BYTES_PER_PIXEL = 4;
const ALPHA_OFFSET = 3;
const OPAQUE_ALPHA = 255;
const GLYPH_SIZE = 5;
const CHAR_WIDTH = 3;
const UPSCALE = 2;
const palettes = createTestBundle().game.retroPalettes as Record<string, Record<string, string[]>>;
const themeIds = Object.keys(palettes);
const ramps16 = resolveRetroRamps(palettes, RETRO_DEFAULT_THEME_ID);
const ramps32 = deriveRetro32Ramps(ramps16);
const swapRamp = Object.values(RETRO_SWAP_RAMPS)[0];

function spriteOf(name: string): RetroSprite {
  return RETRO_SHEET.sprites[name];
}

function alphaAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  return pixels[(y * width + x) * BYTES_PER_PIXEL + ALPHA_OFFSET];
}

function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

describe('rasterizeSprite32', () => {
  it('outputs 32x32 RGBA for a tile sprite', () => {
    expect(RETRO32_SPRITE_SIZE).toBe(RETRO_SPRITE_SIZE * UPSCALE);
    const out = rasterizeSprite32(spriteOf('player_S_0'), ramps32, ramps16);
    expect(out).toHaveLength(RETRO32_SPRITE_SIZE * RETRO32_SPRITE_SIZE * BYTES_PER_PIXEL);
  });

  it('doubles each dimension of glyph and character sprites', () => {
    const glyph = spriteOf(`${RETRO_GLYPH_PREFIX}red`);
    const digit = spriteOf(`${RETRO_CHAR_PREFIXES[0]}0`);
    expect(rasterizeSprite32(glyph, ramps32, ramps16)).toHaveLength(
      GLYPH_SIZE * GLYPH_SIZE * UPSCALE * UPSCALE * BYTES_PER_PIXEL
    );
    expect(rasterizeSprite32(digit, ramps32, ramps16)).toHaveLength(
      CHAR_WIDTH * GLYPH_SIZE * UPSCALE * UPSCALE * BYTES_PER_PIXEL
    );
  });

  it('is deterministic', () => {
    const a = rasterizeSprite32(spriteOf('wall_top'), ramps32, ramps16);
    const b = rasterizeSprite32(spriteOf('wall_top'), ramps32, ramps16);
    expect(sameBytes(a, b)).toBe(true);
  });

  it('uses at most one colour per source tone for flat glyphs', () => {
    const out = rasterizeSprite32(spriteOf(`${RETRO_GLYPH_PREFIX}red`), ramps32, ramps16);
    const seen = new Set<string>();
    for (let o = 0; o < out.length; o += BYTES_PER_PIXEL) {
      if (out[o + ALPHA_OFFSET] !== 0) seen.add(`${out[o]},${out[o + 1]},${out[o + 2]}`);
    }
    expect(seen.size).toBeLessThanOrEqual(ramps16.red.length + 1);
  });

  it('draws the swap ramp only when one is given', () => {
    const sprite = Object.values(RETRO_SHEET.sprites).find((s) =>
      Object.values(s.legend).some((v) => v.startsWith('$.')) && s.rows.some((r) => [...r].some((c) => s.legend[c]?.startsWith('$.')))
    ) as RetroSprite;
    expect(sprite).toBeDefined();
    const withSwap = rasterizeSprite32(sprite, ramps32, ramps16, swapRamp);
    const without = rasterizeSprite32(sprite, ramps32, ramps16);
    expect(sameBytes(withSwap, without)).toBe(false);
  });

  it('paints the outline in the flat outline colour', () => {
    const out = rasterizeSprite32(spriteOf('player_S_0'), ramps32, ramps16);
    const [r, g, b] = parseHexColour(ramps32.outline[0]);
    let found = 0;
    for (let o = 0; o < out.length; o += BYTES_PER_PIXEL) {
      if (out[o + ALPHA_OFFSET] !== 0 && out[o] === r && out[o + 1] === g && out[o + 2] === b) found++;
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('transparency', () => {
  it('matches the Scale2x silhouette of the 16-bit material map', () => {
    for (const name of RETRO_SPRITE_NAMES) {
      const sprite = spriteOf(name);
      const map = buildMaterialMap(sprite, ramps16, ramps32, swapRamp);
      const doubled = scale2x(map.ids, sprite.width, sprite.height);
      const out = rasterizeSprite32(sprite, ramps32, ramps16, swapRamp);
      const width = sprite.width * UPSCALE;
      for (let y = 0; y < sprite.height * UPSCALE; y++) {
        for (let x = 0; x < width; x++) {
          const opaque = alphaAt(out, width, x, y) !== 0;
          if (opaque !== (doubled[y * width + x] !== MATERIAL_NONE)) {
            throw new Error(`${name}: silhouette mismatch at ${x},${y}`);
          }
        }
      }
    }
  });

  it('keeps a transparent 16-bit pixel with transparent neighbours transparent in all four children', () => {
    const sprite = spriteOf('player_S_0');
    const map = buildMaterialMap(sprite, ramps16, ramps32, swapRamp);
    const out = rasterizeSprite32(sprite, ramps32, ramps16, swapRamp);
    const width = sprite.width * UPSCALE;
    let checked = 0;
    for (let y = 1; y < sprite.height - 1; y++) {
      for (let x = 1; x < sprite.width - 1; x++) {
        let isolated = true;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (map.ids[(y + dy) * sprite.width + x + dx] !== MATERIAL_NONE) isolated = false;
          }
        }
        if (!isolated) continue;
        checked++;
        for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          expect(alphaAt(out, width, x * UPSCALE + cx, y * UPSCALE + cy)).toBe(0);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('every sprite in every theme', () => {
  for (const themeId of themeIds) {
    it(`rasterizes all sprites with opaque 15-bit colours in theme ${themeId}`, () => {
      const themeRamps16 = resolveRetroRamps(palettes, themeId);
      const themeRamps32 = deriveRetro32Ramps(themeRamps16);
      for (const name of RETRO_SPRITE_NAMES) {
        for (const swap of [undefined, swapRamp]) {
          const out = rasterizeSprite32(spriteOf(name), themeRamps32, themeRamps16, swap);
          for (let o = 0; o < out.length; o += BYTES_PER_PIXEL) {
            if (out[o + ALPHA_OFFSET] === 0) continue;
            if (out[o + ALPHA_OFFSET] !== OPAQUE_ALPHA || !isFifteenBitColour(out[o], out[o + 1], out[o + 2])) {
              throw new Error(`${themeId} ${name}: bad pixel at byte ${o}`);
            }
          }
        }
      }
    });
  }
});
