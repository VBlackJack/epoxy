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
  CC_BLOB_BUTTON_DELAY_PASSES,
  CC_BLOB_TYPE,
  CC_MONSTER_BUTTON_DELAY_PASSES,
  CC_WALKER_TYPE,
  CC_CADENCE_TYPES,
  CC_TEETH_ACTIVE_TICKS,
  CC_TEETH_CYCLE_TICKS,
  CC_TEETH_TYPE,
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
import { ButtonAction, Direction, EntityDefinition, RelativeTurn, RuntimeEntity } from '../types';
import { CcGenerators, drawBlobDirection, drawWalkerTurn } from './ccGenerators';
import { attemptPushBlock, canPushBlock, stepSlidingBlock } from './epoxyBlocks';
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
  if (w.ccRules) {
    turnMarkedTanks(w);
    if (!applyQueuedArrivals(ctx)) return;
  }
  w.ccPassOpen = w.ccRules;
  try {
    if (w.ccRules) planClassicDecisions(ctx);
    runEntityPass(ctx);
  } finally {
    w.ccPassOpen = false;
    w.ccPlans.clear();
  }
}

/**
 * Classic rules, start of an entity pass: applies the monster button presses whose time has come, in the order they
 * were queued. A press is void when its monster is gone or has left the button. Returns false when a press killed
 * the player (the pass then stops).
 */
function applyQueuedArrivals(ctx: EpoxyContext): boolean {
  const w = ctx.world;
  if (w.ccArrivals.length === 0) return true;
  const pass = w.ccMonsterClock;
  const due = w.ccArrivals.filter((a) => a.due <= pass);
  if (due.length === 0) return true;
  w.ccArrivals = w.ccArrivals.filter((a) => a.due > pass);
  w.ccArrivalsRunning = true;
  try {
    for (const arrival of due) {
      const monster = w.entities.find((e) => e.uid === arrival.uid);
      if (monster === undefined || monster.x !== arrival.x || monster.y !== arrival.y) continue;
      if (!ctx.triggerButton(arrival.x, arrival.y, arrival.action)) return false;
    }
  } finally {
    w.ccArrivalsRunning = false;
  }
  return true;
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
    if (entity.kind === 'block' || !CC_CADENCE_TYPES.includes(entity.type) || entity.cooldownTicks !== 0) continue;
    if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine) continue;
    if (entity.type === CC_TEETH_TYPE && clock % CC_TEETH_CYCLE_TICKS >= CC_TEETH_ACTIVE_TICKS) continue;
    if (isCellClosedTrap(w, entity.x, entity.y)) {
      // A held monster keeps its facing and decides nothing; if the trap opens during the movement pass it is
      // released in that facing.
      w.ccPlans.set(entity.uid, entity.dir);
      continue;
    }
    const def = ConfigRegistry.getEntityDef(entity.type);
    let plan = chooseMonsterDirection(w, entity, def);
    if (plan === null && ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).slideType === undefined && !(entity.type === CC_TEETH_TYPE && entity.x === w.player.x && entity.y === w.player.y)) {
      plan = entity.dir;
    }
    w.ccPlans.set(entity.uid, plan);
  }
}

function runEntityPass(ctx: EpoxyContext): void {
  const w = ctx.world;
  w.removedUids.clear();
  const clock = w.ccMonsterClock;
  if (w.ccRules) w.ccMonsterClock++;
  const snapshotEntities = [...w.entities];
  // The classic game moves its creatures from the end of the list to the start.
  if (w.ccRules) snapshotEntities.reverse();
  for (const entity of snapshotEntities) {
    if (w.removedUids.has(entity.uid)) continue;

    // Entities sitting directly on a clone machine act as templates and do not move on their own
    // (a wisp is never a template: it drifts over a machine like over any other tile)
    if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isCloneMachine && !isPhasingEntityType(entity.type)) {
      continue;
    }

    if (entity.kind === 'block') {
      stepSlidingBlock(ctx, entity);
      continue;
    }

    if (!(w.ccRules && CC_CADENCE_TYPES.includes(entity.type) ? stepClassicMonster(ctx, entity, clock) : stepMonster(ctx, entity))) return;
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
  if (entity.cooldownTicks === 0 && entity.type === CC_TEETH_TYPE && clock % CC_TEETH_CYCLE_TICKS >= CC_TEETH_ACTIVE_TICKS) return true;
  const ready = entity.cooldownTicks === 0;
  const x = entity.x;
  const y = entity.y;
  const alive = stepMonster(ctx, entity);
  // Like the original, a creature that could not move (a blocked decision, a held trap, a blocked forced move on a
  // slide tile) tries again on the next tick.
  if (ready && entity.x === x && entity.y === y && entity.cooldownTicks > 0) entity.cooldownTicks = 0;
  return alive;
}

/** Advances one monster of the entity loop by a tick. Returns false when the player was killed, so the loop stops. */
function stepMonster(ctx: EpoxyContext, entity: RuntimeEntity): boolean {
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
  const stepTicks = w.ccRules && CC_CADENCE_TYPES.includes(entity.type) ? ccStepTicks(entity.type) : interval + 1;
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
  if (w.ccPlans.has(entity.uid)) {
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
  const destItem = w.items[ny][nx];

  // Bombs, water, fire and slime do nothing to a monster the floor does not affect: a ghost sets off no bomb.
  if (!floorFree) {
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
      if (!def?.immuneToSlime) {
        removeEntity(w, entity.uid);
        AudioManager.playSfx('splash');
        return true;
      }
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
      const delay = entity.type === CC_BLOB_TYPE ? CC_BLOB_BUTTON_DELAY_PASSES : CC_MONSTER_BUTTON_DELAY_PASSES;
      w.ccArrivals.push({ uid: entity.uid, x: nx, y: ny, action: destTile.buttonAction, due: w.ccMonsterClock + delay });
    } else if (!ctx.triggerButton(nx, ny, destTile.buttonAction)) {
      return false;
    }
  }

  if ((destTile.isTeleporter || destTile.teleportsToSelf) && allowTeleport) {
    return ctx.teleportEntity(entity, nx, ny, entity.dir) ? resolveMonsterArrival(ctx, entity, false) : true;
  }
  return true;
}

/**
 * Classic rules: a classic monster's button press takes effect a few passes after the step (see
 * CC_MONSTER_BUTTON_DELAY_PASSES). The green button (toggle walls) is not delayed on a level imported from Chip's
 * Challenge 2, whose engine toggles the walls at once.
 */
function queuesButtonPress(w: EpoxyWorld, entity: RuntimeEntity, action: ButtonAction): boolean {
  if (!w.ccRules || !w.inTick || !CC_CADENCE_TYPES.includes(entity.type)) return false;
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
    if (w.ccRules && candidates.length > 0 && CC_CADENCE_TYPES.includes(monster.type)) monster.dir = candidates[0];
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
  if (w.ccRules && CC_CADENCE_TYPES.includes(monster.type) && turnOrder.length > 0) {
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
  if (def?.passesItems !== true && itemId && ConfigRegistry.getTile(itemId).hazard !== 'bomb' && !isLitChargeItem(itemId)) {
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
