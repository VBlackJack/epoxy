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
 * Registry of the render styles: HD Neon (vector), 16-Bit Retro, 32-Bit Retro and the five Retro HD
 * styles (Pocket, Pastel, Blueprint, Sepia, Classic 90s), which draw like HD Neon with their own
 * colours and a retro finish. Each descriptor says which sprites and palettes a style draws with
 * and which behaviours it turns on, so the renderer and the UI ask the registry instead of
 * comparing style ids. Pure module.
 */

import type { GraphicsStyle } from '../../core/types';
import { RETRO16_SPEC, type SpriteStyleSpec } from '../retroSprites';
import { RETRO32_SPEC } from '../retro32/spriteStyle32';

export type RenderStyleId = GraphicsStyle;

/** Game config key holding the colour ramps a sprite style draws with. */
export type PalettesKey = 'retroPalettes' | 'retro32Palettes';

/** Prefix and suffix of the i18n key naming a style in the header (app.header.graphics_<id>.action). */
const LABEL_KEY_PREFIX = 'app.header.graphics_';
const LABEL_KEY_SUFFIX = '.action';
/** Class that makes the browser scale the canvas with hard pixel edges. */
export const RETRO_PIXELS_CLASS = 'retro-pixels';

/** Sprite pipeline a style draws with: the 16-px sheet as is, or its 32-Bit derivation. */
export type SpriteBase = 'retro16' | 'retro32';

/** Colour bands a smooth gradient is cut into by the Retro HD styles, and by Classic 90s. */
export const RETRO_HD_GRADIENT_BANDS = 3;
export const CLASSIC90_GRADIENT_BANDS = 2;

/** Painter set a style draws tiles, items, entities and the player with, besides the shared drawing. */
export type PainterSetId = 'runeward';

/** Texture laid over the finished board by a Retro HD style. */
export type OverlayKind = 'lcdDots' | 'gridLines' | 'vignetteGrain' | 'scanlines';

/** The retro finish of a Retro HD style: banded gradients and an optional overlay. */
export interface RetroFinish {
  /** Number of flat colour bands a gradient is cut into. */
  readonly gradientBands: number;
  /** Texture drawn once per frame over the board, or null for none. */
  readonly overlay: OverlayKind | null;
}

export interface RenderStyleDescriptor {
  readonly id: RenderStyleId;
  /** i18n key of the style name shown when the style is selected. */
  readonly labelKey: string;
  /** Sprite parameters, or null for the vector HD Neon drawing. */
  readonly sprite: SpriteStyleSpec | null;
  /** Config key of the style's colour ramps, or null when it has none. */
  readonly palettesKey: PalettesKey | null;
  /** Sprite pipeline the style draws with, or null for the vector HD Neon drawing. */
  readonly base: SpriteBase | null;
  /** Spec used when tiles are drawn smaller than `sprite`: the 16-px sprites. */
  readonly smallSprite: SpriteStyleSpec | null;
  /** Key of the style's entry in game.json renderStylePalettes, or null when it keeps the base colours. */
  readonly transformKey: string | null;
  /** Retro finish of a Retro HD style, or null for the styles that draw as they are. */
  readonly finish: RetroFinish | null;
  /** Neon glows (shadow blur) are drawn. */
  readonly glow: boolean;
  /** The dithered shadow that walls throw on the floor is drawn. */
  readonly floorShadows: boolean;
  /** True when the LCD pixel grid may be laid over the view. */
  readonly lcdAllowed: boolean;
  /** CSS class set on the game canvas, or null. */
  readonly canvasClass: string | null;
  /** Entities and camera glide between cells, the zoom eases, the player hops and walks in frames. */
  readonly smoothMotion: boolean;
  /** The camera snaps to whole sprite pixels (needed when the scene is drawn at sprite resolution). */
  readonly pixelSnap: boolean;
  /** Dropped items bob up and down. */
  readonly itemBob: boolean;
  /** Additive lights and the vignette are applied to the finished scene. */
  readonly lighting: boolean;
  /** Particles and other effects are drawn. */
  readonly effects: boolean;
  /** The scene is drawn on a canvas with one pixel per sprite pixel, then scaled up in one blit. */
  readonly lowResScene: boolean;
  /** Painter set that draws the style's own art where it has some, or null for the shared drawing only. */
  readonly painterSet: PainterSetId | null;
  /** Name of the game.json runewardArtVariants entry the style draws with, or null for the default Runeward art. */
  readonly artVariant: string | null;
  /** False keeps the style out of the choices offered to players (Options list, G key); saved settings may still load it. */
  readonly selectable: boolean;
}

const MODERN_STYLE: RenderStyleDescriptor = {
  id: 'modern',
  labelKey: `${LABEL_KEY_PREFIX}modern${LABEL_KEY_SUFFIX}`,
  sprite: null,
  palettesKey: null,
  base: null,
  smallSprite: null,
  transformKey: null,
  finish: null,
  glow: true,
  floorShadows: true,
  lcdAllowed: false,
  canvasClass: null,
  smoothMotion: true,
  pixelSnap: false,
  itemBob: true,
  lighting: true,
  effects: true,
  lowResScene: false,
  painterSet: null,
  artVariant: null,
  selectable: true
};

const RETRO16_STYLE: RenderStyleDescriptor = {
  id: 'retro',
  labelKey: `${LABEL_KEY_PREFIX}retro${LABEL_KEY_SUFFIX}`,
  sprite: RETRO16_SPEC,
  palettesKey: 'retroPalettes',
  base: 'retro16',
  smallSprite: RETRO16_SPEC,
  transformKey: null,
  finish: null,
  glow: true,
  floorShadows: true,
  lcdAllowed: true,
  canvasClass: RETRO_PIXELS_CLASS,
  smoothMotion: false,
  pixelSnap: true,
  itemBob: false,
  lighting: false,
  effects: false,
  lowResScene: true,
  painterSet: null,
  artVariant: null,
  selectable: true
};

const RETRO32_STYLE: RenderStyleDescriptor = {
  id: 'retro32',
  labelKey: `${LABEL_KEY_PREFIX}retro32${LABEL_KEY_SUFFIX}`,
  sprite: RETRO32_SPEC,
  palettesKey: 'retro32Palettes',
  base: 'retro32',
  smallSprite: RETRO16_SPEC,
  transformKey: null,
  finish: null,
  glow: true,
  floorShadows: true,
  lcdAllowed: false,
  canvasClass: RETRO_PIXELS_CLASS,
  smoothMotion: false,
  pixelSnap: true,
  itemBob: false,
  lighting: true,
  effects: true,
  lowResScene: true,
  painterSet: null,
  artVariant: null,
  selectable: true
};

/** Everything a Retro HD style sets; the rest is shared by all of them. */
interface RetroHdStyleOptions {
  readonly id: RenderStyleId;
  readonly overlay: OverlayKind | null;
  readonly gradientBands: number;
  readonly lighting: boolean;
  readonly floorShadows: boolean;
}

/**
 * A style that draws like HD Neon (full resolution, smooth motion, the same tiles) with the colours
 * of its renderStylePalettes entry (keyed by its id), banded gradients, no glow and an optional overlay.
 */
function retroHdStyle(options: RetroHdStyleOptions): RenderStyleDescriptor {
  return {
    id: options.id,
    labelKey: `${LABEL_KEY_PREFIX}${options.id}${LABEL_KEY_SUFFIX}`,
    sprite: null,
    palettesKey: null,
    base: null,
    smallSprite: null,
    transformKey: options.id,
    finish: { gradientBands: options.gradientBands, overlay: options.overlay },
    glow: false,
    floorShadows: options.floorShadows,
    lcdAllowed: false,
    canvasClass: null,
    smoothMotion: true,
    pixelSnap: false,
    itemBob: true,
    lighting: options.lighting,
    effects: true,
    lowResScene: false,
    painterSet: null,
    artVariant: null,
    selectable: true
  };
}

const POCKET_STYLE = retroHdStyle({
  id: 'pocket', overlay: 'lcdDots', gradientBands: RETRO_HD_GRADIENT_BANDS, lighting: true, floorShadows: true
});
const PASTEL_STYLE = retroHdStyle({
  id: 'pastel', overlay: null, gradientBands: RETRO_HD_GRADIENT_BANDS, lighting: true, floorShadows: true
});
const BLUEPRINT_STYLE = retroHdStyle({
  id: 'blueprint', overlay: 'gridLines', gradientBands: RETRO_HD_GRADIENT_BANDS, lighting: true, floorShadows: true
});
const SEPIA_STYLE = retroHdStyle({
  id: 'sepia', overlay: 'vignetteGrain', gradientBands: RETRO_HD_GRADIENT_BANDS, lighting: true, floorShadows: true
});
const CLASSIC90_STYLE = retroHdStyle({
  id: 'classic90', overlay: 'scanlines', gradientBands: CLASSIC90_GRADIENT_BANDS, lighting: false, floorShadows: false
});

/** Id of the Runeward style. */
export const RUNEWARD_STYLE_ID: RenderStyleId = 'runeward';

/** Runeward look: HD drawing in the dark violet Runeward colours; its painters arrive lot by lot. */
const RUNEWARD_STYLE: RenderStyleDescriptor = {
  id: RUNEWARD_STYLE_ID,
  labelKey: `${LABEL_KEY_PREFIX}${RUNEWARD_STYLE_ID}${LABEL_KEY_SUFFIX}`,
  sprite: null,
  palettesKey: null,
  base: null,
  smallSprite: null,
  transformKey: RUNEWARD_STYLE_ID,
  finish: null,
  glow: false,
  floorShadows: true,
  lcdAllowed: false,
  canvasClass: null,
  smoothMotion: true,
  pixelSnap: false,
  itemBob: true,
  lighting: true,
  effects: true,
  lowResScene: false,
  painterSet: 'runeward',
  artVariant: null,
  selectable: false
};

/** Id of the Runeward Parchment style and of the art variant it draws with. */
export const RUNEWARD_PARCHMENT_STYLE_ID: RenderStyleId = 'runeward_parchment';
const RUNEWARD_PARCHMENT_ART_VARIANT = 'parchment';

/** Runeward Parchment look: the Runeward painters with the ink-on-aged-paper art variant. */
const RUNEWARD_PARCHMENT_STYLE: RenderStyleDescriptor = {
  ...RUNEWARD_STYLE,
  id: RUNEWARD_PARCHMENT_STYLE_ID,
  labelKey: `${LABEL_KEY_PREFIX}${RUNEWARD_PARCHMENT_STYLE_ID}${LABEL_KEY_SUFFIX}`,
  transformKey: RUNEWARD_PARCHMENT_STYLE_ID,
  artVariant: RUNEWARD_PARCHMENT_ART_VARIANT
};

/** Every style, in registration order (the G key cycles through the selectable ones). */
export const RENDER_STYLES: readonly RenderStyleDescriptor[] = [
  MODERN_STYLE,
  RETRO16_STYLE,
  RETRO32_STYLE,
  POCKET_STYLE,
  PASTEL_STYLE,
  BLUEPRINT_STYLE,
  SEPIA_STYLE,
  CLASSIC90_STYLE,
  RUNEWARD_STYLE,
  RUNEWARD_PARCHMENT_STYLE
];

/** The styles offered to players: the Options list and the G key. */
export const SELECTABLE_RENDER_STYLES: readonly RenderStyleDescriptor[] = RENDER_STYLES.filter((style) => style.selectable);

/** Style a fresh install and an unknown id fall back to. */
export const DEFAULT_RENDER_STYLE_ID: RenderStyleId = 'modern';

/** Id of the style, or undefined when `value` names none. */
export function parseRenderStyleId(value: unknown): RenderStyleId | undefined {
  return RENDER_STYLES.find((style) => style.id === value)?.id;
}

/** Descriptor of the style; an unknown id (never expected at runtime) gives the default style. */
export function getRenderStyle(id: RenderStyleId): RenderStyleDescriptor {
  return RENDER_STYLES.find((style) => style.id === id) ?? RENDER_STYLES[0];
}

/**
 * Style the G key switches to from `id`, wrapping around after the last selectable one. A style that
 * is not selectable (loaded from saved settings) hands over to the next selectable style after it.
 */
export function nextRenderStyle(id: RenderStyleId): RenderStyleDescriptor {
  const index = RENDER_STYLES.findIndex((style) => style.id === id);
  for (let step = 1; step <= RENDER_STYLES.length; step++) {
    const candidate = RENDER_STYLES[(index + step) % RENDER_STYLES.length];
    if (candidate.selectable) return candidate;
  }
  return RENDER_STYLES[0];
}
