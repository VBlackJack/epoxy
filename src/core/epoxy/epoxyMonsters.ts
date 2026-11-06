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
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { AudioManager } from '../../audio/AudioManager';
import {
  CHASE_PLAYER_PATTERN,
  DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
  FLEE_PLAYER_PATTERN,
  OPPOSITE_DIRECTION,
  STATIONARY_PATTERN
} from '../coreConstants';
import { Direction, RelativeTurn, RuntimeEntity } from '../types';
import { stepSlidingBlock } from './epoxyBlocks';
import { isLitChargeItem } from './epoxyCharges';
import { forceCycleArrival } from './epoxyForceCycle';
import { followRail } from './epoxyRails';
import { absorbMonsterContact } from './epoxyWard';
import { consumeShotAt, killMonsterByShot } from './epoxyShots';
import { enterSwivel, leaveSwivel } from './epoxySwivels';
import {
  EpoxyContext,
  EpoxyWorld,
  applyRelativeTurn,
  getEntityAt,
  isCellClosedTrap,
  isEdgeBlocked,
  isInBounds,
  killPlayer,
  monsterSlowdown,
  notePulseArrival,
  removeEntity
} from './epoxyWorld';

export function updateEntities(ctx: EpoxyContext): void {
  const w = ctx.world;
  w.removedUids.clear();
  const snapshotEntities = [...w.entities];
  for (const entity of snapshotEntities) {
    if (w.removedUids.has(entity.uid)) continue;

    // Entities sitting directly on a clone machine act as templates and do not move on their own
    if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine) {
      continue;
    }

    if (entity.kind === 'block') {
      stepSlidingBlock(ctx, entity);
      continue;
    }

    if (!stepMonster(ctx, entity)) return;
  }
}

/** Advances one monster of the entity loop by a tick. Returns false when the player was killed, so the loop stops. */
function stepMonster(ctx: EpoxyContext, entity: RuntimeEntity): boolean {
  const w = ctx.world;
  // A steered monster never decides a step: it moves only when a steering pad is worked.
  if (ConfigRegistry.getEntityDef(entity.type)?.steeredBy !== undefined) return true;
  // A sleeping lurker never moves by itself; only the player's arrival next to it changes it.
  if (ConfigRegistry.getEntityDef(entity.type)?.movementPattern === STATIONARY_PATTERN) return true;
  if (entity.cooldownTicks > 0) {
    entity.cooldownTicks--;
    return true;
  }

  const def = ConfigRegistry.getEntityDef(entity.type);
  // A step lasts interval + 1 ticks (the countdown, then the move); slow-time boots stretch the whole step.
  const interval = def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS;
  entity.cooldownTicks = (interval + 1) * monsterSlowdown(w) - 1;

  if (isCellClosedTrap(w, entity.x, entity.y)) {
    return true;
  }

  const chosenDir = chooseMonsterDirection(w, entity);
  if (!chosenDir) return true;

  const vec = DIRECTION_VECTORS[chosenDir];
  const nx = entity.x + vec.dx;
  const ny = entity.y + vec.dy;
  leaveSwivel(w, entity.x, entity.y);
  entity.x = nx;
  entity.y = ny;
  entity.dir = chosenDir;

  return resolveMonsterArrival(ctx, entity, true);
}

/**
 * Applies the effects of the cell a monster has just entered (by a step, a
 * teleport or a clone spawn): the player under it dies, a flying shot kills it, a bomb or water or
 * fire removes it, a button is pressed and a teleporter jumps it on.
 * Returns false when the player was killed, so the caller stops processing.
 */
export function resolveMonsterArrival(ctx: EpoxyContext, entity: RuntimeEntity, allowTeleport: boolean): boolean {
  const w = ctx.world;
  const nx = entity.x;
  const ny = entity.y;
  const def = ConfigRegistry.getEntityDef(entity.type);
  enterSwivel(w, nx, ny, entity.dir);
  // A rail turns the monster to the open side it did not come in by, so a forward move follows a bend.
  followRail(w, entity);

  if (w.player.x === nx && w.player.y === ny && w.player.alive) {
    // A ward destroys the monster that touches the player; the player lives.
    if (absorbMonsterContact(w, entity.uid)) return true;
    killPlayer(ctx, 'hud.messages.death_monster', 'death');
    return false;
  }

  // Running into a flying shot (by a step, a teleport or a clone spawn) kills the monster and spends the shot.
  if (w.shots.length > 0 && consumeShotAt(w, nx, ny)) {
    killMonsterByShot(ctx, entity);
    return true;
  }

  const destTile = ConfigRegistry.getTile(w.terrain[ny][nx]);
  const destItem = w.items[ny][nx];

  if (destItem && ConfigRegistry.getTile(destItem).hazard === 'bomb') {
    w.items[ny][nx] = null;
    removeEntity(w, entity.uid);
    AudioManager.playSfx('bomb');
    return true;
  }

  if (destTile.hazard === 'water' && !def?.immuneToWater) {
    removeEntity(w, entity.uid);
    AudioManager.playSfx('splash');
    return true;
  }
  if (destTile.hazard === 'fire' && !def?.immuneToFire) {
    removeEntity(w, entity.uid);
    AudioManager.playSfx('burn');
    return true;
  }

  if (destTile.hazard === 'slime') {
    removeEntity(w, entity.uid);
    AudioManager.playSfx('splash');
    return true;
  }

  // A transmogrifier swaps the kind of the monster for its pair; only `type` changes (uid, position, facing,
  // cooldown and sliding state stay). It comes after every kill check on purpose: the tile is not a hazard
  // and a cell holds one terrain, so the kind that arrived is the one the water, fire, bomb and shot checks
  // above judged, and no hazard of the new kind can share the cell. From the next step on the new kind's
  // rules apply.
  if (destTile.transmogrifies && def?.transmogrifiesTo !== undefined) {
    entity.type = def.transmogrifiesTo;
  }

  notePulseArrival(w, nx, ny, entity);

  // A turning force floor turns the monster to the next direction of the shared turn.
  const cycleDir = forceCycleArrival(w, destTile);
  if (cycleDir) entity.dir = cycleDir;

  // A button worked by the player alone (a steering pad) does nothing when a monster steps on it.
  if (destTile.buttonAction && destTile.buttonWorkedBy !== 'player' && !ctx.triggerButton(nx, ny, destTile.buttonAction)) {
    return false;
  }

  if (destTile.isTeleporter && allowTeleport) {
    return ctx.teleportEntity(entity, nx, ny, entity.dir) ? resolveMonsterArrival(ctx, entity, false) : true;
  }
  return true;
}

function chooseMonsterDirection(w: EpoxyWorld, monster: RuntimeEntity): Direction | null {
  const def = ConfigRegistry.getEntityDef(monster.type);
  if (!def) return null;

  const currentTile = ConfigRegistry.getTile(w.terrain[monster.y][monster.x]);
  if (currentTile.slideType === 'ice') {
    const slideDir = currentTile.deflectionMap?.[monster.dir] || monster.dir;
    if (canMonsterEnter(w, monster, slideDir)) return slideDir;
    const bounce = OPPOSITE_DIRECTION[slideDir];
    if (canMonsterEnter(w, monster, bounce)) return bounce;
    return null;
  }

  // A turning force floor sets the facing on arrival (see resolveMonsterArrival); the monster keeps pushing that way.
  if (currentTile.forceCycle === true) {
    return canMonsterEnter(w, monster, monster.dir) ? monster.dir : null;
  }

  if (currentTile.slideType === 'force' && currentTile.forceDirection) {
    const forceDir =
      currentTile.forceDirection === 'RANDOM'
        ? ORDERED_DIRECTIONS[w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)]
        : currentTile.forceDirection;
    return canMonsterEnter(w, monster, forceDir) ? forceDir : null;
  }

  if (def.movementPattern === CHASE_PLAYER_PATTERN || def.movementPattern === FLEE_PLAYER_PATTERN) {
    const dx = w.player.x - monster.x;
    const dy = w.player.y - monster.y;
    const candidates: Direction[] = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx !== 0) candidates.push(dx > 0 ? 'E' : 'W');
      if (dy !== 0) candidates.push(dy > 0 ? 'S' : 'N');
    } else {
      if (dy !== 0) candidates.push(dy > 0 ? 'S' : 'N');
      if (dx !== 0) candidates.push(dx > 0 ? 'E' : 'W');
    }
    // A fleeing monster tries the same axes away from the player; a blocked axis is tried only when it is not lined up.
    if (def.movementPattern === FLEE_PLAYER_PATTERN) {
      for (let i = 0; i < candidates.length; i++) candidates[i] = OPPOSITE_DIRECTION[candidates[i]];
    }
    for (const c of candidates) {
      if (canMonsterEnter(w, monster, c)) return c;
    }
    return null;
  }

  if (def.movementPattern === 'forward_else_random') {
    if (canMonsterEnter(w, monster, monster.dir)) {
      return monster.dir;
    }
    const turns: RelativeTurn[] = ['LEFT', 'RIGHT', 'BACK'];
    w.rng.shuffle(turns);
    for (const turn of turns) {
      const d = applyRelativeTurn(monster.dir, turn);
      if (canMonsterEnter(w, monster, d)) return d;
    }
    return null;
  }

  if (def.movementPattern === 'pure_random') {
    const dirs: Direction[] = [...ORDERED_DIRECTIONS];
    w.rng.shuffle(dirs);
    for (const d of dirs) {
      if (canMonsterEnter(w, monster, d)) return d;
    }
    return null;
  }

  const turnOrder = def.turnOrder || ['FORWARD'];
  for (const rel of turnOrder) {
    const candidateDir = applyRelativeTurn(monster.dir, rel);
    if (canMonsterEnter(w, monster, candidateDir)) {
      return candidateDir;
    }
  }

  return null;
}

/**
 * Whether the monster may step one cell in `dir`: inside the map, past the cell edges, onto a tile it can
 * enter (or one its definition passes) with no item but a bomb and no entity. `ignoreOccupant` leaves the
 * entity check to the caller, which pushes the block in the way (a steered puppet).
 */
export function canMonsterEnter(w: EpoxyWorld, monster: RuntimeEntity, dir: Direction, ignoreOccupant = false): boolean {
  const vec = DIRECTION_VECTORS[dir];
  const nx = monster.x + vec.dx;
  const ny = monster.y + vec.dy;
  if (!isInBounds(w, nx, ny)) return false;
  if (isEdgeBlocked(w, monster.x, monster.y, nx, ny, dir)) return false;

  const destTile = ConfigRegistry.getTile(w.terrain[ny][nx]);
  const def = ConfigRegistry.getEntityDef(monster.type);

  // passesTiles lets a monster enter a tile it otherwise could not (undefined for every monster that exists today).
  const passesTile = def?.passesTiles?.includes(w.terrain[ny][nx]) === true;
  if (!destTile.passableByMonster && !passesTile && !(destTile.hazard === 'fire' && def?.immuneToFire)) {
    return false;
  }
  if (destTile.hazard === 'fire' && def?.avoidsFire) return false;

  const itemId = w.items[ny][nx];
  if (itemId && ConfigRegistry.getTile(itemId).hazard !== 'bomb' && !isLitChargeItem(itemId)) {
    return false;
  }

  if (!ignoreOccupant && getEntityAt(w, nx, ny)) return false;

  return true;
}
