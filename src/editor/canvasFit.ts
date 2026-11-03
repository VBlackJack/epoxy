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

import { EDITOR_ZOOM_STEPS_EACH_WAY } from '../ui/uiConstants';

const FALLBACK_DEVICE_PIXEL_RATIO = 1;
const PERCENT = 100;

export interface CanvasFitInput {
  /** Level size in cells. */
  levelWidth: number;
  levelHeight: number;
  /** Smallest tile the editor shows, in CSS pixels (editorTilePixelSize). */
  baseTileSize: number;
  /** Largest tile the editor shows, in CSS pixels. */
  maxTileSize: number;
  /** CSS pixels one zoom step adds or removes. */
  zoomTileStep: number;
  /** Space the canvas may take, in CSS pixels. */
  containerWidth: number;
  containerHeight: number;
  devicePixelRatio: number;
  /** Zoom steps away from the fit size; 0 is the fit. Clamped to the allowed range. */
  zoomOffset: number;
}

export interface CanvasFit {
  /** Zoom offset actually applied, after clamping. */
  zoomOffset: number;
  /** Largest whole tile, in CSS pixels, that shows the whole level in the container. */
  fitTileSize: number;
  /** Tile size shown, in CSS pixels: the fit size moved by the zoom offset, clamped to the tile range. */
  tileSize: number;
  /** Tile size of the drawing buffer, in device pixels: whole, so the pixel art is drawn on whole pixels. */
  bufferTileSize: number;
  /** Size of the canvas drawing buffer: set it as canvas.width and canvas.height. */
  backingWidth: number;
  backingHeight: number;
  /** Size to display the canvas at, in CSS pixels: set it as style width and height. */
  cssWidth: number;
  cssHeight: number;
  /** CSS pixels one cell takes on screen. */
  cssTileSize: number;
  /** Tile size as a percentage of the base tile. */
  percent: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

export function clampZoomOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(EDITOR_ZOOM_STEPS_EACH_WAY, Math.max(-EDITOR_ZOOM_STEPS_EACH_WAY, Math.round(offset)));
}

export function zoomIn(offset: number): number {
  return clampZoomOffset(clampZoomOffset(offset) + 1);
}

export function zoomOut(offset: number): number {
  return clampZoomOffset(clampZoomOffset(offset) - 1);
}

/** Largest whole tile, in CSS pixels, with which the level fits the container; 0 when nothing fits. */
export function fitTileSize(levelWidth: number, levelHeight: number, containerWidth: number, containerHeight: number): number {
  if (levelWidth <= 0 || levelHeight <= 0) return 0;
  const tile = Math.floor(Math.min(containerWidth / levelWidth, containerHeight / levelHeight));
  return Number.isFinite(tile) ? Math.max(0, tile) : 0;
}

export function fitCanvas(input: CanvasFitInput): CanvasFit {
  const ratio =
    input.devicePixelRatio > 0 && Number.isFinite(input.devicePixelRatio)
      ? input.devicePixelRatio
      : FALLBACK_DEVICE_PIXEL_RATIO;
  const width = Math.max(0, input.levelWidth);
  const height = Math.max(0, input.levelHeight);
  const base = input.baseTileSize;
  const max = Math.max(base, input.maxTileSize);
  const clamp = (tile: number): number => Math.min(max, Math.max(base, tile));

  const fit = clamp(fitTileSize(width, height, input.containerWidth, input.containerHeight));
  const zoomOffset = clampZoomOffset(input.zoomOffset);
  const tileSize = clamp(fit + zoomOffset * input.zoomTileStep);
  const bufferTileSize = Math.max(1, Math.round(tileSize * ratio));
  const backingWidth = width * bufferTileSize;
  const backingHeight = height * bufferTileSize;

  return {
    zoomOffset,
    fitTileSize: fit,
    tileSize,
    bufferTileSize,
    backingWidth,
    backingHeight,
    cssWidth: backingWidth / ratio,
    cssHeight: backingHeight / ratio,
    cssTileSize: bufferTileSize / ratio,
    percent: Math.round((tileSize / base) * PERCENT),
    canZoomIn: tileSize < max && zoomOffset < EDITOR_ZOOM_STEPS_EACH_WAY,
    canZoomOut: tileSize > base && zoomOffset > -EDITOR_ZOOM_STEPS_EACH_WAY
  };
}

/** What the stage shows: where it is scrolled, how much room it has, and how big the canvas is, in CSS pixels. */
export interface StageView {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  canvasCssWidth: number;
  canvasCssHeight: number;
}

export interface ScrollPosition {
  left: number;
  top: number;
}

/** Cells of context a reveal keeps between the cell and the edge of the stage. */
export const REVEAL_MARGIN_CELLS = 1;

const CENTRE_DIVISOR = 2;

/** Gap the canvas leaves before its first cell when it is smaller than the stage (margin: auto centres it). */
function canvasOffset(client: number, css: number): number {
  return Math.max(0, (client - css) / CENTRE_DIVISOR);
}

function clampScroll(scroll: number, css: number, client: number): number {
  return Math.min(Math.max(0, css - client), Math.max(0, scroll));
}

/** Smallest scroll along one axis that shows the cell and its margin; unchanged when they are already visible. */
function revealAxis(index: number, cssTile: number, scroll: number, client: number, css: number, marginCells: number): number {
  const offset = canvasOffset(client, css);
  const margin = Math.max(0, marginCells) * cssTile;
  const start = offset + index * cssTile - margin;
  const end = offset + (index + 1) * cssTile + margin;
  let next = scroll;
  if (end - start > client) next = offset + index * cssTile - (client - cssTile) / CENTRE_DIVISOR;
  else if (start < scroll) next = start;
  else if (end > scroll + client) next = end - client;
  return clampScroll(next, css, client);
}

/**
 * The scroll that shows a cell with `marginCells` cells of context around it, moving as little as possible.
 * The scroll stays as it is when the cell and its margin are already in view; a canvas smaller than the stage
 * never scrolls.
 */
export function revealScroll(
  cell: { x: number; y: number },
  cssTile: number,
  view: StageView,
  marginCells: number = REVEAL_MARGIN_CELLS
): ScrollPosition {
  return {
    left: revealAxis(cell.x, cssTile, view.scrollLeft, view.clientWidth, view.canvasCssWidth, marginCells),
    top: revealAxis(cell.y, cssTile, view.scrollTop, view.clientHeight, view.canvasCssHeight, marginCells)
  };
}

function anchoredAxis(
  anchor: number,
  scroll: number,
  client: number,
  oldCss: number,
  oldTile: number,
  newCss: number,
  newTile: number,
  newClient: number
): number {
  if (oldTile <= 0) return clampScroll(scroll, newCss, newClient);
  const cells = (scroll + anchor - canvasOffset(client, oldCss)) / oldTile;
  return clampScroll(canvasOffset(newClient, newCss) + cells * newTile - anchor, newCss, newClient);
}

/**
 * The scroll that keeps the point under `anchor` (CSS pixels from the top left of the stage's visible area) at
 * the same place on screen when the tile size changes from `oldFit` to `newFit`. `view` is the stage as it was
 * before the change; its canvas size is not used, the fits carry it. `newClient` is the stage's visible size
 * after the change (scrollbars may have appeared or gone); it defaults to the size in `view`.
 */
export function anchoredZoomScroll(
  anchor: { x: number; y: number },
  oldFit: Pick<CanvasFit, 'cssWidth' | 'cssHeight' | 'cssTileSize'>,
  newFit: Pick<CanvasFit, 'cssWidth' | 'cssHeight' | 'cssTileSize'>,
  view: Pick<StageView, 'scrollLeft' | 'scrollTop' | 'clientWidth' | 'clientHeight'>,
  newClient: Pick<StageView, 'clientWidth' | 'clientHeight'> = view
): ScrollPosition {
  return {
    left: anchoredAxis(anchor.x, view.scrollLeft, view.clientWidth, oldFit.cssWidth, oldFit.cssTileSize, newFit.cssWidth, newFit.cssTileSize, newClient.clientWidth),
    top: anchoredAxis(anchor.y, view.scrollTop, view.clientHeight, oldFit.cssHeight, oldFit.cssTileSize, newFit.cssHeight, newFit.cssTileSize, newClient.clientHeight)
  };
}
