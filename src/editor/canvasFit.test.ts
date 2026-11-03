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
import { anchoredZoomScroll, clampZoomOffset, fitCanvas, fitTileSize, revealScroll, StageView, zoomIn, zoomOut } from './canvasFit';

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

describe('revealScroll', () => {
  const TILE = 20;
  // A 50 x 40 cell map at 20 px: 1000 x 800, on a 200 x 100 stage.
  const view = (overrides: Partial<StageView> = {}): StageView => ({
    scrollLeft: 300,
    scrollTop: 300,
    clientWidth: 200,
    clientHeight: 100,
    canvasCssWidth: 1000,
    canvasCssHeight: 800,
    ...overrides
  });

  it('keeps the scroll when the cell and its margin are in view', () => {
    // Cell (20, 18): 400..420 across, 360..380 down; the margin gives 380..440 and 340..400.
    expect(revealScroll({ x: 20, y: 18 }, TILE, view())).toEqual({ left: 300, top: 300 });
  });

  it('scrolls left, right, up and down by the least that shows the margin', () => {
    expect(revealScroll({ x: 16, y: 18 }, TILE, view())).toEqual({ left: 300, top: 300 });
    expect(revealScroll({ x: 15, y: 18 }, TILE, view())).toEqual({ left: 280, top: 300 });
    expect(revealScroll({ x: 23, y: 18 }, TILE, view())).toEqual({ left: 300, top: 300 });
    expect(revealScroll({ x: 24, y: 18 }, TILE, view())).toEqual({ left: 320, top: 300 });
    expect(revealScroll({ x: 25, y: 18 }, TILE, view())).toEqual({ left: 340, top: 300 });
    expect(revealScroll({ x: 20, y: 14 }, TILE, view())).toEqual({ left: 300, top: 260 });
    expect(revealScroll({ x: 20, y: 21 }, TILE, view())).toEqual({ left: 300, top: 360 });
  });

  it('keeps more or less context with the margin argument', () => {
    expect(revealScroll({ x: 15, y: 18 }, TILE, view(), 0)).toEqual({ left: 300, top: 300 });
    expect(revealScroll({ x: 14, y: 18 }, TILE, view(), 0)).toEqual({ left: 280, top: 300 });
    expect(revealScroll({ x: 15, y: 18 }, TILE, view(), 3).left).toBe(240);
  });

  it('clamps to the ends of the canvas', () => {
    expect(revealScroll({ x: 0, y: 0 }, TILE, view())).toEqual({ left: 0, top: 0 });
    expect(revealScroll({ x: 49, y: 39 }, TILE, view())).toEqual({ left: 800, top: 700 });
    expect(revealScroll({ x: 49, y: 39 }, TILE, view({ scrollLeft: 800, scrollTop: 700 }))).toEqual({ left: 800, top: 700 });
  });

  it('never scrolls a canvas that fits the stage', () => {
    const small = view({ scrollLeft: 0, scrollTop: 0, clientWidth: 300, clientHeight: 300, canvasCssWidth: 100, canvasCssHeight: 100 });
    expect(revealScroll({ x: 4, y: 4 }, TILE, small)).toEqual({ left: 0, top: 0 });
    expect(revealScroll({ x: 0, y: 0 }, TILE, small)).toEqual({ left: 0, top: 0 });
  });

  it('centres a cell when the stage is too small for the cell and its margin', () => {
    const tiny = view({ scrollLeft: 0, scrollTop: 0, clientWidth: 50, clientHeight: 50 });
    // The cell starts at 400 and is 20 wide: centred in 50 gives 400 - 15.
    expect(revealScroll({ x: 20, y: 20 }, TILE, tiny)).toEqual({ left: 385, top: 385 });
  });

  it('counts the gap a smaller canvas leaves on each side', () => {
    // Canvas 100 wide centred in 300: no scroll range, so no scroll whatever the offset.
    const centred = view({ scrollLeft: 0, clientWidth: 300, canvasCssWidth: 100 });
    expect(revealScroll({ x: 4, y: 18 }, TILE, centred).left).toBe(0);
  });
});

describe('anchoredZoomScroll', () => {
  const fitAt = (tile: number, cells = 50): Pick<CanvasFitLike, 'cssWidth' | 'cssHeight' | 'cssTileSize'> => ({
    cssWidth: cells * tile,
    cssHeight: cells * tile,
    cssTileSize: tile
  });
  type CanvasFitLike = { cssWidth: number; cssHeight: number; cssTileSize: number };
  const stage = { clientWidth: 200, clientHeight: 100 };

  it('keeps the pointed cell at the same screen spot, zooming in and out', () => {
    const anchor = { x: 60, y: 30 };
    const inScroll = anchoredZoomScroll(anchor, fitAt(20), fitAt(28), { ...stage, scrollLeft: 300, scrollTop: 200 });
    expect(Math.abs((inScroll.left + anchor.x) / 28 - (300 + anchor.x) / 20)).toBeLessThan(1 / 28);
    expect(Math.abs((inScroll.top + anchor.y) / 28 - (200 + anchor.y) / 20)).toBeLessThan(1 / 28);
    const outScroll = anchoredZoomScroll(anchor, fitAt(28), fitAt(20), { ...stage, scrollLeft: inScroll.left, scrollTop: inScroll.top });
    expect(Math.abs(outScroll.left - 300)).toBeLessThan(1);
    expect(Math.abs(outScroll.top - 200)).toBeLessThan(1);
  });

  it('goes from a centred canvas to an overflowing one, and back', () => {
    // 5 cells at 20 = 100 across, centred in 200: a 50 px gap. Cell 2.5 sits at 100 on screen.
    const small = fitAt(20, 5);
    const big = fitAt(60, 5);
    const anchor = { x: 100, y: 50 };
    const grown = anchoredZoomScroll(anchor, small, big, { ...stage, scrollLeft: 0, scrollTop: 0 });
    // Cell 2.5 at 60 = 150; to stay at screen 100 the scroll is 50.
    expect(grown.left).toBe(50);
    const shrunk = anchoredZoomScroll(anchor, big, small, { ...stage, scrollLeft: grown.left, scrollTop: grown.top });
    expect(shrunk).toEqual({ left: 0, top: 0 });
  });

  it('clamps to the scroll range of the new canvas', () => {
    // Zooming out at the far end would ask for 805 and 905, past the end of a 1000 px canvas.
    const end = anchoredZoomScroll({ x: 190, y: 90 }, fitAt(40), fitAt(20), { ...stage, scrollLeft: 1800, scrollTop: 1900 });
    expect(end).toEqual({ left: 1000 - 200, top: 1000 - 100 });
    const start = anchoredZoomScroll({ x: 0, y: 0 }, fitAt(20), fitAt(40), { ...stage, scrollLeft: 0, scrollTop: 0 });
    expect(start).toEqual({ left: 0, top: 0 });
  });

  it('uses the stage size after the change when scrollbars appear or go', () => {
    // Zoomed in, the canvas overflows and a scrollbar narrows the stage from 200 to 185: the canvas offset and the clamp follow.
    const anchor = { x: 100, y: 50 };
    const narrower = anchoredZoomScroll(anchor, fitAt(20, 5), fitAt(60, 5), { ...stage, scrollLeft: 0, scrollTop: 0 }, { clientWidth: 185, clientHeight: 100 });
    // Cell 2.5 at 60 = 150; the gap before was 50 and the scroll that keeps it at 100 is 50, within the range 300 - 185.
    expect(narrower.left).toBe(50);
    const clamped = anchoredZoomScroll({ x: 0, y: 0 }, fitAt(40), fitAt(20), { ...stage, scrollLeft: 1800, scrollTop: 1900 }, { clientWidth: 185, clientHeight: 90 });
    expect(clamped).toEqual({ left: 1000 - 185, top: 1000 - 90 });
    // A canvas that now fits in the wider stage is centred, so it never scrolls.
    const fits = anchoredZoomScroll(anchor, fitAt(60, 5), fitAt(20, 5), { ...stage, clientWidth: 185, scrollLeft: 50, scrollTop: 0 }, { clientWidth: 200, clientHeight: 100 });
    expect(fits).toEqual({ left: 0, top: 0 });
  });

  it('works with the tile sizes of a 1.5 device pixel ratio', () => {
    const at = (tile: number): ReturnType<typeof fitCanvas> =>
      fitCanvas({ ...BASE, levelWidth: 50, levelHeight: 50, containerWidth: 200, containerHeight: 100, devicePixelRatio: 1.5, zoomOffset: tile });
    const before = at(0);
    const after = at(1);
    expect(before.cssTileSize).not.toBe(after.cssTileSize);
    const anchor = { x: 80, y: 40 };
    const to = anchoredZoomScroll(anchor, before, after, { ...stage, scrollLeft: 100, scrollTop: 100 });
    expect(Math.abs((to.left + anchor.x) / after.cssTileSize - (100 + anchor.x) / before.cssTileSize)).toBeLessThan(1 / after.cssTileSize);
  });
});
