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

/**
 * 32-Bit Retro rasterizer: derives a 2x sprite from a 16-bit sprite (material map, shape-aware
 * Scale2x, height field, lighting, ramp lookup with light ordered dithering, 15-bit colours).
 * Sprites that are not full tiles (glyphs, digits and signs) are only upscaled and flat-shaded.
 */

import {
  RETRO_SINGLE_TONE_RAMPS,
  RETRO_SPRITE_SIZE,
  type RetroRamps,
  type RetroSprite
} from '../retroSprites';
import { Rgb, parseHexColour, quantizeColour } from './colour';
import { RampTraits, shadePositions } from './heightfield';
import { MATERIAL_NONE, buildMaterialMap, materialRamp } from './materials';
import { scale2x } from './scale2x';

/** Upscale factor from a 16-bit sprite to its 32-bit version. */
const UPSCALE = 2;
/** Side of a tile sprite of the 32-Bit Retro style in pixels. */
export const RETRO32_SPRITE_SIZE = RETRO_SPRITE_SIZE * UPSCALE;
/** Strength of the ordered dither between adjacent tones (0 = none, 1 = full Bayer range). */
export const DITHER_STRENGTH = 0.5;

const BYTES_PER_PIXEL = 4;
const ALPHA_OFFSET = 3;
const OPAQUE_ALPHA = 255;
/** Dither threshold neutral point. */
const DITHER_MIDPOINT = 0.5;
const BAYER_SIZE = 4;
/** 4x4 Bayer matrix of ranks 0..15. */
const BAYER_4X4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER_CELLS = BAYER_SIZE * BAYER_SIZE;

function bayerThreshold(x: number, y: number): number {
  const rank = BAYER_4X4[(y % BAYER_SIZE) * BAYER_SIZE + (x % BAYER_SIZE)];
  return (rank + DITHER_MIDPOINT) / BAYER_CELLS;
}

/** Quantised colours of a 32-bit ramp, memoised per name. */
class RampColours {
  private readonly byName = new Map<string, Rgb[]>();

  constructor(private readonly ramps32: RetroRamps) {}

  get(name: string): readonly Rgb[] {
    let colours = this.byName.get(name);
    if (!colours) {
      colours = (this.ramps32[name] ?? []).map((hex) => quantizeColour(parseHexColour(hex)));
      this.byName.set(name, colours);
    }
    return colours;
  }
}

function rampTraits(rampNames: readonly string[], ramps16: RetroRamps, lit: boolean): RampTraits[] {
  return rampNames.map((name) => {
    const tones = ramps16[name]?.length ?? 1;
    return { tones, shaded: lit && tones > 1 && !RETRO_SINGLE_TONE_RAMPS.includes(name) };
  });
}

/** Index in a ramp for a position (0..1); the fractional part is dithered when asked. */
function rampIndex(position: number, length: number, dither: boolean, x: number, y: number): number {
  const scaled = position * (length - 1);
  if (!dither) return Math.round(scaled);
  const lower = Math.floor(scaled);
  const threshold = DITHER_MIDPOINT + (bayerThreshold(x, y) - DITHER_MIDPOINT) * DITHER_STRENGTH;
  return scaled - lower > threshold ? Math.min(lower + 1, length - 1) : lower;
}

/**
 * RGBA pixels (2 * width by 2 * height) of the 32-Bit Retro version of a 16-bit sprite.
 * swapRamp names the ramp used for `$` tones, as in the 16-bit rasterizer. Only sprites of the
 * full tile size are lit; any other size (glyphs, digits, signs) is upscaled and flat-shaded.
 */
export function rasterizeSprite32(
  sprite: RetroSprite,
  ramps32: RetroRamps,
  ramps16: RetroRamps,
  swapRamp?: string
): Uint8ClampedArray {
  const outWidth = sprite.width * UPSCALE;
  const outHeight = sprite.height * UPSCALE;
  const map = buildMaterialMap(sprite, ramps16, ramps32, swapRamp);
  const ids = scale2x(map.ids, sprite.width, sprite.height);
  const lit = sprite.width === RETRO_SPRITE_SIZE && sprite.height === RETRO_SPRITE_SIZE;
  const traits = rampTraits(map.rampNames, ramps16, lit);
  const positions = shadePositions(ids, outWidth, outHeight, traits);
  const colours = new RampColours(ramps32);
  const coloursByRamp = map.rampNames.map((name) => colours.get(name));
  const out = new Uint8ClampedArray(outWidth * outHeight * BYTES_PER_PIXEL);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const i = y * outWidth + x;
      if (ids[i] === MATERIAL_NONE) continue;
      const ramp = materialRamp(ids[i]);
      const ramp32 = coloursByRamp[ramp];
      if (ramp32.length === 0) continue;
      const colour = ramp32[rampIndex(positions[i], ramp32.length, traits[ramp].shaded, x, y)];
      const o = i * BYTES_PER_PIXEL;
      out[o] = colour[0];
      out[o + 1] = colour[1];
      out[o + 2] = colour[2];
      out[o + ALPHA_OFFSET] = OPAQUE_ALPHA;
    }
  }
  return out;
}
