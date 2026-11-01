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
 * Memo cache of rasterized 32-Bit Retro sprites, keyed by (theme id, sprite name, swap ramp, style id),
 * with least-recently-used eviction. Pure module: the caller supplies the producer.
 */

/** Separator between key parts; never part of a theme id, sprite name or ramp name. */
const KEY_SEPARATOR = '\u0000';
/** Swap part of the key when a sprite has no swap ramp. */
const NO_SWAP_KEY = '';
/** Style part of the key for the plain 32-Bit style, and for callers that name no style. */
const DEFAULT_STYLE_KEY = '';

export interface Retro32SpriteCache {
  /**
   * Returns the cached pixels, or calls produce once, stores and returns its result. `styleId`
   * keeps the sprites of styles that recolour the same sheet apart.
   */
  get(
    themeId: string,
    spriteName: string,
    swapRamp: string | undefined,
    produce: () => Uint8ClampedArray,
    styleId?: string
  ): Uint8ClampedArray;
  /** Number of entries held. */
  readonly size: number;
  clear(): void;
}

export function createRetro32SpriteCache(maxEntries: number): Retro32SpriteCache {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error(`Invalid cache size: ${maxEntries}`);
  const entries = new Map<string, Uint8ClampedArray>();
  return {
    get(themeId, spriteName, swapRamp, produce, styleId) {
      const key = [themeId, spriteName, swapRamp ?? NO_SWAP_KEY, styleId ?? DEFAULT_STYLE_KEY].join(KEY_SEPARATOR);
      const hit = entries.get(key);
      if (hit) {
        entries.delete(key);
        entries.set(key, hit);
        return hit;
      }
      const pixels = produce();
      entries.set(key, pixels);
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
      return pixels;
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    }
  };
}
