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
 * The drawing of a relay pad, shared by the vector styles: a square housing with rounded corners, a ring inside it
 * and a short stepped wire with a terminal at each end. The same shape is drawn in both states. A lit pad has a
 * glowing, filled ring and a bright wire; a dark pad is the bare outline in muted colours, so it still reads as a
 * device and not as floor. Neither looks like the plain teleporter (a bare circle) or the pocket gate pad (a ring with
 * a notch). The signal wired mark, a plug drawn on a cell a signal link ends on, lives here too. The proportions are
 * the drawing itself; only the colours differ between styles.
 */

const TAU = Math.PI * 2;
const HALF = 0.5;
/** Half side of the housing and the radius of its corners, in tiles. */
const HOUSING_HALF = 0.36;
const HOUSING_CORNER = 0.11;
const HOUSING_WIDTH = 0.07;
/** Ring inside the housing: radius and line width, in tiles. */
const RING_RADIUS = 0.2;
const RING_WIDTH = 0.055;
/** Opacity of the disc that fills the ring of a lit pad. */
export const RELAY_LIT_FILL_ALPHA = 0.35;
/** The wire: its points relative to the tile centre, in tiles, the line width and the terminal radius. */
const WIRE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-0.12, 0.07],
  [-0.03, 0.07],
  [0.03, -0.07],
  [0.12, -0.07]
];
const WIRE_WIDTH = 0.045;
const TERMINAL_RADIUS = 0.04;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;
/** Blur radius of the glow of a lit pad, in tiles. */
const GLOW_BLUR_TILE = 0.08;

export interface RelayPadColours {
  /** The housing outline. */
  readonly housing: string;
  readonly ring: string;
  /** The wire and its two terminals. */
  readonly mark: string;
  /** Disc under the ring of a lit pad. */
  readonly fill: string;
}

export interface RelayPadOptions {
  /** Round the line widths to whole pixels (the pixel-art styles). */
  readonly crisp?: boolean;
  /** Soft glow around a lit pad (the neon styles). */
  readonly glow?: string;
}

function lineWidth(size: number, tiles: number, crisp: boolean): number {
  const raw = size * tiles;
  return Math.max(MIN_LINE_PX, crisp ? Math.round(raw) : raw);
}

/** Traces the rounded square of the housing around (cx, cy). */
function traceHousing(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const half = size * HOUSING_HALF;
  const corner = size * HOUSING_CORNER;
  const left = cx - half;
  const top = cy - half;
  const right = cx + half;
  const bottom = cy + half;
  ctx.beginPath();
  ctx.moveTo(left + corner, top);
  ctx.arcTo(right, top, right, bottom, corner);
  ctx.arcTo(right, bottom, left, bottom, corner);
  ctx.arcTo(left, bottom, left, top, corner);
  ctx.arcTo(left, top, right, top, corner);
  ctx.closePath();
}

/** Draws a relay pad, lit or dark, over the floor already painted in the cell at (x, y). */
export function paintRelayPad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  lit: boolean,
  colours: RelayPadColours,
  options: RelayPadOptions = {}
): void {
  const crisp = options.crisp === true;
  const cx = x + size * HALF;
  const cy = y + size * HALF;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (lit && options.glow !== undefined) {
    ctx.shadowColor = options.glow;
    ctx.shadowBlur = size * GLOW_BLUR_TILE;
  }
  ctx.strokeStyle = colours.housing;
  ctx.lineWidth = lineWidth(size, HOUSING_WIDTH, crisp);
  traceHousing(ctx, cx, cy, size);
  ctx.stroke();

  if (lit) {
    ctx.globalAlpha = RELAY_LIT_FILL_ALPHA;
    ctx.fillStyle = colours.fill;
    ctx.beginPath();
    ctx.arc(cx, cy, size * RING_RADIUS, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = colours.ring;
  ctx.lineWidth = lineWidth(size, RING_WIDTH, crisp);
  ctx.beginPath();
  ctx.arc(cx, cy, size * RING_RADIUS, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = colours.mark;
  ctx.lineWidth = lineWidth(size, WIRE_WIDTH, crisp);
  ctx.beginPath();
  WIRE_POINTS.forEach(([u, v], index) => {
    if (index === 0) ctx.moveTo(cx + size * u, cy + size * v);
    else ctx.lineTo(cx + size * u, cy + size * v);
  });
  ctx.stroke();
  ctx.fillStyle = colours.mark;
  for (const [u, v] of [WIRE_POINTS[0], WIRE_POINTS[WIRE_POINTS.length - 1]]) {
    ctx.beginPath();
    ctx.arc(cx + size * u, cy + size * v, Math.max(MIN_LINE_PX, size * TERMINAL_RADIUS), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Where the wired mark sits in a cell, as a share of the tile from its top left corner, and its size. */
const WIRED_MARK = {
  x: 0.8,
  y: 0.2,
  radius: 0.1,
  ringWidth: 0.04,
  /** Length of the two prongs of the plug, which stand on the side facing the cell, in tiles. */
  prong: 0.07
} as const;

export interface WiredMarkColours {
  /** Disc of the plug. */
  readonly body: string;
  /** Outline and prongs. */
  readonly edge: string;
}

/**
 * The wired mark: a small plug in the upper right corner of a cell a signal link ends on. A disc with a dark edge and
 * two short prongs, so it reads as a plug and stays readable on a wall or a rail.
 */
export function paintWiredMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: WiredMarkColours): void {
  const cx = x + size * WIRED_MARK.x;
  const cy = y + size * WIRED_MARK.y;
  const radius = Math.max(MIN_LINE_PX * 2, size * WIRED_MARK.radius);
  const prong = size * WIRED_MARK.prong;
  const width = lineWidth(size, WIRED_MARK.ringWidth, false);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = colours.edge;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(cx - radius * HALF, cy - radius);
  ctx.lineTo(cx - radius * HALF, cy - radius - prong);
  ctx.moveTo(cx + radius * HALF, cy - radius);
  ctx.lineTo(cx + radius * HALF, cy - radius - prong);
  ctx.stroke();
  ctx.fillStyle = colours.body;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
