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

/** Backdrop colour around the level: the wall colour mixed with black. Pure module. */

/** Share of black mixed into the wall colour to make the backdrop around the level. */
export const BACKDROP_BLACK_MIX = 0.45;
/** Backdrop used when no wall colour can be resolved. */
export const BACKDROP_FALLBACK_COLOUR = '#0b0d14';
/** Backdrop colour per sprite style when its wall ramp is missing from the config. */
export const BACKDROP_SPRITE_FALLBACK = '#1a1c2a';
const HEX_RADIX = 16;
const HEX_SHORT_LENGTH = 3;
const HEX_LONG_LENGTH = 6;
const RGB_CHANNEL_MAX = 255;

/** Wall colour mixed with black as a CSS colour, or null when the notation is not a hex colour. */
export function darkenHexColour(colour: string, blackMix: number): string | null {
  let hex = colour.trim().replace(/^#/, '');
  if (hex.length === HEX_SHORT_LENGTH) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== HEX_LONG_LENGTH || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const keep = 1 - blackMix;
  const channels = [0, 2, 4].map((at) => Math.round(parseInt(hex.slice(at, at + 2), HEX_RADIX) * keep));
  return `rgb(${channels.map((c) => Math.min(RGB_CHANNEL_MAX, Math.max(0, c))).join(', ')})`;
}

/** Mean of hex colours as one hex colour, or null when the list is empty or holds a non-hex one. */
export function averageHexColours(colours: readonly string[]): string | null {
  if (colours.length === 0) return null;
  const sums = [0, 0, 0];
  for (const colour of colours) {
    const hex = colour.trim().replace(/^#/, '');
    if (hex.length !== HEX_LONG_LENGTH || !/^[0-9a-fA-F]+$/.test(hex)) return null;
    for (let i = 0; i < sums.length; i++) sums[i] += parseInt(hex.slice(i * 2, i * 2 + 2), HEX_RADIX);
  }
  return `#${sums.map((s) => Math.round(s / colours.length).toString(HEX_RADIX).padStart(2, '0')).join('')}`;
}

