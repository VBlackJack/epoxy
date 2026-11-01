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
import retroSource from './retroSprites.ts?raw';
import { createTestBundle } from '../test/loadTestConfigs';
import { RETRO_BOOT_RAMPS, RETRO_PLAIN_TELEPORT_RAMP, RETRO_SWAP_RAMPS } from './paletteKeys';
import {
  RETRO_DEFAULT_THEME_ID,
  RETRO_RAMP_NAMES,
  RETRO_SHEET,
  RETRO_SPRITE_NAMES,
  RETRO_SPRITE_SIZE,
  RetroRamps,
  RetroSheet,
  RetroSprite,
  blitPixels,
  findRetroSheetErrors,
  hasRetroSprite,
  isNineBitColour,
  mergeRetroSheets,
  missingRetroSprites,
  rasterizeSprite,
  resolveRetroRamps
} from './retroSprites';

const game = createTestBundle().game;
const palettes = game.retroPalettes ?? {};
const ramps: RetroRamps = {
  outline: ['#000024'],
  red: ['#FF0000', '#B60000'],
  blue: ['#0000FF', '#0000B6'],
  floor: ['#6D92B6', '#496D92']
};
const BYTES = 4;
const px = (data: Uint8ClampedArray, width: number, x: number, y: number): number[] =>
  Array.from(data.slice((y * width + x) * BYTES, (y * width + x) * BYTES + BYTES));

function sprite(rows: string[], legend: Record<string, string>, outline = false): RetroSprite {
  return { width: rows[0].length, height: rows.length, rows, legend, outline };
}
function floorRows(fill = 'a'): string[] {
  return Array.from({ length: RETRO_SPRITE_SIZE }, () => fill.repeat(RETRO_SPRITE_SIZE));
}
function sheetOf(name: string, s: RetroSprite): RetroSheet {
  return { sprites: { [name]: s } };
}

describe('retro palettes', () => {
  it('uses only 9-bit colours in every ramp of every theme', () => {
    for (const [themeId, theme] of Object.entries(palettes)) {
      for (const [ramp, tones] of Object.entries(theme)) {
        for (const tone of tones) expect(isNineBitColour(tone), `${themeId}.${ramp} ${tone}`).toBe(true);
      }
    }
  });

  it('resolves every ramp for every game theme', () => {
    const themeIds = Object.keys(game.themes ?? {});
    expect(themeIds.length).toBeGreaterThan(0);
    for (const id of themeIds) {
      const resolved = resolveRetroRamps(palettes, id);
      for (const name of RETRO_RAMP_NAMES) expect(resolved[name]?.length, `${id}.${name}`).toBeGreaterThan(0);
      for (const name of ['floor', 'wall', 'wallRim']) {
        expect(palettes[id]?.[name], `${id} overrides ${name}`).toBeDefined();
      }
    }
  });

  it('lets a theme override whole ramps of default', () => {
    const r = resolveRetroRamps({ default: { floor: ['#FFFFFF'], wall: ['#000000'] }, t: { floor: ['#24FF00'] } }, 't');
    expect(r.floor).toEqual(['#24FF00']);
    expect(r.wall).toEqual(['#000000']);
    expect(resolveRetroRamps(undefined, 't')).toEqual({});
    expect(resolveRetroRamps(palettes, RETRO_DEFAULT_THEME_ID).floor).toEqual(palettes.default.floor);
  });

  it('classifies 9-bit colours', () => {
    expect(isNineBitColour('#002492')).toBe(true);
    expect(isNineBitColour('#ffdb6d')).toBe(true);
    expect(isNineBitColour('#123456')).toBe(false);
    expect(isNineBitColour('#FFF')).toBe(false);
    expect(isNineBitColour('FFFFFF')).toBe(false);
  });
});

describe('rasterizeSprite', () => {
  const legend = { a: 'red.0', b: 'blue.1', k: '$.0', o: 'outline.0' };

  it('resolves the legend and leaves "." transparent', () => {
    const data = rasterizeSprite(sprite(['ab.'], legend), ramps);
    expect(px(data, 3, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(data, 3, 1, 0)).toEqual([0, 0, 182, 255]);
    expect(px(data, 3, 2, 0)[3]).toBe(0);
  });

  it('treats unknown characters as transparent', () => {
    expect(px(rasterizeSprite(sprite(['z'], legend), ramps), 1, 0, 0)[3]).toBe(0);
  });

  it('resolves the swap ramp at draw time', () => {
    const s = sprite(['k'], legend);
    expect(px(rasterizeSprite(s, ramps, 'blue'), 1, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(px(rasterizeSprite(s, ramps, 'red'), 1, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(rasterizeSprite(s, ramps), 1, 0, 0)[3]).toBe(0);
  });

  it('adds an outline on 4-adjacent transparent pixels only, never over opaque ones', () => {
    const data = rasterizeSprite(sprite(['...', '.a.', '...'], legend, true), ramps);
    const outline = [0, 0, 36, 255];
    for (const [x, y] of [[1, 0], [0, 1], [2, 1], [1, 2]]) expect(px(data, 3, x, y)).toEqual(outline);
    for (const [x, y] of [[0, 0], [2, 0], [0, 2], [2, 2]]) expect(px(data, 3, x, y)[3]).toBe(0);
    expect(px(data, 3, 1, 1)).toEqual([255, 0, 0, 255]);
    const touching = rasterizeSprite(sprite(['ab'], legend, true), ramps);
    expect(px(touching, 2, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(touching, 2, 1, 0)).toEqual([0, 0, 182, 255]);
  });

  it('draws no outline when the sprite does not ask for one', () => {
    expect(px(rasterizeSprite(sprite(['.a.'], legend), ramps), 3, 0, 0)[3]).toBe(0);
  });
});

describe('blitPixels', () => {
  const src = new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0, 4, 5, 6, 255, 7, 8, 9, 255]);

  it('paints opaque pixels only', () => {
    const dst = new Uint8ClampedArray(3 * 3 * BYTES);
    blitPixels(dst, 3, src, 2, 1, 1);
    expect(px(dst, 3, 1, 1)).toEqual([1, 2, 3, 255]);
    expect(px(dst, 3, 2, 1)[3]).toBe(0);
    expect(px(dst, 3, 2, 2)).toEqual([7, 8, 9, 255]);
  });

  it('clips on every side', () => {
    const dst = new Uint8ClampedArray(2 * 2 * BYTES);
    blitPixels(dst, 2, src, 2, -1, -1);
    expect(px(dst, 2, 0, 0)).toEqual([7, 8, 9, 255]);
    expect(px(dst, 2, 1, 1)[3]).toBe(0);
    const edge = new Uint8ClampedArray(2 * 2 * BYTES);
    blitPixels(edge, 2, src, 2, 1, 1);
    expect(px(edge, 2, 1, 1)).toEqual([1, 2, 3, 255]);
    const none = new Uint8ClampedArray(2 * 2 * BYTES);
    blitPixels(none, 2, src, 2, 5, 5);
    expect(Array.from(none).every((v) => v === 0)).toBe(true);
  });
});

describe('sheets', () => {
  it('merges sheets and folds legends per sprite', () => {
    const merged = mergeRetroSheets([
      { legend: { a: 'floor.0', b: 'floor.1' }, sprites: { one: { rows: ['ab'], legend: { b: 'wall.0' }, outline: true } } },
      { legend: { a: 'red.0' }, sprites: { two: { rows: ['a'] } } }
    ]);
    expect(merged.sprites.one.legend).toEqual({ a: 'floor.0', b: 'wall.0' });
    expect(merged.sprites.one.outline).toBe(true);
    expect(merged.sprites.two.outline).toBe(false);
    expect(merged.sprites.two.width).toBe(1);
    expect(() => mergeRetroSheets([
      { legend: {}, sprites: { x: { rows: ['a'] } } },
      { legend: {}, sprites: { x: { rows: ['a'] } } }
    ])).toThrow(/Duplicate/);
  });

  it('ships sheets without errors', () => {
    expect(hasRetroSprite('floor')).toBe(true);
    expect(hasRetroSprite('nope')).toBe(false);
    expect(findRetroSheetErrors(RETRO_SHEET, palettes)).toEqual([]);
  });

  it('reports bad sizes', () => {
    const good = { a: 'floor.0' };
    expect(findRetroSheetErrors(sheetOf('floor', sprite(floorRows(), good)), palettes)).toEqual([]);
    const badSize = findRetroSheetErrors(sheetOf('floor', sprite(['aaa'], good)), palettes);
    expect(badSize.some((e) => e.includes('must be 16x16'))).toBe(true);
    const glyph = findRetroSheetErrors(sheetOf('glyph_red', sprite(floorRows(), good)), palettes);
    expect(glyph.some((e) => e.includes('must be 5x5'))).toBe(true);
    const digit = sprite(['aaa', 'aaa', 'aaa', 'aaa', 'aaa'], good);
    expect(findRetroSheetErrors(sheetOf('digit_1', digit), palettes)).toEqual([]);
  });

  it('reports unknown characters, ramps and tones', () => {
    const unknownChar = findRetroSheetErrors(sheetOf('floor', sprite(floorRows('q'), { a: 'floor.0' })), palettes);
    expect(unknownChar.some((e) => e.includes("unknown character 'q'"))).toBe(true);
    const unknownRamp = findRetroSheetErrors(sheetOf('floor', sprite(floorRows(), { a: 'nope.0' })), palettes);
    expect(unknownRamp.some((e) => e.includes('unknown ramp nope'))).toBe(true);
    const unknownTone = findRetroSheetErrors(sheetOf('floor', sprite(floorRows(), { a: 'floor.9' })), palettes);
    expect(unknownTone.some((e) => e.includes('tone 9'))).toBe(true);
    const notRef = findRetroSheetErrors(sheetOf('floor', sprite(floorRows(), { a: 'floor' })), palettes);
    expect(notRef.some((e) => e.includes('not ramp.tone'))).toBe(true);
    const swapTone = findRetroSheetErrors(sheetOf('door', sprite(floorRows('k'), { k: '$.3' })), palettes);
    expect(swapTone.some((e) => e.includes('swap tone 3'))).toBe(true);
  });

  it('reports non 9-bit colours and missing ramps', () => {
    const badColour = structuredClone(palettes);
    badColour.default.floor[0] = '#123456';
    expect(findRetroSheetErrors(RETRO_SHEET, badColour).some((e) => e.includes('not 9-bit'))).toBe(true);
    const missing = structuredClone(palettes);
    delete missing.default.eye;
    expect(findRetroSheetErrors(RETRO_SHEET, missing).some((e) => e.includes('lacks ramp eye'))).toBe(true);
    expect(findRetroSheetErrors(RETRO_SHEET, undefined).length).toBeGreaterThan(0);
  });

  it('rejects a sprite with more than 15 colours', () => {
    const chars = 'abcdefghijklmnop';
    const custom = structuredClone(palettes);
    const levels = ['00', '24', '49', '6D', '92', 'B6', 'DB', 'FF'];
    const legend: Record<string, string> = {};
    const names = ['dirt', 'gravel', 'metal', 'trap'];
    names.forEach((name, k) => {
      custom.default[name] = [0, 1, 2, 3].map((t) => `#${levels[k * 2]}${levels[t]}${levels[k * 2 + 1]}`);
      for (let t = 0; t < 4; t++) legend[chars[k * 4 + t]] = `${name}.${t}`;
    });
    const rows = Array.from({ length: RETRO_SPRITE_SIZE }, () => chars);
    const fits = findRetroSheetErrors(sheetOf('floor', sprite(rows, legend)), custom);
    expect(fits.some((e) => e.includes('max 15'))).toBe(true);
    const fifteen = sprite(rows.map((r) => r.replace('p', 'a')), legend);
    expect(findRetroSheetErrors(sheetOf('floor', fifteen), custom).some((e) => e.includes('max 15'))).toBe(false);
  });

  it('lists every required sprite an empty sheet lacks', () => {
    expect(missingRetroSprites({ sprites: {} })).toEqual([...RETRO_SPRITE_NAMES]);
  });

  it('ships every required sprite', () => {
    expect(missingRetroSprites(RETRO_SHEET)).toEqual([]);
  });
});

describe('ramp tables', () => {
  it('names only ramps that default defines', () => {
    const names = [
      ...Object.values(RETRO_SWAP_RAMPS),
      ...Object.values(RETRO_BOOT_RAMPS),
      RETRO_PLAIN_TELEPORT_RAMP
    ];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name in palettes.default, name).toBe(true);
  });

  it('colours force boots green', () => {
    expect(RETRO_BOOT_RAMPS.boots_force).toBe('green');
  });

  it('keeps colour literals out of the sprite module', () => {
    const literals = retroSource.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
    expect(literals).toEqual([]);
  });
});
