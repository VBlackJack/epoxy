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
import { RETRO_PIXELS_CLASS } from '../render/styles/renderStyles';
import {
  buildGraphicsStyleOptions,
  canvasClassesToRemove,
  isLcdAvailable,
  resolveInitialGraphicsStyle
} from './graphicsStyleControl';

describe('graphics style control helpers', () => {
  it('lists every style in cycle order with its label key', () => {
    const options = buildGraphicsStyleOptions();
    expect(options.map((o) => o.value)).toEqual(['modern', 'retro', 'retro32']);
    expect(options[2].labelKey).toBe('app.header.graphics_retro32.action');
  });

  it('restores a saved retro32 style and falls back on unknown values', () => {
    expect(resolveInitialGraphicsStyle('retro32', 'modern')).toBe('retro32');
    expect(resolveInitialGraphicsStyle('bogus', 'retro')).toBe('retro');
    expect(resolveInitialGraphicsStyle(undefined, 'bogus')).toBe('modern');
  });

  it('allows the LCD grid in 16-Bit Retro only', () => {
    expect(isLcdAvailable('modern')).toBe(false);
    expect(isLcdAvailable('retro')).toBe(true);
    expect(isLcdAvailable('retro32')).toBe(false);
  });

  it('removes the pixel class only for styles that do not use it', () => {
    expect(canvasClassesToRemove('modern')).toEqual([RETRO_PIXELS_CLASS]);
    expect(canvasClassesToRemove('retro32')).toEqual([]);
  });
});
