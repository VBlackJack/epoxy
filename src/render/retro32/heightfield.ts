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
 * Height field and lighting of the 32-Bit Retro look. Heights come from a bevel profile applied
 * to the distance to the edge of each ramp region, plus a small bias per tone (lighter tone =
 * higher). Normals come from the smoothed height gradient. A fixed light from the top-left gives
 * Lambert diffuse and Blinn specular terms, expressed as a shift along the ramp.
 */

import { MATERIAL_NONE, materialRamp, materialTone } from './materials';

type Vec3 = readonly [number, number, number];

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Light direction (towards the light; image axes: +x right, +y down, +z out of the screen). */
export const LIGHT_DIRECTION: Vec3 = normalize([-0.55, -0.65, 0.52]);
/** Viewer direction for the Blinn half vector. */
export const VIEW_DIRECTION: Vec3 = [0, 0, 1];
/** Width in output pixels of the bevel around each region. */
export const BEVEL_WIDTH = 4;
/** Height in output pixels reached at the top of the bevel (the height cap). */
export const BEVEL_HEIGHT = 3;
/** Height added per tone step lighter than the darkest tone of a ramp. */
export const TONE_HEIGHT_BIAS = 0.45;
/** Scales the height gradient before it becomes a normal. */
export const NORMAL_SCALE = 0.9;
/** How strongly the Lambert term moves the ramp position. */
export const DIFFUSE_GAIN = 0.8;
/** Blinn-Phong exponent. */
export const SPECULAR_SHININESS = 18;
/** How strongly the specular term moves the ramp position. */
export const SPECULAR_GAIN = 0.35;

type Neighbour = readonly [number, number, number];

const DIAGONAL_COST = Math.SQRT2;
const ORTHOGONAL_COST = 1;
const EDGE_CENTRE_OFFSET = 0.5;
const HALF_TURN_DIVISOR = 2;
const GRADIENT_SPAN = 2;
const BLUR_RADIUS = 1;
const FORWARD_NEIGHBOURS: readonly Neighbour[] = [
  [-1, -1, DIAGONAL_COST], [0, -1, ORTHOGONAL_COST], [1, -1, DIAGONAL_COST], [-1, 0, ORTHOGONAL_COST]
];
const BACKWARD_NEIGHBOURS: readonly Neighbour[] = [
  [1, 1, DIAGONAL_COST], [0, 1, ORTHOGONAL_COST], [-1, 1, DIAGONAL_COST], [1, 0, ORTHOGONAL_COST]
];
const EDGE_NEIGHBOURS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const HALF_VECTOR = normalize([
  LIGHT_DIRECTION[0] + VIEW_DIRECTION[0],
  LIGHT_DIRECTION[1] + VIEW_DIRECTION[1],
  LIGHT_DIRECTION[2] + VIEW_DIRECTION[2]
]);
const FLAT_SPECULAR = Math.pow(HALF_VECTOR[2], SPECULAR_SHININESS);

export interface RampTraits {
  /** True when the ramp is lit; false for flat ramps (outline, single-tone). */
  shaded: boolean;
  /** Number of tones of the 16-bit ramp. */
  tones: number;
}

/** Position (0 lightest .. 1 darkest) of a 16-bit tone inside the stretched ramp. */
export function tonePosition(tone: number, tones: number): number {
  if (tones <= 1) return 0;
  return Math.min(tone + 1, tones) / (tones + 1);
}

function relax(
  dist: Float32Array,
  ids: Int16Array,
  width: number,
  height: number,
  neighbours: readonly Neighbour[],
  reverse: boolean
): void {
  const count = width * height;
  for (let n = 0; n < count; n++) {
    const i = reverse ? count - 1 - n : n;
    if (ids[i] === MATERIAL_NONE) continue;
    const x = i % width;
    const y = (i - x) / width;
    const own = materialRamp(ids[i]);
    for (const [dx, dy, cost] of neighbours) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (ids[j] === MATERIAL_NONE || materialRamp(ids[j]) !== own) continue;
      if (dist[j] + cost < dist[i]) dist[i] = dist[j] + cost;
    }
  }
}

/**
 * Distance of each pixel to the nearest pixel of another ramp or to transparency, travelling
 * inside its own ramp. The image border is not an edge, so full-bleed tiles stay seamless.
 */
function edgeDistances(ids: Int16Array, width: number, height: number): Float32Array {
  const dist = new Float32Array(width * height).fill(Infinity);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (ids[i] === MATERIAL_NONE) continue;
      const own = materialRamp(ids[i]);
      const isEdge = EDGE_NEIGHBOURS.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
        return materialRamp(ids[ny * width + nx]) !== own;
      });
      if (isEdge) dist[i] = 0;
    }
  }
  relax(dist, ids, width, height, FORWARD_NEIGHBOURS, false);
  relax(dist, ids, width, height, BACKWARD_NEIGHBOURS, true);
  return dist;
}

/** Quarter-sine bevel: near 0 at the edge, BEVEL_HEIGHT from BEVEL_WIDTH inwards. */
function bevel(distance: number): number {
  const t = Math.min(1, (distance + EDGE_CENTRE_OFFSET) / BEVEL_WIDTH);
  return BEVEL_HEIGHT * Math.sin((t * Math.PI) / HALF_TURN_DIVISOR);
}

function rawHeights(ids: Int16Array, width: number, height: number, traits: readonly RampTraits[]): Float32Array {
  const dist = edgeDistances(ids, width, height);
  const heights = new Float32Array(width * height);
  for (let i = 0; i < heights.length; i++) {
    if (ids[i] === MATERIAL_NONE) continue;
    const ramp = traits[materialRamp(ids[i])];
    if (!ramp.shaded) continue;
    heights[i] = bevel(dist[i]) + (ramp.tones - 1 - materialTone(ids[i])) * TONE_HEIGHT_BIAS;
  }
  return heights;
}

/** Height of a neighbour of the same ramp, otherwise the pixel's own height. */
function sameRampSampler(ids: Int16Array, heights: Float32Array, width: number, height: number) {
  return (x: number, y: number, dx: number, dy: number): number => {
    const i = y * width + x;
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return heights[i];
    const j = ny * width + nx;
    if (ids[j] === MATERIAL_NONE || materialRamp(ids[j]) !== materialRamp(ids[i])) return heights[i];
    return heights[j];
  };
}

function blur(ids: Int16Array, heights: Float32Array, width: number, height: number): Float32Array {
  const sample = sameRampSampler(ids, heights, width, height);
  const out = new Float32Array(heights.length);
  const taps = (2 * BLUR_RADIUS + 1) ** 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -BLUR_RADIUS; dy <= BLUR_RADIUS; dy++) {
        for (let dx = -BLUR_RADIUS; dx <= BLUR_RADIUS; dx++) sum += sample(x, y, dx, dy);
      }
      out[y * width + x] = sum / taps;
    }
  }
  return out;
}

/** Ramp position shift (negative = lighter) caused by lighting, relative to a flat surface. */
function lightingShift(gradX: number, gradY: number): number {
  const length = Math.hypot(gradX * NORMAL_SCALE, gradY * NORMAL_SCALE, 1);
  const nx = (-gradX * NORMAL_SCALE) / length;
  const ny = (-gradY * NORMAL_SCALE) / length;
  const nz = 1 / length;
  const diffuse = Math.max(0, nx * LIGHT_DIRECTION[0] + ny * LIGHT_DIRECTION[1] + nz * LIGHT_DIRECTION[2]);
  const half = Math.max(0, nx * HALF_VECTOR[0] + ny * HALF_VECTOR[1] + nz * HALF_VECTOR[2]);
  const specular = Math.pow(half, SPECULAR_SHININESS);
  return -((diffuse - LIGHT_DIRECTION[2]) * DIFFUSE_GAIN + (specular - FLAT_SPECULAR) * SPECULAR_GAIN);
}

/**
 * Position along the stretched ramp (0 lightest .. 1 darkest) of every pixel. Flat ramps get
 * their plain tone position; transparent pixels stay 0.
 */
export function shadePositions(
  ids: Int16Array,
  width: number,
  height: number,
  traits: readonly RampTraits[]
): Float32Array {
  const heights = blur(ids, rawHeights(ids, width, height, traits), width, height);
  const sample = sameRampSampler(ids, heights, width, height);
  const out = new Float32Array(ids.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (ids[i] === MATERIAL_NONE) continue;
      const ramp = traits[materialRamp(ids[i])];
      const base = tonePosition(materialTone(ids[i]), ramp.tones);
      if (!ramp.shaded) {
        out[i] = base;
        continue;
      }
      const gradX = (sample(x, y, 1, 0) - sample(x, y, -1, 0)) / GRADIENT_SPAN;
      const gradY = (sample(x, y, 0, 1) - sample(x, y, 0, -1)) / GRADIENT_SPAN;
      out[i] = Math.min(1, Math.max(0, base + lightingShift(gradX, gradY)));
    }
  }
  return out;
}
