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

import { EDITOR_MAX_ZOOM_STEP, EDITOR_MIN_ZOOM_STEP } from '../ui/uiConstants';

/** Fewest device pixels shown for one drawn pixel; below it the art would be unreadable. */
const MIN_DEVICE_SCALE = 1;
/** Device pixel ratio assumed when the platform reports none usable. */
const FALLBACK_DEVICE_PIXEL_RATIO = 1;

export interface CanvasFitInput {
  /** Level size in cells. */
  levelWidth: number;
  levelHeight: number;
  /** Pixels one cell takes in the canvas drawing buffer (editorTilePixelSize). */
  baseTileSize: number;
  /** Space the canvas may take, in CSS pixels. */
  containerWidth: number;
  containerHeight: number;
  devicePixelRatio: number;
  /** Zoom as a whole multiple of the fit scale; clamped to the allowed range. */
  zoomStep: number;
}

export interface CanvasFit {
  /** Zoom step actually applied, after clamping. */
  zoomStep: number;
  /** Device pixels per drawn pixel; always a whole number, so the pixel art stays crisp. */
  deviceScale: number;
  /** Largest whole device scale that shows the whole level in the container (zoom 1). */
  fitScale: number;
  /** Size of the canvas drawing buffer: set it as canvas.width and canvas.height. */
  backingWidth: number;
  backingHeight: number;
  /** Size to display the canvas at, in CSS pixels: set it as style width and height. */
  cssWidth: number;
  cssHeight: number;
  /** CSS pixels one cell takes on screen; use it to turn a pointer position into a cell. */
  cssTileSize: number;
}

/** Zoom steps clamped to the allowed range; a non-finite value gives the lowest step. */
export function clampZoomStep(step: number): number {
  if (!Number.isFinite(step)) return EDITOR_MIN_ZOOM_STEP;
  return Math.min(EDITOR_MAX_ZOOM_STEP, Math.max(EDITOR_MIN_ZOOM_STEP, Math.round(step)));
}

/** One step closer, stopping at the highest zoom. */
export function zoomIn(step: number): number {
  return clampZoomStep(clampZoomStep(step) + 1);
}

/** One step back, stopping at the fit zoom. */
export function zoomOut(step: number): number {
  return clampZoomStep(clampZoomStep(step) - 1);
}

/**
 * Sizes the editor canvas. The drawing buffer keeps one cell at `baseTileSize`
 * pixels and is shown at a whole number of device pixels per buffer pixel, so
 * pixel art is never smeared. Zoom 1 is the largest whole scale that fits the
 * container (at least 1, even when the level does not fit); each further zoom
 * step multiplies that scale.
 */
export function fitCanvas(input: CanvasFitInput): CanvasFit {
  const ratio = input.devicePixelRatio > 0 && Number.isFinite(input.devicePixelRatio)
    ? input.devicePixelRatio
    : FALLBACK_DEVICE_PIXEL_RATIO;
  const backingWidth = Math.max(0, input.levelWidth) * input.baseTileSize;
  const backingHeight = Math.max(0, input.levelHeight) * input.baseTileSize;
  const zoomStep = clampZoomStep(input.zoomStep);

  let fitScale = MIN_DEVICE_SCALE;
  if (backingWidth > 0 && backingHeight > 0) {
    const byWidth = Math.floor((input.containerWidth * ratio) / backingWidth);
    const byHeight = Math.floor((input.containerHeight * ratio) / backingHeight);
    const fitting = Math.min(byWidth, byHeight);
    fitScale = Number.isFinite(fitting) ? Math.max(MIN_DEVICE_SCALE, fitting) : MIN_DEVICE_SCALE;
  }
  const deviceScale = fitScale * zoomStep;

  return {
    zoomStep,
    deviceScale,
    fitScale,
    backingWidth,
    backingHeight,
    cssWidth: (backingWidth * deviceScale) / ratio,
    cssHeight: (backingHeight * deviceScale) / ratio,
    cssTileSize: (input.baseTileSize * deviceScale) / ratio
  };
}
