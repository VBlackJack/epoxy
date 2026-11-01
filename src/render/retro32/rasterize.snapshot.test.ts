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
 * Pixel-level regression guard for the 32-Bit Retro rasterizer. Every sprite of the sheet is
 * rasterized for every retro palette theme, without and with a swap ramp, and the raw RGBA bytes
 * are hashed. The committed snapshot holds one line per case, so a failing line names itself.
 * Performance work on the rasterizer must keep this file unchanged.
 *
 * Run vitest in update mode (`-u`) to rewrite the snapshot on purpose.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createTestBundle } from '../../test/loadTestConfigs';
import { RETRO_SWAP_RAMPS } from '../paletteKeys';
import { RETRO_SHEET, RETRO_SPRITE_NAMES, resolveRetroRamps } from '../retroSprites';
import { rasterizeSprite32 } from './rasterize';
import { deriveRetro32Ramps } from './ramps';

const SNAPSHOT_PATH = '../__snapshots__/retro32/rasterize.snap.txt';
const PERF_FILE_FROM_ROOT = 'local/retro32-perf.txt';
const REPO_ROOT_DEPTH = '../../..';
const HASH_ALGORITHM = 'sha256';
const HASH_HEX_LENGTH = 16;
const PERF_THEME = 'default';
const PERF_ROUNDS = 5;
const MIN_CASES = 1000;

const palettes = createTestBundle().game.retroPalettes as Record<string, Record<string, string[]>>;
const themeIds = Object.keys(palettes);
const swapRamp = Object.values(RETRO_SWAP_RAMPS)[0];

function hashBytes(bytes: Uint8ClampedArray): string {
  return createHash(HASH_ALGORITHM).update(bytes).digest('hex').slice(0, HASH_HEX_LENGTH);
}

describe('32-Bit Retro rasterizer pixel snapshot', () => {
  it('keeps every sprite of every theme byte-identical, with and without swap ramp', async () => {
    const lines: string[] = [];
    for (const themeId of themeIds) {
      const ramps16 = resolveRetroRamps(palettes, themeId);
      const ramps32 = deriveRetro32Ramps(ramps16);
      for (const name of RETRO_SPRITE_NAMES) {
        const sprite = RETRO_SHEET.sprites[name];
        const plain = hashBytes(rasterizeSprite32(sprite, ramps32, ramps16));
        const swapped = hashBytes(rasterizeSprite32(sprite, ramps32, ramps16, swapRamp));
        lines.push(`${themeId} ${name} plain=${plain} swap=${swapped}`);
      }
    }
    expect(lines.length).toBeGreaterThan(MIN_CASES / 2);
    await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot(SNAPSHOT_PATH);
  });

  it('records the time to rasterize the whole sheet in one theme', () => {
    const ramps16 = resolveRetroRamps(palettes, PERF_THEME);
    const ramps32 = deriveRetro32Ramps(ramps16);
    const run = (): number => {
      const start = performance.now();
      for (const name of RETRO_SPRITE_NAMES) rasterizeSprite32(RETRO_SHEET.sprites[name], ramps32, ramps16);
      return performance.now() - start;
    };
    run();
    const times = Array.from({ length: PERF_ROUNDS }, run).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const here = dirname(fileURLToPath(import.meta.url));
    const file = resolvePath(here, REPO_ROOT_DEPTH, PERF_FILE_FROM_ROOT);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `sprites=${RETRO_SPRITE_NAMES.length} theme=${PERF_THEME} median_ms=${median.toFixed(1)} min_ms=${times[0].toFixed(1)}\n`,
      { flag: 'w' }
    );
    expect(median).toBeGreaterThan(0);
  });
});
