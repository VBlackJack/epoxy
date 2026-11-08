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
 * Devices of the Runeward style: thin walls, swivel doors, turn plates, the transmogrifier, the clone machine,
 * flame jets, lasers (housings, receivers, gates), shot launchers, the shot trigger, the puppet control and the
 * turrets. Each tile is drawn on the shared floor from the Runeward art config, in the plain drawing or, when the
 * art block has an ink section, with ink outlines. Geometry that depends on the game rules (blocked edges, laser
 * group, facing turn, emitter direction) is read from the tile definition, never from the id. The proportions below
 * are the drawings themselves, the way pixel art is data: they are art, not settings.
 */

import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type {
  Direction,
  RunewardArtConfig,
  RunewardChannelColours,
  RunewardLaserChannel,
  RunewardSolidColours,
  TileDefinition
} from '../../../core/types';
import type { TileNeighbours } from '../../tileNeighbours';
import { hasInkHatching, heavyLineWidth, inkLineWidth, paintHatching, type InkRect } from './runewardInk';
import { linear, paintFloor, roundRect, wave } from './runewardPainters';
import { paintColorGlyph } from '../../colorGlyph';
import { paintRailPiece } from '../../railArt';
import { DEFAULT_COLOR_KEY } from '../../paletteKeys';
import { runewardClockMs } from './runewardEnv';
import type { RunewardEntityPainter, RunewardTilePainter, RunewardTilePass } from './runewardTiles';

type Art = Readonly<RunewardArtConfig>;
type Neighbours = Readonly<TileNeighbours>;
type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
/** Middle of the cell, as a fraction of its size. */
const HALF = 0.5;
/** Thinnest line drawn, in pixels. */
const MIN_LINE_PX = 1;
/** Opacity of a wash laid over a part of a rune. */
const WASH_ALPHA = 0.28;
/** Opacity of the base glow of a lit nozzle. */
const NOZZLE_GLOW_ALPHA = 0.45;
/** Position of the mid colour stop of a body gradient. */
const MID_STOP = 0.5;
/** Outline widths in tiles of the plain drawing (the ink drawing uses the ink line widths). */
const OUTLINE = { light: 0.03, heavy: 0.045 } as const;

/** Unit vector of each direction on the canvas (y grows downwards). */
const DIRECTION_VECTOR: Readonly<Record<Direction, readonly [number, number]>> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0]
};

/** Directions in the fixed order the edge bands are drawn. */
const EDGE_ORDER: readonly Direction[] = ['N', 'E', 'S', 'W'];

// ---- Shared helpers ---------------------------------------------------------------------------

/** Stroke colour and width of the outline of a shape: ink lines in parchment, the device edge colour otherwise. */
function outline(ctx: Ctx, size: number, art: Art, edge: string, heavy: boolean): void {
  ctx.strokeStyle = art.ink ? art.ink.line : edge;
  if (art.ink) ctx.lineWidth = heavy ? heavyLineWidth(size) : inkLineWidth(size);
  else ctx.lineWidth = Math.max(MIN_LINE_PX, size * (heavy ? OUTLINE.heavy : OUTLINE.light));
  ctx.lineJoin = 'round';
}

/** Light-to-dark body gradient across a rectangle. */
function bodyFill(ctx: Ctx, rect: InkRect, colours: RunewardSolidColours): CanvasGradient {
  return linear(ctx, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h, [[0, colours.light], [MID_STOP, colours.base], [1, colours.dark]]);
}

/** A filled and outlined rectangle (rounded when `radius` is above 0). */
function solidRect(ctx: Ctx, size: number, art: Art, rect: InkRect, colours: RunewardSolidColours, radius: number, heavy: boolean): void {
  ctx.fillStyle = bodyFill(ctx, rect, colours);
  if (radius > 0) {
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    ctx.fill();
    outline(ctx, size, art, colours.edge, heavy);
    ctx.stroke();
  } else {
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    outline(ctx, size, art, colours.edge, heavy);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }
}

/** Band of the given thickness along one edge of the cell. */
function edgeBand(dir: Direction, thickness: number, size: number): InkRect {
  const t = size * thickness;
  switch (dir) {
    case 'N': return { x: 0, y: 0, w: size, h: t };
    case 'S': return { x: 0, y: size - t, w: size, h: t };
    case 'W': return { x: 0, y: 0, w: t, h: size };
    default: return { x: size - t, y: 0, w: t, h: size };
  }
}

function definitionOf(id: string): Readonly<TileDefinition> {
  return ConfigRegistry.getTile(id);
}

/** Edges the tile blocks, read from its definition. */
function blockedEdgesOf(id: string): readonly Direction[] {
  return definitionOf(id).blockedEdges ?? [];
}

/** Colour channel of a laser receiver or gate: the group's own colours, or the beam colours for an unknown group. */
function laserChannelOf(art: Art, def: Readonly<TileDefinition>): RunewardChannelColours {
  const group = def.laserReceiverGroup ?? def.laserGateGroup ?? '';
  const channels = art.device.laserChannel;
  if (Object.prototype.hasOwnProperty.call(channels, group)) return channels[group as RunewardLaserChannel];
  return { main: art.device.laser.glow, light: art.device.laser.core };
}

/** Colour key of the glyph of a laser receiver or gate: its group when the art has a channel for it, else the default key. */
function laserGlyphKeyOf(art: Art, def: Readonly<TileDefinition>): string {
  const group = def.laserReceiverGroup ?? def.laserGateGroup ?? '';
  return Object.prototype.hasOwnProperty.call(art.device.laserChannel, group) ? group : DEFAULT_COLOR_KEY;
}

/** Radius of the colour glyph on a laser receiver lens or gate lintel, in tiles. */
const LASER_GLYPH_RADIUS = 0.09;

/** Draws in the cell whose corner is at (x, y), restoring the context afterwards. */
function inCell(ctx: Ctx, x: number, y: number, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  draw();
  ctx.restore();
}

/** A tile painter for a motionless device: part of the cached terrain, nothing for the animated pass. */
function stillTile(draw: (ctx: Ctx, size: number, art: Art, nb: Neighbours) => void): RunewardTilePainter {
  return (ctx, x, y, size, pass, nb, env) => {
    if (pass === 'animated') return;
    inCell(ctx, x, y, () => draw(ctx, size, env.art, nb));
  };
}

/** A tile painter whose drawing splits by pass: the cached terrain holds the static part, the overlay follows the clock. */
function movingTile(draw: (ctx: Ctx, size: number, art: Art, nb: Neighbours, pass: RunewardTilePass, timeMs: number) => void): RunewardTilePainter {
  return (ctx, x, y, size, pass, nb, env) => {
    inCell(ctx, x, y, () => draw(ctx, size, env.art, nb, pass, pass === 'static' ? 0 : runewardClockMs(env)));
  };
}

/** Draws in a frame centred on the cell with +x pointing along `dir`. */
function facing(ctx: Ctx, size: number, dir: Direction, draw: () => void): void {
  const [dx, dy] = DIRECTION_VECTOR[dir];
  ctx.save();
  ctx.translate(size * HALF, size * HALF);
  ctx.rotate(Math.atan2(dy, dx));
  draw();
  ctx.restore();
}

/** An arc with an arrowhead: the clockwise arrow starts at `start`, the counter-clockwise one at its mirror image. */
interface ArcArrow {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly start: number;
  readonly sweep: number;
  readonly lineWidth: number;
  readonly head: number;
}

/** Width of an arrowhead as a share of its length. */
const HEAD_WIDTH_SHARE = 0.6;

/** An arc arrow turning `turn` (1 clockwise, -1 counter-clockwise on screen). */
function paintArcArrow(ctx: Ctx, size: number, spec: ArcArrow, turn: 1 | -1, colour: string): void {
  const cx = size * spec.cx;
  const cy = size * spec.cy;
  const r = size * spec.radius;
  const start = turn === 1 ? spec.start : Math.PI - spec.start;
  const end = start + turn * spec.sweep;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * spec.lineWidth);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end, turn === -1);
  ctx.stroke();
  const px = cx + Math.cos(end) * r;
  const py = cy + Math.sin(end) * r;
  const tx = -Math.sin(end) * turn;
  const ty = Math.cos(end) * turn;
  const h = size * spec.head;
  const w = h * HEAD_WIDTH_SHARE;
  ctx.beginPath();
  ctx.moveTo(px + tx * h, py + ty * h);
  ctx.lineTo(px - ty * w, py + tx * w);
  ctx.lineTo(px + ty * w, py - tx * w);
  ctx.closePath();
  ctx.fill();
}

// ---- Thin walls -------------------------------------------------------------------------------

const THIN = { thickness: 0.2, capWidth: 0.035 } as const;

/** A low stone parapet along every blocked edge. */
function paintThinWall(ctx: Ctx, size: number, art: Art, nb: Neighbours, id: string): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.thinWall;
  const edges = blockedEdgesOf(id);
  for (const dir of EDGE_ORDER) {
    if (!edges.includes(dir)) continue;
    const band = edgeBand(dir, THIN.thickness, size);
    solidRect(ctx, size, art, band, colours, 0, false);
    if (art.ink && hasInkHatching(size)) {
      paintHatching(ctx, size, nb, band, art.ink.hatch);
    } else {
      const cap = size * THIN.capWidth;
      const vertical = dir === 'W' || dir === 'E';
      ctx.fillStyle = colours.light;
      ctx.fillRect(band.x, band.y, vertical ? cap : band.w, vertical ? band.h : cap);
    }
  }
}

// ---- Swivel doors -----------------------------------------------------------------------------

const SWIVEL = { leaf: 0.15, plankInset: 0.04, studRadius: 0.1, studRim: 0.045 } as const;

/** A timber leaf on the two closed sides with an iron pivot stud in the corner they share. */
function paintSwivel(ctx: Ctx, size: number, art: Art, nb: Neighbours, id: string): void {
  paintFloor(ctx, size, art, nb);
  const edges = blockedEdgesOf(id);
  const colours = art.device.swivel;
  for (const dir of EDGE_ORDER) {
    if (!edges.includes(dir)) continue;
    const band = edgeBand(dir, SWIVEL.leaf, size);
    solidRect(ctx, size, art, band, colours, 0, false);
    const inset = size * SWIVEL.plankInset;
    ctx.strokeStyle = colours.dark;
    ctx.lineWidth = Math.max(MIN_LINE_PX, size * OUTLINE.light * HALF);
    ctx.beginPath();
    if (dir === 'W' || dir === 'E') {
      ctx.moveTo(band.x + band.w * HALF, band.y + inset);
      ctx.lineTo(band.x + band.w * HALF, band.y + band.h - inset);
    } else {
      ctx.moveTo(band.x + inset, band.y + band.h * HALF);
      ctx.lineTo(band.x + band.w - inset, band.y + band.h * HALF);
    }
    ctx.stroke();
  }
  const half = SWIVEL.leaf * HALF;
  let cx = HALF;
  if (edges.includes('W')) cx = half;
  else if (edges.includes('E')) cx = 1 - half;
  let cy = HALF;
  if (edges.includes('N')) cy = half;
  else if (edges.includes('S')) cy = 1 - half;
  ctx.beginPath();
  ctx.arc(size * cx, size * cy, size * SWIVEL.studRadius, 0, TAU);
  ctx.fillStyle = art.door.frame;
  ctx.fill();
  outline(ctx, size, art, colours.edge, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(size * cx, size * cy, size * (SWIVEL.studRadius - SWIVEL.studRim), 0, TAU);
  ctx.fillStyle = art.gate.barLight;
  ctx.fill();
}

// ---- Rails ------------------------------------------------------------------------------------

/** Two steel rails over timber sleepers along the open sides, a buffer on each closed side; a switch shows its other form faded. */
function paintRail(ctx: Ctx, size: number, art: Art, nb: Neighbours, id: string): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.swivel;
  const definition = definitionOf(id);
  const sides = definition.railSides;
  if (sides === undefined) return;
  const otherSides = definition.togglesTo === undefined ? undefined : definitionOf(definition.togglesTo).railSides;
  paintRailPiece(ctx, 0, 0, size, sides, otherSides, {
    outline: art.ink ? art.ink.line : colours.edge,
    sleeper: colours.base,
    rail: art.gate.barLight,
    buffer: colours.light
  });
}

// ---- Turn plates ------------------------------------------------------------------------------

const TURN_PLATE = {
  discRadius: 0.4,
  rimWidth: 0.04,
  hubRadius: 0.05,
  arrow: { cx: HALF, cy: HALF, radius: 0.24, start: -2.4, sweep: 4.2, lineWidth: 0.07, head: 0.15 } satisfies ArcArrow
} as const;

/** A seal disc with a curved arrow turning the way the plate turns blocks. */
function paintTurnPlate(ctx: Ctx, size: number, art: Art, nb: Neighbours, turn: 1 | -1): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.turnPlate;
  ctx.beginPath();
  ctx.arc(size * HALF, size * HALF, size * TURN_PLATE.discRadius, 0, TAU);
  ctx.fillStyle = colours.base;
  ctx.fill();
  ctx.strokeStyle = art.ink ? art.ink.line : colours.glow;
  ctx.lineWidth = art.ink ? heavyLineWidth(size) : Math.max(MIN_LINE_PX, size * TURN_PLATE.rimWidth);
  ctx.stroke();
  paintArcArrow(ctx, size, TURN_PLATE.arrow, turn, colours.glow);
  ctx.beginPath();
  ctx.arc(size * HALF, size * HALF, size * TURN_PLATE.hubRadius, 0, TAU);
  ctx.fillStyle = colours.core;
  ctx.fill();
}

// ---- Transmogrifier ---------------------------------------------------------------------------

const TRANSMOG = { discRadius: 0.4, runeRadius: 0.3, runeWidth: 0.05, dividerReach: 0.34, dividerWidth: 0.035 } as const;

/** A rune circle split in two halves: the left in the glow colour, the right in the core colour. */
function paintTransmogrifier(ctx: Ctx, size: number, art: Art, nb: Neighbours): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.transmogrifier;
  const centre = size * HALF;
  ctx.beginPath();
  ctx.arc(centre, centre, size * TRANSMOG.discRadius, 0, TAU);
  ctx.fillStyle = colours.base;
  ctx.fill();
  outline(ctx, size, art, art.device.thinWall.edge, true);
  ctx.stroke();
  const halves: readonly (readonly [string, number, number])[] = [
    [colours.glow, Math.PI * HALF, Math.PI * 1.5],
    [colours.core, -Math.PI * HALF, Math.PI * HALF]
  ];
  for (const [colour, from, to] of halves) {
    ctx.beginPath();
    ctx.moveTo(centre, centre);
    ctx.arc(centre, centre, size * TRANSMOG.runeRadius, from, to);
    ctx.closePath();
    ctx.globalAlpha = WASH_ALPHA;
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(centre, centre, size * TRANSMOG.runeRadius, from, to);
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(MIN_LINE_PX, size * TRANSMOG.runeWidth);
    ctx.stroke();
  }
  ctx.strokeStyle = colours.core;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * TRANSMOG.dividerWidth);
  ctx.beginPath();
  ctx.moveTo(centre, centre - size * TRANSMOG.dividerReach);
  ctx.lineTo(centre, centre + size * TRANSMOG.dividerReach);
  ctx.stroke();
}

// ---- Clone machine ----------------------------------------------------------------------------

const CLONE = { inset: 0.08, bracket: 0.22, bracketWidth: 0.07, rimWidth: 0.025, rivetRadius: 0.035 } as const;

/** An iron cage drawn as a rim and four corner brackets only, so a clone standing on it stays visible. */
function paintCloneMachine(ctx: Ctx, size: number, art: Art, nb: Neighbours): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.cloneMachine;
  const near = size * CLONE.inset;
  const far = size - near;
  const reach = size * CLONE.bracket;
  ctx.strokeStyle = art.ink ? art.ink.line : colours.glow;
  ctx.lineWidth = art.ink ? inkLineWidth(size) : Math.max(MIN_LINE_PX, size * CLONE.rimWidth);
  ctx.strokeRect(near, near, far - near, far - near);
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * CLONE.bracketWidth);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const [x, dx] of [[near, 1], [far, -1]] as const) {
    for (const [y, dy] of [[near, 1], [far, -1]] as const) {
      ctx.strokeStyle = art.ink ? art.ink.line : colours.base;
      ctx.beginPath();
      ctx.moveTo(x + dx * reach, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * reach);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, size * CLONE.rivetRadius, 0, TAU);
      ctx.fillStyle = colours.core;
      ctx.fill();
    }
  }
}

// ---- Flame jets -------------------------------------------------------------------------------

const JET = {
  nozzleRadius: 0.2,
  boreRadius: 0.1,
  rimWidth: 0.04,
  glowRadius: 0.36,
  flameBase: 0.04,
  flameHeight: 0.32,
  flameFlicker: 0.08,
  flameHalfWidth: 0.15,
  sway: 0.03,
  swayPeriodFactor: 0.7,
  coreScale: 0.55
} as const;

/** A flame tongue rising from the nozzle; its height and lean follow the clock. */
function paintFlame(ctx: Ctx, size: number, art: Art, timeMs: number): void {
  const colours = art.device.flameJet;
  const period = art.animation.pulsePeriodMs;
  const height = size * (JET.flameHeight + JET.flameFlicker * wave(timeMs, period));
  const lean = size * JET.sway * (wave(timeMs, period * JET.swayPeriodFactor) * 2 - 1);
  const baseY = size * (HALF - JET.flameBase);
  const halfWidth = size * JET.flameHalfWidth;
  const centre = size * HALF;
  for (const [colour, scale] of [[colours.glow, 1], [colours.core, JET.coreScale]] as const) {
    ctx.beginPath();
    ctx.moveTo(centre - halfWidth * scale, baseY);
    ctx.quadraticCurveTo(centre - halfWidth * scale, baseY - height * HALF * scale, centre + lean, baseY - height * scale);
    ctx.quadraticCurveTo(centre + halfWidth * scale, baseY - height * HALF * scale, centre + halfWidth * scale, baseY);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  }
}

/** The floor, a glow when lit, and the bronze nozzle: the static part of a flame jet. */
function paintNozzle(ctx: Ctx, size: number, art: Art, nb: Neighbours, lit: boolean): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.flameJet;
  const centre = size * HALF;
  if (lit) {
    ctx.globalAlpha = NOZZLE_GLOW_ALPHA;
    ctx.fillStyle = colours.glow;
    ctx.beginPath();
    ctx.arc(centre, centre, size * JET.glowRadius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(centre, centre, size * JET.nozzleRadius, 0, TAU);
  ctx.fillStyle = colours.base;
  ctx.fill();
  ctx.strokeStyle = art.ink ? art.ink.line : lit ? colours.glow : art.device.thinWall.edge;
  ctx.lineWidth = art.ink ? heavyLineWidth(size) : Math.max(MIN_LINE_PX, size * JET.rimWidth);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centre, centre, size * JET.boreRadius, 0, TAU);
  ctx.fillStyle = art.device.thinWall.edge;
  ctx.fill();
}

// ---- Lasers -----------------------------------------------------------------------------------

const LASER = {
  housingInset: 0.1,
  housingCorner: 0.08,
  nozzleReach: 0.2,
  nozzleHalfWidth: 0.12,
  apertureRadius: 0.09,
  glowRadius: 0.05,
  coreRadius: 0.025,
  frameInset: 0.08,
  frameWidth: 0.09,
  lensRadius: 0.17,
  lensGlowRadius: 0.09,
  postWidth: 0.1,
  barCount: 4,
  barFirstX: 0.2,
  barStepX: 0.2,
  barHalfWidth: 0.035,
  barTop: 0.22,
  barClosedLength: 0.7,
  barOpenLength: 0.12,
  lintelHeight: 0.2
} as const;

/** A stone housing with an aperture toward the direction the beam leaves in. */
function paintLaserEmitter(ctx: Ctx, size: number, art: Art, nb: Neighbours, dir: Direction): void {
  paintFloor(ctx, size, art, nb);
  const inset = size * LASER.housingInset;
  const rect = { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 };
  const colours: RunewardSolidColours = { ...art.device.thinWall, base: art.device.laser.base };
  solidRect(ctx, size, art, rect, colours, size * LASER.housingCorner, true);
  if (art.ink && hasInkHatching(size)) paintHatching(ctx, size, nb, rect, art.ink.hatch);
  facing(ctx, size, dir, () => {
    const reach = size * (HALF - LASER.housingInset);
    const length = size * LASER.nozzleReach;
    const halfWidth = size * LASER.nozzleHalfWidth;
    solidRect(ctx, size, art, { x: reach - length, y: -halfWidth, w: length, h: halfWidth * 2 }, colours, 0, false);
    const aperture = reach - size * LASER.apertureRadius;
    for (const [radius, colour] of [
      [LASER.apertureRadius, art.device.thinWall.edge],
      [LASER.glowRadius, art.device.laser.glow],
      [LASER.coreRadius, art.device.laser.core]
    ] as const) {
      ctx.beginPath();
      ctx.arc(aperture, 0, size * radius, 0, TAU);
      ctx.fillStyle = colour;
      ctx.fill();
    }
  });
}

/** A receiver: a stone block framed in the colour of its laser group, a lens in the middle. */
function paintLaserReceiver(ctx: Ctx, size: number, art: Art, nb: Neighbours, channel: RunewardChannelColours, glyphKey: string): void {
  paintFloor(ctx, size, art, nb);
  const inset = size * LASER.frameInset;
  const span = size - inset * 2;
  ctx.fillStyle = art.device.laser.base;
  ctx.fillRect(inset, inset, span, span);
  const frame = Math.max(MIN_LINE_PX, size * LASER.frameWidth);
  ctx.strokeStyle = channel.main;
  ctx.lineWidth = frame;
  ctx.lineJoin = 'miter';
  ctx.strokeRect(inset + frame * HALF, inset + frame * HALF, span - frame, span - frame);
  outline(ctx, size, art, art.device.thinWall.edge, false);
  ctx.strokeRect(inset, inset, span, span);
  for (const [radius, colour] of [[LASER.lensRadius, art.device.thinWall.edge], [LASER.lensGlowRadius, channel.light]] as const) {
    ctx.beginPath();
    ctx.arc(size * HALF, size * HALF, size * radius, 0, TAU);
    ctx.fillStyle = colour;
    ctx.fill();
  }
  paintColorGlyph(ctx, glyphKey, size * HALF, size * HALF, size * LASER_GLYPH_RADIUS, art.device.thinWall.edge);
}

/** A laser gate: posts and lintel in the group colour; the bars stand while closed and are raised while open. */
function paintLaserGate(
  ctx: Ctx, size: number, art: Art, nb: Neighbours, channel: RunewardChannelColours, glyphKey: string, open: boolean
): void {
  paintFloor(ctx, size, art, nb);
  const post = size * LASER.postWidth;
  const halfWidth = size * LASER.barHalfWidth;
  const barLength = size * (open ? LASER.barOpenLength : LASER.barClosedLength);
  for (let i = 0; i < LASER.barCount; i += 1) {
    const x = size * (LASER.barFirstX + i * LASER.barStepX) - halfWidth;
    ctx.fillStyle = channel.light;
    ctx.fillRect(x, size * LASER.barTop, halfWidth * 2, barLength);
    outline(ctx, size, art, art.device.thinWall.edge, false);
    ctx.strokeRect(x, size * LASER.barTop, halfWidth * 2, barLength);
  }
  const parts: readonly InkRect[] = [
    { x: 0, y: 0, w: post, h: size },
    { x: size - post, y: 0, w: post, h: size },
    { x: 0, y: 0, w: size, h: size * LASER.lintelHeight }
  ];
  ctx.fillStyle = channel.main;
  for (const part of parts) ctx.fillRect(part.x, part.y, part.w, part.h);
  outline(ctx, size, art, art.device.thinWall.edge, false);
  for (const part of parts) ctx.strokeRect(part.x, part.y, part.w, part.h);
  paintColorGlyph(ctx, glyphKey, size * HALF, size * LASER.lintelHeight * HALF, size * LASER_GLYPH_RADIUS, art.device.thinWall.edge);
}

// ---- Shot launchers, trigger and puppet control ----------------------------------------------

const LAUNCHER = { inset: 0.1, corner: 0.06, mouthNear: 0.1, mouthFar: 0.4, mouthNarrow: 0.12, mouthWide: 0.22 } as const;

/** A stone block with a flared mouth on the side it fires toward. */
function paintShotLauncher(ctx: Ctx, size: number, art: Art, nb: Neighbours, dir: Direction): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.shotLauncher;
  const inset = size * LAUNCHER.inset;
  const rect = { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 };
  solidRect(ctx, size, art, rect, colours, size * LAUNCHER.corner, true);
  if (art.ink && hasInkHatching(size)) paintHatching(ctx, size, nb, rect, art.ink.hatch);
  facing(ctx, size, dir, () => {
    ctx.beginPath();
    ctx.moveTo(size * LAUNCHER.mouthNear, -size * LAUNCHER.mouthNarrow);
    ctx.lineTo(size * LAUNCHER.mouthFar, -size * LAUNCHER.mouthWide);
    ctx.lineTo(size * LAUNCHER.mouthFar, size * LAUNCHER.mouthWide);
    ctx.lineTo(size * LAUNCHER.mouthNear, size * LAUNCHER.mouthNarrow);
    ctx.closePath();
    ctx.fillStyle = colours.edge;
    ctx.fill();
  });
}

const TRIGGER = {
  inset: 0.12,
  corner: 0.06,
  pivotX: 0.5,
  pivotY: 0.68,
  tipX: 0.66,
  tipY: 0.3,
  stemWidth: 0.07,
  knobRadius: 0.09,
  slotWidth: 0.22,
  slotHeight: 0.07
} as const;

/** A lever plate: a stone plate with a slot and a lever leaning out of it. */
function paintShotTrigger(ctx: Ctx, size: number, art: Art, nb: Neighbours): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.shotLauncher;
  const inset = size * TRIGGER.inset;
  solidRect(ctx, size, art, { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 }, colours, size * TRIGGER.corner, false);
  ctx.fillStyle = colours.edge;
  ctx.fillRect(
    size * (TRIGGER.pivotX - TRIGGER.slotWidth * HALF),
    size * (TRIGGER.pivotY - TRIGGER.slotHeight * HALF),
    size * TRIGGER.slotWidth,
    size * TRIGGER.slotHeight
  );
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * TRIGGER.pivotX, size * TRIGGER.pivotY);
  ctx.lineTo(size * TRIGGER.tipX, size * TRIGGER.tipY);
  ctx.strokeStyle = colours.edge;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * (TRIGGER.stemWidth + OUTLINE.light));
  ctx.stroke();
  ctx.strokeStyle = colours.light;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * TRIGGER.stemWidth);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(size * TRIGGER.tipX, size * TRIGGER.tipY, size * TRIGGER.knobRadius, 0, TAU);
  ctx.fillStyle = colours.base;
  ctx.fill();
  outline(ctx, size, art, colours.edge, false);
  ctx.stroke();
}

const PUPPET = {
  plateInset: 0.1,
  plateCorner: 0.1,
  headHalf: 0.1,
  headTop: 0.24,
  headBottom: 0.4,
  eyeX: 0.05,
  eyeY: 0.32,
  eyeRadius: 0.025,
  shoulderTop: 0.46,
  shoulderHalf: 0.24,
  shoulderBottom: 0.7,
  waistHalf: 0.14,
  runeWidth: 0.04
} as const;

/** A yellow golem rune on a dark plate: a blocky head with two eyes over broad shoulders. */
function paintPuppetControl(ctx: Ctx, size: number, art: Art, nb: Neighbours): void {
  paintFloor(ctx, size, art, nb);
  const colours = art.device.puppetControl;
  const inset = size * PUPPET.plateInset;
  roundRect(ctx, inset, inset, size - inset * 2, size - inset * 2, size * PUPPET.plateCorner);
  ctx.fillStyle = colours.base;
  ctx.fill();
  outline(ctx, size, art, art.device.thinWall.edge, true);
  ctx.stroke();
  const centre = size * HALF;
  ctx.strokeStyle = colours.glow;
  ctx.lineWidth = Math.max(MIN_LINE_PX, size * PUPPET.runeWidth);
  ctx.lineJoin = 'miter';
  ctx.strokeRect(
    centre - size * PUPPET.headHalf,
    size * PUPPET.headTop,
    size * PUPPET.headHalf * 2,
    size * (PUPPET.headBottom - PUPPET.headTop)
  );
  ctx.beginPath();
  ctx.moveTo(centre - size * PUPPET.waistHalf, size * PUPPET.shoulderBottom);
  ctx.lineTo(centre - size * PUPPET.shoulderHalf, size * PUPPET.shoulderBottom);
  ctx.lineTo(centre - size * PUPPET.shoulderHalf, size * PUPPET.shoulderTop);
  ctx.lineTo(centre + size * PUPPET.shoulderHalf, size * PUPPET.shoulderTop);
  ctx.lineTo(centre + size * PUPPET.shoulderHalf, size * PUPPET.shoulderBottom);
  ctx.lineTo(centre + size * PUPPET.waistHalf, size * PUPPET.shoulderBottom);
  ctx.stroke();
  ctx.fillStyle = colours.core;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(centre + side * size * PUPPET.eyeX, size * PUPPET.eyeY, Math.max(MIN_LINE_PX, size * PUPPET.eyeRadius), 0, TAU);
    ctx.fill();
  }
}

// ---- Turrets ----------------------------------------------------------------------------------

const OBELISK = {
  baseHalf: 0.3,
  shoulderHalf: 0.2,
  baseY: 0.46,
  shoulderY: -0.28,
  apexY: -0.46,
  eyeY: 0.04,
  eyeRadius: 0.13,
  irisShare: 0.65,
  pupilShare: 0.3,
  gaze: 0.05,
  sightNear: 0.16,
  sightFar: 0.34,
  sightWidth: 0.04,
  smallEyeOffset: 0.17,
  smallEyeRadius: 0.075,
  smallGaze: 0.03,
  arrow: { cx: HALF, cy: HALF, radius: 0.42, start: 0.35, sweep: 1.1, lineWidth: 0.05, head: 0.1 } satisfies ArcArrow
} as const;

/** One eye of the obelisk: a dark socket, an iris and a pupil looking toward `dir`. */
function paintEye(ctx: Ctx, size: number, art: Art, cx: number, cy: number, radius: number, gaze: number, dir: Direction): void {
  const [dx, dy] = DIRECTION_VECTOR[dir];
  const layers: readonly (readonly [number, number, string])[] = [
    [radius, 0, art.device.thinWall.edge],
    [radius * OBELISK.irisShare, gaze, art.device.laser.glow],
    [radius * OBELISK.pupilShare, gaze * 2, art.device.laser.core]
  ];
  for (const [r, shift, colour] of layers) {
    ctx.beginPath();
    ctx.arc(cx + dx * size * shift, cy + dy * size * shift, size * r, 0, TAU);
    ctx.fillStyle = colour;
    ctx.fill();
  }
}

type TurretKind = 'fixed' | 'cw' | 'ccw' | 'multi';

/** A rune obelisk with an eye looking the way it fires; the turning ones carry an arc arrow, the multi one four eyes. */
function turretPainter(kind: TurretKind): RunewardEntityPainter {
  return (ctx, dir, x, y, size, env) => {
    const art = env.art;
    const colours = art.device.turret;
    inCell(ctx, x, y, () => {
      const centre = size * HALF;
      ctx.beginPath();
      ctx.moveTo(centre - size * OBELISK.baseHalf, centre + size * OBELISK.baseY);
      ctx.lineTo(centre - size * OBELISK.shoulderHalf, centre + size * OBELISK.shoulderY);
      ctx.lineTo(centre, centre + size * OBELISK.apexY);
      ctx.lineTo(centre + size * OBELISK.shoulderHalf, centre + size * OBELISK.shoulderY);
      ctx.lineTo(centre + size * OBELISK.baseHalf, centre + size * OBELISK.baseY);
      ctx.closePath();
      ctx.fillStyle = linear(ctx, centre - size * OBELISK.baseHalf, 0, centre + size * OBELISK.baseHalf, 0, [
        [0, colours.light],
        [MID_STOP, colours.base],
        [1, colours.dark]
      ]);
      ctx.fill();
      outline(ctx, size, art, colours.edge, true);
      ctx.stroke();
      if (kind === 'multi') {
        for (const side of EDGE_ORDER) {
          const [dx, dy] = DIRECTION_VECTOR[side];
          const offset = size * OBELISK.smallEyeOffset;
          paintEye(ctx, size, art, centre + dx * offset, centre + dy * offset, OBELISK.smallEyeRadius, OBELISK.smallGaze, side);
        }
        return;
      }
      const eyeY = centre + size * OBELISK.eyeY;
      paintEye(ctx, size, art, centre, eyeY, OBELISK.eyeRadius, OBELISK.gaze, dir);
      const [dx, dy] = DIRECTION_VECTOR[dir];
      ctx.strokeStyle = art.device.laser.glow;
      ctx.lineWidth = Math.max(MIN_LINE_PX, size * OBELISK.sightWidth);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(centre + dx * size * OBELISK.sightNear, eyeY + dy * size * OBELISK.sightNear);
      ctx.lineTo(centre + dx * size * OBELISK.sightFar, eyeY + dy * size * OBELISK.sightFar);
      ctx.stroke();
      if (kind === 'cw') paintArcArrow(ctx, size, OBELISK.arrow, 1, art.device.laser.glow);
      if (kind === 'ccw') paintArcArrow(ctx, size, OBELISK.arrow, -1, art.device.laser.glow);
    });
  };
}

// ---- Dispatch tables --------------------------------------------------------------------------

const THIN_WALL_IDS: readonly string[] = [
  'thin_wall_n', 'thin_wall_e', 'thin_wall_s', 'thin_wall_w', 'thin_wall_se', 'thin_wall_ne',
  'thin_wall_nw', 'thin_wall_sw', 'thin_wall_ns', 'thin_wall_ew', 'thin_wall_nes', 'thin_wall_new',
  'thin_wall_nsw', 'thin_wall_esw', 'thin_wall_nesw'
];
const SWIVEL_IDS: readonly string[] = [
  'swivel_door_ne', 'swivel_door_se', 'swivel_door_sw', 'swivel_door_nw',
  'swivel_door_cc2_ne', 'swivel_door_cc2_se', 'swivel_door_cc2_sw', 'swivel_door_cc2_nw'
];
const RAIL_IDS: readonly string[] = [
  'rail_ns', 'rail_ew', 'rail_ne', 'rail_se', 'rail_sw', 'rail_nw', 'rail_switch_a', 'rail_switch_b'
];
const TURN_PLATE_IDS: readonly string[] = ['turn_plate_cw', 'turn_plate_ccw'];
const EMITTER_IDS: readonly string[] = ['laser_emitter_n', 'laser_emitter_e', 'laser_emitter_s', 'laser_emitter_w'];
const RECEIVER_IDS: readonly string[] = ['laser_receiver_red', 'laser_receiver_blue'];
const GATE_IDS: readonly string[] = [
  'laser_gate_red_open', 'laser_gate_red_closed', 'laser_gate_blue_open', 'laser_gate_blue_closed'
];
const LAUNCHER_IDS: readonly string[] = ['shot_launcher_n', 'shot_launcher_e', 'shot_launcher_s', 'shot_launcher_w'];
/** Facing used when a definition declares none; never reached by the shipped tiles. */
const DEFAULT_FACING: Direction = 'N';

function entries(ids: readonly string[], make: (id: string) => RunewardTilePainter): [string, RunewardTilePainter][] {
  return ids.map((id): [string, RunewardTilePainter] => [id, make(id)]);
}

/** Painters by tile ids. */
export const TILES: Readonly<Record<string, RunewardTilePainter>> = Object.fromEntries([
  ...entries(THIN_WALL_IDS, (id) => stillTile((ctx, size, art, nb) => paintThinWall(ctx, size, art, nb, id))),
  ...entries(SWIVEL_IDS, (id) => stillTile((ctx, size, art, nb) => paintSwivel(ctx, size, art, nb, id))),
  ...entries(RAIL_IDS, (id) => stillTile((ctx, size, art, nb) => paintRail(ctx, size, art, nb, id))),
  ...entries(TURN_PLATE_IDS, (id) =>
    stillTile((ctx, size, art, nb) => paintTurnPlate(ctx, size, art, nb, definitionOf(id).facingTurn === -1 ? -1 : 1))),
  ['transmogrifier', stillTile(paintTransmogrifier)],
  ['clone_machine', stillTile(paintCloneMachine)],
  ['flame_jet_off', stillTile((ctx, size, art, nb) => paintNozzle(ctx, size, art, nb, false))],
  ['flame_jet_on', movingTile((ctx, size, art, nb, pass, timeMs) => {
    if (pass !== 'animated') paintNozzle(ctx, size, art, nb, true);
    if (pass !== 'static') paintFlame(ctx, size, art, timeMs);
  })],
  ...entries(EMITTER_IDS, (id) =>
    stillTile((ctx, size, art, nb) => paintLaserEmitter(ctx, size, art, nb, definitionOf(id).laserEmitter ?? DEFAULT_FACING))),
  ...entries(RECEIVER_IDS, (id) =>
    stillTile((ctx, size, art, nb) => paintLaserReceiver(ctx, size, art, nb, laserChannelOf(art, definitionOf(id)), laserGlyphKeyOf(art, definitionOf(id))))),
  ...entries(GATE_IDS, (id) =>
    stillTile((ctx, size, art, nb) =>
      paintLaserGate(ctx, size, art, nb, laserChannelOf(art, definitionOf(id)), laserGlyphKeyOf(art, definitionOf(id)), definitionOf(id).laserGateOpen === true))),
  ...entries(LAUNCHER_IDS, (id) =>
    stillTile((ctx, size, art, nb) => paintShotLauncher(ctx, size, art, nb, definitionOf(id).shotLauncher?.dir ?? DEFAULT_FACING))),
  ['shot_trigger', stillTile(paintShotTrigger)],
  ['puppet_control', stillTile(paintPuppetControl)]
]);

/** Painters by entity type. */
export const ENTITIES: Readonly<Record<string, RunewardEntityPainter>> = {
  turret_fixed: turretPainter('fixed'),
  turret_cw: turretPainter('cw'),
  turret_ccw: turretPainter('ccw'),
  turret_multi: turretPainter('multi')
};

/** Tile ids of this module whose painter has an animated pass; runewardTiles.ts spreads them into animatedTiles. */
export const ANIMATED: ReadonlySet<string> = new Set(['flame_jet_on']);

/** Ids this module still leaves to the shared drawing: none. */
export const PENDING: readonly string[] = [];
