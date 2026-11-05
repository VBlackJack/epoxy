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

import type { ColourFamily, RenderStyleFamilies, RenderStylePaletteConfig, ThemePalette } from '../../core/types';
import { createTestBundle } from '../../test/loadTestConfigs';
import { parseHexColour } from '../retro32/colour';
import { RENDER_STYLES } from './renderStyles';
import {
  COLOUR_FAMILIES,
  THEME_COLOUR_KEYS,
  classifyColour,
  createRetroHdRecolour,
  findStyleFamilyErrors,
  findStylePaletteErrors,
  parseCssColour
} from './retroHdPalette';

const bundle = createTestBundle();
const game = bundle.game;
const stylePalettes = game.renderStylePalettes as Record<string, RenderStylePaletteConfig>;
const families = game.renderStyleFamilies as RenderStyleFamilies;
const themes = game.themes as Record<string, ThemePalette>;
const retroHdIds = RENDER_STYLES.filter((style) => style.finish !== null).map((style) => style.id);
const paletteIds = RENDER_STYLES.filter((style) => style.transformKey !== null).map((style) => style.id);
const HEX = /^#[0-9a-f]{6}$/;
/** Channel levels of the 64-colour EGA table the VGA-era 16 colours come from. */
const EGA_LEVELS = new Set([0x00, 0x55, 0xaa, 0xff]);
const CLASSIC_MAX_TONES_PER_FAMILY = 4;
const SOFTENED_BY = 0.9;
const BLUE_CHANNEL = 2;
const RED_CHANNEL = 0;

function recolourOf(styleId: string) {
  return createRetroHdRecolour(stylePalettes[styleId], families);
}

function isWarm([r, , b]: readonly number[]): boolean {
  return r > b;
}

function isCool([r, , b]: readonly number[]): boolean {
  return b > r;
}

function saturationOf([r, g, b]: readonly number[]): number {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

function lumaOf(hex: string): number {
  const [r, g, b] = parseHexColour(hex);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

describe('Retro HD palettes in game.json', () => {
  it('are valid for every Retro HD style', () => {
    expect(findStylePaletteErrors(stylePalettes, paletteIds)).toEqual([]);
    expect(findStyleFamilyErrors(families, Object.keys(game.palette))).toEqual([]);
  });

  it('give every recoloured style a ramp for every family and no entry for the other styles', () => {
    expect(Object.keys(stylePalettes).sort()).toEqual([...paletteIds].sort());
    expect(paletteIds).toEqual([...retroHdIds, 'runeward', 'runeward_parchment']);
    for (const id of paletteIds) expect(Object.keys(stylePalettes[id].families).sort()).toEqual([...COLOUR_FAMILIES].sort());
  });

  it('report a missing table, a missing entry and bad fields', () => {
    expect(findStylePaletteErrors(undefined, ['sepia'])).toHaveLength(1);
    expect(findStylePaletteErrors(undefined, [])).toEqual([]);
    expect(findStylePaletteErrors({}, ['sepia'])).toEqual(['renderStylePalettes.sepia is missing']);
    expect(findStylePaletteErrors({ a: { families: {} } }, ['a'])).toHaveLength(COLOUR_FAMILIES.length);
    const oneStop = { ...stylePalettes.sepia.families, red: ['#aa0000'] };
    expect(findStylePaletteErrors({ a: { families: oneStop } }, ['a'])).toEqual([
      'renderStylePalettes.a.families.red needs 2+ #rrggbb colours'
    ]);
    const notHex = { ...stylePalettes.sepia.families, blue: ['#0000aa', 'blue'] };
    expect(findStylePaletteErrors({ a: { families: notHex } }, ['a'])).toHaveLength(1);
    expect(findStylePaletteErrors({ a: { families: stylePalettes.sepia.families, quantize: 'yes' } }, ['a'])).toHaveLength(1);
  });

  it('report a bad family table', () => {
    expect(findStyleFamilyErrors(undefined, [])).toHaveLength(1);
    expect(findStyleFamilyErrors({ palette: {} }, [])).toEqual(['renderStyleFamilies.theme is missing']);
    const errors = findStyleFamilyErrors(
      {
        palette: { red: 'wobble', ghost: 'red', green: { family: 'green', tone: 2 } },
        theme: { floorTop: 'neutral', nothing: 'neutral' }
      },
      ['red', 'green']
    );
    expect(errors).toHaveLength(4);
    expect(errors.join('|')).toContain('ghost');
    expect(errors.join('|')).toContain('nothing');
  });

  it('assign a family only to colours that exist', () => {
    for (const key of Object.keys(families.palette)) expect(game.palette[key], key).toBeDefined();
    for (const key of Object.keys(families.theme)) expect(THEME_COLOUR_KEYS as readonly string[]).toContain(key);
  });

  it('refuse a config the recolour cannot be built from', () => {
    expect(() => createRetroHdRecolour({ families: {} } as unknown as RenderStylePaletteConfig, families)).toThrow();
    const short = { families: { ...stylePalettes.pocket.families, cyan: ['#00aaaa'] } };
    expect(() => createRetroHdRecolour(short, families)).toThrow();
  });
});

describe('colour families', () => {
  it('classify a colour by hue, and greys as neutral', () => {
    const family = (hex: string): ColourFamily => classifyColour(parseHexColour(hex));
    expect(family('#ff1744')).toBe('red');
    expect(family('#ff9100')).toBe('orange');
    expect(family('#ffd600')).toBe('yellow');
    expect(family('#00e676')).toBe('green');
    expect(family('#00e5ff')).toBe('cyan');
    expect(family('#2979ff')).toBe('blue');
    expect(family('#aa00ff')).toBe('purple');
    expect(family('#455a64')).toBe('neutral');
    expect(family('#ffffff')).toBe('neutral');
    expect(family('#000000')).toBe('neutral');
  });

  it('read #rrggbb and rgba() colours and nothing else', () => {
    expect(parseCssColour('#102030')).toEqual({ rgb: [16, 32, 48], alpha: null });
    expect(parseCssColour('rgba(10, 20, 30, 0.5)')).toEqual({ rgb: [10, 20, 30], alpha: '0.5' });
    expect(parseCssColour('rgb(10,20,30)')).toEqual({ rgb: [10, 20, 30], alpha: '1' });
    expect(parseCssColour('blue')).toBeNull();
    expect(parseCssColour('#fff')).toBeNull();
  });
});

describe('palette recolouring', () => {
  it('keeps every palette key, with a valid colour, in every style', () => {
    for (const id of retroHdIds) {
      const out = recolourOf(id).palette(game.palette);
      expect(Object.keys(out)).toEqual(Object.keys(game.palette));
      for (const [key, value] of Object.entries(out)) {
        expect(value, `${id} ${key}`).toMatch(/^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [0-9.]+\))$/);
      }
    }
  });

  it('keeps the alpha of translucent colours and leaves other strings alone', () => {
    for (const id of retroHdIds) {
      const out = recolourOf(id).palette({ shadow: 'rgba(0, 0, 0, 0.42)', clear: 'rgba(0, 230, 118, 0)', odd: 'not a colour' });
      expect(out.shadow).toMatch(/, 0\.42\)$/);
      expect(out.clear).toMatch(/, 0\)$/);
      expect(out.odd).toBe('not a colour');
    }
  });

  it('leaves its input alone and recolours the colour fields of a theme only', () => {
    const before = structuredClone(game.palette);
    const theme = themes.cyber_neon;
    const out = recolourOf('sepia').theme(theme);
    expect(game.palette).toEqual(before);
    expect(out).not.toBe(theme);
    expect(out.id).toBe(theme.id);
    expect(out.i18nKey).toBe(theme.i18nKey);
    expect(out.musicTrackId).toBe(theme.musicTrackId);
    for (const key of THEME_COLOUR_KEYS) expect(out[key], key).toMatch(HEX);
    expect(out.floorTop).not.toBe(theme.floorTop);
  });

  it('keeps the lightness order of colours of one family', () => {
    const out = recolourOf('blueprint').palette({ dark: '#400000', mid: '#a00000', light: '#ff8080' });
    expect(lumaOf(out.dark)).toBeLessThan(lumaOf(out.mid));
    expect(lumaOf(out.mid)).toBeLessThan(lumaOf(out.light));
  });

  it('lets a tone pin the place of a colour in its family ramp', () => {
    const pinned: RenderStyleFamilies = { palette: { a: { family: 'red', tone: 0 }, b: { family: 'red', tone: 1 } }, theme: {} };
    const out = createRetroHdRecolour(stylePalettes.pastel, pinned).palette({ a: '#ffffff', b: '#000000' });
    expect(out.a).toBe(stylePalettes.pastel.families.red[0]);
    expect(out.b).toBe(stylePalettes.pastel.families.red.at(-1));
  });

  it('keeps fire warm, and water and ice cool, in every style', () => {
    for (const id of [...retroHdIds, 'runeward_parchment']) {
      const out = recolourOf(id).palette(game.palette);
      for (const key of ['modernFireCore', 'modernFireMid', 'modernFireEdge']) {
        expect(isWarm(parseHexColour(out[key])), `${id} ${key}`).toBe(true);
      }
      for (const key of ['modernWaterTop', 'modernWaterBottom', 'modernIceTop', 'modernIceMid']) {
        expect(isCool(parseHexColour(out[key])), `${id} ${key}`).toBe(true);
      }
    }
  });
});

describe('the look of each style', () => {
  it('gives Pocket greens for the neutrals', () => {
    const recolour = recolourOf('pocket');
    const out = recolour.palette(game.palette);
    for (const key of ['floorBase', 'wallBase', 'lcdGrid', 'irisShade', 'lightAmbient', 'eyeWhite']) {
      const [r, g, b] = parseHexColour(out[key]);
      expect(g, key).toBeGreaterThan(r);
      expect(g, key).toBeGreaterThan(b);
    }
    for (const theme of Object.values(themes)) {
      const [r, g, b] = parseHexColour(recolour.theme(theme).floorTop);
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
    }
  });

  it('keeps the hues of Pastel but softens them', () => {
    const original = game.palette;
    const out = recolourOf('pastel').palette(original);
    for (const key of ['red', 'blue', 'green', 'monsterBug']) {
      expect(saturationOf(parseHexColour(out[key])), key).toBeLessThan(saturationOf(parseHexColour(original[key])) * SOFTENED_BY);
    }
    const [r, g, b] = parseHexColour(out.red);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('runs Blueprint from deep blue to white and Sepia from dark brown to cream', () => {
    for (const [id, tint] of [['blueprint', BLUE_CHANNEL], ['sepia', RED_CHANNEL]] as const) {
      const out = recolourOf(id).palette({ dark: '#000000', light: '#ffffff' });
      const dark = parseHexColour(out.dark);
      const light = parseHexColour(out.light);
      expect(dark[tint]).toBeLessThan(light[tint]);
      expect(Math.max(...dark)).toBeLessThan(Math.min(...light));
      if (id === 'blueprint') expect(dark[BLUE_CHANNEL]).toBeGreaterThan(dark[RED_CHANNEL]);
      else expect(dark[RED_CHANNEL]).toBeGreaterThan(dark[BLUE_CHANNEL]);
    }
  });

  it('maps Classic 90s onto the 16 colour table and a few tones per family', () => {
    const config = stylePalettes.classic90;
    expect(config.quantize).toBe(true);
    const tones = new Set(Object.values(config.families).flat());
    for (const hex of tones) for (const channel of parseHexColour(hex)) expect(EGA_LEVELS.has(channel), hex).toBe(true);
    for (const stops of Object.values(config.families)) expect(stops.length).toBeLessThanOrEqual(CLASSIC_MAX_TONES_PER_FAMILY);
    const out = recolourOf('classic90').palette(game.palette);
    for (const [key, value] of Object.entries(out)) {
      if (parseCssColour(value)?.alpha === null) expect(tones.has(value), `${key} ${value}`).toBe(true);
    }
    // One family per colour: red stays red, whatever its lightness.
    for (const key of ['red', 'monsterBug', 'trapBorder']) {
      const [r, g, b] = parseHexColour(out[key]);
      expect(r, key).toBeGreaterThanOrEqual(Math.max(g, b));
    }
  });
});
