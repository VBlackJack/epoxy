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
 * Pure painters of the colour mechanisms in the Runeward render style: locked doors, hold doors (portcullis),
 * toggle slabs, pressure plates, buttons, keys and the chip. Like the painters in runewardPainters.ts each
 * draws into the square from (0, 0) to (size, size) from the Runeward art config, in the plain drawing or,
 * when the art block has an ink section, as pigment washes with ink lines. Every colour mark carries the
 * colour-blind glyph of its channel, so colour is never the only cue. The proportions below are the drawings
 * themselves, the way pixel art is data: they are art, not settings.
 */

import type { RunewardArtConfig, RunewardChannelColours, RunewardInkConfig, RunewardKeyColour } from '../../../core/types';
import { paintColorGlyph } from '../../colorGlyph';
import type { TileNeighbours } from '../../tileNeighbours';
import { hasInkHatching, heavyLineWidth, inkLineWidth, paintHatching, paintVerticalHatching } from './runewardInk';
import { linear, paintFloor, radial, roundRect, tracePolygon, wave } from './runewardPainters';

type Art = Readonly<RunewardArtConfig>;
type Neighbours = Readonly<TileNeighbours>;
type Ink = Readonly<RunewardInkConfig>;

const TAU = Math.PI * 2;
/** Middle of the cell, as a fraction of its size. */
const HALF = 0.5;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;
/** Thinnest key outline drawn, in pixels. */
const MIN_KEY_LINE_PX = 1.5;
/** Opacity of a line or mark that is only a trace of what is not there. */
const GHOST_ALPHA = 0.55;
/** Opacity of the tint inside the outline of an open door. */
const OPEN_TINT_ALPHA = 0.16;

// ---- Locked door ------------------------------------------------------------------------------

const LOCK = {
  inset: 0.08,
  corner: 0.08,
  /** Where the light edge of the wash fades into its main colour. */
  lightStop: 0.25,
  highlightWidth: 0.03,
  glyphY: 0.34,
  glyphRadius: 0.15,
  keyholeY: 0.6,
  keyholeRadius: 0.07,
  shaftHalfWidth: 0.03,
  shaftLength: 0.16,
  /** Hatched strip along the foot of an ink door. */
  hatchTop: 0.8,
  hatchHeight: 0.12
} as const;

/** A locked door of a colour: a metal frame around a coloured panel, the glyph above the keyhole. */
export function paintLock(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  colour: RunewardKeyColour,
  neighbours: Neighbours
): void {
  const tint = art.keys[colour];
  ctx.fillStyle = art.door.frame;
  ctx.fillRect(0, 0, size, size);
  const inset = size * LOCK.inset;
  ctx.fillStyle = linear(ctx, 0, inset, 0, size - inset, [[0, tint.light], [LOCK.lightStop, tint.main], [1, tint.main]]);
  roundRect(ctx, inset, inset, size - inset * 2, size - inset * 2, size * LOCK.corner);
  ctx.fill();
  if (art.ink) {
    ctx.strokeStyle = art.ink.line;
    ctx.lineWidth = inkLineWidth(size);
    ctx.stroke();
    ctx.strokeRect(0, 0, size, size);
    if (hasInkHatching(size)) {
      const strip = { x: inset, y: size * LOCK.hatchTop, w: size - inset * 2, h: size * LOCK.hatchHeight };
      paintVerticalHatching(ctx, size, neighbours, strip, art.ink.hatch);
    }
  } else {
    ctx.strokeStyle = tint.light;
    ctx.lineWidth = Math.max(MIN_LINE_PX, size * LOCK.highlightWidth);
    ctx.beginPath();
    ctx.moveTo(inset + size * LOCK.corner, inset + ctx.lineWidth);
    ctx.lineTo(size - inset - size * LOCK.corner, inset + ctx.lineWidth);
    ctx.stroke();
  }
  ctx.fillStyle = art.door.keyhole;
  ctx.beginPath();
  ctx.arc(size * HALF, size * LOCK.keyholeY, size * LOCK.keyholeRadius, 0, TAU);
  ctx.fill();
  ctx.fillRect(
    size * (HALF - LOCK.shaftHalfWidth),
    size * LOCK.keyholeY,
    size * LOCK.shaftHalfWidth * 2,
    size * LOCK.shaftLength
  );
  paintColorGlyph(ctx, colour, size * HALF, size * LOCK.glyphY, size * LOCK.glyphRadius, tint.glyph);
}

// ---- Hold door --------------------------------------------------------------------------------

const GATE = {
  lintelHeight: 0.22,
  postWidth: 0.1,
  barCount: 4,
  barFirstX: 0.2,
  barStepX: 0.2,
  barHalfWidth: 0.04,
  barTop: 0.22,
  barClosedLength: 0.7,
  barOpenLength: 0.12,
  crossbarTop: 0.55,
  crossbarHeight: 0.06,
  lintelLightStop: 0.2,
  glyphY: 0.11,
  glyphRadius: 0.075,
  /** Depth of the shadow the lintel casts on the floor, in tiles. */
  shadowReach: 0.14
} as const;

/** The shadow under the lintel: hatching in ink, a flat wash on tiles too small to hatch. */
function paintGateShadow(ctx: CanvasRenderingContext2D, size: number, art: Art, ink: Ink, neighbours: Neighbours): void {
  const rect = { x: size * GATE.postWidth, y: size * GATE.lintelHeight, w: size * (1 - GATE.postWidth * 2), h: size * GATE.shadowReach };
  if (hasInkHatching(size)) {
    paintHatching(ctx, size, neighbours, rect, ink.hatch);
    return;
  }
  ctx.fillStyle = art.shadow.color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

/**
 * A portcullis in a coloured lintel: bars down while the door is closed, raised into the lintel while it is
 * open, so the floor shows through between them either way.
 */
export function paintGate(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  colour: RunewardKeyColour,
  open: boolean,
  neighbours: Neighbours
): void {
  const tint = art.keys[colour];
  const { ink } = art;
  paintFloor(ctx, size, art, neighbours);
  if (ink) paintGateShadow(ctx, size, art, ink, neighbours);
  const post = size * GATE.postWidth;
  ctx.fillStyle = art.gate.frame;
  ctx.fillRect(0, 0, post, size);
  ctx.fillRect(size - post, 0, post, size);
  const barLength = size * (open ? GATE.barOpenLength : GATE.barClosedLength);
  const barTop = size * GATE.barTop;
  const halfWidth = size * GATE.barHalfWidth;
  for (let i = 0; i < GATE.barCount; i += 1) {
    const x = size * (GATE.barFirstX + i * GATE.barStepX);
    ctx.fillStyle = linear(ctx, x - halfWidth, 0, x + halfWidth, 0, [[0, art.gate.bar], [HALF, art.gate.barLight], [1, art.gate.bar]]);
    ctx.fillRect(x - halfWidth, barTop, halfWidth * 2, barLength);
    if (ink) {
      ctx.strokeStyle = ink.line;
      ctx.lineWidth = inkLineWidth(size);
      ctx.strokeRect(x - halfWidth, barTop, halfWidth * 2, barLength);
    }
  }
  if (!open) {
    ctx.fillStyle = art.gate.bar;
    ctx.fillRect(post, size * GATE.crossbarTop, size - post * 2, size * GATE.crossbarHeight);
    if (ink) {
      ctx.strokeStyle = ink.line;
      ctx.lineWidth = inkLineWidth(size);
      ctx.strokeRect(post, size * GATE.crossbarTop, size - post * 2, size * GATE.crossbarHeight);
    }
  }
  ctx.fillStyle = linear(ctx, 0, 0, 0, size * GATE.lintelHeight, [[0, tint.light], [GATE.lintelLightStop, tint.main], [1, tint.main]]);
  ctx.fillRect(0, 0, size, size * GATE.lintelHeight);
  if (ink) {
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    ctx.strokeRect(0, 0, size, size * GATE.lintelHeight);
    ctx.strokeRect(0, 0, post, size);
    ctx.strokeRect(size - post, 0, post, size);
  }
  paintColorGlyph(ctx, colour, size * HALF, size * GATE.glyphY, size * GATE.glyphRadius, tint.glyph);
}

// ---- Toggle slab ------------------------------------------------------------------------------

const SLAB = {
  inset: 0.06,
  topHeight: 0.68,
  frontHeight: 0.2,
  edgeWidth: 0.025,
  edgeAlpha: 0.5,
  lineWidth: 0.03,
  /** The coloured panel in the middle of the raised top. */
  panelHalf: 0.23,
  panelCorner: 0.05,
  panelCy: 0.4,
  glyphRadius: 0.13,
  /** Open outline: inset, corner and dash lengths (tiles). */
  ghostInset: 0.1,
  ghostCorner: 0.06,
  ghostDash: 0.1,
  ghostGap: 0.08,
  ghostLineWidth: 0.04
} as const;

/** A closed toggle wall: a raised stone slab from the wall tones with a coloured panel and its glyph. */
function paintClosedSlab(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  colour: RunewardKeyColour,
  neighbours: Neighbours
): void {
  const { wall, ink } = art;
  const tint = art.keys[colour];
  const left = size * SLAB.inset;
  const width = size * (1 - SLAB.inset * 2);
  const topHeight = size * SLAB.topHeight;
  const frontHeight = size * SLAB.frontHeight;
  const frontTop = left + topHeight;
  ctx.fillStyle = linear(ctx, 0, left, 0, frontTop, [[0, wall.topLight], [1, wall.top]]);
  ctx.fillRect(left, left, width, topHeight);
  ctx.fillStyle = linear(ctx, 0, frontTop, 0, frontTop + frontHeight, [[0, wall.front], [1, wall.frontDark]]);
  ctx.fillRect(left, frontTop, width, frontHeight);
  if (ink) {
    if (hasInkHatching(size)) {
      paintVerticalHatching(ctx, size, neighbours, { x: left, y: frontTop, w: width, h: frontHeight }, ink.line);
    }
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = heavyLineWidth(size);
    ctx.strokeRect(left, left, width, topHeight + frontHeight);
    ctx.lineWidth = inkLineWidth(size);
    ctx.beginPath();
    ctx.moveTo(left, frontTop);
    ctx.lineTo(left + width, frontTop);
    ctx.stroke();
  } else {
    ctx.fillStyle = wall.edge;
    ctx.globalAlpha = SLAB.edgeAlpha;
    ctx.fillRect(left, frontTop, width, Math.max(MIN_LINE_PX, size * SLAB.edgeWidth));
    ctx.globalAlpha = 1;
  }
  const half = size * SLAB.panelHalf;
  ctx.fillStyle = tint.main;
  roundRect(ctx, size * HALF - half, size * SLAB.panelCy - half, half * 2, half * 2, size * SLAB.panelCorner);
  ctx.fill();
  ctx.strokeStyle = ink ? ink.line : wall.topDark;
  ctx.lineWidth = ink ? inkLineWidth(size) : Math.max(MIN_LINE_PX, size * SLAB.lineWidth);
  ctx.stroke();
  paintColorGlyph(ctx, colour, size * HALF, size * SLAB.panelCy, size * SLAB.glyphRadius, tint.glyph);
}

/** An open toggle wall: only a dashed outline and the ghost of the glyph, over the floor. */
function paintOpenSlab(ctx: CanvasRenderingContext2D, size: number, art: Art, colour: RunewardKeyColour): void {
  const tint = art.keys[colour];
  const { ink } = art;
  const inset = size * SLAB.ghostInset;
  ctx.save();
  roundRect(ctx, inset, inset, size - inset * 2, size - inset * 2, size * SLAB.ghostCorner);
  ctx.fillStyle = tint.main;
  ctx.globalAlpha = OPEN_TINT_ALPHA;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ink ? ink.line : tint.main;
  ctx.lineWidth = ink ? inkLineWidth(size) : Math.max(MIN_LINE_PX, size * SLAB.ghostLineWidth);
  ctx.setLineDash([size * SLAB.ghostDash, size * SLAB.ghostGap]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = GHOST_ALPHA;
  paintColorGlyph(ctx, colour, size * HALF, size * HALF, size * SLAB.glyphRadius, ink ? tint.glyph : tint.main);
  ctx.restore();
}

/** A toggle wall of a colour (the plain one is green): a raised slab when closed, a dashed ghost when open. */
export function paintToggleSlab(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  colour: RunewardKeyColour,
  open: boolean,
  neighbours: Neighbours
): void {
  paintFloor(ctx, size, art, neighbours);
  if (open) paintOpenSlab(ctx, size, art, colour);
  else paintClosedSlab(ctx, size, art, colour, neighbours);
}

// ---- Plates and buttons -----------------------------------------------------------------------

const PLATE = {
  inset: 0.16,
  corner: 0.08,
  faceInset: 0.06,
  faceCorner: 0.05,
  pressDrop: 0.02,
  highlightHeight: 0.04,
  pressedAlpha: 0.35,
  glyphRadius: 0.12
} as const;

/** The pad shared by plates and buttons: a rim around a face; a pressed pad sits lower and darker. */
function paintPad(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  faceColour: string,
  pressed: boolean
): void {
  const { plate, ink } = art;
  const inset = size * PLATE.inset;
  ctx.fillStyle = plate.rim;
  roundRect(ctx, inset, inset, size - inset * 2, size - inset * 2, size * PLATE.corner);
  ctx.fill();
  if (ink) {
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    ctx.stroke();
  }
  const inner = inset + size * PLATE.faceInset;
  const drop = pressed ? size * PLATE.pressDrop : 0;
  ctx.fillStyle = faceColour;
  roundRect(ctx, inner, inner + drop, size - inner * 2, size - inner * 2, size * PLATE.faceCorner);
  ctx.fill();
  if (pressed) {
    ctx.fillStyle = plate.pressed;
    ctx.globalAlpha = PLATE.pressedAlpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (ink) {
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    ctx.stroke();
  }
  if (!pressed) {
    ctx.fillStyle = plate.highlight;
    ctx.fillRect(inner, inner, size - inner * 2, size * PLATE.highlightHeight);
  }
}

/** A pressure plate: a pad sunk into the floor with its face in the channel colour and the glyph on it. */
export function paintPressurePlate(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  colour: RunewardKeyColour,
  neighbours: Neighbours,
  pressed = false
): void {
  const tint = art.keys[colour];
  paintFloor(ctx, size, art, neighbours);
  paintPad(ctx, size, art, tint.main, pressed);
  paintColorGlyph(ctx, colour, size * HALF, size * HALF + (pressed ? size * PLATE.pressDrop : 0), size * PLATE.glyphRadius, tint.glyph);
}

/** What a button does, which decides the mark on its stud. */
export type RunewardButtonKind =
  | { readonly kind: 'colour'; readonly colour: RunewardKeyColour }
  | { readonly kind: 'toggle'; readonly colour: RunewardKeyColour }
  | { readonly kind: 'jaw' }
  /** The flame button (flame rune) and the swap button (swap rune); `glyphKey` is the colour key the game gives the tile. */
  | { readonly kind: 'flame'; readonly glyphKey: string }
  | { readonly kind: 'swap'; readonly glyphKey: string };

const BUTTON = {
  studRadius: 0.2,
  studLightX: -0.05,
  studLightY: -0.06,
  glyphRadius: 0.1,
  toggleGlyphRadius: 0.06,
  /** The two opposed arrow heads of a toggle button: tip and base distance from the middle, and half height. */
  arrowTip: 0.17,
  arrowBase: 0.1,
  arrowHalf: 0.055,
  /** The zigzag jaw of the trap button: teeth, half length and half height. */
  jawTeeth: 4,
  jawHalfLength: 0.12,
  jawHalfHeight: 0.045,
  jawLineWidth: 0.04,
  /** The rune of the flame and swap buttons: half extent, line width and the flame's inner cut. */
  runeHalf: 0.13,
  runeLineWidth: 0.04,
  flameWaist: 0.1,
  flameCut: 0.5,
  swapHalfWidth: 0.12,
  swapRowOffset: 0.05,
  swapHeadLength: 0.06,
  swapHeadHalf: 0.04,
  /** The colour-blind glyph of those two buttons sits in the corner of the pad, clear of the stud. */
  cornerGlyphX: 0.3,
  cornerGlyphY: 0.3,
  cornerGlyphRadius: 0.05
} as const;

/** The flame rune: a teardrop of fire on the stud, with a lit cut in its heart. */
function paintFlameRune(ctx: CanvasRenderingContext2D, size: number, fill: string, cut: string): void {
  const c = size * HALF;
  const h = size * BUTTON.runeHalf;
  const w = size * BUTTON.flameWaist;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(c, c - h);
  ctx.bezierCurveTo(c + w, c - h * BUTTON.flameCut, c + w, c + h, c, c + h);
  ctx.bezierCurveTo(c - w, c + h, c - w, c - h * BUTTON.flameCut, c, c - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = cut;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.bezierCurveTo(c + w * BUTTON.flameCut, c + h * BUTTON.flameCut, c + w * BUTTON.flameCut, c + h, c, c + h);
  ctx.bezierCurveTo(c - w * BUTTON.flameCut, c + h, c - w * BUTTON.flameCut, c + h * BUTTON.flameCut, c, c);
  ctx.closePath();
  ctx.fill();
}

/** The swap rune: two arrows running in opposite directions. */
function paintSwapRune(ctx: CanvasRenderingContext2D, size: number, stroke: string): void {
  const c = size * HALF;
  const half = size * BUTTON.swapHalfWidth;
  const row = size * BUTTON.swapRowOffset;
  const head = size * BUTTON.swapHeadLength;
  const headHalf = size * BUTTON.swapHeadHalf;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * BUTTON.runeLineWidth);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c - half, c - row);
  ctx.lineTo(c + half - head, c - row);
  ctx.moveTo(c + half, c + row);
  ctx.lineTo(c - half + head, c + row);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c + half, c - row);
  ctx.lineTo(c + half - head, c - row - headHalf);
  ctx.lineTo(c + half - head, c - row + headHalf);
  ctx.closePath();
  ctx.moveTo(c - half, c + row);
  ctx.lineTo(c - half + head, c + row - headHalf);
  ctx.lineTo(c - half + head, c + row + headHalf);
  ctx.closePath();
  ctx.fill();
}

/** The two-way mark of a toggle button: an arrow head on each side of the glyph. */
function paintToggleNotch(ctx: CanvasRenderingContext2D, size: number, fill: string): void {
  const tip = size * BUTTON.arrowTip;
  const base = size * BUTTON.arrowBase;
  const half = size * BUTTON.arrowHalf;
  const centre = size * HALF;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(centre - tip, centre);
  ctx.lineTo(centre - base, centre - half);
  ctx.lineTo(centre - base, centre + half);
  ctx.closePath();
  ctx.moveTo(centre + tip, centre);
  ctx.lineTo(centre + base, centre - half);
  ctx.lineTo(centre + base, centre + half);
  ctx.closePath();
  ctx.fill();
}

/** The jaw mark of the trap button: a zigzag of teeth across the stud. */
function paintJaw(ctx: CanvasRenderingContext2D, size: number, stroke: string): void {
  const centre = size * HALF;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * BUTTON.jawLineWidth);
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (let i = 0; i <= BUTTON.jawTeeth; i += 1) {
    const px = centre + size * BUTTON.jawHalfLength * ((i / BUTTON.jawTeeth) * 2 - 1);
    const py = centre + size * BUTTON.jawHalfHeight * (i % 2 === 0 ? -1 : 1);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** Colours of a button stud: the key colour of its channel, the flame and swap colours, or none for the trap button. */
function buttonTint(art: Art, spec: RunewardButtonKind): Readonly<RunewardChannelColours> | null {
  if (spec.kind === 'jaw') return null;
  if (spec.kind === 'flame') return art.mark.button.orange;
  if (spec.kind === 'swap') return art.mark.button.gray;
  return art.keys[spec.colour];
}

/** A button: a neutral pad with a round stud. Coloured buttons carry their glyph, the trap button a jaw. */
export function paintButton(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  spec: RunewardButtonKind,
  neighbours: Neighbours
): void {
  const { plate, ink } = art;
  paintFloor(ctx, size, art, neighbours);
  paintPad(ctx, size, art, plate.face, false);
  const centre = size * HALF;
  const radius = size * BUTTON.studRadius;
  const tint = buttonTint(art, spec);
  const bodyColour = tint ? tint.main : plate.pressed;
  const lightColour = tint ? tint.light : plate.face;
  ctx.fillStyle = radial(ctx, centre + size * BUTTON.studLightX, centre + size * BUTTON.studLightY, radius * 2, [
    [0, lightColour],
    [1, bodyColour]
  ]);
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, TAU);
  ctx.fill();
  if (ink) {
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    ctx.stroke();
  }
  if (spec.kind === 'jaw') {
    paintJaw(ctx, size, ink ? ink.line : plate.rim);
    return;
  }
  if (spec.kind === 'flame' || spec.kind === 'swap') {
    const runeColour = ink ? ink.line : plate.rim;
    if (spec.kind === 'flame') paintFlameRune(ctx, size, runeColour, lightColour);
    else paintSwapRune(ctx, size, runeColour);
    paintColorGlyph(ctx, spec.glyphKey, size * BUTTON.cornerGlyphX, size * BUTTON.cornerGlyphY, size * BUTTON.cornerGlyphRadius, runeColour);
    return;
  }
  const glyphColour = art.keys[spec.colour].glyph;
  if (spec.kind === 'toggle') {
    paintToggleNotch(ctx, size, glyphColour);
    paintColorGlyph(ctx, spec.colour, centre, centre, size * BUTTON.toggleGlyphRadius, glyphColour);
    return;
  }
  paintColorGlyph(ctx, spec.colour, centre, centre, size * BUTTON.glyphRadius, glyphColour);
}

// ---- Key (item) -------------------------------------------------------------------------------

const KEY = {
  shadow: { x: 0.5, y: 0.78, rx: 0.24, ry: 0.06 },
  bow: { x: 0.34, y: 0.5, radius: 0.16 },
  shaft: { x: 0.45, dy: -0.05, w: 0.36, h: 0.1 },
  teeth: [{ x: 0.64, w: 0.07, h: 0.14 }, { x: 0.74, w: 0.07, h: 0.14 }],
  teethDy: 0.05,
  glyphRadius: 0.075,
  highlightRadius: 0.12,
  highlightFrom: Math.PI * 1.1,
  highlightTo: Math.PI * 1.6,
  highlightWidth: 0.03
} as const;

/**
 * A key of a colour, hovering: the bow is filled and carries the glyph. The hover follows the clock, which
 * the caller freezes at 0 under reduced motion, so a still key sits at its rest height.
 */
export function paintKeyItem(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  colour: RunewardKeyColour,
  timeMs: number
): void {
  const tint = art.keys[colour];
  const { ink } = art;
  ctx.fillStyle = art.mage.shadow;
  ctx.beginPath();
  ctx.ellipse(size * KEY.shadow.x, size * KEY.shadow.y, size * KEY.shadow.rx, size * KEY.shadow.ry, 0, 0, TAU);
  ctx.fill();
  const bob = Math.sin((timeMs / art.animation.bobPeriodMs) * TAU) * size * art.animation.bobAmplitude;
  ctx.save();
  ctx.translate(0, bob);
  const bowX = size * KEY.bow.x;
  const bowY = size * KEY.bow.y;
  const parts: readonly (readonly [number, number, number, number])[] = [
    [KEY.shaft.x, KEY.bow.y + KEY.shaft.dy, KEY.shaft.w, KEY.shaft.h],
    ...KEY.teeth.map((tooth): readonly [number, number, number, number] => [tooth.x, KEY.bow.y + KEY.teethDy, tooth.w, tooth.h])
  ];
  ctx.fillStyle = tint.main;
  ctx.beginPath();
  ctx.arc(bowX, bowY, size * KEY.bow.radius, 0, TAU);
  ctx.fill();
  for (const [px, py, pw, ph] of parts) ctx.fillRect(size * px, size * py, size * pw, size * ph);
  if (ink) {
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = Math.max(MIN_KEY_LINE_PX, inkLineWidth(size));
    ctx.lineJoin = 'round';
    ctx.stroke();
    for (const [px, py, pw, ph] of parts) ctx.strokeRect(size * px, size * py, size * pw, size * ph);
  } else {
    ctx.strokeStyle = tint.light;
    ctx.lineWidth = Math.max(MIN_LINE_PX, size * KEY.highlightWidth);
    ctx.beginPath();
    ctx.arc(bowX, bowY, size * KEY.highlightRadius, KEY.highlightFrom, KEY.highlightTo);
    ctx.stroke();
  }
  paintColorGlyph(ctx, colour, bowX, bowY, size * KEY.glyphRadius, tint.glyph);
  ctx.restore();
}

// ---- Chip (item) ------------------------------------------------------------------------------

const CHIP = {
  haloRadius: 0.5,
  haloAlpha: 0.25,
  haloPulse: 0.2,
  hexRadius: 0.3,
  hexSides: 6,
  rimWidth: 0.04,
  coreWidth: 0.05,
  coreAlpha: 0.6,
  corePulse: 0.4,
  /** The rune cut into the gem: a stroke down the middle and a short slant across it. */
  runeHalfHeight: 0.16,
  slantHalfWidth: 0.11,
  slantHalfHeight: 0.06
} as const;

/**
 * The chip: a hexagonal gem with a rune cut in it, pulsing with the clock (frozen at 0 under reduced motion).
 * In ink the gem is paper with a gold-leaf rim and the rune is drawn in ink.
 */
export function paintChipItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  const { rune, ink } = art;
  const pulse = wave(timeMs, art.animation.pulsePeriodMs);
  const centre = size * HALF;
  ctx.globalAlpha = CHIP.haloAlpha + pulse * CHIP.haloPulse;
  ctx.fillStyle = radial(ctx, centre, centre, size * CHIP.haloRadius, [[0, rune.halo], [1, rune.haloClear]]);
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  tracePolygon(ctx, centre, size * CHIP.hexRadius, CHIP.hexSides);
  ctx.fillStyle = rune.stone;
  ctx.fill();
  if (ink) {
    ctx.strokeStyle = ink.gold;
    ctx.lineWidth = heavyLineWidth(size);
    ctx.stroke();
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = inkLineWidth(size);
    tracePolygon(ctx, centre, size * CHIP.hexRadius + heavyLineWidth(size) / 2, CHIP.hexSides);
    ctx.stroke();
  } else {
    ctx.strokeStyle = rune.glow;
    ctx.lineWidth = Math.max(MIN_LINE_PX, size * CHIP.rimWidth);
    ctx.stroke();
  }
  ctx.strokeStyle = ink ? ink.line : rune.core;
  ctx.globalAlpha = CHIP.coreAlpha + pulse * CHIP.corePulse;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * CHIP.coreWidth);
  ctx.beginPath();
  ctx.moveTo(centre, centre - size * CHIP.runeHalfHeight);
  ctx.lineTo(centre, centre + size * CHIP.runeHalfHeight);
  ctx.moveTo(centre - size * CHIP.slantHalfWidth, centre - size * CHIP.slantHalfHeight);
  ctx.lineTo(centre + size * CHIP.slantHalfWidth, centre + size * CHIP.slantHalfHeight);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
