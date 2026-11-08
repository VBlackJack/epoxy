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
 * Floor marks and small creatures of the Runeward style: gravel, dirt, hints, recessed walls, block targets,
 * slime, turtles, thieves, floating blocks, the flame and swap buttons and the signal tiles.
 * Every id of this module is painted here; PENDING is empty. The dispatch in runewardTiles.ts reads the table
 * and PENDING, so no other file changes. The proportions below are the drawings themselves, the way pixel art
 * is data: they are art, not settings. Every colour comes from the art config (game.json runewardArt).
 */

import type { RunewardArtConfig, RunewardKeyColour } from '../../../core/types';
import { paintColorGlyph } from '../../colorGlyph';
import { BUTTON_GLYPH_KEYS } from '../../paletteKeys';
import { paintSignalTile, SIGNAL_TILE_KINDS, type SignalTileColors, type SignalTileStyle } from '../../signalTilePainter';
import type { TileNeighbours } from '../../tileNeighbours';
import { INK, inkUnit } from './runewardInk';
import { paintButton } from './runewardMechanisms';
import { linear, paintFloor, paintWater, radial, roundRect, tileHash, wave } from './runewardPainters';
import { runewardClockMs, type RunewardPaintEnv } from './runewardEnv';
import type { RunewardTilePainter, RunewardTilePass } from './runewardTiles';

type Art = Readonly<RunewardArtConfig>;
type Neighbours = Readonly<TileNeighbours>;

const TAU = Math.PI * 2;
/** Middle of the cell, as a fraction of its size. */
const HALF = 0.5;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;
/** Width of the outline of a mark, in tiles. */
const OUTLINE = 0.025;

/** A tile drawing at a clock value, for the part of the tile the pass asks for. */
type MarkDrawing = (ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours, env: RunewardPaintEnv, timeMs: number, pass: RunewardTilePass) => void;

/** A tile painter for a motionless tile: drawn with the cached terrain, nothing for the animated pass. */
function staticMark(draw: MarkDrawing): RunewardTilePainter {
  return (ctx, x, y, size, pass, nb, env) => {
    if (pass === 'animated') return;
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, size, env.art, nb, env, 0, pass);
    ctx.restore();
  };
}

/** A tile painter for a moving tile: the cached terrain holds its frame at clock 0, the overlay follows the clock. */
function movingMark(draw: MarkDrawing): RunewardTilePainter {
  return (ctx, x, y, size, pass, nb, env) => {
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, size, env.art, nb, env, pass === 'static' ? 0 : runewardClockMs(env), pass);
    ctx.restore();
  };
}

/** Outline of the current path in the colour and width of a mark. */
function outline(ctx: CanvasRenderingContext2D, size: number, colour: string): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * OUTLINE);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Fills and outlines an ellipse centred at (cx, cy), in tiles. */
function ellipse(ctx: CanvasRenderingContext2D, size: number, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(size * cx, size * cy, size * rx, size * ry, 0, 0, TAU);
}

// ---- Gravel -----------------------------------------------------------------------------------

const GRAVEL = {
  bedInset: 0.1,
  bedCorner: 0.12,
  pebbleCount: 9,
  pebbleSalt: 41,
  pebbleMargin: 0.22,
  pebbleMinRadius: 0.05,
  pebbleRadiusSpan: 0.04,
  pebbleSquash: 0.75,
  highlightAlpha: 0.7,
  highlightShrink: 0.45
} as const;

/** Gravel: a bed of stones with pebbles scattered from the cell hash. */
function paintGravel(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours): void {
  const { gravel } = art.mark;
  paintFloor(ctx, size, art, nb);
  const inset = size * GRAVEL.bedInset;
  ctx.fillStyle = gravel.base;
  roundRect(ctx, inset, inset, size - inset * 2, size - inset * 2, size * GRAVEL.bedCorner);
  ctx.fill();
  outline(ctx, size, gravel.edge);
  const span = 1 - GRAVEL.pebbleMargin * 2;
  for (let i = 0; i < GRAVEL.pebbleCount; i += 1) {
    const h = tileHash(nb.hash, GRAVEL.pebbleSalt + i);
    const px = GRAVEL.pebbleMargin + inkUnit(h, INK.shiftA) * span;
    const py = GRAVEL.pebbleMargin + inkUnit(h, INK.shiftB) * span;
    const r = GRAVEL.pebbleMinRadius + inkUnit(h, INK.shiftC) * GRAVEL.pebbleRadiusSpan;
    ellipse(ctx, size, px, py, r, r * GRAVEL.pebbleSquash);
    ctx.fillStyle = i % 2 === 0 ? gravel.light : gravel.dark;
    ctx.fill();
    outline(ctx, size, gravel.edge);
    ellipse(ctx, size, px - r * GRAVEL.highlightShrink, py - r * GRAVEL.highlightShrink, r * GRAVEL.highlightShrink, r * GRAVEL.highlightShrink * GRAVEL.pebbleSquash);
    ctx.globalAlpha = GRAVEL.highlightAlpha;
    ctx.fillStyle = gravel.base;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---- Dirt -------------------------------------------------------------------------------------

const DIRT = {
  blobVertices: 16,
  blobSalt: 71,
  /** Share of the way from the centre to the cell border reached by the patch edge, before jitter. */
  blobReach: 0.9,
  blobJitter: 0.07,
  edgeAlpha: 0.55,
  grainCount: 16,
  grainSalt: 101,
  grainSpread: 0.8,
  grainLength: 0.07,
  grainWidth: 0.018,
  grainAlpha: 0.55,
  clodCount: 7,
  clodSalt: 83,
  clodSpread: 0.7,
  clodRadius: 0.06,
  clodRadiusSpan: 0.035,
  clodSquash: 0.7,
  crescentFrom: Math.PI * 1.1,
  crescentTo: Math.PI * 1.75,
  crescentWidth: 0.02,
  pebbleCount: 4,
  pebbleSalt: 131,
  pebbleSpread: 0.64,
  pebbleRadius: 0.03,
  pebbleRadiusSpan: 0.02,
  pebbleSquash: 0.8
} as const;

/** Dirt: loose earth filling the cell with soft ragged edges, grain, clods and pebbles, shaped from the cell hash. */
function paintDirt(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours): void {
  const { dirt } = art.mark;
  paintFloor(ctx, size, art, nb);
  const points: Array<[number, number]> = [];
  for (let k = 0; k < DIRT.blobVertices; k += 1) {
    const h = tileHash(nb.hash, DIRT.blobSalt + k);
    const angle = (k / DIRT.blobVertices) * TAU;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Distance from the centre to the cell border along this direction, so the patch follows the square cell.
    const toBorder = HALF / Math.max(Math.abs(cos), Math.abs(sin));
    const reach = toBorder * (DIRT.blobReach + (inkUnit(h, INK.shiftA) - HALF) * DIRT.blobJitter * 2);
    points.push([size * (HALF + cos * reach), size * (HALF + sin * reach)]);
  }
  // Closed curve through the midpoints of the polygon sides, which softens the edge.
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.moveTo((last[0] + points[0][0]) / 2, (last[1] + points[0][1]) / 2);
  for (let k = 0; k < points.length; k += 1) {
    const here = points[k];
    const next = points[(k + 1) % points.length];
    ctx.quadraticCurveTo(here[0], here[1], (here[0] + next[0]) / 2, (here[1] + next[1]) / 2);
  }
  ctx.closePath();
  ctx.fillStyle = dirt.base;
  ctx.fill();
  ctx.globalAlpha = DIRT.edgeAlpha;
  outline(ctx, size, dirt.edge);
  ctx.globalAlpha = 1;
  // Darker grain: short strokes scattered over the patch.
  ctx.strokeStyle = dirt.dark;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * DIRT.grainWidth);
  ctx.lineCap = 'round';
  ctx.globalAlpha = DIRT.grainAlpha;
  for (let i = 0; i < DIRT.grainCount; i += 1) {
    const h = tileHash(nb.hash, DIRT.grainSalt + i);
    const gx = HALF + (inkUnit(h, INK.shiftA) - HALF) * DIRT.grainSpread;
    const gy = HALF + (inkUnit(h, INK.shiftB) - HALF) * DIRT.grainSpread;
    const tilt = (inkUnit(h, INK.shiftC) - HALF) * Math.PI;
    const dx = Math.cos(tilt) * DIRT.grainLength * HALF;
    const dy = Math.sin(tilt) * DIRT.grainLength * HALF;
    ctx.beginPath();
    ctx.moveTo(size * (gx - dx), size * (gy - dy));
    ctx.lineTo(size * (gx + dx), size * (gy + dy));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < DIRT.clodCount; i += 1) {
    const h = tileHash(nb.hash, DIRT.clodSalt + i);
    const px = HALF + (inkUnit(h, INK.shiftA) - HALF) * DIRT.clodSpread;
    const py = HALF + (inkUnit(h, INK.shiftB) - HALF) * DIRT.clodSpread;
    const r = DIRT.clodRadius + inkUnit(h, INK.shiftC) * DIRT.clodRadiusSpan;
    ellipse(ctx, size, px, py, r, r * DIRT.clodSquash);
    ctx.fillStyle = dirt.dark;
    ctx.fill();
    ctx.strokeStyle = dirt.light;
    ctx.lineWidth = Math.max(MIN_LINE_PX, size * DIRT.crescentWidth);
    ctx.beginPath();
    ctx.ellipse(size * px, size * py, size * r, size * r * DIRT.clodSquash, 0, DIRT.crescentFrom, DIRT.crescentTo);
    ctx.stroke();
  }
  for (let i = 0; i < DIRT.pebbleCount; i += 1) {
    const h = tileHash(nb.hash, DIRT.pebbleSalt + i);
    const px = HALF + (inkUnit(h, INK.shiftA) - HALF) * DIRT.pebbleSpread;
    const py = HALF + (inkUnit(h, INK.shiftB) - HALF) * DIRT.pebbleSpread;
    const r = DIRT.pebbleRadius + inkUnit(h, INK.shiftC) * DIRT.pebbleRadiusSpan;
    ellipse(ctx, size, px, py, r, r * DIRT.pebbleSquash);
    ctx.fillStyle = dirt.light;
    ctx.fill();
    outline(ctx, size, dirt.edge);
  }
}

// ---- Hint (scroll) ----------------------------------------------------------------------------

const HINT = {
  shadow: { x: 0.5, y: 0.8, rx: 0.26, ry: 0.06 },
  sheet: { x: 0.26, y: 0.28, w: 0.48, h: 0.44, corner: 0.04 },
  roll: { x: 0.2, w: 0.6, h: 0.08, topY: 0.22, bottomY: 0.7, corner: 0.04 },
  haloRadius: 0.42,
  haloAlpha: 0.25,
  /** The question mark, drawn as a hook, a stem and a dot. */
  mark: { hookX: 0.5, hookY: 0.43, hookRadius: 0.075, hookFrom: Math.PI * 1.05, hookTo: Math.PI * 2.45, stemEndY: 0.55, dotY: 0.63, dotRadius: 0.025, width: 0.05 }
} as const;

/** The Runeward scroll with a question mark drawn as a shape (no font): a hint. */
function paintHint(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours): void {
  const { hint } = art.mark;
  paintFloor(ctx, size, art, nb);
  ctx.fillStyle = art.mage.shadow;
  ellipse(ctx, size, HINT.shadow.x, HINT.shadow.y, HINT.shadow.rx, HINT.shadow.ry);
  ctx.fill();
  ctx.fillStyle = hint.base;
  roundRect(ctx, size * HINT.sheet.x, size * HINT.sheet.y, size * HINT.sheet.w, size * HINT.sheet.h, size * HINT.sheet.corner);
  ctx.fill();
  outline(ctx, size, hint.glow);
  ctx.fillStyle = hint.glow;
  for (const top of [HINT.roll.topY, HINT.roll.bottomY]) {
    roundRect(ctx, size * HINT.roll.x, size * top, size * HINT.roll.w, size * HINT.roll.h, size * HINT.roll.corner);
    ctx.fill();
  }
  ctx.fillStyle = radial(ctx, size * HALF, size * HALF, size * HINT.haloRadius, [[0, hint.glow], [1, art.clear]]);
  ctx.globalAlpha = HINT.haloAlpha;
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  const m = HINT.mark;
  ctx.strokeStyle = hint.core;
  ctx.fillStyle = hint.core;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * m.width);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(size * m.hookX, size * m.hookY, size * m.hookRadius, m.hookFrom, m.hookTo);
  ctx.lineTo(size * m.hookX, size * m.stemEndY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(size * m.hookX, size * m.dotY, size * m.dotRadius, 0, TAU);
  ctx.fill();
}

// ---- Recessed wall ----------------------------------------------------------------------------

const RECESS = {
  frameInset: 0.07,
  frameCorner: 0.07,
  slabInset: 0.15,
  slabCorner: 0.05,
  /** Where the shaded top-left of the sunken slab fades into its main colour. */
  shadeStop: 0.4,
  bevelWidth: 0.035,
  crackFrom: { x: 0.34, y: 0.62 },
  crackMid: { x: 0.46, y: 0.5 },
  crackTo: { x: 0.42, y: 0.38 }
} as const;

/** A recessed wall: a slab sunk in a frame, shaded where the rim hides it. It stays visible; it is not a hidden wall. */
function paintRecessedWall(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours): void {
  const { recessedWall } = art.mark;
  paintFloor(ctx, size, art, nb);
  const frame = size * RECESS.frameInset;
  ctx.fillStyle = recessedWall.dark;
  roundRect(ctx, frame, frame, size - frame * 2, size - frame * 2, size * RECESS.frameCorner);
  ctx.fill();
  outline(ctx, size, recessedWall.edge);
  const slab = size * RECESS.slabInset;
  const slabSize = size - slab * 2;
  ctx.fillStyle = linear(ctx, slab, slab, size - slab, size - slab, [[0, recessedWall.dark], [RECESS.shadeStop, recessedWall.base], [1, recessedWall.base]]);
  roundRect(ctx, slab, slab, slabSize, slabSize, size * RECESS.slabCorner);
  ctx.fill();
  outline(ctx, size, recessedWall.edge);
  ctx.strokeStyle = recessedWall.light;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * RECESS.bevelWidth);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(slab + size * RECESS.slabCorner, size - slab);
  ctx.lineTo(size - slab, size - slab);
  ctx.lineTo(size - slab, slab + size * RECESS.slabCorner);
  ctx.stroke();
  ctx.strokeStyle = recessedWall.edge;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * OUTLINE);
  ctx.beginPath();
  ctx.moveTo(size * RECESS.crackFrom.x, size * RECESS.crackFrom.y);
  ctx.lineTo(size * RECESS.crackMid.x, size * RECESS.crackMid.y);
  ctx.lineTo(size * RECESS.crackTo.x, size * RECESS.crackTo.y);
  ctx.stroke();
}

// ---- Block target -----------------------------------------------------------------------------

const TARGET = {
  inset: 0.2,
  corner: 0.04,
  rimWidth: 0.045,
  innerInset: 0.34,
  innerWidth: 0.025,
  innerAlpha: 0.8,
  haloRadius: 0.5,
  haloAlpha: 0.22,
  tick: 0.07
} as const;

/** The target of a block: a square inlaid in the floor, rimmed with light. */
function paintBlockTarget(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours): void {
  const { blockTarget } = art.mark;
  paintFloor(ctx, size, art, nb);
  const inset = size * TARGET.inset;
  ctx.fillStyle = blockTarget.base;
  roundRect(ctx, inset, inset, size - inset * 2, size - inset * 2, size * TARGET.corner);
  ctx.fill();
  ctx.strokeStyle = blockTarget.glow;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * TARGET.rimWidth);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = radial(ctx, size * HALF, size * HALF, size * TARGET.haloRadius, [[0, blockTarget.glow], [1, art.clear]]);
  ctx.globalAlpha = TARGET.haloAlpha;
  ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.globalAlpha = TARGET.innerAlpha;
  ctx.strokeStyle = blockTarget.core;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * TARGET.innerWidth);
  const inner = size * TARGET.innerInset;
  ctx.strokeRect(inner, inner, size - inner * 2, size - inner * 2);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  const tick = size * TARGET.tick;
  for (const [cx, cy] of [[inset, inset], [size - inset, inset], [inset, size - inset], [size - inset, size - inset]]) {
    ctx.moveTo(cx - Math.sign(cx - size * HALF) * tick, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy - Math.sign(cy - size * HALF) * tick);
  }
  ctx.stroke();
}

// ---- Slime ------------------------------------------------------------------------------------

const SLIME = {
  rim: [{ x: 0.5, y: 0.56, rx: 0.37, ry: 0.25 }, { x: 0.34, y: 0.5, rx: 0.25, ry: 0.2 }, { x: 0.68, y: 0.5, rx: 0.22, ry: 0.18 }],
  rimGrow: 0.03,
  shine: { x: 0.4, y: 0.5, rx: 0.1, ry: 0.045, alpha: 0.7 },
  bubbleCount: 2,
  bubbleSalt: 97,
  bubbleReach: 0.2,
  bubbleRadius: 0.04,
  bubbleWidth: 0.02
} as const;

/** An ooze puddle with a shine and a couple of bubbles placed from the cell hash. */
function paintSlime(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours): void {
  const { slime } = art.mark;
  paintFloor(ctx, size, art, nb);
  ctx.fillStyle = slime.glow;
  for (const lobe of SLIME.rim) {
    ellipse(ctx, size, lobe.x, lobe.y, lobe.rx + SLIME.rimGrow, lobe.ry + SLIME.rimGrow);
    ctx.fill();
  }
  ctx.fillStyle = slime.base;
  for (const lobe of SLIME.rim) {
    ellipse(ctx, size, lobe.x, lobe.y, lobe.rx, lobe.ry);
    ctx.fill();
  }
  ctx.globalAlpha = SLIME.shine.alpha;
  ctx.fillStyle = slime.core;
  ellipse(ctx, size, SLIME.shine.x, SLIME.shine.y, SLIME.shine.rx, SLIME.shine.ry);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = slime.glow;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * SLIME.bubbleWidth);
  for (let i = 0; i < SLIME.bubbleCount; i += 1) {
    const h = tileHash(nb.hash, SLIME.bubbleSalt + i);
    const angle = inkUnit(h, INK.shiftA) * TAU;
    const reach = SLIME.bubbleReach * inkUnit(h, INK.shiftB);
    ctx.beginPath();
    ctx.arc(size * (HALF + Math.cos(angle) * reach), size * (HALF + Math.sin(angle) * reach), size * SLIME.bubbleRadius, 0, TAU);
    ctx.stroke();
  }
}

// ---- Turtle -----------------------------------------------------------------------------------

const TURTLE = {
  shell: { x: 0.5, y: 0.54, rx: 0.3, ry: 0.23 },
  underDrop: 0.035,
  head: { x: 0.5, y: 0.26, radius: 0.08 },
  flippers: [{ x: 0.24, y: 0.4 }, { x: 0.76, y: 0.4 }, { x: 0.27, y: 0.7 }, { x: 0.73, y: 0.7 }],
  flipperRadius: 0.07,
  moss: [{ x: 0.4, y: 0.48, r: 0.07 }, { x: 0.6, y: 0.6, r: 0.06 }, { x: 0.52, y: 0.4, r: 0.04 }],
  mossAlpha: 0.85,
  plateLines: 2,
  plateLineSpread: 0.14,
  ripple: { rx: 0.4, ry: 0.31, alpha: 0.6, growth: 0.04, width: 0.02 }
} as const;

/** A mossy drift stone with a turtle's head and flippers, bobbing on the water; frozen when the clock is. */
function paintTurtleOnWater(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours, timeMs: number, pass: RunewardTilePass): void {
  // The overlay repaints the whole water, so the turtle of the cached terrain never shows as a trail.
  paintWater(ctx, size, art, nb, timeMs, pass === 'animated' ? 'all' : pass);
  const { turtle } = art.mark;
  const pulse = wave(timeMs, art.animation.flowPeriodMs);
  const bob = Math.sin((timeMs / art.animation.bobPeriodMs) * TAU) * art.animation.bobAmplitude;
  const s = TURTLE.shell;
  ctx.strokeStyle = art.water.crest;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * TURTLE.ripple.width);
  ctx.globalAlpha = TURTLE.ripple.alpha * (1 - pulse * HALF);
  ellipse(ctx, size, s.x, s.y, TURTLE.ripple.rx + pulse * TURTLE.ripple.growth, TURTLE.ripple.ry + pulse * TURTLE.ripple.growth);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(0, size * bob);
  ctx.fillStyle = turtle.dark;
  for (const f of TURTLE.flippers) {
    ellipse(ctx, size, f.x, f.y, TURTLE.flipperRadius, TURTLE.flipperRadius);
    ctx.fill();
    outline(ctx, size, turtle.edge);
  }
  ellipse(ctx, size, TURTLE.head.x, TURTLE.head.y, TURTLE.head.radius, TURTLE.head.radius);
  ctx.fillStyle = turtle.light;
  ctx.fill();
  outline(ctx, size, turtle.edge);
  ellipse(ctx, size, s.x, s.y + TURTLE.underDrop, s.rx, s.ry);
  ctx.fillStyle = turtle.dark;
  ctx.fill();
  outline(ctx, size, turtle.edge);
  ellipse(ctx, size, s.x, s.y, s.rx, s.ry);
  ctx.fillStyle = turtle.base;
  ctx.fill();
  outline(ctx, size, turtle.edge);
  ctx.strokeStyle = turtle.dark;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * OUTLINE);
  ctx.beginPath();
  for (let i = 0; i < TURTLE.plateLines; i += 1) {
    const offset = (i - (TURTLE.plateLines - 1) / 2) * TURTLE.plateLineSpread * 2;
    ctx.moveTo(size * (s.x + offset), size * (s.y - s.ry * HALF));
    ctx.lineTo(size * (s.x + offset), size * (s.y + s.ry * HALF));
  }
  ctx.stroke();
  ctx.globalAlpha = TURTLE.mossAlpha;
  ctx.fillStyle = turtle.light;
  for (const m of TURTLE.moss) {
    ellipse(ctx, size, m.x, m.y, m.r, m.r);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---- Thief ------------------------------------------------------------------------------------

const THIEF = {
  shadow: { x: 0.5, y: 0.82, rx: 0.24, ry: 0.06 },
  post: { x: 0.47, y: 0.22, w: 0.06, h: 0.6 },
  hook: { x: 0.56, y: 0.22, radius: 0.08, from: Math.PI * 0.9, to: Math.PI * 2.1, width: 0.04 },
  cloak: { topX: 0.5, topY: 0.3, leftX: 0.26, rightX: 0.62, hemY: 0.76, hemWave: 0.04, foldX: 0.44 },
  purse: { x: 0.7, y: 0.56, radius: 0.085, neckW: 0.07, neckH: 0.05, tieY: 0.47 },
  tag: { x: 0.12, y: 0.34, w: 0.17, h: 0.12, corner: 0.03, holeX: 0.19, holeY: 0.4, holeRadius: 0.025, stringToX: 0.47, stringToY: 0.28 }
} as const;

/** A cloak and a purse on a hook; the keys variant adds a key tag hung beside them. */
function paintThief(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours, withKeys: boolean): void {
  const { thief } = art.mark;
  paintFloor(ctx, size, art, nb);
  ctx.fillStyle = art.mage.shadow;
  ellipse(ctx, size, THIEF.shadow.x, THIEF.shadow.y, THIEF.shadow.rx, THIEF.shadow.ry);
  ctx.fill();
  const post = THIEF.post;
  ctx.fillStyle = thief.dark;
  ctx.fillRect(size * post.x, size * post.y, size * post.w, size * post.h);
  ctx.strokeStyle = thief.light;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * THIEF.hook.width);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(size * THIEF.hook.x, size * THIEF.hook.y, size * THIEF.hook.radius, THIEF.hook.from, THIEF.hook.to);
  ctx.stroke();
  const c = THIEF.cloak;
  ctx.beginPath();
  ctx.moveTo(size * c.topX, size * c.topY);
  ctx.lineTo(size * c.leftX, size * c.hemY);
  ctx.quadraticCurveTo(size * ((c.leftX + c.rightX) / 2), size * (c.hemY - c.hemWave * 2), size * c.rightX, size * c.hemY);
  ctx.closePath();
  ctx.fillStyle = thief.base;
  ctx.fill();
  outline(ctx, size, thief.light);
  ctx.strokeStyle = thief.dark;
  ctx.beginPath();
  ctx.moveTo(size * c.topX, size * c.topY);
  ctx.lineTo(size * c.foldX, size * c.hemY - size * c.hemWave);
  ctx.stroke();
  const p = THIEF.purse;
  ctx.fillStyle = thief.light;
  ctx.beginPath();
  ctx.arc(size * p.x, size * p.y, size * p.radius, 0, TAU);
  ctx.fill();
  outline(ctx, size, thief.edge);
  ctx.fillStyle = thief.dark;
  ctx.fillRect(size * (p.x - p.neckW / 2), size * (p.y - p.radius - p.neckH / 2), size * p.neckW, size * p.neckH);
  ctx.strokeStyle = thief.light;
  ctx.beginPath();
  ctx.moveTo(size * p.x, size * p.tieY);
  ctx.lineTo(size * c.topX, size * c.topY);
  ctx.stroke();
  if (!withKeys) return;
  const t = THIEF.tag;
  ctx.strokeStyle = thief.light;
  ctx.beginPath();
  ctx.moveTo(size * (t.x + t.w), size * t.y);
  ctx.lineTo(size * t.stringToX, size * t.stringToY);
  ctx.stroke();
  ctx.fillStyle = thief.light;
  roundRect(ctx, size * t.x, size * t.y, size * t.w, size * t.h, size * t.corner);
  ctx.fill();
  outline(ctx, size, thief.edge);
  ctx.fillStyle = thief.dark;
  ctx.beginPath();
  ctx.arc(size * t.holeX, size * t.holeY, size * t.holeRadius, 0, TAU);
  ctx.fill();
}

// ---- Floating blocks --------------------------------------------------------------------------

const FLOATING = {
  frameInset: 0.12,
  frameCorner: 0.08,
  slabInset: 0.18,
  slabCorner: 0.06,
  lightStop: 0.3,
  glyphRadius: 0.16
} as const;

/** Water with a coloured slab sunk in it, carrying the glyph of its colour. */
function paintFloatingBlock(ctx: CanvasRenderingContext2D, size: number, art: Art, nb: Neighbours, colour: RunewardKeyColour): void {
  const tint = art.keys[colour];
  const { recessedWall } = art.mark;
  paintWater(ctx, size, art, nb, 0, 'all');
  const frame = size * FLOATING.frameInset;
  ctx.fillStyle = recessedWall.dark;
  roundRect(ctx, frame, frame, size - frame * 2, size - frame * 2, size * FLOATING.frameCorner);
  ctx.fill();
  outline(ctx, size, recessedWall.edge);
  const slab = size * FLOATING.slabInset;
  ctx.fillStyle = linear(ctx, 0, slab, 0, size - slab, [[0, tint.light], [FLOATING.lightStop, tint.main], [1, tint.main]]);
  roundRect(ctx, slab, slab, size - slab * 2, size - slab * 2, size * FLOATING.slabCorner);
  ctx.fill();
  outline(ctx, size, recessedWall.edge);
  paintColorGlyph(ctx, colour, size * HALF, size * HALF, size * FLOATING.glyphRadius, tint.glyph);
}

/** Colour channel of each floating block tile, by tile id. */
export const FLOATING_BLOCK_COLOURS: Readonly<Record<string, RunewardKeyColour>> = {
  floating_block_red: 'red',
  floating_block_green: 'green',
  floating_block_blue: 'blue',
  floating_block_yellow: 'yellow'
};

// ---- Signal tiles -----------------------------------------------------------------------------

/** The signal symbols keep the shape of the shared drawing: rounded boxes, and no glow (the lit colour carries the state). */
const SIGNAL_STYLE: SignalTileStyle = { rounded: true, glowBlurPx: 0 };

/** The Runeward floor with the shared signal symbol drawn over it in the art's signal colours. */
function signalTile(id: string): RunewardTilePainter {
  const kind = SIGNAL_TILE_KINDS[id];
  return (ctx, x, y, size, pass, nb, env) => {
    if (pass === 'animated') return;
    const { box, idle, lit } = env.art.signal;
    const colors: SignalTileColors = { box, idle, lit };
    ctx.save();
    ctx.translate(x, y);
    paintFloor(ctx, size, env.art, nb);
    paintSignalTile(ctx, 0, 0, size, kind, env.signalPowered, colors, SIGNAL_STYLE, env.signalCount);
    ctx.restore();
  };
}

// ---- Table ------------------------------------------------------------------------------------

/** Painters by tile ids; an id moves here from PENDING when its painter lands. */
export const TILES: Readonly<Record<string, RunewardTilePainter>> = {
  gravel: staticMark((ctx, size, art, nb) => paintGravel(ctx, size, art, nb)),
  dirt: staticMark((ctx, size, art, nb) => paintDirt(ctx, size, art, nb)),
  hint: staticMark((ctx, size, art, nb) => paintHint(ctx, size, art, nb)),
  recessed_wall: staticMark((ctx, size, art, nb) => paintRecessedWall(ctx, size, art, nb)),
  block_target: staticMark((ctx, size, art, nb) => paintBlockTarget(ctx, size, art, nb)),
  slime: staticMark((ctx, size, art, nb) => paintSlime(ctx, size, art, nb)),
  turtle: movingMark((ctx, size, art, nb, _env, timeMs, pass) => paintTurtleOnWater(ctx, size, art, nb, timeMs, pass)),
  thief: staticMark((ctx, size, art, nb) => paintThief(ctx, size, art, nb, false)),
  thief_keys: staticMark((ctx, size, art, nb) => paintThief(ctx, size, art, nb, true)),
  ...Object.fromEntries(
    Object.entries(FLOATING_BLOCK_COLOURS).map(([id, colour]): [string, RunewardTilePainter] => [
      id,
      staticMark((ctx, size, art, nb) => paintFloatingBlock(ctx, size, art, nb, colour))
    ])
  ),
  button_orange: staticMark((ctx, size, art, nb) =>
    paintButton(ctx, size, art, { kind: 'flame', glyphKey: BUTTON_GLYPH_KEYS.button_orange }, nb)
  ),
  button_gray: staticMark((ctx, size, art, nb) =>
    paintButton(ctx, size, art, { kind: 'swap', glyphKey: BUTTON_GLYPH_KEYS.button_gray }, nb)
  ),
  ...Object.fromEntries(Object.keys(SIGNAL_TILE_KINDS).map((id): [string, RunewardTilePainter] => [id, signalTile(id)]))
};

/** Ids this module will paint, still drawn by the shared drawing: none, every id of the module has its painter. */
export const PENDING: readonly string[] = [];
