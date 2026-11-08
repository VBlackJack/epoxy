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
 * Vector drawing of the signal tiles for the flat and neon styles: a dark device box with a symbol
 * drawn by canvas paths for each gate (AND "&", OR ">=1", NOT a "1" with an inversion circle, XOR "=1",
 * latch "L", NAND an "&" with an inversion circle, data latch "D", counter the seven-segment digit it starts
 * with), a wire trace on a floor for the wire floor, a flat hex pad for the held signal plate, and a round bezel with a raised cap for the pulse
 * button (a push button: it reads as momentary, and a lit pulse shows a burst of short rays around the cap).
 * A powered device shows a lit rim and a lit symbol; the pad lights when pressed. Colours arrive as arguments (the renderer reads them from its palette), so
 * this module holds no colour of its own and works for any theme.
 */

/** What a signal tile is drawn as. */
export type SignalTileKind =
  | 'plate'
  | 'button'
  | 'and'
  | 'or'
  | 'not'
  | 'xor'
  | 'latch_off'
  | 'latch_on'
  | 'nand'
  | 'dlatch'
  | 'wire'
  | `counter_${number}`;

/** Prefix of the kind of a counter, followed by the digit it starts with. */
const COUNTER_KIND_PREFIX = 'counter_';

/** How many digits a counter can start with (0 to 9). */
const COUNTER_DIGIT_COUNT = 10;

/** The kind of each shipped signal tile id. */
export const SIGNAL_TILE_KINDS: Readonly<Record<string, SignalTileKind>> = {
  signal_plate: 'plate',
  signal_button: 'button',
  signal_gate_and: 'and',
  signal_gate_or: 'or',
  signal_gate_not: 'not',
  signal_gate_xor: 'xor',
  signal_latch_off: 'latch_off',
  signal_latch_on: 'latch_on',
  signal_gate_nand: 'nand',
  signal_gate_dlatch: 'dlatch',
  signal_wire_floor: 'wire',
  ...Object.fromEntries(
    Array.from({ length: COUNTER_DIGIT_COUNT }, (_, digit): [string, SignalTileKind] => [`signal_counter_${digit}`, `${COUNTER_KIND_PREFIX}${digit}`])
  )
};

/** Colours of a signal tile, all taken from the active palette by the caller. */
export interface SignalTileColors {
  /** Fill of the device box and of the pad. */
  box: string;
  /** Rim and symbol while unpowered. */
  idle: string;
  /** Rim, symbol and pad core while powered. */
  lit: string;
}

/** Style switches of the two vector styles. */
export interface SignalTileStyle {
  /** Rounded corners (neon) or square (flat). */
  rounded: boolean;
  /** Shadow blur of a lit element in pixels; 0 draws no glow (flat). */
  glowBlurPx: number;
}

/** A point of the unit square, as [u, v]. */
type UnitPoint = readonly [number, number];

/** The box, in fractions of the cell. */
const BOX_INSET_TILE = 0.09;
const BOX_RADIUS_TILE = 0.16;
const RIM_WIDTH_TILE = 0.07;
/** Stroke of every symbol, in fractions of the cell. */
const SYMBOL_STROKE_TILE = 0.08;
const MIN_STROKE_PX = 1;
const CENTRE_TILE = 0.5;
const FULL_TURN = Math.PI * 2;

/** Hex pad: circumradius, rim width and the radius of its lit core, in fractions of the cell. */
const HEX_SIDES = 6;
const HEX_RADIUS_TILE = 0.4;
const HEX_RIM_WIDTH_TILE = 0.07;
const HEX_CORE_RADIUS_TILE = 0.2;

/**
 * Pulse button, in fractions of the cell: the round bezel, the cap inside it and the rays of a lit pulse.
 * The rays sit between the cap and the bezel, on the diagonals, so the lit button reads as a spark.
 */
const BUTTON_BEZEL_RADIUS_TILE = 0.4;
const BUTTON_BEZEL_RIM_WIDTH_TILE = 0.06;
const BUTTON_CAP_RADIUS_TILE = 0.2;
const BUTTON_CAP_RIM_WIDTH_TILE = 0.07;
const BUTTON_RAY_INNER_TILE = 0.27;
const BUTTON_RAY_OUTER_TILE = 0.34;
const BUTTON_RAY_COUNT = 4;
const BUTTON_RAY_ANGLE_OFFSET = Math.PI / 4;

/**
 * The ampersand: a diagonal from the lower right up to the head, the head loop, then the bowl that ends
 * on the right arm. Each curve is [control 1, control 2, end].
 */
const AND_START: UnitPoint = [0.7, 0.74];
const AND_HEAD_FOOT: UnitPoint = [0.37, 0.43];
const AND_HEAD_LEFT: readonly [UnitPoint, UnitPoint, UnitPoint] = [[0.3, 0.34], [0.38, 0.26], [0.47, 0.26]];
const AND_HEAD_RIGHT: readonly [UnitPoint, UnitPoint, UnitPoint] = [[0.58, 0.26], [0.62, 0.36], [0.4, 0.52]];
const AND_BOWL_TOP: UnitPoint = [0.35, 0.58];
const AND_BOWL_LEFT: readonly [UnitPoint, UnitPoint, UnitPoint] = [[0.27, 0.7], [0.36, 0.76], [0.46, 0.76]];
const AND_BOWL_RIGHT: readonly [UnitPoint, UnitPoint, UnitPoint] = [[0.56, 0.76], [0.62, 0.68], [0.66, 0.6]];

/** Shared strokes of the "=" and "1" glyphs. */
const EQUALS_UPPER_Y = 0.44;
const EQUALS_LOWER_Y = 0.56;
const ONE_TOP_Y = 0.34;
const ONE_BOTTOM_Y = 0.66;
const ONE_FLAG_DX = 0.07;
const ONE_FLAG_DY = 0.07;

/** OR symbol ">=1": chevron, short equals, one. */
const OR_CHEVRON = { left: 0.2, tip: 0.31, top: 0.38, bottom: 0.62 };
const OR_EQUALS = { x0: 0.4, x1: 0.53 };
const OR_ONE_X = 0.68;

/** XOR symbol "=1": wider equals, one. */
const XOR_EQUALS = { x0: 0.26, x1: 0.47 };
const XOR_ONE_X = 0.64;

/** NOT symbol: a one and the inversion circle on its output (right) side. */
const NOT_ONE_X = 0.4;
const NOT_CIRCLE = { x: 0.66, y: 0.5, radius: 0.075 };

/** Latch symbol "L" and the start mark in its upper right corner. */
const LATCH_STEM = { x: 0.4, top: 0.28, bottom: 0.7, foot: 0.64 };
const LATCH_MARK = { x: 0.7, y: 0.3, radius: 0.055 };

/** NAND symbol: the AND ampersand and an inversion circle on the output side. */
const NAND_CIRCLE = { x: 0.8, y: 0.5, radius: 0.05 };

/** Data latch symbol "D": a stem and a bowl. */
const DLATCH_STEM_X = 0.36;
const DLATCH_TOP_Y = 0.28;
const DLATCH_BOTTOM_Y = 0.72;
const DLATCH_BOWL_START_X = 0.48;
const DLATCH_BOWL_CONTROL_X = 0.72;

/**
 * Counter digit, seven segments in the box [0.36, 0.64] x [0.26, 0.74]. The bits of each digit name the segments
 * top, upper right, lower right, bottom, lower left, upper left and middle, from the least significant bit.
 */
const DIGIT_LEFT_X = 0.36;
const DIGIT_RIGHT_X = 0.64;
const DIGIT_TOP_Y = 0.26;
const DIGIT_MIDDLE_Y = 0.5;
const DIGIT_BOTTOM_Y = 0.74;
const DIGIT_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [DIGIT_LEFT_X, DIGIT_TOP_Y, DIGIT_RIGHT_X, DIGIT_TOP_Y],
  [DIGIT_RIGHT_X, DIGIT_TOP_Y, DIGIT_RIGHT_X, DIGIT_MIDDLE_Y],
  [DIGIT_RIGHT_X, DIGIT_MIDDLE_Y, DIGIT_RIGHT_X, DIGIT_BOTTOM_Y],
  [DIGIT_LEFT_X, DIGIT_BOTTOM_Y, DIGIT_RIGHT_X, DIGIT_BOTTOM_Y],
  [DIGIT_LEFT_X, DIGIT_MIDDLE_Y, DIGIT_LEFT_X, DIGIT_BOTTOM_Y],
  [DIGIT_LEFT_X, DIGIT_TOP_Y, DIGIT_LEFT_X, DIGIT_MIDDLE_Y],
  [DIGIT_LEFT_X, DIGIT_MIDDLE_Y, DIGIT_RIGHT_X, DIGIT_MIDDLE_Y]
];
const DIGIT_SEGMENT_MASKS: readonly number[] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

/** Wire floor: the trace crosses the cell, with a node in the middle. */
const WIRE_TRACE_INSET_TILE = 0.08;
const WIRE_TRACE_WIDTH_TILE = 0.07;
const WIRE_NODE_RADIUS_TILE = 0.13;

/** The digit a counter kind starts with, or undefined for any other kind. */
function counterDigitOf(kind: SignalTileKind): number | undefined {
  if (!kind.startsWith(COUNTER_KIND_PREFIX)) return undefined;
  const digit = Number(kind.slice(COUNTER_KIND_PREFIX.length));
  return Number.isInteger(digit) && digit >= 0 && digit < COUNTER_DIGIT_COUNT ? digit : undefined;
}

/** Maps the unit square to the pixels of one cell. */
interface CellMap {
  px(u: number): number;
  py(v: number): number;
  size: number;
}

/** A rectangle path with optional rounded corners, built from arcs so any 2D context can draw it. */
function boxPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  ctx.beginPath();
  if (radius <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.beginPath();
  for (let i = 0; i < HEX_SIDES; i++) {
    const angle = (i * FULL_TURN) / HEX_SIDES;
    const hx = cx + Math.cos(angle) * radius;
    const hy = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(hx, hy);
    else ctx.lineTo(hx, hy);
  }
  ctx.closePath();
}

function segment(ctx: CanvasRenderingContext2D, m: CellMap, u0: number, v0: number, u1: number, v1: number): void {
  ctx.moveTo(m.px(u0), m.py(v0));
  ctx.lineTo(m.px(u1), m.py(v1));
}

function curve(ctx: CanvasRenderingContext2D, m: CellMap, c: readonly [UnitPoint, UnitPoint, UnitPoint]): void {
  ctx.bezierCurveTo(m.px(c[0][0]), m.py(c[0][1]), m.px(c[1][0]), m.py(c[1][1]), m.px(c[2][0]), m.py(c[2][1]));
}

/** A circle as its own sub-path. */
function circle(ctx: CanvasRenderingContext2D, m: CellMap, u: number, v: number, radius: number): void {
  const r = radius * m.size;
  ctx.moveTo(m.px(u) + r, m.py(v));
  ctx.arc(m.px(u), m.py(v), r, 0, FULL_TURN);
}

/** The "1" of the OR, XOR and NOT symbols: a stem with a flag at its head. */
function one(ctx: CanvasRenderingContext2D, m: CellMap, stemX: number): void {
  segment(ctx, m, stemX, ONE_TOP_Y, stemX, ONE_BOTTOM_Y);
  segment(ctx, m, stemX - ONE_FLAG_DX, ONE_TOP_Y + ONE_FLAG_DY, stemX, ONE_TOP_Y);
}

function equals(ctx: CanvasRenderingContext2D, m: CellMap, x0: number, x1: number): void {
  segment(ctx, m, x0, EQUALS_UPPER_Y, x1, EQUALS_UPPER_Y);
  segment(ctx, m, x0, EQUALS_LOWER_Y, x1, EQUALS_LOWER_Y);
}

/** Strokes the symbol of a gate with the stroke style already set. */
function paintSymbol(
  ctx: CanvasRenderingContext2D,
  kind: SignalTileKind,
  m: CellMap,
  colors: SignalTileColors,
  powered: boolean,
  liveCount?: number
): void {
  ctx.beginPath();
  switch (kind) {
    case 'and':
      ctx.moveTo(m.px(AND_START[0]), m.py(AND_START[1]));
      ctx.lineTo(m.px(AND_HEAD_FOOT[0]), m.py(AND_HEAD_FOOT[1]));
      curve(ctx, m, AND_HEAD_LEFT);
      curve(ctx, m, AND_HEAD_RIGHT);
      ctx.lineTo(m.px(AND_BOWL_TOP[0]), m.py(AND_BOWL_TOP[1]));
      curve(ctx, m, AND_BOWL_LEFT);
      curve(ctx, m, AND_BOWL_RIGHT);
      break;
    case 'or':
      ctx.moveTo(m.px(OR_CHEVRON.left), m.py(OR_CHEVRON.top));
      ctx.lineTo(m.px(OR_CHEVRON.tip), m.py(CENTRE_TILE));
      ctx.lineTo(m.px(OR_CHEVRON.left), m.py(OR_CHEVRON.bottom));
      equals(ctx, m, OR_EQUALS.x0, OR_EQUALS.x1);
      one(ctx, m, OR_ONE_X);
      break;
    case 'xor':
      equals(ctx, m, XOR_EQUALS.x0, XOR_EQUALS.x1);
      one(ctx, m, XOR_ONE_X);
      break;
    case 'not':
      one(ctx, m, NOT_ONE_X);
      circle(ctx, m, NOT_CIRCLE.x, NOT_CIRCLE.y, NOT_CIRCLE.radius);
      break;
    case 'latch_off':
    case 'latch_on':
      ctx.moveTo(m.px(LATCH_STEM.x), m.py(LATCH_STEM.top));
      ctx.lineTo(m.px(LATCH_STEM.x), m.py(LATCH_STEM.bottom));
      ctx.lineTo(m.px(LATCH_STEM.foot), m.py(LATCH_STEM.bottom));
      break;
    case 'nand':
      ctx.moveTo(m.px(AND_START[0]), m.py(AND_START[1]));
      ctx.lineTo(m.px(AND_HEAD_FOOT[0]), m.py(AND_HEAD_FOOT[1]));
      curve(ctx, m, AND_HEAD_LEFT);
      curve(ctx, m, AND_HEAD_RIGHT);
      ctx.lineTo(m.px(AND_BOWL_TOP[0]), m.py(AND_BOWL_TOP[1]));
      curve(ctx, m, AND_BOWL_LEFT);
      curve(ctx, m, AND_BOWL_RIGHT);
      circle(ctx, m, NAND_CIRCLE.x, NAND_CIRCLE.y, NAND_CIRCLE.radius);
      break;
    case 'dlatch':
      ctx.moveTo(m.px(DLATCH_STEM_X), m.py(DLATCH_TOP_Y));
      ctx.lineTo(m.px(DLATCH_STEM_X), m.py(DLATCH_BOTTOM_Y));
      ctx.lineTo(m.px(DLATCH_BOWL_START_X), m.py(DLATCH_BOTTOM_Y));
      ctx.bezierCurveTo(
        m.px(DLATCH_BOWL_CONTROL_X),
        m.py(DLATCH_BOTTOM_Y),
        m.px(DLATCH_BOWL_CONTROL_X),
        m.py(DLATCH_TOP_Y),
        m.px(DLATCH_BOWL_START_X),
        m.py(DLATCH_TOP_Y)
      );
      ctx.lineTo(m.px(DLATCH_STEM_X), m.py(DLATCH_TOP_Y));
      break;
    default: {
      // The live count wins over the number the counter started with (the editor has no running level).
      const startNumber = counterDigitOf(kind);
      if (startNumber === undefined) break;
      const digit = liveCount !== undefined && liveCount >= 0 && liveCount < COUNTER_DIGIT_COUNT ? Math.trunc(liveCount) : startNumber;
      DIGIT_SEGMENTS.forEach((seg, bit) => {
        if ((DIGIT_SEGMENT_MASKS[digit] & (1 << bit)) !== 0) segment(ctx, m, seg[0], seg[1], seg[2], seg[3]);
      });
      break;
    }
  }
  ctx.stroke();
  if (kind === 'latch_off' || kind === 'latch_on') {
    // The start mark: a ring while the latch starts off, a filled dot while it starts on.
    ctx.beginPath();
    circle(ctx, m, LATCH_MARK.x, LATCH_MARK.y, LATCH_MARK.radius);
    if (kind === 'latch_on') {
      ctx.fillStyle = powered ? colors.lit : colors.idle;
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
}

/**
 * The pulse button: a bezel ring around a cap. At rest the cap is an outline on the dark box (a button waiting to
 * be pushed); a lit pulse fills the cap and adds short rays around it. The caller saved the context.
 */
function paintPulseButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  powered: boolean,
  colors: SignalTileColors,
  style: SignalTileStyle
): void {
  const cx = x + size * CENTRE_TILE;
  const cy = y + size * CENTRE_TILE;
  const disc = (radius: number): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, size * radius, 0, FULL_TURN);
    ctx.closePath();
  };
  disc(BUTTON_BEZEL_RADIUS_TILE);
  ctx.fillStyle = colors.box;
  ctx.fill();
  ctx.lineWidth = Math.max(MIN_STROKE_PX, size * BUTTON_BEZEL_RIM_WIDTH_TILE);
  ctx.stroke();
  if (powered && style.glowBlurPx > 0) {
    ctx.shadowColor = colors.lit;
    ctx.shadowBlur = style.glowBlurPx;
  }
  disc(BUTTON_CAP_RADIUS_TILE);
  ctx.lineWidth = Math.max(MIN_STROKE_PX, size * BUTTON_CAP_RIM_WIDTH_TILE);
  if (powered) {
    ctx.fillStyle = colors.lit;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < BUTTON_RAY_COUNT; i++) {
      const angle = BUTTON_RAY_ANGLE_OFFSET + (i * FULL_TURN) / BUTTON_RAY_COUNT;
      ctx.moveTo(cx + Math.cos(angle) * size * BUTTON_RAY_INNER_TILE, cy + Math.sin(angle) * size * BUTTON_RAY_INNER_TILE);
      ctx.lineTo(cx + Math.cos(angle) * size * BUTTON_RAY_OUTER_TILE, cy + Math.sin(angle) * size * BUTTON_RAY_OUTER_TILE);
    }
  }
  ctx.stroke();
}

/**
 * Paints one signal tile over whatever is already in the cell (the caller draws the floor first). `powered`
 * lights the rim and the symbol of a device, and the core of the plate's pad.
 */
export function paintSignalTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  kind: SignalTileKind,
  powered: boolean,
  colors: SignalTileColors,
  style: SignalTileStyle,
  liveCount?: number
): void {
  const ink = powered ? colors.lit : colors.idle;
  const map: CellMap = { px: (u) => x + u * size, py: (v) => y + v * size, size };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  if (kind === 'button') {
    paintPulseButton(ctx, x, y, size, powered, colors, style);
    ctx.restore();
    return;
  }
  if (kind === 'wire') {
    // A trace across the cell and a node; the node fills with the lit colour while the wire is powered.
    ctx.lineWidth = Math.max(MIN_STROKE_PX, size * WIRE_TRACE_WIDTH_TILE);
    if (powered && style.glowBlurPx > 0) {
      ctx.shadowColor = colors.lit;
      ctx.shadowBlur = style.glowBlurPx;
    }
    ctx.beginPath();
    segment(ctx, map, WIRE_TRACE_INSET_TILE, CENTRE_TILE, 1 - WIRE_TRACE_INSET_TILE, CENTRE_TILE);
    segment(ctx, map, CENTRE_TILE, WIRE_TRACE_INSET_TILE, CENTRE_TILE, 1 - WIRE_TRACE_INSET_TILE);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + size * CENTRE_TILE, y + size * CENTRE_TILE, size * WIRE_NODE_RADIUS_TILE, 0, FULL_TURN);
    ctx.fillStyle = powered ? colors.lit : colors.box;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (kind === 'plate') {
    const pad = (radius: number): void => hexPath(ctx, x + size * CENTRE_TILE, y + size * CENTRE_TILE, size * radius);
    pad(HEX_RADIUS_TILE);
    ctx.fillStyle = colors.box;
    ctx.fill();
    ctx.lineWidth = Math.max(MIN_STROKE_PX, size * HEX_RIM_WIDTH_TILE);
    if (powered && style.glowBlurPx > 0) {
      ctx.shadowColor = colors.lit;
      ctx.shadowBlur = style.glowBlurPx;
    }
    ctx.stroke();
    if (powered) {
      pad(HEX_CORE_RADIUS_TILE);
      ctx.fillStyle = colors.lit;
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const inset = size * BOX_INSET_TILE;
  const boxSize = size - inset * 2;
  boxPath(ctx, x + inset, y + inset, boxSize, boxSize, style.rounded ? size * BOX_RADIUS_TILE : 0);
  ctx.fillStyle = colors.box;
  ctx.fill();
  ctx.lineWidth = Math.max(MIN_STROKE_PX, size * RIM_WIDTH_TILE);
  if (powered && style.glowBlurPx > 0) {
    ctx.shadowColor = colors.lit;
    ctx.shadowBlur = style.glowBlurPx;
  }
  ctx.stroke();
  ctx.lineWidth = Math.max(MIN_STROKE_PX, size * SYMBOL_STROKE_TILE);
  paintSymbol(ctx, kind, map, colors, powered, liveCount);
  ctx.restore();
}
