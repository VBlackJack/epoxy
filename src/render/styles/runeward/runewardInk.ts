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
 * Pure helpers of the ink-on-paper drawing of the Runeward Parchment variant: the paper, the ink line
 * widths and the hatching. Nothing here reads a tile id; a cell is described by its hash, its map
 * position and its shadow mask only, so tiles that must look alike stay identical. The proportions
 * are the drawing itself; the colours come from the ink section of the art config.
 */

import type { RunewardArtConfig, RunewardInkConfig } from '../../../core/types';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import { tileHash } from './runewardHash';

/** What the ink helpers may read of a cell: nothing that could tell two floor-like tiles apart. */
export type InkCell = Readonly<Pick<TileNeighbours, 'hash' | 'cx' | 'cy' | 'shadowMask'>>;

type Art = Readonly<RunewardArtConfig>;
type Ink = Readonly<RunewardInkConfig>;

const TAU = Math.PI * 2;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;

/** Tile size in pixels under which flagstone joints and flecks are dropped. */
export const INK_DETAIL_MIN_SIZE = 20;
/** Tile size in pixels under which hatching gives way to a flat wash (no moire on small tiles). */
export const INK_HATCH_MIN_SIZE = 16;

export const INK = {
  lineWidth: 0.04,
  heavyLineWidth: 0.07,
  jointWidth: 0.022,
  hatchSpacingFactor: 0.125,
  hatchSpacingMinPx: 3,
  hatchWidth: 0.025,
  /** Vertical hatching of wall fronts, as a fraction of the tile. */
  frontHatchSpacing: 0.1,
  /** Share of the shadow depth that is cross-hatched, nearest to the caster. */
  crossHatchShare: 0.4,
  maxFlecks: 3,
  fleckRadius: 0.014,
  fleckCountSalt: 16,
  stainOneIn: 6,
  stainSalt: 31,
  stainAlpha: 0.35,
  stainRx: 0.3,
  stainRy: 0.2,
  stainMargin: 0.2,
  /** Flagstone joints as fractions of the cell: the middle, and the two staggered positions. */
  jointMid: 0.5,
  jointOffsetTop: 0.3,
  jointOffsetBottom: 0.7,
  layoutCount: 2,
  /** Mask of the eight hash bits that make a unit value. */
  unitBits: 0xff,
  /** Bit offsets used to draw independent unit values from one hash. */
  shiftA: 0,
  shiftB: 8,
  shiftC: 16,
  shiftD: 24
} as const;

/** Outline width of ordinary ink lines. */
export function inkLineWidth(size: number): number {
  return Math.max(MIN_LINE_PX, size * INK.lineWidth);
}

/** Outline width of the silhouette of a block or a figure. */
export function heavyLineWidth(size: number): number {
  return Math.max(MIN_LINE_PX, size * INK.heavyLineWidth);
}

/** Width of the fine flagstone joints. */
export function jointWidth(size: number): number {
  return Math.max(MIN_LINE_PX, size * INK.jointWidth);
}

/** Distance between two hatch lines, measured along the axes. */
export function hatchSpacing(size: number): number {
  return Math.max(INK.hatchSpacingMinPx, size * INK.hatchSpacingFactor);
}

/** Stroke width of the hatch lines. */
export function hatchWidth(size: number): number {
  return Math.max(MIN_LINE_PX, size * INK.hatchWidth);
}

/** True when the tile is large enough for flagstone joints and paper flecks. */
export function hasInkDetail(size: number): boolean {
  return size >= INK_DETAIL_MIN_SIZE;
}

/** True when the tile is large enough for hatching; below it a flat wash is used. */
export function hasInkHatching(size: number): boolean {
  return size >= INK_HATCH_MIN_SIZE;
}

/**
 * World anchor of the rising hatch lines at the local point (x, y) of cell (cx, cy): equal along a
 * line and shared by neighbouring cells, so lines continue across cell borders. The row is part of
 * the anchor so they also continue downwards.
 */
export function hatchPhase(cx: number, cy: number, size: number, x: number, y: number): number {
  return (cx + cy) * size + x + y;
}

/** Same anchor for the falling (cross-hatch) lines, which keep x - y constant. */
export function crossHatchPhase(cx: number, cy: number, size: number, x: number, y: number): number {
  return (cx - cy) * size + x - y;
}

/** Positive remainder, so the phase also works for negative map coordinates. */
function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Offsets t in [min, max] such that base + t falls on a multiple of the spacing. */
export function hatchOffsets(base: number, spacing: number, min: number, max: number): number[] {
  const offsets: number[] = [];
  const first = min + modulo(-(base + min), spacing);
  for (let t = first; t <= max; t += spacing) offsets.push(t);
  return offsets;
}

export interface InkRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function clipTo(ctx: CanvasRenderingContext2D, rect: InkRect): void {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
}

/** 45 degree hatching of a rectangle, rising to the right; `cross` draws the -45 degree family instead. */
export function paintHatching(
  ctx: CanvasRenderingContext2D,
  size: number,
  cell: Pick<InkCell, 'cx' | 'cy'>,
  rect: InkRect,
  color: string,
  cross = false
): void {
  const cx = cell.cx ?? 0;
  const cy = cell.cy ?? 0;
  const spacing = hatchSpacing(size);
  ctx.save();
  clipTo(ctx, rect);
  ctx.strokeStyle = color;
  ctx.lineWidth = hatchWidth(size);
  ctx.beginPath();
  if (cross) {
    // x - y = t, with t from -size to size.
    for (const t of hatchOffsets(crossHatchPhase(cx, cy, size, 0, 0), spacing, -size, size)) {
      ctx.moveTo(t, 0);
      ctx.lineTo(t + size, size);
    }
  } else {
    // x + y = t, with t from 0 to twice the size.
    for (const t of hatchOffsets(hatchPhase(cx, cy, size, 0, 0), spacing, 0, size * 2)) {
      ctx.moveTo(t, 0);
      ctx.lineTo(t - size, size);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Vertical hatching of a rectangle, on lines anchored to the world column. */
export function paintVerticalHatching(
  ctx: CanvasRenderingContext2D,
  size: number,
  cell: Pick<InkCell, 'cx'>,
  rect: InkRect,
  color: string
): void {
  const spacing = Math.max(INK.hatchSpacingMinPx, size * INK.frontHatchSpacing);
  ctx.save();
  clipTo(ctx, rect);
  ctx.strokeStyle = color;
  ctx.lineWidth = hatchWidth(size);
  ctx.beginPath();
  for (const x of hatchOffsets((cell.cx ?? 0) * size, spacing, 0, size)) {
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x, rect.y + rect.h);
  }
  ctx.stroke();
  ctx.restore();
}

/** True when a shadow caster stands directly north of the cell. */
export function isInkShadowed(cell: Pick<InkCell, 'shadowMask'>): boolean {
  return (cell.shadowMask & NEIGHBOUR.N) !== 0;
}

/** The wall shadow in ink: hatching, cross-hatched near the wall; a flat wash on small tiles. */
export function paintInkShadow(ctx: CanvasRenderingContext2D, size: number, art: Art, ink: Ink, cell: InkCell): void {
  if (!isInkShadowed(cell)) return;
  const reach = size * art.shadow.depth;
  if (!hasInkHatching(size)) {
    ctx.fillStyle = art.shadow.color;
    ctx.fillRect(0, 0, size, reach);
    return;
  }
  paintHatching(ctx, size, cell, { x: 0, y: 0, w: size, h: reach }, ink.hatch);
  paintHatching(ctx, size, cell, { x: 0, y: 0, w: size, h: reach * INK.crossHatchShare }, ink.hatch, true);
}

/** A unit value 0..1 taken from eight bits of a hash. */
export function inkUnit(hash: number, shift: number): number {
  return ((hash >>> shift) & INK.unitBits) / INK.unitBits;
}

/** Number of flecks on a cell, 0 to 3, from its hash. */
export function fleckCount(hash: number): number {
  return tileHash(hash, INK.fleckCountSalt) % (INK.maxFlecks + 1);
}

/** True on one tile in six, which then carries a faint stain. */
export function hasStain(hash: number): boolean {
  return tileHash(hash, INK.stainSalt) % INK.stainOneIn === 0;
}

/** Aged paper: the base colour, a faint stain on some tiles, and a few flecks (large tiles only). */
export function paintPaper(ctx: CanvasRenderingContext2D, size: number, base: string, ink: Ink, cell: InkCell): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  if (!hasInkDetail(size)) return;
  if (hasStain(cell.hash)) {
    const h = tileHash(cell.hash, INK.stainSalt);
    const span = 1 - INK.stainMargin * 2;
    ctx.fillStyle = ink.paperStain;
    ctx.globalAlpha = INK.stainAlpha;
    ctx.beginPath();
    ctx.ellipse(
      size * (INK.stainMargin + inkUnit(h, INK.shiftB) * span),
      size * (INK.stainMargin + inkUnit(h, INK.shiftC) * span),
      size * INK.stainRx,
      size * INK.stainRy,
      inkUnit(h, INK.shiftD) * Math.PI,
      0,
      TAU
    );
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const count = fleckCount(cell.hash);
  ctx.fillStyle = ink.paperFleck;
  for (let i = 0; i < count; i += 1) {
    const h = tileHash(cell.hash, i);
    ctx.beginPath();
    ctx.arc(size * inkUnit(h, INK.shiftA), size * inkUnit(h, INK.shiftB), Math.max(MIN_LINE_PX / 2, size * INK.fleckRadius), 0, TAU);
    ctx.fill();
  }
}

/** Layout of the flagstone joints of a cell: 0 for a plain cross, 1 for staggered joints. */
export function jointLayout(hash: number): number {
  return hash % INK.layoutCount;
}

/** Fine ink joints between flagstones (large tiles only), in one of two layouts. */
export function paintFlagstoneJoints(ctx: CanvasRenderingContext2D, size: number, ink: Ink, cell: InkCell): void {
  if (!hasInkDetail(size)) return;
  const mid = size * INK.jointMid;
  ctx.strokeStyle = ink.hatch;
  ctx.lineWidth = jointWidth(size);
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(size, mid);
  if (jointLayout(cell.hash) === 0) {
    ctx.moveTo(mid, 0);
    ctx.lineTo(mid, size);
  } else {
    ctx.moveTo(size * INK.jointOffsetTop, 0);
    ctx.lineTo(size * INK.jointOffsetTop, mid);
    ctx.moveTo(size * INK.jointOffsetBottom, mid);
    ctx.lineTo(size * INK.jointOffsetBottom, size);
  }
  ctx.stroke();
}

/** The ink floor: paper, fine flagstone joints and the cast shadow as hatching. */
export function paintInkFloor(ctx: CanvasRenderingContext2D, size: number, art: Art, ink: Ink, cell: InkCell): void {
  paintPaper(ctx, size, art.floor.base, ink, cell);
  paintFlagstoneJoints(ctx, size, ink, cell);
  paintInkShadow(ctx, size, art, ink, cell);
}
