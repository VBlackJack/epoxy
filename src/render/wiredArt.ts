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
 * The drawings of the wired devices, shared by the vector styles: the purple wall and floor (a solid slab with a
 * diamond, and its dashed ghost), the toggle switch (a housing with a lever that leans left when off and right when
 * on), the black button (a dark cap on a bezel) and the gray pulse button (a gray cap with four dots that mark the
 * square it reaches). Each is drawn over the floor already painted in the cell. The proportions are the drawing itself;
 * only the colours differ between styles.
 */

/** The wired devices this module draws. */
export type WiredShape = 'purple_wall' | 'purple_floor' | 'switch_off' | 'switch_on' | 'black_button' | 'gray_button';

/** The shipped tile id of each drawn wired device. */
export const WIRED_SHAPE_OF_TILE: Readonly<Record<string, WiredShape>> = {
  purple_wall: 'purple_wall',
  purple_floor: 'purple_floor',
  toggle_switch_off: 'switch_off',
  toggle_switch_on: 'switch_on',
  black_button: 'black_button',
  button_gray_area: 'gray_button'
};

/** The wired trap tile id: the plain trap drawing and the plug of a wired cell. */
export const WIRED_TRAP_TILE = 'trap_wired';

/** The lit wired flame jet: its plain jet is animated, so the plug follows the animated pass. */
export const WIRED_LIT_JET_TILE = 'flame_jet_wired_on';

/** The plain tile each wired trap or flame jet is drawn as, with the plug of a wired cell on top. */
export const WIRED_BASE_TILE: Readonly<Record<string, string>> = {
  [WIRED_TRAP_TILE]: 'trap',
  flame_jet_wired_off: 'flame_jet_off',
  [WIRED_LIT_JET_TILE]: 'flame_jet_on'
};

/** Colours of a wired device, all taken from the active style by the caller. */
export interface WiredColours {
  /** Fill of a slab, a housing or a cap. */
  readonly fill: string;
  /** Outlines and the bezel. */
  readonly edge: string;
  /** Light edge of a slab and the highlight of a cap. */
  readonly light: string;
  /** The purple of the wall and floor diamond, and the dots of the gray button. */
  readonly accent: string;
  /** The lit lever knob of a switch that is on. */
  readonly lit: string;
}

export interface WiredOptions {
  /** Round the line widths to whole pixels (the pixel-art styles). */
  readonly crisp?: boolean;
  /** Soft glow around a lit element (the neon styles). */
  readonly glow?: string;
}

const TAU = Math.PI * 2;
const HALF = 0.5;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;
/** Slab: inset from the cell, bevel width, corner radius, diamond half diagonal and line width, in tiles. */
const SLAB = { inset: 0.04, bevel: 0.07, diamond: 0.22, line: 0.05 } as const;
/** Dash and gap of the ghost outline of a purple floor, in tiles. */
const GHOST = { inset: 0.12, dash: 0.1, gap: 0.07, line: 0.05, diamond: 0.14, alpha: 0.9 } as const;
/** Housing of a toggle switch: half side and corner radius; the lever: pivot height, tip offsets, widths; in tiles. */
const SWITCH = {
  housingHalf: 0.34,
  corner: 0.1,
  housingLine: 0.06,
  pivotY: 0.62,
  tipX: 0.16,
  tipY: 0.34,
  leverLine: 0.07,
  knob: 0.085,
  glowBlur: 0.1
} as const;
/** Round buttons: bezel radius, cap radius, line widths and the highlight arc, in tiles. */
const BUTTON = { bezel: 0.36, cap: 0.24, bezelLine: 0.06, capLine: 0.04, highlight: 0.16, highlightLine: 0.04 } as const;
/** The four dots of the gray button: distance from the centre and radius, in tiles. */
const AREA_DOT = { offset: 0.3, radius: 0.045 } as const;
/** Angle span of the cap highlight, in radians. */
const HIGHLIGHT_START = Math.PI * 1.1;
const HIGHLIGHT_END = Math.PI * 1.6;

function lineWidth(size: number, tiles: number, crisp: boolean): number {
  const raw = size * tiles;
  return Math.max(MIN_LINE_PX, crisp ? Math.round(raw) : raw);
}

/** Traces a diamond centred on (cx, cy) with the given half diagonal. */
function traceDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, half: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx + half, cy);
  ctx.lineTo(cx, cy + half);
  ctx.lineTo(cx - half, cy);
  ctx.closePath();
}

/** Traces a rounded square around (cx, cy). */
function traceRoundedSquare(ctx: CanvasRenderingContext2D, cx: number, cy: number, half: number, corner: number): void {
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

/** The solid purple wall: a slab with a light top-left edge, a dark bottom-right edge and an accent diamond. */
function paintSlab(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: WiredColours, crisp: boolean): void {
  const inset = size * SLAB.inset;
  const side = size - inset * 2;
  const bevel = Math.max(MIN_LINE_PX, size * SLAB.bevel);
  ctx.fillStyle = colours.edge;
  ctx.fillRect(x + inset, y + inset, side, side);
  ctx.fillStyle = colours.fill;
  ctx.fillRect(x + inset + bevel, y + inset + bevel, side - bevel * 2, side - bevel * 2);
  ctx.fillStyle = colours.light;
  ctx.fillRect(x + inset, y + inset, side, bevel);
  ctx.fillRect(x + inset, y + inset, bevel, side);
  ctx.strokeStyle = colours.accent;
  ctx.lineWidth = lineWidth(size, SLAB.line, crisp);
  traceDiamond(ctx, x + size * HALF, y + size * HALF, size * SLAB.diamond);
  ctx.stroke();
}

/** The purple floor: the dashed ghost of the slab and a small diamond, so it reads as a wall that is down. */
function paintGhost(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: WiredColours, crisp: boolean): void {
  const inset = size * GHOST.inset;
  ctx.strokeStyle = colours.accent;
  ctx.lineWidth = lineWidth(size, GHOST.line, crisp);
  ctx.setLineDash([Math.max(MIN_LINE_PX, size * GHOST.dash), Math.max(MIN_LINE_PX, size * GHOST.gap)]);
  ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  ctx.setLineDash([]);
  traceDiamond(ctx, x + size * HALF, y + size * HALF, size * GHOST.diamond);
  ctx.globalAlpha = GHOST.alpha;
  ctx.stroke();
}

/** The toggle switch: a rounded housing with a lever that leans left (off) or right (on), the knob lit when on. */
function paintSwitch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  on: boolean,
  colours: WiredColours,
  options: WiredOptions
): void {
  const crisp = options.crisp === true;
  const cx = x + size * HALF;
  const cy = y + size * HALF;
  traceRoundedSquare(ctx, cx, cy, size * SWITCH.housingHalf, size * SWITCH.corner);
  ctx.fillStyle = colours.fill;
  ctx.fill();
  ctx.strokeStyle = colours.edge;
  ctx.lineWidth = lineWidth(size, SWITCH.housingLine, crisp);
  ctx.stroke();
  const pivotX = cx;
  const pivotY = y + size * SWITCH.pivotY;
  const tipX = cx + (on ? 1 : -1) * size * SWITCH.tipX;
  const tipY = y + size * SWITCH.tipY;
  ctx.strokeStyle = colours.light;
  ctx.lineWidth = lineWidth(size, SWITCH.leverLine, crisp);
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  if (on && options.glow !== undefined) {
    ctx.shadowColor = options.glow;
    ctx.shadowBlur = size * SWITCH.glowBlur;
  }
  ctx.fillStyle = on ? colours.lit : colours.accent;
  ctx.beginPath();
  ctx.arc(tipX, tipY, Math.max(MIN_LINE_PX, size * SWITCH.knob), 0, TAU);
  ctx.fill();
}

/** A round button: the bezel, a cap and the highlight arc. The gray pulse button adds four dots at the corners of its reach. */
function paintRoundButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colours: WiredColours,
  area: boolean,
  crisp: boolean
): void {
  const cx = x + size * HALF;
  const cy = y + size * HALF;
  ctx.fillStyle = colours.edge;
  ctx.beginPath();
  ctx.arc(cx, cy, size * BUTTON.bezel, 0, TAU);
  ctx.fill();
  ctx.fillStyle = colours.fill;
  ctx.strokeStyle = colours.light;
  ctx.lineWidth = lineWidth(size, BUTTON.capLine, crisp);
  ctx.beginPath();
  ctx.arc(cx, cy, size * BUTTON.cap, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = lineWidth(size, BUTTON.highlightLine, crisp);
  ctx.beginPath();
  ctx.arc(cx, cy, size * BUTTON.highlight, HIGHLIGHT_START, HIGHLIGHT_END);
  ctx.stroke();
  if (!area) return;
  ctx.fillStyle = colours.accent;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ctx.beginPath();
    ctx.arc(cx + sx * size * AREA_DOT.offset, cy + sy * size * AREA_DOT.offset, Math.max(MIN_LINE_PX, size * AREA_DOT.radius), 0, TAU);
    ctx.fill();
  }
}

/** Draws a wired device over the floor already painted in the cell at (x, y). */
export function paintWiredDevice(
  ctx: CanvasRenderingContext2D,
  shape: WiredShape,
  x: number,
  y: number,
  size: number,
  colours: WiredColours,
  options: WiredOptions = {}
): void {
  const crisp = options.crisp === true;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (shape) {
    case 'purple_wall':
      paintSlab(ctx, x, y, size, colours, crisp);
      break;
    case 'purple_floor':
      paintGhost(ctx, x, y, size, colours, crisp);
      break;
    case 'switch_off':
      paintSwitch(ctx, x, y, size, false, colours, options);
      break;
    case 'switch_on':
      paintSwitch(ctx, x, y, size, true, colours, options);
      break;
    case 'black_button':
      paintRoundButton(ctx, x, y, size, colours, false, crisp);
      break;
    case 'gray_button':
      paintRoundButton(ctx, x, y, size, colours, true, crisp);
      break;
  }
  ctx.restore();
}
