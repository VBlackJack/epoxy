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
import { EDITOR_MAX_ZOOM_STEP, EDITOR_MIN_ZOOM_STEP } from '../ui/uiConstants';
import { clampZoomStep, fitCanvas, zoomIn, zoomOut } from './canvasFit';

const BASE = { levelWidth: 32, levelHeight: 32, baseTileSize: 16, devicePixelRatio: 1, zoomStep: 1 };

describe('fitCanvas', () => {
  it('picks the largest whole scale that fits both directions', () => {
    // 512 x 512 buffer in 1200 x 1100: 2x fits (1024), 3x does not.
    const fit = fitCanvas({ ...BASE, containerWidth: 1200, containerHeight: 1100 });
    expect(fit.fitScale).toBe(2);
    expect(fit.deviceScale).toBe(2);
    expect(fit.backingWidth).toBe(512);
    expect(fit.cssWidth).toBe(1024);
    expect(fit.cssTileSize).toBe(32);
  });

  it('is limited by the smaller dimension', () => {
    const fit = fitCanvas({ ...BASE, containerWidth: 5000, containerHeight: 600 });
    expect(fit.fitScale).toBe(1);
  });

  it('never goes below 1 when the level does not fit', () => {
    const fit = fitCanvas({ ...BASE, containerWidth: 100, containerHeight: 100 });
    expect(fit.deviceScale).toBe(1);
    expect(fit.cssWidth).toBe(512);
  });

  it('keeps a whole number of device pixels per drawn pixel at fractional ratios', () => {
    const fit = fitCanvas({ ...BASE, devicePixelRatio: 1.5, containerWidth: 1100, containerHeight: 1100 });
    expect(Number.isInteger(fit.deviceScale)).toBe(true);
    expect(fit.deviceScale).toBe(3);
    expect(fit.cssWidth).toBe((512 * 3) / 1.5);
  });

  it('multiplies the fit scale by the zoom step', () => {
    const fit = fitCanvas({ ...BASE, containerWidth: 1200, containerHeight: 1100, zoomStep: 3 });
    expect(fit.fitScale).toBe(2);
    expect(fit.deviceScale).toBe(6);
    expect(fit.zoomStep).toBe(3);
  });

  it('clamps the zoom step and ignores a bad one', () => {
    const base = { ...BASE, containerWidth: 1200, containerHeight: 1100 };
    expect(fitCanvas({ ...base, zoomStep: 99 }).zoomStep).toBe(EDITOR_MAX_ZOOM_STEP);
    expect(fitCanvas({ ...base, zoomStep: 0 }).zoomStep).toBe(EDITOR_MIN_ZOOM_STEP);
    expect(fitCanvas({ ...base, zoomStep: Number.NaN }).zoomStep).toBe(EDITOR_MIN_ZOOM_STEP);
  });

  it('falls back to a ratio of 1 for a bad device pixel ratio', () => {
    const fit = fitCanvas({ ...BASE, devicePixelRatio: 0, containerWidth: 1200, containerHeight: 1100 });
    expect(fit.deviceScale).toBe(2);
  });

  it('stays whole-numbered at a ratio of 1.25, even in a tiny container', () => {
    const fit = fitCanvas({ ...BASE, devicePixelRatio: 1.25, containerWidth: 1100, containerHeight: 1100 });
    expect(fit.fitScale).toBe(2);
    expect(fit.cssWidth).toBe((512 * 2) / 1.25);
    const tiny = fitCanvas({ ...BASE, devicePixelRatio: 1.25, containerWidth: 10, containerHeight: 10 });
    expect(tiny.deviceScale).toBe(1);
    expect(tiny.cssWidth).toBe(512 / 1.25);
    expect(tiny.cssTileSize).toBe(16 / 1.25);
  });

  it('handles a zero-size container and an empty level', () => {
    expect(fitCanvas({ ...BASE, containerWidth: 0, containerHeight: 0 }).deviceScale).toBe(1);
    const empty = fitCanvas({ ...BASE, levelWidth: 0, levelHeight: 0, containerWidth: 500, containerHeight: 500 });
    expect(empty.cssWidth).toBe(0);
    expect(empty.deviceScale).toBe(1);
  });
});

describe('zoom steps', () => {
  it('zooms in and out within the range', () => {
    expect(zoomIn(EDITOR_MIN_ZOOM_STEP)).toBe(EDITOR_MIN_ZOOM_STEP + 1);
    expect(zoomIn(EDITOR_MAX_ZOOM_STEP)).toBe(EDITOR_MAX_ZOOM_STEP);
    expect(zoomOut(EDITOR_MIN_ZOOM_STEP)).toBe(EDITOR_MIN_ZOOM_STEP);
    expect(zoomOut(EDITOR_MAX_ZOOM_STEP)).toBe(EDITOR_MAX_ZOOM_STEP - 1);
    expect(clampZoomStep(2.4)).toBe(2);
  });
});
