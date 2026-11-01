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
 * Pixel-level regression guard for the five recolouring styles. For every style and retro
 * palette theme, the recoloured ramps and every sprite of the sheet (without and with a swap
 * ramp) are hashed; the committed snapshot holds one line per style, theme and group, so a
 * failing line names itself. The plain 16-Bit and 32-Bit styles have their own snapshots and
 * must not change when a recolouring style is added.
 *
 * Run vitest in update mode (`-u`) to rewrite the snapshot on purpose.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { RenderStylePaletteConfig } from '../../core/types';
import { createTestBundle } from '../../test/loadTestConfigs';
import { createRetro32SpriteCache } from '../retro32/cache';
import { rasterizeSprite32 } from '../retro32/rasterize';
import { createRetro32ThemeSprites } from '../retro32/spriteStyle32';
import { RETRO_SWAP_RAMPS } from '../paletteKeys';
import {
  RETRO_SHEET,
  RETRO_SPRITE_NAMES,
  rasterizeSprite,
  resolveRetroRamps,
  type RetroRamps
} from '../retroSprites';
import { RENDER_STYLES } from './renderStyles';
import { applyRampTransform, createStyleTransforms } from './styleTransforms';

const SNAPSHOT_PATH = '../__snapshots__/derivedStyles/rasterize.snap.txt';
const HASH_ALGORITHM = 'sha256';
const HASH_HEX_LENGTH = 16;
const CACHE_ENTRIES = 16;
const MIN_LINES = 10;

const bundle = createTestBundle();
const palettes = bundle.game.retroPalettes;
const stylePalettes = bundle.game.renderStylePalettes as Record<string, RenderStylePaletteConfig>;
/** Themes hashed: the default ramps and one theme that overrides floor and wall ramps. */
const SNAPSHOT_THEMES = ['default', 'magma_core'];
const TEST_TIMEOUT_MS = 60000;
const swapRamp = Object.values(RETRO_SWAP_RAMPS)[0];

function hashText(text: string): string {
  return createHash(HASH_ALGORITHM).update(text).digest('hex').slice(0, HASH_HEX_LENGTH);
}

function hashBytes(bytes: Uint8ClampedArray): string {
  return createHash(HASH_ALGORITHM).update(bytes).digest('hex').slice(0, HASH_HEX_LENGTH);
}

describe('recolouring styles pixel snapshot', () => {
  it('keeps the ramps and every sprite of every style and theme byte-identical', async () => {
    const lines: string[] = [];
    for (const style of RENDER_STYLES.filter((s) => s.transformKey !== null)) {
      const transforms = createStyleTransforms(stylePalettes[style.id]);
      for (const themeId of SNAPSHOT_THEMES) {
        const ramps16 = resolveRetroRamps(palettes, themeId);
        let ramps: RetroRamps;
        const rasterize = (name: string, swap?: string): Uint8ClampedArray => {
          const sprite = RETRO_SHEET.sprites[name];
          return style.base === 'retro32'
            ? rasterizeSprite32(sprite, ramps, ramps16, swap)
            : rasterizeSprite(sprite, ramps, swap);
        };
        if (style.base === 'retro32') {
          ramps = createRetro32ThemeSprites(
            themeId, ramps16, undefined, createRetro32SpriteCache(CACHE_ENTRIES), RETRO_SHEET,
            { styleId: style.id, transform: transforms.ramps }
          ).ramps32;
        } else {
          ramps = applyRampTransform(ramps16, transforms.ramps);
        }
        const plain = RETRO_SPRITE_NAMES.map((name) => hashBytes(rasterize(name))).join(',');
        const swapped = RETRO_SPRITE_NAMES.map((name) => hashBytes(rasterize(name, swapRamp))).join(',');
        lines.push(`${style.id} ${themeId} ramps=${hashText(JSON.stringify(ramps))}`);
        lines.push(`${style.id} ${themeId} sprites=${hashText(plain)} swapped=${hashText(swapped)}`);
      }
    }
    expect(lines.length).toBeGreaterThan(MIN_LINES);
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(SNAPSHOT_PATH);
  }, TEST_TIMEOUT_MS);
});
