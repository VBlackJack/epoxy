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
 * Pure painters of the Runeward render style: each draws one tile (or the character) into the square
 * from (0, 0) to (size, size) of a 2D context, from the colours of the Runeward art config and the
 * neighbourhood of the cell. They know nothing of the renderer; the dispatch table in
 * runewardTiles.ts moves the context to the cell. The proportions below are the drawings
 * themselves, the way pixel art is data: they are art, not settings.
 */

import type { Direction, RunewardArtConfig, RunewardInkConfig, RunewardLiquidColours } from '../../../core/types';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';
import { tileHash } from './runewardHash';
import {
  heavyLineWidth,
  hasInkHatching,
  inkLineWidth,
  paintHatching,
  paintInkFloor,
  paintInkShadow,
  paintPaper,
  inkUnit,
  paintVerticalHatching
} from './runewardInk';

import type { RunewardTilePass } from './runewardTiles';

/** Part of a tile a painter is asked for: the same three passes as the tile dispatch. */
export type RunewardPaintPart = RunewardTilePass;

type Art = Readonly<RunewardArtConfig>;
type Neighbours = Readonly<TileNeighbours>;

const TAU = Math.PI * 2;
/** Middle of the cell, as a fraction of its size. */
const HALF = 0.5;

// ---- Hash and waves -------------------------------------------------------------------------

export { tileHash };

/** A 0..1 wave for animations, with an optional phase in turns. */
export function wave(timeMs: number, periodMs: number, phase = 0): number {
  return (Math.sin((timeMs / periodMs + phase) * TAU) + 1) / 2;
}

// ---- Shared drawing helpers -------------------------------------------------------------------

type GradientStop = readonly [number, string];

function linear(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: readonly GradientStop[]
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function radial(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  stops: readonly GradientStop[]
): CanvasGradient {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;

// ---- Cast shadow ------------------------------------------------------------------------------

/** The shadow a wall casts on the tile below it, fading downwards. */
export function paintCastShadow(ctx: CanvasRenderingContext2D, size: number, art: Art): void {
  const reach = size * art.shadow.depth;
  ctx.fillStyle = linear(ctx, 0, 0, 0, reach, [[0, art.shadow.color], [1, art.clear]]);
  ctx.fillRect(0, 0, size, reach);
}

/** True when a wall (or any shadow caster) stands directly north of the cell. */
export function isShadowedFromNorth(neighbours: Neighbours): boolean {
  return (neighbours.shadowMask & NEIGHBOUR.N) !== 0;
}

/** Puts the wall shadow on the cell when a caster stands north of it. */
function castShadowIfNeeded(ctx: CanvasRenderingContext2D, size: number, art: Art, neighbours: Neighbours): void {
  if (art.ink) paintInkShadow(ctx, size, art, art.ink, neighbours);
  else if (isShadowedFromNorth(neighbours)) paintCastShadow(ctx, size, art);
}

// ---- Floor ------------------------------------------------------------------------------------

const FLOOR = {
  slabsPerSide: 2,
  gap: 0.035,
  cornerRadius: 0.05,
  sheenHeight: 0.06
} as const;

/** Slab shade arrangement of a cell: stable, from its hash. */
export function floorVariant(art: Art, neighbours: Neighbours): number {
  return neighbours.hash % Math.max(1, art.floor.variants);
}

/** Flagstones: four slabs with slightly different shades, picked by the cell hash. */
export function paintFloor(ctx: CanvasRenderingContext2D, size: number, art: Art, neighbours: Neighbours): void {
  if (art.ink) {
    // Ink on paper: reads only the hash, the position and the shadow mask of the cell, never a tile id.
    paintInkFloor(ctx, size, art, art.ink, neighbours);
    return;
  }
  const { floor } = art;
  const variant = floorVariant(art, neighbours);
  ctx.fillStyle = floor.grout;
  ctx.fillRect(0, 0, size, size);
  const slab = size / FLOOR.slabsPerSide;
  const gap = Math.max(MIN_LINE_PX, size * FLOOR.gap);
  const shades = [floor.base, floor.light, floor.dark, floor.base];
  const slabCount = FLOOR.slabsPerSide * FLOOR.slabsPerSide;
  for (let i = 0; i < slabCount; i += 1) {
    const x = (i % FLOOR.slabsPerSide) * slab;
    const y = Math.floor(i / FLOOR.slabsPerSide) * slab;
    ctx.fillStyle = shades[(i + variant) % shades.length];
    roundRect(ctx, x + gap, y + gap, slab - gap * 2, slab - gap * 2, size * FLOOR.cornerRadius);
    ctx.fill();
  }
  ctx.fillStyle = floor.sheen;
  ctx.fillRect(gap, gap, size - gap * 2, size * FLOOR.sheenHeight);
  castShadowIfNeeded(ctx, size, art, neighbours);
}

// ---- Wall -------------------------------------------------------------------------------------

const WALL = {
  frontHeight: 0.3,
  mortarWidth: 0.03,
  mortarMid: 0.5,
  brickLeft: 0.25,
  brickRight: 0.75,
  edgeWidth: 0.025,
  edgeAlpha: 0.5
} as const;

const BLUE_WALL = { inset: 0.1, lineWidth: 0.04 } as const;

/** True when no wall stands directly south, so the front face of the block is visible. */
export function wallHasFront(neighbours: Neighbours): boolean {
  return (neighbours.wallMask & NEIGHBOUR.S) === 0;
}

/**
 * A wall block seen from above, with its front face when nothing of the same mass stands below.
 * Real and fake walls share this drawing: nothing here may tell them apart.
 */
export function paintWall(ctx: CanvasRenderingContext2D, size: number, art: Art, neighbours: Neighbours): void {
  if (art.ink) {
    paintInkWall(ctx, size, art, art.ink, neighbours);
    return;
  }
  const { wall } = art;
  const frontHeight = wallHasFront(neighbours) ? size * WALL.frontHeight : 0;
  const topHeight = size - frontHeight;
  ctx.fillStyle = linear(ctx, 0, 0, 0, topHeight, [[0, wall.topLight], [1, wall.top]]);
  ctx.fillRect(0, 0, size, topHeight);
  ctx.strokeStyle = wall.topDark;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * WALL.mortarWidth);
  const midY = topHeight * WALL.mortarMid;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(size, midY);
  ctx.moveTo(size * WALL.mortarMid, 0);
  ctx.lineTo(size * WALL.mortarMid, midY);
  ctx.moveTo(size * WALL.brickLeft, midY);
  ctx.lineTo(size * WALL.brickLeft, topHeight);
  ctx.moveTo(size * WALL.brickRight, midY);
  ctx.lineTo(size * WALL.brickRight, topHeight);
  ctx.stroke();
  if (frontHeight > 0) {
    ctx.fillStyle = linear(ctx, 0, topHeight, 0, size, [[0, wall.front], [1, wall.frontDark]]);
    ctx.fillRect(0, topHeight, size, frontHeight);
    ctx.fillStyle = wall.edge;
    ctx.globalAlpha = WALL.edgeAlpha;
    ctx.fillRect(0, topHeight, size, Math.max(MIN_LINE_PX, size * WALL.edgeWidth));
    ctx.globalAlpha = 1;
  }
}

/** A wall under the blue tint of the Runeward blue family; real and fake blue walls both use it. */
export function paintBlueWall(ctx: CanvasRenderingContext2D, size: number, art: Art, neighbours: Neighbours): void {
  paintWall(ctx, size, art, neighbours);
  ctx.fillStyle = art.blueWall.tint;
  ctx.fillRect(0, 0, size, size);
  if (art.ink) {
    paintDiamondLattice(ctx, size, art.blueWall.line);
    return;
  }
  const inset = size * BLUE_WALL.inset;
  ctx.strokeStyle = art.blueWall.line;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * BLUE_WALL.lineWidth);
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
}

// ---- Ink wall ---------------------------------------------------------------------------------

const INK_WALL = {
  /** Distance of the outer and inner engraved lines of the wall top from its border. */
  engravedOuter: 0.12,
  engravedInner: 0.19,
  /** Reach of the diamond lattice of blue walls: how far its two diamonds stand from the border. */
  latticeOuter: 0.14,
  latticeInner: 0.3
} as const;

/** Walls in ink: outlined silhouette, engraved double line on the top, hatched front face. */
function paintInkWall(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  ink: Readonly<RunewardInkConfig>,
  neighbours: Neighbours
): void {
  const { wall } = art;
  const frontHeight = wallHasFront(neighbours) ? size * WALL.frontHeight : 0;
  const topHeight = size - frontHeight;
  ctx.fillStyle = linear(ctx, 0, 0, 0, topHeight, [[0, wall.topLight], [1, wall.top]]);
  ctx.fillRect(0, 0, size, topHeight);
  // Engraved look: two thin lines inset from the border of the top.
  ctx.lineWidth = inkLineWidth(size);
  const lines: readonly (readonly [number, string])[] = [
    [INK_WALL.engravedOuter, ink.line],
    [INK_WALL.engravedInner, ink.hatch]
  ];
  for (const [fraction, color] of lines) {
    const inset = size * fraction;
    ctx.strokeStyle = color;
    ctx.strokeRect(inset, inset, size - inset * 2, topHeight - inset * 2);
  }
  if (frontHeight > 0) {
    ctx.fillStyle = linear(ctx, 0, topHeight, 0, size, [[0, wall.front], [1, wall.frontDark]]);
    ctx.fillRect(0, topHeight, size, frontHeight);
    if (hasInkHatching(size)) {
      paintVerticalHatching(ctx, size, neighbours, { x: 0, y: topHeight, w: size, h: frontHeight }, ink.line);
    }
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    ctx.beginPath();
    ctx.moveTo(0, topHeight);
    ctx.lineTo(size, topHeight);
    ctx.stroke();
  }
  // Heavy silhouette on the sides that do not continue into the same wall mass.
  const heavy = heavyLineWidth(size);
  const edge = heavy / 2;
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = heavy;
  ctx.beginPath();
  if ((neighbours.wallMask & NEIGHBOUR.N) === 0) {
    ctx.moveTo(0, edge);
    ctx.lineTo(size, edge);
  }
  if ((neighbours.wallMask & NEIGHBOUR.S) === 0) {
    ctx.moveTo(0, size - edge);
    ctx.lineTo(size, size - edge);
  }
  if ((neighbours.wallMask & NEIGHBOUR.W) === 0) {
    ctx.moveTo(edge, 0);
    ctx.lineTo(edge, size);
  }
  if ((neighbours.wallMask & NEIGHBOUR.E) === 0) {
    ctx.moveTo(size - edge, 0);
    ctx.lineTo(size - edge, size);
  }
  ctx.stroke();
}

/** The lattice mark of blue walls: two nested diamonds. Real and fake blue walls both get it. */
function paintDiamondLattice(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = inkLineWidth(size);
  ctx.beginPath();
  for (const fraction of [INK_WALL.latticeOuter, INK_WALL.latticeInner]) {
    const near = size * fraction;
    const far = size - near;
    ctx.moveTo(size * HALF, near);
    ctx.lineTo(far, size * HALF);
    ctx.lineTo(size * HALF, far);
    ctx.lineTo(near, size * HALF);
    ctx.closePath();
  }
  ctx.stroke();
}

// ---- Liquid -----------------------------------------------------------------------------------

const LIQUID = {
  crestRows: 3,
  firstRowY: 0.22,
  rowSpacing: 0.3,
  crestSegments: 8,
  amplitude: 0.05,
  lineWidth: 0.05,
  crestAlpha: 0.55,
  /** Phase added per map row, in turns of PI: a quarter turn, so the pattern repeats every four rows. */
  rowPhase: Math.PI / 2,
  /** Lava flows at this multiple of the water period. */
  lavaPeriodFactor: 2
} as const;

/**
 * Vertical offset of a crest point, as a unit sine. `across` is the position along the cell from
 * 0 to 1, so a point at the right border of a cell equals the left border of the next one: the
 * crests continue over the whole liquid body. The row term is periodic in the map row.
 */
export function crestPhase(
  timeMs: number,
  periodMs: number,
  cx: number,
  cy: number,
  row: number,
  across: number
): number {
  const shift = (timeMs / periodMs) * TAU;
  return Math.sin(shift + (cx + across) * Math.PI + row + cy * LIQUID.rowPhase);
}

/** Moving liquid: water or lava, with crests drifting in step across cells. */
export function paintLiquid(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  colors: Readonly<RunewardLiquidColours>,
  periodMs: number,
  neighbours: Neighbours,
  timeMs: number,
  part: RunewardPaintPart = 'all',
  inkDetail: InkLiquidDetail = INK_WATER_DETAIL
): void {
  if (art.ink) {
    paintInkLiquid(ctx, size, art, art.ink, colors, periodMs, neighbours, timeMs, part, inkDetail);
    return;
  }
  const cx = neighbours.cx ?? 0;
  const cy = neighbours.cy ?? 0;
  ctx.fillStyle = linear(ctx, 0, 0, 0, size, [[0, colors.light], [1, colors.deep]]);
  ctx.fillRect(0, 0, size, size);
  // The crests run to the cell borders and continue in the next cell: keep their caps inside this one.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  ctx.strokeStyle = colors.crest;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * LIQUID.lineWidth);
  ctx.lineCap = 'round';
  ctx.globalAlpha = LIQUID.crestAlpha;
  for (let row = 0; row < LIQUID.crestRows; row += 1) {
    const baseY = size * (LIQUID.firstRowY + row * LIQUID.rowSpacing);
    ctx.beginPath();
    for (let i = 0; i <= LIQUID.crestSegments; i += 1) {
      const across = i / LIQUID.crestSegments;
      const py = baseY + crestPhase(timeMs, periodMs, cx, cy, row, across) * size * LIQUID.amplitude;
      if (i === 0) ctx.moveTo(size * across, py);
      else ctx.lineTo(size * across, py);
    }
    ctx.stroke();
  }
  ctx.restore();
  castShadowIfNeeded(ctx, size, art, neighbours);
}

export function paintWater(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  neighbours: Neighbours,
  timeMs: number,
  part: RunewardPaintPart = 'all'
): void {
  paintLiquid(ctx, size, art, art.water, art.animation.flowPeriodMs, neighbours, timeMs, part, INK_WATER_DETAIL);
}

/** Lava is the fire tile: the same flow as water, slower, in the lava colours. */
export function paintLava(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  neighbours: Neighbours,
  timeMs: number,
  part: RunewardPaintPart = 'all'
): void {
  const periodMs = art.animation.flowPeriodMs * LIQUID.lavaPeriodFactor;
  paintLiquid(ctx, size, art, art.lava, periodMs, neighbours, timeMs, part, INK_LAVA_DETAIL);
}

// ---- Ink liquid -------------------------------------------------------------------------------

/** What an ink liquid adds to the wash and the crests. */
export interface InkLiquidDetail {
  /** Static ink crack lines and stipple dots, placed from the cell hash. */
  readonly cracks: boolean;
  /** Small curl ticks on the crests. */
  readonly curls: boolean;
}

const INK_WATER_DETAIL: InkLiquidDetail = { cracks: false, curls: true };
const INK_LAVA_DETAIL: InkLiquidDetail = { cracks: true, curls: false };

const INK_LIQUID = {
  crestAlpha: 0.85,
  /** Curl ticks sit at these positions along a crest (fractions of the cell). */
  curlAt: [0.3, 0.75],
  curlSize: 0.07,
  crackCount: 3,
  crackSalt: 7,
  crackSteps: 3,
  crackMargin: 0.15,
  crackStep: 0.22,
  stippleCount: 2,
  stippleSalt: 19,
  stippleRadius: 0.025,
  stippleMargin: 0.15,
  /** Bit offsets used to draw independent unit values from one hash. */
  shiftA: 0,
  shiftB: 8,
  shiftC: 16
} as const;

/** Three static ink cracks and two stipple dots, placed from the hash of the cell. */
function paintInkCracks(ctx: CanvasRenderingContext2D, size: number, line: string, neighbours: Neighbours): void {
  const span = 1 - INK_LIQUID.crackMargin * 2;
  ctx.strokeStyle = line;
  ctx.lineWidth = inkLineWidth(size);
  ctx.lineJoin = 'round';
  for (let k = 0; k < INK_LIQUID.crackCount; k += 1) {
    const h = tileHash(neighbours.hash, INK_LIQUID.crackSalt + k);
    let x = size * (INK_LIQUID.crackMargin + inkUnit(h, INK_LIQUID.shiftA) * span);
    let y = size * (INK_LIQUID.crackMargin + inkUnit(h, INK_LIQUID.shiftB) * span);
    const bend = inkUnit(h, INK_LIQUID.shiftC) - HALF;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 1; i <= INK_LIQUID.crackSteps; i += 1) {
      x += size * INK_LIQUID.crackStep * (i % 2 === 0 ? bend : HALF);
      y += size * INK_LIQUID.crackStep * (i % 2 === 0 ? HALF : bend);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = line;
  const dotSpan = 1 - INK_LIQUID.stippleMargin * 2;
  for (let i = 0; i < INK_LIQUID.stippleCount; i += 1) {
    const h = tileHash(neighbours.hash, INK_LIQUID.stippleSalt + i);
    ctx.beginPath();
    ctx.arc(
      size * (INK_LIQUID.stippleMargin + inkUnit(h, INK_LIQUID.shiftA) * dotSpan),
      size * (INK_LIQUID.stippleMargin + inkUnit(h, INK_LIQUID.shiftB) * dotSpan),
      Math.max(MIN_LINE_PX / 2, size * INK_LIQUID.stippleRadius),
      0,
      TAU
    );
    ctx.fill();
  }
}

/**
 * Liquid in ink: a wash, then crests in the ink crest colour drifting across the cells. The static
 * part (wash, cracks, shadow) is separate from the animated crests, so the cached terrain holds the
 * wash only and each frame adds the crests on top.
 */
function paintInkLiquid(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  ink: Readonly<RunewardInkConfig>,
  colors: Readonly<RunewardLiquidColours>,
  periodMs: number,
  neighbours: Neighbours,
  timeMs: number,
  part: RunewardPaintPart,
  detail: InkLiquidDetail
): void {
  if (part !== 'animated') {
    ctx.fillStyle = linear(ctx, 0, 0, 0, size, [[0, colors.light], [1, colors.deep]]);
    ctx.fillRect(0, 0, size, size);
    if (detail.cracks) paintInkCracks(ctx, size, ink.line, neighbours);
    castShadowIfNeeded(ctx, size, art, neighbours);
  }
  if (part === 'static') return;
  const cx = neighbours.cx ?? 0;
  const cy = neighbours.cy ?? 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  ctx.strokeStyle = colors.crest;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * LIQUID.lineWidth);
  ctx.lineCap = 'round';
  ctx.globalAlpha = INK_LIQUID.crestAlpha;
  const crestY = (row: number, across: number): number =>
    size * (LIQUID.firstRowY + row * LIQUID.rowSpacing) +
    crestPhase(timeMs, periodMs, cx, cy, row, across) * size * LIQUID.amplitude;
  for (let row = 0; row < LIQUID.crestRows; row += 1) {
    ctx.beginPath();
    for (let i = 0; i <= LIQUID.crestSegments; i += 1) {
      const across = i / LIQUID.crestSegments;
      if (i === 0) ctx.moveTo(size * across, crestY(row, across));
      else ctx.lineTo(size * across, crestY(row, across));
    }
    ctx.stroke();
    if (!detail.curls) continue;
    const curl = size * INK_LIQUID.curlSize;
    ctx.beginPath();
    for (const across of INK_LIQUID.curlAt) {
      const px = size * across;
      const py = crestY(row, across);
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + curl, py - curl, px + curl * 2, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Seal -------------------------------------------------------------------------------------

const SEAL = {
  glowRadius: 0.6,
  glowAlpha: 0.5,
  hexRadius: 0.3,
  innerHexRadius: 0.17,
  dotRadius: 0.04,
  lineWidth: 0.04,
  /** Inset of the cross-hatched recess of the ink seal, from the border of the tile. */
  recessInset: 0.08,
  hexSides: 6
} as const;

/** Traces a regular polygon around the middle of the cell, one corner pointing up. */
function tracePolygon(ctx: CanvasRenderingContext2D, centre: number, radius: number, sides: number, turn = 0): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * TAU + turn - Math.PI / 2;
    const px = centre + Math.cos(angle) * radius;
    const py = centre + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** The mark in the seal: a smaller hexagon outline with a dot at its centre, like the facet of the chip gem. */
function strokeSealMark(ctx: CanvasRenderingContext2D, size: number): void {
  const centre = size * HALF;
  tracePolygon(ctx, centre, size * SEAL.innerHexRadius, SEAL.hexSides);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centre, centre, Math.max(MIN_LINE_PX, size * SEAL.dotRadius), 0, TAU);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

/**
 * The socket seal at rest: a glowing hexagon around a smaller hexagon and a dot on a dark stone. It echoes the
 * hexagon of the chip and cannot be taken for floor. It does not move, so the clock plays no part.
 */
export function paintSeal(ctx: CanvasRenderingContext2D, size: number, art: Art, neighbours: Neighbours): void {
  const { seal } = art;
  const centre = size * HALF;
  if (art.ink) {
    paintInkSeal(ctx, size, art, art.ink, neighbours);
    return;
  }
  ctx.fillStyle = seal.base;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = SEAL.glowAlpha;
  ctx.fillStyle = radial(ctx, centre, centre, size * SEAL.glowRadius, [[0, seal.glyph], [1, seal.glow]]);
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = seal.glyph;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * SEAL.lineWidth);
  tracePolygon(ctx, centre, size * SEAL.hexRadius, SEAL.hexSides);
  ctx.stroke();
  strokeSealMark(ctx, size);
  castShadowIfNeeded(ctx, size, art, neighbours);
}

/** The seal in ink: aged paper, a cross-hatched recess, a gold rim around the hexagon and the inner mark in line. */
function paintInkSeal(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  ink: Readonly<RunewardInkConfig>,
  neighbours: Neighbours
): void {
  const centre = size * HALF;
  paintPaper(ctx, size, art.seal.base, ink, neighbours);
  if (hasInkHatching(size)) {
    const inset = size * SEAL.recessInset;
    const recess = { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 };
    paintHatching(ctx, size, neighbours, recess, ink.hatch);
    paintHatching(ctx, size, neighbours, recess, ink.hatch, true);
  }
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = inkLineWidth(size);
  ctx.strokeRect(0, 0, size, size);
  tracePolygon(ctx, centre, size * SEAL.hexRadius, SEAL.hexSides);
  ctx.fillStyle = art.seal.base;
  ctx.fill();
  ctx.strokeStyle = ink.gold;
  ctx.lineWidth = heavyLineWidth(size);
  ctx.stroke();
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = inkLineWidth(size);
  strokeSealMark(ctx, size);
  castShadowIfNeeded(ctx, size, art, neighbours);
}

// ---- Exit -------------------------------------------------------------------------------------

const EXIT = {
  glowRadius: 0.48,
  coreStop: 0.35,
  ringCount: 3,
  firstRingRadius: 0.14,
  ringSpacing: 0.1,
  ringSweep: Math.PI * 1.2,
  ringAlpha: 0.7,
  ringAlphaStep: 0.18,
  lineWidth: 0.035
} as const;

/** The glowing exit: a bright core and three arcs turning around it. */
export function paintExit(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  neighbours: Neighbours,
  timeMs: number,
  part: RunewardPaintPart = 'all'
): void {
  if (art.ink) {
    paintInkExit(ctx, size, art, art.ink, neighbours, timeMs, part);
    return;
  }
  const { exit } = art;
  ctx.fillStyle = exit.base;
  ctx.fillRect(0, 0, size, size);
  const centre = size / 2;
  const turn = (timeMs / art.animation.portalPeriodMs) * TAU;
  ctx.fillStyle = radial(ctx, centre, centre, size * EXIT.glowRadius, [
    [0, exit.core],
    [EXIT.coreStop, exit.ring],
    [1, exit.glow]
  ]);
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = exit.core;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * EXIT.lineWidth);
  for (let i = 0; i < EXIT.ringCount; i += 1) {
    ctx.globalAlpha = EXIT.ringAlpha - i * EXIT.ringAlphaStep;
    ctx.beginPath();
    ctx.arc(centre, centre, size * (EXIT.firstRingRadius + i * EXIT.ringSpacing), turn + i, turn + i + EXIT.ringSweep);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  castShadowIfNeeded(ctx, size, art, neighbours);
}

// ---- Ink exit ---------------------------------------------------------------------------------

const INK_EXIT = {
  /** Distance of the gold rim from the border of the tile. */
  rimInset: 0.06,
  starOuter: 0.2,
  starInner: 0.08,
  starPoints: 4,
  ringCount: 2,
  firstRingRadius: 0.27,
  ringSpacing: 0.07,
  ringAlpha: 0.7,
  ringAlphaStep: 0.25
} as const;

/** The exit in ink: the glow, a gold rim and a four-point star at rest, and arcs turning around it. */
function paintInkExit(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  ink: Readonly<RunewardInkConfig>,
  neighbours: Neighbours,
  timeMs: number,
  part: RunewardPaintPart
): void {
  const { exit } = art;
  const centre = size / 2;
  if (part !== 'animated') {
    ctx.fillStyle = exit.base;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = radial(ctx, centre, centre, size * EXIT.glowRadius, [
      [0, exit.core],
      [EXIT.coreStop, exit.ring],
      [1, exit.glow]
    ]);
    ctx.fillRect(0, 0, size, size);
    const rim = size * INK_EXIT.rimInset;
    ctx.strokeStyle = ink.gold;
    ctx.lineWidth = heavyLineWidth(size);
    ctx.strokeRect(rim, rim, size - rim * 2, size - rim * 2);
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    ctx.strokeRect(0, 0, size, size);
    ctx.beginPath();
    for (let i = 0; i < INK_EXIT.starPoints * 2; i += 1) {
      const radius = size * (i % 2 === 0 ? INK_EXIT.starOuter : INK_EXIT.starInner);
      const angle = (i / (INK_EXIT.starPoints * 2)) * TAU - Math.PI / 2;
      const px = centre + Math.cos(angle) * radius;
      const py = centre + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = ink.gold;
    ctx.fill();
    ctx.stroke();
    castShadowIfNeeded(ctx, size, art, neighbours);
  }
  if (part === 'static') return;
  const turn = (timeMs / art.animation.portalPeriodMs) * TAU;
  ctx.strokeStyle = exit.core;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * EXIT.lineWidth);
  for (let i = 0; i < INK_EXIT.ringCount; i += 1) {
    ctx.globalAlpha = INK_EXIT.ringAlpha - i * INK_EXIT.ringAlphaStep;
    ctx.beginPath();
    ctx.arc(centre, centre, size * (INK_EXIT.firstRingRadius + i * INK_EXIT.ringSpacing), turn + i, turn + i + EXIT.ringSweep);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---- The mage ---------------------------------------------------------------------------------

/** How the character stands: where it looks, and the poses the game asks for. */
export interface MagePose {
  readonly dir: Direction;
  readonly inWater: boolean;
  readonly alive: boolean;
  /** 0 standing, 1 or 2 for the two strides. */
  readonly frame: number;
  /** Lift of the sprite in tiles. */
  readonly hop: number;
}

const MAGE = {
  shadow: { x: 0.5, y: 0.86, rx: 0.26, ry: 0.07 },
  /** Horizontal shift of the staff, and the extra a profile adds. */
  staffFrontX: 0.27,
  staffSideX: 0.3,
  staffBottom: 0.82,
  staffTop: 0.3,
  staffWidth: 0.05,
  staffMinWidthPx: 1.5,
  orb: { y: 0.27, radius: 0.14, coreStop: 0.4 },
  robe: { topY: 0.36, midY: 0.5, rightX: 0.74, hemRightX: 0.76, hemY: 0.84, hemLeftX: 0.24, leftX: 0.26 },
  robeGradient: { from: 0.3, to: 0.7 },
  head: { x: 0.5, y: 0.4, radius: 0.13 },
  eyes: { y: 0.41, spacing: 0.045, profile: 0.02, shift: 0.04, radius: 0.02 },
  hatBrim: { y: 0.31, rx: 0.24, ry: 0.06, gradientFrom: 0.28, gradientTo: 0.72 },
  hatCone: { leftX: 0.33, controlX: 0.48, controlY: 0.12, tipX: 0.58, tipY: 0.02, tipLean: 0.06, backX: 0.56, backY: 0.18, rightX: 0.67 },
  hatBand: { x: 0.35, y: 0.27, w: 0.3, h: 0.035 },
  /** Sway of the body per stride frame, in tiles. */
  strideSway: 0.015,
  /** Fraction of the height kept above the water line when swimming. */
  waterLine: 0.72,
  deadAlpha: 0.45
} as const;

/** Strokes the current path in ink: the outline of a part of the figure. */
function inkOutline(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Side the character leans to: -1 west, 1 east, 0 facing the viewer or away. */
export function mageSide(dir: Direction): number {
  if (dir === 'E') return 1;
  if (dir === 'W') return -1;
  return 0;
}

/** The apprentice: robe, pointed hat and a staff with a glowing orb. */
export function paintMage(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  pose: MagePose,
  timeMs: number
): void {
  const { mage, animation, ink } = art;
  const side = mageSide(pose.dir);
  const awayFromViewer = pose.dir === 'N';
  const bob = pose.alive ? Math.sin((timeMs / animation.bobPeriodMs) * TAU) * size * animation.bobAmplitude : 0;
  const stride = pose.frame === 0 ? 0 : pose.frame === 1 ? 1 : -1;
  const lift = -pose.hop * size;

  ctx.save();
  if (!pose.alive) ctx.globalAlpha = MAGE.deadAlpha;
  if (pose.inWater) {
    ctx.beginPath();
    ctx.rect(0, 0, size, size * MAGE.waterLine);
    ctx.clip();
  } else {
    ctx.fillStyle = mage.shadow;
    ctx.beginPath();
    ctx.ellipse(size * MAGE.shadow.x, size * MAGE.shadow.y, size * MAGE.shadow.rx, size * MAGE.shadow.ry, 0, 0, TAU);
    ctx.fill();
  }
  ctx.translate(stride * size * MAGE.strideSway, bob + lift);

  // Staff behind the body, on the facing side.
  const staffX = size * (HALF + (side === 0 ? MAGE.staffFrontX : side * MAGE.staffSideX));
  const staffWidth = Math.max(MAGE.staffMinWidthPx, size * MAGE.staffWidth);
  if (ink) {
    // Ink edge under the wood: the same stroke, wider.
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = staffWidth + inkLineWidth(size) * 2;
    ctx.beginPath();
    ctx.moveTo(staffX, size * MAGE.staffBottom);
    ctx.lineTo(staffX, size * MAGE.staffTop);
    ctx.stroke();
  }
  ctx.strokeStyle = ink ? ink.wood : mage.staff;
  ctx.lineWidth = staffWidth;
  ctx.beginPath();
  ctx.moveTo(staffX, size * MAGE.staffBottom);
  ctx.lineTo(staffX, size * MAGE.staffTop);
  ctx.stroke();
  ctx.fillStyle = radial(ctx, staffX, size * MAGE.orb.y, size * MAGE.orb.radius, [
    [0, mage.orbCore],
    [MAGE.orb.coreStop, mage.orb],
    [1, art.clear]
  ]);
  ctx.beginPath();
  ctx.arc(staffX, size * MAGE.orb.y, size * MAGE.orb.radius, 0, TAU);
  ctx.fill();

  // Robe.
  ctx.fillStyle = linear(ctx, size * MAGE.robeGradient.from, 0, size * MAGE.robeGradient.to, 0, [
    [0, mage.robeLight],
    [1, mage.robe]
  ]);
  ctx.beginPath();
  ctx.moveTo(size * HALF, size * MAGE.robe.topY);
  ctx.quadraticCurveTo(size * MAGE.robe.rightX, size * MAGE.robe.midY, size * MAGE.robe.hemRightX, size * MAGE.robe.hemY);
  ctx.lineTo(size * MAGE.robe.hemLeftX, size * MAGE.robe.hemY);
  ctx.quadraticCurveTo(size * MAGE.robe.leftX, size * MAGE.robe.midY, size * HALF, size * MAGE.robe.topY);
  ctx.fill();
  if (ink) inkOutline(ctx, ink.line, heavyLineWidth(size));

  // Face, hidden when walking away.
  ctx.fillStyle = awayFromViewer ? mage.hat : mage.skin;
  ctx.beginPath();
  ctx.arc(size * MAGE.head.x, size * MAGE.head.y, size * MAGE.head.radius, 0, TAU);
  ctx.fill();
  if (ink) inkOutline(ctx, ink.line, inkLineWidth(size));
  if (!awayFromViewer) {
    ctx.fillStyle = mage.eyes;
    const eyeShift = side * size * MAGE.eyes.shift;
    const offsets = side === 0 ? [-MAGE.eyes.spacing, MAGE.eyes.spacing] : [MAGE.eyes.profile * side];
    for (const dx of offsets) {
      ctx.beginPath();
      ctx.arc(size * (HALF + dx) + eyeShift, size * MAGE.eyes.y, Math.max(MIN_LINE_PX, size * MAGE.eyes.radius), 0, TAU);
      ctx.fill();
    }
  }

  // Hat.
  ctx.fillStyle = linear(ctx, size * MAGE.hatBrim.gradientFrom, 0, size * MAGE.hatBrim.gradientTo, 0, [
    [0, mage.hatLight],
    [1, mage.hat]
  ]);
  ctx.beginPath();
  ctx.ellipse(size * HALF, size * MAGE.hatBrim.y, size * MAGE.hatBrim.rx, size * MAGE.hatBrim.ry, 0, 0, TAU);
  ctx.fill();
  if (ink) inkOutline(ctx, ink.line, heavyLineWidth(size));
  const cone = MAGE.hatCone;
  ctx.beginPath();
  ctx.moveTo(size * cone.leftX, size * MAGE.hatBrim.y);
  ctx.quadraticCurveTo(size * cone.controlX, size * cone.controlY, size * (cone.tipX + side * cone.tipLean), size * cone.tipY);
  ctx.quadraticCurveTo(size * cone.backX, size * cone.backY, size * cone.rightX, size * MAGE.hatBrim.y);
  ctx.fill();
  if (ink) inkOutline(ctx, ink.line, heavyLineWidth(size));
  ctx.fillStyle = ink ? ink.gold : mage.band;
  ctx.fillRect(size * MAGE.hatBand.x, size * MAGE.hatBand.y, size * MAGE.hatBand.w, size * MAGE.hatBand.h);
  ctx.restore();
}
