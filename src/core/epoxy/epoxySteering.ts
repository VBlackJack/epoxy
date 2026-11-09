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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { DIRECTION_VECTORS } from '../../config/constants';
import { STEER_MONSTERS_ACTION } from '../coreConstants';
import { Direction, RuntimeEntity } from '../types';
import { attemptPushBlock } from './epoxyBlocks';
import { railRedirect } from './epoxyRailsCc2';
import { leaveSwivel } from './epoxySwivels';
import { canMonsterEnter, resolveMonsterArrival } from './epoxyMonsters';
import { EpoxyContext, EpoxyWorld, getEntityAt, isCellClosedTrap, monsterLeavesCell, playerAtCell } from './epoxyWorld';

/** Whether the entity is a monster that moves only when a steering pad is worked. */
function isSteered(entity: RuntimeEntity): boolean {
  return entity.kind === 'monster' && ConfigRegistry.getEntityDef(entity.type)?.steeredBy === STEER_MONSTERS_ACTION;
}

/** Whether the entity is still on the grid: the step of a puppet earlier in the line may have removed it. */
function isOnGrid(w: EpoxyWorld, uid: number): boolean {
  return w.entities.some((e) => e.uid === uid);
}

/**
 * The steered monsters in the order they step: the one furthest ahead along `dir` first, so a line of
 * puppets does not block itself, and the list order between the ones level with each other.
 */
function steeringOrder(w: EpoxyWorld, dir: Direction): RuntimeEntity[] {
  const vec = DIRECTION_VECTORS[dir];
  const ahead = (e: RuntimeEntity): number => e.x * vec.dx + e.y * vec.dy;
  return w.entities.filter(isSteered).sort((a, b) => ahead(b) - ahead(a));
}

/**
 * One steered step of `entity` in `dir`, as a normal monster step with two differences: the block in the
 * way is pushed (when the definition says so, one block, never onto the live player) and the step is
 * taken at once. Returns 'killed' when the arrival killed the player, 'moved' or 'stayed' otherwise.
 */
function stepSteered(ctx: EpoxyContext, entity: RuntimeEntity, wanted: Direction): 'moved' | 'stayed' | 'killed' {
  const w = ctx.world;
  // On a track cell the puppet is turned onto the track like any other monster.
  const dir = railRedirect(w, entity.x, entity.y, wanted, 'walker');
  if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine) return 'stayed';
  if (isCellClosedTrap(w, entity.x, entity.y)) return 'stayed';
  if (!canMonsterEnter(w, entity, dir, true)) return 'stayed';

  const vec = DIRECTION_VECTORS[dir];
  const nx = entity.x + vec.dx;
  const ny = entity.y + vec.dy;
  const occupant = getEntityAt(w, nx, ny);
  if (occupant) {
    if (occupant.kind !== 'block' || ConfigRegistry.getEntityDef(entity.type)?.pushesBlocks !== true) return 'stayed';
    // The cell behind the block: the live player is never pushed onto.
    const behindX = nx + vec.dx;
    const behindY = ny + vec.dy;
    if (playerAtCell(w, behindX, behindY) !== undefined) return 'stayed';
    if (!attemptPushBlock(ctx, occupant, dir, false)) return 'stayed';
    if (!w.player.alive) return 'killed';
    // The pushed block may have sunk, burned or slid on, but it never stays in the cell.
    if (getEntityAt(w, nx, ny)) return 'stayed';
  }

  leaveSwivel(w, entity.x, entity.y, dir);
  // A steered monster that may enter turtles sinks the one it leaves, as a walking monster does.
  monsterLeavesCell(w, entity);
  entity.x = nx;
  entity.y = ny;
  entity.dir = dir;
  return resolveMonsterArrival(ctx, entity, true) ? 'moved' : 'killed';
}

/**
 * Works a steering pad: every steered monster tries one normal step in `dir`, the way the player moved.
 * They step front first along `dir`, then in list order; one that was removed by a step earlier in the
 * line is skipped. Returns false when a step killed the player, so the caller stops processing.
 */
export function steerMonsters(ctx: EpoxyContext, dir: Direction): boolean {
  const w = ctx.world;
  let alive = true;
  for (const entity of steeringOrder(w, dir)) {
    if (!isOnGrid(w, entity.uid)) continue;
    const outcome = stepSteered(ctx, entity, dir);
    // A moved puppet changes what a turret beam ends on.
    if (outcome !== 'stayed') w.beamDirty = true;
    if (outcome === 'killed') {
      alive = false;
      break;
    }
  }
  return alive;
}
