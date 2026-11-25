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
import { Cc2PlayerView, Cc3dPlayerArrival, Direction, PlayerState, RuntimeEntity, TileDefinition } from '../types';
import { STEP_TICKS } from '../cc3d/cc3dConstants';
import { attemptPushBlock, isCc3dPush, splashBarsPlayer } from './epoxyBlocks';
import { bribeThief, foilBumpedWall, toggleTimerOnStep } from './epoxyCc2Items';
import { triggerButton } from './epoxyDevices';
import { CC2_FRAMES_PER_TICK, PRE_PASS_END_FRAME_SHIFT, drawRffPlayer, forceCycleArrival, rffActive, rffDefer, rffStepStart } from './epoxyForceCycle';
import { wakeLurkersNearPlayer } from './epoxyLurkers';
import { absorbMonsterContact, shieldedFromContact, wardBootsHeld } from './epoxyWard';
import { killPlayerByShot, spendShotAt } from './epoxyShots';
import { copiesControllerMove, hasCc2MirrorCadence, isSwapLeaverStep, rememberExitStep, rememberPlayerMove, steerMirrors } from './epoxyMirrors';
import { isHeldSignalButton } from './epoxySignals';
import { playerRailActor, railRedirect } from './epoxyRailsCc2';
import { droppedActorId, explodeRollingBall, isRollingBall, launchRollingBall } from './epoxyRollingBall';
import { setDownDynamite } from './epoxyDynamite';
import { enterSwivel, leaveSwivel } from './epoxySwivels';
import { teleportPlayer } from './epoxyTeleports';
import { stepClassicMonsterOutOfTurn } from './epoxyMonsters';
import {
  EpoxyContext,
  EpoxyWorld,
  canPlayerEnter,
  entityPressesPlate,
  getEntityAt,
  holdsItem,
  isButtonPressed,
  isCellClosedTrap,
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

/** Out-of-turn ejection from a trap: a block is pushed out its facing, chain allowed (Lexy attempt_step pushes of the ice block), not by the player. */
const TRAP_EJECT_ALLOW_CHAIN = true;
const TRAP_EJECT_BY_PLAYER = false;
/** An ejected block is not pushed by a player, so no player cell is guarded (the fifth argument of attemptPushBlock). */
const TRAP_EJECT_GUARD_PLAYER_CELL = false;
/** Extra cooldown tick of a monster stepped out of a trap: the press is counted by the pass before the ejection, unlike the bowling ball set down inside the player's own turn (the drop key, or the oldest tool pushed off a full belt by a pickup: Lexy attempt_take places it with _place_dropped_item, game.js:3221-3280), which takes none. */
const TRAP_EJECT_EXTRA_COOLDOWN_TICKS = 1;

/**
 * A trap that a press just opened ejects what it holds, out of turn (Lexy trap add_press -> attempt_out_of_turn_step,
 * tiletypes.js:1764-1779). A block is pushed out its facing; a monster steps once out of turn and carries one extra cooldown
 * tick, counted once per tic (Lexy do_extra_cooldown, game.js:2218-2242, last_extra_cooldown_tic) so the pass does not count
 * the tick of its step a second time. An entity that ignores floor effects (a ghost) is not held by a trap.
 * A parked player in the trap is not ejected here, where Lexy ejects any actor (tiletypes.js:1771-1777): on a multi-player CC2 level
 * (no actor order, off the CC3D pace) the engine's release at the tick start and before the input steps him out (wave 33).
 *
 * Wave 31, `blockPress` (CC2 engine, off the CC3D pace): the opening press is a block's arrival on a brown button. The controlled
 * player standing in the trap at rest is then ejected too, through the engine's forced step in his facing (the ejection hook), and
 * the extra cooldown tick also applies inside the tick when `blockPress.extraTick` says the arrival settled in the frame pre-pass (a
 * monster is ejected at most once per tic: its step leaves it a cooldown, which bars a second ejection). A teeth so ejected steps out
 * whatever its phase (the world transient cc2TrapEjection, read by stepClassicMonster).
 */
export function ejectFromTrap(ctx: EpoxyContext, x: number, y: number, blockPress?: { extraTick: boolean }): void {
  const w = ctx.world;
  if (blockPress !== undefined && w.player.alive && w.player.x === x && w.player.y === y && w.player.moveCooldown === 0 && !w.player.isSliding) {
    ctx.cc2ReleaseTrappedPlayer?.();
    return;
  }
  const e = getEntityAt(w, x, y);
  if (e === undefined || ConfigRegistry.getEntityDef(e.type)?.ignoresFloorEffects === true) return;
  if (e.kind === 'block') {
    if (!e.isSliding && e.arrivalTicks === undefined) attemptPushBlock(ctx, e, e.dir, TRAP_EJECT_ALLOW_CHAIN, TRAP_EJECT_GUARD_PLAYER_CELL, undefined, TRAP_EJECT_BY_PLAYER);
    return;
  }
  if (e.kind !== 'monster' || e.cooldownTicks !== 0) return;
  w.ccPlans.set(e.uid, e.dir);
  const fromX = e.x;
  const fromY = e.y;
  // The step's button press is queued to its step end (queuesButtonPress reads the flag), as for any monster step.
  w.cc2TrapEject = true;
  if (blockPress !== undefined) w.cc2TrapEjection = true;
  try {
    stepClassicMonsterOutOfTurn(ctx, e);
  } finally {
    delete w.cc2TrapEject;
    delete w.cc2TrapEjection;
  }
  w.ccPlans.delete(e.uid);
  const extraTick = !w.inTick || blockPress?.extraTick === true;
  if (extraTick && (e.x !== fromX || e.y !== fromY) && e.cooldownTicks > 0) e.cooldownTicks += TRAP_EJECT_EXTRA_COOLDOWN_TICKS;
}

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

/** CC2 engine: ticks of the exit step's wait already counted when it is taken, at the turn after the jump. */
const CC2_TELEPORT_EXIT_COUNTED_TICKS = 1;

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
    // Wave 35: a carried try draws at once (a draw still pending is made first), it does not wait for an arrival frame.
    drawRffPlayer(w, true);
    evaluatePlayerSliding(w, tile, w.player.dir, true);
    w.player.slideCooldown = 0;
    return;
  }
  if (!tile.forceDirection) return;
  w.player.isSliding = true;
  w.player.slideDir = tile.forceDirection;
  w.player.dir = tile.forceDirection;
  w.player.slideCooldown = 0;
}

/** The Lexy frame a voluntary walk onto a trap ends in: the decision is taken in frame 2 and the step lasts a whole number of tics (game.js 2218-2242). */
const VOLUNTARY_ARRIVAL_FRAME = 1;

/** The only pre-pass frame of a player's step whose Lexy arrival frame is known (wave 37): frame 1 ends in Lexy frame (1 + 2) % 3 = 0. */
const KNOWN_PRE_PASS_FRAME = 1;


/**
 * CC2 engine, off the CC3D pace (wave 37, PFPL): after a step that moved the player, records the Lexy frame it ends in when it ended on a
 * trap (`cc2TrapArrivalFrame`, read by releaseAllowed and by the block hook, refusesPrePassEjection) and drops the mark of any other
 * step of his. Known arrivals only: a voluntary walk (decision in Lexy frame 2) ends in frame 1; a pre-pass step of pre-pass frame 1 on
 * an actor-order level ends in frame 0. Every other step onto a trap (a pre-pass frame-0 step, a forced step out of a trap, a teleport
 * exit, a main-pass slide, any carried step on a level without actor order) leaves no mark: unknown, which keeps list order, as before
 * wave 37 (no lane gives a frame-2 arrival, and a level without actor order has no player frame model). Lexy tiletypes.js 1768-1779,
 * game.js 2155, 2218-2242.
 */
function markTrapArrivalFrame(w: EpoxyWorld, player: PlayerState, fromSlide: boolean): void {
  if (!usesCc2Engine(w.level) || w.cc3dPace) return;
  delete player.cc2TrapArrivalFrame;
  if (ConfigRegistry.getTile(w.terrain[player.y]?.[player.x]).isTrap !== true) return;
  if (!fromSlide && w.cc2ForcedStep !== true && w.cc2PrePassPlayer !== true) {
    player.cc2TrapArrivalFrame = VOLUNTARY_ARRIVAL_FRAME;
  } else if (fromSlide && w.cc2PrePassPlayer === true && w.cc2PrePassFrame === KNOWN_PRE_PASS_FRAME && w.cc2ActorOrder === true) {
    player.cc2TrapArrivalFrame = ((KNOWN_PRE_PASS_FRAME + PRE_PASS_END_FRAME_SHIFT) % CC2_FRAMES_PER_TICK) as 0;
  }
}

export function executePlayerMove(ctx: EpoxyContext, requestedDir: Direction, fromSlide: boolean): boolean {
  const w = ctx.world;
  // Wave 35: the arrival draw still pending is made before the next decision (Lexy: the arrival always precedes it).
  drawRffPlayer(w, true);
  if (w.ccRules) updateForcePermission(w, fromSlide);
  const controller = w.player;
  const moved = attemptPlayerStep(ctx, requestedDir, fromSlide);
  if (moved && controller.alive) markTrapArrivalFrame(w, controller, fromSlide);
  // The step onto an exit lasts the leaver's walking step (read before control changes hands).
  const leaverWait = playerWalkCooldown(w);
  // The mirrors copy the controlled player's decided step onto the exit until it ends (Lexy remember_player_move at the
  // decision; remember_player_move(null) and swap_players at the arrival). A two-key decision's exit attempt is its decision.
  if (w.player === controller && controller.exited === true) rememberExitStep(w, requestedDir, controller, leaverWait);
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
    // Wave 31: a forced out-of-turn step (the release from a trap) is no decision: the mirrors do not copy it (Lexy calls
    // remember_player_move only for a decision).
    if (copiesControllerMove(w)) rememberPlayerMove(w, dir);
    // The leaver of a swap: his forced slide decided in the swap tick is remembered for the new controller.
    else if (isSwapLeaverStep(w)) rememberPlayerMove(w, dir);
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
 * CC2 engine, actor order (wave 9): the player's early push at his decision, for each key in the order he reads them (Lexy
 * make_player_decision, game.js:1630-1660, check_movement with push mode). `movingAtDecision` receives the uids of the blocks
 * that were in motion when he decided (arriving, or sliding with a cooldown): the step at his place must not push them
 * (see the guard in attemptPlayerStep). Nothing calls this until the engine batch wires it, so a play is unchanged before.
 *
 * Two Lexy refusals apply to each key:
 * - a block on a sliding floor that slides or is arriving is not pushed (Lexy no_directly_pushing_sliding_blocks,
 *   game.js:1985-1996, on in the steam rulesets, defs.js:289-291);
 * - a block whose terrain bars the player is not pushed (Lexy can_actor_enter_cell judges the cell's tiles before pushables,
 *   game.js:1813-1935).
 *
 * Pending push (wave 10): Lexy does not drop the push of a block that cannot be pushed directly, it writes a pending push that
 * turns the block's next move that way (must_pending_push, game.js:1980-1996; taken at 1703-1710). Only the jammed case is
 * ported: a block at rest on a force floor whose last move landed it on a slide cell (cc2SlideArrived) takes cc2PendingPush, is
 * listed as moving at the decision so the step does not push it, and the player walks in when the block already left. Wave 27 adds the
 * block sliding on ice that moves in this frame-2 pass (cooldown 0, no frame tag, no held arrival), only when it is listed after him
 * (its own decision has set its slide mode, game.js:1715-1718, 1985-1986). Known gaps,
 * pinned by tests: the push of a block that slides with a cooldown above 0 or arrives (ice or force) is still skipped, not queued (the full pending push,
 * the AODP prototype flag, lost chaoslnd and map116 and broke memories, a block pushed N on ice at t139 kills the player where the
 * solution lives); the slap of a jammed block (slapBlockAhead, two keys held) does not queue it either; and the push of a
 * cooldown-0 block listed before him whose slide was refused this tic (Lexy 1266) is not queued (no case found, unverified).
 * A player carried by a force floor who may override it decides too (Lexy may_move, game.js:1576-1579).
 *
 * The slaps are timed as the input was (pass closed, outside a tick), as the clock adapter of the turn expects.
 */
export function decisionPush(ctx: EpoxyContext, dirs: readonly Direction[], movingAtDecision: Set<number>): void {
  const w = ctx.world;
  const p = w.player;
  if (!usesCc2Engine(w.level) || w.cc3dPace) return;
  // The decision push is an actor-order rule.
  if (w.cc2ActorOrder !== true) return;
  // A player carried by a force floor who may override it decides (and pushes) too (Lexy may_move, game.js:1576-1579).
  const overridesForce = p.isSliding && p.forcePermission === true && ConfigRegistry.getTile(w.terrain[p.y][p.x]).slideType === 'force';
  if (!p.alive || w.levelCompleted || p.moveCooldown > 0 || (p.isSliding && !overridesForce) || isCellClosedTrap(w, p.x, p.y)) return;
  for (const entity of w.entities) {
    if (entity.kind === 'block' && (entity.arrivalTicks !== undefined || (entity.isSliding && entity.cooldownTicks > 0))) {
      movingAtDecision.add(entity.uid);
    }
  }
  const passOpen = w.ccPassOpen;
  const inTick = w.inTick;
  w.ccPassOpen = false;
  w.inTick = false;
  try {
    for (const dir of dirs) {
      const vec = DIRECTION_VECTORS[dir];
      const ahead = getEntityAt(w, p.x + vec.dx, p.y + vec.dy);
      if (ahead !== undefined && ahead.kind === 'block') {
        const aheadTile = ConfigRegistry.getTile(w.terrain[ahead.y][ahead.x]);
        const moving = aheadTile.slideType !== undefined && (ahead.isSliding || ahead.arrivalTicks !== undefined);
        // Lexy must_pending_push (game.js:1980-1996): the push of a block jammed on a force floor (at rest, its last move landed it
        // on a slide cell) becomes a pending push. The block goes that way at its own move of the tick; the step does not push it
        // (it is listed as moving at the decision), and he walks in when the block, listed before him, already left.
        const jammed = aheadTile.slideType === 'force' && !ahead.isSliding && ahead.arrivalTicks === undefined && ahead.cc2SlideArrived === true;
        // A block sliding on ice that moves in this frame-2 pass (at rest between two slide steps, no frame tag, no held
        // arrival) takes the push as a pending push too (Lexy must_pending_push: current_slide_mode on a slide terrain).
        const onIceNow = aheadTile.slideType === 'ice' && ahead.isSliding && ahead.cooldownTicks === 0 && ahead.arrivalTicks === undefined && ahead.cc2SlideFrame === undefined && ahead.cc2ArrivalWait === undefined && ahead.cc2PrePassMoved !== true && listedAfterPlayer(w, ahead);
        if (jammed || onIceNow) {
          ahead.cc2PendingPush = dir;
          movingAtDecision.add(ahead.uid);
          continue;
        }
        // Lexy no_directly_pushing_sliding_blocks: the push of a block that slides or arrives is skipped.
        if (moving) continue;
        if (!canPlayerEnter(w, aheadTile, w.items[ahead.y][ahead.x])) continue;
      }
      slapBlockAhead(ctx, dir);
    }
  } finally {
    w.ccPassOpen = passOpen;
    w.inTick = inTick;
  }
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
  // CC2 engine: the decision probes every held key, and the probe bumps the cell: a plain wall under the steel foil turns to steel
  // even when another held key is the one taken (Lexy make_player_decision try_direction -> can_actor_enter_cell on_bumped,
  // game.js:1559-1561, 1643-1645, 1832-1833; wall.on_bumped with the foil, tiletypes.js:393-400).
  if (
    usesCc2Engine(w.level) &&
    !w.cc3dPace &&
    !canPlayerEnter(w, ConfigRegistry.getTile(w.terrain[targetY][targetX]), w.items[targetY][targetX]) &&
    foilBumpedWall(w, targetX, targetY)
  ) {
    return true;
  }
  const block = getEntityAt(w, targetX, targetY);
  if (block === undefined || block.kind !== 'block') return bumped;
  // CC2 engine: the block on a clone machine is its template, held by the machine: the slap does not move it (Lexy cloner.traps).
  if (usesCc2Engine(w.level) && ConfigRegistry.getTile(w.terrain[targetY][targetX]).isCloneMachine) return bumped;
  // CC2 engine: a block whose terrain bars the player is not slapped, the item on its cell is not read (Lexy can_actor_enter_cell
  // judges the tiles before the pushables, game.js:1813-1935, and mines items for the player).
  if (usesCc2Engine(w.level) && !w.cc3dPace && !canPlayerEnter(w, ConfigRegistry.getTile(w.terrain[targetY][targetX]), null)) return bumped;
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
      // CC2 engine (AOD3): a block that was in motion when the player decided (arriving, or sliding with a cooldown) is not
      // pushed by his step. This is a decision-time proxy for Lexy's step-time cooldown check (a block with a cooldown
      // refuses the push in attempt_step, game.js:2136-2150), not a rule of its own; the set is absent until the turn fills it.
      const inMotionAtDecision = !fromSlide && usesCc2Engine(w.level) && !w.cc3dPace && w.cc2MovingAtDecision?.has(entityAtTarget.uid) === true;
      const pushed = inMotionAtDecision ? false : attemptPushBlock(ctx, entityAtTarget, dir, true, false, undefined, true);
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
      // CC2 engine: the cell he steps into was judged once, before the push, and is entered whatever the push made of it: a popwall
      // the block left is a wall by now and he still walks in (Lexy attempt_step: check_movement, then move_to, game.js:2020-2036;
      // steam-strict emulate_spring_mining, defs.js:294-297). Blocks in a push chain keep their re-check (epoxyBlocks planPushLine).
      const judgedBefore = usesCc2Engine(w.level) && !w.cc3dPace;
      if (
        !judgedBefore &&
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
 * a tool off the belt. Exception, CC2 belt: a second pair of the same boots is a tool of its own, so it is never redundant there
 * (the ward that absorbs monster contact still is).
 */
function isRedundantBootPickup(w: EpoxyWorld, itemId: string, def: TileDefinition): boolean {
  if (def.collectible !== 'boot') return false;
  // CC2 belt: a second pair of the same boots is a tool of its own (Lexy attempt_take never refuses a tool for being held already,
  // game.js:3237-3275; only use_cc1_boots ignores duplicates, game.js:3288-3330); the extra pairs are counted in keys under the boot id.
  if (usesToolBelt(w) && def.absorbsMonsterContact !== true) return false;
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

/** Takes one extra copy of the boots `itemId` out of keys (the pair in boots stays); false when he holds no extra copy. */
export function takeExtraBootCopy(p: PlayerState, itemId: string): boolean {
  const extra = p.keys[itemId] ?? 0;
  if (extra <= 0) return false;
  if (extra === 1) delete p.keys[itemId];
  else p.keys[itemId] = extra - 1;
  return true;
}

/** Takes one `itemId` out of what the player holds (boots or a counted tool). */
function removeHeldTool(p: PlayerState, itemId: string, def: TileDefinition): void {
  if (def.collectible === 'boot') {
    // An extra pair goes first, the worn one last.
    if (!takeExtraBootCopy(p, itemId)) p.boots.delete(itemId);
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
  if (def.collectible === 'boot' && !p.boots.has(itemId)) p.boots.add(itemId);
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

/** The hazard kinds that kill the CC2 player at the end of his step (Lexy on_arrive from step_on_cell, tiletypes.js 941-1010, 1121-1137). */
const STEP_END_HAZARDS: ReadonlySet<NonNullable<TileDefinition['hazard']>> = new Set(['fire', 'water', 'slime']);

/**
 * Whether the hazards of the cell the player steps onto are judged when his step ends, not when it starts: the CC2 engine, off the CC3D
 * pace (Lexy runs on_arrive and on_stand from step_on_cell, game.js 2310-2367).
 */
export function judgesHazardsAtStepEnd(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace;
}

/**
 * CC2 engine: whether the hazard of `tile` (fire, water, slime, or a lit flame jet, Lexy flame_jet_on on_stand) is judged when the
 * player's step onto it ends, not when it starts (Lexy runs on_arrive and on_stand from step_on_cell, game.js 2310-2367).
 */
function hazardWaitsForStepEnd(w: EpoxyWorld, tile: TileDefinition): boolean {
  if (!judgesHazardsAtStepEnd(w) || tile.hazard === undefined) return false;
  return tile.burnsOccupants === true || STEP_END_HAZARDS.has(tile.hazard);
}

/**
 * Whether the step of `p` still runs: his move wait, or his slide wait while he slides. It answers one question, whether the step-end
 * hazard judge may act yet; cc2DecisionOpen answers whether the player may choose again, and stepCooldownOf how far behind to draw him.
 */
export function stepStillRuns(p: PlayerState): boolean {
  return p.isSliding ? p.slideCooldown > 0 : p.moveCooldown > 0;
}

/**
 * CC2 engine: whether the controlled player `p` is at a decision now, between two ticks: no wait is left on his step (Lexy makes a
 * player decision only at movement cooldown 0, game.js 989-990; a slide gives one at every cell). The swap key and the action keys
 * of a replay act only then. One predicate for the engine and the replay harness.
 */
export function cc2DecisionOpen(p: PlayerState): boolean {
  return stepCooldownOf(p) === 0;
}

/**
 * CC2 engine: whether putting down `itemId` now would strip the boots that guard the hazard his step onto his own cell still has to
 * be judged on (the judge runs when the step ends, so the drop would turn a safe step into a death). Lexy sets tools down at decision
 * time only (game.js 989-990, 1577-1598), never mid-step, so a drop refused here matches a tap that CC2 cannot make. A drop made in the
 * turn the step ends is judged after the flush. A spare pair held on a belt level is not refused: the worn pair stays.
 */
export function dropWouldUnguardPendingHazard(w: EpoxyWorld, itemId: string): boolean {
  if (!judgesHazardsAtStepEnd(w)) return false;
  const p = w.player;
  const at = p.cc3dArrival?.hazard;
  if (at === undefined || at.x !== p.x || at.y !== p.y) return false;
  if (ConfigRegistry.getTile(w.terrain[p.y][p.x]).protectedByItem !== itemId) return false;
  return !(usesToolBelt(w) && (p.keys[itemId] ?? 0) > 0);
}

/** CC2 engine: marks the hazard of the cell (x, y) as pending on `p`: it is judged when his step ends (judgeHazardAtStepEnd). */
export function deferHazardToStepEnd(p: PlayerState, x: number, y: number): void {
  cc3dArrivalOf(p).hazard = { x, y };
}

/** Whether `p` holds the boots that make the hazard of `tile` harmless to him. */
function guardedAgainst(p: PlayerState, tile: TileDefinition): boolean {
  return tile.protectedByItem !== undefined && p.boots.has(tile.protectedByItem);
}

/**
 * CC2 engine: the hazard of the cell his step ended on, judged now on the terrain it has then (a jet may be out again, or lit since):
 * false when it killed him. Water drowns, fire and a lit jet burn, slime kills, unless he holds the boots.
 */
function judgeHazardAtStepEnd(ctx: EpoxyContext, at: { x: number; y: number }): boolean {
  const w = ctx.world;
  const p = w.player;
  if (p.x !== at.x || p.y !== at.y) return true;
  const tile = ConfigRegistry.getTile(w.terrain[p.y][p.x]);
  p.inWater = tile.hazard === 'water';
  if (guardedAgainst(p, tile)) return true;
  if (tile.hazard === 'water') {
    ctx.emitVisual('splash', p.x, p.y);
    killPlayer(ctx, 'hud.messages.death_water', 'death');
    return false;
  }
  if (tile.hazard === 'fire') {
    ctx.emitVisual('explosion', p.x, p.y);
    killPlayer(ctx, 'hud.messages.death_fire', 'burn');
    return false;
  }
  if (tile.hazard === 'slime') {
    ctx.emitVisual('splash', p.x, p.y, 'green');
    killPlayer(ctx, 'hud.messages.death_slime', 'death');
    return false;
  }
  return true;
}

/** CC2 engine: a bomb the player steps onto goes off when his step ends, not when it starts (Lexy tiletypes.js bomb on_arrive). */
function bombWaitsForStepEnd(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace;
}

/** CC2 engine: a chip the player stepped onto that has become a green bomb by the time his step ends goes off (the green toggle acts during the step). */
function chipTurnedBombKills(w: EpoxyWorld): boolean {
  return bombWaitsForStepEnd(w);
}

/** Whether a bomb lies on (x, y). */
function bombUnder(w: EpoxyWorld, x: number, y: number): boolean {
  const id = w.items[y]?.[x];
  return id ? ConfigRegistry.getTile(id).hazard === 'bomb' : false;
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
  // CC2 engine: the jump too happens when the step onto the pad ends, at the player's turn (Lexy step_on_cell marks the pad,
  // game.js:2316-2327, and attempt_teleport runs from do_actor_idle, game.js:1371-1372).
  const jumpsAtStepEnd = usesCc2Engine(w.level) && !w.cc3dPace && !atStepEnd;
  if ((tile.isTeleporter || tile.teleportsToSelf) && allowTeleport && (w.cc3dPace || jumpsAtStepEnd)) {
    // The jump happens when the step that ended on the pad ends (see applyCc3dStepEnd); the pad's own item is still his.
    cc3dArrivalOf(w.player).teleport = { x, y, dir: entryDir };
  } else if ((tile.isTeleporter || tile.teleportsToSelf) && allowTeleport) {
    ctx.emitVisual('teleport', x, y);
    if (teleportPlayer(w, x, y, entryDir, w.ccRules, (px, py, item) => takeYellowPadOntoBelt(ctx, px, py, item))) {
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
      // CC2 engine: a yellow pad pushed off the belt onto the cell he arrives on is a teleporter under him. Lexy step_on_cell reads
      // the layers top down, the item first (attempt_take sets the pad down), then the terrain, now the pad (game.js:2310-2333), so he
      // jumps at the step end. A cell that was already a teleporter jumped above; a key pickup sets nothing down. Not modelled: a
      // monster or block never pushes a pad out (they hold no belt).
      if (usesCc2Engine(w.level) && !w.cc3dPace && !atStepEnd && allowTeleport && !(tile.isTeleporter || tile.teleportsToSelf)) {
        const now = ConfigRegistry.getTile(w.terrain[y][x]);
        if (now.isTeleporter || now.teleportsToSelf) cc3dArrivalOf(w.player).teleport = { x, y, dir: entryDir };
      }
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
  // CC2 engine: the tool thief takes every tool of the belt, so the counted ones (dynamite, the bowling ball, yellow teleports)
  // go with the boots (Lexy take_all_tools_from_actor, tiletypes.js:1236-1256; game.js:3377).
  const isCountedTool = (id: string): boolean => {
    const def = ConfigRegistry.getTile(id);
    return isBeltTool(def) && def.collectible !== 'boot';
  };
  const takesCountedTools =
    tile.stealsBoots === true && usesCc2Engine(w.level) && !w.cc3dPace && Object.entries(w.player.keys).some(([id, count]) => count > 0 && isCountedTool(id));
  const takesBoots = tile.stealsBoots === true && (w.player.boots.size > 0 || takesCountedTools);
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
      // The extra pairs of boots go with the worn ones (Lexy take_all_tools_from_actor takes every tool).
      if (usesToolBelt(w)) w.player.keys = Object.fromEntries(Object.entries(w.player.keys).filter(([id]) => ConfigRegistry.getTile(id).collectible !== 'boot'));
      if (takesCountedTools) w.player.keys = Object.fromEntries(Object.entries(w.player.keys).filter(([id]) => !isCountedTool(id)));
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

  // Fire, water, slime and a lit flame jet act when his step onto them ends, judged again on the cell then (judgeHazardAtStepEnd). A
  // player the hazard would kill is not drawn swimming while the step runs (Lexy swims only a waterproof player, tiletypes.js 202-208);
  // inWater is assigned before the early return, so the deferral never leaves a stale value.
  const waits = !atStepEnd && hazardWaitsForStepEnd(w, tile);
  w.player.inWater = tile.hazard === 'water' && !(waits && !guardedAgainst(w.player, tile));
  if (waits) {
    deferHazardToStepEnd(w.player, x, y);
    if (tile.isLevelExit !== true) {
      evaluatePlayerSliding(w, tile, entryDir);
      return;
    }
  }
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
    // CC2 engine, last player: Lexy's exit.on_arrive fires when the step onto the exit ends (game.js 2176-2195 times the step by its
    // goal cell), and the level is won in that tic's action phase (game.js 1040-1043). So the exit is only noted here: applyCc3dStepEnd
    // reaches it, and the tick that follows wins. The exit is no slide tile, so the rest of the step runs at walking speed.
    if (usesCc2Engine(w.level) && !w.cc3dPace && !atStepEnd && w.parked.length === 0) {
      cc3dArrivalOf(w.player).exit = { x, y };
      evaluatePlayerSliding(w, tile, entryDir);
      return;
    }
    ctx.emitVisual('win', x, y);
    // Lexy's Labyrinth exit.on_arrive: the level is won when no player remains; otherwise this one leaves play.
    if (leaveThroughExit(w)) ctx.completeLevel();
    return;
  }

  evaluatePlayerSliding(w, tile, entryDir);
}

/**
 * Whether what a step of the player does on the cell it ends on waits for the end of the step (applyCc3dStepEnd): a
 * converted CC3D level and a CC2-engine level. A teleport on a CC2-engine level jumps at the step end too (jumpAtStepEnd), at the player's turn after the step.
 */
export function defersStepEffects(w: EpoxyWorld): boolean {
  return w.cc3dPace || usesCc2Engine(w.level);
}

/** Whether pressing the button `action` waits for the end of the step: every button on CC2, only the clone switch on CC3D. */
function defersButton(w: EpoxyWorld, action: string): boolean {
  return usesCc2Engine(w.level) || (w.cc3dPace && action === 'trigger_cloner');
}

/**
 * Whether a block decides before the player in Lexy's reverse list loop (listed after him: a clone appended without an
 * ordinal, or a higher ordinal), so its own decision has set its slide mode when he decides (game.js 1715-1718, 1985-1986).
 */
function listedAfterPlayer(w: EpoxyWorld, block: RuntimeEntity): boolean {
  const p = w.player.listOrdinal;
  return p !== undefined && (block.listOrdinal === undefined || block.listOrdinal > p);
}

/**
 * Whether the controlled player's red-button press at the end of a decision step waits for his slot in frame 1 of the
 * pre-pass (Lexy: the 12-frame or 6-frame step from frame 2 ends in frame 1, step_on_cell in his own action, after the actors listed
 * after him). Not while the pre-pass fires it (cc2PrePassFire).
 */
export function deferPlayerClonePress(w: EpoxyWorld, p: PlayerState, action: string | undefined): boolean {
  if (action !== 'trigger_cloner' || p !== w.player || w.cc2ActorOrder !== true || w.cc3dPace || !usesCc2Engine(w.level)) return false;
  if (w.parked.length > 0) return false;
  if (w.cc2PrePassFire === true) return false;
  return p.cc2SlideFrame === undefined && p.cc2FrameRetry !== true;
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
  if (stepStillRuns(p)) return true;
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
    // CC2 engine: the traps this press opens eject what they hold. He has stood on the button since his step began (Epoxy presses by
    // occupancy), so the trap reads open already: the press is the opening one when no other button linked to the trap is held.
    if (usesCc2Engine(w.level) && !w.cc3dPace) {
      for (const l of w.trapLinks) {
        if (l.buttonX !== p.x || l.buttonY !== p.y) continue;
        if (w.trapLinks.some((o) => o.trapX === l.trapX && o.trapY === l.trapY && (o.buttonX !== p.x || o.buttonY !== p.y) && isButtonPressed(w, o.buttonX, o.buttonY))) continue;
        if (!isCellClosedTrap(w, l.trapX, l.trapY)) ejectFromTrap(ctx, l.trapX, l.trapY);
      }
    }
  }
  if (pending.pulse !== undefined && p.x === pending.pulse.x && p.y === pending.pulse.y) notePulseArrival(w, pending.pulse.x, pending.pulse.y, null);
  if (pending.press !== undefined) {
    const { x, y } = pending.press;
    const tile = ConfigRegistry.getTile(w.terrain[y]?.[x]);
    if (p.x === x && p.y === y && deferPlayerClonePress(w, p, tile.buttonAction)) {
      // The press stays pending for the player's slot in frame 1 of the pre-pass (runPrePass).
      cc3dArrivalOf(p).press = { x, y };
    } else if (p.x === x && p.y === y && tile.buttonAction !== undefined && defersButton(w, tile.buttonAction) && !triggerButton(ctx, x, y, tile.buttonAction, !w.cc3dPace)) return false;
    if (!p.alive) return true;
  }
  // CC2 engine: the bomb is the item and the water or fire the terrain; Lexy step_on_cell walks the layers top down, the item first
  // (game.js 2315-2366), so a bomb lying on a hazard goes off before the hazard is judged.
  if (judgesHazardsAtStepEnd(w) && pending.bomb !== undefined && p.x === pending.bomb.x && p.y === pending.bomb.y && bombUnder(w, p.x, p.y)) {
    explodePlayerBomb(ctx, p.x, p.y);
    return true;
  }
  if (pending.hazard !== undefined && !judgeHazardAtStepEnd(ctx, pending.hazard)) return true;
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
  if (pending.exit !== undefined && (pending.exit.reached === true || (p.x === pending.exit.x && p.y === pending.exit.y && ConfigRegistry.getTile(w.terrain[p.y][p.x]).isLevelExit === true))) {
    // The step onto the exit has ended (Lexy exit.on_arrive): the level is won in the tick that follows (see GameEngine.tick).
    if (pending.exit.reached !== true) ctx.emitVisual('win', p.x, p.y);
    cc3dArrivalOf(p).exit = { x: pending.exit.x, y: pending.exit.y, reached: true };
  }
  if (pending.teleport !== undefined && !w.cc3dPace) {
    jumpAtStepEnd(ctx, pending.teleport);
  } else if (pending.teleport !== undefined) {
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
 * CC2 engine: the jump of the step that ended on a pad. He lands on the destination pad and the forced exit is taken at his next
 * turn (Lexy teleport-hard slide, game.js:2324-2373); a soft pad (red, yellow) opens his exit decision in the tick of the jump
 * (Lexy teleport-soft, tiletypes.js teleport_red and teleport_yellow, game.js:1600-1620).
 */
function jumpAtStepEnd(ctx: EpoxyContext, at: { x: number; y: number; dir: Direction }): void {
  const w = ctx.world;
  const p = w.player;
  const { x, y, dir } = at;
  if (p.x !== x || p.y !== y || !p.alive) return;
  ctx.emitVisual('teleport', x, y);
  if (!teleportPlayer(w, x, y, dir, w.ccRules, (px, py, item) => takeYellowPadOntoBelt(ctx, px, py, item))) return;
  ctx.emitVisual('teleport', w.player.x, w.player.y);
  resolvePlayerArrival(ctx, w.player.dir, false, true);
  if (onSoftPad(w)) w.player.softPadDue = true;
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

function evaluatePlayerSliding(w: EpoxyWorld, tile: ReturnType<typeof ConfigRegistry.getTile>, entryDir: Direction, resumed = false): void {
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
    // Wave 35 (RFP): on a one-player CC2 level a step onto a turning floor draws when it ends (Lexy on_stand at the arrival frame); a
    // carried try of a resting player (`resumed`) draws at once. Wave 35 (BTS): a player whose boots cancel the push draws nothing (Lexy:
    // a forceproof actor's on_stand returns before the draw).
    const bootsCancel = !!tile.protectedByItem && w.player.boots.has(tile.protectedByItem);
    const bootsSkip = bootsCancel && tile.forceCycle === true && rffActive(w);
    const rffDeferred = !bootsSkip && !resumed && tile.forceCycle === true && rffActive(w);
    if (rffDeferred) rffDefer(w.player, rffStepStart(w, w.cc2PrePassPlayer === true ? w.cc2PrePassFrame : undefined));
    // The arrival counts on the shared turn even when boots protect the player from the push
    // (except on a one-player CC2 level, wave 35 BTS: no draw).
    const cycleDir = rffDeferred || bootsSkip ? null : forceCycleArrival(w, tile);
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
 * CC2 engine: the step ends of the parked players, in swap order, at the start of the tick right after the controlled player's flush
 * (GameEngine.flushCc2StepEnd) and before the time-out check, as a pass-closing phase (cc2BeforePass). Lexy runs every player's
 * step_on_cell at the end of his 12-frame step, the tick after the wait ran out (game.js 2310-2367), not in the tick it runs out.
 * Returns false when one of them ended the level or killed the controlled player.
 */
export function flushParkedStepEnds(ctx: EpoxyContext): boolean {
  const w = ctx.world;
  if (!judgesHazardsAtStepEnd(w) || w.parked.length === 0) return w.player.alive && !w.levelCompleted;
  w.cc2BeforePass = true;
  try {
    for (const parked of [...w.parked]) {
      if (!w.player.alive || w.levelCompleted) break;
      if (parked.cc3dArrival === undefined || !w.parked.includes(parked)) continue;
      withPlayer(w, parked, () => applyCc3dStepEnd(ctx));
    }
  } finally {
    w.cc2BeforePass = undefined;
  }
  return w.player.alive && !w.levelCompleted;
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
      // CC2 engine: the step ends of the parked players run at the start of the next tick (flushParkedStepEnds), not here.
      const stepEndsAtTickStart = judgesHazardsAtStepEnd(w);
      if (w.player.moveCooldown > 0) w.player.moveCooldown--;
      if (defersStepEffects(w) && !stepEndsAtTickStart) applyCc3dStepEnd(ctx);
      if (w.player.isSliding) {
        if (w.player.slideCooldown > 0) {
          w.player.slideCooldown--;
          if (defersStepEffects(w) && !stepEndsAtTickStart && w.player.slideCooldown === 0) applyCc3dStepEnd(ctx);
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
    // CC2 engine: the exit is taken at his turn after the jump, which counted a tick of its wait already: a walking wait less one.
    w.player.moveCooldown = Math.max(w.player.moveCooldown, playerWalkCooldown(w) - (usesCc2Engine(w.level) ? CC2_TELEPORT_EXIT_COUNTED_TICKS : 0));
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

/** CC2 engine: whether a refused forced step is on a turning force floor that carries the controlled player (the bonk turns the floor). */
function refusedOnTurningForceFloor(w: EpoxyWorld, tile: TileDefinition, mover: PlayerState): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace && tile.forceCycle === true && isCarriedByForceFloor(w, tile) && mover === w.player && w.player.alive;
}

export function processPlayerSlideStep(ctx: EpoxyContext): void {
  const w = ctx.world;
  drawRffPlayer(w, true);
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
    } else if (refusedOnTurningForceFloor(w, currentTile, mover)) {
      // CC2 engine: a refused forced step on a turning (random) force floor steps on the cell again, which turns the floor, and
      // tries the new way at once (Lexy _possibly_bonk, game.js:1127-1162). One floor turn per try.
      const redraw = forceCycleArrival(w, currentTile);
      if (redraw !== null && redraw !== dir) {
        w.player.slideDir = redraw;
        w.player.dir = redraw;
        steppedOff = executePlayerMove(ctx, redraw, true);
      }
      if (!steppedOff && w.player === mover) {
        // The floor has turned already: the next try goes the way he now faces, without a second turn.
        w.player.isSliding = true;
        w.player.slideDir = w.player.dir;
        w.player.slideCooldown = 0;
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
  // CC2 engine: a slide step of the main turn is a frame-2 step (it ends the slide frame); a forced step on a force floor that stayed
  // refused retries in frames 0 and 1 of the next tick (pre-pass). Only the controlled player in his own slot carries the marks.
  if (w.cc2PrePassPlayer !== true && usesCc2Engine(w.level) && !w.cc3dPace && w.swappedIn === null && mover === w.player) {
    delete mover.cc2SlideFrame;
    if (!steppedOff && currentTile.slideType === 'force') mover.cc2FrameRetry = true;
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

/** Ticks left on the controlled player's step: the move wait, or the slide wait while he slides (how far behind to draw him). */
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
 * CC2 engine: records where the controlled player appears to be, at the end of a tick, so the teeth of the next tick
 * (which run after this tick's input moved him, but aim where he stood before it) read his position at the start of it.
 * A step in progress puts him `cooldown / stepLength` of a cell behind his cell; the step length is the real one (ice,
 * force floors, speed boots), read from the cooldown the step was given.
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
