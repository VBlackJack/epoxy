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

import {
  DEFAULT_RENDER_STYLE_ID,
  RENDER_STYLES,
  RETRO_PIXELS_CLASS,
  getRenderStyle,
  nextRenderStyle,
  parseRenderStyleId
} from './renderStyles';

const SIXTEEN_BIT_TILE = 16;
const THIRTY_TWO_BIT_TILE = 32;

describe('render style registry', () => {
  it('lists the styles in G key order', () => {
    expect(RENDER_STYLES.map((s) => s.id)).toEqual(['modern', 'retro', 'retro32']);
  });

  it('gives every style a distinct id and a label key following the header naming', () => {
    expect(new Set(RENDER_STYLES.map((s) => s.id)).size).toBe(RENDER_STYLES.length);
    for (const style of RENDER_STYLES) expect(style.labelKey).toBe(`app.header.graphics_${style.id}.action`);
  });

  it('reproduces the HD Neon behaviour', () => {
    const modern = getRenderStyle('modern');
    expect(modern.sprite).toBeNull();
    expect(modern.palettesKey).toBeNull();
    expect(modern.canvasClass).toBeNull();
    expect(modern.lcdAllowed).toBe(false);
    expect(modern.smoothMotion).toBe(true);
    expect(modern.pixelSnap).toBe(false);
    expect(modern.itemBob).toBe(true);
    expect(modern.lighting).toBe(true);
    expect(modern.effects).toBe(true);
    expect(modern.lowResScene).toBe(false);
  });

  it('reproduces the 16-Bit Retro behaviour', () => {
    const retro = getRenderStyle('retro');
    expect(retro.sprite?.tileSize).toBe(SIXTEEN_BIT_TILE);
    expect(retro.palettesKey).toBe('retroPalettes');
    expect(retro.canvasClass).toBe(RETRO_PIXELS_CLASS);
    expect(retro.canvasClass).toBe('retro-pixels');
    expect(retro.lcdAllowed).toBe(true);
    expect(retro.smoothMotion).toBe(false);
    expect(retro.pixelSnap).toBe(true);
    expect(retro.itemBob).toBe(false);
    expect(retro.lighting).toBe(false);
    expect(retro.effects).toBe(false);
    expect(retro.lowResScene).toBe(true);
  });

  it('describes the 32-Bit Retro style', () => {
    const retro32 = getRenderStyle('retro32');
    expect(retro32.sprite?.tileSize).toBe(THIRTY_TWO_BIT_TILE);
    expect(retro32.palettesKey).toBe('retro32Palettes');
    expect(retro32.canvasClass).toBe(RETRO_PIXELS_CLASS);
    expect(retro32.lcdAllowed).toBe(false);
    expect(retro32.smoothMotion).toBe(false);
    expect(retro32.pixelSnap).toBe(true);
    expect(retro32.itemBob).toBe(false);
    expect(retro32.lighting).toBe(true);
    expect(retro32.effects).toBe(true);
    expect(retro32.lowResScene).toBe(true);
  });

  it('gives a sprite spec to exactly the low resolution styles', () => {
    for (const style of RENDER_STYLES) expect(style.sprite !== null).toBe(style.lowResScene);
  });

  it('cycles modern, retro, retro32 and wraps around', () => {
    expect(nextRenderStyle('modern').id).toBe('retro');
    expect(nextRenderStyle('retro').id).toBe('retro32');
    expect(nextRenderStyle('retro32').id).toBe('modern');
    let id = DEFAULT_RENDER_STYLE_ID;
    for (let i = 0; i < RENDER_STYLES.length; i++) id = nextRenderStyle(id).id;
    expect(id).toBe(DEFAULT_RENDER_STYLE_ID);
  });

  it('parses only known ids', () => {
    expect(parseRenderStyleId('modern')).toBe('modern');
    expect(parseRenderStyleId('retro')).toBe('retro');
    expect(parseRenderStyleId('retro32')).toBe('retro32');
    expect(parseRenderStyleId('retro16')).toBeUndefined();
    expect(parseRenderStyleId(32)).toBeUndefined();
    expect(parseRenderStyleId(null)).toBeUndefined();
  });
});
