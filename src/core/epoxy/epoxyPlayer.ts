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
import { stepTerrainOf } from '../../audio/stepTerrain';
import { BLOCK_TARGET_TILE_ID, DEFAULT_PLAYER_CHARACTER, FLOOR_TILE_ID, OPPOSITE_DIRECTION, TOKEN_ITEM_ID, transmogrifiedCharacter } from '../coreConstants';
import { bootsPullBlocks } from '../RulesetFeatures';
import { Direction, PlayerState, TileDefinition } from '../types';
import { attemptPushBlock } from './epoxyBlocks';
import { bribeThief, foilBumpedWall, toggleTimerOnStep } from './epoxyCc2Items';
import { triggerButton } from './epoxyDevices';
import { forceCycleArrival } from './epoxyForceCycle';
import { wakeLurkersNearPlayer } from './epoxyLurkers';
import { absorbMonsterContact, shieldedFromContact, wardBootsHeld } from './epoxyWard';
import { killPlayerByShot, spendShotAt } from './epoxyShots';
import { steerMirrors } from './epoxyMirrors';
import { playerRailActor, railRedirect } from './epoxyRailsCc2';
import { enterSwivel, leaveSwivel } from './epoxySwivels';
import { teleportPlayer } from './epoxyTeleports';
import {
  EpoxyContext,
  EpoxyWorld,
  canPlayerEnter,
  entityPressesPlate,
  getEntityAt,
  holdsItem,
  isEdgeBlocked,
  isInBounds,
  dropExitedController,
  killPlayer,
  leaveCell,
  leaveThroughExit,
  notePulseArrival,
  playerAtCell,
  playerCharacterOf,
  playerGripsTile,
  shotAt,
  takeRevealedTerrain,
  withPlayer
} from './epoxyWorld';

/** Move cooldown after stepping onto a force floor, so the floor can carry the player. */
export const FORCE_FLOOR_MOVE_COOLDOWN_TICKS = 1;
/** Extra slide delay on force floors, on top of timing.slideCooldownTicks. */
const FORCE_SLIDE_EXTRA_COOLDOWN_TICKS = 1;

/** Whether the tile is a force floor that pushes the player, i.e. one the held boots do not cancel. */
export function isCarriedByForceFloor(w: EpoxyWorld, tile: TileDefinition, player: PlayerState = w.player): boolean {
  return tile.slideType === 'force' && (!tile.protectedByItem || !player.boots.has(tile.protectedByItem));
}

export function executePlayerMove(ctx: EpoxyContext, requestedDir: Direction, fromSlide: boolean): boolean {
  const moved = attemptPlayerStep(ctx, requestedDir, fromSlide);
  const w = ctx.world;
  // A controlled player that left through an exit is gone: the next one takes control and no mirror copies the exit step.
  if (dropExitedController(w)) return moved;
  // The mirror players copy the move the player attempted, a refused one too, a forced slide step included.
  // They copy the requested direction, before any track redirect of the player's own cell.
  // A parked player's forced steps (w.swappedIn set) are not copied: the mirrors follow the controlled player's moves.
  if (w.player.alive && !w.levelCompleted && w.player.exited !== true && w.swappedIn === null) steerMirrors(ctx, requestedDir);
  return moved;
}

/** The player's own step toward `requestedDir`: the track redirect, the checks of the cell ahead, the push of a block and the arrival. */
function attemptPlayerStep(ctx: EpoxyContext, requestedDir: Direction, fromSlide: boolean): boolean {
  const w = ctx.world;
  // On a Chip's Challenge 2 track cell a step the tracks refuse is turned onto the track (the identity elsewhere).
  const rail = playerRailActor(w);
  const dir = railRedirect(w, w.player.x, w.player.y, requestedDir, rail);
  w.player.dir = dir;
  const vec = DIRECTION_VECTORS[dir];
  const targetX = w.player.x + vec.dx;
  const targetY = w.player.y + vec.dy;

  if (!isInBounds(w, targetX, targetY)) {
    AudioManager.playSfx('blocked');
    return false;
  }

  if (isEdgeBlocked(w, w.player.x, w.player.y, targetX, targetY, dir, false, rail)) {
    if (!fromSlide) AudioManager.playSfx('blocked');
    return false;
  }

  // Another player standing in the cell ahead blocks the step, as a wall would.
  if (playerAtCell(w, targetX, targetY) !== undefined) {
    if (!fromSlide) AudioManager.playSfx('blocked');
    return false;
  }

  // A thrown stone still in the cell ahead is not walked into: the step is refused like a blocked one.
  if (w.shots.length > 0 && shotAt(w, targetX, targetY)?.payload !== undefined) {
    if (!fromSlide) AudioManager.playSfx('blocked');
    return false;
  }

  let targetTile = ConfigRegistry.getTile(w.terrain[targetY][targetX]);

  // A top that goes away under the step (a blue fake wall, dirt) shows what it hides before the step is
  // judged, so a wall or water under it is met as such instead of being walked into.
  if (targetTile.transformsToOnStep) {
    const hidden = takeRevealedTerrain(w, targetX, targetY);
    if (hidden !== null) {
      w.terrain[targetY][targetX] = hidden;
      w.gridMutatedByMove = true;
      targetTile = ConfigRegistry.getTile(hidden);
    }
  }

  if (targetTile.revealsToOnTouch) {
    w.terrain[targetY][targetX] = targetTile.revealsToOnTouch;
    w.gridMutatedByMove = true;
    AudioManager.playSfx('blocked');
    return false;
  }

  // True when opening the target shows terrain the level hid under it (see the entry pass below).
  let revealedUnder = false;

  if (targetTile.requiresAllChips) {
    if (w.chipsRemaining <= 0) {
      const revealed = takeRevealedTerrain(w, targetX, targetY);
      revealedUnder = revealed !== null;
      w.terrain[targetY][targetX] = revealed ?? (targetTile.transformsToOnUnlock || FLOOR_TILE_ID);
      w.gridMutatedByMove = true;
      AudioManager.playSfx('socket');
      ctx.emitVisual('unlock', targetX, targetY, 'yellow');
    } else {
      w.statusBannerKey = 'hud.messages.socket_locked';
      AudioManager.playSfx('blocked');
      return false;
    }
  }

  if (targetTile.requiredKey) {
    const keyCount = w.player.keys[targetTile.requiredKey] || 0;
    if (keyCount > 0) {
      if (targetTile.consumesKey) {
        w.player.keys[targetTile.requiredKey] = keyCount - 1;
      }
      const revealed = takeRevealedTerrain(w, targetX, targetY);
      revealedUnder = revealed !== null;
      w.terrain[targetY][targetX] = revealed ?? (targetTile.transformsToOnUnlock || FLOOR_TILE_ID);
      w.gridMutatedByMove = true;
      AudioManager.playSfx('door');
      ctx.emitVisual('unlock', targetX, targetY, targetTile.colorKey || 'yellow');
    } else {
      if (!fromSlide) AudioManager.playSfx('blocked');
      return false;
    }
  }

  // Entry pass: a socket the opening revealed is met in the same step. With no chip left it opens onto its
  // remains; with chips left the key is spent, the socket shows and the move is refused.
  if (revealedUnder) {
    const shown = ConfigRegistry.getTile(w.terrain[targetY][targetX]);
    if (shown.requiresAllChips) {
      if (w.chipsRemaining <= 0) {
        w.terrain[targetY][targetX] = shown.transformsToOnUnlock || FLOOR_TILE_ID;
        AudioManager.playSfx('socket');
        ctx.emitVisual('unlock', targetX, targetY, 'yellow');
      } else {
        w.statusBannerKey = 'hud.messages.socket_locked';
        AudioManager.playSfx('blocked');
        return false;
      }
    }
  }

  const updatedTargetTile = ConfigRegistry.getTile(w.terrain[targetY][targetX]);
  const itemOnTarget = w.items[targetY][targetX];
  if (!canPlayerEnter(w, updatedTargetTile, itemOnTarget)) {
    // Bumping a plain wall with the steel foil turns it into a steel wall; the step is refused all the same.
    foilBumpedWall(w, targetX, targetY);
    // A barrier against an item the player carries (terrain, or a no-sign on the item layer): solid until the item is dropped elsewhere.
    const signedItem =
      updatedTargetTile.forbiddenItem ?? (itemOnTarget !== null ? ConfigRegistry.getTile(itemOnTarget).forbiddenItem : undefined);
    if (updatedTargetTile.passableByPlayer && signedItem !== undefined && holdsItem(w, signedItem)) {
      w.statusBannerKey = 'hud.messages.forbidden_item';
    } else if (updatedTargetTile.bootsForCharacter?.[playerCharacterOf(w)] !== undefined) {
      w.statusBannerKey = 'hud.messages.needs_hiking_boots';
    }
    if (!fromSlide) AudioManager.playSfx('blocked');
    return false;
  }

  let entityAtTarget = getEntityAt(w, targetX, targetY);
  let wardSpent = false;
  // A helmet shields from monster contact and the monster keeps its cell: the player is simply blocked.
  if (entityAtTarget?.kind === 'monster' && shieldedFromContact(w.player)) {
    if (!fromSlide) AudioManager.playSfx('blocked');
    return false;
  }
  // A ward destroys the first monster the player runs into; the player walks on into the empty cell.
  if (entityAtTarget?.kind === 'monster' && absorbMonsterContact(w, entityAtTarget.uid)) {
    wardSpent = true;
    entityAtTarget = undefined;
  }
  if (entityAtTarget) {
    if (entityAtTarget.kind === 'block') {
      // Pushing a block while leaving a CC2 swivel door through a closed side: the push resolves first, then the door
      // turns as the player steps off. Likely what CC2 does, but not verified against the game.
      const pushed = attemptPushBlock(ctx, entityAtTarget, dir);
      if (!pushed) {
        if (!fromSlide) AudioManager.playSfx('blocked');
        return false;
      }
    } else if (entityAtTarget.kind === 'monster') {
      leaveSwivel(w, w.player.x, w.player.y, dir);
      leaveCell(w, w.player.x, w.player.y);
      w.player.x = targetX;
      w.player.y = targetY;
      killPlayer(ctx, 'hud.messages.death_monster', 'death');
      return true;
    }
  }

  const prevX = w.player.x;
  const prevY = w.player.y;
  const hadPullBoots = bootsPullBlocks(w.player.boots);
  leaveSwivel(w, w.player.x, w.player.y, dir);
  leaveCell(w, w.player.x, w.player.y);
  w.player.x = targetX;
  w.player.y = targetY;
  w.statusBannerKey = wardSpent ? 'hud.messages.ward_spent' : null;

  if (!fromSlide) {
    AudioManager.playStep(stepTerrainOf(ConfigRegistry.getTile(w.terrain[targetY][targetX]), w.player.boots));
  }

  resolvePlayerArrival(ctx, dir, true);
  // The arrival is settled (a teleport included): a lurker asleep next to the player wakes.
  if (w.player.alive && !w.levelCompleted && w.player.exited !== true) wakeLurkersNearPlayer(w);

  if (
    !fromSlide &&
    !entityAtTarget &&
    !updatedTargetTile.isTeleporter &&
    w.player.alive &&
    !w.levelCompleted &&
    w.player.exited !== true &&
    hadPullBoots &&
    bootsPullBlocks(w.player.boots)
  ) {
    const behindX = prevX - vec.dx;
    const behindY = prevY - vec.dy;
    const blockBehind = getEntityAt(w, behindX, behindY);
    if (blockBehind && blockBehind.kind === 'block' && !blockBehind.isSliding) {
      const behindTileId = w.terrain[behindY]?.[behindX];
      const behindTile = ConfigRegistry.getTile(behindTileId);
      const lockedOnPlate =
        (behindTile.plateColor !== undefined && entityPressesPlate(blockBehind.type, 'block', behindTile.plateColor)) ||
        behindTile.signalSource === 'held' ||
        behindTile.buttonAction === 'hold_trap' ||
        behindTileId === BLOCK_TARGET_TILE_ID;
      if (!lockedOnPlate) {
        attemptPushBlock(ctx, blockBehind, dir, false);
      }
    }
  }
  return true;
}

/** Spends one held toll token; false when the player holds none. */
function spendTollToken(w: EpoxyWorld): boolean {
  const held = w.player.keys[TOKEN_ITEM_ID] || 0;
  if (held <= 0) return false;
  if (held === 1) delete w.player.keys[TOKEN_ITEM_ID];
  else w.player.keys[TOKEN_ITEM_ID] = held - 1;
  return true;
}

/**
 * Applies the effects of the cell the player just entered. A teleporter is
 * resolved first: the player jumps, then the arrival cell (items, thief,
 * buttons, hazards, exit) is resolved at the destination coordinates.
 */
function resolvePlayerArrival(ctx: EpoxyContext, entryDir: Direction, allowTeleport: boolean): void {
  const w = ctx.world;
  const x = w.player.x;
  const y = w.player.y;
  let tile = ConfigRegistry.getTile(w.terrain[y][x]);
  enterSwivel(w, x, y, entryDir);

  // Running into a flying shot kills the player and spends the shot; a teleport lands here again for its exit cell.
  const hitBy = w.shots.length > 0 ? spendShotAt(w, x, y) : undefined;
  if (hitBy) {
    killPlayerByShot(ctx, hitBy.payload);
    return;
  }

  if (tile.isTeleporter && allowTeleport) {
    ctx.emitVisual('teleport', x, y);
    if (teleportPlayer(w, x, y, entryDir)) {
      ctx.emitVisual('teleport', w.player.x, w.player.y);
      resolvePlayerArrival(ctx, w.player.dir, false);
      return;
    }
  }

  if (tile.transformsToOnStep) {
    w.terrain[y][x] = tile.transformsToOnStep;
    tile = ConfigRegistry.getTile(w.terrain[y][x]);
  }

  // A transmogrifier turns the player into the other character on arrival (Lexy's Labyrinth tiletypes.js `transmogrifier`).
  if (tile.transmogrifies) {
    const switched = transmogrifiedCharacter(playerCharacterOf(w));
    // With one player the character stays unwritten while it is the level's, so state shapes stay canonical after a round trip.
    if ((w.level.extraPlayers?.length ?? 0) === 0 && switched === (w.level.character ?? DEFAULT_PLAYER_CHARACTER)) delete w.player.character;
    else w.player.character = switched;
  }

  const itemId = w.items[y][x];
  if (itemId) {
    const itemDef = ConfigRegistry.getTile(itemId);
    if (itemDef.togglesTimer) toggleTimerOnStep(w);
    if (itemDef.hazard === 'bomb') {
      w.items[y][x] = null;
      ctx.emitVisual('explosion', x, y, 'red');
      killPlayer(ctx, 'hud.messages.death_bomb', 'bomb');
      return;
    }
    if (itemDef.collectible === 'chip') {
      w.items[y][x] = null;
      if (itemDef.countsAsChip !== false) w.chipsRemaining = Math.max(0, w.chipsRemaining - 1);
      AudioManager.playSfx('chip');
      ctx.emitVisual('chip', x, y, 'green');
    } else if (itemDef.collectible === 'key' || itemDef.collectible === 'charge' || itemDef.collectible === 'gate' || itemDef.collectible === 'stone' || itemDef.collectible === 'token') {
      w.items[y][x] = null;
      w.player.keys[itemId] = (w.player.keys[itemId] || 0) + 1;
      AudioManager.playSfx('item');
      ctx.emitVisual('item', x, y, itemDef.colorKey || 'yellow');
    } else if (itemDef.collectible === 'boot' && itemDef.absorbsMonsterContact && wardBootsHeld(w.player.boots) !== undefined) {
      // A second ward stays on the floor while one is worn.
    } else if (itemDef.collectible === 'boot') {
      w.items[y][x] = null;
      w.player.boots.add(itemId);
      AudioManager.playSfx('item');
      ctx.emitVisual('item', x, y, 'blue');
    } else if (itemDef.collectible === 'bonus') {
      w.items[y][x] = null;
      collectBonus(w, itemDef);
      AudioManager.playSfx('item');
      ctx.emitVisual('item', x, y, itemDef.colorKey || 'yellow');
    }
  }

  // Only keys are stolen: a blast charge, a pocket gate, a hurl stone or a toll token stays in the pocket.
  const isKey = (id: string): boolean => ConfigRegistry.getTile(id).collectible === 'key';
  const takesBoots = tile.stealsBoots === true && w.player.boots.size > 0;
  const takesKeys = tile.stealsKeys === true && Object.entries(w.player.keys).some(([id, count]) => count > 0 && isKey(id));
  if (bribeThief(w, tile)) {
    // A bribe pays any thief visit, even one with nothing to take: the thief takes nothing.
  } else if ((takesBoots || takesKeys) && spendTollToken(w)) {
    // One token pays for the whole visit: the thief takes nothing.
    w.statusBannerKey = 'hud.messages.thief_paid';
    AudioManager.playSfx('item');
  } else {
    if (takesBoots) {
      w.player.boots.clear();
      w.statusBannerKey = 'hud.messages.thief_stole';
      AudioManager.playSfx('thief');
    }
    if (takesKeys) {
      w.player.keys = Object.fromEntries(Object.entries(w.player.keys).filter(([id]) => !isKey(id)));
      w.statusBannerKey = 'hud.messages.thief_stole_keys';
      AudioManager.playSfx('thief');
    }
  }

  notePulseArrival(w, x, y, null);

  if (tile.buttonAction) {
    triggerButton(ctx, x, y, tile.buttonAction);
    if (!w.player.alive) return;
  }

  w.player.inWater = tile.hazard === 'water';
  if (tile.hazard === 'water' && (!tile.protectedByItem || !w.player.boots.has(tile.protectedByItem))) {
    ctx.emitVisual('splash', x, y);
    killPlayer(ctx, 'hud.messages.death_water', 'death');
    return;
  }
  if (tile.hazard === 'fire' && (!tile.protectedByItem || !w.player.boots.has(tile.protectedByItem))) {
    ctx.emitVisual('explosion', x, y);
    killPlayer(ctx, 'hud.messages.death_fire', 'burn');
    return;
  }

  if (tile.hazard === 'slime' && (!tile.protectedByItem || !w.player.boots.has(tile.protectedByItem))) {
    ctx.emitVisual('splash', x, y, 'green');
    killPlayer(ctx, 'hud.messages.death_slime', 'death');
    return;
  }

  if (tile.isLevelExit) {
    ctx.emitVisual('win', x, y);
    // Lexy's Labyrinth exit.on_arrive: the level is won when no player remains; otherwise this one leaves play.
    if (leaveThroughExit(w)) ctx.completeLevel();
    return;
  }

  evaluatePlayerSliding(w, tile, entryDir);
}

/**
 * Applies a picked up bonus item: flag points join the level score paid at
 * the exit (where the multiplier applies to them too), a multiplier raises
 * that score, and a stopwatch moves the time left (an untimed level stays
 * untimed).
 */
function collectBonus(w: EpoxyWorld, itemDef: TileDefinition): void {
  if (itemDef.scoreBonus) {
    w.levelBonusPoints += itemDef.scoreBonus;
    w.statusBannerKey = 'hud.messages.score_bonus_picked';
  }
  if (itemDef.scoreMultiplier) {
    w.levelScoreMultiplier *= itemDef.scoreMultiplier;
    w.statusBannerKey = 'hud.messages.score_multiplier_picked';
  }
  if (itemDef.timeBonusSeconds) {
    if (w.level.timeLimitSeconds > 0) {
      w.extraTimeSeconds += itemDef.timeBonusSeconds;
    }
    w.statusBannerKey =
      itemDef.timeBonusSeconds > 0 ? 'hud.messages.time_bonus_picked' : 'hud.messages.time_penalty_picked';
  }
}

function evaluatePlayerSliding(w: EpoxyWorld, tile: ReturnType<typeof ConfigRegistry.getTile>, entryDir: Direction): void {
  if (tile.slideType === 'ice') {
    if (playerGripsTile(w, tile)) {
      w.player.isSliding = false;
      w.player.slideDir = null;
      return;
    }
    const nextDir = tile.deflectionMap?.[entryDir] || entryDir;
    w.player.isSliding = true;
    w.player.slideDir = nextDir;
    w.player.dir = nextDir;
    w.player.slideCooldown = ConfigRegistry.getGame().timing.slideCooldownTicks;
    return;
  }

  if (tile.slideType === 'force') {
    // The arrival counts on the shared turn even when boots protect the player from the push.
    const cycleDir = forceCycleArrival(w, tile);
    if (tile.protectedByItem && w.player.boots.has(tile.protectedByItem)) {
      w.player.isSliding = false;
      w.player.slideDir = null;
      return;
    }
    let forceDir: Direction = entryDir;
    if (tile.forceDirection === 'RANDOM') {
      forceDir = ORDERED_DIRECTIONS[w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)];
    } else if (cycleDir) {
      forceDir = cycleDir;
    } else if (tile.forceDirection) {
      forceDir = tile.forceDirection;
    }
    w.player.isSliding = true;
    w.player.slideDir = forceDir;
    w.player.dir = forceDir;
    w.player.slideCooldown =
      ConfigRegistry.getGame().timing.slideCooldownTicks + FORCE_SLIDE_EXTRA_COOLDOWN_TICKS;
    return;
  }

  w.player.isSliding = false;
  w.player.slideDir = null;
}

/**
 * One tick of every parked player, in swap order: the cooldowns run down and a forced move (ice, force floor) goes
 * on, through the controlled player's own code with the parked player standing in for it. A parked player takes
 * no voluntary move. Stops when a player died or the level was won.
 */
export function tickParkedPlayers(ctx: EpoxyContext): void {
  const w = ctx.world;
  for (const parked of [...w.parked]) {
    if (!w.player.alive || w.levelCompleted) return;
    withPlayer(w, parked, () => {
      if (w.player.moveCooldown > 0) w.player.moveCooldown--;
      if (!w.player.isSliding) return;
      if (w.player.slideCooldown > 0) w.player.slideCooldown--;
      else processPlayerSlideStep(ctx);
    });
  }
}

export function processPlayerSlideStep(ctx: EpoxyContext): void {
  const w = ctx.world;
  const dir = w.player.slideDir || w.player.dir;
  const currentTile = ConfigRegistry.getTile(w.terrain[w.player.y][w.player.x]);

  const moved = executePlayerMove(ctx, dir, true);
  if (!moved) {
    if (currentTile.slideType === 'ice') {
      const bounceDir = OPPOSITE_DIRECTION[dir];
      const deflectedBounce = currentTile.deflectionMap?.[bounceDir] || bounceDir;
      w.player.slideDir = deflectedBounce;
      w.player.dir = deflectedBounce;
      const bouncedMoved = executePlayerMove(ctx, deflectedBounce, true);
      if (!bouncedMoved) {
        w.player.isSliding = false;
        w.player.slideDir = null;
      }
    } else {
      w.player.isSliding = false;
      w.player.slideDir = null;
    }
  }
  ctx.checkTargetsWin();
}
