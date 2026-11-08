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
/** The two bars inside a pause badge (toggle clock): half height, offset from the centre, bar width and line width, in tiles. */
const PAUSE_BARS = { halfHeight: 0.1, offset: 0.055, width: 0.05 } as const;
/** The sheet inside a foil badge (steel foil): half length of the slanted sheet, its half thickness and the glint line, in tiles. */
const FOIL_SHEET = { halfLength: 0.12, halfThickness: 0.045, line: 0.025 } as const;
/** The zigzag bolt inside a lightning badge: points of the bolt as offsets from the badge centre, in tiles, and the line width. */
const BOLT = {
  points: [
    [0.045, -0.13],
    [-0.07, 0.01],
    [0.0, 0.01],
    [-0.045, 0.13],
    [0.07, -0.02],
    [0.005, -0.02]
  ],
  line: 0.025
} as const;
/** The note inside a bribe badge: half width, half height and line width, in tiles, and the radius of the coin mark on it. */
const BRIBE_NOTE = { halfWidth: 0.13, halfHeight: 0.085, line: 0.025, coin: 0.035 } as const;
/** The sticks inside a dynamite badge: count, half height, bar width and spacing between bar centres, in tiles. */
const DYNAMITE_STICKS = { count: 3, halfHeight: 0.1, width: 0.045, spacing: 0.07 } as const;
/** The track inside a railroad sign badge: half length of the rails, their distance from the centre, the sleeper count and half length, and the line width, in tiles. */
const RAIL_BADGE = { halfLength: 0.12, rail: 0.04, sleepers: 3, sleeperHalf: 0.075, line: 0.025 } as const;
/** The fish inside a fish gate badge: half body length, half body height, tail reach and half tail height, and the line width, in tiles. */
const FISH_BADGE = { halfBody: 0.085, halfHeight: 0.05, tailReach: 0.06, tailHalf: 0.045, line: 0.022 } as const;
/** The arrows inside a teleporter badge: half length of the shaft, size of the head, length of the sideways leg of the turning arrow, and line width, in tiles. */
const EXIT_ARROW = { halfShaft: 0.1, head: 0.055, sideways: 0.1, line: 0.03 } as const;
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

/** The dot in the upper right corner of a monster: centre and radius, in tiles. */
const MONSTER_DOT = { x: 0.8, y: 0.2, radius: 0.12, line: 0.03 } as const;

/** Colours of the dot a mirror player wears: a pale glass blue, so it reads as a reflection in every style. */
export const MIRROR_MARK_COLOURS: MarkColours = { fill: '#bfe6ff', edge: '#2c5f8a', ink: '#ffffff' };
/** How much of its own colour a mirror player keeps: it is drawn as the player seen through glass. */
export const MIRROR_PLAYER_ALPHA = 0.72;

/** A coloured dot in the upper right corner of a monster, telling a CC2 look-alike from the monster it is drawn as. */
export function paintMonsterDot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  ctx.fillStyle = colours.fill;
  disc(ctx, x + size * MONSTER_DOT.x, y + size * MONSTER_DOT.y, size * MONSTER_DOT.radius);
  ctx.fill();
  ctx.strokeStyle = colours.edge;
  ctx.lineWidth = lineWidth(size, MONSTER_DOT.line);
  ctx.stroke();
  ctx.restore();
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

/** A toggle clock: the badge holds the pause sign, two upright bars. */
export function paintPauseBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  ctx.fillStyle = colours.ink;
  const high = size * PAUSE_BARS.halfHeight;
  const bar = size * PAUSE_BARS.width;
  const offset = size * PAUSE_BARS.offset;
  ctx.fillRect(cx - offset - bar / 2, cy - high, bar, high * 2);
  ctx.fillRect(cx + offset - bar / 2, cy - high, bar, high * 2);
  ctx.restore();
}

/** A steel foil: the badge holds a thin slanted sheet of metal with a glint along it. */
export function paintFoilBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  const half = size * FOIL_SHEET.halfLength;
  const thick = size * FOIL_SHEET.halfThickness;
  ctx.fillStyle = colours.ink;
  ctx.beginPath();
  ctx.moveTo(cx - half, cy + half - thick);
  ctx.lineTo(cx - half + thick, cy + half);
  ctx.lineTo(cx + half, cy - half + thick);
  ctx.lineTo(cx + half - thick, cy - half);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = colours.fill;
  ctx.lineWidth = lineWidth(size, FOIL_SHEET.line);
  ctx.beginPath();
  ctx.moveTo(cx - half * HALF, cy + half * HALF);
  ctx.lineTo(cx + half * HALF, cy - half * HALF);
  ctx.stroke();
  ctx.restore();
}

/** The lightning bolt: a round badge with a filled zigzag bolt, in the colour of electricity. */
export function paintBoltBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  ctx.fillStyle = colours.ink;
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = lineWidth(size, BOLT.line);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  BOLT.points.forEach(([dx, dy], i) => {
    if (i === 0) ctx.moveTo(cx + size * dx, cy + size * dy);
    else ctx.lineTo(cx + size * dx, cy + size * dy);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** A bribe: the badge holds a banknote, a small rectangle with a coin mark in its middle. */
export function paintBribeBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = lineWidth(size, BRIBE_NOTE.line);
  ctx.strokeRect(cx - size * BRIBE_NOTE.halfWidth, cy - size * BRIBE_NOTE.halfHeight, size * BRIBE_NOTE.halfWidth * 2, size * BRIBE_NOTE.halfHeight * 2);
  ctx.fillStyle = colours.ink;
  disc(ctx, cx, cy, size * BRIBE_NOTE.coin);
  ctx.fill();
  ctx.restore();
}

/** Dynamite: the badge holds a bundle of three upright sticks. */
export function paintDynamiteBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  ctx.fillStyle = colours.ink;
  const first = -((DYNAMITE_STICKS.count - 1) / 2) * DYNAMITE_STICKS.spacing;
  for (let i = 0; i < DYNAMITE_STICKS.count; i++) {
    const stickX = cx + size * (first + i * DYNAMITE_STICKS.spacing);
    ctx.fillRect(stickX - (size * DYNAMITE_STICKS.width) / 2, cy - size * DYNAMITE_STICKS.halfHeight, size * DYNAMITE_STICKS.width, size * DYNAMITE_STICKS.halfHeight * 2);
  }
  ctx.restore();
}

/** A railroad sign: the badge holds a short piece of track, two rails across three sleepers. */
export function paintRailBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = lineWidth(size, RAIL_BADGE.line);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(cx - size * RAIL_BADGE.halfLength, cy + side * size * RAIL_BADGE.rail);
    ctx.lineTo(cx + size * RAIL_BADGE.halfLength, cy + side * size * RAIL_BADGE.rail);
  }
  for (let sleeper = 0; sleeper < RAIL_BADGE.sleepers; sleeper++) {
    const at = cx + size * RAIL_BADGE.halfLength * (((sleeper * 2) / (RAIL_BADGE.sleepers - 1)) - 1) * 0.8;
    ctx.moveTo(at, cy - size * RAIL_BADGE.sleeperHalf);
    ctx.lineTo(at, cy + size * RAIL_BADGE.sleeperHalf);
  }
  ctx.stroke();
  ctx.restore();
}

/** A fish gate: the badge holds a small fish, swimming left, over the chip socket. */
export function paintFishBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  const body = size * FISH_BADGE.halfBody;
  const tail = size * FISH_BADGE.tailReach;
  ctx.fillStyle = colours.ink;
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = lineWidth(size, FISH_BADGE.line);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.ellipse(cx - tail / 2, cy, body, size * FISH_BADGE.halfHeight, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - tail / 2 + body * HALF, cy);
  ctx.lineTo(cx - tail / 2 + body + tail, cy - size * FISH_BADGE.tailHalf);
  ctx.lineTo(cx - tail / 2 + body + tail, cy + size * FISH_BADGE.tailHalf);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The head of an exit arrow at (tipX, tipY), pointing up when `rightward` is false and right when it is true. */
function paintExitArrowHead(ctx: CanvasRenderingContext2D, tipX: number, tipY: number, head: number, rightward: boolean): void {
  ctx.beginPath();
  if (rightward) {
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - head, tipY - head);
    ctx.lineTo(tipX - head, tipY + head);
  } else {
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - head, tipY + head);
    ctx.lineTo(tipX + head, tipY + head);
  }
  ctx.closePath();
  ctx.fill();
}

/** A forward teleporter: the badge holds an arrow that points straight ahead, the only way out. */
export function paintForwardBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  const shaft = size * EXIT_ARROW.halfShaft;
  ctx.fillStyle = colours.ink;
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = lineWidth(size, EXIT_ARROW.line);
  ctx.beginPath();
  ctx.moveTo(cx, cy + shaft);
  ctx.lineTo(cx, cy - shaft);
  ctx.stroke();
  paintExitArrowHead(ctx, cx, cy - shaft, size * EXIT_ARROW.head, false);
  ctx.restore();
}

/** A turning teleporter: the badge holds an arrow that goes ahead, then bends to the side, for the exits tried in turn. */
export function paintTurningBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: MarkColours): void {
  ctx.save();
  paintBadgeBase(ctx, x, y, size, colours);
  const cx = x + size * BADGE.x;
  const cy = y + size * BADGE.y;
  const shaft = size * EXIT_ARROW.halfShaft;
  const side = size * EXIT_ARROW.sideways;
  ctx.fillStyle = colours.ink;
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = lineWidth(size, EXIT_ARROW.line);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - side / 2, cy + shaft);
  ctx.lineTo(cx - side / 2, cy - shaft / 2);
  ctx.lineTo(cx + side / 2, cy - shaft / 2);
  ctx.stroke();
  paintExitArrowHead(ctx, cx + side / 2, cy - shaft / 2, size * EXIT_ARROW.head, true);
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
