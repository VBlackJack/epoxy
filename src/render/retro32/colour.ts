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
 * Colour helpers of the 32-Bit Retro style: hex parsing, simple sRGB interpolation and the
 * 15-bit (5 bits per channel) quantisation of 32-bit era consoles. Pure module: no DOM.
 */

export type Rgb = readonly [number, number, number];

const HEX_RADIX = 16;
const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const HEX_PREFIX_LENGTH = 1;
const HEX_CHANNEL_DIGITS = 2;
const CHANNEL_COUNT = 3;
const CHANNEL_MAX = 255;
/** Bits kept per channel by the 15-bit colour depth. */
const CHANNEL_BITS = 5;
const CHANNEL_DROPPED_BITS = 8 - CHANNEL_BITS;
const CHANNEL_LEVEL_MAX = (1 << CHANNEL_BITS) - 1;
/** Rec. 601 luma weights. */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

/** Parses #rrggbb; throws on any other shape. */
export function parseHexColour(hex: string): Rgb {
  if (!HEX_COLOUR_PATTERN.test(hex)) throw new Error(`Invalid hex colour: ${hex}`);
  const channel = (i: number): number => {
    const start = HEX_PREFIX_LENGTH + i * HEX_CHANNEL_DIGITS;
    return parseInt(hex.slice(start, start + HEX_CHANNEL_DIGITS), HEX_RADIX);
  };
  return [channel(0), channel(1), channel(2)];
}

/** Formats a colour as lower-case #rrggbb. */
export function formatHexColour(rgb: Rgb): string {
  let out = '#';
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    out += Math.round(rgb[i]).toString(HEX_RADIX).padStart(HEX_CHANNEL_DIGITS, '0');
  }
  return out;
}

/** Expands a 5-bit level to 8 bits by bit replication. */
export function expandLevel(level: number): number {
  return (level << CHANNEL_DROPPED_BITS) | (level >> (CHANNEL_BITS - CHANNEL_DROPPED_BITS));
}

/** Rounds an 8-bit channel to the nearest 15-bit level and expands it back to 8 bits. */
export function quantizeChannel(value: number): number {
  const level = Math.round((value * CHANNEL_LEVEL_MAX) / CHANNEL_MAX);
  return expandLevel(Math.min(CHANNEL_LEVEL_MAX, Math.max(0, level)));
}

export function quantizeColour(rgb: Rgb): Rgb {
  return [quantizeChannel(rgb[0]), quantizeChannel(rgb[1]), quantizeChannel(rgb[2])];
}

/** True when each channel is a value a 5-bit level expands to. */
export function isFifteenBitColour(r: number, g: number, b: number): boolean {
  return [r, g, b].every((c) => Number.isInteger(c) && c >= 0 && c <= CHANNEL_MAX
    && expandLevel(c >> CHANNEL_DROPPED_BITS) === c);
}

/** Linear interpolation in sRGB space (t = 0 gives a, t = 1 gives b). */
export function lerpColour(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function luminance(rgb: Rgb): number {
  return rgb[0] * LUMA_RED + rgb[1] * LUMA_GREEN + rgb[2] * LUMA_BLUE;
}
