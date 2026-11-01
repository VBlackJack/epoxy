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
 * Recolouring of the sprite ramps for the derived render styles (Pocket, Pastel, Blueprint,
 * Sepia, Classic 90s). A style's fixed palette (game.json renderStylePalettes) becomes a pure
 * ramp transform, applied to the ramps of the base sprite pipeline, and a colour transform for
 * the few colours drawn outside sprites. The transforms keep the number of tones of every ramp.
 * Pure module: no DOM.
 */

import type { RenderStylePaletteConfig } from '../../core/types';
import { Rgb, formatHexColour, lerpColour, luminance, parseHexColour } from '../retro32/colour';
import type { RetroRamps } from '../retroSprites';

/** Recolours the tones of one named ramp; the result has as many tones as the input. */
export type RampTransform = (rampName: string, tones: readonly string[]) => string[];
/** Recolours one #rrggbb colour; anything else is returned unchanged. */
export type ColourTransform = (colour: string) => string;

export interface StyleTransforms {
  readonly ramps: RampTransform;
  readonly colour: ColourTransform;
}

/**
 * Ramps the game colour-codes (keys, doors, buttons, teleporters). Every style must keep them
 * pairwise distinguishable, so a style that cannot do it by hue pins them explicitly.
 */
export const COLOUR_CODED_RAMPS: readonly string[] = ['red', 'blue', 'yellow', 'green'];
/** Smallest colour distance (see colourDistance) between the main tones of two colour-coded ramps of one style. */
export const MIN_CODED_RAMP_DISTANCE = 60;

const CHANNEL_MAX = 255;
const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SINGLE_TONE = 1;
const MIN_LIST_LENGTH = 2;
const VGA_PALETTE_SIZE = 16;
const HUE_SECTORS = 6;
const HUE_SECTOR_DEGREES = 60;
const FULL_HUE_DEGREES = 360;
const HALF = 0.5;
const GREEN_SECTOR_OFFSET = 2;
const BLUE_SECTOR_OFFSET = 4;
const SECTOR_PERIOD = 2;
/** Weights of the red, green and blue differences in colourDistance (a cheap perceptual metric). */
const DISTANCE_WEIGHT_RED = 2;
const DISTANCE_WEIGHT_GREEN = 4;
const DISTANCE_WEIGHT_BLUE = 3;

/** Perceptually weighted distance between two colours (0 = identical, about 765 = black to white). */
export function colourDistance(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(DISTANCE_WEIGHT_RED * dr * dr + DISTANCE_WEIGHT_GREEN * dg * dg + DISTANCE_WEIGHT_BLUE * db * db);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Colour at fractional position (0..1) along a piecewise-linear path of stops. */
function sampleStops(stops: readonly Rgb[], position: number): Rgb {
  const scaled = clampUnit(position) * (stops.length - 1);
  const lower = Math.min(Math.floor(scaled), stops.length - 2);
  return lerpColour(stops[lower], stops[lower + 1], scaled - lower);
}

/** The stop nearest to a position (0..1), without interpolation. */
function snapToStop(stops: readonly Rgb[], position: number): Rgb {
  return stops[Math.round(clampUnit(position) * (stops.length - 1))];
}

/** `count` values taken evenly along a list of numbers (linear interpolation between neighbours). */
function resample(values: readonly number[], count: number): number[] {
  if (count <= SINGLE_TONE) return [values[Math.floor((values.length - 1) * HALF)]];
  if (values.length === 1) return Array.from({ length: count }, () => values[0]);
  return Array.from({ length: count }, (_, i) => {
    const scaled = (i / (count - 1)) * (values.length - 1);
    const lower = Math.min(Math.floor(scaled), values.length - 2);
    return values[lower] + (values[lower + 1] - values[lower]) * (scaled - lower);
  });
}

function mean(colours: readonly Rgb[]): Rgb {
  const sum: [number, number, number] = [0, 0, 0];
  for (const c of colours) for (let i = 0; i < sum.length; i++) sum[i] += c[i];
  return [sum[0] / colours.length, sum[1] / colours.length, sum[2] / colours.length];
}

/** Applies a per-colour function to every tone, leaving a non-#rrggbb string untouched. */
function mapColours(tones: readonly string[], fn: (rgb: Rgb) => Rgb): string[] {
  return tones.map((hex) => (HEX_COLOUR_PATTERN.test(hex) ? formatHexColour(fn(parseHexColour(hex))) : hex));
}

function rgbToHsl(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((c) => c / CHANNEL_MAX);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) * HALF;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let sector: number;
  if (max === r) sector = ((g - b) / delta + HUE_SECTORS) % HUE_SECTORS;
  else if (max === g) sector = (b - r) / delta + GREEN_SECTOR_OFFSET;
  else sector = (r - g) / delta + BLUE_SECTOR_OFFSET;
  return [sector * HUE_SECTOR_DEGREES, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % FULL_HUE_DEGREES) + FULL_HUE_DEGREES) % FULL_HUE_DEGREES) / HUE_SECTOR_DEGREES;
  const second = chroma * (1 - Math.abs((sector % SECTOR_PERIOD) - 1));
  const lookup: readonly (readonly [number, number, number])[] = [
    [chroma, second, 0], [second, chroma, 0], [0, chroma, second],
    [0, second, chroma], [second, 0, chroma], [chroma, 0, second]
  ];
  const [r, g, b] = lookup[Math.min(Math.floor(sector), HUE_SECTORS - 1)];
  const offset = lightness - chroma * HALF;
  return [(r + offset) * CHANNEL_MAX, (g + offset) * CHANNEL_MAX, (b + offset) * CHANNEL_MAX];
}

function requireHexList(list: readonly string[] | undefined, what: string): Rgb[] {
  if (!list || list.length === 0) throw new Error(`${what} is missing`);
  return list.map(parseHexColour);
}

/** Luminance mapped onto a path of stops, with the colour-coded ramps pinned to chosen positions. */
function createPaletteMap(config: RenderStylePaletteConfig): StyleTransforms {
  const stops = requireHexList(config.stops, 'stops');
  if (stops.length < MIN_LIST_LENGTH) throw new Error('stops needs at least two colours');
  const at = (position: number): Rgb => (config.quantize ? snapToStop(stops, position) : sampleStops(stops, position));
  const byLuminance = (rgb: Rgb): Rgb => at(luminance(rgb) / CHANNEL_MAX);
  const accents = config.accents ?? {};
  return {
    ramps(name, tones) {
      const pinned = accents[name];
      if (pinned && pinned.length > 0) return resample(pinned, tones.length).map((p) => formatHexColour(at(p)));
      return mapColours(tones, byLuminance);
    },
    colour: (colour) => mapColours([colour], byLuminance)[0]
  };
}

/** Hues kept, saturation scaled down and lightness mixed towards white. */
function createPastel(config: RenderStylePaletteConfig): StyleTransforms {
  const saturation = config.saturation ?? 1;
  const lightness = config.lightness ?? 0;
  const soften = (rgb: Rgb): Rgb => {
    const [h, s, l] = rgbToHsl(rgb);
    return hslToRgb(h, clampUnit(s * saturation), clampUnit(l + (1 - l) * lightness));
  };
  return { ramps: (_name, tones) => mapColours(tones, soften), colour: (colour) => mapColours([colour], soften)[0] };
}

/**
 * Each ramp joins the colour family of the 16-colour table it is closest to (or the one pinned
 * for it), then each tone takes the family tone of nearest luminance. A plain nearest-colour
 * match per tone would scatter one ramp over unrelated hues.
 */
function createVgaFamilies(config: RenderStylePaletteConfig): StyleTransforms {
  const palette = requireHexList(config.palette, 'palette');
  const families = Object.entries(config.families ?? {}).map(([name, indexes]) => {
    const colours = indexes.map((i) => palette[i]);
    return { name, colours, centre: mean(colours) };
  });
  if (families.length === 0) throw new Error('families is missing');
  const pinned = config.pinnedFamilies ?? {};
  const nearest = (rgb: Rgb): Rgb =>
    palette.reduce((best, c) => (colourDistance(rgb, c) < colourDistance(rgb, best) ? c : best));
  const nearestByLuminance = (rgb: Rgb, candidates: readonly Rgb[]): Rgb =>
    candidates.reduce((best, c) =>
      Math.abs(luminance(c) - luminance(rgb)) < Math.abs(luminance(best) - luminance(rgb)) ? c : best
    );
  const familyFor = (name: string, rgbs: readonly Rgb[]) => {
    const forced = families.find((f) => f.name === pinned[name]);
    if (forced) return forced;
    const centre = mean(rgbs);
    return families.reduce((best, f) => (colourDistance(centre, f.centre) < colourDistance(centre, best.centre) ? f : best));
  };
  return {
    ramps(name, tones) {
      if (tones.some((hex) => !HEX_COLOUR_PATTERN.test(hex))) return [...tones];
      const rgbs = tones.map(parseHexColour);
      if (rgbs.length <= SINGLE_TONE) return rgbs.map((rgb) => formatHexColour(nearest(rgb)));
      const family = familyFor(name, rgbs);
      return rgbs.map((rgb) => formatHexColour(nearestByLuminance(rgb, family.colours)));
    },
    colour: (colour) => mapColours([colour], nearest)[0]
  };
}

/** Builds the transforms of a style from its palette config; throws when the config is unusable. */
export function createStyleTransforms(config: RenderStylePaletteConfig): StyleTransforms {
  switch (config.kind) {
    case 'paletteMap':
      return createPaletteMap(config);
    case 'pastel':
      return createPastel(config);
    case 'vgaFamilies':
      return createVgaFamilies(config);
    default:
      throw new Error(`Unknown style kind: ${String((config as { kind?: unknown }).kind)}`);
  }
}

/** The ramps with every one of them recoloured by `transform`. */
export function applyRampTransform(ramps: RetroRamps, transform: RampTransform): RetroRamps {
  const out: Record<string, readonly string[]> = {};
  for (const [name, tones] of Object.entries(ramps)) out[name] = transform(name, tones);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHexList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((c) => typeof c === 'string' && HEX_COLOUR_PATTERN.test(c));
}

function isUnitList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === 'number' && n >= 0 && n <= 1);
}

function findKindErrors(where: string, config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (config.kind === 'paletteMap') {
    if (!isHexList(config.stops) || config.stops.length < MIN_LIST_LENGTH) {
      errors.push(`${where}.stops needs two or more #rrggbb colours`);
    }
    const accents = isRecord(config.accents) ? config.accents : {};
    for (const ramp of COLOUR_CODED_RAMPS) {
      if (!isUnitList(accents[ramp])) errors.push(`${where}.accents.${ramp} must be a non-empty list of positions in 0..1`);
    }
  } else if (config.kind === 'pastel') {
    for (const key of ['saturation', 'lightness']) {
      const value = config[key];
      if (typeof value !== 'number' || value < 0 || value > 1) errors.push(`${where}.${key} must be a number in 0..1`);
    }
  } else if (config.kind === 'vgaFamilies') {
    const size = isHexList(config.palette) ? config.palette.length : 0;
    if (size !== VGA_PALETTE_SIZE) errors.push(`${where}.palette needs ${VGA_PALETTE_SIZE} #rrggbb colours`);
    const families = isRecord(config.families) ? config.families : {};
    for (const [name, indexes] of Object.entries(families)) {
      const valid = Array.isArray(indexes) && indexes.length >= MIN_LIST_LENGTH
        && indexes.every((i) => Number.isInteger(i) && i >= 0 && i < size);
      if (!valid) errors.push(`${where}.families.${name} needs ${MIN_LIST_LENGTH}+ palette indexes`);
    }
    const pinned = isRecord(config.pinnedFamilies) ? config.pinnedFamilies : {};
    for (const ramp of COLOUR_CODED_RAMPS) {
      const family = pinned[ramp];
      if (typeof family !== 'string' || !(family in families)) errors.push(`${where}.pinnedFamilies.${ramp} must name a family`);
    }
  } else {
    errors.push(`${where}.kind is unknown`);
  }
  return errors;
}

/** Everything wrong with the renderStylePalettes table for the given style ids; [] when valid. */
export function findStylePaletteErrors(table: unknown, styleIds: readonly string[]): string[] {
  if (!isRecord(table)) return styleIds.length > 0 ? ['renderStylePalettes is missing or not an object'] : [];
  const errors: string[] = [];
  for (const id of styleIds) {
    const config = table[id];
    if (!isRecord(config)) errors.push(`renderStylePalettes.${id} is missing`);
    else errors.push(...findKindErrors(`renderStylePalettes.${id}`, config));
  }
  return errors;
}
