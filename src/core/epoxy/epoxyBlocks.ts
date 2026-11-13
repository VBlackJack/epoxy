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
import { CC3D_PUSHED_BLOCK_ENTRY_COOLDOWN_TICKS, STEER_MONSTERS_ACTION, CC_BLOCK_SLIDE_COOLDOWN_TICKS, DIRT_BLOCK_ENTITY_ID, FLOOR_TILE_ID, OPPOSITE_DIRECTION, SUNK_BLOCK_TILE_ID } from '../coreConstants';
import { turnClockwise } from '../lynx/directions';
import { Direction, RuntimeEntity } from '../types';
import { isPushAllowed } from './epoxyArrowBlocks';
import { usesCc2Engine } from './ccRules';
import { forceCycleArrival } from './epoxyForceCycle';
import { markYellowButtonArrival } from './epoxySteering';
import { railRedirect } from './epoxyRailsCc2';
import { enterSwivel, leaveSwivel } from './epoxySwivels';
import { getTurretDef, turnsOnPush } from './epoxyTurrets';
import { shieldedFromContact, shieldedPlayerAt } from './epoxyWard';
import {
  EpoxyContext,
  EpoxyWorld,
  consumeFishGate,
  getEntityAt,
  isCellClosedTrap,
  isEdgeBlocked,
  isInBounds,
  isOpenFishGate,
  leaveCell,
  notePulseArrival,
  removeEntity,
  shotAt,
  playerAtCell,
  killPlayerAt,
  mapWidth
} from './epoxyWorld';

/**
 * CC2 engine: entity passes a splash a block left in water bars the real player (Lexy: a 16-frame animation that a cooldown of
 * three frames a tick takes down on the fifth pass after it appeared).
 */
export const CC2_SPLASH_BLOCK_PASSES = 5;

/** The block type the CC2 item bar (blocksDirtBlock) applies to. */
const CC2_DIRT_BLOCK_TYPE = DIRT_BLOCK_ENTITY_ID;

/**
 * CC2 engine: a block that left a splash (sunk in water) or a blast (destroyed by a bomb) on its cell, which bars the real
 * player for a few entity passes. The kind only changes the picture.
 */
function leaveBlockSplash(w: EpoxyWorld, x: number, y: number, explosion: boolean): void {
  const cell = y * mapWidth(w) + x;
  w.blockSplashes.set(cell, w.ccMonsterClock + CC2_SPLASH_BLOCK_PASSES);
  if (explosion) w.blockExplosions.add(cell);
  else w.blockExplosions.delete(cell);
}

/** Whether a splash a block left in water still bars the real player from this cell. */
export function splashBarsPlayer(w: EpoxyWorld, x: number, y: number): boolean {
  if (w.blockSplashes.size === 0) return false;
  const until = w.blockSplashes.get(y * mapWidth(w) + x);
  return until !== undefined && w.ccMonsterClock < until;
}

/** Drops the splashes whose life is over: they bar nobody and are not drawn. */
export function pruneSplashes(w: EpoxyWorld): void {
  if (w.blockSplashes.size === 0) return;
  for (const [cell, until] of w.blockSplashes) {
    if (w.ccMonsterClock < until) continue;
    w.blockSplashes.delete(cell);
    w.blockExplosions.delete(cell);
  }
}

/** Any mover other than the real player that tries to enter a cell erases the splash on it. */
export function eraseSplash(w: EpoxyWorld, x: number, y: number): void {
  if (w.blockSplashes.size === 0) return;
  const cell = y * mapWidth(w) + x;
  w.blockSplashes.delete(cell);
  w.blockExplosions.delete(cell);
}

/**
 * Whether a push by this block may move a neighbouring block of the given type (CC2 chain pushing). `head` is the block
 * the push started from: when it pushes a transitive chain (the CC3D ice block) its list governs every block of the
 * line, whatever the blocks behind it would push themselves; otherwise each block pushes by its own list.
 */
function chainsInto(pusher: RuntimeEntity, neighbour: RuntimeEntity, head: RuntimeEntity = pusher): boolean {
  const headDef = ConfigRegistry.getEntityDef(head.type);
  const governing = headDef?.chainPushesTransitive === true ? headDef : ConfigRegistry.getEntityDef(pusher.type);
  return governing?.chainPushes?.includes(neighbour.type) === true;
}

/** Where a refused push or slide ran into a wall that shows itself to any mover (format 15, the appearing wall). */
interface PushRefusal {
  bump?: { x: number; y: number };
}

/** Records the appearing wall that a block bumps into at the given cell, when the cell is one and the step reaches it. */
function noteBump(
  w: EpoxyWorld,
  block: RuntimeEntity,
  destX: number,
  destY: number,
  dir: Direction,
  refusal: PushRefusal
): void {
  if (!isInBounds(w, destX, destY) || isEdgeBlocked(w, block.x, block.y, destX, destY, dir, false, 'block')) return;
  if (ConfigRegistry.getTile(w.terrain[destY][destX]).revealedByAny === true) refusal.bump = { x: destX, y: destY };
}

/** Turns the appearing wall a refused block ran into into the terrain it reveals. */
function revealBump(w: EpoxyWorld, refusal: PushRefusal): void {
  if (refusal.bump === undefined) return;
  const revealed = ConfigRegistry.getTile(w.terrain[refusal.bump.y][refusal.bump.x]).revealsToOnTouch;
  if (revealed === undefined) return;
  w.terrain[refusal.bump.y][refusal.bump.x] = revealed;
  w.gridMutatedByMove = true;
}

/** Ticks a CC3D block the player pushes takes to finish its step before its cell acts on it (Cc3d STEP_TICKS.normal). */
const CC3D_PUSH_STEP_TICKS = 4;
/** Ticks a pushed block of the CC2 engine takes to finish its step (the same four as the CC3D push). */
const CC2_PUSH_STEP_TICKS = 4;

/** Whether a block may take part in a push toward a direction (its own rules, not the cell ahead). */
function canBeShoved(w: EpoxyWorld, block: RuntimeEntity, dir: Direction): boolean {
  // A CC3D block still finishing its step is refused (Cc3dSimulation planPush: a block in motion cannot be pushed).
  if (block.arrivalTicks !== undefined) return false;
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
  allowChain: boolean,
  guardPlayerCell = false,
  refusal?: PushRefusal,
  head: RuntimeEntity = block
): RuntimeEntity[] | undefined {
  const vec = DIRECTION_VECTORS[dir];
  const line: RuntimeEntity[] = [block];
  let current = block;
  for (;;) {
    const destX = current.x + vec.dx;
    const destY = current.y + vec.dy;
    const next = allowChain && isInBounds(w, destX, destY) ? getEntityAt(w, destX, destY) : undefined;
    if (next && next.kind === 'block' && chainsInto(current, next, head)) {
      // CC2: a block never pushes a sliding block, and a trapped or off-arrow block does not yield.
      if (next.isSliding || !canBeShoved(w, next, dir)) return undefined;
      line.push(next);
      current = next;
      continue;
    }
    if (!isCanBlockEnter(w, current, destX, destY, dir)) {
      if (refusal) noteBump(w, current, destX, destY, dir, refusal);
      return undefined;
    }
    // A player push never reaches this (the player stands behind the line) and puppets do not chain; slide pushes do.
    // A chain never ends on the live player; a lone block keeps its single-push behaviour.
    // A push made by a sliding block guards the lone block too: nothing is pushed onto the live player.
    // A push never lands on a parked player. The controlled player stands behind the pushed line, so only the parked
    // ones can be at the destination; the guard flags below keep covering the controlled player for slides and puppets.
    if (w.parked.some((p) => p.alive && p.x === destX && p.y === destY)) return undefined;
    if ((guardPlayerCell || line.length > 1) && playerAtCell(w, destX, destY) !== undefined) {
      return undefined;
    }
    return line;
  }
}

/**
 * Whether a push of `block` toward `requestedDir` would be accepted now: the same judgement as attemptPushBlock, with the
 * world left untouched. A monster that pushes (the CC2 rover) asks it before it chooses a step.
 */
export function canPushBlock(
  w: EpoxyWorld,
  block: RuntimeEntity,
  requestedDir: Direction,
  allowChain = true,
  guardPlayerCell = false
): boolean {
  const dir = railRedirect(w, block.x, block.y, requestedDir, 'block');
  return canBeShoved(w, block, dir) && planPushLine(w, block, dir, allowChain, guardPlayerCell) !== undefined;
}

export function attemptPushBlock(
  ctx: EpoxyContext,
  block: RuntimeEntity,
  requestedDir: Direction,
  allowChain = true,
  guardPlayerCell = false,
  slider?: RuntimeEntity,
  byPlayer = false
): boolean {
  const w = ctx.world;
  // A block on a Chip's Challenge 2 track cell is turned onto the track when the push is one the tracks refuse.
  const dir = railRedirect(w, block.x, block.y, requestedDir, 'block');
  if (!canBeShoved(w, block, dir)) {
    return false;
  }
  const refusal: PushRefusal = {};
  const line = planPushLine(w, block, dir, allowChain, guardPlayerCell, refusal, slider ?? block);
  if (!line) {
    revealBump(w, refusal);
    return false;
  }
  const vec = DIRECTION_VECTORS[dir];
  // The blocks of a push by the player, or by a block sliding into them, take a pushed step of their own (CC3D).
  const pushedStep = byPlayer || slider !== undefined;

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
    moveBlockTo(ctx, member, destX, destY, dir, true, pushedStep && defersArrival(w, member, destX, destY));
    // A converted CC3D level: a block the player pushed onto ice or a force floor takes a pushed step (two ticks) before
    // its first slide step; the slide goes on at one tick per wait.
    if (w.cc3dPace && byPlayer && member.isSliding && member.arrivalTicks === undefined) {
      member.cooldownTicks = Math.max(member.cooldownTicks, CC3D_PUSHED_BLOCK_ENTRY_COOLDOWN_TICKS);
    }
    movedCount++;
    if (i === 0) directMoved = true;
  }
  if (movedCount > 1 || (movedCount > 0 && !directMoved)) w.chainPushCount++;
  if (movedCount > 0 && !directMoved) w.rejectedPushMovedBlocks = true;
  return directMoved;
}

/**
 * Whether the step of a block the player pushes ends later than the push: a CC3D block (Cc3dSimulation.startStep gives it
 * the player's four ticks) or a block of a CC2-engine level onto a cell that is not ice, a force floor or a teleporter,
 * which it enters at the fast pace and which act on it at once here.
 */
function defersArrival(w: EpoxyWorld, block: RuntimeEntity, destX: number, destY: number): boolean {
  if (!usesCc2Engine(w.level) && ConfigRegistry.getEntityDef(block.type)?.stopsAtWall !== true) return false;
  return arrivesAtStepEnd(w, destX, destY);
}

/** Whether a block that reaches this cell takes a whole step to do so: not onto ice, a force floor or a teleporter, which act at once. */
function arrivesAtStepEnd(w: EpoxyWorld, x: number, y: number): boolean {
  const tile = ConfigRegistry.getTile(w.terrain[y][x]);
  return tile.slideType === undefined && tile.isTeleporter !== true && tile.teleportsToSelf !== true;
}

/** Whether a push is one the player's step carries: the block's cell is his to enter when the push is made. */
export function isCc3dPush(block: RuntimeEntity): boolean {
  return ConfigRegistry.getEntityDef(block.type)?.stopsAtWall === true;
}

export function isCanBlockEnter(
  w: EpoxyWorld,
  block: RuntimeEntity,
  destX: number,
  destY: number,
  dir: Direction,
  crushable?: RuntimeEntity
): boolean {
  if (!isInBounds(w, destX, destY)) return false;
  if (isEdgeBlocked(w, block.x, block.y, destX, destY, dir, false, 'block')) return false;

  const destTile = ConfigRegistry.getTile(w.terrain[destY][destX]);
  // A block of the CC3D ice kind slides over some tiles that refuse the others (the thieves), without changing them.
  const slidesOver = ConfigRegistry.getEntityDef(block.type)?.slidesOverTiles?.includes(destTile.id) === true;
  if (!destTile.passableByBlock && !isOpenFishGate(w, destTile) && !slidesOver) return false;
  // A tile may bar some blocks although it admits the others (the CC3D dirt and slime bar mirrors and turrets).
  if (destTile.barsBlocks?.includes(block.type) === true) return false;
  // An item that bars blocks (the toggle clock) keeps them out of its cell.
  const destItem = w.items[destY][destX];
  if (destItem !== null && ConfigRegistry.getTile(destItem).blocksBlocks === true) return false;
  // On a CC2-engine level the dirt block is also kept out of the cells holding chips, keys and bonus items.
  if (
    destItem !== null &&
    block.type === CC2_DIRT_BLOCK_TYPE &&
    usesCc2Engine(w.level) &&
    ConfigRegistry.getTile(destItem).blocksDirtBlock === true
  ) {
    return false;
  }
  // A block of the CC3D rules keeps out of any item except a bomb, which it sets off; a floating colour block bars every block.
  if (
    destItem !== null &&
    ConfigRegistry.getEntityDef(block.type)?.refusesItems === true &&
    ConfigRegistry.getTile(destItem).hazard !== 'bomb'
  ) {
    return false;
  }
  if (destTile.blocksBlocks === true) return false;
  if (destTile.hazard && ConfigRegistry.getEntityDef(block.type)?.refusesHazards?.includes(destTile.hazard)) {
    return false;
  }

  const existingEntity = getEntityAt(w, destX, destY);
  if (existingEntity && existingEntity !== crushable) return false;
  // A block never rides into a player in a helmet: it is stopped, as it would be by a monster.
  if (shieldedPlayerAt(w, destX, destY)) return false;
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
  allowTeleport = true,
  deferArrival = false
): void {
  const w = ctx.world;
  // A clone spawns in place and leaves no cell behind.
  if (block.x !== destX || block.y !== destY) {
    leaveSwivel(w, block.x, block.y, dir);
    leaveCell(w, block.x, block.y, { leaver: block });
  }
  block.x = destX;
  block.y = destY;
  block.dir = dir;
  eraseSplash(w, destX, destY);
  enterSwivel(w, destX, destY, dir);

  const crushed = playerAtCell(w, destX, destY);
  // A helmet shields from the block (a teleport or clone arrival can still land on the player): the player lives.
  if (crushed !== undefined && !shieldedFromContact(crushed)) {
    killPlayerAt(ctx, crushed, 'hud.messages.death_block', 'death');
    return;
  }

  // A block of the CC3D rules takes its step to finish: it holds its cell now and the cell acts on it when the step ends.
  if (deferArrival) {
    // A block the running pass has already visited has missed this tick's countdown: it counts the tick of its push now.
    block.arrivalTicks = (usesCc2Engine(w.level) ? CC2_PUSH_STEP_TICKS : CC3D_PUSH_STEP_TICKS) - (w.entityPassSeen.has(block.uid) ? 1 : 0);
    return;
  }
  settleBlockArrival(ctx, block, dir, allowTeleport);
}

/**
 * Ticks a block waits between two cells of a slide: a block of the CC3D rules slides at the fast pace (a cell every two
 * ticks, Cc3dSimulation STEP_TICKS.fast), like one of a classic-rules level.
 */
function blockSlideCooldown(w: EpoxyWorld, def: ReturnType<typeof ConfigRegistry.getEntityDef>): number {
  return w.ccRules || def?.stopsAtWall === true ? CC_BLOCK_SLIDE_COOLDOWN_TICKS : ConfigRegistry.getGame().timing.slideCooldownTicks;
}

/**
 * The cell a block has just reached acts on it: dirt, water, slime, fire, a bomb, a button, a teleporter, ice. Runs at
 * once for most blocks and, for a CC3D block the player pushed, when its step ends (Cc3dSimulation.onArrival).
 */
function settleBlockArrival(ctx: EpoxyContext, block: RuntimeEntity, dir: Direction, allowTeleport: boolean): void {
  const w = ctx.world;
  const destX = block.x;
  const destY = block.y;
  let blockDef = ConfigRegistry.getEntityDef(block.type);
  const tileId = w.terrain[destY][destX];
  const tile = ConfigRegistry.getTile(tileId);
  const itemId = w.items[destY][destX];

  // Format 15, the CC3D dirt: a block it admits clears it and survives, unless the tile keeps it as it is for that block.
  if (tile.blockClearsTo !== undefined && tile.keptBy?.includes(block.type) !== true) {
    w.terrain[destY][destX] = tile.blockClearsTo;
  }

  if (itemId && ConfigRegistry.getTile(itemId).hazard === 'bomb' && blockDef?.destroyedByBomb) {
    w.items[destY][destX] = null;
    // On a CC2-engine level the blast of any block a bomb destroys bars the real player like the splash of a block in water.
    if (usesCc2Engine(w.level)) leaveBlockSplash(w, destX, destY, true);
    removeEntity(w, block.uid);
    AudioManager.playSfx('bomb');
    ctx.emitVisual('explosion', destX, destY);
    return;
  }

  if (tile.hazard === 'water') {
    if (usesCc2Engine(w.level)) leaveBlockSplash(w, destX, destY, false);
    const filled = blockDef?.waterTransformsTo || tile.blockTransformsTo || SUNK_BLOCK_TILE_ID;
    // On a CC2-engine level the fill is the CC2 form of that tile when it has one (CC2 dirt stops only the dirt block).
    w.terrain[destY][destX] = (usesCc2Engine(w.level) ? ConfigRegistry.getTile(filled).cc2Twin : undefined) || filled;
    removeEntity(w, block.uid);
    AudioManager.playSfx('splash');
    ctx.emitVisual('splash', destX, destY);
    return;
  }

  if (tile.hazard === 'slime') {
    w.terrain[destY][destX] = tile.blockTransformsTo || FLOOR_TILE_ID;
    AudioManager.playSfx('splash');
    ctx.emitVisual('splash', destX, destY, 'green');
    // A block the slime lists (the CC2 dirt and ice blocks) clears it and survives; any other block is used up.
    if (tile.clearedByBlocks?.includes(block.type) !== true) {
      removeEntity(w, block.uid);
      return;
    }
  }

  if (tile.hazard === 'fire' && blockDef?.destroyedByFire) {
    if (blockDef.meltsInFireTo) {
      w.terrain[destY][destX] = blockDef.meltsInFireTo;
    }
    removeEntity(w, block.uid);
    AudioManager.playSfx('burn');
    return;
  }

  // A CC2 transmogrifier changes the block that arrives on it into the one its table names; only the type changes.
  if (tile.transmogrifyTable === 'cc2' && blockDef?.transmogrifiesToCc2 !== undefined) {
    block.type = blockDef.transmogrifiesToCc2;
    blockDef = ConfigRegistry.getEntityDef(block.type);
  }

  // The first block into an open fish gate turns it into what it hid. CC3D judges the arrival on the gate and does not
  // judge it again on what shows (a block that clears a gate over water stays on the water), so neither does Epoxy.
  if (isOpenFishGate(w, tile)) consumeFishGate(ctx, destX, destY);

  // A turn plate turns the arrows of an arrow block that arrives on it; a destroyed block never gets here.
  if (tile.facingTurn !== undefined && blockDef?.pushArrows !== undefined) {
    block.facing = turnClockwise(block.facing ?? block.dir, tile.facingTurn);
  }

  notePulseArrival(w, destX, destY, block);

  // CC2 engine: a block arriving on the yellow button sets the pending decision of the yellow tanks, at its step end.
  if (tile.buttonAction === STEER_MONSTERS_ACTION && usesCc2Engine(w.level)) {
    const passesCounted = w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1;
    markYellowButtonArrival(w, dir, passesCounted + block.cooldownTicks + 1);
  }

  // A button worked by the player alone (a steering pad) does nothing when a block slides onto it.
  if (tile.buttonAction && tile.buttonWorkedBy !== 'player') {
    ctx.triggerButton(destX, destY, tile.buttonAction);
    if (!w.player.alive) return;
  }

  // A jump resolves the arrival (and the sliding state) at the exit itself.
  if ((tile.isTeleporter || tile.teleportsToSelf) && allowTeleport && ctx.teleportEntity(block, destX, destY, dir)) {
    return;
  }

  const updatedTile = ConfigRegistry.getTile(w.terrain[block.y][block.x]);
  if (updatedTile.slideType === 'ice' && blockDef?.slidesOnIce) {
    block.dir = updatedTile.deflectionMap?.[dir] || dir;
    block.isSliding = true;
    block.cooldownTicks = blockSlideCooldown(w, blockDef);
  } else if (updatedTile.slideType === 'force' && blockDef?.slidesOnForce) {
    block.dir =
      forceCycleArrival(w, updatedTile) ??
      (updatedTile.forceDirection === 'RANDOM' || !updatedTile.forceDirection ? dir : updatedTile.forceDirection);
    block.isSliding = true;
    block.cooldownTicks = blockSlideCooldown(w, blockDef);
  } else {
    block.isSliding = false;
  }
}

/**
 * A sliding block that reaches a resting block it chains into pushes it along the slide. Never pushes a sliding
 * block, never ends a push on the live player. Counts as a chain push; a slide happens in the tick, not in a
 * player move, so the move-level partial-push flag is left as it was.
 */
function slidePushesAhead(ctx: EpoxyContext, slider: RuntimeEntity, nx: number, ny: number, dir: Direction): boolean {
  const w = ctx.world;
  if (!isInBounds(w, nx, ny)) return false;
  const ahead = getEntityAt(w, nx, ny);
  if (!ahead || ahead.kind !== 'block' || ahead.isSliding || !chainsInto(slider, ahead)) return false;
  const flagBefore = w.rejectedPushMovedBlocks;
  const countBefore = w.chainPushCount;
  const pushed = attemptPushBlock(ctx, ahead, dir, true, true, slider);
  w.rejectedPushMovedBlocks = flagBefore;
  if (pushed) w.chainPushCount = countBefore + 1;
  return pushed;
}

/**
 * CC2 engine: a block in the cell ahead whose step ends in this pass has ended it before the block behind moves (Lexy ends a step
 * at the start of the tic, ahead of the moves), whatever their order in the entity list: a block sunk in the water ahead has
 * filled it by then.
 */
function settleAheadEarly(ctx: EpoxyContext, x: number, y: number): void {
  const w = ctx.world;
  if (!isInBounds(w, x, y)) return;
  const ahead = getEntityAt(w, x, y);
  if (ahead === undefined || ahead.kind !== 'block' || ahead.arrivalTicks === undefined || ahead.arrivalTicks > 1) return;
  if (w.turnSpent.get(ahead.uid) === w.ccMonsterClock) return;
  delete ahead.arrivalTicks;
  w.turnSpent.set(ahead.uid, w.ccMonsterClock);
  settleBlockArrival(ctx, ahead, ahead.dir, true);
}

/** Advances one block of the entity loop by a tick: a block moves only while it slides. */
export function stepSlidingBlock(ctx: EpoxyContext, entity: RuntimeEntity): void {
  const w = ctx.world;
  // A block whose step already ended this pass (see settleAheadEarly) has had its turn.
  if (usesCc2Engine(w.level) && w.turnSpent.get(entity.uid) === w.ccMonsterClock) return;
  // A pushed CC3D block finishing its step: the cell acts on it when the step ends.
  if (entity.arrivalTicks !== undefined) {
    entity.arrivalTicks--;
    if (usesCc2Engine(w.level)) w.turnSpent.set(entity.uid, w.ccMonsterClock);
    if (entity.arrivalTicks <= 0) {
      delete entity.arrivalTicks;
      settleBlockArrival(ctx, entity, entity.dir, true);
    }
    return;
  }
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

  // A sliding block of the CC3D kind is refused by the player in its way, as by any other obstacle, and stops in front of him
  // (the native blocks keep crushing him). Cc3dSimulation.forceStep: a refused slide on ice ends (no bounce); on a force floor the block keeps its drift and tries again each tick, in the direction it took on arrival (as the CC3D drift).
  if (ConfigRegistry.getEntityDef(entity.type)?.stopsAtWall === true && playerAtCell(w, nx, ny) !== undefined) {
    if (tile.slideType !== 'force') entity.isSliding = false;
    return;
  }

  if (usesCc2Engine(w.level)) settleAheadEarly(ctx, nx, ny);
  if (!isCanBlockEnter(w, entity, nx, ny, slideDir) && slidePushesAhead(ctx, entity, nx, ny, slideDir)) {
    // The slide shoved the block ahead out of the way (CC2: a sliding block moves with the push rule).
    if (!w.player.alive) return;
  }

  // A sliding block of the CC3D kind crushes the monster in its way and goes on into its cell, wherever it could enter
  // the cell if the monster were not there (a pushed block is refused by a monster, so this is the slide only).
  const ahead = isInBounds(w, nx, ny) ? getEntityAt(w, nx, ny) : undefined;
  if (
    ahead !== undefined &&
    ahead.kind === 'monster' &&
    ConfigRegistry.getEntityDef(entity.type)?.crushesMonsters === true &&
    isCanBlockEnter(w, entity, nx, ny, slideDir, ahead)
  ) {
    removeEntity(w, ahead.uid);
    // A monster gone from a beam path changes the beams.
    w.beamDirty = true;
    AudioManager.playSfx('bomb');
    ctx.emitVisual('explosion', nx, ny);
    moveBlockTo(ctx, entity, nx, ny, slideDir);
    return;
  }

  if (isCanBlockEnter(w, entity, nx, ny, slideDir)) {
    // CC2 engine: a block sliding off ice or a force floor onto a plain cell takes a full step; that cell acts at its end.
    moveBlockTo(ctx, entity, nx, ny, slideDir, true, usesCc2Engine(w.level) && arrivesAtStepEnd(w, nx, ny));
    return;
  }
  // A slide that runs into an appearing wall any mover reveals shows it.
  const refusal: PushRefusal = {};
  noteBump(w, entity, nx, ny, slideDir, refusal);
  revealBump(w, refusal);
  // A CC3D block stops at what refuses it; the others bounce back the way they came.
  if (tile.slideType === 'ice' && ConfigRegistry.getEntityDef(entity.type)?.stopsAtWall !== true) {
    const bounceDir = OPPOSITE_DIRECTION[slideDir];
    const deflected = tile.cc3dCornerBounce === true ? bounceDir : tile.deflectionMap?.[bounceDir] || bounceDir;
    const bVec = DIRECTION_VECTORS[deflected];
    if (isCanBlockEnter(w, entity, entity.x + bVec.dx, entity.y + bVec.dy, deflected)) {
      moveBlockTo(ctx, entity, entity.x + bVec.dx, entity.y + bVec.dy, deflected);
    } else {
      entity.isSliding = false;
    }
  } else if (tile.slideType === 'force' && ConfigRegistry.getEntityDef(entity.type)?.stopsAtWall === true) {
    // Cc3dSimulation.forceStep: a refused step on a force floor keeps the drift, so the block tries again next tick.
  } else {
    entity.isSliding = false;
  }
}
