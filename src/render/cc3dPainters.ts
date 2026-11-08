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

import { REFLECTING_FACES } from '../core/cc3d/cc3dLasers';
import { MIRROR_FRONT_AXIS, SHOT_TRIGGER_TILE_ID } from '../core/coreConstants';
import type { Direction } from '../core/types';

/** Prefix of every display id that only the cc3d ruleset uses. */
export const CC3D_TILE_PREFIX = 'cc3d_';

const FULL_TURN = Math.PI * 2;
/** Unit vector of each direction on the canvas (y grows downwards). */
const DIR_VECTOR: Readonly<Record<Direction, readonly [number, number]>> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0]
};
const ALL_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
/** Stored name of the reflector whose glass sits in each corner of the cell. */
const REFLECTOR_NAME_BY_CORNER: Readonly<Record<string, string>> = { NE: 'rd', NW: 'dl', SE: 'ur', SW: 'lu' };
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
/** Prefix of the terrain form of the shooter, which carries its facing as a last letter (Epoxy's shot launchers). */
const LASER_SHOOTER_TERRAIN_FAMILY = 'laser_shooter_';
const SHOT = 'shot';
const SOCKET_RED = 'socket_red';
const SAND = 'sand';
const GOLEM_CONTROL = 'golem_control_yellow';
const LASER_CONTROLLER = 'laser_controller';
const BOT_STATIC = 'static';
const BOT_MULTI = 'multi';
const BOT_CLOCKWISE = 'cw';
/** Display id of the cc3d shot, which Epoxy draws for its flying shots. */
export const SHOT_PAINTER_ID = `${CC3D_TILE_PREFIX}${SHOT}`;
/** Display id of the shooter as a terrain glyph facing `dir`, which Epoxy draws for its shot launchers. */
export function shooterTerrainPainterId(dir: Direction): string {
  return `${CC3D_TILE_PREFIX}${LASER_SHOOTER_TERRAIN_FAMILY}${dir.toLowerCase()}`;
}
/** Display id of the reflector that turns the shots coming in through the two sides that meet at `corner`. */
export function reflectorPainterId(corner: string): string {
  const name = REFLECTOR_NAME_BY_CORNER[corner];
  return `${CC3D_TILE_PREFIX}${REFLECTOR_FAMILY}${name}`;
}
/**
 * The cc3d glyph each Epoxy shot device is drawn as: a shot launcher is the shooter facing its way, the shot
 * trigger is the laser controller and a one-sided mirror is the reflector with its glass in the corner the
 * mirror faces.
 */
export const EPOXY_SHOT_PAINTERS: Readonly<Record<string, string>> = Object.fromEntries([
  ...ALL_DIRECTIONS.map((d) => [`shot_launcher_${d.toLowerCase()}`, shooterTerrainPainterId(d)]),
  [SHOT_TRIGGER_TILE_ID, `${CC3D_TILE_PREFIX}${LASER_CONTROLLER}`],
  ...Object.keys(MIRROR_FRONT_AXIS).map((c) => [`one_sided_mirror_${c.toLowerCase()}`, reflectorPainterId(c)])
]);
/** Display id of the golem control, which Epoxy draws for its puppet control. */
export const GOLEM_CONTROL_PAINTER_ID = `${CC3D_TILE_PREFIX}${GOLEM_CONTROL}`;
/** Display id of the sand, which Epoxy draws for its sand floor. */
export const SAND_PAINTER_ID = `${CC3D_TILE_PREFIX}${SAND}`;
/** Display id of the yellow golem, which Epoxy draws for its puppet. */
export const GOLEM_YELLOW_PAINTER_ID = `${CC3D_TILE_PREFIX}golem_yellow`;
const OPEN_DASH: readonly number[] = [3, 3];
const HOLD_DASH: readonly number[] = [1.5, 1.5];
const NO_DASH: readonly number[] = [];
const WEST: Direction = 'W';
const NORTH: Direction = 'N';

/** Tile-relative geometry (fractions of the tile side) and a few small counts. */
const GEO = {
  shotHalo: 0.17,
  shotCore: 0.09,
  shotRing: 0.25,
  shotRingAlpha: 0.35,
  plateInset: 0.2,
  plateRing: 0.14,
  doorInset: 0.08,
  slabFrame: 0.07,
  slabBevel: 0.05,
  doorPanelInset: 0.24,
  doorSlats: 3,
  frameWidth: 0.07,
  openTintAlpha: 0.12,
  ghostAlpha: 0.3,
  glyphRadius: 0.14,
  controlRadius: 0.3,
  controlInner: 0.22,
  controlGlyph: 0.065,
  controlArrowTip: 0.2,
  controlArrowBase: 0.11,
  controlArrowHalf: 0.07,
  blockInset: 0.1,
  blockFaceInset: 0.17,
  blockFront: 0.13,
  blockGlyph: 0.13,
  corner: 0.14,
  mirrorInset: 0.08,
  mirrorPane: 0.19,
  mirrorSheenWidth: 0.06,
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
  nozzleWidth: 0.12,
  barrelReach: 0.46,
  nozzleStart: 0.33,
  turretRadius: 0.12,
  botRadius: 0.3,
  botFace: 0.78,
  botNoseLength: 0.15,
  botNoseHalf: 0.09,
  botNoseEmbed: 0.85,
  botEye: 0.06,
  botSpinRadius: 0.13,
  botSpinHead: 0.07,
  botSpinStart: 0.25,
  botSpinSweep: 1.5,
  botSpinHeadSpread: 0.8,
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

/** Epoxy-only monsters drawn as an existing monster with a mark, by entity type: the skitter is teeth that run away, the lurker a blob with an orange mark, the wisp a glider with a ring-coloured mark, the floor mimic plain teeth (drawn nearly invisible), the timid teeth teeth with a yellow mark, the ghost a glider with a gray mark and the rover a blob with a brown mark. The CC3D monsters are the monster they resemble with a mark (the babies half size, unmarked): the bouncer a pink ball with a blue mark, the snappy and the nibble teeth with a red and a green mark, the blinky a glider with a red mark, the limpy a paramecium and the limpa a bug with a green mark, the omni a blob with a green mark, the legs a walker with a green and a red mark (as in CC3D), the screamer a fireball with a blue mark, the CC3D walker a walker with a yellow mark, the blue golem a tank with a blue mark, the yellow golem a tank with a yellow mark. */
export const EPOXY_MOB_BASES: Readonly<Record<string, Cc3dMobBase>> = {
  skitter: { base: 'teeth', scale: FULL_SCALE, badge: 'blue' },
  lurker: { base: 'blob', scale: FULL_SCALE, badge: 'orange' },
  wisp: { base: 'glider', scale: FULL_SCALE, badge: 'teleportRing' },
  floor_mimic: { base: 'teeth', scale: FULL_SCALE, badge: null },
  timid_teeth: { base: 'teeth', scale: FULL_SCALE, badge: 'yellow' },
  ghost: { base: 'glider', scale: FULL_SCALE, badge: 'gray' },
  rover: { base: 'blob', scale: FULL_SCALE, badge: 'brown' },
  bouncer: { base: 'pink_ball', scale: FULL_SCALE, badge: 'blue' },
  snappy: { base: 'teeth', scale: FULL_SCALE, badge: 'red' },
  nibble: { base: 'teeth', scale: FULL_SCALE, badge: 'green' },
  blinky: { base: 'glider', scale: FULL_SCALE, badge: 'red' },
  baby_blinky: { base: 'glider', scale: BABY_SCALE, badge: null },
  limpy: { base: 'paramecium', scale: FULL_SCALE, badge: 'green' },
  limpa: { base: 'bug', scale: FULL_SCALE, badge: 'green' },
  omni: { base: 'blob', scale: FULL_SCALE, badge: 'green' },
  legs_green: { base: 'walker', scale: FULL_SCALE, badge: 'green' },
  legs_red: { base: 'walker', scale: FULL_SCALE, badge: 'red' },
  screamer: { base: 'fireball', scale: FULL_SCALE, badge: 'blue' },
  baby_screamer: { base: 'fireball', scale: BABY_SCALE, badge: null },
  walker_3d: { base: 'walker', scale: FULL_SCALE, badge: 'yellow' },
  golem_blue: { base: 'tank', scale: FULL_SCALE, badge: 'blue' },
  golem_yellow: { base: 'tank', scale: FULL_SCALE, badge: 'yellow' }
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

/** A pressure plate: a flat square pad sunk into the floor, in its colour, with the colour glyph. */
function paintPlate(ctx: CanvasRenderingContext2D, color: CellColor, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const inset = size * GEO.plateInset;
  ctx.fillStyle = tools.pal.wallShadow;
  roundedSquare(ctx, x + inset, y + inset, size - inset * 2, size * GEO.corner);
  ctx.fill();
  ctx.strokeStyle = tools.pal.wallTop;
  ctx.lineWidth = 1;
  ctx.stroke();
  const ring = size * GEO.plateRing;
  ctx.fillStyle = tools.pal[color];
  roundedSquare(ctx, x + inset + ring / 2, y + inset + ring / 2, size - inset * 2 - ring, (size * GEO.corner) / 2);
  ctx.fill();
  tools.glyph(color, x + size / 2, y + size / 2, size * GEO.glyphRadius, tools.pal.wallShadow);
}

/** A shut door: a raised slab (light top edge, dark front edge) framed in its colour, like the green toggle wall. */
function paintClosedSlab(ctx: CanvasRenderingContext2D, color: CellColor, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const inset = size * GEO.doorInset;
  const side = size - inset * 2;
  const bevel = size * GEO.slabBevel;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.fillRect(x + inset, y + inset, side, side);
  ctx.fillStyle = tools.pal.monsterHighlight;
  ctx.fillRect(x + inset, y + inset, side, bevel);
  ctx.fillStyle = tools.pal.modernWallFrontShade;
  ctx.fillRect(x + inset, y + inset + side - bevel * 2, side, bevel * 2);
  const frame = inset + size * GEO.slabFrame;
  ctx.strokeStyle = tools.pal[color];
  ctx.lineWidth = Math.max(1, size * GEO.frameWidth);
  ctx.strokeRect(x + frame, y + frame, size - frame * 2, size - frame * 2);
}

/** Horizontal slats of a hold door, in the current fill colour. */
function fillSlats(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const pad = size * GEO.doorPanelInset;
  const slatHeight = (size - pad * 2) / (GEO.doorSlats * 2 - 1);
  for (let i = 0; i < GEO.doorSlats; i++) {
    ctx.fillRect(x + pad, y + pad + i * slatHeight * 2, size - pad * 2, slatHeight);
  }
}

/**
 * An open door is flat: a dashed outline of its frame over a faint tint of its colour, with the
 * ghost of what closes it (slats for a hold door, the glyph for a toggle door).
 */
function paintOpenDoor(ctx: CanvasRenderingContext2D, color: CellColor, hold: boolean, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const inset = size * GEO.doorInset;
  const side = size - inset * 2;
  ctx.save();
  ctx.fillStyle = tools.pal[color];
  ctx.strokeStyle = tools.pal[color];
  ctx.globalAlpha = GEO.openTintAlpha;
  ctx.fillRect(x + inset, y + inset, side, side);
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1, size * GEO.frameWidth);
  ctx.setLineDash(hold ? HOLD_DASH : OPEN_DASH);
  ctx.strokeRect(x + inset, y + inset, side, side);
  ctx.setLineDash(NO_DASH);
  ctx.globalAlpha = GEO.ghostAlpha;
  if (hold) fillSlats(ctx, x, y, size);
  else tools.glyph(color, x + size / 2, y + size / 2, size * GEO.glyphRadius, tools.pal[color]);
  ctx.restore();
}

/** A hold door: shut while nothing weighs on its plate; the slats tell it from a toggle door. */
function paintHoldDoor(ctx: CanvasRenderingContext2D, color: CellColor, open: boolean, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  if (open) {
    paintOpenDoor(ctx, color, true, x, y, size, tools);
    return;
  }
  paintClosedSlab(ctx, color, x, y, size, tools);
  ctx.fillStyle = tools.pal[color];
  fillSlats(ctx, x, y, size);
}

/** A toggle door: a closed slab carries the colour glyph, like a toggle wall. */
function paintToggleDoor(ctx: CanvasRenderingContext2D, color: CellColor, open: boolean, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  if (open) {
    paintOpenDoor(ctx, color, false, x, y, size, tools);
    return;
  }
  paintClosedSlab(ctx, color, x, y, size, tools);
  tools.glyph(color, x + size / 2, y + size / 2, size * GEO.glyphRadius, tools.pal[color]);
}

/** A round button like Epoxy's, in a colour, with a small glyph between two opposed arrow heads: it flips the doors. */
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
  const tip = size * GEO.controlArrowTip;
  const base = size * GEO.controlArrowBase;
  const half = size * GEO.controlArrowHalf;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.beginPath();
  ctx.moveTo(cx - tip, cy);
  ctx.lineTo(cx - base, cy - half);
  ctx.lineTo(cx - base, cy + half);
  ctx.closePath();
  ctx.moveTo(cx + tip, cy);
  ctx.lineTo(cx + base, cy - half);
  ctx.lineTo(cx + base, cy + half);
  ctx.closePath();
  ctx.fill();
  tools.glyph(color, cx, cy, size * GEO.controlGlyph, tools.pal.wallShadow);
}

/** A pushable colour block: a bevelled block like the dirt block (top face, darker front), tinted, with the colour glyph. */
function paintColorBlock(ctx: CanvasRenderingContext2D, color: CellColor, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const inset = size * GEO.blockInset;
  const side = size - inset * 2;
  const front = size * GEO.blockFront;
  ctx.fillStyle = tools.pal.wallShadow;
  roundedSquare(ctx, x + inset, y + inset, side, size * GEO.corner);
  ctx.fill();
  ctx.fillStyle = tools.pal.modernWallFrontShade;
  ctx.fillRect(x + inset, y + size - inset - front, side, front);
  const face = size * GEO.blockFaceInset;
  const faceWidth = size - face * 2;
  const faceHeight = size - inset - front - face;
  ctx.fillStyle = tools.pal[color];
  ctx.fillRect(x + face, y + face, faceWidth, faceHeight);
  ctx.fillStyle = tools.pal.monsterHighlight;
  ctx.fillRect(x + face, y + face, faceWidth, size * GEO.slabBevel);
  tools.glyph(color, x + size / 2, y + face + faceHeight / 2, size * GEO.blockGlyph, tools.pal.wallShadow);
}

/** A colour block that sank into water and floats there: the block, faint, over the water already drawn. */
export function paintCc3dFloatingBlock(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const cellColor = COLORS.find((c) => c === color);
  if (!cellColor) return;
  ctx.save();
  ctx.globalAlpha = GEO.ghostAlpha;
  paintColorBlock(ctx, cellColor, x, y, size, tools);
  ctx.restore();
}

/**
 * A corner reflector, a pushable block cut along a diagonal: the half that faces the two reflecting
 * sides is bright mirror glass with a sheen along those two sides, the back half is dark.
 */
function paintReflector(ctx: CanvasRenderingContext2D, mirror: string, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const key = mirror.toUpperCase();
  if (!Object.hasOwn(REFLECTING_FACES, key)) return;
  const faces = REFLECTING_FACES[key];
  const inset = size * GEO.mirrorInset;
  const pane = size * GEO.mirrorPane;
  ctx.fillStyle = tools.pal.mirrorFrame;
  roundedSquare(ctx, x + inset, y + inset, size - inset * 2, size * GEO.corner);
  ctx.fill();
  const left = x + pane;
  const right = x + size - pane;
  const top = y + pane;
  const bottom = y + size - pane;
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.fillRect(left, top, right - left, bottom - top);
  const west = faces.includes(WEST);
  const north = faces.includes(NORTH);
  const cornerX = west ? left : right;
  const cornerY = north ? top : bottom;
  const farX = west ? right : left;
  const farY = north ? bottom : top;
  ctx.fillStyle = tools.pal.mirrorGlass;
  ctx.beginPath();
  ctx.moveTo(cornerX, cornerY);
  ctx.lineTo(farX, cornerY);
  ctx.lineTo(cornerX, farY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = tools.pal.mirrorSheen;
  ctx.lineWidth = Math.max(1, size * GEO.mirrorSheenWidth);
  ctx.beginPath();
  ctx.moveTo(farX, cornerY);
  ctx.lineTo(cornerX, cornerY);
  ctx.lineTo(cornerX, farY);
  ctx.moveTo(farX, cornerY);
  ctx.lineTo(cornerX, farY);
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
  else if (name.startsWith(LASER_SHOOTER_TERRAIN_FAMILY)) {
    const dir = name.slice(LASER_SHOOTER_TERRAIN_FAMILY.length).toUpperCase();
    if (Object.hasOwn(DIR_VECTOR, dir)) paintLaserShooter(ctx, dir as Direction, x, y, size, tools);
  }
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

/** A thick line from `from` to `to` along `dir`, both given as fractions of the tile side from the centre. */
function strokeAlong(ctx: CanvasRenderingContext2D, dir: Direction, cx: number, cy: number, from: number, to: number, size: number): void {
  const [dx, dy] = DIR_VECTOR[dir];
  ctx.beginPath();
  ctx.moveTo(cx + dx * size * from, cy + dy * size * from);
  ctx.lineTo(cx + dx * size * to, cy + dy * size * to);
  ctx.stroke();
}

/**
 * The laser shooter: a square housing like Epoxy's laser emitter, with a long barrel and a red
 * nozzle towards its facing. A bot is round and short-nosed, so the two never read alike.
 */
function paintLaserShooter(ctx: CanvasRenderingContext2D, dir: Direction, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const half = size * (0.5 - GEO.panelInset);
  ctx.fillStyle = tools.pal.wallShadow;
  roundedSquare(ctx, cx - half, cy - half, half * 2, size * GEO.corner);
  ctx.fill();
  ctx.strokeStyle = tools.pal.wallTop;
  ctx.lineWidth = Math.max(1, size * GEO.frameWidth);
  ctx.stroke();
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineWidth = size * GEO.barrelWidth;
  ctx.strokeStyle = tools.pal.wallTop;
  strokeAlong(ctx, dir, cx, cy, 0, GEO.barrelReach, size);
  ctx.lineWidth = size * GEO.nozzleWidth;
  ctx.strokeStyle = tools.pal.laserBeam;
  strokeAlong(ctx, dir, cx, cy, GEO.nozzleStart, GEO.barrelReach, size);
  ctx.fillStyle = tools.pal.wallBase;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.turretRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tools.pal.laserBeam;
  ctx.beginPath();
  ctx.arc(cx, cy, (size * GEO.eyeRadius) / GEO.eyeCoreDivisor, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

/** An emitter nose on the body edge of a bot, pointing towards `dir`, in the current fill colour. */
function fillBotNose(ctx: CanvasRenderingContext2D, dir: Direction, cx: number, cy: number, size: number): void {
  const [dx, dy] = DIR_VECTOR[dir];
  const radius = size * GEO.botRadius;
  const baseX = cx + dx * radius * GEO.botNoseEmbed;
  const baseY = cy + dy * radius * GEO.botNoseEmbed;
  const tipX = cx + dx * (radius + size * GEO.botNoseLength);
  const tipY = cy + dy * (radius + size * GEO.botNoseLength);
  const half = size * GEO.botNoseHalf;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX - dy * half, baseY + dx * half);
  ctx.lineTo(baseX + dy * half, baseY - dx * half);
  ctx.closePath();
  ctx.fill();
}

/** A three-quarter arc ending in an arrow head, turning clockwise or counterclockwise. */
function strokeSpin(ctx: CanvasRenderingContext2D, clockwise: boolean, cx: number, cy: number, size: number): void {
  const sign = clockwise ? 1 : -1;
  const radius = size * GEO.botSpinRadius;
  const start = Math.PI * GEO.botSpinStart;
  const end = start + sign * Math.PI * GEO.botSpinSweep;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end, !clockwise);
  ctx.stroke();
  const cos = Math.cos(end);
  const sin = Math.sin(end);
  const head = size * GEO.botSpinHead;
  const px = cx + cos * radius;
  const py = cy + sin * radius;
  ctx.beginPath();
  ctx.moveTo(px - sign * sin * head, py + sign * cos * head);
  ctx.lineTo(px + cos * head * GEO.botSpinHeadSpread, py + sin * head * GEO.botSpinHeadSpread);
  ctx.lineTo(px - cos * head * GEO.botSpinHeadSpread, py - sin * head * GEO.botSpinHeadSpread);
  ctx.closePath();
  ctx.fill();
}

/**
 * Bots: a round grey body with a red emitter nose on the facing side (four noses for the
 * multidirectional one) and, for the rotating kinds, a small rotation glyph that tells cw from ccw.
 */
function paintBot(ctx: CanvasRenderingContext2D, kind: string, dir: Direction, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.fillStyle = tools.pal.laserBeam;
  if (kind === BOT_MULTI) {
    for (const side of ALL_DIRECTIONS) fillBotNose(ctx, side, cx, cy, size);
  } else {
    fillBotNose(ctx, dir, cx, cy, size);
  }
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.botRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tools.pal.gray;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.botRadius * GEO.botFace, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = tools.pal.wallShadow;
  ctx.strokeStyle = tools.pal.wallShadow;
  ctx.lineWidth = Math.max(1, size * GEO.frameWidth);
  if (kind === BOT_STATIC || kind === BOT_MULTI) {
    ctx.beginPath();
    ctx.arc(cx, cy, size * GEO.botEye, 0, FULL_TURN);
    ctx.fill();
  } else {
    strokeSpin(ctx, kind === BOT_CLOCKWISE, cx, cy, size);
  }
}

/** A laser shot: a small bright bolt, a faint ring around a halo with a white-hot core. */
function paintShot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tools: Cc3dPaintTools): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.globalAlpha = GEO.shotRingAlpha;
  ctx.fillStyle = tools.pal.laserBeam;
  ctx.beginPath();
  ctx.arc(cx, cy, size * GEO.shotRing, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
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
  else if (name.startsWith(BOT_FAMILY)) paintBot(ctx, name.slice(BOT_FAMILY.length), dir, x, y, size, tools);
}
