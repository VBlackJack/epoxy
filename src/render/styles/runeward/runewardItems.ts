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
 * Items of the Runeward style: boots, the slow-time item, the bomb, score tokens, stopwatches and the forbidden markers.
 * Each item is drawn into the square from (0, 0) to (size, size) from the Runeward art config, in the plain drawing
 * or, when the art block has an ink section, as pigment washes with ink outlines. Items hover with the Runeward
 * clock, which the caller freezes at 0 under reduced motion, so a still item sits at its rest height. The
 * forbidden markers are terrain tiles: the floor, a faded copy of the key or boots they forbid, and a barred circle.
 * The proportions below are the drawings themselves, the way pixel art is data: they are art, not settings.
 * Ids still listed in PENDING keep the shared drawing; the dispatch in runewardTiles.ts reads the tables and PENDING.
 */

import type { RunewardArtConfig, RunewardBootsKind, RunewardKeyColour } from '../../../core/types';
import { GLOVE } from '../../gloveShape';
import { WARD } from '../../wardShape';
import { heavyLineWidth, inkLineWidth } from './runewardInk';
import { paintKeyItem } from './runewardMechanisms';
import { linear, paintFloor, radial, roundRect } from './runewardPainters';
import { runewardClockMs } from './runewardEnv';
import type { RunewardItemPainter, RunewardTilePainter } from './runewardTiles';

type Art = Readonly<RunewardArtConfig>;
type Point = readonly [number, number];
type ClockedDrawing = (ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number) => void;

const TAU = Math.PI * 2;
/** Middle of the cell, as a fraction of its size. */
const HALF = 0.5;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;
/** Opacity of the copy of the key or boots drawn under a forbidden marker. */
const FADED_ALPHA = 0.45;
/** Opacity of the soft highlight on the plain bomb. */
const HIGHLIGHT_ALPHA = 0.4;

/** Boots kind drawn as a glove rather than a boot. */
const GLOVES_KIND: RunewardBootsKind = 'pull';

const SHADOW = { x: 0.5, y: 0.9, rx: 0.26, ry: 0.05 } as const;

/** Width of a plain (non-ink) detail line, as a fraction of the tile. */
function plainLine(size: number, fraction: number): number {
  return Math.max(MIN_LINE_PX, size * fraction);
}

/** Ground shadow, then `draw` lifted by the hover of the clock; the shadow stays on the ground. */
function hover(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number, draw: () => void): void {
  ctx.fillStyle = art.mage.shadow;
  ctx.beginPath();
  ctx.ellipse(size * SHADOW.x, size * SHADOW.y, size * SHADOW.rx, size * SHADOW.ry, 0, 0, TAU);
  ctx.fill();
  const bob = Math.sin((timeMs / art.animation.bobPeriodMs) * TAU) * size * art.animation.bobAmplitude;
  ctx.save();
  ctx.translate(0, bob);
  draw();
  ctx.restore();
}

/** Strokes the current path: with the outline ink in ink drawings, otherwise with `plain` at `plainWidth` of the tile. */
function outline(ctx: CanvasRenderingContext2D, size: number, art: Art, plain: string, plainWidth: number, heavy = false): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (art.ink) {
    ctx.strokeStyle = art.ink.line;
    ctx.lineWidth = heavy ? heavyLineWidth(size) : inkLineWidth(size);
  } else {
    ctx.strokeStyle = plain;
    ctx.lineWidth = plainLine(size, plainWidth);
  }
  ctx.stroke();
}

/** Colour of a small mark drawn on a body: the ink in ink drawings, the given colour otherwise. */
function markColour(art: Art, plain: string): string {
  return art.ink ? art.ink.line : plain;
}

/** Traces a closed polygon given as fractions of the tile. */
function polygon(ctx: CanvasRenderingContext2D, size: number, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    if (index === 0) ctx.moveTo(size * px, size * py);
    else ctx.lineTo(size * px, size * py);
  });
  ctx.closePath();
}

// ---- Boots ------------------------------------------------------------------------------------

const BOOT = {
  /** Outline of the boot: the leg, the instep, the toe and the sole, as fractions of the tile. */
  outline: [[0.28, 0.12], [0.58, 0.12], [0.58, 0.54], [0.74, 0.6], [0.82, 0.68], [0.82, 0.78], [0.28, 0.78]] as readonly Point[],
  legLeft: 0.28,
  legRight: 0.58,
  cuffTop: 0.12,
  cuffBottom: 0.24,
  soleTop: 0.7,
  soleBottom: 0.78,
  soleRight: 0.82,
  lightStop: 0.4,
  lineWidth: 0.035,
  /** Where the charm sits on the leg, and its reach, as fractions of the tile. */
  charm: { x: 0.43, y: 0.4, r: 0.1, width: 0.04, pupil: 0.38 },
  /** Crampon spikes under the sole of the ice boots. */
  spikes: { xs: [0.36, 0.5, 0.64, 0.76] as readonly number[], halfWidth: 0.05, top: 0.78, bottom: 0.88 }
} as const;

/** The charm of a pair of boots: one shape per kind, so no two pairs are confused. */
function paintBootCharm(ctx: CanvasRenderingContext2D, size: number, art: Art, kind: RunewardBootsKind): void {
  const { x, y, r } = BOOT.charm;
  const cx = size * x;
  const cy = size * y;
  const radius = size * r;
  const colour = markColour(art, art.item.boots[kind].light);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineWidth = plainLine(size, BOOT.charm.width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (kind) {
    case 'water':
      for (const dy of [-radius * 0.45, radius * 0.45]) {
        ctx.moveTo(cx - radius, cy + dy);
        ctx.quadraticCurveTo(cx - radius / 2, cy + dy - radius * 0.7, cx, cy + dy);
        ctx.quadraticCurveTo(cx + radius / 2, cy + dy + radius * 0.7, cx + radius, cy + dy);
      }
      ctx.stroke();
      break;
    case 'fire':
      ctx.moveTo(cx, cy - radius * 1.2);
      ctx.quadraticCurveTo(cx + radius * 1.1, cy - radius * 0.1, cx + radius * 0.7, cy + radius * 0.6);
      ctx.quadraticCurveTo(cx, cy + radius * 1.2, cx - radius * 0.7, cy + radius * 0.6);
      ctx.quadraticCurveTo(cx - radius * 1.1, cy - radius * 0.1, cx, cy - radius * 1.2);
      ctx.fill();
      break;
    case 'ice':
      for (const sx of BOOT.spikes.xs) {
        ctx.moveTo(size * (sx - BOOT.spikes.halfWidth), size * BOOT.spikes.top);
        ctx.lineTo(size * (sx + BOOT.spikes.halfWidth), size * BOOT.spikes.top);
        ctx.lineTo(size * sx, size * BOOT.spikes.bottom);
        ctx.closePath();
      }
      ctx.fill();
      break;
    case 'force':
      for (const dy of [-radius * 0.5, radius * 0.5]) {
        ctx.moveTo(cx - radius, cy + dy + radius * 0.5);
        ctx.lineTo(cx, cy + dy - radius * 0.4);
        ctx.lineTo(cx + radius, cy + dy + radius * 0.5);
      }
      ctx.stroke();
      break;
    case 'speed':
      ctx.moveTo(cx - radius, cy + radius * 0.7);
      ctx.quadraticCurveTo(cx - radius * 0.3, cy - radius * 1.3, cx + radius * 1.2, cy - radius);
      ctx.quadraticCurveTo(cx + radius * 0.3, cy - radius * 0.3, cx + radius * 0.9, cy + radius * 0.1);
      ctx.quadraticCurveTo(cx + radius * 0.1, cy + radius * 0.1, cx + radius * 0.5, cy + radius * 0.7);
      ctx.quadraticCurveTo(cx - radius * 0.2, cy + radius * 0.5, cx - radius, cy + radius * 0.7);
      ctx.fill();
      break;
    case 'eye':
      ctx.moveTo(cx - radius, cy);
      ctx.quadraticCurveTo(cx, cy - radius * 1.3, cx + radius, cy);
      ctx.quadraticCurveTo(cx, cy + radius * 1.3, cx - radius, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * BOOT.charm.pupil, 0, TAU);
      ctx.fill();
      break;
    case 'pull':
      // The gloves are not a boot: paintGloveItem draws them whole.
      break;
    case 'ward':
      // The ward is not a boot: paintWardItem draws it whole.
      break;
  }
}

/** The Grappling Gloves: a glove with four fingers, a thumb, a cuff and a small hook on a cord, hovering. */
function paintGloveItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  const tint = art.item.boots.pull;
  hover(ctx, size, art, timeMs, () => {
    ctx.beginPath();
    GLOVE.hook.forEach(([hx, hy], index) => (index === 0 ? ctx.moveTo(size * hx, size * hy) : ctx.lineTo(size * hx, size * hy)));
    ctx.strokeStyle = markColour(art, tint.light);
    ctx.lineWidth = plainLine(size, GLOVE.hookWidth);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    const body = art.ink ? tint.main : linear(ctx, 0, 0, 0, size, [[0, tint.light], [BOOT.lightStop, tint.main], [1, tint.main]]);
    const thumb = GLOVE.thumb;
    ctx.beginPath();
    ctx.ellipse(size * thumb.cx, size * thumb.cy, size * thumb.rx, size * thumb.ry, thumb.turn, 0, TAU);
    ctx.fillStyle = body;
    ctx.fill();
    outline(ctx, size, art, tint.light, GLOVE.lineWidth, true);
    const palm = GLOVE.palm;
    roundRect(ctx, size * palm.x, size * palm.y, size * palm.w, size * palm.h, size * palm.r);
    ctx.fillStyle = body;
    ctx.fill();
    for (const finger of GLOVE.fingers) {
      roundRect(ctx, size * finger.x, size * finger.top, size * GLOVE.fingerWidth, size * (GLOVE.fingerBottom - finger.top), size * GLOVE.fingerRadius);
      ctx.fillStyle = body;
      ctx.fill();
      outline(ctx, size, art, tint.light, GLOVE.lineWidth, true);
    }
    const cuff = GLOVE.cuff;
    roundRect(ctx, size * cuff.x, size * cuff.y, size * cuff.w, size * cuff.h, size * cuff.r);
    ctx.fillStyle = tint.light;
    ctx.fill();
    outline(ctx, size, art, tint.light, GLOVE.lineWidth, true);
  });
}

/** The Ward: a round shield with an inner ring and a rune, hovering. */
function paintWardItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  const tint = art.item.boots.ward;
  const { cx, cy, r } = WARD.disc;
  hover(ctx, size, art, timeMs, () => {
    ctx.beginPath();
    ctx.arc(size * cx, size * cy, size * r, 0, TAU);
    ctx.fillStyle = art.ink ? tint.main : radial(ctx, size * cx, size * cy, size * r, [[0, tint.light], [1, tint.main]]);
    ctx.fill();
    outline(ctx, size, art, tint.light, WARD.lineWidth, true);
    ctx.beginPath();
    ctx.arc(size * cx, size * cy, size * r * WARD.ringRatio, 0, TAU);
    ctx.globalAlpha = WARD.ringAlpha;
    ctx.strokeStyle = markColour(art, tint.light);
    ctx.lineWidth = plainLine(size, WARD.ringWidth);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (const stroke of WARD.rune) {
      for (let index = 0; index < stroke.length; index++) {
        const [rx, ry] = stroke[index];
        if (index === 0) ctx.moveTo(size * rx, size * ry);
        else ctx.lineTo(size * rx, size * ry);
      }
    }
    ctx.strokeStyle = markColour(art, tint.light);
    ctx.lineWidth = plainLine(size, WARD.runeWidth);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  });
}

/** One boot in side view with the charm of its kind, hovering. */
export function paintBootsItem(ctx: CanvasRenderingContext2D, size: number, art: Art, kind: RunewardBootsKind, timeMs: number): void {
  if (kind === GLOVES_KIND) {
    paintGloveItem(ctx, size, art, timeMs);
    return;
  }
  if (kind === WARD_KIND) {
    paintWardItem(ctx, size, art, timeMs);
    return;
  }
  const tint = art.item.boots[kind];
  hover(ctx, size, art, timeMs, () => {
    polygon(ctx, size, BOOT.outline);
    ctx.fillStyle = art.ink ? tint.main : linear(ctx, 0, 0, 0, size, [[0, tint.light], [BOOT.lightStop, tint.main], [1, tint.main]]);
    ctx.fill();
    ctx.fillStyle = tint.light;
    ctx.fillRect(size * BOOT.legLeft, size * BOOT.cuffTop, size * (BOOT.legRight - BOOT.legLeft), size * (BOOT.cuffBottom - BOOT.cuffTop));
    ctx.fillRect(size * BOOT.legLeft, size * BOOT.soleTop, size * (BOOT.soleRight - BOOT.legLeft), size * (BOOT.soleBottom - BOOT.soleTop));
    polygon(ctx, size, BOOT.outline);
    outline(ctx, size, art, tint.light, BOOT.lineWidth, true);
    paintBootCharm(ctx, size, art, kind);
  });
}

// ---- Slow time --------------------------------------------------------------------------------

const HOURGLASS = {
  capLeft: 0.26,
  capRight: 0.74,
  capHeight: 0.07,
  capTop: 0.12,
  capBottom: 0.81,
  glass: [[0.31, 0.19], [0.69, 0.19], [0.54, 0.5], [0.69, 0.81], [0.31, 0.81], [0.46, 0.5]] as readonly Point[],
  sandTop: [[0.4, 0.24], [0.6, 0.24], [0.5, 0.42]] as readonly Point[],
  sandBottom: [[0.37, 0.8], [0.63, 0.8], [0.5, 0.6]] as readonly Point[],
  lineWidth: 0.035,
  threadWidth: 0.025,
  threadTop: 0.44,
  threadBottom: 0.64
} as const;

/** The slow-time item: an hourglass with its sand falling. */
export function paintSlowTimeItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  const tint = art.item.slowTime;
  hover(ctx, size, art, timeMs, () => {
    polygon(ctx, size, HOURGLASS.glass);
    ctx.fillStyle = tint.base;
    ctx.fill();
    outline(ctx, size, art, tint.core, HOURGLASS.lineWidth);
    ctx.fillStyle = tint.glow;
    polygon(ctx, size, HOURGLASS.sandTop);
    ctx.fill();
    polygon(ctx, size, HOURGLASS.sandBottom);
    ctx.fill();
    ctx.strokeStyle = tint.glow;
    ctx.lineWidth = plainLine(size, HOURGLASS.threadWidth);
    ctx.beginPath();
    ctx.moveTo(size * HALF, size * HOURGLASS.threadTop);
    ctx.lineTo(size * HALF, size * HOURGLASS.threadBottom);
    ctx.stroke();
    const capX = size * HOURGLASS.capLeft;
    const capW = size * (HOURGLASS.capRight - HOURGLASS.capLeft);
    const capH = size * HOURGLASS.capHeight;
    for (const top of [HOURGLASS.capTop, HOURGLASS.capBottom]) {
      ctx.fillStyle = art.ink ? art.ink.gold : tint.core;
      ctx.fillRect(capX, size * top, capW, capH);
      if (art.ink) {
        ctx.strokeStyle = art.ink.line;
        ctx.lineWidth = inkLineWidth(size);
        ctx.strokeRect(capX, size * top, capW, capH);
      }
    }
  });
}

// ---- Bomb -------------------------------------------------------------------------------------

const BOMB = {
  x: 0.46,
  y: 0.6,
  radius: 0.27,
  neckLeft: 0.4,
  neckTop: 0.24,
  neckWidth: 0.12,
  neckHeight: 0.1,
  lineWidth: 0.03,
  fuseFrom: [0.46, 0.24] as Point,
  fuseControl: [0.52, 0.1] as Point,
  fuseTo: [0.68, 0.14] as Point,
  fuseWidth: 0.035,
  sparkRadius: 0.05,
  sparkHaloRadius: 0.12,
  highlight: { x: 0.38, y: 0.5, rx: 0.07, ry: 0.045, turn: -0.6 }
} as const;

/** The bomb: a dark sphere with a short neck and a lit fuse. */
export function paintBombItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  const tint = art.item.bomb;
  hover(ctx, size, art, timeMs, () => {
    ctx.fillStyle = tint.base;
    ctx.beginPath();
    ctx.arc(size * BOMB.x, size * BOMB.y, size * BOMB.radius, 0, TAU);
    ctx.fill();
    outline(ctx, size, art, tint.glow, BOMB.lineWidth, true);
    ctx.fillStyle = tint.base;
    ctx.beginPath();
    ctx.rect(size * BOMB.neckLeft, size * BOMB.neckTop, size * BOMB.neckWidth, size * BOMB.neckHeight);
    ctx.fill();
    outline(ctx, size, art, tint.glow, BOMB.lineWidth);
    if (!art.ink) {
      const light = BOMB.highlight;
      ctx.globalAlpha = HIGHLIGHT_ALPHA;
      ctx.fillStyle = tint.core;
      ctx.beginPath();
      ctx.ellipse(size * light.x, size * light.y, size * light.rx, size * light.ry, light.turn, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = art.ink ? art.ink.line : tint.glow;
    ctx.lineWidth = plainLine(size, BOMB.fuseWidth);
    ctx.beginPath();
    ctx.moveTo(size * BOMB.fuseFrom[0], size * BOMB.fuseFrom[1]);
    ctx.quadraticCurveTo(size * BOMB.fuseControl[0], size * BOMB.fuseControl[1], size * BOMB.fuseTo[0], size * BOMB.fuseTo[1]);
    ctx.stroke();
    const sx = size * BOMB.fuseTo[0];
    const sy = size * BOMB.fuseTo[1];
    const halo = size * BOMB.sparkHaloRadius;
    ctx.fillStyle = radial(ctx, sx, sy, halo, [[0, tint.glow], [1, art.clear]]);
    ctx.fillRect(sx - halo, sy - halo, halo * 2, halo * 2);
    ctx.fillStyle = tint.core;
    ctx.beginPath();
    ctx.arc(sx, sy, size * BOMB.sparkRadius, 0, TAU);
    ctx.fill();
    if (art.ink) outline(ctx, size, art, tint.core, 0);
  });
}

// ---- Blast charge -----------------------------------------------------------------------------

const CHARGE = {
  /** The canister, its cap, and the two bands across it, as fractions of the tile. */
  body: { left: 0.3, top: 0.34, width: 0.4, height: 0.46, corner: 0.08 },
  cap: { left: 0.35, top: 0.26, width: 0.3, height: 0.09 },
  bands: [0.46, 0.64] as readonly number[],
  bandHeight: 0.06,
  lineWidth: 0.03,
  /** The wick: a stub when unlit, a curve to the spark when lit. */
  wickFrom: [0.5, 0.26] as Point,
  stubTo: [0.55, 0.19] as Point,
  litControl: [0.56, 0.14] as Point,
  litTo: [0.68, 0.12] as Point,
  wickWidth: 0.035,
  sparkRadius: 0.05,
  sparkHaloRadius: 0.12
} as const;

/** The blast charge: a banded canister with a wick; lit, the wick burns with a spark. */
function chargeItem(lit: boolean): ClockedDrawing {
  return (ctx, size, art, timeMs) => {
    const tint = art.item.bomb;
    hover(ctx, size, art, timeMs, () => {
      const { body, cap, bands, bandHeight } = CHARGE;
      ctx.fillStyle = tint.base;
      roundRect(ctx, size * body.left, size * body.top, size * body.width, size * body.height, size * body.corner);
      ctx.fill();
      outline(ctx, size, art, tint.glow, CHARGE.lineWidth, true);
      ctx.fillStyle = tint.base;
      ctx.beginPath();
      ctx.rect(size * cap.left, size * cap.top, size * cap.width, size * cap.height);
      ctx.fill();
      outline(ctx, size, art, tint.glow, CHARGE.lineWidth);
      ctx.fillStyle = markColour(art, tint.glow);
      for (const band of bands) {
        ctx.fillRect(size * body.left, size * band, size * body.width, size * bandHeight);
      }
      ctx.strokeStyle = markColour(art, tint.glow);
      ctx.lineWidth = plainLine(size, CHARGE.wickWidth);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(size * CHARGE.wickFrom[0], size * CHARGE.wickFrom[1]);
      if (lit) {
        ctx.quadraticCurveTo(size * CHARGE.litControl[0], size * CHARGE.litControl[1], size * CHARGE.litTo[0], size * CHARGE.litTo[1]);
      } else {
        ctx.lineTo(size * CHARGE.stubTo[0], size * CHARGE.stubTo[1]);
      }
      ctx.stroke();
      if (!lit) return;
      const sx = size * CHARGE.litTo[0];
      const sy = size * CHARGE.litTo[1];
      const halo = size * CHARGE.sparkHaloRadius;
      ctx.fillStyle = radial(ctx, sx, sy, halo, [[0, tint.glow], [1, art.clear]]);
      ctx.fillRect(sx - halo, sy - halo, halo * 2, halo * 2);
      ctx.fillStyle = tint.core;
      ctx.beginPath();
      ctx.arc(sx, sy, size * CHARGE.sparkRadius, 0, TAU);
      ctx.fill();
      if (art.ink) outline(ctx, size, art, tint.core, 0);
    });
  };
}

// ---- Pocket gate ------------------------------------------------------------------------------

const GATE = {
  /** The ring of the gate: its centre, radius and line width, as fractions of the tile. */
  centre: [0.5, 0.58] as Point,
  ringRadius: 0.27,
  ringWidth: 0.09,
  /** Half of the notch cut out of the top of the ring, in radians either side of twelve o'clock. */
  notchHalfAngle: Math.PI / 7,
  /** The handle tab standing in the notch. */
  tab: { left: 0.44, top: 0.14, width: 0.12, height: 0.16 },
  centreRadius: 0.07,
  lineWidth: 0.03
} as const;

/** The pocket gate: the notched ring of its pad with a handle tab in the notch. */
function paintGateItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  hover(ctx, size, art, timeMs, () => {
    const cx = size * GATE.centre[0];
    const cy = size * GATE.centre[1];
    const radius = size * GATE.ringRadius;
    const start = -Math.PI / 2 + GATE.notchHalfAngle;
    const end = -Math.PI / 2 - GATE.notchHalfAngle + TAU;
    ctx.lineCap = 'round';
    ctx.strokeStyle = art.portal.ring;
    ctx.lineWidth = plainLine(size, GATE.ringWidth);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();
    if (art.ink) {
      const half = (size * GATE.ringWidth) / 2;
      for (const edge of [radius + half, radius - half]) {
        ctx.beginPath();
        ctx.arc(cx, cy, edge, start, end);
        outline(ctx, size, art, art.portal.ring, GATE.lineWidth);
      }
    }
    const { tab } = GATE;
    ctx.fillStyle = art.portal.base;
    ctx.beginPath();
    ctx.rect(size * tab.left, size * tab.top, size * tab.width, size * tab.height);
    ctx.fill();
    outline(ctx, size, art, art.portal.ring, GATE.lineWidth);
    ctx.fillStyle = art.portal.core;
    ctx.beginPath();
    ctx.arc(cx, cy, size * GATE.centreRadius, 0, TAU);
    ctx.fill();
  });
}

// ---- Hurl stone -------------------------------------------------------------------------------

const STONE = {
  /** Outline of the rock, an irregular rounded shape, as fractions of the tile. */
  outline: [[0.28, 0.5], [0.34, 0.36], [0.5, 0.3], [0.66, 0.36], [0.74, 0.52], [0.68, 0.68], [0.5, 0.74], [0.34, 0.66]] as readonly Point[],
  /** The lit facet on the upper left of the rock. */
  facet: [[0.34, 0.4], [0.5, 0.34], [0.58, 0.4], [0.44, 0.52], [0.36, 0.52]] as readonly Point[],
  lineWidth: 0.035
} as const;

/** The hurl stone: a dark rock with a lit facet on its upper left. */
function paintStoneItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  const tint = art.item.bomb;
  const tracePath = (points: readonly Point[]): void => {
    ctx.beginPath();
    points.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(size * px, size * py) : ctx.lineTo(size * px, size * py)));
    ctx.closePath();
  };
  hover(ctx, size, art, timeMs, () => {
    ctx.fillStyle = tint.base;
    tracePath(STONE.outline);
    ctx.fill();
    outline(ctx, size, art, tint.glow, STONE.lineWidth, true);
    if (art.ink) return;
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    ctx.fillStyle = tint.core;
    tracePath(STONE.facet);
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

// ---- Toll token -------------------------------------------------------------------------------

const TOLL_TOKEN = {
  x: 0.5,
  y: 0.5,
  radius: 0.26,
  holeHalfSide: 0.07,
  rimInset: 0.06,
  rimWidth: 0.02,
  lineWidth: 0.035,
  lightStop: 0.5
} as const;

/** The toll token: a coin with a square hole, hovering. */
function paintTollTokenItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  const tint = art.item.score;
  const centreX = size * TOLL_TOKEN.x;
  const centreY = size * TOLL_TOKEN.y;
  const r = size * TOLL_TOKEN.radius;
  const hole = size * TOLL_TOKEN.holeHalfSide;
  hover(ctx, size, art, timeMs, () => {
    ctx.beginPath();
    ctx.arc(centreX, centreY, r, 0, TAU);
    ctx.rect(centreX - hole, centreY - hole, hole * 2, hole * 2);
    ctx.fillStyle = art.ink
      ? tint.base
      : linear(ctx, centreX - r, centreY - r, centreX + r, centreY + r, [[0, tint.light], [TOLL_TOKEN.lightStop, tint.base], [1, tint.dark]]);
    ctx.fill('evenodd');
    outline(ctx, size, art, tint.edge, TOLL_TOKEN.lineWidth, true);
    ctx.beginPath();
    ctx.arc(centreX, centreY, r - size * TOLL_TOKEN.rimInset, 0, TAU);
    ctx.strokeStyle = art.ink ? art.ink.gold : tint.light;
    ctx.lineWidth = plainLine(size, TOLL_TOKEN.rimWidth);
    ctx.stroke();
  });
}

// ---- Score tokens -----------------------------------------------------------------------------

const COIN = {
  x: 0.5,
  y: 0.5,
  radius: 0.28,
  pipRadius: 0.05,
  rimInset: 0.06,
  rimWidth: 0.02,
  lineWidth: 0.035,
  lightStop: 0.5,
  /** Pips of the coins, in tiles from the centre of the coin. */
  one: [[0, 0]] as readonly Point[],
  two: [[-0.09, 0], [0.09, 0]] as readonly Point[],
  three: [[0, -0.09], [-0.1, 0.07], [0.1, 0.07]] as readonly Point[],
  /** The double token: a coin behind another, each with one pip. */
  double: { radius: 0.22, back: [0.4, 0.42] as Point, front: [0.6, 0.58] as Point }
} as const;

/** One coin of `radius` tiles centred at (cx, cy) tiles, with `pips` marked on it. */
function paintCoin(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  [cx, cy]: Point,
  radius: number,
  pips: readonly Point[]
): void {
  const tint = art.item.score;
  const centreX = size * cx;
  const centreY = size * cy;
  const r = size * radius;
  ctx.beginPath();
  ctx.arc(centreX, centreY, r, 0, TAU);
  ctx.fillStyle = art.ink
    ? tint.base
    : linear(ctx, centreX - r, centreY - r, centreX + r, centreY + r, [[0, tint.light], [COIN.lightStop, tint.base], [1, tint.dark]]);
  ctx.fill();
  outline(ctx, size, art, tint.edge, COIN.lineWidth, true);
  ctx.beginPath();
  ctx.arc(centreX, centreY, r - size * COIN.rimInset, 0, TAU);
  ctx.strokeStyle = art.ink ? art.ink.gold : tint.light;
  ctx.lineWidth = plainLine(size, COIN.rimWidth);
  ctx.stroke();
  ctx.fillStyle = markColour(art, tint.edge);
  for (const [dx, dy] of pips) {
    ctx.beginPath();
    ctx.arc(centreX + size * dx, centreY + size * dy, size * COIN.pipRadius, 0, TAU);
    ctx.fill();
  }
}

/** A score token with the given pips, hovering. */
function scoreItem(pips: readonly Point[]): ClockedDrawing {
  return (ctx, size, art, timeMs) => hover(ctx, size, art, timeMs, () => paintCoin(ctx, size, art, [COIN.x, COIN.y], COIN.radius, pips));
}

/** The double score token: two coins, the front one over the back one. */
export function paintScoreDoubleItem(ctx: CanvasRenderingContext2D, size: number, art: Art, timeMs: number): void {
  hover(ctx, size, art, timeMs, () => {
    paintCoin(ctx, size, art, COIN.double.back, COIN.double.radius, COIN.one);
    paintCoin(ctx, size, art, COIN.double.front, COIN.double.radius, COIN.one);
  });
}

// ---- Stopwatches ------------------------------------------------------------------------------

const WATCH = {
  x: 0.5,
  y: 0.56,
  radius: 0.29,
  rimWidth: 0.06,
  crownLeft: 0.43,
  crownTop: 0.14,
  crownWidth: 0.14,
  crownHeight: 0.09,
  crownCorner: 0.03,
  stemLeft: 0.47,
  stemWidth: 0.06,
  stemTop: 0.22,
  stemBottom: 0.28,
  tickInner: 0.2,
  tickOuter: 0.25,
  tickWidth: 0.025,
  markHalf: 0.12,
  markThick: 0.06,
  markLineWidth: 0.015,
  /** Unit directions of the four ticks: up, right, down, left. */
  ticks: [[0, -1], [1, 0], [0, 1], [-1, 0]] as readonly Point[]
} as const;

/** A stopwatch whose face carries a plus (bonus) or a minus (penalty) drawn as shapes. */
function stopwatchItem(sign: 'plus' | 'minus'): ClockedDrawing {
  return (ctx, size, art, timeMs) => {
    const tint = art.item.stopwatch;
    hover(ctx, size, art, timeMs, () => {
      const cx = size * WATCH.x;
      const cy = size * WATCH.y;
      ctx.fillStyle = tint.rim;
      roundRect(ctx, size * WATCH.crownLeft, size * WATCH.crownTop, size * WATCH.crownWidth, size * WATCH.crownHeight, size * WATCH.crownCorner);
      ctx.fill();
      ctx.fillRect(size * WATCH.stemLeft, size * WATCH.stemTop, size * WATCH.stemWidth, size * (WATCH.stemBottom - WATCH.stemTop));
      ctx.beginPath();
      ctx.arc(cx, cy, size * WATCH.radius, 0, TAU);
      ctx.fillStyle = tint.face;
      ctx.fill();
      outline(ctx, size, art, tint.rim, WATCH.rimWidth, true);
      ctx.strokeStyle = markColour(art, tint.rim);
      ctx.lineWidth = plainLine(size, WATCH.tickWidth);
      ctx.beginPath();
      for (const [dx, dy] of WATCH.ticks) {
        ctx.moveTo(cx + dx * size * WATCH.tickInner, cy + dy * size * WATCH.tickInner);
        ctx.lineTo(cx + dx * size * WATCH.tickOuter, cy + dy * size * WATCH.tickOuter);
      }
      ctx.stroke();
      const half = size * WATCH.markHalf;
      const thick = size * WATCH.markThick;
      const bars: (readonly [number, number, number, number])[] = [[cx - half, cy - thick / 2, half * 2, thick]];
      if (sign === 'plus') bars.push([cx - thick / 2, cy - half, thick, half * 2]);
      ctx.fillStyle = sign === 'plus' ? tint.bonus : tint.penalty;
      for (const [bx, by, bw, bh] of bars) ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = markColour(art, tint.rim);
      ctx.lineWidth = plainLine(size, WATCH.markLineWidth);
      for (const [bx, by, bw, bh] of bars) ctx.strokeRect(bx, by, bw, bh);
    });
  };
}

// ---- Forbidden markers (terrain tiles) --------------------------------------------------------

const FORBID = {
  ringRadius: 0.36,
  ringWidth: 0.07,
  /** Angle of the bar across the circle, from the upper left to the lower right. */
  slashAngle: Math.PI * 1.25
} as const;

/** Floor, the faded forbidden item and the barred circle over it; static, so it goes with the cached terrain. */
function forbidTile(paintForbidden: (ctx: CanvasRenderingContext2D, size: number, art: Art) => void): RunewardTilePainter {
  return (ctx, x, y, size, pass, neighbours, env) => {
    if (pass === 'animated') return;
    const art = env.art;
    ctx.save();
    ctx.translate(x, y);
    paintFloor(ctx, size, art, neighbours);
    ctx.globalAlpha = FADED_ALPHA;
    paintForbidden(ctx, size, art);
    ctx.globalAlpha = 1;
    const centre = size * HALF;
    const radius = size * FORBID.ringRadius;
    const reachX = Math.cos(FORBID.slashAngle) * radius;
    const reachY = Math.sin(FORBID.slashAngle) * radius;
    ctx.lineCap = 'round';
    ctx.lineWidth = plainLine(size, FORBID.ringWidth);
    ctx.strokeStyle = art.item.forbid.ring;
    ctx.beginPath();
    ctx.arc(centre, centre, radius, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = art.item.forbid.slash;
    ctx.beginPath();
    ctx.moveTo(centre + reachX, centre + reachY);
    ctx.lineTo(centre - reachX, centre - reachY);
    ctx.stroke();
    ctx.restore();
  };
}

/** Colour channels of the forbidden keys. */
const KEY_CHANNELS: readonly RunewardKeyColour[] = ['red', 'blue', 'yellow', 'green'];
/** Boots kinds with a forbidden marker. */
const FORBID_BOOTS: readonly RunewardBootsKind[] = ['ice', 'water', 'fire', 'force'];
/** Every boots kind. */
const ALL_BOOTS: readonly RunewardBootsKind[] = ['water', 'fire', 'ice', 'force', 'speed', 'eye', 'pull', 'ward'];

/** Boots kind whose item id is its own name rather than `boots_<kind>`. */
const WARD_KIND: RunewardBootsKind = 'ward';

/** Item id of a boots kind: the ward is the one pair whose id does not start with `boots_`. */
function bootsItemId(kind: RunewardBootsKind): string {
  return kind === WARD_KIND ? WARD_KIND : `boots_${kind}`;
}

/** Wraps a clocked drawing as an item painter: it follows the Runeward clock, frozen under reduced motion. */
function clocked(draw: ClockedDrawing): RunewardItemPainter {
  return (ctx, x, y, size, env) => {
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, size, env.art, runewardClockMs(env));
    ctx.restore();
  };
}

/** Painters by item ids; an id moves here from PENDING when its painter lands. */
export const ITEMS: Readonly<Record<string, RunewardItemPainter>> = {
  ...Object.fromEntries(
    ALL_BOOTS.map((kind): [string, RunewardItemPainter] => [
      bootsItemId(kind),
      clocked((ctx, size, art, timeMs) => paintBootsItem(ctx, size, art, kind, timeMs))
    ])
  ),
  slow_time: clocked(paintSlowTimeItem),
  bomb: clocked(paintBombItem),
  charge: clocked(chargeItem(false)),
  charge_lit: clocked(chargeItem(true)),
  pocket_gate: clocked(paintGateItem),
  hurl_stone: clocked(paintStoneItem),
  toll_token: clocked(paintTollTokenItem),
  score_10: clocked(scoreItem(COIN.one)),
  score_100: clocked(scoreItem(COIN.two)),
  score_1000: clocked(scoreItem(COIN.three)),
  score_2x: clocked(paintScoreDoubleItem),
  stopwatch_bonus: clocked(stopwatchItem('plus')),
  stopwatch_penalty: clocked(stopwatchItem('minus'))
};

/** Painters of the forbidden markers by tile id (terrain layer); the tile dispatch in runewardTiles.ts spreads this table. */
export const TILES: Readonly<Record<string, RunewardTilePainter>> = {
  ...Object.fromEntries(
    KEY_CHANNELS.map((colour): [string, RunewardTilePainter] => [
      `forbid_key_${colour}`,
      forbidTile((ctx, size, art) => paintKeyItem(ctx, size, art, colour, 0))
    ])
  ),
  ...Object.fromEntries(
    FORBID_BOOTS.map((kind): [string, RunewardTilePainter] => [
      `forbid_boots_${kind}`,
      forbidTile((ctx, size, art) => paintBootsItem(ctx, size, art, kind, 0))
    ])
  )
};

/** Ids this module still leaves to the shared drawing: none. */
export const PENDING: readonly string[] = [];
