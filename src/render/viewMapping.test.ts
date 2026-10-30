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
import { canvasToGrid, FrameGeometry, gridToCanvas, pointToGrid } from './viewMapping';

describe('gridToCanvas / canvasToGrid', () => {
  it('are inverse of each other', () => {
    const pixel = gridToCanvas(7, 2.5, 32);
    expect(pixel).toBe(144);
    expect(canvasToGrid(pixel, 2.5, 32)).toBe(7);
  });
});

describe('pointToGrid', () => {
  it('maps a point on a map larger than the view', () => {
    // 10 tiles of 40px across a 400px canvas, camera at tile 5.5 of a 30-tile map.
    const frame: FrameGeometry = { camX: 5.5, camY: 2, tilePixelSize: 40, canvasWidth: 400, canvasHeight: 400 };
    expect(pointToGrid(0, 0, frame, 30, 30)).toEqual({ x: 5, y: 2 });
    expect(pointToGrid(0.5, 0.5, frame, 30, 30)).toEqual({ x: 10, y: 7 });
    expect(pointToGrid(1, 1, frame, 30, 30)).toEqual({ x: 15, y: 12 });
  });

  it('maps a point on a map smaller than the view, drawn from the top-left corner', () => {
    // 20 tiles of 20px fit a 400px canvas but the map has 8x6 cells at camera 0.
    const frame: FrameGeometry = { camX: 0, camY: 0, tilePixelSize: 20, canvasWidth: 400, canvasHeight: 400 };
    expect(pointToGrid(0.01, 0.01, frame, 8, 6)).toEqual({ x: 0, y: 0 });
    expect(pointToGrid(150 / 400, 110 / 400, frame, 8, 6)).toEqual({ x: 7, y: 5 });
  });

  it('returns null outside the map', () => {
    const frame: FrameGeometry = { camX: 0, camY: 0, tilePixelSize: 20, canvasWidth: 400, canvasHeight: 400 };
    expect(pointToGrid(170 / 400, 0.01, frame, 8, 6)).toBeNull();
    expect(pointToGrid(0.01, 130 / 400, frame, 8, 6)).toBeNull();
  });

  it('returns null outside the canvas or for a degenerate frame', () => {
    const frame: FrameGeometry = { camX: 0, camY: 0, tilePixelSize: 20, canvasWidth: 400, canvasHeight: 400 };
    expect(pointToGrid(-0.1, 0.5, frame, 30, 30)).toBeNull();
    expect(pointToGrid(0.5, 1.1, frame, 30, 30)).toBeNull();
    expect(pointToGrid(0.5, 0.5, { ...frame, tilePixelSize: 0 }, 30, 30)).toBeNull();
  });
});
