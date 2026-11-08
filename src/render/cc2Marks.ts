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
 * The marks that tell the Chip's Challenge 2 look-alikes from the Epoxy tile they are drawn on: the green chip and the
 * green bomb are a chip and a bomb with a swap badge, the hiking boots are boots with a tread badge, the steel wall is a
 * wall with rivets, a gender sign is a floor with a plate and a letter, and Melinda is the player with a bow. Every
 * mark is drawn over whatever the render style painted below it, so one drawing serves every style; only the colours
 * differ, and each style hands in its own. Pure module: no DOM, only the canvas context it is given.
 */

import { Direction } from '../core/types';

const TAU = Math.PI * 2;
const HALF = 0.5;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;

/** Colours of a mark: its body, its outline and the ink of what is drawn on it. */
export interface MarkColours {
  readonly fill: string;
  readonly edge: string;
  readonly ink: string;
}

/** The badge in the lower right corner of an item: centre and radius, in tiles. */
const BADGE = { x: 0.76, y: 0.76, radius: 0.19, line: 0.03 } as const;
/** The swap arrows inside a toggle badge: half length, vertical offset, head size and line width, in tiles. */
const SWAP_ARROWS = { half: 0.1, offset: 0.045, head: 0.05, line: 0.03 } as const;
/** The zigzag tread inside a hiking boots badge: half width, half height, step count and line width, in tiles. */
const TREAD = { halfWidth: 0.11, halfHeight: 0.06, steps: 3, line: 0.035 } as const;
/** The rivets of a steel wall: inset from the corner, radius, and the inset of the plate outline, in tiles. */
const RIVETS = { inset: 0.17, radius: 0.055, plateInset: 0.09, line: 0.03 } as const;
/** The plate of a gender sign: half width, half height, corner radius and line width, in tiles. */
const SIGN_PLATE = { halfWidth: 0.3, halfHeight: 0.24, corner: 0.07, line: 0.035 } as const;
/** Height of the letter on a sign plate, in tiles, and the font it is set in. */
const SIGN_LETTER_TILE = 0.34;
const SIGN_FONT = 'bold {px}px sans-serif';
const SIGN_FONT_PX_TOKEN = '{px}';
/** Where the post of a sign meets the plate: below the plate by this much, in tiles. */
const SIGN_POST = { width: 0.07, height: 0.14 } as const;

/** Colour of Melinda's bow and its knot, and the outline that keeps it readable on a light tile. */
export const MELINDA_BOW_COLOURS: MarkColours = { fill: '#ff6fae', edge: '#8e1d55', ink: '#ffd1e6' };
/** The bow of Melinda: wing length and height, knot radius and the outline width, in tiles. */
const BOW = { wing: 0.12, height: 0.07, knot: 0.04, line: 0.018 } as const;
/**
 * Where the bow sits on the head, from the tile centre, in tiles, per way the player faces: on the top right of the head
 * from the front, on the top left from behind, and at the back of the head from the side.
 */
const BOW_ANCHOR: Readonly<Record<Direction, { readonly x: number; readonly y: number }>> = {
  S: { x: 0.12, y: -0.38 },
  N: { x: -0.12, y: -0.38 },
  E: { x: -0.15, y: -0.36 },
  W: { x: 0.15, y: -0.36 }
};

function lineWidth(size: number, tiles: number): number {
  return Math.max(MIN_LINE_PX, size * tiles);
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
}

/** The round badge on the lower right corner of an item. */
function paintBadgeBase(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.fillStyle = colours.fill;
  disc(ctx, x + size * BADGE.x, y + size * BADGE.y, size * BADGE.radius);
  ctx.fill();
  ctx.strokeStyle = colours.edge;
  ctx.lineWidth = lineWidth(size, BADGE.line);
  ctx.stroke();
}

/** One arrow of the swap pair, from (fromX, y) to (toX, y), as a line and a filled head. */
function paintArrow(ctx: CanvasRenderingContext2D, fromX: number, toX: number, y: number, head: number): void {
  const sign = Math.sign(toX - fromX);
  ctx.beginPath();
  ctx.moveTo(fromX, y);
  ctx.lineTo(toX, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(toX, y);
  ctx.lineTo(toX - sign * head, y - head);
  ctx.lineTo(toX - sign * head, y + head);
  ctx.closePath();
  ctx.fill();
}

/** A green chip or bomb: the swap badge, two opposite arrows on a disc of the colour of the green button. */
export function paintToggleBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  ctx.strokeStyle = colours.ink;
  ctx.fillStyle = colours.ink;
  ctx.lineWidth = lineWidth(size, SWAP_ARROWS.line);
  ctx.lineCap = 'round';
  const half = size * SWAP_ARROWS.half;
  const offset = size * SWAP_ARROWS.offset;
  const head = size * SWAP_ARROWS.head;
  paintArrow(ctx, cx - half, cx + half, cy - offset, head);
  paintArrow(ctx, cx + half, cx - half, cy + offset, head);
  ctx.restore();
}

/** Hiking boots: a round badge with a zigzag tread, in the colour of earth. */
export function paintTreadBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = lineWidth(size, TREAD.line);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const width = size * TREAD.halfWidth * 2;
  const high = size * TREAD.halfHeight;
  ctx.moveTo(cx - width / 2, cy + high);
  for (let step = 1; step <= TREAD.steps * 2; step++) {
    ctx.lineTo(cx - width / 2 + (width * step) / (TREAD.steps * 2), cy + (step % 2 === 0 ? high : -high));
  }
  ctx.stroke();
  ctx.restore();
}

/** A steel wall: an outlined plate and a rivet in each corner, over the wall of the style. */
export function paintRivets(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  ctx.strokeStyle = colours.edge;
  ctx.lineWidth = lineWidth(size, RIVETS.line);
  const plate = size * RIVETS.plateInset;
  ctx.strokeRect(x + plate, y + plate, size - 2 * plate, size - 2 * plate);
  for (const [fx, fy] of [[RIVETS.inset, RIVETS.inset], [1 - RIVETS.inset, RIVETS.inset], [RIVETS.inset, 1 - RIVETS.inset], [1 - RIVETS.inset, 1 - RIVETS.inset]]) {
    ctx.fillStyle = colours.fill;
    disc(ctx, x + size * fx, y + size * fy, size * RIVETS.radius);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A gender sign: a plate on a short post with the initial of the character who may step here, over a floor. */
export function paintSignPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  letter: string,
  colours: MarkColours
): void {
  ctx.save();
  const cx = x + size * HALF;
  const cy = y + size * HALF;
  const halfWidth = size * SIGN_PLATE.halfWidth;
  const halfHeight = size * SIGN_PLATE.halfHeight;
  ctx.fillStyle = colours.edge;
  ctx.fillRect(cx - (size * SIGN_POST.width) / 2, cy + halfHeight - 1, size * SIGN_POST.width, size * SIGN_POST.height + 1);
  ctx.fillStyle = colours.fill;
  ctx.strokeStyle = colours.edge;
  ctx.lineWidth = lineWidth(size, SIGN_PLATE.line);
  ctx.beginPath();
  ctx.roundRect(cx - halfWidth, cy - halfHeight, halfWidth * 2, halfHeight * 2, size * SIGN_PLATE.corner);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colours.ink;
  ctx.font = SIGN_FONT.replace(SIGN_FONT_PX_TOKEN, String(Math.max(1, Math.floor(size * SIGN_LETTER_TILE))));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, cx, cy + 1);
  ctx.restore();
}

/** A no-sign: radius of the ring, its line width and the angle of the bar across it, in tiles and radians. */
const NO_SIGN = { radius: 0.4, line: 0.075, slashAngle: Math.PI * 1.25 } as const;

/** A no-sign: a ring crossed by a bar (`fill` is the ring, `edge` the bar), over the item it names. */
export function paintNoSign(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  const cx = x + size * HALF;
  const cy = y + size * HALF;
  const radius = size * NO_SIGN.radius;
  const reachX = Math.cos(NO_SIGN.slashAngle) * radius;
  const reachY = Math.sin(NO_SIGN.slashAngle) * radius;
  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth(size, NO_SIGN.line);
  ctx.strokeStyle = colours.fill;
  disc(ctx, cx, cy, radius);
  ctx.stroke();
  ctx.strokeStyle = colours.edge;
  ctx.beginPath();
  ctx.moveTo(cx + reachX, cy + reachY);
  ctx.lineTo(cx - reachX, cy - reachY);
  ctx.stroke();
  ctx.restore();
}

/**
 * Melinda's bow, drawn over the player in the cell at (x, y) facing `dir`: two wings and a knot at the head, in pink, so
 * she reads as a different character from Chip in every style, and in every pose.
 */
export function paintMelindaBow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dir: Direction): void {
  const anchor = BOW_ANCHOR[dir];
  const cx = x + size * (HALF + anchor.x);
  const cy = y + size * (HALF + anchor.y);
  const wing = size * BOW.wing;
  const height = size * BOW.height;
  ctx.save();
  ctx.fillStyle = MELINDA_BOW_COLOURS.fill;
  ctx.strokeStyle = MELINDA_BOW_COLOURS.edge;
  ctx.lineWidth = lineWidth(size, BOW.line);
  ctx.lineJoin = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + side * wing, cy - height);
    ctx.lineTo(cx + side * wing, cy + height);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = MELINDA_BOW_COLOURS.ink;
  disc(ctx, cx, cy, size * BOW.knot);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
