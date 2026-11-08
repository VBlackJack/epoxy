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
 * The drawing of a rail piece, shared by every style: two rails and the sleepers across them, following the open
 * sides of the piece (a straight run, or a quarter arc for a bend), and a buffer bar on every closed side. A rail
 * switch also shows its other form faded, so the player can see where the switch will turn next. The proportions
 * are the drawing itself, the way pixel art is data. Only the colours differ between styles.
 */

import { DIRECTION_VECTORS } from '../config/constants';
import { RAIL_TRACK_COUNT, RAIL_TRACK_SIDES } from '../core/coreConstants';
import type { Direction } from '../core/types';

const TAU = Math.PI * 2;
const HALF = 0.5;
/** Distance of each rail from the track centre line, in tiles. */
const GAUGE = 0.17;
/** Offsets of the two rails from a straight centre line, in tiles. */
const RAIL_OFFSETS = [-GAUGE, GAUGE] as const;
/** Radii of the two rails of a bend, around the tile corner, in tiles. */
const RAIL_RADII = [HALF - GAUGE, HALF + GAUGE] as const;
/** Half length of a sleeper, measured from the centre line, in tiles. */
const SLEEPER_REACH = 0.25;
/** Sleepers along a straight run, and along a quarter arc. */
const STRAIGHT_SLEEPERS = 4;
const BEND_SLEEPERS = 3;
/** Widths in tiles: the sleeper, the rail, and the outline added around each side of a line. */
const SLEEPER_WIDTH = 0.1;
const RAIL_WIDTH = 0.06;
const OUTLINE_WIDTH = 0.035;
/** Buffer bar of a closed side: length along the edge, thickness, and distance from the edge, in tiles. */
const CAP_LENGTH = 0.46;
const CAP_WIDTH = 0.08;
const CAP_INSET = 0.07;
/** Opacity of the other form of a rail switch. */
export const RAIL_OTHER_FORM_ALPHA = 0.3;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;
/** Blur radius of the neon glow, in tiles. */
const GLOW_BLUR_TILE = 0.07;

export interface RailColours {
  /** Outline under the rails, the sleepers and the buffers. */
  readonly outline: string;
  readonly sleeper: string;
  readonly rail: string;
  readonly buffer: string;
}

export interface RailPaintOptions {
  /** Round the line widths to whole pixels (the pixel-art styles). */
  readonly crisp?: boolean;
  /** Soft glow around the current form (the neon styles). */
  readonly glow?: string;
}

const ALL_SIDES: readonly Direction[] = ['N', 'E', 'S', 'W'];

function lineWidth(size: number, tiles: number, crisp: boolean): number {
  const raw = size * tiles;
  return Math.max(MIN_LINE_PX, crisp ? Math.round(raw) : raw);
}

/** Strokes the current path twice: the outline width first, then the colour on top. */
function strokeLined(
  ctx: CanvasRenderingContext2D,
  outline: string,
  outerWidth: number,
  colour: string,
  innerWidth: number
): void {
  ctx.strokeStyle = outline;
  ctx.lineWidth = outerWidth;
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = innerWidth;
  ctx.stroke();
}

/** One form of the piece: sleepers, then the two rails, then the buffers of its closed sides. */
function paintForm(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  size: number,
  sides: readonly Direction[],
  bufferSides: readonly Direction[],
  colours: RailColours,
  crisp: boolean
): void {
  const outlineExtra = lineWidth(size, OUTLINE_WIDTH, crisp) * 2;
  const sleeperW = lineWidth(size, SLEEPER_WIDTH, crisp);
  const railW = lineWidth(size, RAIL_WIDTH, crisp);
  const cx = ox + size * HALF;
  const cy = oy + size * HALF;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';

  const [first, second] = sides;
  if (first !== undefined && second !== undefined) {
    const v1 = DIRECTION_VECTORS[first];
    const v2 = DIRECTION_VECTORS[second];
    const straight = v1.dx + v2.dx === 0 && v1.dy + v2.dy === 0;
    if (straight) {
      // A straight run through the centre, along the axis of the two open sides.
      const px = v1.dy;
      const py = v1.dx;
      ctx.beginPath();
      for (let i = 0; i < STRAIGHT_SLEEPERS; i++) {
        const t = ((i * 2 + 1) / (STRAIGHT_SLEEPERS * 2) - HALF) * size;
        const mx = cx + v1.dx * t;
        const my = cy + v1.dy * t;
        ctx.moveTo(mx - px * size * SLEEPER_REACH, my - py * size * SLEEPER_REACH);
        ctx.lineTo(mx + px * size * SLEEPER_REACH, my + py * size * SLEEPER_REACH);
      }
      strokeLined(ctx, colours.outline, sleeperW + outlineExtra, colours.sleeper, sleeperW);
      ctx.beginPath();
      for (const offset of RAIL_OFFSETS) {
        ctx.moveTo(cx - v1.dx * size * HALF + px * size * offset, cy - v1.dy * size * HALF + py * size * offset);
        ctx.lineTo(cx + v1.dx * size * HALF + px * size * offset, cy + v1.dy * size * HALF + py * size * offset);
      }
      strokeLined(ctx, colours.outline, railW + outlineExtra, colours.rail, railW);
    } else {
      // A bend: quarter arcs around the tile corner both open sides point to.
      const kx = cx + (v1.dx + v2.dx) * size * HALF;
      const ky = cy + (v1.dy + v2.dy) * size * HALF;
      const a1 = Math.atan2(cy + v1.dy * size * HALF - ky, cx + v1.dx * size * HALF - kx);
      const a2 = Math.atan2(cy + v2.dy * size * HALF - ky, cx + v2.dx * size * HALF - kx);
      let delta = a2 - a1;
      while (delta > Math.PI) delta -= TAU;
      while (delta < -Math.PI) delta += TAU;
      ctx.beginPath();
      for (let i = 0; i < BEND_SLEEPERS; i++) {
        const angle = a1 + (delta * (i * 2 + 1)) / (BEND_SLEEPERS * 2);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const inner = size * (HALF - SLEEPER_REACH);
        const outer = size * (HALF + SLEEPER_REACH);
        ctx.moveTo(kx + cos * inner, ky + sin * inner);
        ctx.lineTo(kx + cos * outer, ky + sin * outer);
      }
      strokeLined(ctx, colours.outline, sleeperW + outlineExtra, colours.sleeper, sleeperW);
      ctx.beginPath();
      for (const radius of RAIL_RADII) {
        ctx.moveTo(kx + Math.cos(a1) * size * radius, ky + Math.sin(a1) * size * radius);
        ctx.arc(kx, ky, size * radius, a1, a1 + delta, delta < 0);
      }
      strokeLined(ctx, colours.outline, railW + outlineExtra, colours.rail, railW);
    }
  }

  // Buffer bars on the closed sides, across the end of the track.
  if (bufferSides.length > 0) {
    const capW = lineWidth(size, CAP_WIDTH, crisp);
    const half = size * CAP_LENGTH * HALF;
    ctx.beginPath();
    for (const side of bufferSides) {
      const v = DIRECTION_VECTORS[side];
      const bx = cx + v.dx * size * (HALF - CAP_INSET);
      const by = cy + v.dy * size * (HALF - CAP_INSET);
      ctx.moveTo(bx - v.dy * half, by - v.dx * half);
      ctx.lineTo(bx + v.dy * half, by + v.dx * half);
    }
    strokeLined(ctx, colours.outline, capW + outlineExtra, colours.buffer, capW);
  }
}

/**
 * Draws a rail piece on top of the floor already painted in the cell at (x, y). `sides` are the open sides of the
 * piece, `otherSides` those of the other form of a switch (undefined for a fixed piece).
 */
export function paintRailPiece(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  sides: readonly Direction[],
  otherSides: readonly Direction[] | undefined,
  colours: RailColours,
  options: RailPaintOptions = {}
): void {
  const crisp = options.crisp === true;
  const differs = otherSides !== undefined && otherSides.some((side) => !sides.includes(side));
  ctx.save();
  if (differs) {
    ctx.globalAlpha = RAIL_OTHER_FORM_ALPHA;
    // Only the track of the other form: its buffers would fight the current form's.
    paintForm(ctx, x, y, size, otherSides, [], colours, crisp);
    ctx.globalAlpha = 1;
  }
  // A side closed now but open in the other form carries no buffer: the faded track shows it will open.
  const buffers = ALL_SIDES.filter((side) => !sides.includes(side) && !(differs && otherSides.includes(side)));
  if (options.glow !== undefined) {
    ctx.shadowColor = options.glow;
    ctx.shadowBlur = size * GLOW_BLUR_TILE;
  }
  paintForm(ctx, x, y, size, sides, buffers, colours, crisp);
  ctx.restore();
}

/** The segments of the sample junction shown where no level is running (the editor, an icon): east-west, north-south and north-east. */
export const JUNCTION_SAMPLE_MASK = (1 << 4) | (1 << 5) | 1;

/** Value of the active segment of a track cell without a switch. */
export const JUNCTION_NO_SWITCH = -1;

/**
 * Draws a Chip's Challenge 2 track cell on top of the floor already painted in the cell at (x, y): every segment the
 * cell holds (`mask`, one bit per segment in the order of RAIL_TRACK_SIDES). A cell with a switch (`active` is the
 * switched segment) shows that segment in full and the others faded, so the player sees where the way leads now.
 * No buffer bars are drawn: a side a segment does not touch is not closed by a bar, the tracks simply stop.
 */
export function paintRailJunction(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  mask: number,
  active: number,
  colours: RailColours,
  options: RailPaintOptions = {}
): void {
  const crisp = options.crisp === true;
  const switched = active !== JUNCTION_NO_SWITCH;
  const faded: number[] = [];
  const current: number[] = [];
  for (let track = 0; track < RAIL_TRACK_COUNT; track++) {
    const held = (mask & (1 << track)) !== 0;
    if (switched ? track === active : held) current.push(track);
    else if (held) faded.push(track);
  }
  ctx.save();
  if (faded.length > 0) {
    ctx.globalAlpha = RAIL_OTHER_FORM_ALPHA;
    for (const track of faded) paintForm(ctx, x, y, size, RAIL_TRACK_SIDES[track], [], colours, crisp);
    ctx.globalAlpha = 1;
  }
  if (options.glow !== undefined) {
    ctx.shadowColor = options.glow;
    ctx.shadowBlur = size * GLOW_BLUR_TILE;
  }
  for (const track of current) paintForm(ctx, x, y, size, RAIL_TRACK_SIDES[track], [], colours, crisp);
  ctx.restore();
}
