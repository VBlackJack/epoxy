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
 * Scale2x (EPX family) on material ids. Neighbours are compared by id equality, never by
 * colour, so the rules follow the shape of the materials. Out-of-range neighbours repeat the
 * edge pixel, which keeps full-bleed tiles unchanged at their border.
 */

const SCALE = 2;

/** Output of a source pixel: four children, row-major (top-left, top-right, bottom-left, bottom-right). */
export function scale2x(src: Int16Array, width: number, height: number): Int16Array {
  const outWidth = width * SCALE;
  const out = new Int16Array(outWidth * height * SCALE);
  const lastX = width - 1;
  const lastY = height - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = src[i];
      const b = y > 0 ? src[i - width] : e;
      const d = x > 0 ? src[i - 1] : e;
      const f = x < lastX ? src[i + 1] : e;
      const h = y < lastY ? src[i + width] : e;
      const split = b !== h && d !== f;
      const o = y * SCALE * outWidth + x * SCALE;
      out[o] = split && d === b ? d : e;
      out[o + 1] = split && b === f ? f : e;
      out[o + outWidth] = split && d === h ? d : e;
      out[o + outWidth + 1] = split && h === f ? f : e;
    }
  }
  return out;
}
