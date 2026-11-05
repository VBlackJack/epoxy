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

/**
 * Same as cameraPosition, for a view whose edges are partly covered (insetStart and insetEnd are
 * tile counts hidden under an overlay at the low and high edge). The wanted coordinate is the one
 * that would centre the player in the whole view; it is shifted to centre the player in the free
 * span between the overlays. The camera may scroll past the map edge on the covered side, so an
 * edge cell can still be brought clear of the overlay. A map that fits in the free span is
 * centred in it. With both insets at 0 this is exactly cameraPosition.
 */
export function cameraPositionWithInsets(
  wanted: number,
  mapSize: number,
  viewSize: number,
  insetStart: number,
  insetEnd: number
): number {
  if (insetStart === 0 && insetEnd === 0) return cameraPosition(wanted, mapSize, viewSize);
  const freeSpan = viewSize - insetStart - insetEnd;
  if (mapSize <= freeSpan) return -(insetStart + (freeSpan - mapSize) / 2);
  const shifted = wanted - (insetStart - insetEnd) / 2;
  return Math.max(-insetStart, Math.min(mapSize - viewSize + insetEnd, shifted));
}

/** Fractions of the canvas (0..0.5 each) the phone pad covers; the level fit keeps the map out from under it. */
export interface FitReserve {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Level fit: a tile is at most this many times the normal one (short side over the wanted row count). */
export const LEVEL_FIT_MAX_ZOOM = 1.5;
/** Level fit: a tile is at most the short side over this many (never below the normal size). */
export const LEVEL_FIT_MIN_TILES_SHORT_SIDE = 5;

/**
 * Tile size in pixels for the level fit. The base is the short side over the wanted row count. The
 * tile grows to the size at which the whole map is visible (contain), or, when a pad reserve takes
 * part of the canvas, to the size at which the map fills the span the pad leaves free (the width
 * in landscape, the height in portrait). It never exceeds maxZoom times the base nor the short
 * side over minTilesShortSide, and never goes below the base: a map that scrolls on some axis at
 * the base size keeps the base size.
 */
export function levelTilePixelSize(
  canvasWidth: number,
  canvasHeight: number,
  mapWidth: number,
  mapHeight: number,
  rows: number,
  reserve: FitReserve,
  maxZoom: number,
  minTilesShortSide: number
): number {
  const shortSide = Math.max(1, Math.min(canvasWidth, canvasHeight));
  const base = shortSide / Math.max(1, rows);
  if (!(mapWidth > 0) || !(mapHeight > 0)) return base;
  const contain = Math.min(canvasWidth / mapWidth, canvasHeight / mapHeight);
  const freeWidth = canvasWidth * (1 - reserve.left - reserve.right);
  const freeHeight = canvasHeight * (1 - reserve.top - reserve.bottom);
  const reserved = reserve.left + reserve.right + reserve.top + reserve.bottom > 0;
  let fillFree = 0;
  if (reserved) fillFree = canvasWidth >= canvasHeight ? freeWidth / mapWidth : freeHeight / mapHeight;
  const scrollsAtBase = mapWidth * base > canvasWidth || mapHeight * base > canvasHeight;
  const wanted = Math.max(contain, fillFree, scrollsAtBase ? base : 0);
  const cap = Math.min(maxZoom * base, shortSide / minTilesShortSide);
  return Math.max(base, Math.min(cap, wanted));
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
