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
 * Sprite style of the 32-Bit Retro look: its spec (twice the authoring grid, 15-bit shadow) and
 * the factory of its sprite source. The source derives 8-tone 15-bit ramps from a theme's 16-bit
 * ramps (plus optional retro32Palettes overrides) and memoises every rasterized sprite per theme.
 * Pure module: no DOM.
 */

import {
  createSpriteStyleSpec,
  RETRO_SHEET,
  resolveRetroRamps,
  type RetroRamps,
  type RetroSheet,
  type SpriteSource,
  type SpriteStyleSpec
} from '../retroSprites';
import type { Retro32SpriteCache } from './cache';
import { deriveRetro32Ramps } from './ramps';
import { rasterizeSprite32 } from './rasterize';

/** Id of the 32-Bit Retro style. */
export const RETRO32_STYLE_ID = 'retro32';
/** Scale of the 32-Bit style over the 16-px authoring grid. */
export const RETRO32_LAYER_SCALE = 2;

export const RETRO32_SPEC: SpriteStyleSpec = createSpriteStyleSpec(RETRO32_STYLE_ID, RETRO32_LAYER_SCALE, true);

/** Ramps and sprite source of one theme in the 32-Bit style. */
export interface Retro32ThemeSprites {
  readonly ramps32: RetroRamps;
  readonly source: SpriteSource;
}

/**
 * Builds the 32-Bit ramps and sprite source of a theme. `ramps16` are the theme's resolved
 * 16-Bit ramps; `retro32Palettes` (game.json, same shape as retroPalettes) replace whole ramps.
 * Rasterized sprites are memoised in `cache` under `themeId`; clear the cache when the palettes
 * change.
 */
export function createRetro32ThemeSprites(
  themeId: string,
  ramps16: RetroRamps,
  retro32Palettes: Record<string, Record<string, string[]>> | undefined,
  cache: Retro32SpriteCache,
  sheet: RetroSheet = RETRO_SHEET
): Retro32ThemeSprites {
  const ramps32 = deriveRetro32Ramps(ramps16, resolveRetroRamps(retro32Palettes, themeId));
  const source: SpriteSource = {
    dims(name) {
      const sprite = sheet.sprites[name];
      return sprite
        ? { width: sprite.width * RETRO32_LAYER_SCALE, height: sprite.height * RETRO32_LAYER_SCALE }
        : undefined;
    },
    pixels(name, swapRamp) {
      return cache.get(themeId, name, swapRamp, () => rasterizeSprite32(sheet.sprites[name], ramps32, ramps16, swapRamp));
    }
  };
  return { ramps32, source };
}
