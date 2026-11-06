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
 * Pure painters of the floor hazards and movers in the Runeward render style: traps, teleports, ice (plain and
 * corner) and force floors. Like the painters in runewardPainters.ts each draws into the square from (0, 0) to
 * (size, size) from the Runeward art config, in the plain drawing or, when the art block has an ink section, as
 * pigment washes with ink lines. The direction of a force floor and the bend of an ice corner are drawn from the
 * same data the engine uses, so a picture can never point somewhere the tile does not push. The proportions below
 * are the drawings themselves, the way pixel art is data: they are art, not settings.
 */

import type { Direction, RunewardArtConfig, RunewardInkConfig, RunewardKeyColour } from '../../../core/types';
import { paintColorGlyph } from '../../colorGlyph';
import { type IceBendGeometry, paintIceBend } from '../../iceBend';
import type { TileNeighbours } from '../../tileNeighbours';
import {
  hasInkHatching,
  heavyLineWidth,
  inkLineWidth,
  paintHatching
} from './runewardInk';
import {
  castShadowIfNeeded,
  linear,
  paintFloor,
  radial,
  type RunewardPaintPart
} from './runewardPainters';

type Art = Readonly<RunewardArtConfig>;
type Neighbours = Readonly<TileNeighbours>;
type Ink = Readonly<RunewardInkConfig>;

const TAU = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;
/** Middle of the cell, as a fraction of its size. */
const HALF = 0.5;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;

// ---- Trap -------------------------------------------------------------------------------------

const TRAP = {
  /** Distance of the recess from the border of the cell. */
  inset: 0.1,
  frameWidth: 0.04,
  /** Reach of the shadow along the upper lip of the recess, as a fraction of the recess. */
  lipDepth: 0.45,
  /** Space between the recess and the jaws, top and bottom. */
  jawMargin: 0.05,
  /** Width of the bar each jaw is mounted on, along the side of the recess. */
  barWidth: 0.1,
  toothCount: 3,
  /** Tooth length when the jaws meet: the tips stop short of the middle by half this gap on each side. */
  meetGap: 0.03,
  /** Tooth length when the jaws are pulled back to the sides. */
  openToothLength: 0.05,
  jawLineWidth: 0.025
} as const;

/** The jaw of one side: a bar on the side of the recess with teeth pointing at the middle. */
function traceJaw(ctx: CanvasRenderingContext2D, size: number, rightSide: boolean, toothLength: number): void {
  const edge = size * TRAP.inset;
  const top = edge + size * TRAP.jawMargin;
  const bottom = size - edge - size * TRAP.jawMargin;
  const span = (bottom - top) / TRAP.toothCount;
  const bar = size * TRAP.barWidth;
  const at = (x: number): number => (rightSide ? size - x : x);
  ctx.beginPath();
  ctx.moveTo(at(edge), top);
  ctx.lineTo(at(edge + bar), top);
  for (let i = 0; i < TRAP.toothCount; i += 1) {
    const y = top + i * span;
    ctx.lineTo(at(edge + bar), y);
    ctx.lineTo(at(edge + bar + toothLength), y + span / 2);
    ctx.lineTo(at(edge + bar), y + span);
  }
  ctx.lineTo(at(edge), bottom);
  ctx.closePath();
}

/** Length of the teeth for a jaw state: closed jaws meet in the middle, open jaws are pulled back to the sides. */
export function trapToothLength(size: number, closed: boolean): number {
  if (!closed) return size * TRAP.openToothLength;
  return size * (HALF - TRAP.meetGap / 2 - TRAP.inset - TRAP.barWidth);
}

/** A trap: a dark recess in the floor with iron jaws that meet when the trap is closed and part when it is open. */
export function paintTrap(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  neighbours: Neighbours,
  closed: boolean
): void {
  const { trap, ink } = art;
  paintFloor(ctx, size, art, neighbours);
  const edge = size * TRAP.inset;
  const inner = size - edge * 2;
  ctx.fillStyle = trap.pit;
  ctx.fillRect(edge, edge, inner, inner);
  if (ink) {
    if (hasInkHatching(size)) {
      const rect = { x: edge, y: edge, w: inner, h: inner };
      paintHatching(ctx, size, neighbours, rect, ink.line);
      paintHatching(ctx, size, neighbours, rect, ink.line, true);
    }
  } else {
    ctx.fillStyle = linear(ctx, 0, edge, 0, edge + inner * TRAP.lipDepth, [[0, art.shadow.color], [1, art.clear]]);
    ctx.fillRect(edge, edge, inner, inner * TRAP.lipDepth);
  }
  ctx.strokeStyle = ink ? ink.line : art.gate.frame;
  ctx.lineWidth = ink ? heavyLineWidth(size) : Math.max(MIN_LINE_PX, size * TRAP.frameWidth);
  ctx.strokeRect(edge, edge, inner, inner);
  const toothLength = trapToothLength(size, closed);
  for (const rightSide of [false, true]) {
    traceJaw(ctx, size, rightSide, toothLength);
    ctx.fillStyle = trap.jaw;
    ctx.fill();
    ctx.strokeStyle = ink ? ink.line : trap.jawLight;
    ctx.lineWidth = ink ? inkLineWidth(size) : Math.max(MIN_LINE_PX, size * TRAP.jawLineWidth);
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }
}

// ---- Teleport ---------------------------------------------------------------------------------

/** Radius of the colour glyph on a coloured teleport, in tiles; the same as the shared drawing. */
export const TELEPORT_GLYPH_RADIUS = 0.11;

const PORTAL = {
  discRadius: 0.44,
  glowRadius: 0.44,
  glowRingStop: 0.4,
  ringRadius: 0.34,
  ringWidth: 0.05,
  swirlRadius: 0.2,
  swirlWidth: 0.035,
  swirlCount: 2,
  swirlSweep: Math.PI * 0.65,
  /** Dark disc under the colour glyph, so it reads on the bright centre of the vortex. */
  glyphBackRadius: 0.16
} as const;

const INK_PORTAL = {
  rimRadius: 0.4,
  outerRingRadius: 0.43,
  innerRingRadius: 0.28,
  centreRadius: 0.08,
  swirlRadius: 0.2,
  swirlCount: 2,
  swirlSweep: Math.PI * 0.65
} as const;

/** Colour channel of a coloured teleport, or null for the plain one. */
export type RunewardTeleportColour = RunewardKeyColour | null;

function strokeCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.stroke();
}

/** The colour mark of a coloured teleport: its glyph on a small disc, so colour is never the only cue. */
function paintTeleportGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  colour: RunewardKeyColour,
  backRadius: number
): void {
  const tint = art.keys[colour];
  const centre = size * HALF;
  ctx.fillStyle = art.ink ? tint.main : art.portal.base;
  ctx.beginPath();
  ctx.arc(centre, centre, size * backRadius, 0, TAU);
  ctx.fill();
  if (art.ink) {
    ctx.strokeStyle = art.ink.line;
    ctx.lineWidth = inkLineWidth(size);
    ctx.stroke();
  }
  paintColorGlyph(ctx, colour, centre, centre, size * TELEPORT_GLYPH_RADIUS, art.ink ? tint.glyph : tint.main);
}

/** The ink portal: a gold rim and ink rings at rest, and two ink arcs turning inside them in the animated pass. */
function paintInkPortal(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  ink: Ink,
  neighbours: Neighbours,
  turn: number,
  colour: RunewardTeleportColour,
  part: RunewardPaintPart
): void {
  const { portal } = art;
  const centre = size * HALF;
  if (part !== 'animated') {
    paintFloor(ctx, size, art, neighbours);
    ctx.fillStyle = portal.base;
    ctx.beginPath();
    ctx.arc(centre, centre, size * PORTAL.discRadius, 0, TAU);
    ctx.fill();
    ctx.fillStyle = radial(ctx, centre, centre, size * PORTAL.glowRadius, [
      [0, portal.core],
      [PORTAL.glowRingStop, colour ? art.keys[colour].light : portal.ring],
      [1, portal.glow]
    ]);
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    strokeCircle(ctx, centre, centre, size * INK_PORTAL.outerRingRadius);
    strokeCircle(ctx, centre, centre, size * INK_PORTAL.innerRingRadius);
    ctx.strokeStyle = ink.gold;
    ctx.lineWidth = heavyLineWidth(size);
    strokeCircle(ctx, centre, centre, size * INK_PORTAL.rimRadius);
    if (colour) {
      paintTeleportGlyph(ctx, size, art, colour, PORTAL.glyphBackRadius);
    } else {
      ctx.fillStyle = ink.line;
      ctx.beginPath();
      ctx.arc(centre, centre, size * INK_PORTAL.centreRadius, 0, TAU);
      ctx.fill();
    }
  }
  if (part === 'static') return;
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = inkLineWidth(size);
  for (let i = 0; i < INK_PORTAL.swirlCount; i += 1) {
    const start = -turn + (i * TAU) / INK_PORTAL.swirlCount;
    ctx.beginPath();
    ctx.arc(centre, centre, size * INK_PORTAL.swirlRadius, start, start + INK_PORTAL.swirlSweep);
    ctx.stroke();
  }
}

/**
 * A teleport: a vortex etched in the floor with a ring, turning with the clock (the caller freezes it under
 * reduced motion). A coloured teleport has a ring in its colour and the glyph of its colour at the centre.
 */
export function paintTeleport(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  neighbours: Neighbours,
  timeMs: number,
  part: RunewardPaintPart,
  colour: RunewardTeleportColour
): void {
  const turn = (timeMs / art.animation.portalPeriodMs) * TAU;
  if (art.ink) {
    paintInkPortal(ctx, size, art, art.ink, neighbours, turn, colour, part);
    return;
  }
  const { portal } = art;
  const tint = colour ? art.keys[colour] : null;
  const ringColour = tint ? tint.main : portal.ring;
  const centre = size * HALF;
  paintFloor(ctx, size, art, neighbours);
  ctx.fillStyle = portal.base;
  ctx.beginPath();
  ctx.arc(centre, centre, size * PORTAL.discRadius, 0, TAU);
  ctx.fill();
  ctx.fillStyle = radial(ctx, centre, centre, size * PORTAL.glowRadius, [
    [0, portal.core],
    [PORTAL.glowRingStop, ringColour],
    [1, tint ? art.clear : portal.glow]
  ]);
  ctx.beginPath();
  ctx.arc(centre, centre, size * PORTAL.discRadius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = ringColour;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * PORTAL.ringWidth);
  strokeCircle(ctx, centre, centre, size * PORTAL.ringRadius);
  ctx.strokeStyle = portal.core;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * PORTAL.swirlWidth);
  for (let i = 0; i < PORTAL.swirlCount; i += 1) {
    const start = -turn + (i * TAU) / PORTAL.swirlCount;
    ctx.beginPath();
    ctx.arc(centre, centre, size * PORTAL.swirlRadius, start, start + PORTAL.swirlSweep);
    ctx.stroke();
  }
  if (colour) paintTeleportGlyph(ctx, size, art, colour, PORTAL.glyphBackRadius);
}

// ---- Ice --------------------------------------------------------------------------------------

const ICE = {
  /** Number of crack arrangements the cell hash picks from. */
  variants: 3,
  crackShift: 0.18,
  crackWidth: 0.025,
  crackAlpha: 0.7,
  /** Light edge of the ice sheet, drawn half a pixel inside the cell. */
  edgeInset: 0.5,
  lightStop: 0.5,
  cracks: [
    { fromX: 0.1, fromY: 0.25, toX: 0.45, toY: 0.05, shifted: 'both' },
    { fromX: 0.2, fromY: 0.85, toX: 0.8, toY: 0.5, shifted: 'vertical' }
  ]
} as const;

/** Which of the crack arrangements a cell shows: stable, from its hash. */
export function iceVariant(neighbours: Neighbours): number {
  return neighbours.hash % ICE.variants;
}

/** Strokes the two cracks of an ice sheet for an arrangement. */
function strokeIceCracks(ctx: CanvasRenderingContext2D, size: number, variant: number): void {
  const shift = variant * size * ICE.crackShift;
  const [first, second] = ICE.cracks;
  ctx.beginPath();
  ctx.moveTo(size * first.fromX + shift, size * first.fromY);
  ctx.lineTo(size * first.toX + shift, size * first.toY);
  ctx.moveTo(size * second.fromX, size * second.fromY - shift * HALF);
  ctx.lineTo(size * second.toX, size * second.toY - shift * HALF);
  ctx.stroke();
}

/** Plain ice: a pale sheet with two cracks that move with the cell hash; the parchment drawing is a wash with ink cracks. */
export function paintIce(ctx: CanvasRenderingContext2D, size: number, art: Art, neighbours: Neighbours): void {
  const { ice, ink } = art;
  const variant = iceVariant(neighbours);
  if (ink) {
    ctx.fillStyle = ice.base;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    strokeIceCracks(ctx, size, variant);
  } else {
    ctx.fillStyle = linear(ctx, 0, 0, size, size, [[0, ice.light], [ICE.lightStop, ice.base], [1, ice.base]]);
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = ice.line;
    ctx.lineWidth = Math.max(MIN_LINE_PX, size * ICE.crackWidth);
    ctx.globalAlpha = ICE.crackAlpha;
    strokeIceCracks(ctx, size, variant);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = ice.edge;
  ctx.lineWidth = ink ? inkLineWidth(size) : MIN_LINE_PX;
  ctx.strokeRect(ICE.edgeInset, ICE.edgeInset, size - MIN_LINE_PX, size - MIN_LINE_PX);
  castShadowIfNeeded(ctx, size, art, neighbours);
}

/** Cross-hatches the walled corner of an ice bend: everything in the cell outside the quarter disc of ice. */
function hatchBendWall(ctx: CanvasRenderingContext2D, size: number, bend: IceBendGeometry, ink: Ink, neighbours: Neighbours): void {
  if (!hasInkHatching(size)) return;
  const cx = bend.cx * size;
  const cy = bend.cy * size;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.moveTo(cx + size, cy);
  ctx.arc(cx, cy, size, 0, TAU);
  ctx.clip('evenodd');
  const rect = { x: 0, y: 0, w: size, h: size };
  paintHatching(ctx, size, neighbours, rect, ink.hatch);
  paintHatching(ctx, size, neighbours, rect, ink.hatch, true);
  ctx.restore();
}

/**
 * A corner ice tile: the shared bend geometry (the slide path is a quarter circle between the two open edges),
 * with the wall quadrant in the wall top colour. In ink the wall quadrant is cross-hatched.
 */
export function paintIceCorner(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  neighbours: Neighbours,
  bend: IceBendGeometry
): void {
  const { ice, ink } = art;
  paintIceBend(ctx, bend, 0, 0, size, 0, {
    wall: art.wall.top,
    fill: ink ? ice.base : linear(ctx, 0, 0, size, size, [[0, ice.light], [ICE.lightStop, ice.base], [1, ice.base]]),
    band: ink ? ice.light : ice.line,
    streak: ink ? ink.line : ice.light,
    rim: ice.edge
  });
  if (ink) hatchBendWall(ctx, size, bend, ink, neighbours);
  castShadowIfNeeded(ctx, size, art, neighbours);
}

// ---- Force floor ------------------------------------------------------------------------------

/** Unit vector of each push direction in canvas space (y down). */
export const FORCE_VECTOR: Readonly<Record<Direction, readonly [number, number]>> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0]
};

const FORCE = {
  chevronCount: 3,
  /** Chevrons on a parchment tile too small to hatch: fewer, so their outlines stay apart. */
  smallInkChevronCount: 2,
  /** Depth of a chevron along the push, and its half height across it. */
  depth: 0.18,
  halfSpan: 0.2,
  lineWidth: 0.09,
  highlightWidth: 0.03,
  /** The pinwheel of the random force floor: four chevrons around the middle, pointing outwards. */
  pinwheelRadius: 0.27,
  pinwheelScale: 0.8,
  pinwheelArms: 4
} as const;

/** The three-chevron train shows chevrons on the axis from this many steps before the middle to as many after. */
const FORCE_TRAIN_REACH = 2;

/** One chevron: a polyline with its tip at `(cx, cy)` plus half its depth along `(dx, dy)`. */
function traceChevron(
  ctx: CanvasRenderingContext2D,
  size: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  scale: number
): void {
  const reach = (size * FORCE.depth * scale) / 2;
  const span = size * FORCE.halfSpan * scale;
  const tipX = cx + dx * reach;
  const tipY = cy + dy * reach;
  const tailX = cx - dx * reach;
  const tailY = cy - dy * reach;
  ctx.beginPath();
  ctx.moveTo(tailX - dy * span, tailY + dx * span);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tailX + dy * span, tailY - dx * span);
}

/** Strokes the path of a chevron in ink outline (parchment only), the main colour and a thin light core. */
function strokeChevron(ctx: CanvasRenderingContext2D, size: number, art: Art): void {
  const width = Math.max(MIN_LINE_PX, size * FORCE.lineWidth);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  if (art.ink) {
    ctx.strokeStyle = art.ink.line;
    ctx.lineWidth = width + (hasInkHatching(size) ? inkLineWidth(size) * 2 : MIN_LINE_PX);
    ctx.stroke();
  }
  ctx.strokeStyle = art.force.arrow;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.strokeStyle = art.force.arrowLight;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * FORCE.highlightWidth);
  ctx.stroke();
}

/** Position of the scroll, 0..1 of one chevron step, from the clock. */
function forcePhase(art: Art, timeMs: number): number {
  return (timeMs / art.animation.forceScrollPeriodMs) % 1;
}

/**
 * A force floor pushing toward `direction`, or in every direction for `null` (the random floor): chevrons point
 * along the push and scroll with it; the random floor shows four chevrons that turn like a pinwheel. With `swirl` the pinwheel chevrons follow the circle clockwise (the turning floor). The clock is
 * frozen at 0 by the caller under reduced motion. The underlay is repainted on every call, so the animated pass
 * can be drawn over the cached terrain without leaving ghosts.
 */
export function paintForce(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  neighbours: Neighbours,
  timeMs: number,
  direction: Direction | null,
  swirl = false
): void {
  const { force, ink } = art;
  ctx.fillStyle = force.base;
  ctx.fillRect(0, 0, size, size);
  if (ink && hasInkHatching(size)) {
    paintHatching(ctx, size, neighbours, { x: 0, y: 0, w: size, h: size }, ink.hatch);
  }
  castShadowIfNeeded(ctx, size, art, neighbours);
  const phase = forcePhase(art, timeMs);
  const centre = size * HALF;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  if (direction === null) {
    const turn = phase * QUARTER_TURN;
    for (let arm = 0; arm < FORCE.pinwheelArms; arm += 1) {
      const angle = turn + arm * QUARTER_TURN;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      // The turning floor points each chevron along the circle (clockwise); the random floor points them outward.
      const [pointX, pointY] = swirl ? [-dy, dx] : [dx, dy];
      traceChevron(
        ctx,
        size,
        centre + dx * size * FORCE.pinwheelRadius,
        centre + dy * size * FORCE.pinwheelRadius,
        pointX,
        pointY,
        FORCE.pinwheelScale
      );
      strokeChevron(ctx, size, art);
    }
  } else {
    const [dx, dy] = FORCE_VECTOR[direction];
    const count = ink && !hasInkHatching(size) ? FORCE.smallInkChevronCount : FORCE.chevronCount;
    const step = 1 / count;
    // An even count has no chevron in the middle: shift by half a step so the train stays centred at rest.
    const centred = count % 2 === 0 ? HALF : 0;
    const visible = HALF + FORCE.depth / 2 + FORCE.lineWidth / 2;
    for (let i = -FORCE_TRAIN_REACH; i <= FORCE_TRAIN_REACH; i += 1) {
      const along = (i + centred + phase) * step;
      if (Math.abs(along) > visible) continue;
      traceChevron(ctx, size, centre + dx * along * size, centre + dy * along * size, dx, dy, 1);
      strokeChevron(ctx, size, art);
    }
  }
  ctx.restore();
}
