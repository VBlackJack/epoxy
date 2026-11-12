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
  CC_BLOB_TYPE,
  CC_MONSTER_BUTTON_DELAY_PASSES,
  CC_WALKER_TYPE,
  followsCcCadence,
  followsTeethPhase,
  CC2_FLOOR_STEP_DIVISOR,
  CC2_MONSTER_PASSABLE_KEYS,
  CC2_MONSTER_PICKED_KEY,
  CC_TEETH_ACTIVE_TICKS,
  CC3D_MONSTER_FLOOR_STEP_TICKS,
  CC3D_MONSTER_STEP_TICKS,
  CC3D_REST_PHASE_TICKS,
  CC3D_RESTING_TYPES,
  CC_TEETH_CYCLE_TICKS,
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
  TURTLE_TILE_ID
} from '../coreConstants';
import { cellHasCanopy } from '../EdgeRules';
import { isPhasingEntityType } from '../RulesetFeatures';
import { ButtonAction, CcArrival, Direction, EntityDefinition, RelativeTurn, RuntimeEntity } from '../types';
import { CcGenerators, drawBlobDirection, drawWalkerTurn } from './ccGenerators';
import { attemptPushBlock, canPushBlock, eraseSplash, pruneSplashes, stepSlidingBlock } from './epoxyBlocks';
import { isLitChargeItem } from './epoxyCharges';
import { advanceEmulation, emulatedDef } from './epoxyEmulation';
import { forceCycleArrival } from './epoxyForceCycle';
import { stepMirrorFloor } from './epoxyMirrors';
import { followRail } from './epoxyRails';
import { railRedirect } from './epoxyRailsCc2';
import { absorbMonsterContact, shieldedFromContact, shieldedPlayerAt } from './epoxyWard';
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
    if (!applyQueuedArrivals(ctx)) return;
  } else if (w.cc3dPace) {
    dropOrphanArrivals(w);
  }
  w.ccPassOpen = w.ccRules || w.cc3dPace;
  try {
    if (w.ccRules) planClassicDecisions(ctx);
    runEntityPass(ctx);
  } finally {
    w.ccPassOpen = false;
    w.ccPlans.clear();
    w.entityPassSeen.clear();
    w.turnSpent.clear();
    pruneSplashes(w);
  }
}

/**
 * Classic rules, start of an entity pass: applies the monster button presses whose time has come, in the order they
 * were queued. A press is void when its monster is gone or has left the button. Returns false when a press killed
 * the player (the pass then stops).
 */
function applyQueuedArrivals(ctx: EpoxyContext, ownerUid?: number, passClock?: number): boolean {
  const w = ctx.world;
  if (w.ccArrivals.length === 0) return true;
  const pass = passClock ?? w.ccMonsterClock;
  const isDue = (a: { uid: number; due: number }): boolean => a.due <= pass && (ownerUid === undefined || a.uid === ownerUid);
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
        if (!applyQueuedTeleport(ctx, monster, arrival, pass)) return false;
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

/** A converted CC3D level fires a press in its monster's own turn: a press whose monster is gone is void. */
function dropOrphanArrivals(w: EpoxyWorld): void {
  if (w.ccArrivals.length === 0) return;
  w.ccArrivals = w.ccArrivals.filter((a) => w.entities.some((e) => e.uid === a.uid));
}

/**
 * Classic rules, decision pass: every classic monster that is ready decides its way now, the entities taken in reverse
 * list order; the movement pass (also in reverse order) then tries each decided step once. A monster boxed in plans the
 * way it was turned to face, and tries it when its turn to move comes.
 */
function planClassicDecisions(ctx: EpoxyContext): void {
  const w = ctx.world;
  w.ccPlans.clear();
  const clock = w.ccMonsterClock;
  for (let i = w.entities.length - 1; i >= 0; i--) {
    const entity = w.entities[i];
    if (entity.kind === 'block' || !followsCcCadence(entity.type, usesCc2Engine(w.level)) || entity.cooldownTicks !== 0) continue;
    if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine) continue;
    if (followsTeethPhase(entity.type, usesCc2Engine(w.level)) && clock % CC_TEETH_CYCLE_TICKS >= CC_TEETH_ACTIVE_TICKS) continue;
    const def = ConfigRegistry.getEntityDef(entity.type);
    // A phasing monster (a wisp) and a monster the floor does not affect (a ghost) are not held by a closed trap.
    const heldByFloor = def?.movementPattern !== PHASE_LINE_PATTERN && def?.ignoresFloorEffects !== true;
    if (heldByFloor && isCellClosedTrap(w, entity.x, entity.y)) {
      // A held monster keeps its facing and decides nothing; if the trap opens during the movement pass it is
      // released in that facing.
      w.ccPlans.set(entity.uid, entity.dir);
      continue;
    }
    let plan = chooseMonsterDirection(w, entity, def);
    if (plan === null && ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).slideType === undefined && !(followsTeethPhase(entity.type, usesCc2Engine(w.level)) && entity.x === w.player.x && entity.y === w.player.y)) {
      plan = entity.dir;
    }
    w.ccPlans.set(entity.uid, plan);
  }
}

function runEntityPass(ctx: EpoxyContext): void {
  const w = ctx.world;
  w.removedUids.clear();
  const clock = w.ccMonsterClock;
  if (w.ccRules || w.cc3dPace) w.ccMonsterClock++;
  const snapshotEntities = [...w.entities];
  // The classic game moves its creatures from the end of the list to the start.
  if (w.ccRules) snapshotEntities.reverse();
  for (const entity of snapshotEntities) {
    if (w.removedUids.has(entity.uid)) continue;
    if (w.cc3dPace) {
      w.entityPassSeen.add(entity.uid);
      // CC3D fires a monster's button press inside that monster's own turn, so the monsters ahead of it in the list
      // acted on the old state of what the button works.
      if (!applyQueuedArrivals(ctx, entity.uid, clock)) return;
      if (w.removedUids.has(entity.uid)) continue;
    }

    // Entities sitting directly on a clone machine act as templates and do not move on their own
    // (a wisp is never a template: it drifts over a machine like over any other tile)
    if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine && !isPhasingEntityType(entity.type)) {
      continue;
    }

    if (entity.kind === 'block') {
      stepSlidingBlock(ctx, entity);
      continue;
    }

    if (!(w.ccRules && followsCcCadence(entity.type, usesCc2Engine(w.level)) ? stepClassicMonster(ctx, entity, clock) : stepMonster(ctx, entity))) return;
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
  if (entity.cooldownTicks === 0 && followsTeethPhase(entity.type, usesCc2Engine(ctx.world.level)) && clock % CC_TEETH_CYCLE_TICKS >= CC_TEETH_ACTIVE_TICKS) return true;
  const ready = entity.cooldownTicks === 0;
  const x = entity.x;
  const y = entity.y;
  const alive = stepMonster(ctx, entity);
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
  // A steered monster never decides a step: it moves only when a steering pad is worked.
  if (ConfigRegistry.getEntityDef(entity.type)?.steeredBy !== undefined) return true;
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
  const stepTicks = w.ccRules && followsCcCadence(entity.type, usesCc2Engine(w.level)) ? ccStepTicks(entity.type) : interval + 1;
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
  const behaviour = sliding ? emulatedDef(entity, def) : advanceEmulation(entity, def);
  let chosenDir: Direction | null;
  // A monster a teleporter put on its destination pad leaves by a forced step; a blocked exit lets it decide normally.
  const exitDir = entity.teleportExit;
  delete entity.teleportExit;
  if (exitDir !== undefined && canStep(w, entity, exitDir)) {
    chosenDir = exitDir;
  } else if (w.ccPlans.has(entity.uid)) {
    // Decided in the decision pass: the step is tried once; a refused step only turns the monster.
    const plan = w.ccPlans.get(entity.uid) ?? null;
    w.ccPlans.delete(entity.uid);
    if (plan !== null && canStep(w, entity, plan)) {
      chosenDir = plan;
    } else {
      chosenDir = null;
      if (plan !== null) entity.dir = plan;
    }
  } else {
    chosenDir = chooseMonsterDirection(w, entity, behaviour);
  }
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
    if (shieldedFromContact(touched)) return true;
    // A ward destroys the monster that touches the player; the player lives.
    if (withPlayer(w, touched, () => absorbMonsterContact(w, entity.uid))) return true;
    killPlayerAt(ctx, touched, 'hud.messages.death_monster', 'death');
    return false;
  }

  // Running into a flying shot (by a step, a teleport or a clone spawn) kills the monster and spends the shot.
  if (w.shots.length > 0 && consumeShotAt(w, nx, ny)) {
    killMonsterByShot(ctx, entity);
    return true;
  }

  openPassedTile(w, def, nx, ny);
  const destTile = ConfigRegistry.getTile(w.terrain[ny][nx]);
  // A ghost or a rover takes the keys and tools it walks over (the item leaves the map); a bomb is judged below.
  if (def?.picksUpItems === true) {
    const lying = w.items[ny][nx];
    if (lying && monsterPicksUp(lying)) w.items[ny][nx] = null;
  }
  // CC2: a monster walks over a blue key and takes it, and walks over a red key and leaves it.
  if (def?.picksUpItems !== true && entity.kind === 'monster' && usesCc2Engine(w.level) && w.items[ny][nx] === CC2_MONSTER_PICKED_KEY) {
    w.items[ny][nx] = null;
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
  // from the level random stream (drawn only here, so a level without this tile draws nothing more).
  if (!floorFree && destTile.transmogrifyTable === 'cc2') {
    const pool = def?.transmogrifiesToCc2Pool;
    if (def?.transmogrifiesToCc2 !== undefined) entity.type = def.transmogrifiesToCc2;
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

/** The hazard of the cell a monster stands in that removes it (a bomb, water, fire, slime it is not immune to), or null. */
function hazardRemoval(w: EpoxyWorld, entity: RuntimeEntity, def: EntityDefinition | undefined): 'bomb' | 'splash' | 'burn' | null {
  const item = w.items[entity.y][entity.x];
  if (item && ConfigRegistry.getTile(item).hazard === 'bomb') return 'bomb';
  const hazard = ConfigRegistry.getTile(w.terrain[entity.y][entity.x]).hazard;
  if (hazard === 'water' && !def?.immuneToWater) return 'splash';
  if (hazard === 'fire' && !def?.immuneToFire) return 'burn';
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
 * CC_MONSTER_BUTTON_DELAY_PASSES). The green button (toggle walls) is not delayed on a level imported from Chip's
 * Challenge 2, whose engine toggles the walls at once.
 */
function queuesButtonPress(w: EpoxyWorld, entity: RuntimeEntity, action: ButtonAction): boolean {
  // CC3D works the blue golem control (reverse_tanks) when the press step starts and a trap by occupancy, so
  // neither waits for the step to end.
  if (w.cc3dPace) return w.inTick && action !== 'hold_trap' && action !== 'reverse_tanks';
  if (!w.ccRules || !w.inTick || !followsCcCadence(entity.type, usesCc2Engine(w.level))) return false;
  return !(action === 'toggle_walls' && w.level.cc2 !== undefined);
}

/**
 * The direction a monster steps in, or null. `def` is the definition whose behaviour decides: the monster's own,
 * or for a rover the one it is imitating just now (the monster's own definition still rules what it may enter).
 */
function chooseMonsterDirection(w: EpoxyWorld, monster: RuntimeEntity, def: EntityDefinition | undefined): Direction | null {
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
    const dx = w.player.x - monster.x;
    const dy = w.player.y - monster.y;
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
    // Classic teeth boxed in turn to face their first choice (every classic-rules level, CC2 imports included).
    if (w.ccRules && candidates.length > 0 && followsCcCadence(monster.type, usesCc2Engine(w.level))) monster.dir = candidates[0];
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
    if (def.meltsIceBlocks === true && meltIceBlockAhead(w, monster, candidateDir)) return null;
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
  } else {
    monster.dir = drawBlobDirection(generators);
  }
  return canStep(w, monster, monster.dir) ? monster.dir : null;
}

/**
 * Melts the block of ice in the cell a monster tries to enter: the block is removed and, when the cell is plain floor,
 * the floor becomes what the block melts into (water). Returns whether a block was melted. Only a block at rest melts.
 */
function meltIceBlockAhead(w: EpoxyWorld, monster: RuntimeEntity, dir: Direction): boolean {
  const vec = DIRECTION_VECTORS[dir];
  const nx = monster.x + vec.dx;
  const ny = monster.y + vec.dy;
  if (!isInBounds(w, nx, ny) || isEdgeBlocked(w, monster.x, monster.y, nx, ny, dir)) return false;
  const block = getEntityAt(w, nx, ny);
  if (block === undefined || block.kind !== 'block' || block.isSliding) return false;
  const melted = ConfigRegistry.getEntityDef(block.type)?.meltsInFireTo;
  if (melted === undefined) return false;
  if (w.terrain[ny][nx] === FLOOR_TILE_ID) w.terrain[ny][nx] = melted;
  removeEntity(w, block.uid);
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

  const destTileId = w.terrain[ny][nx];
  const destTile = ConfigRegistry.getTile(destTileId);

  // A monster that walks through solid tiles (a ghost) is stopped only by the tiles and hazards its definition names.
  const passesSolid =
    def?.passesSolidTiles === true &&
    def.blockedByTiles?.includes(destTileId) !== true &&
    (destTile.hazard === undefined || def.blockedByHazards?.includes(destTile.hazard) !== true);
  if (def?.passesSolidTiles === true && !passesSolid) return false;

  // passesTiles lets a monster enter a tile it otherwise could not (undefined for every monster that exists today).
  // A socket is passed only once no chip is missing (it is a wall until then, for the rover as for anyone).
  const passesTile =
    def?.passesTiles?.includes(destTileId) === true ||
    (def?.entersBarredTiles?.includes(destTileId) === true && !(destTile.requiresAllChips === true && w.chipsRemaining > 0)) ||
    (def?.entersTurtles === true && destTileId === TURTLE_TILE_ID);
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

  // A player in a helmet is not hurt by a monster, so the monster is simply stopped at the player's cell.
  if (shieldedPlayerAt(w, nx, ny)) return false;

  if (ignoreOccupant) return true;
  const occupant = getEntityAt(w, nx, ny);
  if (occupant === undefined) return true;
  // A monster that pushes (the CC2 rover) enters the cell of a block it could push out of the way, never onto a live player.
  return mayPush && def?.pushesBlocks === true && occupant.kind === 'block' && canPushBlock(w, occupant, dir, false, true);
}

/** Whether a monster that picks things up (a ghost, a rover) takes this item: the keys but the red one, and the tools. */
function monsterPicksUp(itemId: string): boolean {
  const item = ConfigRegistry.getTile(itemId);
  return (
    item.collectible !== undefined &&
    MONSTER_PICKUP_COLLECTIBLES.includes(item.collectible) &&
    item.colorKey !== MONSTER_IGNORED_KEY_COLOR
  );
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
