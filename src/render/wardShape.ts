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
 * Geometry of the Ward item (`ward`), as fractions of the tile: a small round shield with an inner ring and a
 * glowing rune (an upright stem with two arms) at its heart. Shared by the modern and Runeward drawings so the
 * ward keeps one shape, clearly not a boot; pure data, no DOM.
 */

/** A polyline given as fractions of the tile. */
export type WardStroke = readonly (readonly [number, number])[];

export const WARD = {
  /** The shield disc. */
  disc: { cx: 0.5, cy: 0.5, r: 0.36 },
  /** Inner ring, as a fraction of the disc radius. */
  ringRatio: 0.78,
  /** Rune strokes: the stem, then the two arms meeting on it. */
  rune: [
    [[0.5, 0.7], [0.5, 0.29]],
    [[0.35, 0.36], [0.5, 0.52], [0.65, 0.36]]
  ] as readonly WardStroke[],
  runeWidth: 0.075,
  lineWidth: 0.03,
  ringWidth: 0.02,
  /** Opacity of the inner ring over the disc. */
  ringAlpha: 0.7
} as const;
