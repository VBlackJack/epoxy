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
import { AudioManager } from '../../audio/AudioManager';
import { FLOOR_TILE_ID, OPPOSITE_DIRECTION, SUNK_BLOCK_TILE_ID } from '../coreConstants';
import { turnClockwise } from '../lynx/directions';
import { Direction, RuntimeEntity } from '../types';
import { isPushAllowed } from './epoxyArrowBlocks';
import { forceCycleArrival } from './epoxyForceCycle';
import { enterSwivel, leaveSwivel } from './epoxySwivels';
import { getTurretDef, turnsOnPush } from './epoxyTurrets';
import {
  EpoxyContext,
  EpoxyWorld,
  getEntityAt,
  isCellClosedTrap,
  isEdgeBlocked,
  isInBounds,
  killPlayer,
  leaveCell,
  notePulseArrival,
  removeEntity,
  shotAt
} from './epoxyWorld';

/** Whether a push by this block may move a neighbouring block of the given type (CC2 chain pushing). */
function chainsInto(pusher: RuntimeEntity, neighbour: RuntimeEntity): boolean {
  return ConfigRegistry.getEntityDef(pusher.type)?.chainPushes?.includes(neighbour.type) === true;
}

/** Whether a block may take part in a push toward a direction (its own rules, not the cell ahead). */
function canBeShoved(w: EpoxyWorld, block: RuntimeEntity, dir: Direction): boolean {
  return !isCellClosedTrap(w, block.x, block.y) && isPushAllowed(block, dir);
}

/**
 * Plans the line of blocks a push moves, nearest first. Returns undefined when the push is refused: a member
 * that cannot yield, a sliding member, or a last block with nowhere to go. The plan only decides refusal;
 * the world is not touched.
 */
function planPushLine(
  w: EpoxyWorld,
  block: RuntimeEntity,
  dir: Direction,
  allowChain: boolean
): RuntimeEntity[] | undefined {
  const vec = DIRECTION_VECTORS[dir];
  const line: RuntimeEntity[] = [block];
  let current = block;
  for (;;) {
    const destX = current.x + vec.dx;
    const destY = current.y + vec.dy;
    const next = allowChain && isInBounds(w, destX, destY) ? getEntityAt(w, destX, destY) : undefined;
    if (next && next.kind === 'block' && chainsInto(current, next)) {
      // CC2: a block never pushes a sliding block, and a trapped or off-arrow block does not yield.
      if (next.isSliding || !canBeShoved(w, next, dir)) return undefined;
      line.push(next);
      current = next;
      continue;
    }
    if (!isCanBlockEnter(w, current, destX, destY, dir)) return undefined;
    // Defensive: unreachable from a player push (the player stands behind the line) and puppets do not chain.
    // A chain never ends on the live player; a lone block keeps its single-push behaviour.
    if (line.length > 1 && w.player.alive && w.player.x === destX && w.player.y === destY) return undefined;
    return line;
  }
}

export function attemptPushBlock(ctx: EpoxyContext, block: RuntimeEntity, dir: Direction, allowChain = true): boolean {
  const w = ctx.world;
  if (!canBeShoved(w, block, dir)) {
    return false;
  }
  const line = planPushLine(w, block, dir, allowChain);
  if (!line) {
    return false;
  }
  const vec = DIRECTION_VECTORS[dir];

  // Move from the far end. Each move changes the world (leaving a cell, swivels, buttons, teleports), so every
  // block is checked again just before it moves; the first failure stops the chain. Blocks already moved stay moved.
  let movedCount = 0;
  let directMoved = false;
  for (let i = line.length - 1; i >= 0; i--) {
    const member = line[i];
    if (!w.player.alive) break;
    // Still the same block at its cell and still allowed to yield. A sliding member refuses, but the directly
    // pushed block keeps the old rule (it may be pushed while it slides).
    if (getEntityAt(w, member.x, member.y) !== member || !canBeShoved(w, member, dir)) break;
    if (i > 0 && member.isSliding) break;
    const destX = member.x + vec.dx;
    const destY = member.y + vec.dy;
    if (!isCanBlockEnter(w, member, destX, destY, dir)) break;
    if (i === 0) {
      // A push by the player, or by a steered puppet, turns the turret toward the push; the turret's own slide never turns it.
      const turret = getTurretDef(member.type);
      if (turret && turnsOnPush(turret)) member.facing = dir;
    }
    moveBlockTo(ctx, member, destX, destY, dir);
    movedCount++;
    if (i === 0) directMoved = true;
  }
  if (movedCount > 1 || (movedCount > 0 && !directMoved)) w.chainPushCount++;
  if (movedCount > 0 && !directMoved) w.rejectedPushMovedBlocks = true;
  return directMoved;
}

export function isCanBlockEnter(
  w: EpoxyWorld,
  block: RuntimeEntity,
  destX: number,
  destY: number,
  dir: Direction
): boolean {
  if (!isInBounds(w, destX, destY)) return false;
  if (isEdgeBlocked(w, block.x, block.y, destX, destY, dir)) return false;

  const destTile = ConfigRegistry.getTile(w.terrain[destY][destX]);
  if (!destTile.passableByBlock) return false;
  // An item that bars blocks (the toggle clock) keeps them out of its cell.
  const destItem = w.items[destY][destX];
  if (destItem !== null && ConfigRegistry.getTile(destItem).blocksBlocks === true) return false;
  if (destTile.hazard && ConfigRegistry.getEntityDef(block.type)?.refusesHazards?.includes(destTile.hazard)) {
    return false;
  }

  const existingEntity = getEntityAt(w, destX, destY);
  if (existingEntity) return false;
  // A flying shot is no occupant, but a block never rides into it.
  if (w.shots.length > 0 && shotAt(w, destX, destY)) return false;

  return true;
}

export function moveBlockTo(
  ctx: EpoxyContext,
  block: RuntimeEntity,
  destX: number,
  destY: number,
  dir: Direction,
  allowTeleport = true
): void {
  const w = ctx.world;
  // A clone spawns in place and leaves no cell behind.
  if (block.x !== destX || block.y !== destY) {
    leaveSwivel(w, block.x, block.y, dir);
    leaveCell(w, block.x, block.y);
  }
  block.x = destX;
  block.y = destY;
  block.dir = dir;
  enterSwivel(w, destX, destY, dir);

  const blockDef = ConfigRegistry.getEntityDef(block.type);
  const tileId = w.terrain[destY][destX];
  const tile = ConfigRegistry.getTile(tileId);
  const itemId = w.items[destY][destX];

  if (w.player.x === destX && w.player.y === destY && w.player.alive) {
    killPlayer(ctx, 'hud.messages.death_block', 'death');
    return;
  }

  if (itemId && ConfigRegistry.getTile(itemId).hazard === 'bomb' && blockDef?.destroyedByBomb) {
    w.items[destY][destX] = null;
    removeEntity(w, block.uid);
    AudioManager.playSfx('bomb');
    ctx.emitVisual('explosion', destX, destY);
    return;
  }

  if (tile.hazard === 'water') {
    w.terrain[destY][destX] = blockDef?.waterTransformsTo || tile.blockTransformsTo || SUNK_BLOCK_TILE_ID;
    removeEntity(w, block.uid);
    AudioManager.playSfx('splash');
    ctx.emitVisual('splash', destX, destY);
    return;
  }

  if (tile.hazard === 'slime') {
    w.terrain[destY][destX] = tile.blockTransformsTo || FLOOR_TILE_ID;
    removeEntity(w, block.uid);
    AudioManager.playSfx('splash');
    ctx.emitVisual('splash', destX, destY, 'green');
    return;
  }

  if (tile.hazard === 'fire' && blockDef?.destroyedByFire) {
    if (blockDef.meltsInFireTo) {
      w.terrain[destY][destX] = blockDef.meltsInFireTo;
    }
    removeEntity(w, block.uid);
    AudioManager.playSfx('burn');
    return;
  }

  // A turn plate turns the arrows of an arrow block that arrives on it; a destroyed block never gets here.
  if (tile.facingTurn !== undefined && blockDef?.pushArrows !== undefined) {
    block.facing = turnClockwise(block.facing ?? block.dir, tile.facingTurn);
  }

  notePulseArrival(w, destX, destY, block);

  // A button worked by the player alone (a steering pad) does nothing when a block slides onto it.
  if (tile.buttonAction && tile.buttonWorkedBy !== 'player') {
    ctx.triggerButton(destX, destY, tile.buttonAction);
    if (!w.player.alive) return;
  }

  // A jump resolves the arrival (and the sliding state) at the exit itself.
  if (tile.isTeleporter && allowTeleport && ctx.teleportEntity(block, destX, destY, dir)) {
    return;
  }

  const updatedTile = ConfigRegistry.getTile(w.terrain[block.y][block.x]);
  if (updatedTile.slideType === 'ice' && blockDef?.slidesOnIce) {
    block.dir = updatedTile.deflectionMap?.[dir] || dir;
    block.isSliding = true;
    block.cooldownTicks = ConfigRegistry.getGame().timing.slideCooldownTicks;
  } else if (updatedTile.slideType === 'force' && blockDef?.slidesOnForce) {
    block.dir =
      forceCycleArrival(w, updatedTile) ??
      (updatedTile.forceDirection === 'RANDOM' || !updatedTile.forceDirection ? dir : updatedTile.forceDirection);
    block.isSliding = true;
    block.cooldownTicks = ConfigRegistry.getGame().timing.slideCooldownTicks;
  } else {
    block.isSliding = false;
  }
}

/** Advances one block of the entity loop by a tick: a block moves only while it slides. */
export function stepSlidingBlock(ctx: EpoxyContext, entity: RuntimeEntity): void {
  const w = ctx.world;
  if (!entity.isSliding) return;
  if (entity.cooldownTicks > 0) {
    entity.cooldownTicks--;
    return;
  }
  const tile = ConfigRegistry.getTile(w.terrain[entity.y][entity.x]);
  const slideDir = entity.dir;
  const vec = DIRECTION_VECTORS[slideDir];
  const nx = entity.x + vec.dx;
  const ny = entity.y + vec.dy;

  if (isCanBlockEnter(w, entity, nx, ny, slideDir)) {
    moveBlockTo(ctx, entity, nx, ny, slideDir);
  } else if (tile.slideType === 'ice') {
    const bounceDir = OPPOSITE_DIRECTION[slideDir];
    const deflected = tile.deflectionMap?.[bounceDir] || bounceDir;
    const bVec = DIRECTION_VECTORS[deflected];
    if (isCanBlockEnter(w, entity, entity.x + bVec.dx, entity.y + bVec.dy, deflected)) {
      moveBlockTo(ctx, entity, entity.x + bVec.dx, entity.y + bVec.dy, deflected);
    } else {
      entity.isSliding = false;
    }
  } else {
    entity.isSliding = false;
  }
}
