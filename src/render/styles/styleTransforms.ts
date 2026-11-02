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
 * Colour metric shared by the render styles and their tests: how far apart two colours look, and
 * how far apart the colour-coded game colours (keys, doors, buttons, teleporters) must stay in
 * every style. Pure module: no DOM.
 */

import type { Rgb } from '../retro32/colour';

/**
 * Colours the game colour-codes (keys, doors, buttons, teleporters). Every style must keep them
 * pairwise distinguishable.
 */
export const COLOUR_CODED_RAMPS: readonly string[] = ['red', 'blue', 'yellow', 'green'];
/** Smallest colour distance (see colourDistance) between two colours that must be told apart. */
export const MIN_CODED_RAMP_DISTANCE = 60;

/** Weights of the red, green and blue differences in colourDistance (a cheap perceptual metric). */
const DISTANCE_WEIGHT_RED = 2;
const DISTANCE_WEIGHT_GREEN = 4;
const DISTANCE_WEIGHT_BLUE = 3;

/** Perceptually weighted distance between two colours (0 = identical, about 765 = black to white). */
export function colourDistance(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(DISTANCE_WEIGHT_RED * dr * dr + DISTANCE_WEIGHT_GREEN * dg * dg + DISTANCE_WEIGHT_BLUE * db * db);
}
