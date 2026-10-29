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

import { describe, expect, it } from 'vitest';
import rendererSource from './PixelRenderer.ts?raw';
import { createTestBundle } from '../test/loadTestConfigs';
import {
  BOOT_COLOR_KEYS,
  BUTTON_COLOR_KEYS,
  BUTTON_GLYPH_KEYS,
  DEFAULT_BOOT_COLOR_KEY,
  DEFAULT_COLOR_KEY,
  DEFAULT_MONSTER_COLOR_KEY,
  FX_COLOR_KEYS,
  MONSTER_COLOR_KEYS
} from './paletteKeys';

const palette = createTestBundle().game.palette;

describe('renderer palette usage', () => {
  it('reads only palette keys that game.json defines', () => {
    const used = new Set<string>();
    for (const match of rendererSource.matchAll(/\bpal\.([A-Za-z_]\w*)/g)) {
      used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((key) => !(key in palette));
    expect(missing).toEqual([]);
  });

  it('maps identifiers only to palette keys that game.json defines', () => {
    const mapped = [
      ...Object.values(FX_COLOR_KEYS),
      ...Object.values(BUTTON_COLOR_KEYS),
      ...Object.values(BUTTON_GLYPH_KEYS),
      ...Object.values(BOOT_COLOR_KEYS),
      ...Object.values(MONSTER_COLOR_KEYS),
      DEFAULT_BOOT_COLOR_KEY,
      DEFAULT_COLOR_KEY,
      DEFAULT_MONSTER_COLOR_KEY
    ];
    const missing = mapped.filter((key) => !(key in palette));
    expect(missing).toEqual([]);
  });

  it('keeps colour literals out of the renderer', () => {
    const literals = rendererSource.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
    expect(literals).toEqual([]);
  });
});
