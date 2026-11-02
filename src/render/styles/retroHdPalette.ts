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
 * Recolouring of the palette and of the themes for the Retro HD render styles (Pocket, Pastel,
 * Blueprint, Sepia, Classic 90s). Every colour belongs to a family (red, water-blue, neutral...)
 * chosen by hand for the ambiguous ones and by hue otherwise; a style gives one ramp per family
 * and a colour keeps its lightness inside the ramp of its family. Fire therefore stays red-orange,
 * water blue and ice cyan in every style, and only the neutrals take the signature hue of the
 * style. Pure module: no DOM.
 */

import type {
  ColourFamily,
  FamilyAssignment,
  RenderStyleFamilies,
  RenderStylePaletteConfig,
  ThemePalette
} from '../../core/types';
import { Rgb, formatHexColour, lerpColour, luminance, parseHexColour } from '../retro32/colour';

/** Every family a style gives a ramp for. */
export const COLOUR_FAMILIES: readonly ColourFamily[] = [
  'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'skin', 'neutral'
];

/** Colour fields of a theme; the other fields (id, label key, music) are copied as they are. */
export const THEME_COLOUR_KEYS: readonly (keyof ThemePalette)[] = [
  'floorTop', 'floorBottom', 'floorGrid', 'wallTop', 'wallBottom', 'wallBevel', 'accentGlow'
];

const CHANNEL_MAX = 255;
const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const FUNCTIONAL_COLOUR_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/;
const MIN_RAMP_STOPS = 2;
const HUE_SECTORS = 6;
const HUE_SECTOR_DEGREES = 60;
const GREEN_SECTOR_OFFSET = 2;
const BLUE_SECTOR_OFFSET = 4;
const MIN_TONE = 0;
const MAX_TONE = 1;
/** Colours with less chroma than this (0..1 of the channel range) are greys whatever their hue. */
const NEUTRAL_CHROMA = 0.16;
/** Upper bound of each hue range in degrees, in order; hues past the last bound are red again. */
const HUE_FAMILIES: readonly (readonly [number, ColourFamily])[] = [
  [15, 'red'],
  [42, 'orange'],
  [70, 'yellow'],
  [165, 'green'],
  [200, 'cyan'],
  [255, 'blue'],
  [345, 'purple']
];
const HUE_WRAP_FAMILY: ColourFamily = 'red';

/** A colour read from a palette entry; `alpha` is the source text of the alpha, null for #rrggbb. */
interface ParsedColour {
  readonly rgb: Rgb;
  readonly alpha: string | null;
}

/** Recolouring of one style; every method returns new objects and leaves its input alone. */
export interface RetroHdRecolour {
  /** The palette with every colour recoloured. */
  palette(source: Readonly<Record<string, string>>): Record<string, string>;
  /** The theme with its colour fields recoloured. */
  theme(source: ThemePalette): ThemePalette;
}

/** Reads #rrggbb, rgb(...) or rgba(...); null for anything else. */
export function parseCssColour(text: string): ParsedColour | null {
  if (HEX_COLOUR_PATTERN.test(text)) return { rgb: parseHexColour(text), alpha: null };
  const match = FUNCTIONAL_COLOUR_PATTERN.exec(text);
  if (!match) return null;
  const rgb: Rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
  return { rgb, alpha: match[4] ?? '1' };
}

function formatCssColour(rgb: Rgb, alpha: string | null): string {
  if (alpha === null) return formatHexColour(rgb);
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})`;
}

function clampUnit(value: number): number {
  return Math.min(MAX_TONE, Math.max(MIN_TONE, value));
}

/** Hue in degrees (0..360) of a colour that has chroma. */
function hueOf(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => c / CHANNEL_MAX);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let sector: number;
  if (max === r) sector = ((g - b) / delta + HUE_SECTORS) % HUE_SECTORS;
  else if (max === g) sector = (b - r) / delta + GREEN_SECTOR_OFFSET;
  else sector = (r - g) / delta + BLUE_SECTOR_OFFSET;
  return sector * HUE_SECTOR_DEGREES;
}

/** Family of a colour no one assigned: grey when it has little chroma, otherwise by hue. */
export function classifyColour(rgb: Rgb): ColourFamily {
  const chroma = (Math.max(...rgb) - Math.min(...rgb)) / CHANNEL_MAX;
  if (chroma < NEUTRAL_CHROMA) return 'neutral';
  const hue = hueOf(rgb);
  return HUE_FAMILIES.find(([bound]) => hue < bound)?.[1] ?? HUE_WRAP_FAMILY;
}

/** Colour at a fractional position (0..1) along a piecewise-linear ramp, or its nearest stop. */
function sampleRamp(stops: readonly Rgb[], position: number, quantize: boolean): Rgb {
  const scaled = clampUnit(position) * (stops.length - 1);
  if (quantize) return stops[Math.round(scaled)];
  const lower = Math.min(Math.floor(scaled), stops.length - 2);
  return lerpColour(stops[lower], stops[lower + 1], scaled - lower);
}

interface ResolvedAssignment {
  readonly family: ColourFamily;
  readonly tone: number | null;
}

function resolveAssignment(assignment: FamilyAssignment | undefined, rgb: Rgb): ResolvedAssignment {
  if (assignment === undefined) return { family: classifyColour(rgb), tone: null };
  if (typeof assignment === 'string') return { family: assignment, tone: null };
  return { family: assignment.family, tone: assignment.tone };
}

/** Builds the recolouring of a style; throws when its config or the family table is unusable. */
export function createRetroHdRecolour(style: RenderStylePaletteConfig, families: RenderStyleFamilies): RetroHdRecolour {
  const ramps = {} as Record<ColourFamily, Rgb[]>;
  for (const family of COLOUR_FAMILIES) {
    const stops = style.families?.[family];
    if (!stops || stops.length < MIN_RAMP_STOPS) throw new Error(`families.${family} needs ${MIN_RAMP_STOPS}+ colours`);
    ramps[family] = stops.map(parseHexColour);
  }
  const quantize = style.quantize === true;

  const recolour = (text: string, assignment: FamilyAssignment | undefined): string => {
    const parsed = parseCssColour(text);
    if (!parsed) return text;
    const { family, tone } = resolveAssignment(assignment, parsed.rgb);
    const position = tone ?? luminance(parsed.rgb) / CHANNEL_MAX;
    return formatCssColour(sampleRamp(ramps[family], position, quantize), parsed.alpha);
  };

  return {
    palette(source) {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(source)) out[key] = recolour(value, families.palette?.[key]);
      return out;
    },
    theme(source) {
      const out: ThemePalette = { ...source };
      for (const key of THEME_COLOUR_KEYS) {
        (out as unknown as Record<string, string>)[key] = recolour(source[key] as string, families.theme?.[key]);
      }
      return out;
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHexList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((c) => typeof c === 'string' && HEX_COLOUR_PATTERN.test(c));
}

function isFamily(value: unknown): value is ColourFamily {
  return (COLOUR_FAMILIES as readonly unknown[]).includes(value);
}

function isAssignment(value: unknown): value is FamilyAssignment {
  if (isFamily(value)) return true;
  return isRecord(value) && isFamily(value.family) && typeof value.tone === 'number'
    && value.tone >= MIN_TONE && value.tone <= MAX_TONE;
}

/** Everything wrong with the renderStylePalettes table for the given style ids; [] when valid. */
export function findStylePaletteErrors(table: unknown, styleIds: readonly string[]): string[] {
  if (!isRecord(table)) return styleIds.length > 0 ? ['renderStylePalettes is missing or not an object'] : [];
  const errors: string[] = [];
  for (const id of styleIds) {
    const config = table[id];
    const where = `renderStylePalettes.${id}`;
    if (!isRecord(config)) {
      errors.push(`${where} is missing`);
      continue;
    }
    const families = isRecord(config.families) ? config.families : {};
    for (const family of COLOUR_FAMILIES) {
      const stops = families[family];
      if (!isHexList(stops) || stops.length < MIN_RAMP_STOPS) {
        errors.push(`${where}.families.${family} needs ${MIN_RAMP_STOPS}+ #rrggbb colours`);
      }
    }
    if (config.quantize !== undefined && typeof config.quantize !== 'boolean') errors.push(`${where}.quantize must be a boolean`);
  }
  return errors;
}

/**
 * Everything wrong with the renderStyleFamilies table: a missing section, an unknown family, a tone
 * outside 0..1, or a key that is neither a palette key nor a theme colour field. [] when valid.
 */
export function findStyleFamilyErrors(table: unknown, paletteKeys: Iterable<string>): string[] {
  if (!isRecord(table)) return ['renderStyleFamilies is missing or not an object'];
  const errors: string[] = [];
  const known: Record<string, ReadonlySet<string>> = {
    palette: new Set(paletteKeys),
    theme: new Set<string>(THEME_COLOUR_KEYS)
  };
  for (const section of Object.keys(known)) {
    const entries = table[section];
    if (!isRecord(entries)) {
      errors.push(`renderStyleFamilies.${section} is missing`);
      continue;
    }
    for (const [key, assignment] of Object.entries(entries)) {
      if (!known[section].has(key)) errors.push(`renderStyleFamilies.${section}.${key} names no ${section} colour`);
      if (!isAssignment(assignment)) errors.push(`renderStyleFamilies.${section}.${key} needs a family or { family, tone in 0..1 }`);
    }
  }
  return errors;
}
