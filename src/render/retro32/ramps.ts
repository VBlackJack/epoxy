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
 * Ramps of the 32-Bit Retro style. Each multi-tone ramp of the 16-Bit style is stretched to
 * RETRO32_RAMP_TONES tones: the tones are placed on a piecewise-linear path in sRGB that starts
 * a little lighter and ends a little darker than the 16-bit ramp, then the path is sampled at
 * evenly spaced positions. Tone 0 is the lightest, as in the 16-bit ramps. Every colour is
 * quantised to 15 bits. A single-tone ramp stays single-tone.
 */

import type { RetroRamps } from '../retroSprites';
import { Rgb, formatHexColour, lerpColour, parseHexColour, quantizeColour } from './colour';

/** Tones of a derived multi-tone ramp. */
export const RETRO32_RAMP_TONES = 8;
/** How far the light end is pulled towards white (0..1). */
export const RETRO32_LIGHT_EXTEND = 0.25;
/** How far the dark end is pulled towards black (0..1). */
export const RETRO32_DARK_EXTEND = 0.35;

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const SINGLE_TONE = 1;

/** The 16-bit tones framed by one lighter and one darker stop. */
function extendedStops(tones: readonly Rgb[]): Rgb[] {
  const lighter = lerpColour(tones[0], WHITE, RETRO32_LIGHT_EXTEND);
  const darker = lerpColour(tones[tones.length - 1], BLACK, RETRO32_DARK_EXTEND);
  return [lighter, ...tones, darker];
}

/** Colour at fractional position (0..1) along a piecewise-linear path of stops. */
function sampleStops(stops: readonly Rgb[], position: number): Rgb {
  const scaled = position * (stops.length - 1);
  const lower = Math.min(Math.floor(scaled), stops.length - 2);
  return lerpColour(stops[lower], stops[lower + 1], scaled - lower);
}

function deriveRamp(hexTones: readonly string[]): string[] {
  const tones = hexTones.map(parseHexColour);
  if (tones.length <= SINGLE_TONE) return tones.map((t) => formatHexColour(quantizeColour(t)));
  const stops = extendedStops(tones);
  const out: string[] = [];
  for (let i = 0; i < RETRO32_RAMP_TONES; i++) {
    out.push(formatHexColour(quantizeColour(sampleStops(stops, i / (RETRO32_RAMP_TONES - 1)))));
  }
  return out;
}

function quantizeRamp(hexTones: readonly string[]): string[] {
  return hexTones.map((hex) => formatHexColour(quantizeColour(parseHexColour(hex))));
}

/**
 * Derives the 8-tone ramps from the 16-bit ramps. overrides (future retro32Palettes of a theme)
 * replace whole ramps; their colours are only quantised to 15 bits.
 */
export function deriveRetro32Ramps(
  ramps16: RetroRamps,
  overrides?: Readonly<Record<string, readonly string[]>>
): RetroRamps {
  const out: Record<string, readonly string[]> = {};
  for (const [name, tones] of Object.entries(ramps16)) out[name] = deriveRamp(tones);
  if (overrides) {
    for (const [name, tones] of Object.entries(overrides)) out[name] = quantizeRamp(tones);
  }
  return out;
}
