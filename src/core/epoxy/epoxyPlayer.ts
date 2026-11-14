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
import { CC2_SLAP_REVEALED_TILE_IDS, DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { AudioManager } from '../../audio/AudioManager';
import { stepTerrainOf } from '../../audio/stepTerrain';
import { BLOCK_TARGET_TILE_ID, BRIBE_ITEM_ID, CC2_TOOL_BELT_CAPACITY, CC3D_SLIDE_END_WAIT_TICKS, CC3D_TELEPORT_LANDING_WAIT_TICKS, CC3D_SLIDE_ENTRY_COOLDOWN_TICKS, CC3D_SLIDE_STEP_COOLDOWN_TICKS, CC_FORCE_SLIDE_COOLDOWN_TICKS, CC_ICE_SLIDE_COOLDOWN_TICKS, CC_TELEPORT_SLIDE_WAIT_TICKS, DEFAULT_PLAYER_CHARACTER, FLOOR_TILE_ID, OPPOSITE_DIRECTION, STONE_DEATH_REASON_KEY, TOKEN_ITEM_ID, transmogrifiedCharacter } from '../coreConstants';
import { usesCc2Engine } from './ccRules';
import { bootsPullBlocks } from '../RulesetFeatures';
import { Cc2PlayerView, Cc3dPlayerArrival, Direction, PlayerState, TileDefinition } from '../types';
import { STEP_TICKS } from '../cc3d/cc3dConstants';
import { attemptPushBlock, isCc3dPush, splashBarsPlayer } from './epoxyBlocks';
import { bribeThief, foilBumpedWall, toggleTimerOnStep } from './epoxyCc2Items';
import { triggerButton } from './epoxyDevices';
import { forceCycleArrival } from './epoxyForceCycle';
import { wakeLurkersNearPlayer } from './epoxyLurkers';
import { absorbMonsterContact, shieldedFromContact, wardBootsHeld } from './epoxyWard';
import { killPlayerByShot, spendShotAt } from './epoxyShots';
import { hasCc2MirrorCadence, rememberPlayerMove, steerMirrors } from './epoxyMirrors';
import { isHeldSignalButton } from './epoxySignals';
import { playerRailActor, railRedirect } from './epoxyRailsCc2';
import { droppedActorId, explodeRollingBall, isRollingBall, launchRollingBall } from './epoxyRollingBall';
import { setDownDynamite } from './epoxyDynamite';
import { enterSwivel, leaveSwivel } from './epoxySwivels';
import { teleportPlayer } from './epoxyTeleports';
import {
  EpoxyContext,
  EpoxyWorld,
  canPlayerEnter,
  entityPressesPlate,
  getEntityAt,
  holdsItem,
  isCovered,
  isEdgeBlocked,
  isInBounds,
  dropExitedController,
  killPlayer,
  mapWidth,
  leaveCell,
  leaveThroughExit,
  notePulseArrival,
  playerAtCell,
  playerCharacterOf,
  playerGripsTile,
  playerHaste,
  shotAt,
  takeRevealedTerrain,
  withPlayer
} from './epoxyWorld';

/** Move cooldown after stepping onto a force floor, so the floor can carry the player. */
export const FORCE_FLOOR_MOVE_COOLDOWN_TICKS = 1;
/** Extra slide delay on force floors, on top of timing.slideCooldownTicks. */
const FORCE_SLIDE_EXTRA_COOLDOWN_TICKS = 1;

/** CC2 engine: extra slide ticks a voluntary step onto ice or a force floor lasts (the step takes the time of the tile it enters). */
export const CC2_SLIDE_ENTRY_EXTRA_TICKS = 1;
/** CC2 engine: move cooldown after a voluntary step onto a force floor. */
export const CC2_FORCE_ENTRY_MOVE_COOLDOWN_TICKS = 2;
/** CC2 engine: least move cooldown after a slide step that goes on sliding. */
export const CC2_SLIDING_STEP_MOVE_COOLDOWN_TICKS = 1;
/** CC2 engine: ticks a slide that ends on plain floor waits less than a walking step (the last slide step is an in-tick move). */
export const CC2_SLIDE_END_WAIT_REDUCTION_TICKS = 1;

/** CC2 engine: ticks the step that leaves a soft pad lasts less, since the forced exit is taken a tick after the wait. */
const CC2_SOFT_PAD_EXIT_WAIT_REDUCTION_TICKS = 1;

/** Shortest wait between two voluntary moves, whatever the haste. */
const MIN_WALK_COOLDOWN_TICKS = 1;

/** Whether the tile is a force floor that pushes the player, i.e. one the held boots do not cancel. */
export function isCarriedByForceFloor(w: EpoxyWorld, tile: TileDefinition, player: PlayerState = w.player): boolean {
  return tile.slideType === 'force' && (!tile.protectedByItem || !player.boots.has(tile.protectedByItem));
}

/**
 * Classic rules: the player's permission to choose his direction on a force floor follows his step attempts. A carried
 * attempt from a force floor grants it, his own attempt from a force floor or from a floor that is neither force nor
 * ice (or ice he grips) takes it away, and an attempt from ice he slides on leaves it as it was. Boots that cancel the push
 * leave it alone, since the floor does not carry him.
 */
function updateForcePermission(w: EpoxyWorld, fromSlide: boolean): void {
  const tile = ConfigRegistry.getTile(w.terrain[w.player.y][w.player.x]);
  if (tile.slideType === 'force') {
    if (!isCarriedByForceFloor(w, tile)) return;
    w.player.forcePermission = fromSlide;
  } else if (tile.slideType !== 'ice' || playerGripsTile(w, tile)) {
    w.player.forcePermission = false;
  }
}

/**
 * Classic rules: a player resting on a force floor that carries him (his push blocked, or the level started there) is
 * set sliding again, so the floor makes its carried attempt this tick, as it does every tick in the original game.
 * That attempt grants him the choice of direction even when the push is blocked. The random floor draws its direction
 * from the world generator and the cycling floor takes the next turn of the shared cycle, as a slide arrival does.
 */
export function resumeForceCarry(w: EpoxyWorld): void {
  if (w.player.isSliding || !w.player.alive) return;
  const tile = ConfigRegistry.getTile(w.terrain[w.player.y][w.player.x]);
  if (!isCarriedByForceFloor(w, tile)) return;
  if (w.cc3dPace && (tile.forceDirection === 'RANDOM' || tile.forceCycle === true)) {
    // A converted CC3D level: the drift is drawn on arrival and kept, and the forced step is tried again every tick.
    if (w.player.slideDir === null) return;
    w.player.isSliding = true;
    w.player.dir = w.player.slideDir;
    w.player.slideCooldown = 0;
    return;
  }
  if (tile.forceDirection === 'RANDOM' || tile.forceCycle === true) {
    evaluatePlayerSliding(w, tile, w.player.dir);
    w.player.slideCooldown = 0;
    return;
  }
  if (!tile.forceDirection) return;
  w.player.isSliding = true;
  w.player.slideDir = tile.forceDirection;
  w.player.dir = tile.forceDirection;
  w.player.slideCooldown = 0;
}

export function executePlayerMove(ctx: EpoxyContext, requestedDir: Direction, fromSlide: boolean): boolean {
  const w = ctx.world;
  if (w.ccRules) updateForcePermission(w, fromSlide);
  const moved = attemptPlayerStep(ctx, requestedDir, fromSlide);
  // The step onto an exit lasts the leaver's walking step (read before control changes hands).
  const leaverWait = playerWalkCooldown(w);
  // A controlled player that left through an exit is gone: the next one takes control and no mirror copies the exit step.
  if (dropExitedController(w)) {
    // CC2 engine: the exit acts when the step onto it ends, so the next player takes control one walking step later.
    if (exitHandsControlLater(w)) w.player.moveCooldown = Math.max(w.player.moveCooldown, leaverWait);
    resetCc2PlayerView(w);
    return moved;
  }
  // The mirror players copy the move the player attempted, a refused one too, a forced slide step included.
  // They copy the requested direction, before any track redirect of the player's own cell.
  // A parked player's forced steps (w.swappedIn set) are not copied: the mirrors follow the controlled player's moves.
  // A two-key move steers the mirrors once with its decision (steerMirrorsOnce), not once per attempt.
  if (!w.mirrorsHeldBack) steerMirrorsOnce(ctx, requestedDir);
  return moved;
}

/** CC2 engine: whether the player who takes control after an exit waits out the exit step (Lexy tiletypes.js exit on_arrive, game.js:1377-1420). */
function exitHandsControlLater(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace && !w.levelCompleted;
}

/** Steers the mirror players toward `dir` when the controlled player is still on the map and not parked: the one copy of a step. */
export function steerMirrorsOnce(ctx: EpoxyContext, dir: Direction): void {
  const w = ctx.world;
  // CC2 engine: the mirrors are actors with their own cadence; they read the move the player decided (Lexy
  // remember_player_move), a blocked try included, at their own pace.
  if (hasCc2MirrorCadence(w)) {
    if (w.swappedIn === null) rememberPlayerMove(w, dir);
    return;
  }
  if (w.player.alive && !w.levelCompleted && w.player.exited !== true && w.swappedIn === null) steerMirrors(ctx, dir);
}

/** What a slap shows of the cell it bumps: a listed fake wall turns to what it hides (floor), an appearing wall to its wall. */
function bumpRevealedCell(w: EpoxyWorld, x: number, y: number): boolean {
  const tile = ConfigRegistry.getTile(w.terrain[y][x]);
  if (tile.revealsToOnTouch !== undefined) {
    w.terrain[y][x] = tile.revealsToOnTouch;
    w.gridMutatedByMove = true;
    return true;
  }
  if (tile.transformsToOnStep !== undefined && CC2_SLAP_REVEALED_TILE_IDS.includes(tile.id)) {
    w.terrain[y][x] = takeRevealedTerrain(w, x, y) ?? tile.transformsToOnStep;
    w.gridMutatedByMove = true;
    return true;
  }
  return false;
}

/**
 * CC2 engine, actor order (wave 9): the player's early push at his decision, for each key in the order he reads them.
 * `movingAtDecision` receives the uids of the blocks that were in motion when he decided (the step at his place must not
 * push them). Declared by the interface batch; the rule is written by the player batch. Does nothing yet.
 */
export function decisionPush(ctx: EpoxyContext, dirs: readonly Direction[], movingAtDecision: Set<number>): void {
  void ctx;
  void dirs;
  void movingAtDecision;
}

/**
 * The block slap of the CC2 engine: with two direction keys held the player pushes the block next to him toward each of
 * them before he chooses, without moving. Refused while he slides or waits out a step, and across whatever would refuse
 * the step itself (a thin wall, the map edge, a splash); on a track cell the push follows the track redirect. His facing
 * is left as it was. The slap bumps the cell as a step would: a blue real wall or an appearing wall shows as a wall, a
 * blue fake wall shows as floor, and an invisible wall does not change. True when a block was pushed or a cell changed.
 */
export function slapBlockAhead(ctx: EpoxyContext, requestedDir: Direction): boolean {
  const w = ctx.world;
  const p = w.player;
  if (!p.alive || w.levelCompleted || p.isSliding || p.moveCooldown > 0) return false;
  const facing = p.dir;
  const rail = playerRailActor(w);
  const dir = railRedirect(w, p.x, p.y, requestedDir, rail);
  const vec = DIRECTION_VECTORS[dir];
  const targetX = p.x + vec.dx;
  const targetY = p.y + vec.dy;
  if (!isInBounds(w, targetX, targetY)) return false;
  if (isEdgeBlocked(w, p.x, p.y, targetX, targetY, dir, false, rail)) return false;
  if (splashBarsPlayer(w, targetX, targetY)) return false;
  const bumped = bumpRevealedCell(w, targetX, targetY);
  const block = getEntityAt(w, targetX, targetY);
  if (block === undefined || block.kind !== 'block') return bumped;
  // CC2 engine: the block on a clone machine is its template, held by the machine: the slap does not move it (Lexy cloner.traps).
  if (usesCc2Engine(w.level) && ConfigRegistry.getTile(w.terrain[targetY][targetX]).isCloneMachine) return bumped;
  const pushed = attemptPushBlock(ctx, block, dir, true, false, undefined, true);
  p.dir = facing;
  return pushed || bumped;
}

/** CC2 engine: whether a lit (not merely set down) dynamite stands on (x, y), which bars the player from entering it. */
function litDynamiteBars(w: EpoxyWorld, x: number, y: number): boolean {
  if (!usesCc2Engine(w.level) || w.cc3dPace || w.litCharges.length === 0) return false;
  return w.litCharges.some((charge) => charge.dynamite === true && charge.awaitingDeparture !== true && charge.x === x && charge.y === y);
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
    if (!fromSlide) AudioManager.playSfx('blocked');
    return false;
  }

  if (isEdgeBlocked(w, w.player.x, w.player.y, targetX, targetY, dir, false, rail)) {
    if (!fromSlide) AudioManager.playSfx('blocked');
    return false;
  }

  // CC2 engine: the splash a block left in the water bars the real player from its cell while it lasts.
  if (splashBarsPlayer(w, targetX, targetY)) {
    if (!fromSlide) AudioManager.playSfx('blocked');
    return false;
  }

  // CC2 engine: lit dynamite is an actor that bars the player from its cell (Lexy tiletypes.js dynamite_lit blocks_collision).
  if (litDynamiteBars(w, targetX, targetY)) {
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
  // True when this step opened a socket or a door (CC2 engine: the cell stays closed to monsters until the step ends).
  let opensTarget = false;

  if (targetTile.requiresAllChips) {
    if (w.chipsRemaining <= 0) {
      const revealed = takeRevealedTerrain(w, targetX, targetY);
      revealedUnder = revealed !== null;
      w.terrain[targetY][targetX] = revealed ?? (targetTile.transformsToOnUnlock || FLOOR_TILE_ID);
      w.gridMutatedByMove = true;
      opensTarget = true;
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
      if (spendsKeyOn(w, targetTile)) {
        w.player.keys[targetTile.requiredKey] = keyCount - 1;
      }
      const revealed = takeRevealedTerrain(w, targetX, targetY);
      revealedUnder = revealed !== null;
      w.terrain[targetY][targetX] = revealed ?? (targetTile.transformsToOnUnlock || FLOOR_TILE_ID);
      w.gridMutatedByMove = true;
      opensTarget = true;
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
  // A helmet shields from monster contact and the monster keeps its cell: the player is simply blocked (a rolling ball kills through it).
  const killsShielded = entityAtTarget !== undefined && ConfigRegistry.getEntityDef(entityAtTarget.type)?.killsShieldedPlayer === true;
  if (entityAtTarget?.kind === 'monster' && shieldedFromContact(w.player) && !killsShielded) {
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
      const pushed = attemptPushBlock(ctx, entityAtTarget, dir, true, false, undefined, true);
      if (!pushed) {
        if (!fromSlide) AudioManager.playSfx('blocked');
        return false;
      }
      // The push may have pressed a button that changed the cell (a toggle wall closing): judge the cell again, and stay
      // put when it no longer lets the player in. The block stays where the push left it, so the bump keeps its undo step.
      // A CC3D block is the exception: the player's step was planned before the push, and the cell the block leaves acts
      // on its own as the step goes on (Cc3dSimulation.tryStep), so he is judged on the cell as it stood when the step
      // began (the character signs, boots and no-signs that bar him still do) and enters whatever it has become.
      const cc3dStep = isCc3dPush(entityAtTarget);
      if (
        !canPlayerEnter(
          w,
          cc3dStep ? updatedTargetTile : ConfigRegistry.getTile(w.terrain[targetY][targetX]),
          cc3dStep ? itemOnTarget : w.items[targetY][targetX]
        )
      ) {
        w.rejectedPushMovedBlocks = true;
        if (!fromSlide) AudioManager.playSfx('blocked');
        return false;
      }
    } else if (entityAtTarget.kind === 'monster') {
      // CC3D: the player who walks into a monster dies where he stands (Cc3dSimulation.tryStep), he does not enter its cell.
      if (w.cc3dPace) {
        killPlayer(ctx, 'hud.messages.death_monster', 'death');
        return true;
      }
      leaveSwivel(w, w.player.x, w.player.y, dir);
      leaveCell(w, w.player.x, w.player.y, { leavingPlayer: w.player });
      w.player.x = targetX;
      w.player.y = targetY;
      killPlayer(ctx, killsShielded ? STONE_DEATH_REASON_KEY : 'hud.messages.death_monster', 'death');
      // A rolling ball that a player walks into blows up with him (Lexy rolling_ball.on_bumped), helmet or not.
      if (isRollingBall(entityAtTarget)) explodeRollingBall(ctx, entityAtTarget);
      return true;
    }
  }

  const prevX = w.player.x;
  const prevY = w.player.y;
  const hadPullBoots = bootsPullBlocks(w.player.boots);
  leaveSwivel(w, w.player.x, w.player.y, dir);
  leaveCell(w, w.player.x, w.player.y, { leavingPlayer: w.player });
  w.player.x = targetX;
  w.player.y = targetY;
  w.statusBannerKey = wardSpent ? 'hud.messages.ward_spent' : null;
  // CC2 engine: the socket or door he opened goes when his step ends (Lexy on_arrive), so until then monsters find it shut.
  // Set only now that the step went through; applyCc3dStepEnd clears it.
  if (opensTarget && usesCc2Engine(w.level) && !w.cc3dPace) cc3dArrivalOf(w.player).opening = { x: targetX, y: targetY };

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
    !updatedTargetTile.teleportsToSelf &&
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
        isHeldSignalButton(behindTile) ||
        behindTileId === BLOCK_TARGET_TILE_ID;
      if (!lockedOnPlate) {
        attemptPushBlock(ctx, blockBehind, dir, false);
      }
    }
  }
  return true;
}

/**
 * Whether the step through a door spends the key. On a CC2-engine level each character has a key it never spends
 * (cc2Characters.keptKeyByCharacter: Chip's green, Melinda's yellow; Lexy tiletypes.js infinite_items) and spends every other
 * one; elsewhere the door's own consumesKey decides.
 */
function spendsKeyOn(w: EpoxyWorld, door: TileDefinition): boolean {
  const kept = usesCc2Engine(w.level) ? ConfigRegistry.getGame().cc2Characters?.keptKeyByCharacter[playerCharacterOf(w)] : undefined;
  return kept !== undefined ? door.requiredKey !== kept : door.consumesKey === true;
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
 * CC2 engine: whether the player's tools are kept on a four-tool belt (Lexy game.js:3237-3275). A level that asks for the CC1
 * boot rules (OPTN byte 23, Cc2LevelData.useCc1Boots) keeps the classic boots and no belt.
 */
export function usesToolBelt(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace && w.level.cc2?.useCc1Boots !== true;
}

/**
 * Whether the item is a tool of the belt: boots and the counted items that are not keys (dynamite, pads, stones) and the bribe
 * (a tool of Lexy's Labyrinth, tiletypes.js bribe, put down like any other). The toll token is Epoxy's own: it is never set down
 * and so never sits on the belt, where it would block every drop behind it.
 */
export function isBeltTool(def: TileDefinition): boolean {
  return def.collectible === 'boot' || def.collectible === 'charge' || def.collectible === 'gate' || def.collectible === 'stone' || def.id === BRIBE_ITEM_ID;
}

/**
 * Boots the player cannot hold twice (the boots are a set) or a second ward: the pickup is the plain one and never pushes
 * a tool off the belt.
 */
function isRedundantBootPickup(w: EpoxyWorld, itemId: string, def: TileDefinition): boolean {
  if (def.collectible !== 'boot') return false;
  return w.player.boots.has(itemId) || (def.absorbsMonsterContact === true && wardBootsHeld(w.player.boots) !== undefined);
}

/**
 * Brings the belt of `p` in line with what he holds and returns it: tools that left (put down, spent, stolen) are dropped
 * from it, tools that arrived by another route join at the end. The array, duplicates included, is the order of the belt.
 */
export function syncToolBelt(p: PlayerState): string[] {
  const belt = toolBeltOf(p);
  if (belt.length > 0) p.belt = belt;
  else delete p.belt;
  return belt;
}

/** The belt of `p` as syncToolBelt would settle it, without touching the player: a pure read. */
export function toolBeltOf(p: PlayerState): string[] {
  const held: string[] = [...p.boots];
  for (const [id, count] of Object.entries(p.keys)) {
    if (!isBeltTool(ConfigRegistry.getTile(id))) continue;
    for (let i = 0; i < count; i++) held.push(id);
  }
  const belt: string[] = [];
  for (const id of p.belt ?? []) {
    const at = held.indexOf(id);
    if (at < 0) continue;
    belt.push(id);
    held.splice(at, 1);
  }
  belt.push(...held);
  return belt;
}

/** Takes one `itemId` out of what the player holds (boots or a counted tool). */
function removeHeldTool(p: PlayerState, itemId: string, def: TileDefinition): void {
  if (def.collectible === 'boot') {
    p.boots.delete(itemId);
    return;
  }
  const left = (p.keys[itemId] ?? 0) - 1;
  if (left > 0) p.keys[itemId] = left;
  else delete p.keys[itemId];
}

/**
 * Picks the tool at (x, y) up onto the belt. With four tools held the oldest goes out first (Lexy attempt_take): a yellow
 * pad that cannot be set down here (the cell is not plain floor) refuses the whole pickup, otherwise the oldest is put down
 * on the cell once the new tool is taken, by the same rules as a drop.
 */
function pickUpBeltTool(ctx: EpoxyContext, x: number, y: number, itemId: string, def: TileDefinition, fromPad = false): void {
  const w = ctx.world;
  const p = w.player;
  const belt = syncToolBelt(p);
  let pushedOut: string | undefined;
  if (belt.length >= CC2_TOOL_BELT_CAPACITY) {
    const oldest = belt[0];
    const oldestDef = ConfigRegistry.getTile(oldest);
    if (oldestDef.collectible === 'gate' && !canSetDownPad(w, x, y)) return;
    removeHeldTool(p, oldest, oldestDef);
    belt.shift();
    pushedOut = oldest;
  }
  if (fromPad) {
    // A yellow pad taken from the terrain: the cell turns to plain floor, and the oldest tool goes down only if no item lies there.
    w.terrain[y][x] = FLOOR_TILE_ID;
    w.gridMutatedByMove = true;
  } else {
    w.items[y][x] = null;
  }
  if (def.collectible === 'boot') p.boots.add(itemId);
  else p.keys[itemId] = (p.keys[itemId] || 0) + 1;
  belt.push(itemId);
  p.belt = belt;
  AudioManager.playSfx('item');
  ctx.emitVisual('item', x, y, def.colorKey || 'blue');
  if (pushedOut !== undefined && w.items[y][x] === null) setDownPushedOutTool(ctx, x, y, pushedOut);
}

/**
 * CC2 engine: the yellow pad at (x, y) joins the belt like any other tool (Lexy attempt_take): with four tools held the oldest
 * is put down on the cell, and a pad that cannot be set down there (the cell is the yellow pad itself, not plain floor)
 * refuses the pickup. Returns false when the level keeps no belt, so the caller takes the pad the plain way.
 */
export function takeYellowPadOntoBelt(ctx: EpoxyContext, x: number, y: number, item: TileDefinition): boolean {
  if (!usesToolBelt(ctx.world) || !isBeltTool(item)) return false;
  pickUpBeltTool(ctx, x, y, item.id, item, true);
  return true;
}

/** A pad is set down only on plain floor with nothing hidden under it. */
function canSetDownPad(w: EpoxyWorld, x: number, y: number): boolean {
  return w.terrain[y][x] === FLOOR_TILE_ID && !isCovered(w, x, y);
}

/**
 * Sets the tool pushed off the belt down on the cell the player stands on, as a drop would: dynamite unlit (it lights when he
 * leaves), a pad as the terrain it makes, the bowling ball as a ball that rolls off, anything else as the item.
 */
function setDownPushedOutTool(ctx: EpoxyContext, x: number, y: number, itemId: string): void {
  const w = ctx.world;
  const def = ConfigRegistry.getTile(itemId);
  w.beamDirty = true;
  if (def.collectible === 'charge' && def.cc2Dynamite === true) {
    setDownDynamite(w, x, y, itemId);
  } else if (def.collectible === 'gate' && def.dropsAsTerrain !== undefined) {
    w.terrain[y][x] = def.dropsAsTerrain;
    w.gridMutatedByMove = true;
  } else if (def.collectible === 'stone' && droppedActorId(itemId) !== undefined) {
    launchRollingBall(ctx, x, y, w.player.dir, itemId);
  } else {
    w.items[y][x] = itemId;
  }
}

/** CC2 engine: a bomb the player steps onto goes off when his step ends, not when it starts (Lexy tiletypes.js bomb on_arrive). */
function bombWaitsForStepEnd(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace;
}

/** CC2 engine: a chip the player stepped onto that has become a green bomb by the time his step ends goes off (the green toggle acts during the step). */
function chipTurnedBombKills(w: EpoxyWorld): boolean {
  return bombWaitsForStepEnd(w);
}

/** The bomb under the player goes off and kills him. */
function explodePlayerBomb(ctx: EpoxyContext, x: number, y: number): void {
  ctx.world.items[y][x] = null;
  ctx.emitVisual('explosion', x, y, 'red');
  killPlayer(ctx, 'hud.messages.death_bomb', 'bomb');
}

/**
 * Applies the effects of the cell the player just entered. A teleporter is
 * resolved first: the player jumps, then the arrival cell (items, thief,
 * buttons, hazards, exit) is resolved at the destination coordinates.
 */
function resolvePlayerArrival(ctx: EpoxyContext, entryDir: Direction, allowTeleport: boolean, atStepEnd = false): void {
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

  // The item of the cell he arrived on, read before a pad is taken: the tool it pushes off the belt lands here and is not picked up again.
  const arrivalItem = w.items[y][x];
  if ((tile.isTeleporter || tile.teleportsToSelf) && allowTeleport && w.cc3dPace) {
    // CC3D: the jump happens when the step that ended on the pad ends (see applyCc3dStepEnd); the pad's own item is still his.
    cc3dArrivalOf(w.player).teleport = { x, y, dir: entryDir };
  } else if ((tile.isTeleporter || tile.teleportsToSelf) && allowTeleport) {
    ctx.emitVisual('teleport', x, y);
    if (teleportPlayer(w, x, y, entryDir, w.ccRules, (px, py, item) => takeYellowPadOntoBelt(ctx, px, py, item))) {
      markCc2Teleport(w, x, y);
      ctx.emitVisual('teleport', w.player.x, w.player.y);
      resolvePlayerArrival(ctx, w.player.dir, false);
      return;
    }
  }

  if (tile.transformsToOnStep) {
    if (tile.clearsOnArriveCc2 === true && usesCc2Engine(w.level) && !w.cc3dPace) {
      // CC2 engine: the dirt he packs down goes when his step ends (Lexy tiletypes.js dirt on_arrive), so until then
      // monsters find the cell shut; applyCc3dStepEnd clears it. The rest of the arrival reads the cell as floor.
      cc3dArrivalOf(w.player).opening = { x, y };
      tile = ConfigRegistry.getTile(tile.transformsToOnStep);
    } else {
      w.terrain[y][x] = tile.transformsToOnStep;
      tile = ConfigRegistry.getTile(w.terrain[y][x]);
    }
  }

  // A transmogrifier turns the player into the other character on arrival (Lexy's Labyrinth tiletypes.js `transmogrifier`).
  if (tile.transmogrifies) {
    const switched = transmogrifiedCharacter(playerCharacterOf(w));
    // With one player the character stays unwritten while it is the level's, so state shapes stay canonical after a round trip.
    if ((w.level.extraPlayers?.length ?? 0) === 0 && switched === (w.level.character ?? DEFAULT_PLAYER_CHARACTER)) delete w.player.character;
    else w.player.character = switched;
  }

  const itemId = arrivalItem;
  if (itemId) {
    const itemDef = ConfigRegistry.getTile(itemId);
    if (itemDef.togglesTimer) toggleTimerOnStep(w);
    if (itemDef.hazard === 'bomb' && bombWaitsForStepEnd(w) && !atStepEnd) {
      // CC2 engine: the bomb goes off when the step onto it ends, if he is still there (a green bomb may be a chip by then).
      cc3dArrivalOf(w.player).bomb = { x, y };
    } else if (itemDef.hazard === 'bomb') {
      explodePlayerBomb(ctx, x, y);
      return;
    }
    if (itemDef.collectible === 'chip' && defersStepEffects(w) && !atStepEnd) {
      // CC3D and CC2 pick the chip up when the step ends. The keys and tools below are still taken at the start of the step: a
      // known gap, as only a monster or a button acting inside the step could tell.
      cc3dArrivalOf(w.player).chip = { x, y };
    } else if (itemDef.collectible === 'chip') {
      takeChip(ctx, x, y, itemDef);
    } else if (usesToolBelt(w) && isBeltTool(itemDef) && !isRedundantBootPickup(w, itemId, itemDef)) {
      // CC2 engine: the belt holds four tools; a fifth pushes the oldest out onto the cell.
      pickUpBeltTool(ctx, x, y, itemId, itemDef);
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

  if (usesCc2Engine(w.level) && !w.cc3dPace && !atStepEnd && (tile.signalSource === 'toggle' || tile.signalSource === 'pulse')) {
    // CC2 engine: a light switch or pulse source acts when the step onto it ends, if he is still on it (Lexy on_arrive).
    cc3dArrivalOf(w.player).pulse = { x, y };
  } else {
    notePulseArrival(w, x, y, null);
  }

  if (usesCc2Engine(w.level) && !w.cc3dPace && !atStepEnd && tile.buttonAction === 'hold_trap') {
    // CC2 engine: the brown button feels him when his step onto it ends, and is held for that tick even if he leaves at once.
    cc3dArrivalOf(w.player).brown = { x, y };
  }

  if (tile.buttonAction !== undefined && defersButton(w, tile.buttonAction) && !atStepEnd) {
    // CC3D: the player works a clone switch, and CC2 any button, when the step that took him onto it ends.
    cc3dArrivalOf(w.player).press = { x, y };
  } else if (tile.buttonAction) {
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
    // The CC3D slime spares a player who holds every boot it lists, and is cleaned by the player's passing.
    if (tile.sparedByBoots !== undefined && tile.blockTransformsTo !== undefined && tile.sparedByBoots.every((id) => w.player.boots.has(id))) {
      w.terrain[y][x] = tile.blockTransformsTo;
      w.gridMutatedByMove = true;
    } else {
      ctx.emitVisual('splash', x, y, 'green');
      killPlayer(ctx, 'hud.messages.death_slime', 'death');
      return;
    }
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
 * Whether what a step of the player does on the cell it ends on waits for the end of the step (applyCc3dStepEnd): a
 * converted CC3D level and a CC2-engine level. Teleports stay with the step on a CC2-engine level.
 */
export function defersStepEffects(w: EpoxyWorld): boolean {
  return w.cc3dPace || usesCc2Engine(w.level);
}

/** Whether pressing the button `action` waits for the end of the step: every button on CC2, only the clone switch on CC3D. */
function defersButton(w: EpoxyWorld, action: string): boolean {
  return usesCc2Engine(w.level) || (w.cc3dPace && action === 'trigger_cloner');
}

/** The step-end effects waiting on `p`, created on first use. */
function cc3dArrivalOf(p: PlayerState): Cc3dPlayerArrival {
  p.cc3dArrival ??= {};
  return p.cc3dArrival;
}

/** Takes the chip lying on (x, y): the cell empties, the count drops unless the chip is not one of the level's, and the pick-up plays. */
function takeChip(ctx: EpoxyContext, x: number, y: number, itemDef: TileDefinition): void {
  const w = ctx.world;
  w.items[y][x] = null;
  if (itemDef.countsAsChip !== false) w.chipsRemaining = Math.max(0, w.chipsRemaining - 1);
  AudioManager.playSfx('chip');
  ctx.emitVisual('chip', x, y, 'green');
}

/**
 * Converted CC3D level: acts on what the controlled player's step left pending once that step has ended (CC3D acts on
 * arrival, Cc3dSimulation.onArrival) - a clone switch he stands on, the chip of the cell, the teleporter he stopped on.
 * The step has ended when its wait has run out (the slide wait while he slides). A player who died during the step takes
 * nothing. Order as in CC3D: the switch, the chip of the cell, then the jump and the item of the pad he lands on.
 * Returns false when the tick must stop (a clone press that ended the level).
 * Used by a converted CC3D level and by a CC2-engine level (see defersStepEffects).
 */
export function applyCc3dStepEnd(ctx: EpoxyContext): boolean {
  const w = ctx.world;
  const p = w.player;
  const pending = p.cc3dArrival;
  if (pending === undefined) return true;
  if (p.isSliding ? p.slideCooldown > 0 : p.moveCooldown > 0) return true;
  delete p.cc3dArrival;
  // CC2 engine: the dirt he packed down goes now that his step has ended (see resolvePlayerArrival).
  if (pending.opening !== undefined) {
    const { x, y } = pending.opening;
    const packed = ConfigRegistry.getTile(w.terrain[y]?.[x]);
    if (packed.clearsOnArriveCc2 === true && packed.transformsToOnStep !== undefined) w.terrain[y][x] = packed.transformsToOnStep;
  }
  if (!p.alive || p.exited === true || w.levelCompleted) return true;
  if (pending.brown !== undefined && p.x === pending.brown.x && p.y === pending.brown.y && ConfigRegistry.getTile(w.terrain[p.y][p.x]).buttonAction === 'hold_trap') {
    // Several players can end steps on different brown buttons before the tick: each cell stays held, in ascending order.
    const cell = p.y * mapWidth(w) + p.x;
    const held = w.cc2BrownHeld ?? [];
    if (!held.includes(cell)) w.cc2BrownHeld = [...held, cell].sort((a, b) => a - b);
  }
  if (pending.pulse !== undefined && p.x === pending.pulse.x && p.y === pending.pulse.y) notePulseArrival(w, pending.pulse.x, pending.pulse.y, null);
  if (pending.press !== undefined) {
    const { x, y } = pending.press;
    const tile = ConfigRegistry.getTile(w.terrain[y]?.[x]);
    if (p.x === x && p.y === y && tile.buttonAction !== undefined && defersButton(w, tile.buttonAction) && !triggerButton(ctx, x, y, tile.buttonAction, !w.cc3dPace)) return false;
    if (!p.alive) return true;
  }
  if (pending.bomb !== undefined && p.x === pending.bomb.x && p.y === pending.bomb.y) {
    const itemId = w.items[p.y]?.[p.x];
    const itemDef = itemId ? ConfigRegistry.getTile(itemId) : undefined;
    if (itemDef?.hazard === 'bomb') {
      explodePlayerBomb(ctx, p.x, p.y);
      return true;
    }
    // The bomb turned into a chip during the step (a green toggle): it is taken like one.
    if (itemDef?.collectible === 'chip') takeChip(ctx, p.x, p.y, itemDef);
  }
  if (pending.chip !== undefined) {
    const { x, y } = pending.chip;
    const itemId = w.items[y]?.[x];
    if (itemId) {
      const itemDef = ConfigRegistry.getTile(itemId);
      if (itemDef.collectible === 'chip') takeChip(ctx, x, y, itemDef);
      else if (itemDef.hazard === 'bomb' && chipTurnedBombKills(w) && p.x === x && p.y === y) {
        // The chip he stepped onto became a green bomb during the step: it goes off.
        explodePlayerBomb(ctx, x, y);
        return true;
      }
    }
  }
  if (pending.teleport !== undefined) {
    const { x, y, dir } = pending.teleport;
    ctx.emitVisual('teleport', x, y);
    if (teleportPlayer(w, x, y, dir, true)) {
      ctx.emitVisual('teleport', w.player.x, w.player.y);
      // The exit step is decided on the next tick (see processTeleportExit).
      p.moveCooldown = Math.max(p.moveCooldown, CC3D_TELEPORT_LANDING_WAIT_TICKS);
      resolvePlayerArrival(ctx, w.player.dir, false, true);
      if (w.player.alive && !w.levelCompleted && w.player.exited !== true) wakeLurkersNearPlayer(w);
    }
  }
  return true;
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

/** Ticks a player waits after a plain walking step: the base cadence shortened by speed boots. */
export function playerWalkCooldown(w: EpoxyWorld): number {
  return Math.max(MIN_WALK_COOLDOWN_TICKS, Math.ceil(ConfigRegistry.getGame().timing.playerMoveCooldownTicks / playerHaste(w)));
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
    w.player.slideCooldown = w.ccRules
      ? CC_ICE_SLIDE_COOLDOWN_TICKS
      : w.cc3dPace
        ? CC3D_SLIDE_ENTRY_COOLDOWN_TICKS
        : ConfigRegistry.getGame().timing.slideCooldownTicks;
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
    w.player.slideCooldown = w.ccRules
      ? CC_FORCE_SLIDE_COOLDOWN_TICKS
      : w.cc3dPace
        ? CC3D_SLIDE_ENTRY_COOLDOWN_TICKS
        : ConfigRegistry.getGame().timing.slideCooldownTicks + FORCE_SLIDE_EXTRA_COOLDOWN_TICKS;
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
      if (defersStepEffects(w)) applyCc3dStepEnd(ctx);
      if (w.player.isSliding) {
        if (w.player.slideCooldown > 0) {
          w.player.slideCooldown--;
          if (defersStepEffects(w) && w.player.slideCooldown === 0) applyCc3dStepEnd(ctx);
        } else {
          processPlayerSlideStep(ctx);
        }
      }
      processTeleportExit(ctx);
    });
  }
}

/**
 * Classic rules: a player who landed on a teleporter leaves it by a forced step in the direction recorded at the
 * landing, once his wait is over. The step is made once: if it is blocked he stays on the pad.
 */
export function processTeleportExit(ctx: EpoxyContext): void {
  const w = ctx.world;
  const dir = w.player.teleportExit;
  if (dir === undefined || w.player.moveCooldown > 0 || !w.player.alive || w.levelCompleted) return;
  // CC2 engine, red and yellow pads: the exit is the player's own decision at his next decision (see softPadOverrideDue). The
  // first tick after the wait only opens that decision; the forced exit is taken on the following tick when he held nothing.
  const soft = onSoftPad(w);
  if (soft && w.player.softPadDue !== true) {
    w.player.softPadDue = true;
    return;
  }
  delete w.player.softPadDue;
  delete w.player.teleportExit;
  const mover = w.player;
  // CC2 engine: the exit step begins from the destination pad, which is where the teeth aim on this first exit tick.
  resetCc2PlayerView(w, dir);
  const moved = executePlayerMove(ctx, dir, true);
  if (moved && mover === w.player && w.player.alive && w.player.exited !== true && w.cc3dPace) {
    // CC3D: the exit is a fast step, started on the tick after the jump (the rest of its wait is what is left here).
    if (w.player.isSliding) w.player.slideCooldown = Math.min(w.player.slideCooldown, CC3D_SLIDE_ENTRY_COOLDOWN_TICKS - 1);
    else w.player.moveCooldown = Math.max(w.player.moveCooldown, STEP_TICKS.fast - CC3D_TELEPORT_LANDING_WAIT_TICKS);
  } else if (moved && mover === w.player && w.player.alive && w.player.exited !== true && !w.player.isSliding) {
    // The exit of a soft pad was taken a tick later, so its step is one tick shorter.
    w.player.moveCooldown = Math.max(w.player.moveCooldown, playerWalkCooldown(w) - (soft ? CC2_SOFT_PAD_EXIT_WAIT_REDUCTION_TICKS : 0));
  }
  ctx.checkTargetsWin();
}

/**
 * CC2 engine: whether the controlled-or-parked player waits on a soft pad for his exit: a red or yellow teleporter (the
 * pads whose exit he may decide himself, Lexy's teleport-soft slide, tiletypes.js teleport_red and teleport_yellow). The
 * other pads force the exit.
 */
function onSoftPad(w: EpoxyWorld): boolean {
  if (!usesCc2Engine(w.level) || w.cc3dPace || w.player.teleportExit === undefined) return false;
  const here = w.terrain[w.player.y]?.[w.player.x];
  return here !== undefined && ConfigRegistry.getTile(here).teleportSoftCc2 === true;
}

/**
 * CC2 engine: whether the controlled player may decide the exit of the soft pad he stands on now: the decision was opened
 * (softPadDue) and his step wait is over. A direction held then is a normal move from the destination pad (Lexy
 * game.js:1578-1620: a pending teleport-soft slide yields to a direction); a refused one leaves him there with the forced exit
 * gone.
 */
export function softPadOverrideDue(w: EpoxyWorld): boolean {
  return w.player.softPadDue === true && w.player.moveCooldown <= 0 && onSoftPad(w);
}

/** CC2 engine: takes the soft pad decision of the controlled player: the forced exit is gone and he decides from the pad. */
export function takeSoftPadOverride(w: EpoxyWorld): void {
  delete w.player.softPadDue;
  delete w.player.teleportExit;
  resetCc2PlayerView(w, w.player.dir);
}

/** CC2 engine: a player who slides onto a teleporter pad takes a walking step to reach it, not the slide wait of the classic rules. */
function slideOntoPadWalks(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level);
}

export function processPlayerSlideStep(ctx: EpoxyContext): void {
  const w = ctx.world;
  const dir = w.player.slideDir || w.player.dir;
  const currentTile = ConfigRegistry.getTile(w.terrain[w.player.y][w.player.x]);

  // The mover may leave through an exit during the step, which hands control to the next player.
  const mover = w.player;
  // CC2 engine: speed boots taken by this step act from the next one, so the walking wait is read before it.
  const walkWaitAtStart = playerWalkCooldown(w);
  const moved = executePlayerMove(ctx, dir, true);
  let steppedOff = moved;
  if (!moved) {
    if (currentTile.slideType === 'ice') {
      const bounceDir = OPPOSITE_DIRECTION[dir];
      // A CC3D corner does not turn the bounce: it runs into the closed side and the slide ends on the corner.
      const deflectedBounce = currentTile.cc3dCornerBounce === true ? bounceDir : currentTile.deflectionMap?.[bounceDir] || bounceDir;
      w.player.slideDir = deflectedBounce;
      w.player.dir = deflectedBounce;
      const bouncedMoved = executePlayerMove(ctx, deflectedBounce, true);
      steppedOff = bouncedMoved;
      if (!bouncedMoved) {
        w.player.isSliding = false;
        w.player.slideDir = null;
      }
    } else if (w.cc3dPace && isCarriedByForceFloor(w, currentTile)) {
      // Cc3dSimulation.forceStep: a refused forced step on a force floor keeps the drift (the drawn direction of a
      // random or cycling floor). The player stays on the cell with it, and his input along its axis is refused (see
      // attemptPlayerMove).
      w.player.isSliding = false;
    } else {
      w.player.isSliding = false;
      w.player.slideDir = null;
    }
  }
  // A converted CC3D level: a slide goes on at the fast pace once its first step is made, and the step that ends it
  // leaves the player busy one more tick.
  if (w.cc3dPace && steppedOff && mover === w.player && w.player.alive && w.player.exited !== true) {
    if (w.player.isSliding) w.player.slideCooldown = CC3D_SLIDE_STEP_COOLDOWN_TICKS;
    else w.player.moveCooldown = Math.max(w.player.moveCooldown, CC3D_SLIDE_END_WAIT_TICKS);
  }
  // Classic rules: a move takes the time of the tile it enters, so the step that leaves a slide onto plain floor is
  // followed by a full walking wait (ice and force floor alike).
  if (w.ccRules && steppedOff && mover === w.player && w.player.alive && w.player.exited !== true && !w.player.isSliding) {
    // A player who slid onto a teleporter waits the time of a slide step before the forced exit. On a CC2-engine level the
    // step time comes from the cell entered (Lexy game.js:2177-2194, the speed of the goal cell): a pad is plain floor, so the
    // slide onto it lasts a walking step.
    const cc2WalkWait = usesCc2Engine(w.level) && !w.cc3dPace ? walkWaitAtStart : playerWalkCooldown(w);
    const wait = w.player.teleportExit !== undefined && !slideOntoPadWalks(w) ? CC_TELEPORT_SLIDE_WAIT_TICKS : cc2WalkWait;
    w.player.moveCooldown = Math.max(w.player.moveCooldown, wait);
    // CC2 engine: the slide step that ends on plain floor is an in-tick move, so the wait is one tick shorter. A slide that ends on a
    // pad keeps the whole walking wait: measured on the official CC2 replays, taking that tick off the pad slide as well wins one level
    // fewer (eightway) than leaving it, and Lexy times the step by the goal cell, which is plain floor for a pad.
    if (usesCc2Engine(w.level) && w.player.teleportExit === undefined && w.player.moveCooldown > 0) {
      w.player.moveCooldown -= CC2_SLIDE_END_WAIT_REDUCTION_TICKS;
    }
  }
  // CC2 engine: a carried step that goes on sliding lasts a tick before the player may choose again.
  if (usesCc2Engine(w.level) && steppedOff && mover === w.player && w.player.alive && w.player.exited !== true && w.player.isSliding) {
    w.player.moveCooldown = Math.max(w.player.moveCooldown, CC2_SLIDING_STEP_MOVE_COOLDOWN_TICKS);
  }
  ctx.checkTargetsWin();
}

/** Ticks left on the controlled player's step: the move wait, or the slide wait while he slides. */
function stepCooldownOf(p: PlayerState): number {
  return Math.max(p.moveCooldown, p.isSliding ? p.slideCooldown : 0);
}

/** Whether the apparent player position is kept: a CC2-engine level, and the controlled player in his own slot. */
function tracksCc2PlayerView(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && w.swappedIn === null;
}

/**
 * CC2 engine: puts the apparent player position on his cell, at rest (a hand-off to another player, the exit step out
 * of a teleporter pad). The view means: the player stands on (x, y) and is still `cooldown` ticks short of a step of
 * `stepLength` ticks along `dir`, so he appears `cooldown / stepLength` of a cell behind (x, y) against `dir`.
 */
export function resetCc2PlayerView(w: EpoxyWorld, dir: Direction = w.player.dir): void {
  if (!tracksCc2PlayerView(w)) return;
  // A player taking control mid-step keeps the wait he has left; the step length is the least that wait allows.
  const cooldown = stepCooldownOf(w.player);
  w.cc2PlayerView = { x: w.player.x, y: w.player.y, dir, cooldown, stepLength: Math.max(1, cooldown) };
}

/** The view as it stands, or the controlled player at rest on his cell when none was taken yet. */
export function cc2PlayerViewOf(w: EpoxyWorld): Cc2PlayerView {
  return w.cc2PlayerView ?? { x: w.player.x, y: w.player.y, dir: w.player.dir, cooldown: 0, stepLength: 1 };
}

/**
 * CC2 engine: the explicit teleport marker. The jump to the destination pad happens when the step onto the source pad
 * (x, y) starts here, but the teeth see the player move onto the source pad and only then jump. The marker rides on
 * the view (`sourcePad`), which is left as it stood (the teeth of the tick under way read it); the next
 * recordCc2PlayerView moves it onto the pad.
 */
function markCc2Teleport(w: EpoxyWorld, x: number, y: number): void {
  if (!tracksCc2PlayerView(w) || w.cc3dPace) return;
  const view = w.cc2PlayerView;
  w.cc2PlayerView = view === undefined ? { x, y, dir: w.player.dir, cooldown: 0, stepLength: 1, sourcePad: { x, y } } : { ...view, sourcePad: { x, y } };
}

/**
 * CC2 engine: records where the controlled player appears to be, at the end of a tick, so the teeth of the next tick
 * (which run after this tick's input moved him, but aim where he stood before it) read his position at the start of it.
 * A step in progress puts him `cooldown / stepLength` of a cell behind his cell; the step length is the real one (ice,
 * force floors, speed boots), read from the cooldown the step was given. A teleport keeps the apparent position on the
 * source pad until the exit step (resetCc2PlayerView in processTeleportExit moves it onto the destination pad).
 */
export function recordCc2PlayerView(w: EpoxyWorld): void {
  if (!tracksCc2PlayerView(w)) return;
  const p = w.player;
  const cooldown = stepCooldownOf(p);
  const prev = w.cc2PlayerView;
  if (prev === undefined) {
    w.cc2PlayerView = { x: p.x, y: p.y, dir: p.dir, cooldown, stepLength: Math.max(1, cooldown) };
    return;
  }
  const pad = prev.sourcePad;
  if (pad !== undefined) {
    if (prev.x !== pad.x || prev.y !== pad.y) {
      // The teleport was marked after this view was taken: from now the apparent position is the pad he stepped onto.
      const dx = Math.sign(pad.x - prev.x);
      const dy = Math.sign(pad.y - prev.y);
      const dir = dx === 0 && dy < 0 ? 'N' : dx === 0 && dy > 0 ? 'S' : dy === 0 && dx > 0 ? 'E' : dy === 0 && dx < 0 ? 'W' : prev.dir;
      w.cc2PlayerView = { x: pad.x, y: pad.y, dir, cooldown, stepLength: Math.max(1, cooldown + 1), sourcePad: { ...pad } };
    } else {
      w.cc2PlayerView = { ...prev, cooldown, stepLength: cooldown === 0 ? 1 : prev.stepLength, sourcePad: { ...pad } };
    }
    return;
  }
  const moved = prev.x !== p.x || prev.y !== p.y;
  // A wait that began without displacing him (a forced step refused by the cell ahead) leaves him on his cell, not a cell behind.
  const displaced = moved || prev.cooldown > 0;
  const shownCooldown = displaced ? cooldown : 0;
  w.cc2PlayerView = {
    x: p.x,
    y: p.y,
    dir: p.isSliding && p.slideDir ? p.slideDir : p.dir,
    cooldown: shownCooldown,
    // At rest the step length is 1, whatever the last step was, so equivalent states are the same state.
    stepLength: shownCooldown === 0 ? 1 : moved ? cooldown + 1 : Math.max(prev.stepLength, cooldown)
  };
}
