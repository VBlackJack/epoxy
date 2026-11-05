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

/** The marker that the eye boots put on hidden walls must part from the floor in every theme and style. */

import { describe, expect, it } from 'vitest';

import type { ThemePalette } from '../core/types';
import { createTestBundle } from '../test/loadTestConfigs';
import { RETRO_HIDDEN_WALL_MARKERS } from './retroSpriteNames';
import { RETRO_SHEET, RETRO_TRANSPARENT_CHAR, resolveRetroRamps } from './retroSprites';
import { createRetroHdRecolour, parseCssColour } from './styles/retroHdPalette';
import { RENDER_STYLES } from './styles/renderStyles';
import { MIN_CODED_RAMP_DISTANCE, colourDistance } from './styles/styleTransforms';
import type { Rgb } from './retro32/colour';

const bundle = createTestBundle();
const game = bundle.game;
const themes = game.themes as Record<string, ThemePalette>;
const retroHdStyles = RENDER_STYLES.filter((style) => style.finish !== null);
/** Legend key of the outline colour, which the markers share with every sprite and which does not count as their ink. */
const OUTLINE_KEY = 'o';
/**
 * The 16 px marker sprites keep the ink they have in the editor. Their weakest case is the invisible wall on the white
 * floor of arctic_lab (about 52); a lower bar than the vector styles guards against anything worse until the sprite is redrawn.
 */
const MIN_SPRITE_MARKER_DISTANCE = 50;

function rgbOf(text: string): Rgb {
  const parsed = parseCssColour(text);
  if (!parsed) throw new Error(`not a colour: ${text}`);
  return parsed.rgb;
}

/** Colours the themed drawing uses for the markers: [invisible wall, appearing wall]. */
function markerColours(palette: Readonly<Record<string, string>>, theme: ThemePalette): string[] {
  return [theme.accentGlow, palette.yellow];
}

function floorColours(theme: ThemePalette): string[] {
  return [theme.floorTop, theme.floorBottom];
}

function tooClose(markers: readonly string[], floors: readonly string[]): string[] {
  const failures: string[] = [];
  for (const marker of markers) {
    for (const floor of floors) {
      const distance = colourDistance(rgbOf(marker), rgbOf(floor));
      if (distance < MIN_CODED_RAMP_DISTANCE) failures.push(`${marker} vs ${floor} = ${distance.toFixed(1)}`);
    }
  }
  return failures;
}

describe('hidden wall marker contrast', () => {
  for (const [themeId, theme] of Object.entries(themes)) {
    it(`HD Neon in ${themeId}: both markers part from both floor colours`, () => {
      expect(tooClose(markerColours(game.palette, theme), floorColours(theme))).toEqual([]);
    });
  }

  for (const style of retroHdStyles) {
    for (const [themeId, theme] of Object.entries(themes)) {
      it(`${style.id} in ${themeId}: both markers part from both floor colours`, () => {
        const recolour = createRetroHdRecolour(game.renderStylePalettes![style.id], game.renderStyleFamilies!);
        const recoloured = recolour.theme(theme);
        expect(tooClose(markerColours(recolour.palette(game.palette), recoloured), floorColours(recoloured))).toEqual([]);
      });
    }
  }

  it('flat drawing: both markers part from the floor', () => {
    expect(tooClose([game.palette.wallBase, game.palette.yellow], [game.palette.floorBase])).toEqual([]);
  });

  for (const themeId of Object.keys(themes)) {
    it(`sprite styles in ${themeId}: both marker sprites hold an ink that parts from every floor tone`, () => {
      const ramps = resolveRetroRamps(game.retroPalettes, themeId);
      const floor = ramps.floor;
      for (const [tileId, name] of Object.entries(RETRO_HIDDEN_WALL_MARKERS)) {
        const sprite = RETRO_SHEET.sprites[name];
        const inks = new Set<string>();
        for (const row of sprite.rows) {
          for (const ch of row) {
            const ref = sprite.legend[ch];
            if (ref && ch !== OUTLINE_KEY && ch !== RETRO_TRANSPARENT_CHAR) inks.add(ref);
          }
        }
        const colours = [...inks].map((ref) => {
          const at = ref.lastIndexOf('.');
          return ramps[ref.slice(0, at)][Number(ref.slice(at + 1))];
        });
        const best = Math.max(...colours.map((c) => Math.min(...floor.map((f) => colourDistance(rgbOf(c), rgbOf(f))))));
        expect(best, `${tileId} in ${themeId}`).toBeGreaterThanOrEqual(MIN_SPRITE_MARKER_DISTANCE);
      }
    });
  }
});
