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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { OPPOSITE_DIRECTION } from '../core/coreConstants';
import { CompiledLevel, Direction, GridPoint, TileDefinition } from '../core/types';
import { isPlayerWalkable } from '../core/Walkability';
import { Box } from './LevelAssembler';

/**
 * Whether force floors are one-way in this level: nothing in it lets the
 * player walk against them. Loop wings return through such a strip; where
 * the boots that defeat it exist, a force floor is just another hazard.
 */
function forceFloorsAreOneWay(level: CompiledLevel): boolean {
  const defeatedBy = ConfigRegistry.getGame().procedural?.hub.returnGate.item;
  return defeatedBy !== undefined && !level.items.some((row) => row.includes(defeatedBy));
}

/**
 * Whether `target` stays reachable from the start, doors, sockets and
 * hazards counted as open, once every cell of `walled` is filled in. Force
 * floors are walked only in their direction when the level holds no boots
 * that defeat them.
 */
export function cellReachableWithout(level: CompiledLevel, walled: Box, target: GridPoint): boolean {
  const height = level.terrain.length;
  const width = level.terrain[0].length;
  const open = (p: GridPoint): boolean => {
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return false;
    if (p.x >= walled.x0 && p.x <= walled.x1 && p.y >= walled.y0 && p.y <= walled.y1) return false;
    return isPlayerWalkable(ConfigRegistry.getTile(level.terrain[p.y][p.x]));
  };
  const oneWay = forceFloorsAreOneWay(level);
  const forceAt = (p: GridPoint): Direction | null => {
    const tile = ConfigRegistry.getTile(level.terrain[p.y][p.x]);
    return oneWay && tile.slideType === 'force' && tile.forceDirection && tile.forceDirection !== 'RANDOM'
      ? tile.forceDirection
      : null;
  };
  const teleporters: GridPoint[] = [];
  level.terrain.forEach((row, y) =>
    row.forEach((id, x) => {
      if (ConfigRegistry.getTile(id).isTeleporter && open({ x, y })) teleporters.push({ x, y });
    })
  );
  const seen = new Set<number>([level.playerStart.y * width + level.playerStart.x]);
  const queue: GridPoint[] = [level.playerStart];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    if (cell.x === target.x && cell.y === target.y) return true;
    const leaving = forceAt(cell);
    const next = ORDERED_DIRECTIONS.filter((d) => {
      if (leaving && d === OPPOSITE_DIRECTION[leaving]) return false;
      const to = { x: cell.x + DIRECTION_VECTORS[d].dx, y: cell.y + DIRECTION_VECTORS[d].dy };
      const entering = open(to) ? forceAt(to) : null;
      return !(entering && d === OPPOSITE_DIRECTION[entering]);
    }).map((d) => ({
      x: cell.x + DIRECTION_VECTORS[d].dx,
      y: cell.y + DIRECTION_VECTORS[d].dy
    }));
    if (ConfigRegistry.getTile(level.terrain[cell.y][cell.x]).isTeleporter) next.push(...teleporters);
    for (const n of next) {
      const k = n.y * width + n.x;
      if (!seen.has(k) && open(n)) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return false;
}

/** Teleporters outside any group form one network, as in the engine. */
const DEFAULT_TELEPORT_GROUP = '';

/** Hazards that end the game on contact, the ones boots keep the player alive across. */
const DEADLY_HAZARDS: ReadonlySet<string> = new Set(['water', 'fire']);

/** Whether the level can ever hold a pushable block: placed, or cloned from a template. */
function levelHasBlocks(level: CompiledLevel): boolean {
  const isBlock = (type: string): boolean => ConfigRegistry.getEntityDef(type)?.kind === 'block';
  return level.entities.some((e) => isBlock(e.type)) || level.cloneLinks.some((l) => isBlock(l.templateType));
}

/**
 * Whether an exit stays reachable from the start with `itemId` out of the
 * player's reach: every tile is open except solid ones, the doors that item
 * unlocks, and the water or fire that only those boots cross. Teleporters
 * join the others of their group. Sockets open only once enough chips lie in
 * the reachable area. This over-approximates what the player can do
 * (monsters, ice and force floors are ignored, a block may fill water, a
 * flame jet may switch off), so `false` is a proof that the item is needed,
 * while `true` proves nothing.
 */
export function exitReachableWithout(level: CompiledLevel, itemId: string): boolean {
  const beforeSockets = floodWithout(level, itemId, false);
  if (beforeSockets.exit) return true;
  if (beforeSockets.chips < level.chipsRequired) return false;
  return floodWithout(level, itemId, true).exit;
}

function floodWithout(level: CompiledLevel, itemId: string, socketsOpen: boolean): { exit: boolean; chips: number } {
  const height = level.terrain.length;
  const width = level.terrain[0].length;
  const blocks = levelHasBlocks(level);
  const closedByItem = (tile: TileDefinition): boolean => {
    if (tile.requiredKey === itemId) return true;
    if (!tile.hazard || !DEADLY_HAZARDS.has(tile.hazard) || tile.protectedByItem !== itemId) return false;
    return !tile.flameTogglesTo && !(blocks && tile.blockTransformsTo);
  };
  const open = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const tile = ConfigRegistry.getTile(level.terrain[y][x]);
    if (tile.requiresAllChips) return socketsOpen;
    if (!isPlayerWalkable(tile) && !tile.revealsToOnTouch) return false;
    return !closedByItem(tile);
  };

  const teleportersByGroup = new Map<string, GridPoint[]>();
  level.terrain.forEach((row, y) =>
    row.forEach((id, x) => {
      const tile = ConfigRegistry.getTile(id);
      if (!tile.isTeleporter || !open(x, y)) return;
      const group = tile.teleportGroup ?? DEFAULT_TELEPORT_GROUP;
      teleportersByGroup.set(group, [...(teleportersByGroup.get(group) ?? []), { x, y }]);
    })
  );

  const seen = new Set<number>([level.playerStart.y * width + level.playerStart.x]);
  const queue: GridPoint[] = [level.playerStart];
  let chips = 0;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    const tile = ConfigRegistry.getTile(level.terrain[cell.y][cell.x]);
    if (tile.isLevelExit) return { exit: true, chips };
    const item = level.items[cell.y][cell.x];
    if (item && ConfigRegistry.getTile(item).collectible === 'chip') chips++;
    const next = ORDERED_DIRECTIONS.map((d) => ({
      x: cell.x + DIRECTION_VECTORS[d].dx,
      y: cell.y + DIRECTION_VECTORS[d].dy
    }));
    if (tile.isTeleporter) next.push(...(teleportersByGroup.get(tile.teleportGroup ?? DEFAULT_TELEPORT_GROUP) ?? []));
    for (const n of next) {
      const k = n.y * width + n.x;
      if (!seen.has(k) && open(n.x, n.y)) {
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return { exit: false, chips };
}
