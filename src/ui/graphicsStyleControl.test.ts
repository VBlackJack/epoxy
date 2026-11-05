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
import { getRenderStyle, RENDER_STYLES, RETRO_PIXELS_CLASS } from '../render/styles/renderStyles';
import {
  buildGraphicsStyleOptions,
  canvasClassesToRemove,
  isLcdAvailable,
  resolveInitialGraphicsStyle
} from './graphicsStyleControl';

describe('graphics style control helpers', () => {
  it('lists every style in cycle order with its label key', () => {
    const options = buildGraphicsStyleOptions();
    expect(options.map((o) => o.value)).toEqual([
      'modern', 'retro', 'retro32', 'pocket', 'pastel', 'blueprint', 'sepia', 'classic90'
    ]);
    expect(options[2].labelKey).toBe('app.header.graphics_retro32.action');
    expect(options[7].labelKey).toBe('app.header.graphics_classic90.action');
  });

  it('keeps the unselectable Runeward styles out of the list yet restores them from saved settings', () => {
    for (const id of ['runeward', 'runeward_parchment'] as const) {
      expect(buildGraphicsStyleOptions().map((o) => o.value)).not.toContain(id);
      expect(buildGraphicsStyleOptions(RENDER_STYLES).map((o) => o.value)).not.toContain(id);
      expect(resolveInitialGraphicsStyle(id, 'modern')).toBe(id);
      expect(isLcdAvailable(id)).toBe(false);
      expect(canvasClassesToRemove(id)).toEqual([RETRO_PIXELS_CLASS]);
    }
  });

  it('restores a saved retro32 style and falls back on unknown values', () => {
    expect(resolveInitialGraphicsStyle('retro32', 'modern')).toBe('retro32');
    expect(resolveInitialGraphicsStyle('bogus', 'retro')).toBe('retro');
    expect(resolveInitialGraphicsStyle(undefined, 'bogus')).toBe('modern');
  });

  it('restores a saved derived style and falls back on unknown values', () => {
    expect(resolveInitialGraphicsStyle('classic90', 'modern')).toBe('classic90');
    expect(resolveInitialGraphicsStyle('sepia', undefined)).toBe('sepia');
    expect(resolveInitialGraphicsStyle('classic91', 'pocket')).toBe('pocket');
    expect(resolveInitialGraphicsStyle('classic91', 'bogus')).toBe('modern');
  });

  it('allows the LCD grid in 16-Bit Retro only, Pocket drawing its dot grid as a fixed overlay instead', () => {
    expect(isLcdAvailable('modern')).toBe(false);
    expect(isLcdAvailable('retro')).toBe(true);
    expect(isLcdAvailable('retro32')).toBe(false);
    for (const id of ['pocket', 'pastel', 'blueprint', 'sepia', 'classic90'] as const) expect(isLcdAvailable(id)).toBe(false);
    expect(getRenderStyle('pocket').finish?.overlay).toBe('lcdDots');
  });

  it('removes the pixel class only for styles that do not use it', () => {
    expect(canvasClassesToRemove('modern')).toEqual([RETRO_PIXELS_CLASS]);
    expect(canvasClassesToRemove('retro32')).toEqual([]);
    expect(canvasClassesToRemove('classic90')).toEqual([RETRO_PIXELS_CLASS]);
    for (const id of ['pocket', 'pastel', 'blueprint', 'sepia'] as const) expect(canvasClassesToRemove(id)).toEqual([RETRO_PIXELS_CLASS]);
  });
});
