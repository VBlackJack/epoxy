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
 * Dispatch of the Runeward render style: which ids have a Runeward painter, which keep the shared
 * drawing, and which belong to the CC3D ruleset. Every id the game can draw is in exactly one of
 * the three sets (a coverage test enforces it), so a new tile, item or entity forces a decision.
 */

import { ConfigRegistry } from '../../../config/ConfigRegistry';
import type { Direction, RunewardArtConfig, RunewardKeyColour } from '../../../core/types';
import { iceBendGeometry } from '../../iceBend';
import { teleporterGlyphKey } from '../../paletteKeys';
import type { TileNeighbours } from '../../tileNeighbours';
import {
  paintForce,
  paintIce,
  paintIceCorner,
  paintPocketPad,
  paintRelayPadTile,
  paintTeleport,
  paintTrap,
  type RunewardTeleportColour
} from './runewardHazards';
import {
  paintButton,
  paintChipItem,
  paintGate,
  paintKeyItem,
  paintLock,
  paintPressurePlate,
  paintToggleSlab,
  type RunewardButtonKind
} from './runewardMechanisms';
import { runewardClockMs, type RunewardPaintEnv } from './runewardEnv';
import * as blocks from './runewardBlocks';
import * as devices from './runewardDevices';
import * as items from './runewardItems';
import * as marks from './runewardMarks';
import * as monsters from './runewardMonsters';
import type { MagePose } from './runewardCharacter';
import { WIRED_BASE_TILE } from '../../wiredArt';
import { mirrorEntityPainters, variantEntityPainters, variantItemPainters, variantTilePainters } from './runewardCc2';
import { WIRED_TILES, withWiredMark } from './runewardWired';
import { paintBlueWall, paintExit, paintFloor, paintLava, paintMage, paintSeal, paintWall, paintWater } from './runewardPainters';

/** Part of a tile drawn by a call: everything, the cached static part, or the animated overlay. */
export type RunewardTilePass = 'all' | 'static' | 'animated';

export {
  runewardClockMs,
  runewardMonsterSprite,
  runewardMonsterSpriteKey,
  runewardWalkFrame,
  type RunewardPaintEnv
} from './runewardEnv';

export type RunewardTilePainter = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pass: RunewardTilePass,
  neighbours: Readonly<TileNeighbours>,
  env: RunewardPaintEnv,
  isEditor: boolean,
  isClosedTrap: boolean
) => void;

export type RunewardItemPainter = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  env: RunewardPaintEnv
) => void;

export type RunewardEntityPainter = (
  ctx: CanvasRenderingContext2D,
  dir: Direction,
  x: number,
  y: number,
  size: number,
  env: RunewardPaintEnv
) => void;

export type RunewardPlayerPose = MagePose;

export type RunewardPlayerPainter = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pose: RunewardPlayerPose,
  env: RunewardPaintEnv
) => void;

export interface RunewardPainters {
  /** Terrain, mechanism and hazard painters by tile id (also the CC3D display ids the Epoxy ids route to). */
  readonly tiles: Readonly<Record<string, RunewardTilePainter>>;
  /** Item painters by item id. */
  readonly items: Readonly<Record<string, RunewardItemPainter>>;
  /** Entity (block, mob, turret) painters by entity type. */
  readonly entities: Readonly<Record<string, RunewardEntityPainter>>;
  /** The player painter, or null while the shared drawing is used. */
  readonly player: RunewardPlayerPainter | null;
  /** The painter of a shot in flight, or null while the shared drawing is used. */
  readonly shot: RunewardEntityPainter | null;
  /** Tile ids whose painter has an animated pass (redrawn every frame over the cached terrain). */
  readonly animatedTiles: ReadonlySet<string>;
}

/** Painter registered under `id` in a dispatch table, or undefined; inherited keys never match. */
export function findRunewardPainter<T>(table: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
}

/** A pure tile drawing (see runewardPainters.ts) at the clock value it is given. */
type RunewardTileDrawing = (
  ctx: CanvasRenderingContext2D,
  size: number,
  art: Readonly<RunewardArtConfig>,
  neighbours: Readonly<TileNeighbours>,
  timeMs: number,
  part: RunewardTilePass
) => void;

/** A tile painter for a motionless tile: drawn with the cached terrain, nothing to redraw per frame. */
function staticTile(draw: RunewardTileDrawing): RunewardTilePainter {
  return (ctx, x, y, size, pass, neighbours, env) => {
    if (pass === 'animated') return;
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, size, env.art, neighbours, 0, pass);
    ctx.restore();
  };
}

/**
 * A tile painter for a moving tile: the cached terrain holds its frame at clock 0, the overlay follows the clock.
 * The pass is handed to the drawing, so an ink drawing can keep its static part out of the animated overlay.
 */
function animatedTile(draw: RunewardTileDrawing): RunewardTilePainter {
  return (ctx, x, y, size, pass, neighbours, env) => {
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, size, env.art, neighbours, pass === 'static' ? 0 : runewardClockMs(env), pass);
    ctx.restore();
  };
}

/** An item painter whose drawing follows the clock (frozen at 0 under reduced motion). */
function clockedItem(
  draw: (ctx: CanvasRenderingContext2D, size: number, art: Readonly<RunewardArtConfig>, timeMs: number) => void
): RunewardItemPainter {
  return (ctx, x, y, size, env) => {
    ctx.save();
    ctx.translate(x, y);
    draw(ctx, size, env.art, runewardClockMs(env));
    ctx.restore();
  };
}

/** The player as the chosen character, standing on the cell; the sprite lifts with the hop while its shadow stays. */
const paintPlayer: RunewardPlayerPainter = (ctx, x, y, size, pose, env) => {
  ctx.save();
  ctx.translate(x, y);
  paintMage(ctx, size, env.art, pose, runewardClockMs(env));
  ctx.restore();
};

/** A button tile of the given kind, on its pad. */
function buttonTile(spec: RunewardButtonKind): RunewardTilePainter {
  return staticTile((ctx, size, art, nb) => paintButton(ctx, size, art, spec, nb));
}

/** The trap: drawn from the state the caller passes, so it is repainted whenever the jaws change. */
const TRAP_PAINTER: RunewardTilePainter = (ctx, x, y, size, pass, neighbours, env, _isEditor, isClosedTrap) => {
  if (pass === 'animated') return;
  ctx.save();
  ctx.translate(x, y);
  paintTrap(ctx, size, env.art, neighbours, isClosedTrap);
  ctx.restore();
};

/** Colour channel of a teleport tile id, from the game's own definition; null for the plain one. */
function teleportColour(id: string, art: Readonly<RunewardArtConfig>): RunewardTeleportColour {
  const key = teleporterGlyphKey(ConfigRegistry.getTile(id));
  return key !== null && Object.prototype.hasOwnProperty.call(art.keys, key) ? (key as RunewardKeyColour) : null;
}

/** A teleport tile: the vortex turns with the clock. */
function teleportTile(id: string): RunewardTilePainter {
  return (ctx, x, y, size, pass, neighbours, env) => {
    ctx.save();
    ctx.translate(x, y);
    const timeMs = pass === 'static' ? 0 : runewardClockMs(env);
    paintTeleport(ctx, size, env.art, neighbours, timeMs, pass, teleportColour(id, env.art));
    ctx.restore();
  };
}

/** The pocket gate pad: a still notched ring, so it goes with the cached terrain. */
const POCKET_PAD_PAINTER = staticTile((ctx, size, art, nb) => paintPocketPad(ctx, size, art, nb));

/** Ice with no bend: static. */
const ICE_PAINTER = staticTile((ctx, size, art, nb) => paintIce(ctx, size, art, nb));

/** A corner ice tile: the bend geometry comes from the tile definition, as it does for the shared drawing. */
function iceCornerTile(id: string): RunewardTilePainter {
  return staticTile((ctx, size, art, nb) => {
    const bend = iceBendGeometry(ConfigRegistry.getTile(id));
    if (bend) paintIceCorner(ctx, size, art, nb, bend);
    else paintIce(ctx, size, art, nb);
  });
}

/** A force floor tile pushing toward `direction` (null: the random floor): chevrons scroll with the clock. */
function forceTile(direction: Direction | null, swirl = false): RunewardTilePainter {
  return animatedTile((ctx, size, art, nb, timeMs) => paintForce(ctx, size, art, nb, timeMs, direction, swirl));
}

/** Push direction of each directional force floor, by tile id; the random floor has none. */
const FORCE_DIRECTIONS: Readonly<Record<string, Direction>> = {
  force_n: 'N',
  force_e: 'E',
  force_s: 'S',
  force_w: 'W'
};
const RANDOM_FORCE_ID = 'force_random';
/** The turning force floor: a clockwise pinwheel instead of the random floor's outward one. */
const CYCLE_FORCE_ID = 'force_cycle';
/** Teleport tile ids: the plain one and one per colour channel. */
const TELEPORT_IDS: readonly string[] = ['teleport', 'teleport_red', 'teleport_blue', 'teleport_yellow', 'teleport_green'];
/** The pad a pocket gate becomes when set down. */
const POCKET_PAD_ID = 'pocket_gate_pad';
/** Corner ice tile ids. */
const ICE_CORNER_IDS: readonly string[] = ['ice_nw', 'ice_ne', 'ice_sw', 'ice_se'];

/** Painters of the hazards and movers, by tile id. */
const HAZARD_TILES: Readonly<Record<string, RunewardTilePainter>> = Object.fromEntries([
  ['trap', TRAP_PAINTER],
  ['ice', ICE_PAINTER],
  ...ICE_CORNER_IDS.map((id): [string, RunewardTilePainter] => [id, iceCornerTile(id)]),
  ...TELEPORT_IDS.map((id): [string, RunewardTilePainter] => [id, teleportTile(id)]),
  [POCKET_PAD_ID, POCKET_PAD_PAINTER],
  ['relay_pad_dark', staticTile((ctx, size, art, nb) => paintRelayPadTile(ctx, size, art, nb, false))],
  ['relay_pad_lit', staticTile((ctx, size, art, nb) => paintRelayPadTile(ctx, size, art, nb, true))],
  ...Object.entries(FORCE_DIRECTIONS).map(([id, direction]): [string, RunewardTilePainter] => [id, forceTile(direction)]),
  [RANDOM_FORCE_ID, forceTile(null)],
  [CYCLE_FORCE_ID, forceTile(null, true)]
]);

/** Tile ids whose painter has an animated pass: the liquids, the exit, the teleports and the force floors. */
const ANIMATED_TILE_IDS: readonly string[] = [
  'water', 'fire', 'exit', ...TELEPORT_IDS, ...Object.keys(FORCE_DIRECTIONS), RANDOM_FORCE_ID, CYCLE_FORCE_ID
];

/** The turtle tile: it bobs on the water, so it has an animated pass. */
const TURTLE_TILE_ID = 'turtle';

/** Floor-like tiles all show the same flagstones, so hidden walls give nothing away. */
const FLOOR_PAINTER = staticTile(paintFloor);
const WALL_PAINTER = staticTile(paintWall);
/** Both blue walls share one drawing: nothing in it may tell the real one from the fake one. */
const BLUE_WALL_PAINTER = staticTile(paintBlueWall);

/** Colour channels with a locked door, a key, a hold door and a pressure plate. */
const CHANNEL_COLOURS: readonly RunewardKeyColour[] = ['red', 'blue', 'yellow', 'green'];
/** Colour channels with a colour toggle wall and button; green is the plain toggle wall. */
const TOGGLE_COLOURS: readonly RunewardKeyColour[] = ['red', 'blue', 'yellow'];
/** The channel of the plain toggle wall and of its button. */
const PLAIN_TOGGLE_COLOUR: RunewardKeyColour = 'green';
/** Colours of the one-shot buttons that carry a colour (the brown trap button has none). */
const BUTTON_COLOURS: readonly RunewardKeyColour[] = ['red', 'blue', 'green'];

/** Painters of the colour mechanisms, by tile id. */
const MECHANISM_TILES: Readonly<Record<string, RunewardTilePainter>> = Object.fromEntries([
  ...CHANNEL_COLOURS.flatMap((colour): [string, RunewardTilePainter][] => [
    [`door_${colour}`, staticTile((ctx, size, art, nb) => paintLock(ctx, size, art, colour, nb))],
    [`pressure_plate_${colour}`, staticTile((ctx, size, art, nb) => paintPressurePlate(ctx, size, art, colour, nb))],
    [`hold_door_${colour}_closed`, staticTile((ctx, size, art, nb) => paintGate(ctx, size, art, colour, false, nb))],
    [`hold_door_${colour}_open`, staticTile((ctx, size, art, nb) => paintGate(ctx, size, art, colour, true, nb))]
  ]),
  ['toggle_wall_closed', staticTile((ctx, size, art, nb) => paintToggleSlab(ctx, size, art, PLAIN_TOGGLE_COLOUR, false, nb))],
  ['toggle_wall_open', staticTile((ctx, size, art, nb) => paintToggleSlab(ctx, size, art, PLAIN_TOGGLE_COLOUR, true, nb))],
  ...TOGGLE_COLOURS.flatMap((colour): [string, RunewardTilePainter][] => [
    [`toggle_wall_${colour}_closed`, staticTile((ctx, size, art, nb) => paintToggleSlab(ctx, size, art, colour, false, nb))],
    [`toggle_wall_${colour}_open`, staticTile((ctx, size, art, nb) => paintToggleSlab(ctx, size, art, colour, true, nb))],
    [`toggle_button_${colour}`, buttonTile({ kind: 'toggle', colour })]
  ]),
  ...BUTTON_COLOURS.map((colour): [string, RunewardTilePainter] => [`button_${colour}`, buttonTile({ kind: 'colour', colour })]),
  ['button_brown', buttonTile({ kind: 'jaw' })]
]);

/** Painters of the keys and the chip, by item id. */
const MECHANISM_ITEMS: Readonly<Record<string, RunewardItemPainter>> = Object.fromEntries([
  ...CHANNEL_COLOURS.map((colour): [string, RunewardItemPainter] => [
    `key_${colour}`,
    clockedItem((ctx, size, art, timeMs) => paintKeyItem(ctx, size, art, colour, timeMs))
  ]),
  ['chip', clockedItem(paintChipItem)]
]);

/** The wired trap and flame jets: the plain device of the style with the plug of a wired cell on top. */
function wiredPlainTiles(): Record<string, RunewardTilePainter> {
  const tiles: Record<string, RunewardTilePainter> = {};
  for (const [id, baseId] of Object.entries(WIRED_BASE_TILE)) {
    const base = baseId === 'trap' ? TRAP_PAINTER : devices.TILES[baseId];
    tiles[id] = withWiredMark(base, devices.ANIMATED.has(baseId));
  }
  return tiles;
}

/** The terrain painters of the lot modules and the shared tiles, before the look-alikes built on them. */
const BASE_TILE_PAINTERS: Readonly<Record<string, RunewardTilePainter>> = {
  ...MECHANISM_TILES,
  ...HAZARD_TILES,
  floor: FLOOR_PAINTER,
  socket: staticTile(paintSeal),
  invisible_wall: FLOOR_PAINTER,
  appearing_wall: FLOOR_PAINTER,
  wall: WALL_PAINTER,
  blue_wall_real: BLUE_WALL_PAINTER,
  blue_wall_fake: BLUE_WALL_PAINTER,
  water: animatedTile(paintWater),
  fire: animatedTile(paintLava),
  exit: animatedTile(paintExit),
  ...devices.TILES,
  ...items.TILES,
  ...marks.TILES,
  ...WIRED_TILES,
  ...wiredPlainTiles()
};

/** The item painters, before the look-alikes built on them. */
const BASE_ITEM_PAINTERS: Readonly<Record<string, RunewardItemPainter>> = { ...MECHANISM_ITEMS, ...items.ITEMS };

/** The entity painters, before the look-alikes built on them. */
const BASE_ENTITY_PAINTERS: Readonly<Record<string, RunewardEntityPainter>> = { ...blocks.ENTITIES, ...monsters.ENTITIES, ...devices.ENTITIES };

/** Ids drawn by a Runeward painter. */
export const RUNEWARD_PAINTERS: RunewardPainters = {
  tiles: { ...BASE_TILE_PAINTERS, ...variantTilePainters(BASE_TILE_PAINTERS) },
  items: { ...BASE_ITEM_PAINTERS, ...variantItemPainters(BASE_ITEM_PAINTERS) },
  entities: { ...BASE_ENTITY_PAINTERS, ...variantEntityPainters(BASE_ENTITY_PAINTERS), ...mirrorEntityPainters() },
  player: paintPlayer,
  shot: monsters.SHOT,
  animatedTiles: new Set<string>([...ANIMATED_TILE_IDS, ...devices.ANIMATED, TURTLE_TILE_ID, ...Object.keys(WIRED_BASE_TILE).filter((id) => devices.ANIMATED.has(WIRED_BASE_TILE[id]))])
};

/** Every Epoxy tile, item and entity id that keeps the shared drawing: the ids the lot modules still leave out (none). */
export const RUNEWARD_FALLBACK: ReadonlySet<string> = new Set([
  ...blocks.PENDING,
  ...monsters.PENDING,
  ...devices.PENDING,
  ...items.PENDING,
  ...marks.PENDING
]);

/** Display ids of the CC3D ruleset (cc3d-tiles.json): a third set, drawn by the shared CC3D painters. */
export const RUNEWARD_CC3D_IDS: ReadonlySet<string> = new Set([
  'cc3d_plate_red', 'cc3d_plate_green', 'cc3d_plate_blue', 'cc3d_plate_yellow', 'cc3d_hold_door_red_open',
  'cc3d_hold_door_red_closed', 'cc3d_hold_door_green_open', 'cc3d_hold_door_green_closed',
  'cc3d_hold_door_blue_open', 'cc3d_hold_door_blue_closed', 'cc3d_hold_door_yellow_open',
  'cc3d_hold_door_yellow_closed', 'cc3d_toggle_door_red_open', 'cc3d_toggle_door_red_closed',
  'cc3d_toggle_control_red', 'cc3d_toggle_door_blue_open', 'cc3d_toggle_door_blue_closed',
  'cc3d_toggle_control_blue', 'cc3d_toggle_door_yellow_open', 'cc3d_toggle_door_yellow_closed',
  'cc3d_toggle_control_yellow', 'cc3d_block_red', 'cc3d_block_green', 'cc3d_block_blue',
  'cc3d_block_yellow', 'cc3d_reflector_lu', 'cc3d_reflector_dl', 'cc3d_reflector_ur', 'cc3d_reflector_rd',
  'cc3d_socket_red', 'cc3d_sand', 'cc3d_golem_control_yellow', 'cc3d_laser_controller', 'cc3d_fish_extra',
  'cc3d_legs_green', 'cc3d_legs_red', 'cc3d_baby_blinky', 'cc3d_baby_screamer', 'cc3d_golem_yellow',
  'cc3d_shot', 'cc3d_laser_shooter', 'cc3d_bot_static', 'cc3d_bot_cw', 'cc3d_bot_ccw', 'cc3d_bot_multi'
]);
