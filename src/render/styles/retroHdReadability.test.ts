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
 * Readability of the five Retro HD styles: colours that look alike in HD Neon, or that the game
 * relies on telling apart (fire from the red hazards, water from ice, a key from its door...), must
 * stay at least MIN_CODED_RAMP_DISTANCE apart after the style recolours them, in every theme. Each
 * check names the real palette and theme keys it compares.
 */

import { describe, expect, it } from 'vitest';

import type { ThemePalette } from '../../core/types';
import { createTestBundle } from '../../test/loadTestConfigs';
import type { Rgb } from '../retro32/colour';
import { MONSTER_COLOR_KEYS } from '../paletteKeys';
import { createRetroHdRecolour, parseCssColour } from './retroHdPalette';
import { RENDER_STYLES } from './renderStyles';
import { COLOUR_CODED_RAMPS, MIN_CODED_RAMP_DISTANCE, colourDistance } from './styleTransforms';

const bundle = createTestBundle();
const game = bundle.game;
const themes = game.themes as Record<string, ThemePalette>;
const retroHdStyles = RENDER_STYLES.filter((style) => style.finish !== null);

/** `p:key` is a palette colour, `t:key` a theme colour, `p:key/t:key` a palette colour laid over a theme colour. */
type Ref = string;
const OVER_SEPARATOR = '/';
const REF_SEPARATOR = ':';
const OPAQUE = 1;

/** The outline of a block must part from the floor as clearly as a filled shape does. */
const MIN_OUTLINE_DISTANCE = 60;

interface Check {
  readonly name: string;
  /** Smallest distance required; MIN_CODED_RAMP_DISTANCE when omitted. */
  readonly minimum?: number;
  /** Pairs of colour sets; every colour of one set must differ from every colour of the other. */
  readonly pairs: readonly (readonly [readonly Ref[], readonly Ref[]])[];
}

const palette = (...keys: string[]): Ref[] => keys.map((key) => `p:${key}`);
const theme = (...keys: string[]): Ref[] => keys.map((key) => `t:${key}`);

/** Every set against every other set. */
function allDistinct(...sets: Ref[][]): Check['pairs'] {
  const pairs: [Ref[], Ref[]][] = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) pairs.push([sets[i], sets[j]]);
  return pairs;
}

const FIRE = palette('modernFireCore', 'modernFireMid', 'modernFireEdge');
const WATER = palette('modernWaterTop', 'modernWaterBottom');
const ICE = palette('modernIceTop', 'modernIceMid', 'modernIceBottom');
const FLOOR = theme('floorTop', 'floorBottom');
const WALL = theme('wallTop', 'wallBottom');
/** Body colour of every monster, and of the two thieves. */
const MONSTER_BODIES = palette(
  ...Object.values(MONSTER_COLOR_KEYS), 'thiefCloak', 'thiefKeysCloak'
);
const KEY_COLOURS = palette('red', 'blue', 'yellow', 'green');

const CHECKS: readonly Check[] = [
  {
    name: '1 fire vs the red key and door, bug, cloner, bomb spark and trap border',
    pairs: [[FIRE, palette('red', 'monsterBug', 'clonerBorder', 'modernClonerRing', 'bombSpark', 'trapBorder')]]
  },
  { name: '2 fire vs the fireball and walker monsters', pairs: [[FIRE, palette('monsterFireball', 'monsterWalker')]] },
  {
    name: '3 water vs the blue key and door and the blue wall',
    pairs: [[WATER, palette('blue', 'modernBlueWallTop', 'modernBlueWallBottom', 'blueWall')]]
  },
  { name: '4 water vs ice', pairs: [[WATER, ICE]] },
  { name: '5 ice vs the force floor neon', pairs: [[ICE, palette('modernForceNeon')]] },
  { name: '6 force floor background vs floor', pairs: [[palette('modernForceBg'), FLOOR]] },
  { name: '7 floor vs wall and wall bevel', pairs: [[FLOOR, [...WALL, ...theme('wallBevel')]]] },
  { name: '8 floor vs bomb body', pairs: [[FLOOR, palette('bombBody')]] },
  {
    name: '9 block vs dirt, gravel and wall',
    pairs: [[
      palette('blockBase', 'blockBorder'),
      [...palette('modernDirtCenter', 'modernDirtEdge', 'modernGravelBase', 'modernGravelStone'), ...WALL]
    ]]
  },
  {
    name: '10 block target vs yellow key, fire core and chip pins',
    pairs: [[palette('blockTarget'), palette('yellow', 'modernFireCore', 'chipPins')]]
  },
  { name: '11 exit vs green key and block on target', pairs: [[palette('modernExitMid', 'modernExitRing'), palette('green', 'blockOnTarget')]] },
  {
    name: '12 teleporter vs glider and thief cloak',
    pairs: [[palette('modernTeleportRing', 'teleportRing', 'teleportCore'), palette('monsterGlider', 'thiefCloak', 'thiefKeysCloak')]]
  },
  {
    name: '13 paramecium vs teeth vs green key',
    pairs: allDistinct(palette('monsterParamecium'), palette('monsterTeeth'), palette('green'))
  },
  {
    name: '14 closed trap vs open trap',
    pairs: [
      [[`p:modernTrapClosed${OVER_SEPARATOR}t:floorTop`], theme('floorTop')],
      [[`p:modernTrapClosed${OVER_SEPARATOR}t:floorBottom`], theme('floorBottom')],
      [palette('trapInner'), palette('floorBase')]
    ]
  },
  {
    name: '15 Julien face vs beard vs shirt',
    pairs: allDistinct(
      palette('playerSkin'),
      palette('modernJulienBeard', 'modernJulienBeardLight'),
      palette('modernJulienShirt', 'modernJulienShirtShade')
    )
  },
  { name: '16 colour-coded red, blue, yellow and green', pairs: allDistinct(...KEY_COLOURS.map((ref) => [ref])) },
  { name: '18 block and block target vs the floor', pairs: [[palette('blockBase', 'blockTarget'), FLOOR]] },
  { name: '19 block outline vs the floor', pairs: [[palette('blockBorder'), FLOOR]], minimum: MIN_OUTLINE_DISTANCE },
  { name: '17 every monster body and the fire core vs the floor', pairs: [[[...MONSTER_BODIES, ...palette('modernFireCore')], FLOOR]] }
];

interface StyleColours {
  readonly palette: Record<string, string>;
  readonly theme: ThemePalette;
}

function coloursOf(styleId: string, themeId: string): StyleColours {
  const recolour = createRetroHdRecolour(game.renderStylePalettes![styleId], game.renderStyleFamilies!);
  return { palette: recolour.palette(game.palette), theme: recolour.theme(themes[themeId]) };
}

function rgbOf(text: string): { rgb: Rgb; alpha: number } {
  const parsed = parseCssColour(text);
  if (!parsed) throw new Error(`not a colour: ${text}`);
  return { rgb: parsed.rgb, alpha: parsed.alpha === null ? OPAQUE : Number(parsed.alpha) };
}

function resolve(colours: StyleColours, ref: Ref): Rgb {
  const [top, under] = ref.split(OVER_SEPARATOR);
  const read = (part: string): { rgb: Rgb; alpha: number } => {
    const [table, key] = part.split(REF_SEPARATOR);
    const source = table === 'p' ? colours.palette : (colours.theme as unknown as Record<string, string>);
    if (source[key] === undefined) throw new Error(`unknown colour ${part}`);
    return rgbOf(source[key]);
  };
  const front = read(top);
  if (!under) return front.rgb;
  const back = read(under).rgb;
  return [0, 1, 2].map((i) => front.rgb[i] * front.alpha + back[i] * (OPAQUE - front.alpha)) as unknown as Rgb;
}

/** The smallest distance of each check in one style and theme, with the pair that sets it. */
function measure(styleId: string, themeId: string): { check: string; minimum: number; distance: number; between: string }[] {
  const colours = coloursOf(styleId, themeId);
  return CHECKS.map((check) => {
    let smallest = { distance: Number.POSITIVE_INFINITY, between: '' };
    for (const [left, right] of check.pairs) {
      for (const a of left) {
        for (const b of right) {
          const distance = colourDistance(resolve(colours, a), resolve(colours, b));
          if (distance < smallest.distance) smallest = { distance, between: `${a} vs ${b}` };
        }
      }
    }
    return { check: check.name, minimum: check.minimum ?? MIN_CODED_RAMP_DISTANCE, ...smallest };
  });
}

describe('Retro HD styles keep what the game colour-codes readable', () => {
  it('covers the five Retro HD styles and the four themes', () => {
    expect(retroHdStyles.map((style) => style.id)).toEqual(['pocket', 'pastel', 'blueprint', 'sepia', 'classic90']);
    expect(Object.keys(themes)).toHaveLength(4);
  });

  it('names only colours that exist in the palette and in the themes', () => {
    const colours = coloursOf('pocket', Object.keys(themes)[0]);
    for (const check of CHECKS) {
      for (const [left, right] of check.pairs) for (const ref of [...left, ...right]) expect(() => resolve(colours, ref), ref).not.toThrow();
    }
  });

  for (const style of retroHdStyles) {
    for (const themeId of Object.keys(themes)) {
      it(`${style.id} in ${themeId}: every pair differs by at least ${MIN_CODED_RAMP_DISTANCE}`, () => {
        const tooClose = measure(style.id, themeId).filter((m) => m.distance < m.minimum);
        expect(tooClose.map((m) => `${m.check}: ${m.between} = ${m.distance.toFixed(1)}`)).toEqual([]);
      });
    }
  }

  it('checks the four colour-coded colours of the game', () => {
    expect(COLOUR_CODED_RAMPS).toEqual(KEY_COLOURS.map((ref) => ref.slice(2)));
  });
});
