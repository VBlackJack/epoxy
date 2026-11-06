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
 * Geometry of the Grappling Gloves item (`boots_pull`), as fractions of the tile: a gripping glove seen from
 * the back, four fingers up, a thumb out to the left, a cuff, and a small hook on a cord to the right. Shared by
 * the modern and Runeward drawings so the glove keeps one shape; pure data, no DOM.
 */

export interface GloveRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
}

export interface GloveFinger {
  readonly x: number;
  readonly top: number;
}

export const GLOVE = {
  /** Back of the hand. */
  palm: { x: 0.3, y: 0.4, w: 0.41, h: 0.3, r: 0.05 } satisfies GloveRect,
  /** Four fingers, side by side: left edge and tip of each; they share a width and run down into the palm. */
  fingers: [
    { x: 0.3, top: 0.2 },
    { x: 0.4033, top: 0.12 },
    { x: 0.5067, top: 0.14 },
    { x: 0.61, top: 0.22 }
  ] as readonly GloveFinger[],
  fingerWidth: 0.1,
  fingerBottom: 0.5,
  fingerRadius: 0.045,
  /** Thumb: an ellipse tilted out to the left. */
  thumb: { cx: 0.25, cy: 0.54, rx: 0.058, ry: 0.12, turn: -0.5 },
  /** Cuff: a wide band at the wrist. */
  cuff: { x: 0.27, y: 0.68, w: 0.47, h: 0.15, r: 0.04 } satisfies GloveRect,
  /** Cord and hook to the right of the cuff, as a polyline; the last segment is the barb. */
  hook: [[0.74, 0.76], [0.86, 0.76], [0.86, 0.56], [0.78, 0.5]] as readonly (readonly [number, number])[],
  hookWidth: 0.055,
  lineWidth: 0.025
} as const;
