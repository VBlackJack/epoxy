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
 * Pushable blocks and mirrors of the Runeward style: dirt, ice, colour and arrow blocks, and the two kinds of
 * mirror. Each draws into the square from (0, 0) to (size, size) from the Runeward art config, as a lit
 * stone block in the plain drawing or, when the art block has an ink section, as a pigment wash with ink
 * lines and hatching on the front. The proportions below are the drawings themselves, the way pixel art is
 * data: they are art, not settings. The dispatch in runewardTiles.ts reads ENTITIES and PENDING.
 */

import { ConfigRegistry } from '../../../config/ConfigRegistry';
import { DIRECTION_VECTORS } from '../../../config/constants';
import { MIRROR_FRONT_AXIS } from '../../../core/coreConstants';
import { relativeTo } from '../../../core/lynx/directions';
import type {
  Direction,
  MirrorAxis,
  MirrorCorner,
  RelativeTurn,
  RunewardArtConfig,
  RunewardKeyColour,
  RunewardSolidColours
} from '../../../core/types';
import { paintColorGlyph } from '../../colorGlyph';
import { hasInkHatching, heavyLineWidth, inkLineWidth, paintHatching, paintVerticalHatching } from './runewardInk';
import { linear, roundRect } from './runewardPainters';
import type { RunewardEntityPainter } from './runewardTiles';

type Art = Readonly<RunewardArtConfig>;
type Solid = Readonly<RunewardSolidColours>;

/** Middle of the cell, as a fraction of its size. */
const HALF = 0.5;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;
/** A quarter turn, in radians: the angle between two neighbouring directions. */
const QUARTER_TURN = Math.PI / 2;
/** Quarter turns clockwise from north, by direction: how far a north-pointing arrow is turned. */
const QUARTER_TURNS_FROM_NORTH: Readonly<Record<Direction, number>> = { N: 0, E: 1, S: 2, W: 3 };
/** Hatching of a block anchors to the block itself, so the lines travel with it. */
const BLOCK_CELL = { cx: 0, cy: 0 } as const;

/** Angle in radians by which a north-pointing drawing is turned to point toward a direction. */
export function directionAngle(dir: Direction): number {
  return QUARTER_TURNS_FROM_NORTH[dir] * QUARTER_TURN;
}

// ---- The block --------------------------------------------------------------------------------

const BLOCK = {
  inset: 0.06,
  corner: 0.1,
  /** Height of the shaded front strip along the foot of the block. */
  frontHeight: 0.2,
  /** Where the light edge of the top face fades into its main colour. */
  lightStop: 0.45,
  /** Width of the outline and of the highlight line in the plain drawing. */
  lineWidth: 0.035,
  /** Drop of the ground shadow under the block. */
  shadowDrop: 0.04
} as const;

/** Width of a plain-drawing line of detail, in pixels. */
function plainLineWidth(size: number, scale = 1): number {
  return Math.max(MIN_LINE_PX, size * BLOCK.lineWidth * scale);
}

/** Rectangle of the top face of a block, in pixels. */
export interface BlockFace {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The top face of a block: the area above the shaded front strip, where marks are drawn. */
export function blockFace(size: number): BlockFace {
  const inset = size * BLOCK.inset;
  return { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 - size * BLOCK.frontHeight };
}

/** The solid block: ground shadow, lit top face, shaded front strip and outline. */
export function paintBlock(ctx: CanvasRenderingContext2D, size: number, art: Art, colours: Solid): void {
  const inset = size * BLOCK.inset;
  const side = size - inset * 2;
  const radius = size * BLOCK.corner;
  const frontTop = size - inset - size * BLOCK.frontHeight;
  const ink = art.ink;
  if (!ink) {
    ctx.fillStyle = art.shadow.color;
    roundRect(ctx, inset, inset + size * BLOCK.shadowDrop, side, side, radius);
    ctx.fill();
    ctx.fillStyle = linear(ctx, 0, inset, 0, size - inset, [
      [0, colours.light],
      [BLOCK.lightStop, colours.base],
      [1, colours.base]
    ]);
  } else {
    ctx.fillStyle = colours.base;
  }
  roundRect(ctx, inset, inset, side, side, radius);
  ctx.fill();
  ctx.save();
  roundRect(ctx, inset, inset, side, side, radius);
  ctx.clip();
  ctx.fillStyle = colours.dark;
  ctx.fillRect(inset, frontTop, side, size);
  if (ink && hasInkHatching(size)) {
    paintVerticalHatching(ctx, size, BLOCK_CELL, { x: inset, y: frontTop, w: side, h: size - frontTop }, ink.hatch);
  }
  ctx.restore();
  roundRect(ctx, inset, inset, side, side, radius);
  ctx.strokeStyle = ink ? ink.line : colours.edge;
  ctx.lineWidth = ink ? heavyLineWidth(size) : plainLineWidth(size);
  ctx.stroke();
  if (ink) {
    ctx.beginPath();
    ctx.moveTo(inset, frontTop);
    ctx.lineTo(inset + side, frontTop);
    ctx.lineWidth = inkLineWidth(size);
    ctx.stroke();
    return;
  }
  ctx.strokeStyle = colours.light;
  ctx.lineWidth = plainLineWidth(size);
  ctx.beginPath();
  ctx.moveTo(inset + radius, inset + ctx.lineWidth);
  ctx.lineTo(size - inset - radius, inset + ctx.lineWidth);
  ctx.stroke();
}

/** Sets the pen for a line of detail on a block: the ink in parchment, the given plain tone otherwise. */
function detailPen(ctx: CanvasRenderingContext2D, size: number, art: Art, plain: string): void {
  ctx.strokeStyle = art.ink ? art.ink.line : plain;
  ctx.lineWidth = art.ink ? inkLineWidth(size) : plainLineWidth(size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

// ---- Dirt: two cracks -------------------------------------------------------------------------

/** The two cracks of a dirt block, as points in tiles from the top left of the cell. */
const DIRT_CRACKS: readonly (readonly (readonly [number, number])[])[] = [
  [[0.3, 0.16], [0.4, 0.3], [0.34, 0.42], [0.46, 0.54]],
  [[0.72, 0.2], [0.62, 0.34], [0.7, 0.46]]
];

/** A dirt block: earth colours with two crack lines. */
export function paintDirtBlock(ctx: CanvasRenderingContext2D, size: number, art: Art): void {
  const colours = art.block.dirt;
  paintBlock(ctx, size, art, colours);
  ctx.save();
  detailPen(ctx, size, art, colours.dark);
  for (const crack of DIRT_CRACKS) {
    ctx.beginPath();
    crack.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px * size, py * size) : ctx.lineTo(px * size, py * size)));
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Ice: a frost edge ------------------------------------------------------------------------

const FROST = {
  /** Inset of the frost line from the outline of the face, in tiles. */
  inset: 0.14,
  /** Length of a frost tick, in tiles. */
  tick: 0.07,
  /** Positions of the ticks along the top edge, in tiles from the left. */
  ticks: [0.26, 0.5, 0.74]
} as const;

/** An ice block: ice colours with a frost line along the top and left edges and a few frost ticks. */
export function paintIceBlock(ctx: CanvasRenderingContext2D, size: number, art: Art): void {
  const colours = art.block.ice;
  paintBlock(ctx, size, art, colours);
  const face = blockFace(size);
  const edge = size * FROST.inset;
  const top = face.y + edge * HALF;
  ctx.save();
  detailPen(ctx, size, art, colours.light);
  ctx.beginPath();
  ctx.moveTo(face.x + edge * HALF, face.y + face.h - edge);
  ctx.lineTo(face.x + edge * HALF, top);
  ctx.lineTo(face.x + face.w - edge, top);
  ctx.stroke();
  const tick = size * FROST.tick;
  ctx.beginPath();
  for (const along of FROST.ticks) {
    const px = along * size;
    ctx.moveTo(px, top + ctx.lineWidth);
    ctx.lineTo(px - tick * HALF, top + tick);
    ctx.moveTo(px, top + ctx.lineWidth);
    ctx.lineTo(px + tick * HALF, top + tick);
  }
  ctx.stroke();
  ctx.restore();
}

// ---- Colour blocks: the glyph of the channel --------------------------------------------------

/** Radius of the colour-blind glyph, in tiles. */
export const COLOUR_GLYPH_RADIUS = 0.15;

/** Centre of the top face of a block, where the glyph and the arrow hub go. */
export function blockFaceCentre(size: number): { readonly x: number; readonly y: number } {
  const face = blockFace(size);
  return { x: face.x + face.w * HALF, y: face.y + face.h * HALF };
}

/** A colour block: the colours of its channel (block.colour, equal to keys.main and keys.light in the plain art) and its glyph, centred. */
export function paintColourBlock(ctx: CanvasRenderingContext2D, size: number, art: Art, colour: RunewardKeyColour): void {
  paintBlock(ctx, size, art, art.block.colour[colour]);
  const centre = blockFaceCentre(size);
  paintColorGlyph(ctx, colour, centre.x, centre.y, size * COLOUR_GLYPH_RADIUS, art.keys[colour].glyph);
}

// ---- Arrow blocks: one carved arrow per entry of pushArrows -----------------------------------

const ARROW = {
  /** Distance from the centre of the top face to the middle of each arrow, in tiles. */
  reach: 0.2,
  /** Half the length of an arrow, in tiles. */
  halfLength: 0.1,
  /** Half the width of the arrow head. */
  headHalfWidth: 0.085,
  /** Half the width of the arrow shaft. */
  shaftHalfWidth: 0.035,
  /** Depth of the arrow head, in tiles. */
  headDepth: 0.09,
  /** Radius of the hub at the middle of the face. */
  hub: 0.045
} as const;

/** The directions the arrows of an arrow block point to, in the order of its pushArrows: the engine's own rule. */
export function arrowDirections(pushArrows: readonly RelativeTurn[], facing: Direction): Direction[] {
  return pushArrows.map((turn) => relativeTo(facing, turn));
}

/** Traces an arrow pointing north, centred on the origin. */
function traceArrow(ctx: CanvasRenderingContext2D, size: number): void {
  const half = size * ARROW.halfLength;
  const neck = -half + size * ARROW.headDepth;
  ctx.beginPath();
  ctx.moveTo(0, -half);
  ctx.lineTo(size * ARROW.headHalfWidth, neck);
  ctx.lineTo(size * ARROW.shaftHalfWidth, neck);
  ctx.lineTo(size * ARROW.shaftHalfWidth, half);
  ctx.lineTo(-size * ARROW.shaftHalfWidth, half);
  ctx.lineTo(-size * ARROW.shaftHalfWidth, neck);
  ctx.lineTo(-size * ARROW.headHalfWidth, neck);
  ctx.closePath();
}

/** An arrow block: the stone block with one carved arrow toward each direction the engine lets it be pushed. */
export function paintArrowBlock(
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Art,
  pushArrows: readonly RelativeTurn[],
  facing: Direction
): void {
  const colours = art.block.arrow;
  paintBlock(ctx, size, art, colours);
  const centre = blockFaceCentre(size);
  ctx.save();
  ctx.fillStyle = art.ink ? art.ink.line : colours.edge;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, size * ARROW.hub, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  for (const dir of arrowDirections(pushArrows, facing)) {
    const vector = DIRECTION_VECTORS[dir];
    ctx.save();
    ctx.translate(centre.x + vector.dx * size * ARROW.reach, centre.y + vector.dy * size * ARROW.reach);
    ctx.rotate(directionAngle(dir));
    traceArrow(ctx, size);
    ctx.fillStyle = colours.glyph;
    ctx.fill();
    ctx.strokeStyle = art.ink ? art.ink.line : colours.edge;
    ctx.lineWidth = art.ink ? inkLineWidth(size) : plainLineWidth(size, HALF);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Mirrors ----------------------------------------------------------------------------------

const MIRROR = {
  inset: 0.06,
  corner: 0.08,
  /** Inset of the glass panel inside a stone frame. */
  panelInset: 0.2,
  /** Width of the glass band, in tiles. */
  glassWidth: 0.14,
  /** Width of the highlight line on the glass. */
  glowWidth: 0.035,
  /** Half the gap between the two ink lines of the glass in parchment, in tiles. */
  inkHalfGap: 0.05
} as const;

/** A line from one point to another, in pixels. */
export interface Segment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * The diagonal the glass runs along between two insets of the cell: a slash climbs from the bottom left to the
 * top right, a backslash falls from the top left to the bottom right, as the beam geometry of the engine has it.
 */
export function mirrorGlassSegment(axis: MirrorAxis, size: number, inset: number): Segment {
  const near = size * inset;
  const far = size - near;
  return axis === 'slash'
    ? { x0: near, y0: far, x1: far, y1: near }
    : { x0: near, y0: near, x1: far, y1: far };
}

/** The corner of a one-sided mirror that holds its stone backing: the one opposite its reflecting corner. */
export function mirrorBackingCorner(front: MirrorCorner): MirrorCorner {
  const vertical = front.startsWith('N') ? 'S' : 'N';
  const horizontal = front.endsWith('E') ? 'W' : 'E';
  return `${vertical}${horizontal}` as MirrorCorner;
}

/** The triangle of stone behind the glass of a one-sided mirror: one end of the diagonal, the backing corner, the other end. */
export function mirrorBackingTriangle(front: MirrorCorner, size: number): readonly (readonly [number, number])[] {
  const glass = mirrorGlassSegment(MIRROR_FRONT_AXIS[front], size, MIRROR.inset);
  const backing = mirrorBackingCorner(front);
  const near = size * MIRROR.inset;
  const far = size - near;
  return [
    [glass.x0, glass.y0],
    [backing.endsWith('E') ? far : near, backing.startsWith('S') ? far : near],
    [glass.x1, glass.y1]
  ];
}

/** Strokes a line from one end of the segment to the other, displaced by an offset. */
function strokeSegment(ctx: CanvasRenderingContext2D, segment: Segment, offsetX = 0, offsetY = 0): void {
  ctx.beginPath();
  ctx.moveTo(segment.x0 + offsetX, segment.y0 + offsetY);
  ctx.lineTo(segment.x1 + offsetX, segment.y1 + offsetY);
  ctx.stroke();
}

/** Strokes the glass along its diagonal: a pale band with a highlight in the plain drawing, a double ink line in ink. */
function paintGlass(ctx: CanvasRenderingContext2D, size: number, art: Art, segment: Segment): void {
  ctx.save();
  ctx.lineCap = 'butt';
  if (art.ink) {
    const gap = size * MIRROR.inkHalfGap;
    ctx.strokeStyle = art.mirror.glass;
    ctx.lineWidth = gap * 2;
    strokeSegment(ctx, segment);
    ctx.strokeStyle = art.ink.line;
    ctx.lineWidth = inkLineWidth(size);
    const length = Math.hypot(segment.x1 - segment.x0, segment.y1 - segment.y0);
    const normalX = (-(segment.y1 - segment.y0) / length) * gap;
    const normalY = ((segment.x1 - segment.x0) / length) * gap;
    strokeSegment(ctx, segment, normalX, normalY);
    strokeSegment(ctx, segment, -normalX, -normalY);
  } else {
    ctx.strokeStyle = art.mirror.glass;
    ctx.lineWidth = size * MIRROR.glassWidth;
    strokeSegment(ctx, segment);
    ctx.strokeStyle = art.mirror.glassLight;
    ctx.lineWidth = Math.max(MIN_LINE_PX, size * MIRROR.glowWidth);
    strokeSegment(ctx, segment);
  }
  ctx.restore();
}

/** Fills the stone path already traced with its wash, then with ink hatching when the art has ink. */
function fillMirrorStone(ctx: CanvasRenderingContext2D, size: number, art: Art): void {
  const frame = art.mirror.frame;
  ctx.fillStyle = art.ink ? frame.base : linear(ctx, 0, 0, size, size, [[0, frame.light], [1, frame.base]]);
  ctx.fill();
  if (art.ink && hasInkHatching(size)) {
    ctx.save();
    ctx.clip();
    paintHatching(ctx, size, BLOCK_CELL, { x: 0, y: 0, w: size, h: size }, art.ink.hatch);
    ctx.restore();
  }
}

/** Outlines the stone path already traced. */
function strokeMirrorStone(ctx: CanvasRenderingContext2D, size: number, art: Art): void {
  ctx.strokeStyle = art.ink ? art.ink.line : art.mirror.frame.edge;
  ctx.lineWidth = art.ink ? heavyLineWidth(size) : plainLineWidth(size);
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Traces the square of the glass panel inside a stone frame. */
function tracePanel(ctx: CanvasRenderingContext2D, size: number): void {
  const panel = size * MIRROR.panelInset;
  ctx.beginPath();
  ctx.rect(panel, panel, size - panel * 2, size - panel * 2);
}

/** A plain mirror: a stone frame around a recessed panel, with the glass running along the axis. */
export function paintMirror(ctx: CanvasRenderingContext2D, size: number, art: Art, axis: MirrorAxis): void {
  const inset = size * MIRROR.inset;
  const side = size - inset * 2;
  roundRect(ctx, inset, inset, side, side, size * MIRROR.corner);
  fillMirrorStone(ctx, size, art);
  strokeMirrorStone(ctx, size, art);
  ctx.save();
  tracePanel(ctx, size);
  ctx.fillStyle = art.mirror.frame.dark;
  ctx.fill();
  ctx.clip();
  paintGlass(ctx, size, art, mirrorGlassSegment(axis, size, MIRROR.panelInset));
  ctx.restore();
  tracePanel(ctx, size);
  ctx.strokeStyle = art.ink ? art.ink.line : art.mirror.frame.edge;
  ctx.lineWidth = art.ink ? inkLineWidth(size) : plainLineWidth(size, HALF);
  ctx.stroke();
}

/** A one-sided mirror: stone backing in the corner opposite its reflecting corner, the glass on the diagonal. */
export function paintOneSidedMirror(ctx: CanvasRenderingContext2D, size: number, art: Art, front: MirrorCorner): void {
  ctx.beginPath();
  mirrorBackingTriangle(front, size).forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
  fillMirrorStone(ctx, size, art);
  strokeMirrorStone(ctx, size, art);
  paintGlass(ctx, size, art, mirrorGlassSegment(MIRROR_FRONT_AXIS[front], size, MIRROR.inset));
}

// ---- Dispatch ---------------------------------------------------------------------------------

/** The drawing of one entity: the cell size, the art, the facing and the entity id, whose definition it reads. */
type BlockDrawing = (ctx: CanvasRenderingContext2D, size: number, art: Art, dir: Direction, id: string) => void;

/** Wraps a drawing of the cell as an entity painter that moves the context to the cell. */
function entityPainter(draw: BlockDrawing, id: string): RunewardEntityPainter {
  return (ctx, dir, x, y, size, env) => {
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, size, env.art, dir, id);
    ctx.restore();
  };
}

/** The channel a colour block belongs to, from the game's own definition of the entity. */
function blockColour(id: string, art: Art): RunewardKeyColour | null {
  const colour = ConfigRegistry.getEntityDef(id)?.plateColor;
  return colour !== undefined && Object.prototype.hasOwnProperty.call(art.keys, colour) ? colour : null;
}

const COLOUR_BLOCK_IDS: readonly string[] = ['color_block_red', 'color_block_green', 'color_block_blue', 'color_block_yellow'];
const ARROW_BLOCK_IDS: readonly string[] = ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee', 'arrow_block_cross', 'arrow_block_none'];
const MIRROR_IDS: readonly string[] = ['mirror_slash', 'mirror_backslash'];
const ONE_SIDED_MIRROR_IDS: readonly string[] = [
  'one_sided_mirror_ne', 'one_sided_mirror_nw', 'one_sided_mirror_se', 'one_sided_mirror_sw'
];

/** A colour block: its channel comes from the definition; an entity with no known channel is drawn as dirt. */
const drawColourBlock: BlockDrawing = (ctx, size, art, _dir, id) => {
  const colour = blockColour(id, art);
  if (colour) paintColourBlock(ctx, size, art, colour);
  else paintDirtBlock(ctx, size, art);
};

/** An arrow block: the arrows come from the definition, the facing from the direction of the entity. */
const drawArrowBlock: BlockDrawing = (ctx, size, art, dir, id) => {
  paintArrowBlock(ctx, size, art, ConfigRegistry.getEntityDef(id)?.pushArrows ?? [], dir);
};

/** A plain mirror: its axis comes from the definition. */
const drawMirror: BlockDrawing = (ctx, size, art, _dir, id) => {
  paintMirror(ctx, size, art, ConfigRegistry.getEntityDef(id)?.mirrorAxis ?? 'slash');
};

/** A one-sided mirror: its reflecting corner comes from the definition. */
const drawOneSidedMirror: BlockDrawing = (ctx, size, art, _dir, id) => {
  paintOneSidedMirror(ctx, size, art, ConfigRegistry.getEntityDef(id)?.mirrorFrontCorner ?? 'NE');
};

/** Painters by entity type; an id moves here from PENDING when its painter lands. */
export const ENTITIES: Readonly<Record<string, RunewardEntityPainter>> = Object.fromEntries([
  ['dirt_block', entityPainter((ctx, size, art) => paintDirtBlock(ctx, size, art), 'dirt_block')],
  ['ice_block', entityPainter((ctx, size, art) => paintIceBlock(ctx, size, art), 'ice_block')],
  ...COLOUR_BLOCK_IDS.map((id): [string, RunewardEntityPainter] => [id, entityPainter(drawColourBlock, id)]),
  ...ARROW_BLOCK_IDS.map((id): [string, RunewardEntityPainter] => [id, entityPainter(drawArrowBlock, id)]),
  ...MIRROR_IDS.map((id): [string, RunewardEntityPainter] => [id, entityPainter(drawMirror, id)]),
  ...ONE_SIDED_MIRROR_IDS.map((id): [string, RunewardEntityPainter] => [id, entityPainter(drawOneSidedMirror, id)])
]);

/** Ids this module will paint, still drawn by the shared drawing. */
export const PENDING: readonly string[] = [];
