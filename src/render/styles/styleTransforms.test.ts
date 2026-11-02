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

import { createTestBundle } from '../../test/loadTestConfigs';
import { parseHexColour } from '../retro32/colour';
import { deriveRetro32Ramps } from '../retro32/ramps';
import { resolveRetroRamps, type RetroRamps } from '../retroSprites';
import { COLOUR_CODED_RAMPS, MIN_CODED_RAMP_DISTANCE, colourDistance } from './styleTransforms';

const palettes = createTestBundle().game.retroPalettes;
/** Fraction of the probe tone's range, as an index into a ramp: the middle tone carries the colour code. */
const MIDDLE = 0.5;
const BLACK_TO_WHITE = 765;
const NEAR_BLACK_STEP = 10;

function middleTone(tones: readonly string[]): string {
  return tones[Math.floor((tones.length - 1) * MIDDLE)];
}

describe('colour distance', () => {
  it('is zero for one colour, symmetrical, and weighs green over blue over red', () => {
    expect(colourDistance([10, 20, 30], [10, 20, 30])).toBe(0);
    expect(colourDistance([0, 0, 0], [255, 100, 3])).toBe(colourDistance([255, 100, 3], [0, 0, 0]));
    const red = colourDistance([0, 0, 0], [NEAR_BLACK_STEP, 0, 0]);
    const green = colourDistance([0, 0, 0], [0, NEAR_BLACK_STEP, 0]);
    const blue = colourDistance([0, 0, 0], [0, 0, NEAR_BLACK_STEP]);
    expect(green).toBeGreaterThan(blue);
    expect(blue).toBeGreaterThan(red);
  });

  it('puts black and white about 765 apart', () => {
    expect(colourDistance([0, 0, 0], [255, 255, 255])).toBeGreaterThan(BLACK_TO_WHITE * 0.9);
  });

  it('names the four colour-coded colours and a threshold above a few levels of difference', () => {
    expect(COLOUR_CODED_RAMPS).toEqual(['red', 'blue', 'yellow', 'green']);
    expect(MIN_CODED_RAMP_DISTANCE).toBeGreaterThan(colourDistance([0, 0, 0], [NEAR_BLACK_STEP, NEAR_BLACK_STEP, NEAR_BLACK_STEP]));
  });
});

describe('the plain 16-Bit and 32-Bit styles keep what the Retro HD styles guarantee', () => {
  const ramps16 = resolveRetroRamps(palettes, 'default');

  it('keeps the colour-coded ramps apart', () => {
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

  it('keeps the Julien face, beard and shirt apart', () => {
    const skinRamps: readonly string[] = ['faceSkin', 'beard', 'shirt'];
    const expectDistinct = (ramps: RetroRamps, label: string): void => {
      for (let i = 0; i < skinRamps.length; i++) {
        for (let j = i + 1; j < skinRamps.length; j++) {
          const distance = colourDistance(
            parseHexColour(middleTone(ramps[skinRamps[i]])),
            parseHexColour(middleTone(ramps[skinRamps[j]]))
          );
          expect(distance, `${label}: ${skinRamps[i]} vs ${skinRamps[j]}`).toBeGreaterThanOrEqual(MIN_CODED_RAMP_DISTANCE);
        }
      }
    };
    expectDistinct(ramps16, 'retro16');
    expectDistinct(deriveRetro32Ramps(ramps16), 'retro32');
  });
});
