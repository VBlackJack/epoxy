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
import { Direction, GridPoint, RuntimeEntity, TileDefinition } from '../types';
import { isCanBlockEnter, moveBlockTo } from './epoxyBlocks';
import { canMonsterEnter } from './epoxyMonsters';
import {
  DEFAULT_TELEPORT_GROUP,
  EpoxyContext,
  EpoxyWorld,
  canPlayerEnter,
  getEntityAt,
  isEdgeBlocked,
  isInBounds
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
  if (teleporters.length <= 1) return false;

  const startIdx = teleporters.findIndex((t) => t.x === fromX && t.y === fromY);
  if (startIdx < 0) return false;

  const candidateDirs: Direction[] = [
    dir,
    ...ORDERED_DIRECTIONS.filter((d) => d !== dir)
  ];

  for (let i = 1; i <= teleporters.length; i++) {
    const idx = (startIdx - i + teleporters.length) % teleporters.length;
    const candidate = teleporters[idx];
    for (const tryDir of candidateDirs) {
      const vec = DIRECTION_VECTORS[tryDir];
      const exitX = candidate.x + vec.dx;
      const exitY = candidate.y + vec.dy;
      if (isInBounds(w, exitX, exitY)) {
        const exitTile = ConfigRegistry.getTile(w.terrain[exitY][exitX]);
        if (
          canPlayerEnter(w, exitTile) &&
          !getEntityAt(w, exitX, exitY) &&
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
  if (teleporters.length <= 1) return false;

  const startIdx = teleporters.findIndex((t) => t.x === fromX && t.y === fromY);
  if (startIdx < 0) return false;

  const vec = DIRECTION_VECTORS[dir];
  for (let i = 1; i <= teleporters.length; i++) {
    const idx = (startIdx - i + teleporters.length) % teleporters.length;
    const candidate = teleporters[idx];
    const exitX = candidate.x + vec.dx;
    const exitY = candidate.y + vec.dy;
    // Same entry rules as a regular step, evaluated as if the entity stood on the candidate pad.
    const probe: RuntimeEntity = { ...entity, x: candidate.x, y: candidate.y, dir };
    const canExit =
      entity.kind === 'block'
        ? isCanBlockEnter(w, probe, exitX, exitY, dir)
        : canMonsterEnter(w, probe, dir);
    if (!canExit) continue;

    entity.x = exitX;
    entity.y = exitY;
    entity.dir = dir;
    if (entity.kind === 'block') {
      // Already standing on the exit cell: resolves the arrival without another jump.
      moveBlockTo(ctx, entity, exitX, exitY, dir, false);
    }
    return true;
  }
  return false;
}
