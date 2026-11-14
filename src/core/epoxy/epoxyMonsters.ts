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

import { usesCc2Engine } from './ccRules';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { AudioManager } from '../../audio/AudioManager';
import {
  CC_BLOB_BUTTON_DELAY_PASSES,
  EMULATE_CYCLE_PATTERN,
  CC_BLOB_TYPE,
  STEER_MONSTERS_ACTION,
  CC_MONSTER_BUTTON_DELAY_PASSES,
  CC_WALKER_TYPE,
  followsCcCadence,
  followsTeethPhase,
  CC2_ENTITY_TOOL_CAPACITY,
  CC2_FLOOR_STEP_DIVISOR,
  CC2_MONSTER_PASSABLE_KEYS,
  CC2_MONSTER_PICKED_KEY,
  CC3D_MONSTER_FLOOR_STEP_TICKS,
  CC3D_MONSTER_STEP_TICKS,
  CC3D_REST_PHASE_TICKS,
  CC3D_RESTING_TYPES,
  ccStepTicks,
  CHASE_PLAYER_PATTERN,
  DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
  FLEE_PLAYER_PATTERN,
  FLOOR_TILE_ID,
  FORWARD_ELSE_DRAW_PATTERN,
  MONSTER_IGNORED_KEY_COLOR,
  MONSTER_PICKUP_COLLECTIBLES,
  OPPOSITE_DIRECTION,
  PHASE_LINE_PATTERN,
  RANDOM_DRAW_PATTERN,
  STATIONARY_PATTERN,
  STONE_DEATH_REASON_KEY,
  teethMayDecide,
  TURTLE_TILE_ID
} from '../coreConstants';
import { cellHasCanopy } from '../EdgeRules';
import { isPhasingEntityType } from '../RulesetFeatures';
import { ButtonAction, CcArrival, Direction, EntityDefinition, RelativeTurn, RuntimeEntity, TileDefinition } from '../types';
import { isCc2YellowTank, markYellowButtonArrival } from './epoxySteering';
import { CC2_BLOB_BEHAVIOR_DEFAULT, CcGenerators, drawBlobDirection, drawCc2BlobDirection, drawWalkerByte, drawWalkerTurn } from './ccGenerators';
import { attemptPushBlock, canPushBlock, eraseSplash, leaveSplash, pruneSplashes, stepSlidingBlock } from './epoxyBlocks';
import { isLitChargeItem } from './epoxyCharges';
import { advanceEmulation, emulatedDef } from './epoxyEmulation';
import { forceCycleArrival } from './epoxyForceCycle';
import { stepMirrorFloor } from './epoxyMirrors';
import { followRail } from './epoxyRails';
import { railRedirect } from './epoxyRailsCc2';
import { absorbMonsterContact, shieldedFromContact, shieldedPlayerAt } from './epoxyWard';
import { bumpRollingBall, checkBallWay, isRollingBallDef } from './epoxyRollingBall';
import { consumeShotAt, killMonsterByShot } from './epoxyShots';
import { enterSwivel, leaveSwivel } from './epoxySwivels';
import {
  EpoxyContext,
  EpoxyWorld,
  applyRelativeTurn,
  consumeFishGate,
  getEntityAt,
  isCellClosedTrap,
  isEdgeBlocked,
  isInBounds,
  isOpenFishGate,
  monsterLeavesCell,
  mapWidth,
  monsterSlowdown,
  notePulseArrival,
  playerCharacterOf,
  playersOf,
  removeEntity,
  playerAtCell,
  takeRevealedTerrain,
  withPlayer,
  killPlayerAt
} from './epoxyWorld';
import { turnMarkedTanks } from './epoxyDevices';

export function updateEntities(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (w.ccRules) turnMarkedTanks(w);
  if (w.ccRules) {
    if (!applyQueuedPassStartArrivals(ctx)) return;
  } else if (w.cc3dPace) {
    dropOrphanArrivals(w);
  }
  w.ccPassOpen = w.ccRules || w.cc3dPace;
  try {
    if (w.ccRules && !planClassicDecisions(ctx)) return;
    const passClock = w.ccMonsterClock;
    runEntityPass(ctx);
    // CC2 engine: a green toggle a monster's step queued is applied after the entity pass (Lexy do_post_actor_phase).
    if (w.ccRules && usesCc2Engine(w.level) && w.player.alive && !applyQueuedArrivals(ctx, undefined, passClock, true)) return;
  } finally {
    w.ccPassOpen = false;
    w.ccPlans.clear();
    w.entityPassSeen.clear();
    w.turnSpent.clear();
    pruneSplashes(w);
  }
}

/**
 * CC2 engine: the queued presses applied at the start of an entity pass close the previous tick, so a clone machine they
 * trigger counts the clone down one tick longer (w.cc2BeforePass). Other levels apply them as before.
 */
function applyQueuedPassStartArrivals(ctx: EpoxyContext): boolean {
  const w = ctx.world;
  if (!usesCc2Engine(w.level)) return applyQueuedArrivals(ctx);
  // A teleport waits for its monster's own turn (applied there); one whose monster is gone is void.
  if (w.ccArrivals.some((a) => a.teleport === true)) {
    w.ccArrivals = w.ccArrivals.filter((a) => a.teleport !== true || w.entities.some((e) => e.uid === a.uid));
  }
  w.cc2BeforePass = true;
  try {
    return applyQueuedArrivals(ctx);
  } finally {
    w.cc2BeforePass = undefined;
  }
}

/**
 * Classic rules, start of an entity pass: applies the monster button presses whose time has come, in the order they
 * were queued. A press is void when its monster is gone or has left the button. Returns false when a press killed
 * the player (the pass then stops).
 */
function applyQueuedArrivals(ctx: EpoxyContext, ownerUid?: number, passClock?: number, endOfPass = false): boolean {
  const w = ctx.world;
  if (w.ccArrivals.length === 0) return true;
  const pass = passClock ?? w.ccMonsterClock;
  // CC2 engine: the presses are applied at the start of the pass, the teleports in the own turn of their monster, the green
  // toggles after the pass (endOfPass).
  const cc2 = usesCc2Engine(w.level);
  const isDue = (a: CcArrival): boolean =>
    a.due <= pass &&
    (ownerUid === undefined || a.uid === ownerUid) &&
    (!cc2 || (a.teleport === true) === (ownerUid !== undefined)) &&
    (!(cc2 && ownerUid === undefined) || (a.action === 'toggle_walls') === endOfPass);
  const due = w.ccArrivals.filter(isDue);
  if (due.length === 0) return true;
  w.ccArrivals = w.ccArrivals.filter((a) => !isDue(a));
  w.ccArrivalsRunning = true;
  try {
    for (const arrival of due) {
      const monster = w.entities.find((e) => e.uid === arrival.uid);
      if (monster === undefined || monster.x !== arrival.x || monster.y !== arrival.y) continue;
      if (arrival.removal !== undefined) {
        applyPendingRemoval(ctx, monster);
        continue;
      }
      if (arrival.teleport === true) {
        if (!(cc2 ? applyStepEndTeleport(ctx, monster) : applyQueuedTeleport(ctx, monster, arrival, pass))) return false;
        continue;
      }
      // The button fires what it is now: a tile changed since the step fires its current action, or nothing.
      const tile = ConfigRegistry.getTile(w.terrain[arrival.y]?.[arrival.x]);
      if (arrival.action === undefined || tile.buttonAction === undefined || tile.buttonWorkedBy === 'player') continue;
      if (!ctx.triggerButton(arrival.x, arrival.y, tile.buttonAction)) return false;
    }
  } finally {
    w.ccArrivalsRunning = false;
  }
  return true;
}

/**
 * CC3D: a monster whose step ended on a teleporter is moved onto the destination pad when that step ends, then makes
 * a fast exit step of its own (the speed orb factor applies to it). Returns false when the exit cell killed the player.
 * Cooldown arithmetic. A floor step that starts in the pass it moves sets `ticks * slowdown - 1` (stepMonster): the
 * move pass is tick one, the countdown covers the other ticks-1. The exit step is different in two ways: it starts on
 * the tick after the teleport pass (the teleport is the last tick of the entry step), which adds one tick, and the
 * pass that applies the teleport also runs stepMonsterCore, which spends one tick of the countdown at once, which
 * adds another. So `ticks * slowdown - 1 + 1 + 1`, that is `ticks * slowdown + 1`; the monster decides again
 * three ticks after the teleport (the fast step's two ticks, counted from the tick after the teleport).
 */
function applyQueuedTeleport(ctx: EpoxyContext, monster: RuntimeEntity, arrival: CcArrival, pass: number): boolean {
  const w = ctx.world;
  if (!ctx.teleportEntity(monster, arrival.x, arrival.y, monster.dir, true)) return true;
  // The monster stands on the destination pad now and leaves by the forced fast step on the next tick: the cooldown
  // of 1 is spent by this very pass, so the next pass takes the step (see stepMonsterCore).
  monster.cooldownTicks = 1;
  const queued = w.ccArrivals.length;
  if (!resolveMonsterArrival(ctx, monster, false)) return false;
  // What the pad does to the monster acts at the end of the arrival tick, with the exit step still to come.
  for (let i = queued; i < w.ccArrivals.length; i++) {
    if (w.ccArrivals[i].uid === monster.uid) w.ccArrivals[i].due = pass;
  }
  return true;
}

/**
 * CC2 engine: a monster whose step ended on a teleporter (not the green one) goes through in its own turn of that pass: it
 * stands on the destination pad, and its next decision is the forced exit (see stepMonsterCore). The countdown is left as it
 * is: it reaches 0 in this very pass. Returns false when the arrival killed the player.
 */
function applyStepEndTeleport(ctx: EpoxyContext, monster: RuntimeEntity): boolean {
  if (!ctx.teleportEntity(monster, monster.x, monster.y, monster.dir, true)) return true;
  return resolveMonsterArrival(ctx, monster, false);
}

/** A converted CC3D level fires a press in its monster's own turn: a press whose monster is gone is void. */
function dropOrphanArrivals(w: EpoxyWorld): void {
  if (w.ccArrivals.length === 0) return;
  w.ccArrivals = w.ccArrivals.filter((a) => w.entities.some((e) => e.uid === a.uid));
}

/**
 * Classic rules, decision pass: every classic monster that is ready decides its way now, the entities taken in reverse
 * list order; the movement pass (also in reverse order) then tries each decided step once. A monster boxed in plans the
 * way it was turned to face, and tries it when its turn to move comes. Returns false when a decision killed the player
 * (a rolling ball blowing up on him), and the pass then stops.
 */
function planClassicDecisions(ctx: EpoxyContext): boolean {
  const w = ctx.world;
  w.ccPlans.clear();
  const clock = w.ccMonsterClock;
  // A fireball melting an ice block removes it from the list while the pass runs: the pass walks the list as it was.
  const decisionOrder = w.entities.slice();
  // Uids are never reused, so a change in the removed set tells that an actor was removed during the pass.
  const removedAtStart = w.removedUids.size;
  const removedDuringPass = (entity: RuntimeEntity): boolean => w.removedUids.size !== removedAtStart && !w.entities.includes(entity);
  for (let i = decisionOrder.length - 1; i >= 0; i--) {
    const entity = decisionOrder[i];
    // A rolling ball that blows up takes the actor in its way, or the one that probed it, with it: that one decides nothing.
    if (removedDuringPass(entity)) continue;
    if (isCc2YellowTank(w, entity)) {
      if (!planYellowTankCarried(w, entity)) planYellowTank(w, entity, clock);
      continue;
    }
    if (entity.kind === 'block' || !followsCcCadence(entity.type, usesCc2Engine(w.level)) || entity.cooldownTicks !== 0) continue;
    if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine) continue;
    // CC2 engine: a monster a teleporter put on its pad leaves by the forced exit as its next decision: no way is drawn for it.
    if (entity.teleportExit !== undefined && usesCc2Engine(w.level)) continue;
    if (followsTeethPhase(entity.type, usesCc2Engine(w.level)) && !teethMayDecide(clock, usesCc2Engine(w.level))) continue;
    const def = ConfigRegistry.getEntityDef(entity.type);
    // A phasing monster (a wisp) and a monster the floor does not affect (a ghost) are not held by a closed trap.
    const heldByFloor = def?.movementPattern !== PHASE_LINE_PATTERN && def?.ignoresFloorEffects !== true;
    if (heldByFloor && isCellClosedTrap(w, entity.x, entity.y)) {
      // A held monster keeps its facing and decides nothing; if the trap opens during the movement pass it is
      // released in that facing.
      w.ccPlans.set(entity.uid, entity.dir);
      continue;
    }
    // CC2 engine: a rover decides with the behaviour it imitates, and each decision is counted here, once; its step
    // does not count it again. A decision on a sliding floor is not one (Lexy decides nothing while an actor slides).
    const cc2 = usesCc2Engine(w.level);
    const sliding = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).slideType !== undefined;
    const behaviour = sliding ? emulatedDef(entity, def) : advanceEmulation(entity, def);
    // A rover imitating teeth chases only in the teeth window and decides nothing otherwise: it waits and decides again next tick.
    const behaviourType = behaviour?.id ?? entity.type;
    if (def?.emulates !== undefined && !sliding && followsTeethPhase(behaviourType, cc2) && !teethMayDecide(clock, cc2)) {
      w.ccPlans.set(entity.uid, null);
      continue;
    }
    let plan = chooseMonsterDirection(w, entity, behaviour);
    // CC2 engine: a monster on ice plans the slide way without a collision check; a refused step bounces when it is tried.
    if (usesCc2Engine(w.level) && def?.ignoresFloorEffects !== true && def?.ignoresSlidingFloors !== true) {
      const iceHere = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]);
      // Lexy ice has no on_ready: a monster still on its load cell has no pending slide and decides normally.
      if (iceHere.slideType === 'ice' && entity.atLoadCell !== true) plan = iceHere.deflectionMap?.[entity.dir] || entity.dir;
    }
    if (plan === null && ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).slideType === undefined && !(followsTeethPhase(behaviourType, cc2) && entity.x === w.player.x && entity.y === w.player.y)) {
      plan = entity.dir;
    }
    // CC2 engine: every monster decides first and moves after (Lexy game.js:960-1074), so a monster on a force floor plans the
    // forced way even when the cell ahead is held by a monster that leaves it earlier in this pass; the move is tried in its turn.
    if (plan === null && usesCc2Engine(w.level)) plan = blockedForcedPlan(w, entity, def);
    // A rolling ball judges the way at its decision: what blocks it is killed or it blows up, there and then.
    if (isRollingBallDef(def) && !checkBallWay(ctx, entity, plan ?? entity.dir)) return false;
    // The entity may be gone by now (the ball blew up, or the monster probed one).
    if (removedDuringPass(entity)) continue;
    w.ccPlans.set(entity.uid, plan);
  }
  return true;
}

/**
 * CC2 engine: a yellow tank that stands on ice or on a force floor is carried by it (its pending steer waits for the first
 * decision after the slide). A tank still on its load cell on ice is not: ice has no pending slide at load, so it takes its
 * pending steer there (a tank loaded on a force floor is carried on its first idle tick). Returns whether the floor planned it.
 */
function planYellowTankCarried(w: EpoxyWorld, tank: RuntimeEntity): boolean {
  if (tank.cooldownTicks !== 0 || tank.atLoadCell === true) return false;
  const def = ConfigRegistry.getEntityDef(tank.type);
  if (def?.ignoresSlidingFloors === true || def?.ignoresFloorEffects === true) return false;
  const here = ConfigRegistry.getTile(w.terrain[tank.y]?.[tank.x]);
  if (here.slideType === 'ice') {
    w.ccPlans.set(tank.uid, here.deflectionMap?.[tank.dir] || tank.dir);
    return true;
  }
  if (here.slideType === 'force' && here.forceDirection !== undefined && here.forceDirection !== 'RANDOM') {
    w.ccPlans.set(tank.uid, here.forceDirection);
    return true;
  }
  return false;
}

/**
 * CC2 engine, a yellow tank at its decision: it takes the pending way a button arrival set, once that arrival's step has
 * ended. The way is judged now, so a tank blocked then only turns (Lexy tank_yellow decides [way, null]).
 */
function planYellowTank(w: EpoxyWorld, tank: RuntimeEntity, clock: number): void {
  const pending = tank.pendingSteer;
  if (tank.cooldownTicks !== 0 || pending === undefined || (tank.pendingSteerDue ?? 0) > clock) return;
  // Lexy make_actor_decision decides nothing, and keeps the pending decision, while the actor stands on a clone
  // machine, sits in a closed trap or slides: the steer waits for the first decision after that.
  const def = ConfigRegistry.getEntityDef(tank.type);
  const here = ConfigRegistry.getTile(w.terrain[tank.y]?.[tank.x]);
  const floorFree = def?.ignoresSlidingFloors === true || def?.ignoresFloorEffects === true;
  if (here.isCloneMachine) return;
  if (def?.ignoresFloorEffects !== true && isCellClosedTrap(w, tank.x, tank.y)) return;
  if (!floorFree && here.slideType !== undefined && tank.atLoadCell !== true) return;
  delete tank.pendingSteer;
  delete tank.pendingSteerDue;
  tank.dir = pending;
  w.ccPlans.set(tank.uid, canStep(w, tank, pending) ? pending : null);
}

/** CC2 engine: the way a monster on ice goes when its planned step `plan` is refused (turned round, then deflected by the ice corner); null elsewhere. */
function iceBounceDirection(w: EpoxyWorld, entity: RuntimeEntity, def: EntityDefinition | undefined, plan: Direction): Direction | null {
  if (!usesCc2Engine(w.level) || def?.ignoresFloorEffects === true || def?.ignoresSlidingFloors === true) return null;
  const here = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]);
  if (here.slideType !== 'ice') return null;
  return here.deflectionMap?.[OPPOSITE_DIRECTION[plan]] || OPPOSITE_DIRECTION[plan];
}

/** The way a floor forces a monster, for the CC2 plan of a monster whose forced move is blocked right now; null when the floor does not decide for it. */
function blockedForcedPlan(w: EpoxyWorld, entity: RuntimeEntity, def: EntityDefinition | undefined): Direction | null {
  if (def === undefined || def.movementPattern === PHASE_LINE_PATTERN || def.ignoresSlidingFloors === true || def.ignoresFloorEffects === true) return null;
  const here = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]);
  if (here.slideType !== 'force' || here.forceCycle === true || here.forceDirection === undefined || here.forceDirection === 'RANDOM') return null;
  return here.forceDirection;
}

function runEntityPass(ctx: EpoxyContext): void {
  const w = ctx.world;
  w.removedUids.clear();
  const clock = w.ccMonsterClock;
  if (w.ccRules || w.cc3dPace) w.ccMonsterClock++;
  const snapshotEntities = [...w.entities];
  // The classic game moves its creatures from the end of the list to the start.
  if (w.ccRules) snapshotEntities.reverse();
  // CC2 engine: the blocks whose slide was refused on a force floor in this pass (see the retry after the loop).
  const refusedOnForce: RuntimeEntity[] = [];
  for (const entity of snapshotEntities) {
    if (w.removedUids.has(entity.uid)) continue;
    if (w.cc3dPace) {
      w.entityPassSeen.add(entity.uid);
      // CC3D fires a monster's button press inside that monster's own turn, so the monsters ahead of it in the list
      // acted on the old state of what the button works.
      if (!applyQueuedArrivals(ctx, entity.uid, clock)) return;
      if (w.removedUids.has(entity.uid)) continue;
    } else if (w.ccRules && w.ccArrivals.length > 0 && usesCc2Engine(w.level)) {
      // CC2 engine: the teleport that ends the step of this monster happens in its own turn.
      if (!applyQueuedArrivals(ctx, entity.uid, clock)) return;
      if (w.removedUids.has(entity.uid)) continue;
    }

    // Entities sitting directly on a clone machine act as templates and do not move on their own
    // (a wisp is never a template: it drifts over a machine like over any other tile)
    if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine && !isPhasingEntityType(entity.type)) {
      continue;
    }

    if (entity.kind === 'block') {
      if (stepSlidingBlock(ctx, entity).refusedOnForce === true) refusedOnForce.push(entity);
      continue;
    }

    if (!(w.ccRules && followsCcCadence(entity.type, usesCc2Engine(w.level)) ? stepClassicMonster(ctx, entity, clock) : stepMonster(ctx, entity))) return;
  }
  // CC2 runs its actors in frames of a tic: a block refused on a force floor behind another block tries once more in the next
  // frame, when the block ahead has left. The list is local to the pass; a block that moved, melted or was removed is skipped.
  if (usesCc2Engine(w.level)) {
    for (const block of refusedOnForce) {
      if (w.removedUids.has(block.uid) || !w.entities.includes(block) || block.isSliding) continue;
      stepSlidingBlock(ctx, block);
    }
  }
}

/**
 * Classic Chip's Challenge cadence for one monster of a classic-rules level: a decision every few ticks (see
 * stepMonster), teeth deciding only in the first half of their cycle, and a monster that did not move retrying on
 * the next tick instead of waiting out a step. `clock` is the number of entity passes that ran before this one.
 * A transmogrifier swapping the type mid-step keeps the cooldown that is running; the new type's cadence applies to
 * the step after it.
 */
function stepClassicMonster(ctx: EpoxyContext, entity: RuntimeEntity, clock: number): boolean {
  if (entity.cooldownTicks === 0 && followsTeethPhase(entity.type, usesCc2Engine(ctx.world.level)) && !teethMayDecide(clock, usesCc2Engine(ctx.world.level))) return true;
  const ready = entity.cooldownTicks === 0;
  const x = entity.x;
  const y = entity.y;
  const alive = stepMonster(ctx, entity);
  // The first step away from the load cell forgets it: the ice there is an ordinary slide from now on.
  if (entity.atLoadCell === true && (entity.x !== x || entity.y !== y)) delete entity.atLoadCell;
  // Like the original, a creature that could not move (a blocked decision, a held trap, a blocked forced move on a
  // slide tile) tries again on the next tick.
  if (ready && entity.x === x && entity.y === y && entity.cooldownTicks > 0) entity.cooldownTicks = 0;
  else if (ready && alive && usesCc2Engine(ctx.world.level) && entity.cooldownTicks > 0 && !ctx.world.removedUids.has(entity.uid)) {
    // CC2 takes the step time from the destination: a step onto ice or a force floor lasts a share of the plain step.
    const def = ConfigRegistry.getEntityDef(entity.type);
    const floorFree = def?.ignoresSlidingFloors === true || def?.ignoresFloorEffects === true;
    const destSlide = ConfigRegistry.getTile(ctx.world.terrain[entity.y]?.[entity.x]).slideType;
    if (!floorFree && (destSlide === 'ice' || destSlide === 'force')) {
      entity.cooldownTicks = Math.floor(ccStepTicks(entity.type) / CC2_FLOOR_STEP_DIVISOR) * monsterSlowdown(ctx.world) - 1;
    }
  }
  return alive;
}

/**
 * Runs a classic step of `entity` now, outside the entity pass (the first step of a rolling ball that is set down). The caller set the
 * way in `w.ccPlans`. Returns false when the player was killed.
 */
export function stepClassicMonsterOutOfTurn(ctx: EpoxyContext, entity: RuntimeEntity): boolean {
  return stepClassicMonster(ctx, entity, ctx.world.ccMonsterClock);
}

/**
 * Advances one monster of the entity loop by a tick. Returns false when the player was killed, so the loop stops.
 * On a converted CC3D level the rest after a step follows the CC3D pace: shorter when the floor carried the monster, and
 * a snappy or nibble that chose its step keeps a rest (`restTicks`) that runs beside the step and outlasts a slide.
 */
function stepMonster(ctx: EpoxyContext, entity: RuntimeEntity): boolean {
  const w = ctx.world;
  if (!w.cc3dPace) return stepMonsterCore(ctx, entity);
  const def = ConfigRegistry.getEntityDef(entity.type);
  const floorFree = def?.ignoresSlidingFloors === true || def?.ignoresFloorEffects === true;
  const slowdown = monsterSlowdown(w);
  const resting = (entity.restTicks ?? 0) > 0;
  if (resting && --(entity.restTicks as number) === 0) delete entity.restTicks;
  const ready = entity.cooldownTicks === 0;
  const fromX = entity.x;
  const fromY = entity.y;
  const leftSlide = !floorFree && ConfigRegistry.getTile(w.terrain[fromY]?.[fromX]).slideType !== undefined;
  // A resting monster decides nothing, but the floor still carries it.
  if (ready && resting && !leftSlide) return true;
  const queuedBefore = w.ccArrivals.length;
  const exitWanted = ready ? entity.teleportExit : undefined;
  const alive = stepMonsterCore(ctx, entity);
  if (!ready || !alive || entity.cooldownTicks === 0 || w.removedUids.has(entity.uid)) return alive;
  const rests = CC3D_RESTING_TYPES.includes(entity.type);
  if (entity.x === fromX && entity.y === fromY) {
    // A blocked or held monster tries again at once; a snappy and a nibble rest a step's worth first.
    entity.cooldownTicks = 0;
    if (rests) entity.restTicks = CC3D_REST_PHASE_TICKS * slowdown - 1;
    return alive;
  }
  // The forced exit step off a teleporter pad is the fast floor step.
  if (exitWanted !== undefined && entity.dir === exitWanted) {
    entity.cooldownTicks = CC3D_MONSTER_FLOOR_STEP_TICKS * slowdown - 1;
    retimeQueuedPresses(w, entity, queuedBefore);
    return alive;
  }
  const enteredSlide = !floorFree && ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).slideType !== undefined;
  // A step the floor carried, or one that enters ice or a force floor, lasts the fast floor step.
  if (leftSlide || enteredSlide) entity.cooldownTicks = CC3D_MONSTER_FLOOR_STEP_TICKS * slowdown - 1;
  else if (rests) entity.cooldownTicks = CC3D_MONSTER_STEP_TICKS * slowdown - 1;
  // A step they chose starts the rest, counted from the end of that step; a step the floor carried does not.
  if (rests && !leftSlide) entity.restTicks = entity.cooldownTicks + CC3D_REST_PHASE_TICKS * slowdown;
  retimeQueuedPresses(w, entity, queuedBefore);
  return alive;
}

/** The presses the monster queued in this step (from index `first` on) are applied when its step ends: the pass its cooldown runs out in. */
function retimeQueuedPresses(w: EpoxyWorld, entity: RuntimeEntity, first: number): void {
  const passesCounted = w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1;
  for (let i = first; i < w.ccArrivals.length; i++) {
    if (w.ccArrivals[i].uid === entity.uid) w.ccArrivals[i].due = passesCounted + entity.cooldownTicks - 1;
  }
}

function stepMonsterCore(ctx: EpoxyContext, entity: RuntimeEntity): boolean {
  const w = ctx.world;
  // A steered monster never decides a step by itself. On a CC2-engine level a yellow tank takes the decision a button
  // arrival set for it (planned in the decision pass); on any other level it moves only when a steering pad is worked.
  const yellowTank = isCc2YellowTank(w, entity);
  if (yellowTank) {
    if (entity.cooldownTicks > 0) {
      entity.cooldownTicks--;
      return true;
    }
    if (!w.ccPlans.has(entity.uid)) return true;
  } else if (ConfigRegistry.getEntityDef(entity.type)?.steeredBy !== undefined) return true;
  // A mirror player moves with the player; on its own it is only carried by the floor (ice, a force floor).
  if (ConfigRegistry.getEntityDef(entity.type)?.mirrorsCharacter !== undefined) return stepMirrorFloor(ctx, entity);
  // A sleeping lurker never moves by itself; only the player's arrival next to it changes it.
  if (ConfigRegistry.getEntityDef(entity.type)?.movementPattern === STATIONARY_PATTERN) return true;
  if (entity.cooldownTicks > 0) {
    entity.cooldownTicks--;
    return true;
  }

  const def = ConfigRegistry.getEntityDef(entity.type);
  // A step lasts interval + 1 ticks (the countdown, then the move); slow-time boots stretch the whole step.
  const interval = def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS;
  const stepTicks = yellowTank || (w.ccRules && followsCcCadence(entity.type, usesCc2Engine(w.level))) ? ccStepTicks(entity.type) : interval + 1;
  entity.cooldownTicks = stepTicks * monsterSlowdown(w) - 1;

  // A phasing monster (a wisp) is not held by a closed trap and touches no tile: terrain has no effect on it.
  const phases = def?.movementPattern === PHASE_LINE_PATTERN;
  // A monster the floor does not affect (a ghost) is not held by a trap and turns no swivel door either.
  const floorFree = def?.ignoresFloorEffects === true;
  if (!phases && !floorFree && isCellClosedTrap(w, entity.x, entity.y)) {
    return true;
  }

  // A rover decides each step with the behaviour of the monster it is imitating just now. Each decision is counted,
  // except while it slides (Lexy decides nothing then).
  const sliding = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).slideType !== undefined;
  // On a CC2-engine level the decision pass has already counted a rover's decision (it holds a plan): not counted twice.
  const behaviour = sliding || w.ccPlans.has(entity.uid) ? emulatedDef(entity, def) : advanceEmulation(entity, def);
  let chosenDir: Direction | null;
  // A monster a teleporter put on its destination pad leaves by a forced step; a blocked exit lets it decide normally.
  const exitDir = entity.teleportExit;
  delete entity.teleportExit;
  if (exitDir !== undefined && canStep(w, entity, exitDir)) {
    chosenDir = exitDir;
  } else if (exitDir !== undefined && usesCc2Engine(w.level)) {
    // CC2 engine: a blocked forced exit spends this decision (nothing is drawn); the monster decides normally on the next one.
    chosenDir = null;
  } else if (w.ccPlans.has(entity.uid)) {
    // Decided in the decision pass: the step is tried once; a refused step only turns the monster.
    const plan = w.ccPlans.get(entity.uid) ?? null;
    w.ccPlans.delete(entity.uid);
    const bounce = plan !== null ? iceBounceDirection(w, entity, def, plan) : null;
    if (plan !== null && canStep(w, entity, plan)) {
      chosenDir = plan;
    } else if (bounce !== null && canStep(w, entity, bounce)) {
      // Lexy game.js:1164-1214: refused on ice, the monster turns round, the ice corner deflects it, and it tries again at once.
      chosenDir = bounce;
    } else {
      chosenDir = null;
      if (plan !== null) entity.dir = plan;
      // A rolling ball whose step is refused when it is tried blows up as at its decision (what moved in is killed).
      if (plan !== null && isRollingBallDef(def)) {
        if (!checkBallWay(ctx, entity, plan)) return false;
        if (!w.entities.includes(entity)) return true;
      }
    }
  } else {
    chosenDir = chooseMonsterDirection(w, entity, behaviour);
  }
  // CC2 engine: a monster that probed a rolling ball was blown up with it: it takes no step.
  if (!w.entities.includes(entity)) return true;
  if (!chosenDir) {
    // Lexy re-decides every tic a blocked rover waits, so a blocked rover counts one decision per tick.
    // A monster that draws its way at random (the CC3D omni) draws again next tick when the draw is blocked.
    if (def?.emulates !== undefined || def?.movementPattern === RANDOM_DRAW_PATTERN || def?.movementPattern === FORWARD_ELSE_DRAW_PATTERN) {
      entity.cooldownTicks = 0;
    }
    return true;
  }

  // On a Chip's Challenge 2 track cell the step the monster chose is turned onto the track (the identity elsewhere).
  const moveDir = phases || floorFree ? chosenDir : railRedirect(w, entity.x, entity.y, chosenDir, 'walker');
  const vec = DIRECTION_VECTORS[moveDir];
  const nx = entity.x + vec.dx;
  const ny = entity.y + vec.dy;
  // A monster that pushes (the CC2 rover) moves the block in its way first; the cell is taken only when the block left it.
  if (def?.pushesBlocks === true) {
    const occupant = getEntityAt(w, nx, ny);
    if (occupant !== undefined && occupant.kind === 'block') {
      attemptPushBlock(ctx, occupant, moveDir, false, true);
      if (!w.player.alive) return false;
      if (getEntityAt(w, nx, ny) !== undefined) return true;
      // The push may have pressed a button that changed the cell (a toggle wall closing): judge the cell again, without
      // pushing, and stay put when it no longer lets the rover in. The block stays where the push left it.
      if (!canMonsterEnter(w, entity, moveDir)) return true;
    }
  }
  // A step into a tile that monsters reveal reveals it and is refused: the monster stays (CC3D, at the attempt only).
  if (!phases && revealOnAttempt(w, def, nx, ny)) return true;
  if (!phases && !floorFree) leaveSwivel(w, entity.x, entity.y, moveDir);
  if (def?.trailTile !== undefined) leaveTrail(w, entity, def.trailTile);
  // A monster that may enter turtles sinks the one it leaves, unless it leaves turtles afloat.
  monsterLeavesCell(w, entity);
  entity.x = nx;
  entity.y = ny;
  entity.dir = moveDir;

  return phases ? resolvePhasedArrival(ctx, entity) : resolveMonsterArrival(ctx, entity, true);
}

/**
 * A monster that tries to enter a tile every actor reveals (the CC3D appearing wall) turns it into the terrain it hides.
 * Returns true when it did, and the step is then refused. A monster that walks through solid tiles or names the tile
 * among those it passes is not stopped by it.
 */
function revealOnAttempt(w: EpoxyWorld, def: EntityDefinition | undefined, x: number, y: number): boolean {
  const tileId = w.terrain[y][x];
  const tile = ConfigRegistry.getTile(tileId);
  if (tile.revealedByAny !== true || tile.revealsToOnTouch === undefined) return false;
  const passesSolid = def?.passesSolidTiles === true && def.blockedByTiles?.includes(tileId) !== true;
  if (passesSolid || def?.passesTiles?.includes(tileId) === true) return false;
  w.terrain[y][x] = tile.revealsToOnTouch;
  w.beamDirty = true;
  return true;
}

/** A monster with a trail that has stood on slime turns the plain, itemless floor cell it leaves into the trail tile (the CC3D omni leaves slime). */
function leaveTrail(w: EpoxyWorld, entity: RuntimeEntity, trailTile: string): void {
  if (entity.slimed !== true || w.terrain[entity.y][entity.x] !== FLOOR_TILE_ID || w.items[entity.y][entity.x]) return;
  w.terrain[entity.y][entity.x] = trailTile;
}

/**
 * The arrival of a phasing monster (a wisp) in its new cell. Terrain, items, buttons, teleporters and the
 * transmogrifier do nothing to it; only the player in the cell (a ward absorbs the contact, as for any monster)
 * and a flying shot count. Returns false when the player was killed, so the caller stops processing.
 */
function resolvePhasedArrival(ctx: EpoxyContext, entity: RuntimeEntity): boolean {
  const w = ctx.world;
  const touched = playerAtCell(w, entity.x, entity.y);
  if (touched !== undefined) {
    // A helmet shields from the contact: nothing happens (the monster is not removed, the player lives).
    if (shieldedFromContact(touched)) return true;
    if (withPlayer(w, touched, () => absorbMonsterContact(w, entity.uid))) return true;
    killPlayerAt(ctx, touched, 'hud.messages.death_monster', 'death');
    return false;
  }
  if (w.shots.length > 0 && consumeShotAt(w, entity.x, entity.y)) {
    killMonsterByShot(ctx, entity);
  }
  return true;
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
  const floorFree = def?.ignoresFloorEffects === true;
  if (!floorFree) {
    enterSwivel(w, nx, ny, entity.dir);
    // A rail turns the monster to the open side it did not come in by, so a forward move follows a bend.
    followRail(w, entity);
  }

  const touched = playerAtCell(w, nx, ny);
  if (touched !== undefined) {
    // A helmet shields from the contact. A step, a teleport exit and a clone exit all probe canMonsterEnter first
    // and refuse a helmeted player's cell, so this only backs up an arrival that skipped the probe: the player lives.
    // A rolling ball is the exception: a helmet does not protect from it.
    const killsShielded = def?.killsShieldedPlayer === true;
    if (shieldedFromContact(touched) && !killsShielded) return true;
    // A ward destroys the monster that touches the player; the player lives.
    if (withPlayer(w, touched, () => absorbMonsterContact(w, entity.uid))) return true;
    killPlayerAt(ctx, touched, killsShielded ? STONE_DEATH_REASON_KEY : 'hud.messages.death_monster', 'death');
    return false;
  }

  // Running into a flying shot (by a step, a teleport or a clone spawn) kills the monster and spends the shot.
  if (w.shots.length > 0 && consumeShotAt(w, nx, ny)) {
    killMonsterByShot(ctx, entity);
    return true;
  }

  openPassedTile(w, def, nx, ny);
  openDoorWithHeldKey(w, entity, nx, ny);
  const destTile = ConfigRegistry.getTile(w.terrain[ny][nx]);
  // A ghost or a rover takes the keys and tools it walks over (the item leaves the map); a bomb is judged below.
  // A rolling ball takes the score bonuses too, and so does a rover on a CC2-engine level (Lexy defs.js 118-125, normal pickup priority).
  if (def?.picksUpItems === true) {
    const lying = w.items[ny][nx];
    const takesBonuses = isRollingBallDef(def) || (usesCc2Engine(w.level) && def.movementPattern === EMULATE_CYCLE_PATTERN);
    if (lying && (takesBonuses ? rollingBallPicksUp(lying) : monsterPicksUp(lying))) {
      w.items[ny][nx] = null;
      if (usesCc2Engine(w.level)) holdTool(w, entity, nx, ny, lying);
    }
  }
  // CC2: a monster walks over a blue key and takes it, and walks over a red key and leaves it.
  if (def?.picksUpItems !== true && entity.kind === 'monster' && usesCc2Engine(w.level) && w.items[ny][nx] === CC2_MONSTER_PICKED_KEY) {
    w.items[ny][nx] = null;
  }

  // CC2: a monster that erases a hazard with the tool that protects from it (a ghost with fire boots on fire, Lexy fire.on_arrive)
  // turns the cell into plain floor.
  if (def?.erasesHazardWithToolCc2 === true && usesCc2Engine(w.level) && heldToolProtects(entity, destTile) && destTile.hazard === 'fire') {
    w.terrain[ny][nx] = ConfigRegistry.getTile(FLOOR_TILE_ID).cc2Twin || FLOOR_TILE_ID;
  }

  // Bombs, water, fire and slime do nothing to a monster the floor does not affect: a ghost sets off no bomb.
  if (!floorFree) {
    const removal = hazardRemoval(w, entity, def);
    if (removal !== null) {
      if (w.cc3dPace) {
        // CC3D keeps the monster in the cell for the whole step and removes it, and the bomb, when the step ends.
        w.ccArrivals.push({ uid: entity.uid, x: nx, y: ny, removal, due: (w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1) + entity.cooldownTicks - 1 });
      } else {
        applyPendingRemoval(ctx, entity);
      }
      return true;
    }
    if (destTile.hazard === 'slime') {
      // A monster slime does not hurt carries it from now on: it leaves the trail tile behind.
      entity.slimed = true;
    }
  }

  // A transmogrifier swaps the kind of the monster for its pair; only `type` changes (uid, position, facing,
  // cooldown and sliding state stay). It comes after every kill check on purpose: the tile is not a hazard
  // and a cell holds one terrain, so the kind that arrived is the one the water, fire, bomb and shot checks
  // above judged, and no hazard of the new kind can share the cell. From the next step on the new kind's
  // rules apply.
  if (!floorFree && destTile.transmogrifies && destTile.transmogrifyTable !== 'cc2' && def?.transmogrifiesTo !== undefined) {
    entity.type = def.transmogrifiesTo;
    delete entity.tankTurn;
  }
  // A CC2 transmogrifier changes only the monster that arrives: the one kind its table names, or for a blob a kind drawn
  // by the walker byte of a CC2 level (the level random stream of a native one), drawn only here, so a level without this tile
  // draws nothing more.
  if (!floorFree && destTile.transmogrifyTable === 'cc2') {
    const pool = def?.transmogrifiesToCc2Pool;
    if (def?.transmogrifiesToCc2 !== undefined) entity.type = def.transmogrifiesToCc2;
    else if (pool !== undefined && pool.length > 0 && usesCc2Engine(w.level) && w.ccGenerators !== null) entity.type = pool[drawWalkerByte(w.ccGenerators) % pool.length];
    else if (pool !== undefined && pool.length > 0) entity.type = pool[w.rng.nextInt(0, pool.length - 1)];
    delete entity.tankTurn;
  }

  // The first monster into an open fish gate turns it into what it hid. CC3D judges the arrival on the gate and does
  // not judge it again on what shows, so neither does Epoxy. A monster that walks through solid tiles leaves it shut.
  if (def?.passesSolidTiles !== true && isOpenFishGate(w, destTile)) consumeFishGate(ctx, nx, ny);

  notePulseArrival(w, nx, ny, entity);

  // A turning force floor turns the monster to the next direction of the shared turn.
  const cycleDir = floorFree || def?.ignoresSlidingFloors === true ? undefined : forceCycleArrival(w, destTile);
  if (cycleDir) entity.dir = cycleDir;

  // CC2 engine: a monster arriving on the yellow button sets the pending decision of the yellow tanks, at its step end.
  if (destTile.buttonAction === STEER_MONSTERS_ACTION && entity.kind === 'monster' && usesCc2Engine(w.level)) {
    const passesCounted = w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1;
    markYellowButtonArrival(w, entity.dir, passesCounted + entity.cooldownTicks + 1);
  }
  // A button worked by the player alone (a steering pad) does nothing when a monster steps on it.
  // A monster that presses nothing (the CC3D blinky and screamer) works no button either.
  if (destTile.buttonAction && destTile.buttonWorkedBy !== 'player' && def?.pressesPlates !== false) {
    if (queuesButtonPress(w, entity, destTile.buttonAction)) {
      // A converted CC3D level applies the press when the step ends (the wrapper of stepMonster sets the final time).
      const delay = w.cc3dPace ? entity.cooldownTicks - 1 : entity.type === CC_BLOB_TYPE ? CC_BLOB_BUTTON_DELAY_PASSES : CC_MONSTER_BUTTON_DELAY_PASSES;
      // The clock counts the pass of the current tick only once it has started (as markTanksToTurn reads it).
      const passesCounted = w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1;
      w.ccArrivals.push({ uid: entity.uid, x: nx, y: ny, action: destTile.buttonAction, due: passesCounted + delay });
    } else if (!ctx.triggerButton(nx, ny, destTile.buttonAction)) {
      return false;
    }
  }

  if ((destTile.isTeleporter || destTile.teleportsToSelf) && allowTeleport && usesCc2Engine(w.level) && w.inTick && entity.kind === 'monster' && !destTile.teleportJumpsAtStepStartCc2) {
    // CC2 engine: the monster goes through in its own turn of the pass where its step ends, not when it starts. The green pad
    // (which draws its destination) keeps the jump at the start of the step, as do blocks.
    w.ccArrivals.push({ uid: entity.uid, x: nx, y: ny, teleport: true, due: (w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1) + entity.cooldownTicks - 1 });
    return true;
  }
  if ((destTile.isTeleporter || destTile.teleportsToSelf) && allowTeleport && w.cc3dPace && w.inTick && entity.kind === 'monster') {
    // CC3D moves the monster when its step ends; blocks keep the immediate jump.
    w.ccArrivals.push({ uid: entity.uid, x: nx, y: ny, teleport: true, due: (w.ccPassOpen ? w.ccMonsterClock : w.ccMonsterClock + 1) + entity.cooldownTicks - 1 });
    return true;
  }
  if ((destTile.isTeleporter || destTile.teleportsToSelf) && allowTeleport) {
    return ctx.teleportEntity(entity, nx, ny, entity.dir) ? resolveMonsterArrival(ctx, entity, false) : true;
  }
  return true;
}

/**
 * The cooldown of a monster that a clone machine lets out onto the cell it stands on now, as CC3D's pushed step lasts: the
 * fast floor step onto ice or a force floor, the step of its kind otherwise (four ticks, eight for the omni), scaled by slow time.
 */
export function cc3dReleaseCooldown(w: EpoxyWorld, entity: RuntimeEntity): number {
  const def = ConfigRegistry.getEntityDef(entity.type);
  const floorFree = def?.ignoresSlidingFloors === true || def?.ignoresFloorEffects === true;
  const slowdown = monsterSlowdown(w);
  if (!floorFree && ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).slideType !== undefined) return CC3D_MONSTER_FLOOR_STEP_TICKS * slowdown - 1;
  if (CC3D_RESTING_TYPES.includes(entity.type)) return CC3D_MONSTER_STEP_TICKS * slowdown - 1;
  return ((def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS) + 1) * slowdown - 1;
}

/** The collectible kind that an entity takes but never holds as a tool: keys are not tools. */
const TOOL_EXCLUDED_COLLECTIBLE = 'key';

/** The collectible kind of a score bonus: a ball that takes one holds nothing. */
const SCORE_BONUS_COLLECTIBLE = 'bonus';

/** Whether the entity holds the key a door needs (a rolling ball opens the door of a key it took). */
function holdsKeyOf(entity: RuntimeEntity, tile: TileDefinition): boolean {
  return tile.requiredKey !== undefined && entity.heldKeys?.includes(tile.requiredKey) === true;
}

/** A monster that holds the key of the door it arrives on opens it: the key is used up (a green one is not) and the door becomes what it hid. */
function openDoorWithHeldKey(w: EpoxyWorld, entity: RuntimeEntity, x: number, y: number): void {
  const tile = ConfigRegistry.getTile(w.terrain[y][x]);
  if (!holdsKeyOf(entity, tile) || entity.heldKeys === undefined) return;
  if (tile.consumesKey) {
    entity.heldKeys.splice(entity.heldKeys.indexOf(tile.requiredKey as string), 1);
    if (entity.heldKeys.length === 0) delete entity.heldKeys;
  }
  w.terrain[y][x] = takeRevealedTerrain(w, x, y) ?? (tile.transformsToOnUnlock || FLOOR_TILE_ID);
  w.beamDirty = true;
  AudioManager.playSfx('door');
}

/** Whether the tools an entity holds include the one that protects against the hazard of this tile (flippers on water, fire boots on fire). */
function heldToolProtects(entity: RuntimeEntity, tile: TileDefinition): boolean {
  return tile.protectedByItem !== undefined && entity.heldTools?.includes(tile.protectedByItem) === true;
}

/** Whether the entity holds the tool that protects against the hazard of the cell it stands in (CC2 engine only). */
function holdsProtection(w: EpoxyWorld, entity: RuntimeEntity): boolean {
  return usesCc2Engine(w.level) && heldToolProtects(entity, ConfigRegistry.getTile(w.terrain[entity.y][entity.x]));
}

/**
 * CC2: an entity that picks things up (a ghost, a rover) keeps the tools it takes, up to CC2_ENTITY_TOOL_CAPACITY; taking
 * one more drops the oldest on the cell it just emptied (Lexy game.js:3245-3256). Keys are taken but never held.
 */
function holdTool(w: EpoxyWorld, entity: RuntimeEntity, x: number, y: number, itemId: string): void {
  const collectible = ConfigRegistry.getTile(itemId).collectible;
  if (collectible === TOOL_EXCLUDED_COLLECTIBLE) {
    // A rolling ball keeps the keys it takes: they open the doors it rolls into.
    if (isRollingBallDef(ConfigRegistry.getEntityDef(entity.type))) (entity.heldKeys ??= []).push(itemId);
    return;
  }
  // A score bonus is taken and gone: it is no tool.
  if (collectible === SCORE_BONUS_COLLECTIBLE) return;
  const held = entity.heldTools ?? [];
  held.push(itemId);
  if (held.length > CC2_ENTITY_TOOL_CAPACITY) w.items[y][x] = held.shift() ?? null;
  entity.heldTools = held;
}

/** The hazard of the cell a monster stands in that removes it (a bomb, water, fire, slime it is not immune to), or null. */
function hazardRemoval(w: EpoxyWorld, entity: RuntimeEntity, def: EntityDefinition | undefined): 'bomb' | 'splash' | 'burn' | null {
  const item = w.items[entity.y][entity.x];
  if (item && ConfigRegistry.getTile(item).hazard === 'bomb') return 'bomb';
  const hazard = ConfigRegistry.getTile(w.terrain[entity.y][entity.x]).hazard;
  if (hazard === 'water' && !def?.immuneToWater && !holdsProtection(w, entity)) return 'splash';
  if (hazard === 'fire' && !def?.immuneToFire && !holdsProtection(w, entity)) return 'burn';
  if (hazard === 'slime' && !def?.immuneToSlime) return 'splash';
  return null;
}

/** Removes a monster the hazard of its cell destroys, spending the bomb, with the sound of that hazard. */
function applyPendingRemoval(ctx: EpoxyContext, entity: RuntimeEntity): void {
  const w = ctx.world;
  const def = ConfigRegistry.getEntityDef(entity.type);
  const removal = hazardRemoval(w, entity, def);
  if (removal === null) return;
  if (removal === 'bomb') w.items[entity.y][entity.x] = null;
  removeEntity(w, entity.uid);
  w.beamDirty = true;
  AudioManager.playSfx(removal === 'bomb' ? 'bomb' : removal);
}

/**
 * Classic rules: a classic monster's button press takes effect a few passes after the step (see
 * CC_MONSTER_BUTTON_DELAY_PASSES). On a level imported from Chip's Challenge 2 the green button (toggle walls) is queued like
 * the others: the reference toggles when the monster's step ends.
 */
function queuesButtonPress(w: EpoxyWorld, entity: RuntimeEntity, action: ButtonAction): boolean {
  // CC3D works the blue golem control (reverse_tanks) when the press step starts and a trap by occupancy, so
  // neither waits for the step to end.
  if (w.cc3dPace) return w.inTick && action !== 'hold_trap' && action !== 'reverse_tanks';
  return w.ccRules && w.inTick && followsCcCadence(entity.type, usesCc2Engine(w.level));
}

function isPlayerOpening(w: EpoxyWorld, x: number, y: number): boolean {
  return playersOf(w).some((p) => p.cc3dArrival?.opening?.x === x && p.cc3dArrival.opening.y === y);
}

/**
 * The point teeth aim at. On a CC2-engine level, once a tick has recorded the player's view, it is his apparent position
 * (the cell he is stepping out of, or the source pad of a teleport, plus the share of the step still to run), not his cell
 * (Lexy pursue_player, visual_position); otherwise the player's cell.
 */
function chaseTarget(w: EpoxyWorld): { x: number; y: number } {
  const view = w.cc2PlayerView;
  if (view === undefined || !usesCc2Engine(w.level)) return { x: w.player.x, y: w.player.y };
  const base = view.sourcePad ?? view;
  const left = view.stepLength > 0 ? Math.min(1, Math.max(0, view.cooldown / view.stepLength)) : 0;
  const vec = DIRECTION_VECTORS[view.dir];
  return { x: base.x - vec.dx * left, y: base.y - vec.dy * left };
}

/**
 * The direction a monster steps in, or null. `def` is the definition whose behaviour decides: the monster's own,
 * or for a rover the one it is imitating just now (the monster's own definition still rules what it may enter).
 */
export function chooseMonsterDirection(w: EpoxyWorld, monster: RuntimeEntity, def: EntityDefinition | undefined): Direction | null {
  if (!def) return null;

  // A phasing monster ignores the tile it stands on: no sliding, no forcing, no turning floor.
  if (def.movementPattern === PHASE_LINE_PATTERN) return chooseWispDirection(w, monster);

  const currentTile = ConfigRegistry.getTile(w.terrain[monster.y][monster.x]);
  // A monster the floor does not carry (a ghost) is neither slid nor forced; on ice it cannot turn either, so it
  // goes straight on and, when blocked, turns round.
  const ownDef = ConfigRegistry.getEntityDef(monster.type);
  const floorFree = ownDef?.ignoresFloorEffects === true;
  // A monster that ice and force floors do not carry (a blinky, a screamer) treats them as plain floor.
  const slidesFree = ownDef?.ignoresSlidingFloors === true;
  if (floorFree) {
    if (currentTile.slideType === 'ice') {
      if (canStep(w, monster, monster.dir)) return monster.dir;
      // Blocked on ice, a ghost turns round (it moves on the next step); it cannot choose another way.
      monster.dir = OPPOSITE_DIRECTION[monster.dir];
      return null;
    }
  } else if (currentTile.slideType === 'ice' && !slidesFree) {
    const slideDir = currentTile.deflectionMap?.[monster.dir] || monster.dir;
    if (canStep(w, monster, slideDir)) return slideDir;
    const bounce = OPPOSITE_DIRECTION[slideDir];
    if (canStep(w, monster, bounce)) return bounce;
    return null;
  }

  // A turning force floor sets the facing on arrival (see resolveMonsterArrival); the monster keeps pushing that way.
  if (!floorFree && !slidesFree && currentTile.forceCycle === true) {
    return canStep(w, monster, monster.dir) ? monster.dir : null;
  }

  if (!floorFree && !slidesFree && currentTile.slideType === 'force' && currentTile.forceDirection) {
    const forceDir =
      currentTile.forceDirection === 'RANDOM'
        ? ORDERED_DIRECTIONS[w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)]
        : currentTile.forceDirection;
    return canStep(w, monster, forceDir) ? forceDir : null;
  }

  if (def.movementPattern === CHASE_PLAYER_PATTERN || def.movementPattern === FLEE_PLAYER_PATTERN) {
    const target = chaseTarget(w);
    const dx = target.x - monster.x;
    const dy = target.y - monster.y;
    const candidates: Direction[] = [];
    // On a tie the classic rules (Lynx teeth) go vertical first; Epoxy's own rules go horizontal first.
    if (w.ccRules ? Math.abs(dx) > Math.abs(dy) : Math.abs(dx) >= Math.abs(dy)) {
      if (dx !== 0) candidates.push(dx > 0 ? 'E' : 'W');
      if (dy !== 0) candidates.push(dy > 0 ? 'S' : 'N');
    } else {
      if (dy !== 0) candidates.push(dy > 0 ? 'S' : 'N');
      if (dx !== 0) candidates.push(dx > 0 ? 'E' : 'W');
    }
    // A fleeing monster tries the same axes away from the player; a blocked axis is tried only when it is not lined up.
    // A monster that flees one character (teeth flee Melinda) does the opposite of its pattern while she is the player.
    const fleesPlayer = (def.movementPattern === FLEE_PLAYER_PATTERN) !== (def.fleesCharacters?.includes(playerCharacterOf(w)) === true);
    if (fleesPlayer) {
      for (let i = 0; i < candidates.length; i++) candidates[i] = OPPOSITE_DIRECTION[candidates[i]];
    }
    for (const c of candidates) {
      if (canStep(w, monster, c)) return c;
    }
    // Classic teeth boxed in turn to face their first choice; on a CC2-engine level they take the last choice, as every actor does
    // (Lexy game.js:1770-1774), and the move is tried in their turn through the plan (the facing).
    if (w.ccRules && candidates.length > 0 && followsCcCadence(monster.type, usesCc2Engine(w.level))) monster.dir = usesCc2Engine(w.level) ? candidates[candidates.length - 1] : candidates[0];
    return null;
  }

  // A classic walker or blob on a level made for the classic game uses that game's own generators.
  if (w.ccGenerators !== null && (monster.type === CC_WALKER_TYPE || monster.type === CC_BLOB_TYPE)) {
    return chooseClassicRandomDirection(w, monster, w.ccGenerators);
  }

  if (def.movementPattern === 'forward_else_random') {
    if (canStep(w, monster, monster.dir)) {
      return monster.dir;
    }
    const turns: RelativeTurn[] = ['LEFT', 'RIGHT', 'BACK'];
    w.rng.shuffle(turns);
    for (const turn of turns) {
      const d = applyRelativeTurn(monster.dir, turn);
      if (canStep(w, monster, d)) return d;
    }
    return null;
  }

  if (def.movementPattern === RANDOM_DRAW_PATTERN) {
    // One draw among the four ways: a blocked draw is a wait, not another try.
    const drawn = ORDERED_DIRECTIONS[w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)];
    return canStep(w, monster, drawn) ? drawn : null;
  }

  if (def.movementPattern === FORWARD_ELSE_DRAW_PATTERN) {
    if (canStep(w, monster, monster.dir)) return monster.dir;
    // Blocked ahead: one draw among the four ways, and a blocked draw is a wait.
    const drawn = ORDERED_DIRECTIONS[w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)];
    return canStep(w, monster, drawn) ? drawn : null;
  }

  if (def.movementPattern === 'pure_random') {
    const dirs: Direction[] = [...ORDERED_DIRECTIONS];
    w.rng.shuffle(dirs);
    for (const d of dirs) {
      if (canStep(w, monster, d)) return d;
    }
    return null;
  }

  const turnOrder = def.turnOrder || ['FORWARD'];
  for (const rel of turnOrder) {
    const candidateDir = applyRelativeTurn(monster.dir, rel);
    // A monster that melts ice spends its step melting the ice block it would otherwise enter.
    if (def.meltsIceOnBumpCc2 === true && usesCc2Engine(w.level)) {
      // CC2 engine (Lexy ice_block.on_after_bumped): a fireball that bumps an ice block melts it, and tries its next way.
      if (meltIceBlockAhead(w, monster, candidateDir, true)) continue;
    } else if (def.meltsIceBlocks === true && meltIceBlockAhead(w, monster, candidateDir, false)) return null;
    if (canStep(w, monster, candidateDir)) {
      return candidateDir;
    }
  }

  // A classic monster boxed in turns to face its last candidate (every classic-rules level, CC2 imports included).
  if (w.ccRules && followsCcCadence(monster.type, usesCc2Engine(w.level)) && turnOrder.length > 0) {
    monster.dir = applyRelativeTurn(monster.dir, turnOrder[turnOrder.length - 1]);
  }
  return null;
}

/**
 * The way of a classic walker or blob. The walker goes straight on while it may and draws only when blocked, one
 * quarter-turn count from its own generator; the blob makes one draw from the main generator on every decision.
 * The monster faces the drawn way and, when that way is blocked, waits there.
 */
function chooseClassicRandomDirection(w: EpoxyWorld, monster: RuntimeEntity, generators: CcGenerators): Direction | null {
  if (monster.type === CC_WALKER_TYPE) {
    if (canStep(w, monster, monster.dir)) return monster.dir;
    monster.dir = drawWalkerTurn(generators, monster.dir);
  } else if (usesCc2Engine(w.level)) {
    monster.dir = drawCc2BlobDirection(generators, w.level.cc2?.blobBehavior ?? CC2_BLOB_BEHAVIOR_DEFAULT);
  } else {
    monster.dir = drawBlobDirection(generators);
  }
  return canStep(w, monster, monster.dir) ? monster.dir : null;
}

/**
 * Melts the block of ice in the cell a monster tries to enter: the block is removed and, when the cell is plain floor,
 * the floor becomes what the block melts into (water). Returns whether a block was melted. Only a block at rest melts.
 * CC2 engine: the block melts whatever its motion, only on floor (a no-sign counts as floor; any other terrain leaves the
 * block as it is), and leaves a splash that bars the player.
 */
function meltIceBlockAhead(w: EpoxyWorld, monster: RuntimeEntity, dir: Direction, cc2: boolean): boolean {
  const vec = DIRECTION_VECTORS[dir];
  const nx = monster.x + vec.dx;
  const ny = monster.y + vec.dy;
  if (!isInBounds(w, nx, ny) || isEdgeBlocked(w, monster.x, monster.y, nx, ny, dir)) return false;
  const block = getEntityAt(w, nx, ny);
  if (block === undefined || block.kind !== 'block' || (block.isSliding && !cc2)) return false;
  const melted = ConfigRegistry.getEntityDef(block.type)?.meltsInFireTo;
  if (melted === undefined) return false;
  const terrainId = w.terrain[ny][nx];
  if (cc2 && terrainId !== FLOOR_TILE_ID && ConfigRegistry.getTile(terrainId).forbiddenItem === undefined) return false;
  if (cc2 || terrainId === FLOOR_TILE_ID) w.terrain[ny][nx] = melted;
  removeEntity(w, block.uid);
  if (cc2) leaveSplash(w, nx, ny);
  AudioManager.playSfx('splash');
  return true;
}

/**
 * The step of a phasing monster: straight ahead, else turned round once, else none. Turning round changes the
 * facing only when the step is taken, so a monster blocked both ways stays as it is.
 */
function chooseWispDirection(w: EpoxyWorld, monster: RuntimeEntity): Direction | null {
  if (canWispEnter(w, monster, monster.dir)) return monster.dir;
  const back = OPPOSITE_DIRECTION[monster.dir];
  return canWispEnter(w, monster, back) ? back : null;
}

/**
 * Whether a phasing monster may step one cell in `dir`: inside the map, past the cell edges (a thin wall still
 * stops it) and with no entity in the cell. The tile of the cell and any item on it do not matter.
 */
export function canWispEnter(w: EpoxyWorld, monster: RuntimeEntity, dir: Direction): boolean {
  const vec = DIRECTION_VECTORS[dir];
  const nx = monster.x + vec.dx;
  const ny = monster.y + vec.dy;
  if (!isInBounds(w, nx, ny)) return false;
  if (isEdgeBlocked(w, monster.x, monster.y, nx, ny, dir)) return false;
  return getEntityAt(w, nx, ny) === undefined;
}

/**
 * Whether a canopy stops a step (CC2 canopy): a bug or a rover cannot enter a cell under a canopy, and a blob does not
 * step from one canopy to another. Lexy's Labyrinth (tiletypes.js, canopy): blocks_collision bug | rover, and
 * blocks() refuses a blob that moves between two canopies.
 */
function canopyStopsStep(w: EpoxyWorld, def: EntityDefinition | undefined, fromX: number, fromY: number, toX: number, toY: number): boolean {
  if (w.edgeMask === null || def === undefined) return false;
  const width = mapWidth(w);
  const intoCanopy = cellHasCanopy(w.edgeMask, width, toX, toY);
  if (!intoCanopy) return false;
  if (def.blockedByCanopy === true) return true;
  return def.blockedBetweenCanopies === true && cellHasCanopy(w.edgeMask, width, fromX, fromY);
}

/** A step the monster takes on its own: a block in the way counts as free when the monster pushes and the push would succeed. */
function canStep(w: EpoxyWorld, monster: RuntimeEntity, wanted: Direction): boolean {
  // CC2 engine: a monster that so much as considers stepping onto a block splash erases it (Lexy: any non-player actor).
  if (usesCc2Engine(w.level) && w.blockSplashes.size > 0) {
    const vec = DIRECTION_VECTORS[wanted];
    eraseSplash(w, monster.x + vec.dx, monster.y + vec.dy);
  }
  // CC2 engine: a rolling ball bumped by the probe blows up with the actor that probed it (the entry test below does not do this).
  // Lexy tests the canopy, thin wall, item and terrain layers before the actor layer: a ball is bumped only once those admit the monster.
  if (!canMonsterEnter(w, monster, wanted, true, true, true)) return false;
  bumpRollingBall(w, monster, wanted);
  if (!w.entities.includes(monster)) return false;
  return canMonsterEnter(w, monster, wanted, false, true, true);
}

/**
 * Whether the monster may step one cell in `dir`: inside the map, past the cell edges, onto a tile it can
 * enter (or one its definition passes) with no item but a bomb and no entity. `ignoreOccupant` leaves the
 * entity check to the caller, which pushes the block in the way (a steered puppet). `mayPush` lets a monster
 * that pushes blocks (the CC2 rover) count a block it could push away as no obstacle. `choosing` is the probe a monster
 * makes when it picks its way: it takes a tile that monsters reveal (an appearing wall) for open floor, as CC3D does.
 */
export function canMonsterEnter(
  w: EpoxyWorld,
  monster: RuntimeEntity,
  wanted: Direction,
  ignoreOccupant = false,
  mayPush = false,
  choosing = false
): boolean {
  // On a track cell the step is judged where it would really go: turned onto the track, as the move itself will be.
  const dir =
    ConfigRegistry.getEntityDef(monster.type)?.ignoresFloorEffects === true
      ? wanted
      : railRedirect(w, monster.x, monster.y, wanted, 'walker');
  const vec = DIRECTION_VECTORS[dir];
  const nx = monster.x + vec.dx;
  const ny = monster.y + vec.dy;
  if (!isInBounds(w, nx, ny)) return false;
  const def = ConfigRegistry.getEntityDef(monster.type);
  if (def?.ignoresCellEdges !== true && isEdgeBlocked(w, monster.x, monster.y, nx, ny, dir)) return false;
  if (canopyStopsStep(w, def, monster.x, monster.y, nx, ny)) return false;
  // CC2 engine: the cell a player is stepping into (a socket or door he opens on arrival) stays as it was for the monsters until
  // his step ends; a ghost, which passes solid tiles, is not held (Lexy tiletypes.js:43-45, 3510-3517).
  if (def?.passesSolidTiles !== true && usesCc2Engine(w.level) && isPlayerOpening(w, nx, ny)) return false;

  const destTileId = w.terrain[ny][nx];
  const destTile = ConfigRegistry.getTile(destTileId);

  // A monster that walks through solid tiles (a ghost) is stopped only by the tiles and hazards its definition names.
  const passesSolid =
    def?.passesSolidTiles === true &&
    def.blockedByTiles?.includes(destTileId) !== true &&
    (destTile.hazard === undefined ||
      def.blockedByHazards?.includes(destTile.hazard) !== true ||
      (usesCc2Engine(w.level) && heldToolProtects(monster, destTile)));
  if (def?.passesSolidTiles === true && !passesSolid) return false;

  // passesTiles lets a monster enter a tile it otherwise could not (undefined for every monster that exists today).
  // A socket is passed only once no chip is missing (it is a wall until then, for the rover as for anyone).
  const passesTile =
    def?.passesTiles?.includes(destTileId) === true ||
    (def?.entersBarredTiles?.includes(destTileId) === true && !(destTile.requiresAllChips === true && w.chipsRemaining > 0)) ||
    (def?.entersTurtles === true && destTileId === TURTLE_TILE_ID) ||
    // A door whose key the monster holds lets it in (a rolling ball that took the key).
    holdsKeyOf(monster, destTile);
  // A tile that bars some monsters (the CC2 turtle bars fireballs) refuses the ones it lists, and a ghost its own list.
  if (destTile.barsMonsters?.includes(monster.type) === true) return false;
  // A tile that admits only some monsters (the CC2 pop-up wall) refuses the others, whatever else lets them in.
  if (destTile.admitsMonsters !== undefined && !destTile.admitsMonsters.includes(monster.type)) return false;
  // An appearing wall that monsters reveal looks like floor to a monster choosing its way: the step is attempted and
  // refused there (see revealOnAttempt), so a probe made for a choice says yes where a plain probe says no.
  if (destTile.revealedByAny === true && !passesSolid && !passesTile) return choosing;
  if (
    !destTile.passableByMonster &&
    !passesTile &&
    !passesSolid &&
    !(destTile.hazard === 'fire' && def?.immuneToFire) &&
    !isOpenFishGate(w, destTile)
  ) {
    return false;
  }
  if (destTile.hazard === 'fire' && def?.avoidsFire) return false;
  // A monster may refuse to step into a hazard it would not survive (the CC3D monsters refuse water, fire and slime).
  if (destTile.hazard !== undefined && def?.refusesHazards?.includes(destTile.hazard) === true) return false;

  const itemId = w.items[ny][nx];
  const keyPasses = itemId !== null && CC2_MONSTER_PASSABLE_KEYS.includes(itemId) && usesCc2Engine(w.level);
  if (!keyPasses && def?.passesItems !== true && itemId && ConfigRegistry.getTile(itemId).hazard !== 'bomb' && !isLitChargeItem(itemId)) {
    return false;
  }

  // A player in a helmet is not hurt by a monster, so the monster is simply stopped at the player's cell (a rolling ball is no such monster).
  if (def?.killsShieldedPlayer !== true && shieldedPlayerAt(w, nx, ny)) return false;

  if (ignoreOccupant) return true;
  const occupant = getEntityAt(w, nx, ny);
  if (occupant === undefined) return true;
  // A monster that pushes (the CC2 rover) enters the cell of a block it could push out of the way, never onto a live player.
  return mayPush && def?.pushesBlocks === true && occupant.kind === 'block' && canPushBlock(w, occupant, dir, false, true);
}

/** Whether a monster that picks things up (a ghost, a rover) takes this item: the keys but the red one, and the tools. */
export function monsterPicksUp(itemId: string): boolean {
  const item = ConfigRegistry.getTile(itemId);
  return (
    item.collectible !== undefined &&
    MONSTER_PICKUP_COLLECTIBLES.includes(item.collectible) &&
    item.colorKey !== MONSTER_IGNORED_KEY_COLOR
  );
}

/** Whether a CC2 rolling ball takes this item as it rolls over it: what a picking monster takes, and the score bonuses flagged for it. */
export function rollingBallPicksUp(itemId: string): boolean {
  return monsterPicksUp(itemId) || ConfigRegistry.getTile(itemId).takenByNormalPickupCc2 === true;
}

/**
 * A monster that enters a tile that bars the others (the CC2 rover on dirt or a socket) opens it as it arrives: dirt is
 * packed down, a socket opens once no chip is missing. A tile no entersBarredTiles entry names is left alone.
 */
function openPassedTile(w: EpoxyWorld, def: EntityDefinition | undefined, x: number, y: number): void {
  const tileId = w.terrain[y][x];
  if (def?.entersBarredTiles?.includes(tileId) !== true) return;
  const tile = ConfigRegistry.getTile(tileId);
  const opened = tile.transformsToOnStep ?? (tile.requiresAllChips === true && w.chipsRemaining <= 0 ? (tile.transformsToOnUnlock ?? FLOOR_TILE_ID) : undefined);
  if (opened === undefined) return;
  w.terrain[y][x] = takeRevealedTerrain(w, x, y) ?? opened;
  w.beamDirty = true;
  if (tile.requiresAllChips === true) AudioManager.playSfx('socket');
}
