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
 * Registry of the render styles: HD Neon (vector), 16-Bit Retro and 32-Bit Retro. Each
 * descriptor says which sprites and palettes a style draws with and which behaviours it turns
 * on, so the renderer and the UI ask the registry instead of comparing style ids. Pure module.
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

export interface RenderStyleDescriptor {
  readonly id: RenderStyleId;
  /** i18n key of the style name shown when the style is selected. */
  readonly labelKey: string;
  /** Sprite parameters, or null for the vector HD Neon drawing. */
  readonly sprite: SpriteStyleSpec | null;
  /** Config key of the style's colour ramps, or null when it has none. */
  readonly palettesKey: PalettesKey | null;
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
  lcdAllowed: false,
  canvasClass: RETRO_PIXELS_CLASS,
  smoothMotion: false,
  pixelSnap: true,
  itemBob: false,
  lighting: true,
  effects: true,
  lowResScene: true
};

/** Every style, in the order the G key cycles through them. */
export const RENDER_STYLES: readonly RenderStyleDescriptor[] = [MODERN_STYLE, RETRO16_STYLE, RETRO32_STYLE];

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
