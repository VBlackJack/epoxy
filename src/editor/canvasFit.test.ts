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
import { EDITOR_ZOOM_STEPS_EACH_WAY } from '../ui/uiConstants';
import { clampZoomOffset, fitCanvas, fitTileSize, zoomIn, zoomOut } from './canvasFit';

const BASE = {
  levelWidth: 13,
  levelHeight: 13,
  baseTileSize: 24,
  maxTileSize: 64,
  zoomTileStep: 8,
  devicePixelRatio: 1,
  zoomOffset: 0
};

describe('fitTileSize', () => {
  it('is the largest whole tile that fits both directions', () => {
    expect(fitTileSize(13, 13, 700, 500)).toBe(38);
    expect(fitTileSize(32, 8, 700, 500)).toBe(21);
  });

  it('is 0 when nothing fits or the level is empty', () => {
    expect(fitTileSize(0, 5, 100, 100)).toBe(0);
    expect(fitTileSize(5, 5, 0, 0)).toBe(0);
  });
});

describe('fitCanvas', () => {
  it('fills the stage with the largest whole tile', () => {
    const fit = fitCanvas({ ...BASE, containerWidth: 1000, containerHeight: 500 });
    expect(fit.tileSize).toBe(38);
    expect(fit.cssWidth).toBe(13 * 38);
    expect(fit.backingWidth).toBe(13 * 38);
    expect(fit.percent).toBe(158);
  });

  it('never goes below the base tile when the level does not fit', () => {
    const fit = fitCanvas({ ...BASE, containerWidth: 100, containerHeight: 100 });
    expect(fit.tileSize).toBe(24);
    expect(fit.percent).toBe(100);
    expect(fit.canZoomOut).toBe(false);
  });

  it('never goes above the maximum tile', () => {
    const fit = fitCanvas({ ...BASE, containerWidth: 5000, containerHeight: 5000 });
    expect(fit.tileSize).toBe(64);
    expect(fit.canZoomIn).toBe(false);
  });

  it('steps the tile size around the fit with the zoom offset', () => {
    const base = { ...BASE, containerWidth: 1000, containerHeight: 500 };
    expect(fitCanvas({ ...base, zoomOffset: 1 }).tileSize).toBe(46);
    expect(fitCanvas({ ...base, zoomOffset: -1 }).tileSize).toBe(30);
    expect(fitCanvas({ ...base, zoomOffset: -9 }).zoomOffset).toBe(-EDITOR_ZOOM_STEPS_EACH_WAY);
    expect(fitCanvas({ ...base, zoomOffset: -9 }).tileSize).toBe(24);
  });

  it('draws the buffer on whole device pixels at a fractional ratio', () => {
    const fit = fitCanvas({ ...BASE, devicePixelRatio: 1.5, containerWidth: 1000, containerHeight: 500 });
    expect(fit.tileSize).toBe(38);
    expect(fit.bufferTileSize).toBe(57);
    expect(Number.isInteger(fit.backingWidth)).toBe(true);
    expect(fit.cssWidth).toBe((13 * 57) / 1.5);
  });

  it('falls back to a ratio of 1 for a bad device pixel ratio', () => {
    const fit = fitCanvas({ ...BASE, devicePixelRatio: 0, containerWidth: 1000, containerHeight: 500 });
    expect(fit.bufferTileSize).toBe(38);
  });

  it('handles a zero-size container and an empty level', () => {
    expect(fitCanvas({ ...BASE, containerWidth: 0, containerHeight: 0 }).tileSize).toBe(24);
    const empty = fitCanvas({ ...BASE, levelWidth: 0, levelHeight: 0, containerWidth: 500, containerHeight: 500 });
    expect(empty.cssWidth).toBe(0);
  });
});

describe('zoom offsets', () => {
  it('zooms in and out within the range', () => {
    expect(zoomIn(0)).toBe(1);
    expect(zoomIn(EDITOR_ZOOM_STEPS_EACH_WAY)).toBe(EDITOR_ZOOM_STEPS_EACH_WAY);
    expect(zoomOut(0)).toBe(-1);
    expect(zoomOut(-EDITOR_ZOOM_STEPS_EACH_WAY)).toBe(-EDITOR_ZOOM_STEPS_EACH_WAY);
    expect(clampZoomOffset(2.4)).toBe(2);
    expect(clampZoomOffset(Number.NaN)).toBe(0);
  });
});
