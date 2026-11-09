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

import { playerRailActor } from './epoxyRailsCc2';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { AudioManager } from '../../audio/AudioManager';
import { turnClockwise } from '../lynx/directions';
import { Direction, GridPoint, RuntimeEntity, TeleportExitOrder, TileDefinition } from '../types';
import { isCanBlockEnter, moveBlockTo } from './epoxyBlocks';
import { canMonsterEnter } from './epoxyMonsters';
import {
  DEFAULT_TELEPORT_GROUP,
  EpoxyContext,
  EpoxyWorld,
  canPlayerEnter,
  getEntityAt,
  isEdgeBlocked,
  isInBounds,
  playerAtCell
} from './epoxyWorld';

/**
 * The pads of a group that the terrain holds now and that are live teleporters, in reading order (row by row, left to
 * right): the portable pads a player set down, or the lit relay pads. A pad can be set down, lit or darkened at any
 * time, so the list is read live instead of from the lookups built at load. A dark relay pad is plain floor and never
 * listed.
 */
function livePadsOf(w: EpoxyWorld, group: string, isPad: (tile: TileDefinition) => boolean): GridPoint[] {
  const pads: GridPoint[] = [];
  for (let y = 0; y < w.terrain.length; y++) {
    for (let x = 0; x < w.terrain[y].length; x++) {
      const tile = ConfigRegistry.getTile(w.terrain[y][x]);
      if (tile.isTeleporter === true && isPad(tile) && (tile.teleportGroup ?? DEFAULT_TELEPORT_GROUP) === group) pads.push({ x, y });
    }
  }
  return pads;
}

/** Quarter turns clockwise from the way a mover was facing, in the order each named exit order tries them. */
const EXIT_TURNS: Readonly<Record<TeleportExitOrder, readonly number[]>> = {
  forward_only: [0],
  forward_right_left_back: [0, 1, 3, 2],
  // Chip's Challenge 2 orders: forward, right, back, left (the green pad turns from the drawn side, the red pad from the
  // facing of the mover).
  random: [0, 1, 2, 3],
  cc2_red: [0, 1, 2, 3]
};

/** A pad a jump may land on, with the sides tried there in order. */
interface PadAttempt {
  pad: GridPoint;
  dirs: Direction[];
}

/** Whether a pad names one of the Chip's Challenge 2 orders, which choose their own pad (see `cc2PadPlan`). */
function isCc2Order(origin: TileDefinition): boolean {
  return origin.teleportExitOrder === 'random' || origin.teleportExitOrder === 'cc2_red';
}

/**
 * The pads a Chip's Challenge 2 teleporter tries, in order, as Lexy's Labyrinth searches them: the ring of its group read
 * forward from the pad after the one entered, the entered pad last (it is only left forward). A lone pad leaves forward
 * and draws nothing. The green ('random') pad draws one pad among the others and then one side (both from the level
 * generator, and only now that the pad is used), and tries that side, then right, back and left; the red pad tries every
 * pad forward, right, back, left of the facing of the mover.
 */
function cc2PadPlan(w: EpoxyWorld, origin: TileDefinition, teleporters: readonly GridPoint[], startIdx: number, facing: Direction): PadAttempt[] {
  const self = teleporters[startIdx];
  const others = teleporters.map((_, i) => teleporters[(startIdx + 1 + i) % teleporters.length]).slice(0, -1);
  const plan: PadAttempt[] = [];
  if (origin.teleportExitOrder === 'random' && others.length > 0) {
    const first = w.rng.nextInt(0, others.length - 1);
    const drawn = ORDERED_DIRECTIONS[w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)];
    const dirs = namedExitDirections(origin, drawn) ?? [drawn];
    for (let i = 0; i < others.length; i++) plan.push({ pad: others[(first + i) % others.length], dirs });
  } else if (origin.teleportExitOrder === 'cc2_red') {
    const dirs = namedExitDirections(origin, facing) ?? [facing];
    for (const pad of others) plan.push({ pad, dirs });
  }
  plan.push({ pad: self, dirs: [facing] });
  return plan;
}

/**
 * The sides a mover may leave by, in order, when the teleporter it entered names an exit order, or null for a native
 * teleporter (which keeps the order of the caller).
 */
function namedExitDirections(origin: TileDefinition, facing: Direction): Direction[] | null {
  if (origin.teleportExitOrder === undefined) return null;
  return EXIT_TURNS[origin.teleportExitOrder].map((turns) => turnClockwise(facing, turns));
}

/**
 * How many teleporters a jump from a pad tries, the previous one in reading order first. A native pad ends its round on
 * itself (a lone way out through its own exits); a pad that names an exit order never lands on the pad it entered.
 */
function candidateCountOf(origin: TileDefinition, linked: number): number {
  return origin.teleportExitOrder === undefined ? linked : linked - 1;
}

/**
 * Whether a pad that names an exit order refuses the jump: a mover never lands on a pad another block or monster
 * stands on, nor (for a block or monster) on the pad the player stands on. A native pad leaves this to its exit cell.
 */
function padRefusesLanding(w: EpoxyWorld, origin: TileDefinition, pad: GridPoint, moverIsPlayer: boolean): boolean {
  if (origin.teleportExitOrder === undefined) return false;
  if (getEntityAt(w, pad.x, pad.y)) return true;
  return !moverIsPlayer && playerAtCell(w, pad.x, pad.y) !== undefined;
}

/** The pads of a native or CC3D teleporter, the previous one in reading order first, each with the same sides. */
function nativePadPlan(
  teleporters: readonly GridPoint[],
  startIdx: number,
  origin: TileDefinition,
  dirs: Direction[]
): PadAttempt[] {
  const plan: PadAttempt[] = [];
  const candidateCount = candidateCountOf(origin, teleporters.length);
  for (let i = 1; i <= candidateCount; i++) {
    plan.push({ pad: teleporters[(startIdx - i + teleporters.length) % teleporters.length], dirs });
  }
  return plan;
}

/** Teleporters that a jump from the teleporter at (x, y) may land on, itself included. */
function teleportersLinkedTo(w: EpoxyWorld, x: number, y: number): GridPoint[] {
  const origin = ConfigRegistry.getTile(w.terrain[y][x]);
  const group = origin.teleportGroup ?? DEFAULT_TELEPORT_GROUP;
  if (origin.portableTeleporter === true) return livePadsOf(w, group, (tile) => tile.portableTeleporter === true);
  if (origin.relayPad !== undefined) return livePadsOf(w, group, (tile) => tile.relayPad !== undefined);
  const linked = w.teleportersByGroup.get(group) ?? [];
  // A teleporter hidden under a removable top is listed too; it takes part once the top is gone.
  return w.underlays === null
    ? linked
    : linked.filter((cell) => {
        const tile = ConfigRegistry.getTile(w.terrain[cell.y][cell.x]);
        return tile.isTeleporter === true && (tile.teleportGroup ?? DEFAULT_TELEPORT_GROUP) === group;
      });
}

/**
 * Moves the player out of the next free teleporter of the same group.
 * Returns false when no exit exists.
 */
export function teleportPlayer(w: EpoxyWorld, fromX: number, fromY: number, dir: Direction): boolean {
  const teleporters = teleportersLinkedTo(w, fromX, fromY);
  const startIdx = teleporters.findIndex((t) => t.x === fromX && t.y === fromY);
  if (startIdx < 0) return false;

  const origin = ConfigRegistry.getTile(w.terrain[fromY][fromX]);
  if (teleporters.length <= 1 && !isCc2Order(origin)) return false;
  const candidateDirs: Direction[] = namedExitDirections(origin, dir) ?? [
    dir,
    ...ORDERED_DIRECTIONS.filter((d) => d !== dir)
  ];

  for (const { pad: candidate, dirs: tryDirs } of isCc2Order(origin)
    ? cc2PadPlan(w, origin, teleporters, startIdx, dir)
    : nativePadPlan(teleporters, startIdx, origin, candidateDirs)) {
    if (!(candidate.x === fromX && candidate.y === fromY) && padRefusesLanding(w, origin, candidate, true)) continue;
    for (const tryDir of tryDirs) {
      const vec = DIRECTION_VECTORS[tryDir];
      const exitX = candidate.x + vec.dx;
      const exitY = candidate.y + vec.dy;
      if (isInBounds(w, exitX, exitY)) {
        const exitTile = ConfigRegistry.getTile(w.terrain[exitY][exitX]);
        if (
          canPlayerEnter(w, exitTile, w.items[exitY][exitX]) &&
          !getEntityAt(w, exitX, exitY) &&
          // Only another player bars the exit: the teleporting one stands on the source cell, which may be an exit cell too.
          [undefined, w.player].includes(playerAtCell(w, exitX, exitY)) &&
          !isEdgeBlocked(w, candidate.x, candidate.y, exitX, exitY, tryDir, false, playerRailActor(w))
        ) {
          AudioManager.playSfx('teleport');
          w.player.x = exitX;
          w.player.y = exitY;
          w.player.dir = tryDir;
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Moves a block or monster out of the next teleporter of the same group
 * whose exit it could step onto from there, then resolves the arrival on
 * the exit cell. Returns false when no exit exists and the entity stays.
 */
export function teleportEntity(
  ctx: EpoxyContext,
  entity: RuntimeEntity,
  fromX: number,
  fromY: number,
  dir: Direction
): boolean {
  const w = ctx.world;
  const teleporters = teleportersLinkedTo(w, fromX, fromY);
  const startIdx = teleporters.findIndex((t) => t.x === fromX && t.y === fromY);
  if (startIdx < 0) return false;

  const origin = ConfigRegistry.getTile(w.terrain[fromY][fromX]);
  if (teleporters.length <= 1 && !isCc2Order(origin)) return false;
  const exitDirs = namedExitDirections(origin, dir) ?? [dir];
  for (const { pad: candidate, dirs: tryDirs } of isCc2Order(origin)
    ? cc2PadPlan(w, origin, teleporters, startIdx, dir)
    : nativePadPlan(teleporters, startIdx, origin, exitDirs)) {
    if (!(candidate.x === fromX && candidate.y === fromY) && padRefusesLanding(w, origin, candidate, false)) continue;
    for (const exitDir of tryDirs) {
      const vec = DIRECTION_VECTORS[exitDir];
      const exitX = candidate.x + vec.dx;
      const exitY = candidate.y + vec.dy;
      // An exit named by an order is skipped when the live player stands there (CC3D: the step would hit him).
      if (origin.teleportExitOrder !== undefined && playerAtCell(w, exitX, exitY) !== undefined) continue;
      // Same entry rules as a regular step, evaluated as if the entity stood on the candidate pad.
      const probe: RuntimeEntity = { ...entity, x: candidate.x, y: candidate.y, dir: exitDir };
      const canExit =
        entity.kind === 'block'
          ? isCanBlockEnter(w, probe, exitX, exitY, exitDir)
          : canMonsterEnter(w, probe, exitDir);
      if (!canExit) continue;

      entity.x = exitX;
      entity.y = exitY;
      entity.dir = exitDir;
      if (entity.kind === 'block') {
        // Already standing on the exit cell: resolves the arrival without another jump.
        moveBlockTo(ctx, entity, exitX, exitY, exitDir, false);
      }
      return true;
    }
  }
  return false;
}
