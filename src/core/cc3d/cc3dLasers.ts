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
  isMonsterKind,
  isPlayerAt,
  meltIceBlock,
  mobAt,
  neighbour,
  opposite,
  removeMob,
  removeTop,
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

/**
 * Terrain that stops a shot [S, 10 item 12]: walls and every closed blocker, the clone machines, and the cells
 * holding a F.I.S.H., a key or an orb. Everything else is passed over with no effect: plates, switches, water,
 * fire, slime, ice (no turn), force floors, dirt (kept), gravel, sand, the security gates, teleports (no transport).
 */
function stopsShot(cell: Cc3dCell): boolean {
  if (cell.item !== null) return true;
  const terrain = actingTerrain(cell);
  switch (terrain.kind) {
    case 'wall':
    case 'appearing_wall':
    case 'false_wall':
    case 'door':
    case 'socket':
    case 'socket_red':
    case 'clone_machine':
      return true;
    case 'toggle_door':
    case 'hold_door':
      return terrain.open !== true;
    default:
      return false;
  }
}

const BOTS: readonly Cc3dMobKind[] = ['bot_static', 'bot_cw', 'bot_ccw', 'bot_multi'];

/** A monster or the player hit by a shot or a beam dies in the same way. */
export function killMob(ctx: RuleContext, mob: MobState): void {
  removeMob(ctx.world, mob);
  ctx.emitVisual('explosion', mob.x, mob.y);
}

/** What the entry rule says about the next step of a shot. */
export type ShotStep = { vanish: true } | { vanish: false; to: Cell; turn: Direction | null };

/**
 * Applies the entry rule of the cell in front of a shot (10.1 item 12, replacing 8.5 and 8.6): panels and
 * blockers stop it; the player, monsters, golems and bots die; an ice block melts into water; a bomb is set
 * off (both gone); a shooter stops it (no relay); a reflector turns it, and its back is destroyed with the
 * shot; any other block stops it. The effects happen here; the caller moves the shot.
 */
export function resolveShotStep(ctx: RuleContext, shot: MobState): ShotStep {
  const { world } = ctx;
  const stop: ShotStep = { vanish: true };
  const to = neighbour(shot, shot.dir);
  const fromCell = cellAt(world, shot.x, shot.y);
  const toCell = cellAt(world, to.x, to.y);
  if (!fromCell || !toCell || !panelsAllow(fromCell, toCell, shot.dir)) return stop;
  // The player in the cell is hit whatever the cell holds (a closing door, an item he has not picked up yet).
  if (isPlayerAt(world, to)) {
    ctx.killPlayer('laser');
    return stop;
  }
  if (stopsShot(toCell)) return stop;
  if (actingTerrain(toCell).kind === 'bomb') {
    removeTop(world, to);
    ctx.emitVisual('explosion', to.x, to.y);
    return stop;
  }
  const occupant = mobAt(world, to);
  if (!occupant) return { vanish: false, to, turn: null };
  if (occupant.kind === 'reflector') {
    const turn = reflectedDirection(occupant.mirror, shot.dir);
    if (turn !== null) return { vanish: false, to, turn };
    // Hitting the back of a reflector destroys both [S, 10.1 item 12].
    killMob(ctx, occupant);
    return stop;
  }
  if (occupant.kind === 'block_ice') {
    meltIceBlock(world, occupant);
    ctx.emitVisual('splash', to.x, to.y);
  } else if (BOTS.includes(occupant.kind) || isMonsterKind(occupant.kind)) {
    killMob(ctx, occupant);
  }
  // A shooter and any other block stop the shot and are unharmed.
  return stop;
}

/** The shooter fires one shot in its facing, at most once per tick; the first cell in front follows the same entry rule. */
export function fireShooter(ctx: RuleContext, shooter: MobState): void {
  const { world } = ctx;
  if (world.firedThisTick.includes(shooter.uid)) return;
  world.firedThisTick.push(shooter.uid);
  ctx.stepShot(spawnShot(world, shooter, shooter.dir));
}

/** The shooter nearest to a cell by straight-line distance (ties in reading order) fires one shot [S, 10 item 11]. */
export function fireNearestShooter(ctx: RuleContext, from: Cell): void {
  let best: MobState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const mob of ctx.world.mobs) {
    if (mob.kind !== 'laser_shooter') continue;
    const distance = (mob.x - from.x) ** 2 + (mob.y - from.y) ** 2;
    // Strictly smaller: the first in reading order keeps a tie only if the list is in reading order, so compare it too.
    const earlier = best !== null && distance === bestDistance && mob.y * ctx.world.width + mob.x < best.y * ctx.world.width + best.x;
    if (distance < bestDistance || earlier) {
      best = mob;
      bestDistance = distance;
    }
  }
  if (best) fireShooter(ctx, best);
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

/** The rotating bots (73 clockwise, 190 counter-clockwise) turn a quarter turn. */
function turnRotatingBots(world: World): void {
  for (const mob of world.mobs) {
    if (mob.kind === 'bot_cw') mob.dir = turnClockwise(mob.dir, 1);
    else if (mob.kind === 'bot_ccw') mob.dir = turnClockwise(mob.dir, -1);
  }
}

/** At the start of play (the player's first step) the rotating bots turn once [S, 10.1 item 13]. */
export function startBots(world: World): void {
  turnRotatingBots(world);
}

/** Then they turn every period (three seconds) from the start of play [U timing]; the speed orb does not change it. */
export function rotateBots(world: World, periodTicks: number): void {
  if (world.playStart < 0) return;
  const elapsed = world.tick - world.playStart;
  if (elapsed > 0 && elapsed % periodTicks === 0) turnRotatingBots(world);
}

function beamDirections(bot: MobState): readonly Direction[] {
  return bot.kind === 'bot_multi' ? ALL_DIRECTIONS : [bot.dir];
}

/**
 * A dirt block stands in for "a block": the beam stops, uncovered, at a cell a block could not enter [U, 8.5 item 8]:
 * items, security gates, the exit, fire, clone machines, walls and closed doors.
 */
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
    if (occupant && !player && !isMonsterKind(occupant.kind)) return;
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
  // Bots are always on, but only once play has started [P, 10.1 items 0 and 13].
  if (world.playStart < 0) {
    world.beam = [];
    return;
  }
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
