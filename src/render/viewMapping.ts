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

import { GridPoint } from '../core/types';

/** What the last drawn frame needs to map a canvas point back to a grid cell. */
export interface FrameGeometry {
  /** Grid coordinates of the canvas top-left corner. */
  camX: number;
  camY: number;
  /** Pixels per tile. */
  tilePixelSize: number;
  /** Canvas size in pixels. */
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * Canvas pixel at which a grid coordinate is drawn. The renderer draws every tile with this
 * mapping, and pointToGrid inverts it, so camera offsets, including the centring of small maps, go through this function.
 */
export function gridToCanvas(gridCoord: number, cam: number, tilePixelSize: number): number {
  return (gridCoord - cam) * tilePixelSize;
}

/**
 * Camera coordinate (the grid coordinate of the canvas edge) for a wanted one: kept inside the
 * map, or, when the map is no larger than the view, negative so the map sits centred in it.
 */
export function cameraPosition(wanted: number, mapSize: number, viewSize: number): number {
  if (mapSize <= viewSize) return (mapSize - viewSize) / 2;
  return Math.max(0, Math.min(mapSize - viewSize, wanted));
}

/** Inverse of gridToCanvas, in grid coordinates (not floored). */
export function canvasToGrid(pixel: number, cam: number, tilePixelSize: number): number {
  return cam + pixel / tilePixelSize;
}

/**
 * Grid cell under a point given as a fraction of the canvas (0..1 on each axis), or null when
 * the point is off the canvas or off the map.
 */
export function pointToGrid(
  normX: number,
  normY: number,
  frame: FrameGeometry,
  mapWidth: number,
  mapHeight: number
): GridPoint | null {
  if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return null;
  if (!(frame.tilePixelSize > 0)) return null;
  const gx = Math.floor(canvasToGrid(normX * frame.canvasWidth, frame.camX, frame.tilePixelSize));
  const gy = Math.floor(canvasToGrid(normY * frame.canvasHeight, frame.camY, frame.tilePixelSize));
  if (gx < 0 || gx >= mapWidth || gy < 0 || gy >= mapHeight) return null;
  return { x: gx, y: gy };
}
