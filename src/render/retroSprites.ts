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
 * Pixel sprites of the 16-Bit Retro style. Sprites are drawn as rows of characters resolved
 * through legends to "ramp.tone" references; ramps come from game.json (retroPalettes). Pure
 * module: no DOM, so the sprite data can be validated and rasterized in tests and tools.
 */

import { CHANNEL_COLORS, MIRROR_FRONT_AXIS } from '../core/coreConstants';
import terrainSheet from './retro/sprites/terrain.json';
import itemsSheet from './retro/sprites/items.json';
import actorsSheet from './retro/sprites/actors.json';
import monstersSheet from './retro/sprites/monsters.json';
import skinJulienSheet from './retro/sprites/skinJulien.json';
import { RETRO_BOOT_RAMPS, RETRO_PLAIN_TELEPORT_RAMP, RETRO_SWAP_RAMPS } from './paletteKeys';
import { RETRO_SIGNAL_LIT_SUFFIX, RETRO_SIGNAL_TILES, RETRO_SPRITE_PREFIX } from './retroSpriteNames';

/** Side of a tile sprite in pixels. */
export const RETRO_SPRITE_SIZE = 16;
/** Side of a colour-blind glyph sprite in pixels. */
export const RETRO_GLYPH_SIZE = 5;
/** Width of a digit or sign sprite in pixels. */
export const RETRO_CHAR_WIDTH = 3;
/** Height of a digit or sign sprite in pixels. */
export const RETRO_CHAR_HEIGHT = 5;
/** Name prefix of the 5x5 glyph sprites. */
export const RETRO_GLYPH_PREFIX = 'glyph_';
/** Name prefixes of the 3x5 digit and sign sprites. */
export const RETRO_CHAR_PREFIXES: readonly string[] = ['digit_', 'char_'];

/** The eight channel values a 9-bit Mega Drive colour can take. */
export const RETRO_COLOUR_LEVELS: readonly number[] = [0x00, 0x24, 0x49, 0x6d, 0x92, 0xb6, 0xdb, 0xff];
/** Most distinct colours one rasterized sprite may use (a Mega Drive palette line minus transparency). */
export const RETRO_MAX_SPRITE_COLOURS = 15;
/** Fewest and most tones a ramp may have. */
export const RETRO_MIN_RAMP_TONES = 1;
export const RETRO_MAX_RAMP_TONES = 4;

/** Character that marks a transparent pixel. */
export const RETRO_TRANSPARENT_CHAR = '.';
/** Ramp name used in a legend entry for the palette-swap ramp chosen at draw time. */
export const RETRO_SWAP_RAMP_TOKEN = '$';
/** Separator between ramp and tone in a legend entry. */
export const RETRO_LEGEND_SEPARATOR = '.';
/** Id of the theme whose ramps every other theme overrides. */
export const RETRO_DEFAULT_THEME_ID = 'default';
/** Ramp holding the automatic outline colour. */
export const RETRO_OUTLINE_RAMP = 'outline';
/** Tone index of the outline colour. */
export const RETRO_OUTLINE_TONE = 0;
/** Ramps that hold exactly one tone. */
export const RETRO_SINGLE_TONE_RAMPS: readonly string[] = ['outline', 'shadow'];

/** Ramps every theme must resolve (default holds all, themes override some). */
export const RETRO_RAMP_NAMES: readonly string[] = [
  'outline', 'shadow', 'floor', 'wall', 'wallRim', 'bluewall', 'water', 'fire', 'ice', 'force',
  'dirt', 'gravel', 'metal', 'trap', 'exit', 'teleport', 'hint', 'thief', 'white', 'skin', 'hair',
  'suit', 'visor', 'boot', 'block', 'iceblock', 'chip', 'bomb', 'flag', 'stopwatch', 'turtle',
  'target', 'red', 'blue', 'yellow', 'green', 'orange', 'brown', 'bug', 'paramecium', 'pinkball',
  'walker', 'teeth', 'glider', 'fireball', 'tank', 'blob', 'eye',
  'darkHair', 'faceSkin', 'beard', 'glasses', 'shirt', 'sunMotif'
];

const BYTES_PER_PIXEL = 4;
const ALPHA_OFFSET = 3;
const OPAQUE_ALPHA = 255;
const HEX_RADIX = 16;
const HEX_CHANNEL_DIGITS = 2;
const HEX_PREFIX_LENGTH = 1;
const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const CHANNEL_MASK = 0xff;
/** 4-adjacent neighbours used by the automatic outline. */
const OUTLINE_NEIGHBOURS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const DIRECTIONS: readonly string[] = ['N', 'E', 'S', 'W'];

export type RetroRamps = Readonly<Record<string, readonly string[]>>;

export interface RetroSprite {
  width: number;
  height: number;
  rows: readonly string[];
  /** Legend already folded: sheet legend overridden by the sprite legend. */
  legend: Readonly<Record<string, string>>;
  outline: boolean;
}

export interface RetroSheet {
  sprites: Readonly<Record<string, RetroSprite>>;
}

/** Shape of a sheet file as authored. */
export interface RetroRawSheet {
  legend: Readonly<Record<string, string>>;
  sprites: Readonly<Record<string, {
    rows: readonly string[];
    legend?: Readonly<Record<string, string>>;
    outline?: boolean;
  }>>;
}

/** Folds the legends of authored sheets into one sheet; a duplicate sprite name throws. */
export function mergeRetroSheets(raws: readonly RetroRawSheet[]): RetroSheet {
  const sprites: Record<string, RetroSprite> = {};
  for (const raw of raws) {
    for (const [name, def] of Object.entries(raw.sprites)) {
      if (name in sprites) throw new Error(`Duplicate retro sprite: ${name}`);
      sprites[name] = {
        width: def.rows.length > 0 ? def.rows[0].length : 0,
        height: def.rows.length,
        rows: def.rows,
        legend: { ...raw.legend, ...(def.legend ?? {}) },
        outline: def.outline === true
      };
    }
  }
  return { sprites };
}

export const RETRO_SHEET: RetroSheet = mergeRetroSheets([
  terrainSheet as RetroRawSheet,
  itemsSheet as RetroRawSheet,
  actorsSheet as RetroRawSheet,
  monstersSheet as RetroRawSheet,
  skinJulienSheet as RetroRawSheet
]);

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

function framed(base: string, frames: number): string[] {
  return range(frames).map((f) => `${base}_${f}`);
}

const MONSTER_TYPES: readonly string[] = [
  'bug', 'paramecium', 'pink_ball', 'walker', 'teeth', 'glider', 'fireball', 'tank', 'blob'
];
const PLAYER_FRAMES = 3;
const MONSTER_FRAMES = 2;
const WATER_FRAMES = 4;
const FIRE_FRAMES = 3;
const EXIT_FRAMES = 2;
const TELEPORT_FRAMES = 2;
const FORCE_FRAMES = 4;
const FLOOR_DETAIL_COUNT = 3;
const DIGIT_COUNT = 10;
const GLYPH_COLOURS: readonly string[] = ['red', 'blue', 'yellow', 'green', 'orange'];
/** The four turret blocks: sprites of the sheet, which the game draws through the cc3d bot painters. */
const TURRET_SPRITES: readonly string[] = ['turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi'];
/** The arrow overlay of each face of an arrow block, drawn over the plain block sprite: one per absolute direction. */
const ARROW_MARK_SPRITES: readonly string[] = DIRECTIONS.map((d) => `${RETRO_SPRITE_PREFIX.arrowMark}${d.toLowerCase()}`);
/** The four one-sided mirror blocks: sprites of the sheet, which the game draws through the cc3d reflector painter. */
const ONE_SIDED_MIRROR_SPRITES: readonly string[] = Object.keys(MIRROR_FRONT_AXIS).map((c) => `one_sided_mirror_${c.toLowerCase()}`);
/** The colour block sprites: one per channel colour, named after the entity they draw. */
const COLOR_BLOCK_SPRITES: readonly string[] = CHANNEL_COLORS.map((c) => `color_block_${c}`);

/** Every sprite name the renderer needs (spec section 4). */
export const RETRO_SPRITE_NAMES: readonly string[] = [
  'floor', ...framed('floor_detail', FLOOR_DETAIL_COUNT),
  'wall_top', 'wall_front', 'wall_rim_n', 'wall_rim_w', 'wall_rim_e',
  'thin_n', 'thin_e', 'thin_s', 'thin_w',
  'recessed_wall', 'blue_wall', 'blue_wall_fake_marker', 'hidden_wall_marker', 'appearing_wall_marker',
  'dirt', 'slime', 'gravel', 'socket', 'hint', 'thief', 'thief_keys', 'block_target', 'clone_machine', 'transmogrifier', 'turn_plate_cw', 'turn_plate_ccw',
  ...RETRO_SIGNAL_TILES.flatMap((id) => [id, `${id}${RETRO_SIGNAL_LIT_SUFFIX}`]),
  'forbid_sign', 'door', 'button', 'toggle_wall_closed', 'toggle_wall_open', 'trap_open', 'trap_closed',
  'flame_jet_nozzle', 'turtle', 'ice', 'ice_nw', 'ice_ne', 'ice_sw', 'ice_se',
  'laser_emitter_n', 'laser_emitter_e', 'laser_emitter_s', 'laser_emitter_w',
  'laser_receiver', 'laser_gate_closed', 'laser_gate_open',
  ...framed('water', WATER_FRAMES), ...framed('fire', FIRE_FRAMES),
  ...framed('exit', EXIT_FRAMES), ...framed('teleport', TELEPORT_FRAMES),
  ...DIRECTIONS.flatMap((d) => framed(`force_${d.toLowerCase()}`, FORCE_FRAMES)),
  ...framed('force_random', FORCE_FRAMES),
  ...framed('force_cycle', FORCE_FRAMES),
  'chip', 'key', 'boots', 'gloves', 'bomb', 'charge', 'charge_lit', 'flag', 'stopwatch_bonus', 'stopwatch_penalty', 'slow_time',
  ...GLYPH_COLOURS.map((c) => `${RETRO_GLYPH_PREFIX}${c}`),
  ...range(DIGIT_COUNT).map((d) => `digit_${d}`),
  'char_x', 'char_k', 'char_q', 'char_plus', 'char_minus',
  ...DIRECTIONS.flatMap((d) => framed(`player_${d}`, PLAYER_FRAMES)),
  ...DIRECTIONS.map((d) => `player_swim_${d}`), 'player_dead',
  ...MONSTER_TYPES.flatMap((t) => DIRECTIONS.flatMap((d) => framed(`${t}_${d}`, MONSTER_FRAMES))),
  'lurker_tell', 'dirt_block', 'ice_block', ...COLOR_BLOCK_SPRITES, 'mirror_slash', 'mirror_backslash', ...ONE_SIDED_MIRROR_SPRITES, ...TURRET_SPRITES, ...ARROW_MARK_SPRITES, 'block_on_target'
];

/** Names of RETRO_SPRITE_NAMES the sheet does not define. */
export function missingRetroSprites(sheet: RetroSheet): string[] {
  return RETRO_SPRITE_NAMES.filter((name) => !(name in sheet.sprites));
}

export function hasRetroSprite(name: string): boolean {
  return name in RETRO_SHEET.sprites;
}

/** True for #rrggbb whose three channels are each one of the eight Mega Drive levels. */
export function isNineBitColour(hex: string): boolean {
  if (!HEX_COLOUR_PATTERN.test(hex)) return false;
  for (let i = 0; i < 3; i++) {
    const start = HEX_PREFIX_LENGTH + i * HEX_CHANNEL_DIGITS;
    const channel = parseInt(hex.slice(start, start + HEX_CHANNEL_DIGITS), HEX_RADIX);
    if (!RETRO_COLOUR_LEVELS.includes(channel)) return false;
  }
  return true;
}

/** Packs a #rrggbb colour into 0xRRGGBB. */
function parseHex(hex: string): number {
  return parseInt(hex.slice(HEX_PREFIX_LENGTH), HEX_RADIX);
}

/** Ramps of a theme: the default ramps with the theme's own ramps laid over them. */
export function resolveRetroRamps(
  palettes: Record<string, Record<string, string[]>> | undefined,
  themeId: string
): RetroRamps {
  if (!palettes) return {};
  const base = palettes[RETRO_DEFAULT_THEME_ID] ?? {};
  if (themeId === RETRO_DEFAULT_THEME_ID) return { ...base };
  return { ...base, ...(palettes[themeId] ?? {}) };
}

interface LegendRef {
  ramp: string;
  tone: number;
}

function parseLegendRef(value: string): LegendRef | null {
  const at = value.lastIndexOf(RETRO_LEGEND_SEPARATOR);
  if (at <= 0) return null;
  const tone = Number(value.slice(at + 1));
  if (!Number.isInteger(tone) || tone < 0) return null;
  return { ramp: value.slice(0, at), tone };
}

/** RGBA pixels (width * height * 4). swapRamp names the ramp used for swap tones. */
export function rasterizeSprite(sprite: RetroSprite, ramps: RetroRamps, swapRamp?: string): Uint8ClampedArray {
  const { width, height } = sprite;
  const out = new Uint8ClampedArray(width * height * BYTES_PER_PIXEL);
  const colourCache = new Map<string, number | null>();
  const colourOf = (ch: string): number | null => {
    const cached = colourCache.get(ch);
    if (cached !== undefined) return cached;
    let colour: number | null = null;
    const ref = ch in sprite.legend ? parseLegendRef(sprite.legend[ch]) : null;
    if (ref) {
      const ramp = ref.ramp === RETRO_SWAP_RAMP_TOKEN ? (swapRamp ? ramps[swapRamp] : undefined) : ramps[ref.ramp];
      const hex = ramp?.[ref.tone];
      if (hex) colour = parseHex(hex);
    }
    colourCache.set(ch, colour);
    return colour;
  };
  const put = (x: number, y: number, colour: number): void => {
    const o = (y * width + x) * BYTES_PER_PIXEL;
    out[o] = (colour >> RED_SHIFT) & CHANNEL_MASK;
    out[o + 1] = (colour >> GREEN_SHIFT) & CHANNEL_MASK;
    out[o + 2] = colour & CHANNEL_MASK;
    out[o + ALPHA_OFFSET] = OPAQUE_ALPHA;
  };
  for (let y = 0; y < height; y++) {
    const row = sprite.rows[y] ?? '';
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (ch === undefined || ch === RETRO_TRANSPARENT_CHAR) continue;
      const colour = colourOf(ch);
      if (colour !== null) put(x, y, colour);
    }
  }
  if (sprite.outline) {
    const outlineHex = ramps[RETRO_OUTLINE_RAMP]?.[RETRO_OUTLINE_TONE];
    if (outlineHex) {
      const outlineColour = parseHex(outlineHex);
      const opaqueAt = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < width && y < height && out[(y * width + x) * BYTES_PER_PIXEL + ALPHA_OFFSET] !== 0;
      const border: [number, number][] = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (opaqueAt(x, y)) continue;
          if (OUTLINE_NEIGHBOURS.some(([dx, dy]) => opaqueAt(x + dx, y + dy))) border.push([x, y]);
        }
      }
      for (const [x, y] of border) put(x, y, outlineColour);
    }
  }
  return out;
}

/** Paints the opaque pixels of src over dst at (dx, dy), clipped to dst. */
export function blitPixels(
  dst: Uint8ClampedArray,
  dstWidth: number,
  src: Uint8ClampedArray,
  srcWidth: number,
  dx: number,
  dy: number
): void {
  const dstHeight = Math.floor(dst.length / BYTES_PER_PIXEL / dstWidth);
  const srcHeight = Math.floor(src.length / BYTES_PER_PIXEL / srcWidth);
  for (let y = 0; y < srcHeight; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dstHeight) continue;
    for (let x = 0; x < srcWidth; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dstWidth) continue;
      const s = (y * srcWidth + x) * BYTES_PER_PIXEL;
      if (src[s + ALPHA_OFFSET] === 0) continue;
      const d = (ty * dstWidth + tx) * BYTES_PER_PIXEL;
      for (let c = 0; c < BYTES_PER_PIXEL; c++) dst[d + c] = src[s + c];
    }
  }
}

function expectedSize(name: string): { width: number; height: number } {
  if (name.startsWith(RETRO_GLYPH_PREFIX)) return { width: RETRO_GLYPH_SIZE, height: RETRO_GLYPH_SIZE };
  if (RETRO_CHAR_PREFIXES.some((p) => name.startsWith(p))) {
    return { width: RETRO_CHAR_WIDTH, height: RETRO_CHAR_HEIGHT };
  }
  return { width: RETRO_SPRITE_SIZE, height: RETRO_SPRITE_SIZE };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Palette problems: theme list, missing ramps, tone counts and non 9-bit colours. */
function findPaletteErrors(palettes: unknown, themeIds: string[]): string[] {
  const errors: string[] = [];
  if (!isRecord(palettes)) return ['retroPalettes is missing or not an object'];
  const base = palettes[RETRO_DEFAULT_THEME_ID];
  if (!isRecord(base)) return [`retroPalettes.${RETRO_DEFAULT_THEME_ID} is missing`];
  for (const themeId of Object.keys(palettes)) {
    const own = palettes[themeId];
    if (!isRecord(own)) {
      errors.push(`retroPalettes.${themeId} is not an object`);
      continue;
    }
    themeIds.push(themeId);
    for (const [ramp, tones] of Object.entries(own)) {
      const where = `retroPalettes.${themeId}.${ramp}`;
      if (!Array.isArray(tones)) {
        errors.push(`${where} is not an array`);
        continue;
      }
      const maxTones = RETRO_SINGLE_TONE_RAMPS.includes(ramp) ? RETRO_MIN_RAMP_TONES : RETRO_MAX_RAMP_TONES;
      if (tones.length < RETRO_MIN_RAMP_TONES || tones.length > maxTones) {
        errors.push(`${where} has ${tones.length} tones, expected ${RETRO_MIN_RAMP_TONES} to ${maxTones}`);
      }
      for (const tone of tones) {
        if (typeof tone !== 'string' || !isNineBitColour(tone)) errors.push(`${where} colour ${String(tone)} is not 9-bit`);
      }
    }
    for (const ramp of RETRO_RAMP_NAMES) {
      if (!(ramp in own) && !(ramp in base)) errors.push(`retroPalettes.${themeId} lacks ramp ${ramp}`);
    }
  }
  return errors;
}

/** Ramps a template may be drawn with, in addition to its own fixed ramps. */
function swapCandidates(): string[] {
  return [...new Set([
    ...Object.values(RETRO_SWAP_RAMPS),
    ...Object.values(RETRO_BOOT_RAMPS),
    RETRO_PLAIN_TELEPORT_RAMP
  ])];
}

function countColours(pixels: Uint8ClampedArray): number {
  const seen = new Set<number>();
  for (let o = 0; o < pixels.length; o += BYTES_PER_PIXEL) {
    if (pixels[o + ALPHA_OFFSET] === 0) continue;
    seen.add((pixels[o] << RED_SHIFT) | (pixels[o + 1] << GREEN_SHIFT) | pixels[o + 2]);
  }
  return seen.size;
}

/**
 * Problems in the 32-Bit palette overrides: unknown theme ids, unknown ramp names, and ramps that
 * are not non-empty arrays of #rrggbb colours. `themeIds` are the themes retroPalettes declares.
 */
export function findRetro32PaletteErrors(palettes: unknown, themeIds: readonly string[]): string[] {
  if (palettes === undefined) return [];
  if (!isRecord(palettes)) return ['retro32Palettes is not an object'];
  const errors: string[] = [];
  for (const [themeId, ramps] of Object.entries(palettes)) {
    if (!themeIds.includes(themeId)) errors.push(`retro32Palettes.${themeId}: unknown theme`);
    if (!isRecord(ramps)) {
      errors.push(`retro32Palettes.${themeId} is not an object`);
      continue;
    }
    for (const [ramp, tones] of Object.entries(ramps)) {
      const where = `retro32Palettes.${themeId}.${ramp}`;
      if (!RETRO_RAMP_NAMES.includes(ramp)) errors.push(`${where}: unknown ramp`);
      if (!Array.isArray(tones) || tones.length === 0) {
        errors.push(`${where} must be a non-empty array`);
        continue;
      }
      for (const tone of tones) {
        if (typeof tone !== 'string' || !HEX_COLOUR_PATTERN.test(tone)) {
          errors.push(`${where} colour ${String(tone)} is not #rrggbb`);
        }
      }
    }
  }
  return errors;
}

/** Everything wrong with a sheet and the palettes it is drawn with; [] when valid. */
export function findRetroSheetErrors(sheet: RetroSheet, palettes: unknown): string[] {
  const themeIds: string[] = [];
  const errors = findPaletteErrors(palettes, themeIds);
  const typed = isRecord(palettes) ? (palettes as Record<string, Record<string, string[]>>) : undefined;
  const themeRamps = themeIds.map((id) => ({ id, ramps: resolveRetroRamps(typed, id) }));
  const candidates = swapCandidates();
  for (const [name, sprite] of Object.entries(sheet.sprites)) {
    const where = `sprite ${name}`;
    const size = expectedSize(name);
    if (sprite.rows.length !== size.height || sprite.rows.some((r) => r.length !== size.width)) {
      errors.push(`${where} must be ${size.width}x${size.height}`);
    }
    if (sprite.width !== size.width || sprite.height !== size.height) {
      errors.push(`${where} declares ${sprite.width}x${sprite.height}, expected ${size.width}x${size.height}`);
    }
    let usesSwap = false;
    let structural = false;
    const reported = new Set<string>();
    for (const row of sprite.rows) {
      for (const ch of row) {
        if (ch === RETRO_TRANSPARENT_CHAR || reported.has(ch)) continue;
        reported.add(ch);
        const value = sprite.legend[ch];
        if (value === undefined) {
          errors.push(`${where} uses unknown character '${ch}'`);
          structural = true;
          continue;
        }
        const ref = parseLegendRef(value);
        if (!ref) {
          errors.push(`${where} legend '${ch}' -> '${value}' is not ramp.tone`);
          structural = true;
        } else if (ref.ramp === RETRO_SWAP_RAMP_TOKEN) {
          usesSwap = true;
        } else if (!RETRO_RAMP_NAMES.includes(ref.ramp)) {
          errors.push(`${where} legend '${ch}' uses unknown ramp ${ref.ramp}`);
          structural = true;
        } else {
          for (const { id, ramps } of themeRamps) {
            if ((ramps[ref.ramp]?.length ?? 0) <= ref.tone) {
              errors.push(`${where} legend '${ch}' uses tone ${ref.tone} missing from ${ref.ramp} in theme ${id}`);
              structural = true;
              break;
            }
          }
        }
      }
    }
    if (structural) continue;
    for (const { id, ramps } of themeRamps) {
      const swaps = usesSwap ? candidates : [undefined];
      for (const swap of swaps) {
        if (swap !== undefined && !(swap in ramps)) continue;
        const count = countColours(rasterizeSprite(sprite, ramps, swap));
        if (count > RETRO_MAX_SPRITE_COLOURS) {
          errors.push(`${where} uses ${count} colours in theme ${id}${swap ? ` with swap ${swap}` : ''}, max ${RETRO_MAX_SPRITE_COLOURS}`);
        }
        if (swap !== undefined) {
          for (const row of sprite.rows) {
            for (const ch of row) {
              const ref = ch in sprite.legend ? parseLegendRef(sprite.legend[ch]) : null;
              if (ref?.ramp === RETRO_SWAP_RAMP_TOKEN && (ramps[swap]?.length ?? 0) <= ref.tone) {
                errors.push(`${where} swap tone ${ref.tone} missing from ramp ${swap} in theme ${id}`);
              }
            }
          }
        }
      }
    }
  }
  return [...new Set(errors)];
}

/** The shadow thrown sideways by a west caster is shallower than the one thrown by a north caster. */
export const RETRO_SIDE_SHADOW_RATIO = 0.6;

/**
 * Score flag text on the 16-px authoring grid: a 3x5 string centred on `centerX`, its top row at
 * `top`, characters `spacing` pixels apart.
 */
export interface FlagTextLayout {
  readonly centerX: number;
  readonly top: number;
  readonly spacing: number;
}

/** Flag text layout on the authoring grid (the one the 16-Bit sheet is drawn on). */
export const RETRO_FLAG_TEXT: FlagTextLayout = { centerX: 9, top: 4, spacing: 1 };

/** Size of one sprite in pixels. */
export interface SpriteDims {
  readonly width: number;
  readonly height: number;
}

/**
 * Where a style gets its sprite pixels from. The composition only asks for the size of a sprite
 * and for its RGBA pixels, so it knows nothing about ramps or about how the pixels are produced.
 */
export interface SpriteSource {
  /** Size of the named sprite, or undefined when the source lacks it. */
  dims(name: string): SpriteDims | undefined;
  /** RGBA pixels of the named sprite; only called for a name `dims` knows. */
  pixels(name: string, swapRamp?: string): Uint8ClampedArray;
}

/** Size-dependent parameters of a sprite style, derived from its scale over the authoring grid. */
export interface SpriteStyleSpec {
  readonly id: string;
  /** Side of a composed tile in pixels. */
  readonly tileSize: number;
  /** Factor from authoring-grid pixels (layer offsets) to this style's pixels. */
  readonly layerScale: number;
  /** True when the floor shadow colour is quantised to 15 bits. */
  readonly quantiseShadow: boolean;
  /** Shadow depth and side width in this style's pixels for a depth given as a fraction of a tile. */
  shadowExtent(depthTile: number): { depth: number; side: number };
}

/** Builds the spec of a style that draws the 16-px authoring grid at `layerScale` times its size. */
export function createSpriteStyleSpec(id: string, layerScale: number, quantiseShadow: boolean): SpriteStyleSpec {
  const tileSize = RETRO_SPRITE_SIZE * layerScale;
  return {
    id,
    tileSize,
    layerScale,
    quantiseShadow,
    shadowExtent(depthTile) {
      const depth = Math.round(tileSize * depthTile);
      return { depth, side: Math.round(depth * RETRO_SIDE_SHADOW_RATIO) };
    }
  };
}

/** Id of the 16-Bit Retro style (kept as 'retro' so saved settings stay valid). */
export const RETRO16_STYLE_ID = 'retro';
/** Scale of the 16-Bit style over the authoring grid. */
const RETRO16_LAYER_SCALE = 1;

export const RETRO16_SPEC: SpriteStyleSpec = createSpriteStyleSpec(RETRO16_STYLE_ID, RETRO16_LAYER_SCALE, false);

/** Sprite source of the 16-Bit style: the sheet rasterized with the theme's 9-bit ramps. */
export function createRetro16SpriteSource(ramps: RetroRamps, sheet: RetroSheet = RETRO_SHEET): SpriteSource {
  return {
    dims(name) {
      const sprite = sheet.sprites[name];
      return sprite ? { width: sprite.width, height: sprite.height } : undefined;
    },
    pixels(name, swapRamp) {
      return rasterizeSprite(sheet.sprites[name], ramps, swapRamp);
    }
  };
}
