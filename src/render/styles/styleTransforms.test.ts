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

import type { RenderStylePaletteConfig } from '../../core/types';
import { createTestBundle } from '../../test/loadTestConfigs';
import { parseHexColour } from '../retro32/colour';
import { createRetro32SpriteCache } from '../retro32/cache';
import { deriveRetro32Ramps } from '../retro32/ramps';
import { createRetro32ThemeSprites } from '../retro32/spriteStyle32';
import { RETRO_SHEET, resolveRetroRamps, type RetroRamps } from '../retroSprites';
import { RENDER_STYLES } from './renderStyles';
import {
  COLOUR_CODED_RAMPS,
  MIN_CODED_RAMP_DISTANCE,
  applyRampTransform,
  colourDistance,
  createStyleTransforms,
  findStylePaletteErrors
} from './styleTransforms';

const bundle = createTestBundle();
const palettes = bundle.game.retroPalettes;
const stylePalettes = bundle.game.renderStylePalettes as Record<string, RenderStylePaletteConfig>;
const themeIds = Object.keys(palettes ?? {});
const derivedStyles = RENDER_STYLES.filter((style) => style.transformKey !== null);
const CACHE_ENTRIES = 16;
const POCKET_TONES = 4;
const VGA_FAMILY_MAX_TONES = 3;
/** Fraction of the probe tone's range, as an index into a ramp: the middle tone carries the colour code. */
const MIDDLE = 0.5;

function middleTone(tones: readonly string[]): string {
  return tones[Math.floor((tones.length - 1) * MIDDLE)];
}

/** The ramps of a theme in a derived style, built the way the renderer builds them. */
function styleRamps(styleId: string, themeId: string): RetroRamps {
  const style = derivedStyles.find((s) => s.id === styleId);
  if (!style) throw new Error(`not a derived style: ${styleId}`);
  const ramps16 = resolveRetroRamps(palettes, themeId);
  const transforms = createStyleTransforms(stylePalettes[styleId]);
  if (style.base === 'retro16') return applyRampTransform(ramps16, transforms.ramps);
  const sprites = createRetro32ThemeSprites(
    themeId, ramps16, undefined, createRetro32SpriteCache(CACHE_ENTRIES), RETRO_SHEET,
    { styleId, transform: transforms.ramps }
  );
  return sprites.ramps32;
}

describe('derived style palettes in game.json', () => {
  it('are valid for every derived style', () => {
    expect(findStylePaletteErrors(stylePalettes, derivedStyles.map((s) => s.id))).toEqual([]);
  });

  it('reports a missing table, a missing entry and bad fields', () => {
    expect(findStylePaletteErrors(undefined, ['sepia'])).toHaveLength(1);
    expect(findStylePaletteErrors(undefined, [])).toEqual([]);
    expect(findStylePaletteErrors({}, ['sepia'])).toEqual(['renderStylePalettes.sepia is missing']);
    expect(findStylePaletteErrors({ a: { kind: 'wobble' } }, ['a'])).toEqual(['renderStylePalettes.a.kind is unknown']);
    expect(findStylePaletteErrors({ a: { kind: 'paletteMap', stops: ['#000000'], accents: {} } }, ['a']).length).toBeGreaterThan(
      COLOUR_CODED_RAMPS.length
    );
    expect(findStylePaletteErrors({ a: { kind: 'pastel', saturation: 2, lightness: 0 } }, ['a'])).toHaveLength(1);
    expect(
      findStylePaletteErrors(
        { a: { kind: 'vgaFamilies', palette: ['#000000'], families: { x: [0, 9] }, pinnedFamilies: {} } },
        ['a']
      ).length
    ).toBeGreaterThan(2);
  });

  it('refuses a config the transform cannot be built from', () => {
    expect(() => createStyleTransforms({ kind: 'paletteMap' })).toThrow();
    expect(() => createStyleTransforms({ kind: 'vgaFamilies', palette: ['#000000'] })).toThrow();
    expect(() => createStyleTransforms({ kind: 'nope' } as unknown as RenderStylePaletteConfig)).toThrow();
  });
});

describe('ramp transforms', () => {
  it('keep the number of tones of every ramp, in every theme and style', () => {
    for (const style of derivedStyles) {
      const transforms = createStyleTransforms(stylePalettes[style.id]);
      for (const themeId of themeIds) {
        const ramps16 = resolveRetroRamps(palettes, themeId);
        const base = style.base === 'retro32' ? deriveRetro32Ramps(ramps16) : ramps16;
        const out = applyRampTransform(base, transforms.ramps);
        expect(Object.keys(out)).toEqual(Object.keys(base));
        for (const name of Object.keys(base)) {
          expect(out[name]).toHaveLength(base[name].length);
          for (const hex of out[name]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });

  it('map a single colour with the same palette as the ramps', () => {
    for (const style of derivedStyles) {
      const transforms = createStyleTransforms(stylePalettes[style.id]);
      const sample = '#336699';
      expect(transforms.colour(sample)).toBe(transforms.ramps('probe', [sample])[0]);
      expect(transforms.colour('rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.5)');
    }
  });

  it('give Pocket exactly four greens, whatever the source colours', () => {
    const out = styleRamps('pocket', 'default');
    const used = new Set(Object.values(out).flat());
    expect(used.size).toBeLessThanOrEqual(POCKET_TONES);
    for (const hex of used) {
      const [r, g, b] = parseHexColour(hex);
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
    }
  });

  it('keep the hues of Pastel but soften them', () => {
    const transforms = createStyleTransforms(stylePalettes.pastel);
    const [r, g, b] = parseHexColour(transforms.colour('#ff0000'));
    expect(r).toBeGreaterThan(g);
    expect(g).toBe(b);
    expect(g).toBeGreaterThan(0);
    const [grey, greyG, greyB] = parseHexColour(transforms.colour('#808080'));
    expect(grey === greyG && greyG === greyB).toBe(true);
  });

  it('run Blueprint from deep blue to white and Sepia from dark brown to cream', () => {
    for (const [id, tint] of [['blueprint', 2], ['sepia', 0]] as const) {
      const transforms = createStyleTransforms(stylePalettes[id]);
      const dark = parseHexColour(transforms.colour('#000000'));
      const light = parseHexColour(transforms.colour('#ffffff'));
      expect(dark[tint]).toBeLessThan(light[tint]);
      expect(Math.max(...dark)).toBeLessThan(Math.min(...light));
      if (id === 'blueprint') expect(dark[2]).toBeGreaterThan(dark[0]);
      else expect(dark[0]).toBeGreaterThan(dark[2]);
    }
  });

  it('map Classic 90s ramps onto at most three tones of the 16 colour table', () => {
    const config = stylePalettes.classic90;
    const table = new Set(config.palette);
    const out = styleRamps('classic90', 'default');
    for (const [name, tones] of Object.entries(out)) {
      for (const hex of tones) expect(table.has(hex), `${name} ${hex}`).toBe(true);
      expect(new Set(tones).size).toBeLessThanOrEqual(VGA_FAMILY_MAX_TONES);
    }
    // One family per ramp: no ramp scatters over unrelated hues.
    const redTones = out.red.map(parseHexColour);
    for (const [r, g, b] of redTones) expect(r).toBeGreaterThanOrEqual(Math.max(g, b));
  });
});

describe('colour-coded ramps stay distinguishable in every style', () => {
  for (const style of derivedStyles) {
    it(`${style.id}: red, blue, yellow and green differ by at least ${MIN_CODED_RAMP_DISTANCE}`, () => {
      for (const themeId of themeIds) {
        const out = styleRamps(style.id, themeId);
        for (let i = 0; i < COLOUR_CODED_RAMPS.length; i++) {
          for (let j = i + 1; j < COLOUR_CODED_RAMPS.length; j++) {
            const a = COLOUR_CODED_RAMPS[i];
            const b = COLOUR_CODED_RAMPS[j];
            const distance = colourDistance(
              parseHexColour(middleTone(out[a])),
              parseHexColour(middleTone(out[b]))
            );
            expect(distance, `${style.id} ${themeId}: ${a} vs ${b}`).toBeGreaterThanOrEqual(MIN_CODED_RAMP_DISTANCE);
          }
        }
      }
    });
  }

  it('also holds for the plain styles the derived ones are built from', () => {
    const ramps16 = resolveRetroRamps(palettes, 'default');
    for (const ramps of [ramps16, deriveRetro32Ramps(ramps16)]) {
      for (let i = 0; i < COLOUR_CODED_RAMPS.length; i++) {
        for (let j = i + 1; j < COLOUR_CODED_RAMPS.length; j++) {
          const distance = colourDistance(
            parseHexColour(middleTone(ramps[COLOUR_CODED_RAMPS[i]])),
            parseHexColour(middleTone(ramps[COLOUR_CODED_RAMPS[j]]))
          );
          expect(distance).toBeGreaterThanOrEqual(MIN_CODED_RAMP_DISTANCE);
        }
      }
    }
  });
});
