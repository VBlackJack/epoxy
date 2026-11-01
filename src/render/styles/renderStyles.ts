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
 * Registry of the render styles: HD Neon (vector), 16-Bit Retro, 32-Bit Retro and the five styles
 * derived from them by recolouring (Pocket, Pastel, Blueprint, Sepia, Classic 90s). Each
 * descriptor says which sprites and palettes a style draws with and which behaviours it turns
 * on, so the renderer and the UI ask the registry instead of comparing style ids. Pure module.
 */

import type { GraphicsStyle } from '../../core/types';
import { RETRO16_SPEC, createSpriteStyleSpec, type SpriteStyleSpec } from '../retroSprites';
import { RETRO32_LAYER_SCALE, RETRO32_SPEC } from '../retro32/spriteStyle32';

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

/** Scale of the 16-Bit pipeline over the authoring grid. */
const RETRO16_LAYER_SCALE = 1;
/** Suffix of the id of the 16-px spec a 32-px derived style falls back to on small tiles. */
const SMALL_SPEC_SUFFIX = '-16';

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
  /**
   * Spec used when tiles are drawn smaller than `sprite`: the 16-px sprites, recoloured like the
   * style. Has its own id when the style recolours, so composed tiles of two styles never mix.
   */
  readonly smallSprite: SpriteStyleSpec | null;
  /** Key of the style's entry in game.json renderStylePalettes, or null when it keeps the base colours. */
  readonly transformKey: string | null;
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
}

const MODERN_STYLE: RenderStyleDescriptor = {
  id: 'modern',
  labelKey: `${LABEL_KEY_PREFIX}modern${LABEL_KEY_SUFFIX}`,
  sprite: null,
  palettesKey: null,
  base: null,
  smallSprite: null,
  transformKey: null,
  floorShadows: true,
  lcdAllowed: false,
  canvasClass: null,
  smoothMotion: true,
  pixelSnap: false,
  itemBob: true,
  lighting: true,
  effects: true,
  lowResScene: false
};

const RETRO16_STYLE: RenderStyleDescriptor = {
  id: 'retro',
  labelKey: `${LABEL_KEY_PREFIX}retro${LABEL_KEY_SUFFIX}`,
  sprite: RETRO16_SPEC,
  palettesKey: 'retroPalettes',
  base: 'retro16',
  smallSprite: RETRO16_SPEC,
  transformKey: null,
  floorShadows: true,
  lcdAllowed: true,
  canvasClass: RETRO_PIXELS_CLASS,
  smoothMotion: false,
  pixelSnap: true,
  itemBob: false,
  lighting: false,
  effects: false,
  lowResScene: true
};

const RETRO32_STYLE: RenderStyleDescriptor = {
  id: 'retro32',
  labelKey: `${LABEL_KEY_PREFIX}retro32${LABEL_KEY_SUFFIX}`,
  sprite: RETRO32_SPEC,
  palettesKey: 'retro32Palettes',
  base: 'retro32',
  smallSprite: RETRO16_SPEC,
  transformKey: null,
  floorShadows: true,
  lcdAllowed: false,
  canvasClass: RETRO_PIXELS_CLASS,
  smoothMotion: false,
  pixelSnap: true,
  itemBob: false,
  lighting: true,
  effects: true,
  lowResScene: true
};

/** Everything a style derived from a retro pipeline sets; the rest follows from its base. */
interface DerivedStyleOptions {
  readonly id: RenderStyleId;
  readonly base: SpriteBase;
  readonly lcdAllowed: boolean;
  readonly lighting: boolean;
  readonly effects: boolean;
  readonly floorShadows: boolean;
}

/** A style that draws the sprites of `base` recoloured by its renderStylePalettes entry (keyed by its id). */
function derivedStyle(options: DerivedStyleOptions): RenderStyleDescriptor {
  const sixteen = options.base === 'retro16';
  const sprite = createSpriteStyleSpec(options.id, sixteen ? RETRO16_LAYER_SCALE : RETRO32_LAYER_SCALE, !sixteen);
  return {
    id: options.id,
    labelKey: `${LABEL_KEY_PREFIX}${options.id}${LABEL_KEY_SUFFIX}`,
    sprite,
    palettesKey: sixteen ? 'retroPalettes' : 'retro32Palettes',
    base: options.base,
    smallSprite: sixteen ? sprite : createSpriteStyleSpec(`${options.id}${SMALL_SPEC_SUFFIX}`, RETRO16_LAYER_SCALE, false),
    transformKey: options.id,
    floorShadows: options.floorShadows,
    lcdAllowed: options.lcdAllowed,
    canvasClass: RETRO_PIXELS_CLASS,
    smoothMotion: false,
    pixelSnap: true,
    itemBob: false,
    lighting: options.lighting,
    effects: options.effects,
    lowResScene: true
  };
}

const POCKET_STYLE = derivedStyle({
  id: 'pocket', base: 'retro16', lcdAllowed: true, lighting: false, effects: false, floorShadows: true
});
const PASTEL_STYLE = derivedStyle({
  id: 'pastel', base: 'retro16', lcdAllowed: false, lighting: false, effects: false, floorShadows: true
});
const BLUEPRINT_STYLE = derivedStyle({
  id: 'blueprint', base: 'retro16', lcdAllowed: false, lighting: false, effects: false, floorShadows: true
});
const SEPIA_STYLE = derivedStyle({
  id: 'sepia', base: 'retro32', lcdAllowed: false, lighting: false, effects: false, floorShadows: true
});
const CLASSIC90_STYLE = derivedStyle({
  id: 'classic90', base: 'retro32', lcdAllowed: false, lighting: false, effects: false, floorShadows: false
});

/** Every style, in the order the G key cycles through them. */
export const RENDER_STYLES: readonly RenderStyleDescriptor[] = [
  MODERN_STYLE,
  RETRO16_STYLE,
  RETRO32_STYLE,
  POCKET_STYLE,
  PASTEL_STYLE,
  BLUEPRINT_STYLE,
  SEPIA_STYLE,
  CLASSIC90_STYLE
];

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

/** Style the G key switches to from `id`, wrapping around after the last one. */
export function nextRenderStyle(id: RenderStyleId): RenderStyleDescriptor {
  const index = RENDER_STYLES.findIndex((style) => style.id === id);
  return RENDER_STYLES[(index + 1) % RENDER_STYLES.length];
}
