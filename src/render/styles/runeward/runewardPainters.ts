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

import type { Direction, RunewardArtConfig, RunewardLiquidColours } from '../../../core/types';
import { NEIGHBOUR, type TileNeighbours } from '../../tileNeighbours';

type Art = Readonly<RunewardArtConfig>;
type Neighbours = Readonly<TileNeighbours>;

const TAU = Math.PI * 2;
/** Middle of the cell, as a fraction of its size. */
const HALF = 0.5;

// ---- Hash and waves -------------------------------------------------------------------------

const HASH_MULTIPLIER_X = 374761393;
const HASH_MULTIPLIER_Y = 668265263;
const HASH_MIX_MULTIPLIER = 1274126177;
const HASH_SHIFT_MIDDLE = 13;
const HASH_SHIFT_FINAL = 16;

/** A small stable hash of a tile position, for texture variety without randomness. */
export function tileHash(x: number, y: number): number {
  let h = (Math.imul(x, HASH_MULTIPLIER_X) + Math.imul(y, HASH_MULTIPLIER_Y)) >>> 0;
  h = Math.imul(h ^ (h >>> HASH_SHIFT_MIDDLE), HASH_MIX_MULTIPLIER) >>> 0;
  return (h ^ (h >>> HASH_SHIFT_FINAL)) >>> 0;
}

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
  if (isShadowedFromNorth(neighbours)) paintCastShadow(ctx, size, art);
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
  const inset = size * BLUE_WALL.inset;
  ctx.strokeStyle = art.blueWall.line;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * BLUE_WALL.lineWidth);
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
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
  timeMs: number
): void {
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
  timeMs: number
): void {
  paintLiquid(ctx, size, art, art.water, art.animation.flowPeriodMs, neighbours, timeMs);
}

/** Lava is the fire tile: the same flow as water, slower, in the lava colours. */
export function paintLava(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  neighbours: Neighbours,
  timeMs: number
): void {
  paintLiquid(ctx, size, art, art.lava, art.animation.flowPeriodMs * LIQUID.lavaPeriodFactor, neighbours, timeMs);
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
  timeMs: number
): void {
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
  const { mage, animation } = art;
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
  ctx.strokeStyle = mage.staff;
  ctx.lineWidth = Math.max(MAGE.staffMinWidthPx, size * MAGE.staffWidth);
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

  // Face, hidden when walking away.
  ctx.fillStyle = awayFromViewer ? mage.hat : mage.skin;
  ctx.beginPath();
  ctx.arc(size * MAGE.head.x, size * MAGE.head.y, size * MAGE.head.radius, 0, TAU);
  ctx.fill();
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
  const cone = MAGE.hatCone;
  ctx.beginPath();
  ctx.moveTo(size * cone.leftX, size * MAGE.hatBrim.y);
  ctx.quadraticCurveTo(size * cone.controlX, size * cone.controlY, size * (cone.tipX + side * cone.tipLean), size * cone.tipY);
  ctx.quadraticCurveTo(size * cone.backX, size * cone.backY, size * cone.rightX, size * MAGE.hatBrim.y);
  ctx.fill();
  ctx.fillStyle = mage.band;
  ctx.fillRect(size * MAGE.hatBand.x, size * MAGE.hatBand.y, size * MAGE.hatBand.w, size * MAGE.hatBand.h);
  ctx.restore();
}
