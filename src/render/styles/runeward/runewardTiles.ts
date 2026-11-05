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
 * Painters are added lot by lot; an id without a painter falls through to the shared drawing.
 */

import type { Direction, RunewardArtConfig } from '../../../core/types';
import { REFERENCE_FRAME_MS } from '../../renderTiming';
import type { TileNeighbours } from '../../tileNeighbours';
import { paintBlueWall, paintExit, paintFloor, paintLava, paintMage, paintWall, paintWater } from './runewardPainters';

/** Part of a tile drawn by a call: everything, the cached static part, or the animated overlay. */
export type RunewardTilePass = 'all' | 'static' | 'animated';

/** What a painter may use besides its arguments. */
export interface RunewardPaintEnv {
  /** Animation clock of the renderer, in frame ticks. */
  readonly timeTick: number;
  /** True when the player asked for reduced motion. */
  readonly reducedMotion: boolean;
  /** Per-renderer cache a painter may fill lazily (sprites, gradients); created on first use. */
  readonly cache: Map<string, unknown>;
  /** Colours and timings of the painters (game.json runewardArt). */
  readonly art: Readonly<RunewardArtConfig>;
}

/** Animation clock of the painters in milliseconds; reduced motion freezes it at 0. */
export function runewardClockMs(env: Pick<RunewardPaintEnv, 'timeTick' | 'reducedMotion'>): number {
  return env.reducedMotion ? 0 : env.timeTick * REFERENCE_FRAME_MS;
}

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

export interface RunewardPlayerPose {
  readonly dir: Direction;
  readonly inWater: boolean;
  readonly alive: boolean;
  /** 0 standing, 1 or 2 for the two strides. */
  readonly frame: number;
  /** Lift of the sprite in tiles. */
  readonly hop: number;
}

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

/** The player as the mage, standing on the cell; the sprite lifts with the hop while its shadow stays. */
const paintPlayer: RunewardPlayerPainter = (ctx, x, y, size, pose, env) => {
  ctx.save();
  ctx.translate(x, y);
  paintMage(ctx, size, env.art, pose, runewardClockMs(env));
  ctx.restore();
};

/** Floor-like tiles all show the same flagstones, so hidden walls give nothing away. */
const FLOOR_PAINTER = staticTile(paintFloor);
const WALL_PAINTER = staticTile(paintWall);
/** Both blue walls share one drawing: nothing in it may tell the real one from the fake one. */
const BLUE_WALL_PAINTER = staticTile(paintBlueWall);

/** Ids drawn by a Runeward painter. */
export const RUNEWARD_PAINTERS: RunewardPainters = {
  tiles: {
    floor: FLOOR_PAINTER,
    gravel: FLOOR_PAINTER,
    dirt: FLOOR_PAINTER,
    hint: FLOOR_PAINTER,
    socket: FLOOR_PAINTER,
    invisible_wall: FLOOR_PAINTER,
    appearing_wall: FLOOR_PAINTER,
    wall: WALL_PAINTER,
    blue_wall_real: BLUE_WALL_PAINTER,
    blue_wall_fake: BLUE_WALL_PAINTER,
    water: animatedTile(paintWater),
    fire: animatedTile(paintLava),
    exit: animatedTile(paintExit)
  },
  items: {},
  entities: {},
  player: paintPlayer,
  animatedTiles: new Set<string>(['water', 'fire', 'exit'])
};

/** Epoxy tile and item ids (tiles.json) that keep the shared drawing for now. */
const RUNEWARD_FALLBACK_TILE_IDS: readonly string[] = [
  'recessed_wall',
  'thin_wall_n', 'thin_wall_e', 'thin_wall_s', 'thin_wall_w', 'thin_wall_se', 'thin_wall_ne',
  'thin_wall_nw', 'thin_wall_sw', 'thin_wall_ns', 'thin_wall_ew', 'thin_wall_nes', 'thin_wall_new',
  'thin_wall_nsw', 'thin_wall_esw', 'thin_wall_nesw',
  'swivel_door_ne', 'swivel_door_se', 'swivel_door_sw', 'swivel_door_nw', 'transmogrifier',
  'turn_plate_cw', 'turn_plate_ccw', 'button_green', 'button_blue', 'button_brown', 'button_red',
  'block_target', 'button_orange', 'button_gray', 'flame_jet_off', 'flame_jet_on', 'toggle_wall_closed',
  'toggle_wall_open', 'teleport', 'teleport_red', 'teleport_blue', 'teleport_yellow', 'teleport_green',
  'trap', 'clone_machine', 'laser_emitter_n', 'laser_emitter_e', 'laser_emitter_s', 'laser_emitter_w',
  'laser_receiver_red', 'laser_receiver_blue', 'laser_gate_red_closed', 'laser_gate_red_open',
  'laser_gate_blue_closed', 'laser_gate_blue_open', 'pressure_plate_red', 'pressure_plate_green',
  'pressure_plate_blue', 'pressure_plate_yellow', 'hold_door_red_closed', 'hold_door_red_open',
  'hold_door_green_closed', 'hold_door_green_open', 'hold_door_blue_closed', 'hold_door_blue_open',
  'hold_door_yellow_closed', 'hold_door_yellow_open', 'toggle_wall_red_closed', 'toggle_wall_red_open',
  'toggle_wall_blue_closed', 'toggle_wall_blue_open', 'toggle_wall_yellow_closed',
  'toggle_wall_yellow_open', 'toggle_button_red', 'toggle_button_blue', 'toggle_button_yellow',
  'floating_block_red', 'floating_block_green', 'floating_block_blue', 'floating_block_yellow',
  'puppet_control', 'shot_launcher_n', 'shot_launcher_e', 'shot_launcher_s', 'shot_launcher_w',
  'shot_trigger',
  'signal_plate', 'signal_gate_and', 'signal_gate_or', 'signal_gate_not', 'signal_gate_xor',
  'signal_latch_off', 'signal_latch_on',
  'turtle', 'slime', 'ice', 'ice_nw', 'ice_ne', 'ice_sw', 'ice_se', 'force_n', 'force_e',
  'force_s', 'force_w', 'force_random', 'thief', 'thief_keys',
  'forbid_key_red', 'forbid_key_blue', 'forbid_key_yellow', 'forbid_key_green', 'forbid_boots_ice',
  'forbid_boots_water', 'forbid_boots_fire', 'forbid_boots_force', 'door_red', 'door_blue', 'door_yellow',
  'door_green', 'key_red', 'key_blue', 'key_yellow', 'key_green',
  'chip', 'boots_water', 'boots_fire', 'boots_ice', 'boots_force', 'slow_time', 'boots_speed', 'boots_eye',
  'bomb', 'score_10', 'score_100', 'score_1000', 'score_2x', 'stopwatch_bonus', 'stopwatch_penalty'
];

/** Epoxy entity ids (monsters.json) that keep the shared drawing for now. */
const RUNEWARD_FALLBACK_ENTITY_IDS: readonly string[] = [
  'dirt_block', 'arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee',
  'ice_block', 'mirror_slash', 'mirror_backslash', 'one_sided_mirror_ne', 'one_sided_mirror_nw',
  'one_sided_mirror_se', 'one_sided_mirror_sw', 'turret_fixed', 'turret_cw', 'turret_ccw', 'turret_multi',
  'bug', 'paramecium', 'pink_ball', 'walker', 'teeth', 'glider', 'fireball', 'tank', 'blob',
  'color_block_red', 'color_block_green', 'color_block_blue', 'color_block_yellow', 'puppet', 'skitter'
];

/** Every Epoxy tile, item and entity id that keeps the shared drawing for now. */
export const RUNEWARD_FALLBACK: ReadonlySet<string> = new Set([
  ...RUNEWARD_FALLBACK_TILE_IDS,
  ...RUNEWARD_FALLBACK_ENTITY_IDS
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
