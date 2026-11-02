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
 * Drawing of the display ids of the cc3d ruleset (public/configs/cc3d-tiles.json) in every render
 * style. The shapes are plain canvas calls in the palette colours, drawn over the style's own floor,
 * so they follow the active style and theme without sprites of their own. Pure module: no DOM.
 */

import type { Direction } from '../core/types';

/** Prefix of every display id that only the cc3d ruleset uses. */
export const CC3D_TILE_PREFIX = 'cc3d_';

const FULL_TURN = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;
const DIRECTION_ANGLE: Readonly<Record<Direction, number>> = { N: 0, E: QUARTER_TURN, S: Math.PI, W: -QUARTER_TURN };
const COLORS = ['red', 'green', 'blue', 'yellow'] as const;
type CellColor = (typeof COLORS)[number];

const OPEN_SUFFIX = '_open';
const PLATE_FAMILY = 'plate_';
const HOLD_DOOR_FAMILY = 'hold_door_';
const TOGGLE_DOOR_FAMILY = 'toggle_door_';
const TOGGLE_CONTROL_FAMILY = 'toggle_control_';
const BLOCK_FAMILY = 'block_';
const REFLECTOR_FAMILY = 'reflector_';
const BOT_FAMILY = 'bot_';
const FISH_EXTRA = 'fish_extra';
const LASER_SHOOTER = 'laser_shooter';
const SHOT = 'shot';
const SOCKET_RED = 'socket_red';
const SAND = 'sand';
const GOLEM_CONTROL = 'golem_control_yellow';
const LASER_CONTROLLER = 'laser_controller';
const BOT_STATIC = 'static';
const BOT_MULTI = 'multi';
const BOT_CLOCKWISE = 'cw';
const MULTI_MARK_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
];

/** Tile-relative geometry (fractions of the tile side) and a few small counts. */
const GEO = {
  shotHalo: 0.22,
  shotCore: 0.11,
  plateInset: 0.2,
  plateRing: 0.14,
  doorInset: 0.08,
  doorPanelInset: 0.2,
  doorSlats: 3,
  frameWidth: 0.07,
  openDash: 3,
  glyphRadius: 0.14,
  controlRadius: 0.3,
  controlInner: 0.22,
  arrowHalf: 0.14,
  arrowOuter: 1.4,
  arrowInner: 0.2,
  blockInset: 0.1,
  blockFaceInset: 0.16,
  blockInner: 0.3,
  blockInnerAlpha: 0.35,
  corner: 0.14,
  socketOuter: 0.08,
  socketInner: 0.3,
  socketCore: 0.4,
  sandStep: 5,
  sandSpeck: 2,
  sandMargin: 3,
  panelInset: 0.14,
  eyeRadius: 0.11,
  eyeCoreDivisor: 2,
  barrelWidth: 0.2,
  barrelLength: 0.42,
  botRadius: 0.3,
  botFace: 0.78,
  botMarkRadius: 0.07,
  botMarkOffset: 0.12,
  botMultiMark: 0.8,
  botArc: 0.2,
  botArcStart: 0.2,
  botArcEnd: 1.5,
  botArrow: 1.4,
  fishBodyRx: 0.3,
  fishBodyRy: 0.18,
  fishTail: 0.18,
  fishTailJoin: 0.8,
  fishEyeX: 0.5,
  fishEyeY: 0.2,
  fishEye: 0.04,
  badgeRadius: 0.13,
  badgeRim: 1.25,
  badgeInset: 0.2
} as const;

/** Mobs drawn as an existing monster with a mark: the monster, its scale and the mark colour key. */
export interface Cc3dMobBase {
  readonly base: string;
  readonly scale: number;
  readonly badge: string | null;
}

const BABY_SCALE = 0.62;
const FULL_SCALE = 1;

export const CC3D_MOB_BASES: Readonly<Record<string, Cc3dMobBase>> = {
  cc3d_legs_green: { base: 'walker', scale: FULL_SCALE, badge: 'green' },
  cc3d_legs_red: { base: 'walker', scale: FULL_SCALE, badge: 'red' },
  cc3d_baby_blinky: { base: 'glider', scale: BABY_SCALE, badge: null },
  cc3d_baby_screamer: { base: 'fireball', scale: BABY_SCALE, badge: null },
  cc3d_golem_yellow: { base: 'tank', scale: FULL_SCALE, badge: 'yellow' }
};

/** What the painters need from the renderer. */
export interface Cc3dPaintTools {
  readonly pal: Readonly<Record<string, string>>;
  /** Colour-blind glyph of a colour key, centred on (cx, cy). */
  glyph(colorKey: string, cx: number, cy: number, radius: number, fill: string): void;
}

/** True for a display id that only the cc3d ruleset uses. */
export function isCc3dId(id: string): boolean {
  return id.startsWith(CC3D_TILE_PREFIX);
}

/** The colour a name carries after `family` (plate_red gives red), or null. */
function colorAfter(name: string, family: string): CellColor | null {
  for (const color of COLORS) {
    if (name.startsWith(`${family}${color}`)) return color;
  }
  return null;
}

function roundedSquare(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + side, y, x + side, y + side, radius);
  ctx.arcTo(x + side, y + side, x, y + side, radius);
  ctx.arcTo(x, y + side, x, y, radius);
  ctx.arcTo(x, y, x + side, y, radius);
  ctx.closePath();
}

function paintPlate(ctx: CanvasRenderingContext2D, color: CellColor, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const inset = size * GEO.plateInset;
  ctx.fillStyle = tools.pal.wallShadow;
  roundedSquare(ctx, x + inset, y + inset, size - inset * 2, size * GEO.corner);
  ctx.fill();
  const ring = size * GEO.plateRing;
  ctx.fillStyle = tools.pal[color];
  roundedSquare(ctx, x + inset + ring / 2, y + inset + ring / 2, size - inset * 2 - ring, (size * GEO.corner) / 2);
  ctx.fill();
  tools.glyph(color, x + size / 2, y + size / 2, size * GEO.glyphRadius, tools.pal.wallShadow);
}

/** An open door is only the dashed outline of its frame. */
function paintOpenFrame(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, size: number): void {
  const inset = size * GEO.doorInset;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * GEO.frameWidth);
  ctx.setLineDash([GEO.openDash, GEO.openDash]);
  ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  ctx.setLineDash([]);
  ctx.restore();
}

/** A shut hold door has slats in its colour. */
function paintHoldDoor(ctx: CanvasRenderingContext2D, color: CellColor, open: boolean, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  if (open) {
    paintOpenFrame(ctx, tools.pal[color], x, y, size);
    return;
  }
  const inset = size * GEO.doorInset;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  const pad = size * GEO.doorPanelInset;
  const slatHeight = (size - pad * 2) / (GEO.doorSlats * 2 - 1);
  ctx.fillStyle = tools.pal[color];
  for (let i = 0; i < GEO.doorSlats; i++) {
    ctx.fillRect(x + pad, y + pad + i * slatHeight * 2, size - pad * 2, slatHeight);
  }
}

/** A shut toggle door is a solid slab with a border in its colour. */
function paintToggleDoor(ctx: CanvasRenderingContext2D, color: CellColor, open: boolean, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  if (open) {
    paintOpenFrame(ctx, tools.pal[color], x, y, size);
    return;
  }
  const inset = size * GEO.doorInset;
  ctx.fillStyle = tools.pal[color];
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  const panel = size * GEO.doorPanelInset;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.fillRect(x + panel, y + panel, size - panel * 2, size - panel * 2);
  tools.glyph(color, x + size / 2, y + size / 2, size * GEO.glyphRadius, tools.pal[color]);
}

/** A round control in a colour, marked with two opposed arrow heads: it flips the doors. */
function paintControl(ctx: CanvasRenderingContext2D, color: CellColor, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.controlRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tools.pal[color];
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.controlInner, 0, FULL_TURN);
  ctx.fill();
  const half = size * GEO.arrowHalf;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.beginPath();
  ctx.moveTo(cx - half * GEO.arrowOuter, cy);
  ctx.lineTo(cx - half * GEO.arrowInner, cy - half);
  ctx.lineTo(cx - half * GEO.arrowInner, cy + half);
  ctx.moveTo(cx + half * GEO.arrowOuter, cy);
  ctx.lineTo(cx + half * GEO.arrowInner, cy - half);
  ctx.lineTo(cx + half * GEO.arrowInner, cy + half);
  ctx.fill();
}

function paintColorBlock(ctx: CanvasRenderingContext2D, color: CellColor, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const inset = size * GEO.blockInset;
  ctx.fillStyle = tools.pal.wallShadow;
  roundedSquare(ctx, x + inset, y + inset, size - inset * 2, size * GEO.corner);
  ctx.fill();
  const face = size * GEO.blockFaceInset;
  ctx.fillStyle = tools.pal[color];
  roundedSquare(ctx, x + face, y + face, size - face * 2, size * GEO.corner);
  ctx.fill();
  const inner = size * GEO.blockInner;
  ctx.save();
  ctx.globalAlpha = GEO.blockInnerAlpha;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.fillRect(x + inner, y + inner, size - inner * 2, size - inner * 2);
  ctx.restore();
}

/** A corner reflector: the triangle that fills the two named sides of the cell, with a shiny edge. */
function paintReflector(ctx: CanvasRenderingContext2D, mirror: string, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const near = size * GEO.doorInset;
  const left = x + near;
  const right = x + size - near;
  const top = y + near;
  const bottom = y + size - near;
  const cornerX = mirror.includes('r') ? right : left;
  const cornerY = mirror.includes('d') ? bottom : top;
  const otherX = cornerX === left ? right : left;
  const otherY = cornerY === top ? bottom : top;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.beginPath();
  ctx.moveTo(cornerX, cornerY);
  ctx.lineTo(otherX, cornerY);
  ctx.lineTo(cornerX, otherY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = tools.pal.laserBeamCore;
  ctx.lineWidth = Math.max(1, size * GEO.frameWidth);
  ctx.beginPath();
  ctx.moveTo(otherX, cornerY);
  ctx.lineTo(cornerX, otherY);
  ctx.stroke();
}

function paintSocket(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const outer = size * GEO.socketOuter;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.fillRect(x + outer, y + outer, size - outer * 2, size - outer * 2);
  const inner = size * GEO.socketInner;
  ctx.fillStyle = tools.pal.red;
  ctx.fillRect(x + inner, y + inner, size - inner * 2, size - inner * 2);
  const core = size * GEO.socketCore;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.fillRect(x + core, y + core, size - core * 2, size - core * 2);
}

function paintSand(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  ctx.fillStyle = tools.pal.dirtBase;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = tools.pal.dirtSpeck;
  const step = Math.max(GEO.sandStep, Math.floor(size / GEO.sandStep));
  for (let dy = GEO.sandMargin; dy < size - GEO.sandMargin; dy += step) {
    for (let dx = GEO.sandMargin; dx < size - GEO.sandMargin; dx += step) {
      if (Math.round((dx + dy) / step) % 2 === 0) ctx.fillRect(x + dx, y + dy, GEO.sandSpeck, GEO.sandSpeck);
    }
  }
}

/** The laser controller: a dark panel with a red lens. */
function paintLaserController(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const inset = size * GEO.panelInset;
  ctx.fillStyle = tools.pal.wallShadow;
  roundedSquare(ctx, x + inset, y + inset, size - inset * 2, size * GEO.corner);
  ctx.fill();
  ctx.fillStyle = tools.pal.laserBeam;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * GEO.eyeRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tools.pal.laserBeamCore;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, (size * GEO.eyeRadius) / GEO.eyeCoreDivisor, 0, FULL_TURN);
  ctx.fill();
}

/**
 * Paints the terrain glyph of a cc3d display id over the floor already drawn. An id the painter
 * does not know leaves the floor as it is.
 */
export function paintCc3dTerrain(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const name = id.slice(CC3D_TILE_PREFIX.length);
  const open = name.endsWith(OPEN_SUFFIX);
  const plate = colorAfter(name, PLATE_FAMILY);
  const hold = colorAfter(name, HOLD_DOOR_FAMILY);
  const toggle = colorAfter(name, TOGGLE_DOOR_FAMILY);
  const control = colorAfter(name, TOGGLE_CONTROL_FAMILY);
  if (plate) paintPlate(ctx, plate, x, y, size, tools);
  else if (hold) paintHoldDoor(ctx, hold, open, x, y, size, tools);
  else if (toggle) paintToggleDoor(ctx, toggle, open, x, y, size, tools);
  else if (control) paintControl(ctx, control, x, y, size, tools);
  else if (name === SOCKET_RED) paintSocket(ctx, x, y, size, tools);
  else if (name === SAND) paintSand(ctx, x, y, size, tools);
  else if (name === GOLEM_CONTROL) paintControl(ctx, 'yellow', x, y, size, tools);
  else if (name === LASER_CONTROLLER) paintLaserController(ctx, x, y, size, tools);
}

/** Paints an item of the cc3d ruleset: the extra fish. */
export function paintCc3dItem(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  if (id.slice(CC3D_TILE_PREFIX.length) !== FISH_EXTRA) return;
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.fillStyle = tools.pal.chipCore;
  ctx.beginPath();
  ctx.ellipse(cx, cy, size * GEO.fishBodyRx, size * GEO.fishBodyRy, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + size * GEO.fishBodyRx * GEO.fishTailJoin, cy);
  ctx.lineTo(cx + size * (GEO.fishBodyRx + GEO.fishTail), cy - size * GEO.fishTail);
  ctx.lineTo(cx + size * (GEO.fishBodyRx + GEO.fishTail), cy + size * GEO.fishTail);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.beginPath();
  ctx.arc(cx - size * GEO.fishBodyRx * GEO.fishEyeX, cy - size * GEO.fishBodyRy * GEO.fishEyeY, size * GEO.fishEye, 0, FULL_TURN);
  ctx.fill();
}

/** A colour dot in the corner of a tile: marks a monster as a variant of the one drawn. */
export function paintCc3dBadge(ctx: CanvasRenderingContext2D, colorKey: string, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const cx = x + size * (1 - GEO.badgeInset);
  const cy = y + size * GEO.badgeInset;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.badgeRadius * GEO.badgeRim, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tools.pal[colorKey];
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.badgeRadius, 0, FULL_TURN);
  ctx.fill();
}

function paintLaserShooter(ctx: CanvasRenderingContext2D, dir: Direction, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.rotate(DIRECTION_ANGLE[dir]);
  const half = size * (0.5 - GEO.panelInset);
  ctx.fillStyle = tools.pal.wallShadow;
  roundedSquare(ctx, -half, -half, half * 2, size * GEO.corner);
  ctx.fill();
  // The barrel points the way the shooter fires (north before the rotation).
  ctx.fillStyle = tools.pal.laserBeam;
  ctx.fillRect(-(size * GEO.barrelWidth) / 2, -size * GEO.barrelLength, size * GEO.barrelWidth, size * GEO.barrelLength);
  ctx.fillStyle = tools.pal.laserBeamCore;
  ctx.beginPath();
  ctx.arc(0, 0, (size * GEO.eyeRadius) / GEO.eyeCoreDivisor, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

/** Bots: a round body with a mark that tells the four kinds apart. */
function paintBot(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.botRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tools.pal.gray;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.botRadius * GEO.botFace, 0, FULL_TURN);
  ctx.fill();
  const mark = size * GEO.botMarkRadius;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.strokeStyle = tools.pal.wallShadow;
  ctx.lineWidth = Math.max(1, size * GEO.frameWidth);
  if (kind === BOT_STATIC) {
    ctx.beginPath();
    ctx.arc(cx, cy, mark, 0, FULL_TURN);
    ctx.fill();
  } else if (kind === BOT_MULTI) {
    for (const [dx, dy] of MULTI_MARK_OFFSETS) {
      ctx.beginPath();
      ctx.arc(cx + dx * size * GEO.botMarkOffset, cy + dy * size * GEO.botMarkOffset, mark * GEO.botMultiMark, 0, FULL_TURN);
      ctx.fill();
    }
  } else {
    // An arc ending in an arrow head, turning the way the bot turns.
    const clockwise = kind === BOT_CLOCKWISE;
    const radius = size * GEO.botArc;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * GEO.botArcStart, Math.PI * GEO.botArcEnd, !clockwise);
    ctx.stroke();
    const direction = clockwise ? 1 : -1;
    const tipX = cx - direction * radius;
    ctx.beginPath();
    ctx.moveTo(tipX, cy - mark * GEO.botArrow);
    ctx.lineTo(tipX + direction * mark * GEO.botArrow, cy);
    ctx.lineTo(tipX - direction * mark * GEO.botArrow, cy);
    ctx.closePath();
    ctx.fill();
  }
}

/** A laser shot: a small bright bolt, a halo with a core, drawn as discs so it reads in any facing. */
function paintShot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.fillStyle = tools.pal.laserBeam;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.shotHalo, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tools.pal.laserBeamCore;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.shotCore, 0, FULL_TURN);
  ctx.fill();
}

/** Paints a mob that is not a variant of an existing monster (see CC3D_MOB_BASES). */
export function paintCc3dMob(ctx: CanvasRenderingContext2D, id: string, dir: Direction, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const name = id.slice(CC3D_TILE_PREFIX.length);
  const block = colorAfter(name, BLOCK_FAMILY);
  if (block) paintColorBlock(ctx, block, x, y, size, tools);
  else if (name.startsWith(REFLECTOR_FAMILY)) paintReflector(ctx, name.slice(REFLECTOR_FAMILY.length), x, y, size, tools);
  else if (name === LASER_SHOOTER) paintLaserShooter(ctx, dir, x, y, size, tools);
  else if (name === SHOT) paintShot(ctx, x, y, size, tools);
  else if (name.startsWith(BOT_FAMILY)) paintBot(ctx, name.slice(BOT_FAMILY.length), x, y, size, tools);
}
