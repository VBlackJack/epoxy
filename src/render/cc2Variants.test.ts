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

import { describe, expect, it, vi } from 'vitest';
import { NO_SIGN_ITEM_IDS, NO_SIGN_ITEM_PREFIX } from '../core/coreConstants';
import type { RunewardArtConfig } from '../core/types';
import { CC2_ITEM_VARIANTS, cc2VariantOf, paintCc2Mark, paletteMarkColours, runewardMarkColours } from './cc2Variants';
import type { MarkPalette } from './cc2Variants';

const PALETTE: MarkPalette = {
  green: '#0f0',
  brown: '#840',
  gray: '#888',
  red: '#f00',
  blue: '#00f',
  glyphInk: '#111',
  hintGlyph: '#eee',
  wallShadow: '#222',
  forbidSign: '#ff1744'
};

describe('no-sign item variants', () => {
  it('draws every no-sign over the item it names, with the no-sign mark', () => {
    for (const id of NO_SIGN_ITEM_IDS) {
      const variant = cc2VariantOf(CC2_ITEM_VARIANTS, `${NO_SIGN_ITEM_PREFIX}${id}`);
      expect(variant, id).toEqual({ base: id, mark: 'no_sign' });
    }
  });

  it('lets the hiking boots keep their own look under the sign', () => {
    expect(cc2VariantOf(CC2_ITEM_VARIANTS, 'hiking_boots')?.mark).toBe('tread');
    expect(cc2VariantOf(CC2_ITEM_VARIANTS, 'no_sign_hiking_boots')?.base).toBe('hiking_boots');
  });

  it('takes the red of the forbid sign in a vector style and of the forbid art in Runeward', () => {
    expect(paletteMarkColours(PALETTE, 'no_sign')).toMatchObject({ fill: '#ff1744', edge: '#ff1744' });
    const art = { ink: { line: '#000' }, item: { forbid: { ring: '#aa0000', slash: '#ff5555' } } } as unknown as RunewardArtConfig;
    expect(runewardMarkColours(art, 'no_sign')).toMatchObject({ fill: '#aa0000', edge: '#ff5555' });
  });

  it('paints a ring and a bar inside the cell', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '',
      lineWidth: 0,
      lineCap: ''
    };
    paintCc2Mark(ctx as unknown as CanvasRenderingContext2D, 'no_sign', 10, 20, 32, paletteMarkColours(PALETTE, 'no_sign'));
    expect(ctx.arc).toHaveBeenCalledTimes(1);
    expect(ctx.arc.mock.calls[0].slice(0, 2)).toEqual([26, 36]);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
  });
});
