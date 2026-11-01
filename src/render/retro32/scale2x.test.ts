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
import { scale2x } from './scale2x';

const T = -1;
const A = 5;
const B = 9;

function grid(rows: number[][]): Int16Array {
  return Int16Array.from(rows.flat());
}

function readRows(data: Int16Array, width: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < data.length; i += width) rows.push(Array.from(data.subarray(i, i + width)));
  return rows;
}

describe('scale2x', () => {
  it('doubles both dimensions', () => {
    expect(scale2x(new Int16Array(3 * 5).fill(A), 3, 5)).toHaveLength(6 * 10);
  });

  it('keeps a uniform area uniform', () => {
    expect(new Set(scale2x(new Int16Array(16).fill(A), 4, 4))).toEqual(new Set([A]));
  });

  it('keeps an isolated pixel as a plain 2x2 block', () => {
    const out = readRows(scale2x(grid([[T, T, T], [T, A, T], [T, T, T]]), 3, 3), 6);
    expect(out[2].slice(2, 4)).toEqual([A, A]);
    expect(out[3].slice(2, 4)).toEqual([A, A]);
    expect(out.flat().filter((v) => v === A)).toHaveLength(4);
  });

  it('keeps straight edges straight', () => {
    const out = readRows(scale2x(grid([[A, A], [B, B]]), 2, 2), 4);
    expect(out).toEqual([[A, A, A, A], [A, A, A, A], [B, B, B, B], [B, B, B, B]]);
  });

  it('fills the diagonal corner of an L-shaped neighbourhood', () => {
    // The transparent pixel at (1, 1) has A above and left: its top-left child becomes A.
    const out = readRows(scale2x(grid([[A, A], [A, T]]), 2, 2), 4);
    expect(out[2][2]).toBe(A);
    expect(out[2][3]).toBe(T);
    expect(out[3][2]).toBe(T);
    expect(out[3][3]).toBe(T);
  });

  it('rounds the outer corner of a convex shape', () => {
    // Pixel (1, 1) has transparent above and left: its top-left child is cut.
    const out = readRows(scale2x(grid([[T, T, T], [T, A, A], [T, A, A]]), 3, 3), 6);
    expect(out[2][2]).toBe(T);
    expect(out[2][3]).toBe(A);
    expect(out[3][2]).toBe(A);
  });

  it('repeats the edge pixel beyond the image border', () => {
    // The corner pixel keeps its top row; only its inner corner is rounded.
    const out = scale2x(grid([[A, T], [T, T]]), 2, 2);
    expect(readRows(out, 4)[0].slice(0, 2)).toEqual([A, A]);
    expect(readRows(out, 4)[1][0]).toBe(A);
  });
});
