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

import type { BeamCell, Direction } from '../types';
import { BOT_BEAM_LENGTH } from './cc3dConstants';
import { terrainAdmits } from './cc3dTerrainRules';
import {
  Cell,
  MobState,
  RuleContext,
  World,
  actingTerrain,
  cellAt,
  isBlockKind,
  isPlayerAt,
  mobAt,
  neighbour,
  opposite,
  removeMob,
  spawnShot,
  turnClockwise
} from './cc3dWorld';
import type { Cc3dCell, Cc3dMobKind } from './model';

/**
 * CC3D's own lasers (08-p3-decisions, section 8.5 wins): the controller, the
 * shooters, the shot, the reflectors and the security bots. Nothing here is
 * shared with Epoxy's continuous lasers. Every rule is [U] unless noted; each
 * lives in one named function so play observation can correct it.
 */

// ------------------------------------------------------------ reflectors

/**
 * The two faces of each reflector that reflect, by stored name [D, reading Z,
 * 08 section 8.5 item 1]. The stored letters read as if up and down were swapped.
 */
export const REFLECTING_FACES: Readonly<Record<string, readonly [Direction, Direction]>> = {
  LU: ['W', 'S'],
  DL: ['N', 'W'],
  UR: ['S', 'E'],
  RD: ['E', 'N']
};

/**
 * The direction a shot leaves a reflector in, or null when it enters through a
 * non-reflecting face and vanishes [U]. A shot travelling `travel` enters through
 * the face on the side opposite to it, and leaves through the other reflecting face.
 */
export function reflectedDirection(mirror: string | undefined, travel: Direction): Direction | null {
  const faces = REFLECTING_FACES[(mirror ?? '').toUpperCase()];
  if (!faces) return null;
  const entry = opposite(travel);
  if (faces[0] === entry) return faces[1];
  if (faces[1] === entry) return faces[0];
  return null;
}

// ---------------------------------------------------------------- panels

/** Panels stop shots and beams on the side they cross, leaving or entering, as for moves [8.5 item 4]. */
function panelsAllow(from: Cc3dCell, to: Cc3dCell, dir: Direction): boolean {
  return !from.panels.includes(dir) && !to.panels.includes(opposite(dir));
}

// ------------------------------------------------------------------ shot

/** Terrain that stops a shot: walls and every closed blocker [8.1]. Everything else is passed over with no effect [8.5 item 6]. */
function stopsShot(cell: Cc3dCell): boolean {
  const terrain = actingTerrain(cell);
  switch (terrain.kind) {
    case 'wall':
    case 'appearing_wall':
    case 'false_wall':
    case 'door':
    case 'socket':
    case 'socket_red':
      return true;
    case 'toggle_door':
    case 'hold_door':
      return terrain.open !== true;
    default:
      return false;
  }
}

function isMonster(kind: Cc3dMobKind): boolean {
  return !isBlockKind(kind) && kind !== 'laser_shooter' && kind !== 'shot';
}

/** A monster or the player hit by a shot or a beam dies in the same way. */
export function killMob(ctx: RuleContext, mob: MobState): void {
  removeMob(ctx.world, mob);
  ctx.emitVisual('explosion', mob.x, mob.y);
}

/** What the entry rule says about the next step of a shot. */
export type ShotStep = { vanish: true } | { vanish: false; to: Cell; turn: Direction | null };

/**
 * Applies the entry rule of the cell in front of a shot (08 section 8.5): panels
 * and blockers stop it; the player and monsters die; an ice block is removed; a
 * shooter fires in its own facing (relay); a reflector turns it or stops it;
 * any other block stops it. The effects happen here; the caller moves the shot.
 */
export function resolveShotStep(ctx: RuleContext, shot: MobState): ShotStep {
  const { world } = ctx;
  const stop: ShotStep = { vanish: true };
  const to = neighbour(shot, shot.dir);
  const fromCell = cellAt(world, shot.x, shot.y);
  const toCell = cellAt(world, to.x, to.y);
  if (!fromCell || !toCell || !panelsAllow(fromCell, toCell, shot.dir) || stopsShot(toCell)) return stop;
  if (isPlayerAt(world, to)) {
    ctx.killPlayer('laser');
    return stop;
  }
  const occupant = mobAt(world, to);
  if (!occupant) return { vanish: false, to, turn: null };
  if (occupant.kind === 'reflector') {
    const turn = reflectedDirection(occupant.mirror, shot.dir);
    return turn === null ? stop : { vanish: false, to, turn };
  }
  if (occupant.kind === 'laser_shooter') {
    // Relay [U, 08 section 8.5 item 3], but never through a shooter this shot already passed (8.6): loops end.
    if (!shot.relayed?.includes(occupant.uid)) fireShooter(ctx, occupant, shot.relayed ?? []);
  } else if (occupant.kind === 'block_ice') {
    removeMob(world, occupant);
    ctx.emitVisual('splash', to.x, to.y);
  } else if (isMonster(occupant.kind)) {
    killMob(ctx, occupant);
  }
  // Any other block, a security bot included, stops the shot and is unharmed [U, 08 section 8.6].
  return stop;
}

/**
 * The shooter fires one shot in its facing, at most once per tick; the first cell in front follows the
 * same entry rule [8.5 item 5]. `through` lists the shooters the shot came through (relays).
 */
export function fireShooter(ctx: RuleContext, shooter: MobState, through: number[] = []): void {
  const { world } = ctx;
  if (world.firedThisTick.includes(shooter.uid)) return;
  world.firedThisTick.push(shooter.uid);
  ctx.stepShot(spawnShot(world, shooter, shooter.dir, [...through, shooter.uid]));
}

/** The shooter nearest to a cell (Manhattan distance, ties in reading order) fires [U, 8.5 item 3]. */
export function fireNearestShooter(ctx: RuleContext, from: Cell): void {
  let best: MobState | null = null;
  let bestKey = Number.POSITIVE_INFINITY;
  for (const mob of ctx.world.mobs) {
    if (mob.kind !== 'laser_shooter') continue;
    const distance = Math.abs(mob.x - from.x) + Math.abs(mob.y - from.y);
    // Reading order breaks ties: a row-major index fits below the grid size.
    const key = distance * ctx.world.cells.length + mob.y * ctx.world.width + mob.x;
    if (key < bestKey) {
      best = mob;
      bestKey = key;
    }
  }
  if (best) fireShooter(ctx, best);
}

/** The shooter standing on a cell, if any: bumping it counts as pressing a controller under it [U, 8.5 item 2]. */
export function bumpShooter(ctx: RuleContext, shooter: MobState): void {
  const cell = cellAt(ctx.world, shooter.x, shooter.y);
  if (cell?.terrain.some((t) => t.kind === 'laser_controller')) fireNearestShooter(ctx, shooter);
}

/** A shot that finished its step takes the direction a reflector gave it. */
export function onShotArrival(shot: MobState): void {
  if (shot.drift) shot.dir = shot.drift;
  shot.drift = null;
  shot.carried = false;
}

// ------------------------------------------------------------------ bots

const BOT_KINDS: readonly Cc3dMobKind[] = ['bot_static', 'bot_cw', 'bot_ccw', 'bot_multi'];
const ALL_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];

function isBot(kind: Cc3dMobKind): boolean {
  return BOT_KINDS.includes(kind);
}

/** The rotating bots turn a quarter turn every period: clockwise for 73, counter-clockwise for 190 [U timing]. */
export function rotateBots(world: World, periodTicks: number): void {
  if (world.tick === 0 || world.tick % periodTicks !== 0) return;
  for (const mob of world.mobs) {
    if (mob.kind === 'bot_cw') mob.dir = turnClockwise(mob.dir, 1);
    else if (mob.kind === 'bot_ccw') mob.dir = turnClockwise(mob.dir, -1);
  }
}

function beamDirections(bot: MobState): readonly Direction[] {
  return bot.kind === 'bot_multi' ? ALL_DIRECTIONS : [bot.dir];
}

/** A dirt block stands in for "a block": the beam stops at a cell it could not enter [U, 8.5 item 8]. */
const BLOCK_PROBE = { kind: 'block_dirt' } as MobState;

/**
 * One beam: from the cell next to the bot, up to BOT_BEAM_LENGTH cells. It stops
 * at a panel, at a cell a block could not enter, at a block, bot or shooter (that
 * cell is not covered) and after the first cell holding the player or a monster
 * (that cell is covered and its occupant dies).
 */
function castBeam(world: World, bot: MobState, dir: Direction, covered: Map<number, BeamCell>, victims: Array<MobState | 'player'>): void {
  let at: Cell = { x: bot.x, y: bot.y };
  for (let length = 0; length < BOT_BEAM_LENGTH; length++) {
    const to = neighbour(at, dir);
    const fromCell = cellAt(world, at.x, at.y);
    const toCell = cellAt(world, to.x, to.y);
    if (!fromCell || !toCell || !panelsAllow(fromCell, toCell, dir) || !terrainAdmits(world, BLOCK_PROBE, toCell)) return;
    const occupant = mobAt(world, to);
    const player = isPlayerAt(world, to);
    // The player is tested first: one standing on a floating colour block is covered too [08 section 8.6].
    if (occupant && !player && !isMonster(occupant.kind)) return;
    const key = to.y * world.width + to.x;
    const horizontal = dir === 'E' || dir === 'W';
    const known = covered.get(key);
    covered.set(key, {
      x: to.x,
      y: to.y,
      horizontal: horizontal || (known?.horizontal ?? false),
      vertical: !horizontal || (known?.vertical ?? false)
    });
    if (player) {
      victims.push('player');
      return;
    }
    if (occupant) {
      victims.push(occupant);
      return;
    }
    at = to;
  }
}

/**
 * Recomputes the beams of every bot (every tick) and, when `apply` is set, kills
 * the player and the monsters they cover. Without `apply` it only refreshes the
 * cells to draw (start of a level, after an undo).
 */
export function updateBeams(ctx: RuleContext, apply: boolean): void {
  const { world } = ctx;
  const covered = new Map<number, BeamCell>();
  const victims: Array<MobState | 'player'> = [];
  for (const mob of world.mobs) {
    if (!isBot(mob.kind)) continue;
    for (const dir of beamDirections(mob)) castBeam(world, mob, dir, covered, victims);
  }
  world.beam = [...covered.values()];
  if (!apply) return;
  // A monster covered by two beams dies once.
  for (const victim of new Set(victims)) {
    if (victim === 'player') ctx.killPlayer('laser');
    else killMob(ctx, victim);
  }
}
