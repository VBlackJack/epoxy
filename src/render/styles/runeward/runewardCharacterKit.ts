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
 * Drawing kit of the Runeward characters: colour arithmetic, the "look" a figure is drawn with
 * (unit space of 100 by 100, outline, tone) and the shape helpers the three figures share. The figures
 * are drawn in a 0..100 square scaled to the cell, so a proportion here is a percentage of the cell.
 */

import type { RunewardArtConfig, RunewardBootsKind } from '../../../core/types';
import { parseCssColour } from '../retroHdPalette';

type Art = Readonly<RunewardArtConfig>;

/** Side of the unit square the figures are drawn in. */
export const UNIT = 100;
export const TAU = Math.PI * 2;
/** Outline width of the figures in unit space, and the thinnest outline drawn in pixels. */
const OUTLINE_UNITS = 2.2;
const OUTLINE_UNITS_INK = 2.8;
const OUTLINE_MIN_PX = 1.1;
/** Extra width of the outline of a line (staff, hook) over the line itself, in outline widths. */
const LINE_OUTLINE_GROWTH = 1.6;
/** Where the core of a glow gives way to its mid tone, as a fraction of its radius. */
const GLOW_CORE_STOP = 0.4;
const CHANNEL_MAX = 255;

// ---- Colour arithmetic ------------------------------------------------------------------------

function format(rgb: readonly [number, number, number], alpha: string | null): string {
  const [r, g, b] = rgb.map((v) => Math.max(0, Math.min(CHANNEL_MAX, Math.round(v))));
  if (alpha === null) return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The colour with every channel multiplied by `k`; a colour this cannot read is returned as is. */
export function shade(colour: string, k: number): string {
  const parsed = parseCssColour(colour);
  if (!parsed) return colour;
  return format([parsed.rgb[0] * k, parsed.rgb[1] * k, parsed.rgb[2] * k], parsed.alpha);
}

/** `top` laid over `bottom` with the given coverage; the alpha of `bottom` is kept. */
export function mixColours(bottom: string, top: string, coverage: number): string {
  const a = parseCssColour(bottom);
  const b = parseCssColour(top);
  if (!a || !b) return bottom;
  const channel = (i: number): number => a.rgb[i] + (b.rgb[i] - a.rgb[i]) * coverage;
  return format([channel(0), channel(1), channel(2)], a.alpha);
}

/** The colour at the given opacity (0..1), whatever opacity it had. */
export function withAlpha(colour: string, alpha: number): string {
  const parsed = parseCssColour(colour);
  if (!parsed) return colour;
  return format(parsed.rgb, String(alpha));
}

// ---- The look of a figure ---------------------------------------------------------------------

/** What a figure is drawn with: the context in unit space, the colours and the outline. */
export interface Look {
  readonly ctx: CanvasRenderingContext2D;
  readonly art: Art;
  /** Pixels per unit. */
  readonly unit: number;
  /** Outline colour and width (in units). */
  readonly out: string;
  readonly lw: number;
  /** Wood and gold: the ink colours on Parchment, the palette ones elsewhere. */
  readonly wood: string;
  readonly gold: string;
  /** True when the style draws an ink line (Parchment). */
  readonly inked: boolean;
  /** Maps a palette colour to the one drawn: the identity while the figure is alive, a tint on a death. */
  readonly c: (colour: string) => string;
}

/** Builds the look of a figure for a cell of `size` pixels. */
export function makeLook(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  tone: (colour: string) => string = (colour) => colour
): Look {
  const unit = size / UNIT;
  const ink = art.ink;
  const base = ink ? OUTLINE_UNITS_INK : OUTLINE_UNITS;
  return {
    ctx,
    art,
    unit,
    out: tone(ink ? ink.line : art.character.outline),
    lw: Math.max(OUTLINE_MIN_PX / unit, base),
    wood: tone(ink ? ink.wood : art.mage.staff),
    gold: tone(ink ? ink.gold : art.mage.band),
    inked: ink !== undefined,
    c: tone
  };
}

// ---- Shapes -----------------------------------------------------------------------------------

export type Point = readonly [number, number];

function lerpPoint(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Fills the current path, then outlines it unless `stroke` is false. */
export function fillStroke(L: Look, fill: string | CanvasGradient, stroke = true): void {
  const { ctx } = L;
  ctx.fillStyle = typeof fill === 'string' ? L.c(fill) : fill;
  ctx.fill();
  if (!stroke) return;
  ctx.strokeStyle = L.out;
  ctx.lineWidth = L.lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

export function ell(L: Look, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, stroke = true): void {
  L.ctx.beginPath();
  L.ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  fillStroke(L, fill, stroke);
}

/** A filled polygon; with `round` above 0 the corners are rounded by that fraction of their edges. */
export function poly(L: Look, pts: readonly Point[], fill: string | CanvasGradient, stroke = true, round = 0): void {
  const { ctx } = L;
  ctx.beginPath();
  if (round === 0) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  } else {
    const n = pts.length;
    for (let i = 0; i < n; i += 1) {
      const before = pts[(i + n - 1) % n];
      const here = pts[i];
      const after = pts[(i + 1) % n];
      const a = lerpPoint(here, before, round);
      const b = lerpPoint(here, after, round);
      if (i === 0) ctx.moveTo(a[0], a[1]);
      else ctx.lineTo(a[0], a[1]);
      ctx.quadraticCurveTo(here[0], here[1], b[0], b[1]);
    }
  }
  ctx.closePath();
  fillStroke(L, fill, stroke);
}

export function dot(L: Look, x: number, y: number, r: number, colour: string): void {
  L.ctx.fillStyle = L.c(colour);
  L.ctx.beginPath();
  L.ctx.arc(x, y, r, 0, TAU);
  L.ctx.fill();
}

export function hgrad(L: Look, x0: number, x1: number, a: string, b: string): CanvasGradient {
  const gradient = L.ctx.createLinearGradient(x0, 0, x1, 0);
  gradient.addColorStop(0, L.c(a));
  gradient.addColorStop(1, L.c(b));
  return gradient;
}

export function vgrad(L: Look, y0: number, y1: number, a: string, b: string): CanvasGradient {
  const gradient = L.ctx.createLinearGradient(0, y0, 0, y1);
  gradient.addColorStop(0, L.c(a));
  gradient.addColorStop(1, L.c(b));
  return gradient;
}

/** A soft round glow: `core` in the middle, `mid` further out, then clear. */
export function glow(L: Look, x: number, y: number, r: number, core: string, mid: string): void {
  const { ctx } = L;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, L.c(core));
  gradient.addColorStop(GLOW_CORE_STOP, L.c(mid));
  gradient.addColorStop(1, L.art.clear);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** A round-capped line of width `w`, with an outline under it unless told otherwise. */
export function line(L: Look, x0: number, y0: number, x1: number, y1: number, colour: string, w: number, outline = true): void {
  const { ctx } = L;
  ctx.lineCap = 'round';
  if (outline) {
    ctx.strokeStyle = L.out;
    ctx.lineWidth = w + L.lw * LINE_OUTLINE_GROWTH;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.strokeStyle = L.c(colour);
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

// ---- Boots ------------------------------------------------------------------------------------

/** Height of the dark sole band of a boot, and its distance above the boot's bottom. */
const SOLE_BAND = 2.2;
const SOLE_BAND_OFFSET = 3;
/** Rise of a boot's mark (spike, flame, drop) above its top, in units. */
const MARK_RISE = 6;
const DARK_BOOT_FACTOR = 0.6;

/**
 * One boot. `kind` is the magic boots worn (drawn in the colours of the boots item and with a mark
 * of their own), or null for the plain leather ones. `flip` is 1 for a profile boot (toe to the right).
 */
export function boot(L: Look, x: number, y: number, w: number, h: number, kind: RunewardBootsKind | null, flip = 1): void {
  const { ctx, art } = L;
  const colours = kind ? art.item.boots[kind] : null;
  const main = colours ? colours.main : art.character.leather;
  const dark = colours ? shade(colours.main, DARK_BOOT_FACTOR) : art.character.leatherDark;
  poly(
    L,
    [
      [x - w / 2, y - h],
      [x + w / 2, y - h],
      [x + w / 2 + flip * 2, y],
      [x - w / 2 + flip * 2, y]
    ],
    main,
    true,
    0.3
  );
  ctx.fillStyle = L.c(dark);
  ctx.fillRect(x - w / 2 + 1, y - SOLE_BAND_OFFSET, w - 2 + flip * 2, SOLE_BAND);
  if (!colours || !kind) return;
  const light = L.c(colours.light);
  const top = y - h;
  const offsets = [-w * 0.25, w * 0.25];
  ctx.strokeStyle = L.out;
  ctx.lineWidth = L.lw * 0.6;
  ctx.lineJoin = 'round';
  ctx.fillStyle = light;
  switch (kind) {
    case 'ice':
      // Two crystal spikes.
      for (const dx of offsets) {
        ctx.beginPath();
        ctx.moveTo(x + dx - 2, top);
        ctx.lineTo(x + dx, top - MARK_RISE);
        ctx.lineTo(x + dx + 2, top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'fire':
      // Two small flames.
      ctx.strokeStyle = L.c(colours.main);
      ctx.lineWidth = L.lw * 0.5;
      for (const dx of offsets) {
        ctx.beginPath();
        ctx.moveTo(x + dx - 2.2, top);
        ctx.quadraticCurveTo(x + dx - 1, top - MARK_RISE * 0.7, x + dx, top - MARK_RISE * 1.3);
        ctx.quadraticCurveTo(x + dx + 1, top - MARK_RISE * 0.7, x + dx + 2.2, top);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'water':
      // Two drops.
      for (const dx of offsets) {
        ctx.beginPath();
        ctx.moveTo(x + dx, top - MARK_RISE);
        ctx.quadraticCurveTo(x + dx + 3, top - MARK_RISE * 0.3, x + dx, top);
        ctx.quadraticCurveTo(x + dx - 3, top - MARK_RISE * 0.3, x + dx, top - MARK_RISE);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'force':
      // A chevron on the toe cap.
      ctx.strokeStyle = light;
      ctx.lineWidth = L.lw * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - w * 0.22, top + h * 0.2);
      ctx.lineTo(x, top + h * 0.55);
      ctx.lineTo(x + w * 0.22, top + h * 0.2);
      ctx.stroke();
      break;
    case 'speed':
      // A bolt stripe.
      ctx.strokeStyle = light;
      ctx.lineWidth = L.lw * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - w * 0.2, top + 0.5);
      ctx.lineTo(x + w * 0.05, top + h * 0.45);
      ctx.lineTo(x - w * 0.05, top + h * 0.45);
      ctx.lineTo(x + w * 0.2, y - 3.5);
      ctx.stroke();
      break;
    case 'eye':
      dot(L, x, top + h * 0.4, 1.8, colours.light);
      break;
    default:
      // Pull and ward: a light cuff.
      ctx.fillRect(x - w / 2 + 1, top, w - 2 + flip * 2, 1.6);
  }
}

// ---- What a figure is asked to draw -----------------------------------------------------------

/** The part of the pose a figure draws: a profile faces east (west is the mirror), N is the back. */
export interface FigureState {
  /** True for the profile views (east, and west mirrored). */
  readonly profile: boolean;
  /** True when seen from behind. */
  readonly back: boolean;
  /** 0 standing, 1 or 2 for the two strides. */
  readonly frame: number;
  /** Arms held out to the sides: the skating pose. */
  readonly armsOut: boolean;
  /** Boots on the left and right foot; null is a plain leather boot. */
  readonly feet: readonly [RunewardBootsKind | null, RunewardBootsKind | null];
  /** True when magic boots are worn (the hem lifts to show them). */
  readonly booted: boolean;
}

/** Draws a figure into the 0..100 unit square of the look. */
export type Figure = (L: Look, st: FigureState) => void;

/** Sway of the body per stride, in units. */
export const STRIDE_SWAY = 0.6;
/** Lift of a raised foot in a front or back stride, and of the rear foot in a profile stride, in units. */
export const STEP_LIFT = 3.5;
export const PROFILE_STEP_LIFT = 3;
/** Fore and aft spread of the feet in a profile stride, in units. */
export const PROFILE_STEP_SPREAD = 6;

/** Sign of the stride of a frame: 0 standing, 1 and -1 for the two strides. */
export function strideOf(frame: number): number {
  return frame === 0 ? 0 : frame === 1 ? 1 : -1;
}
