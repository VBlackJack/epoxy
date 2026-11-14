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

/**
 * The mirror players of Chip's Challenge 2 (mirror Chip and mirror Melinda).
 *
 * A mirror copies the move the player attempts, even a blocked one, but only while the player is the character it
 * mirrors (Lexy's Labyrinth: the doppelganger decides `level.player1_move` or `level.player2_move`, whichever the real
 * player left, in js/tiletypes.js `doppelganger1` and `doppelganger2`, set by `remember_player_move` in js/game.js).
 * It obeys the terrain rules of its character, not a monster's: it opens the doors of its own key colour without
 * using the key up (on the CC2 engine only with a key it picked up), is stopped by what stops that character (dirt and gravel for Melinda without boots, a sign for
 * the other character), pushes blocks, takes the items lying on its way, presses the buttons it steps on and dies in
 * water, fire and bombs. Chip's mirror slides on ice; Melinda's does not. It kills the player on contact, whoever
 * moves into the other, and its own death does not end the level.
 *
 * On a level played by the CC2 engine the mirrors are actors of their own (Lexy tiletypes.js doppelganger1 and doppelganger2):
 * they walk a step every four ticks (two onto ice or a force floor), read the move the player last decided (game.js
 * remember_player_move: a blocked try too, cleared when his step ends or when he decides nothing), press buttons when their
 * step ends and are pushed out of a trap forward when it opens (tiletypes.js trap add_press). They keep what they pick up
 * like any actor (game.js attempt_take: up to four tools, every key) and open a door only with a key they hold. Which tick's decision a mirror
 * reads follows the order the source lists the actors in (the player among them). Native Epoxy levels keep the copy of each
 * input.
 */

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { CC2_MIRROR_SLIDE_COOLDOWN_TICKS, CC2_MIRROR_WALK_COOLDOWN_TICKS, FLOOR_TILE_ID, MELINDA_CHARACTER, OPPOSITE_DIRECTION, RAILROAD_SIGN_ITEM_ID } from '../coreConstants';
import { Cc2MirrorMove, Direction, EntityDefinition, RuntimeEntity, TileDefinition } from '../types';
import { attemptPushBlock } from './epoxyBlocks';
import { isLitChargeItem } from './epoxyCharges';
import { usesCc2Engine } from './ccRules';
import { mirrorTakesItem, resolveMonsterArrival } from './epoxyMonsters';
import { shieldedPlayerAt } from './epoxyWard';
import { leaveSwivel } from './epoxySwivels';
import { currentEntityPass, EpoxyContext, EpoxyWorld, getEntityAt, isCellClosedTrap, isEdgeBlocked, isInBounds, isOpenFishGate, leaveCell, mapWidth, playerAtCell, playerCharacterOf, revealedTerrain, shotAt, takeRevealedTerrain } from './epoxyWorld';

/** Extra ticks a mirror waits between two steps of a force floor, on top of the shared slide delay. */
const FORCE_SLIDE_EXTRA_COOLDOWN_TICKS = 1;

/** Item kinds a mirror takes from the floor when it steps on them (chips and bonus flags stay for the player). */
const MIRROR_TAKES_COLLECTIBLES: readonly string[] = ['key', 'charge', 'gate', 'stone', 'token', 'boot'];

/** The outcome of one step of a mirror. */
type MirrorStep = 'moved' | 'stayed' | 'killed';

/** The definition of a mirror player entity, or undefined for any other entity. */
function mirrorDefOf(entity: RuntimeEntity): EntityDefinition | undefined {
  if (entity.kind !== 'monster') return undefined;
  const def = ConfigRegistry.getEntityDef(entity.type);
  return def?.mirrorsCharacter !== undefined ? def : undefined;
}

/** Whether the entity is a mirror player. */
export function isMirrorEntity(entity: RuntimeEntity): boolean {
  return mirrorDefOf(entity) !== undefined;
}

/**
 * CC2 engine: whether this world plays its mirror players as actors with their own cadence. Only a level with a mirror
 * (or a mirror clone template) sets the load flag, so any other CC2 level never records a decision. Every CC2-engine
 * level carries load-order ordinals, so the ordinals no longer mark a mirror level.
 */
export function hasCc2MirrorCadence(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace && w.cc2MirrorCadence === true;
}

/** The decisions the mirror players copy, created on first use. */
function mirrorMoveOf(w: EpoxyWorld): Cc2MirrorMove {
  w.mirrorMove ??= { remembered: null, snapshot: null, attempted: false };
  return w.mirrorMove;
}

/** CC2 engine: the controlled player decided to move `dir` (a blocked try too): the mirrors read it from now on. */
export function rememberPlayerMove(w: EpoxyWorld, dir: Direction): void {
  const move = mirrorMoveOf(w);
  move.remembered = dir;
  move.attempted = true;
}

/** Whether the controlled player is free to decide: no step under way and no slide. */
function playerIsFreeToDecide(w: EpoxyWorld): boolean {
  return w.player.moveCooldown === 0 && !w.player.isSliding;
}

/**
 * CC2 engine, start of a tick: a mirror loaded at the start is ready to decide from the first tick (Lexy starts every actor
 * with a cooldown of 0), and a player free to decide who decided nothing leaves no move to copy (remember_player_move(null)).
 */
export function beginCc2MirrorTick(w: EpoxyWorld, firstTick: boolean): void {
  if (!hasCc2MirrorCadence(w)) return;
  if (firstTick) {
    for (const e of w.entities) if (mirrorDefOf(e) !== undefined) e.cooldownTicks = 0;
  }
  const move = w.mirrorMove;
  if (move !== undefined && !move.attempted && playerIsFreeToDecide(w)) move.remembered = null;
}

/**
 * CC2 engine, end of a tick: a player at rest who decided nothing, or whose step just ended, leaves no move to copy; what is
 * left is what a mirror reads in the next tick.
 */
export function endCc2MirrorTick(w: EpoxyWorld): void {
  if (!hasCc2MirrorCadence(w)) return;
  const move = w.mirrorMove;
  if (move === undefined) return;
  if (!move.attempted && playerIsFreeToDecide(w)) move.remembered = null;
  move.snapshot = move.remembered;
  move.attempted = false;
}

/** Whether the entity is still on the grid: a step of a mirror earlier in the line may have removed it. */
function isOnGrid(w: EpoxyWorld, uid: number): boolean {
  return w.entities.some((e) => e.uid === uid);
}

/**
 * The mirrors that follow the player now, in the order they step: the one furthest ahead along `dir` first, so a line
 * of mirrors does not block itself, and the list order between the ones level with each other.
 */
function activeMirrors(w: EpoxyWorld, dir: Direction): RuntimeEntity[] {
  const character = playerCharacterOf(w);
  const vec = DIRECTION_VECTORS[dir];
  const ahead = (e: RuntimeEntity): number => e.x * vec.dx + e.y * vec.dy;
  return w.entities.filter((e) => mirrorDefOf(e)?.mirrorsCharacter === character).sort((a, b) => ahead(b) - ahead(a));
}

/** CC2 engine: whether the mirror holds the boots that protect from this tile (cleats and suction boots on a floor, flippers on water, fire boots on fire). */
function holdsProtectionFor(entity: RuntimeEntity, tile: TileDefinition): boolean {
  return tile.protectedByItem !== undefined && entity.heldTools?.includes(tile.protectedByItem) === true;
}

/** The direction a mirror slides in on the tile it stands on, or null when the floor does not carry it. */
function floorCarry(entity: RuntimeEntity, def: EntityDefinition, tile: TileDefinition, w: EpoxyWorld): Direction | null {
  // CC2 engine: a mirror holding the boots against the floor (cleats, suction boots) is not carried by it.
  if (hasCc2MirrorCadence(w) && holdsProtectionFor(entity, tile)) return null;
  if (tile.slideType === 'ice') {
    // Melinda does not slide on ice, and neither does her mirror; Chip's mirror owns no skates.
    if (def.mirrorsCharacter === MELINDA_CHARACTER) return null;
    return tile.deflectionMap?.[entity.dir] ?? entity.dir;
  }
  if (tile.slideType === 'force' && tile.forceDirection !== undefined) {
    if (tile.forceDirection !== 'RANDOM') return tile.forceDirection;
    return ORDERED_DIRECTIONS[w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)];
  }
  return null;
}

/**
 * Whether the mirror may enter the cell ahead and, when it may, opens a door of its key colour in passing. The
 * checks follow the player's own entry rules with the mirror's inventory: only its infinite key, no boots, no chips.
 */
function enterAhead(ctx: EpoxyContext, entity: RuntimeEntity, def: EntityDefinition, dir: Direction): boolean {
  const w = ctx.world;
  const cc2 = hasCc2MirrorCadence(w);
  const vec = DIRECTION_VECTORS[dir];
  const nx = entity.x + vec.dx;
  const ny = entity.y + vec.dy;
  if (!isInBounds(w, nx, ny)) return false;
  // CC2 engine: a mirror holding the railroad sign leaves a track any way (Lexy railproof trait).
  const rail = cc2 && entity.heldTools?.includes(RAILROAD_SIGN_ITEM_ID) === true ? 'railproof' : undefined;
  if (isEdgeBlocked(w, entity.x, entity.y, nx, ny, dir, false, rail)) return false;
  if (w.shots.length > 0 && shotAt(w, nx, ny)?.payload !== undefined) return false;
  // CC2 engine: lit dynamite is an actor that bars every other actor, the mirrors included (Lexy dynamite_lit blocks_collision all).
  if (cc2 && isLitChargeItem(w.items[ny][nx])) return false;
  // A player in a helmet is not hurt by contact, so the mirror stops at the player's cell as any monster does.
  if (shieldedPlayerAt(w, nx, ny)) return false;

  let tile = ConfigRegistry.getTile(w.terrain[ny][nx]);
  // A top that goes away under the step (a blue fake wall, dirt) shows what it hides before the step is judged.
  if (tile.transformsToOnStep) {
    const hidden = takeRevealedTerrain(w, nx, ny);
    if (hidden !== null) {
      w.terrain[ny][nx] = hidden;
      w.gridMutatedByMove = true;
      tile = ConfigRegistry.getTile(hidden);
    }
  }
  // A wall that shows itself to the touch of the player is only a wall to a mirror. One every actor reveals (the
  // CC3D appearing wall) shows what it hides to the bump, and the step is still refused.
  if (tile.revealsToOnTouch) {
    if (tile.revealedByAny === true) {
      w.terrain[ny][nx] = tile.revealsToOnTouch;
      w.beamDirty = true;
      w.gridMutatedByMove = true;
    }
    return false;
  }
  // A socket never opens for a mirror: it picks up no chip. A fish gate that is already open admits it, as any mover.
  if (tile.requiresAllChips && !isOpenFishGate(w, tile)) return false;
  if (tile.requiredKey && cc2) {
    // CC2 engine: a mirror opens a door only with a key it holds (Lexy door blocks an actor without the key); it never spends
    // the key of its own colour (infinite_items) and spends any other.
    const held = entity.heldKeys ?? [];
    const at = held.indexOf(tile.requiredKey);
    if (at < 0) return false;
    // What the door reveals is judged before the key is spent: a mirror never opens a door onto a floor its character cannot enter.
    const beyond = ConfigRegistry.getTile(revealedTerrain(w, nx, ny) ?? (tile.transformsToOnUnlock || FLOOR_TILE_ID));
    const mirrored = def.mirrorsCharacter;
    if (mirrored === undefined) return false;
    if (beyond.characterOnly !== undefined && beyond.characterOnly !== mirrored) return false;
    const bootsBeyond = beyond.bootsForCharacter?.[mirrored];
    if (bootsBeyond !== undefined && entity.heldTools?.includes(bootsBeyond) !== true) return false;
    if (def.mirrorKey !== tile.requiredKey) {
      held.splice(at, 1);
      if (held.length === 0) delete entity.heldKeys;
    }
    const revealed = takeRevealedTerrain(w, nx, ny);
    w.terrain[ny][nx] = revealed ?? (tile.transformsToOnUnlock || FLOOR_TILE_ID);
    w.gridMutatedByMove = true;
    ctx.emitVisual('unlock', nx, ny, tile.colorKey || 'yellow');
    tile = ConfigRegistry.getTile(w.terrain[ny][nx]);
  } else if (tile.requiredKey) {
    if (def.mirrorKey !== tile.requiredKey) return false;
    const revealed = takeRevealedTerrain(w, nx, ny);
    w.terrain[ny][nx] = revealed ?? (tile.transformsToOnUnlock || FLOOR_TILE_ID);
    w.gridMutatedByMove = true;
    ctx.emitVisual('unlock', nx, ny, tile.colorKey || 'yellow');
    tile = ConfigRegistry.getTile(w.terrain[ny][nx]);
  }
  if (!tile.passableByPlayer && !isOpenFishGate(w, tile)) return false;
  const character = def.mirrorsCharacter;
  if (character === undefined) return false;
  if (tile.characterOnly !== undefined && tile.characterOnly !== character) return false;
  // The boots a character needs on dirt and gravel: a mirror holds none, except on the CC2 engine where it keeps the ones it took.
  const neededBoots = tile.bootsForCharacter?.[character];
  if (neededBoots !== undefined && !(cc2 && entity.heldTools?.includes(neededBoots) === true)) return false;
  return true;
}

/**
 * One step of a mirror in `dir`, as the character it mirrors would take it. Returns 'killed' when the step ended on
 * the live player, 'moved' or 'stayed' otherwise. A mirror that dies on the way (water, fire, a bomb) is removed and
 * counts as having moved.
 */
function stepMirror(ctx: EpoxyContext, entity: RuntimeEntity, def: EntityDefinition, dir: Direction): MirrorStep {
  const w = ctx.world;
  const here = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]);
  // A mirror on a clone machine is a template, and a trap holds it.
  if (here.isCloneMachine) return 'stayed';
  if (isCellClosedTrap(w, entity.x, entity.y)) return 'stayed';
  entity.dir = dir;
  if (!enterAhead(ctx, entity, def, dir)) return 'stayed';

  const vec = DIRECTION_VECTORS[dir];
  const nx = entity.x + vec.dx;
  const ny = entity.y + vec.dy;
  const occupant = getEntityAt(w, nx, ny);
  if (occupant) {
    if (occupant.kind !== 'block' || def.pushesBlocks !== true) return 'stayed';
    // The cell behind the block: the live player is never pushed onto.
    if (playerAtCell(w, nx + vec.dx, ny + vec.dy) !== undefined) return 'stayed';
    if (!attemptPushBlock(ctx, occupant, dir, false)) return 'stayed';
    if (!w.player.alive) return 'killed';
    // The pushed block may have sunk, burned or slid on, but it never stays in the cell.
    if (getEntityAt(w, nx, ny)) return 'stayed';
  }

  leaveSwivel(w, entity.x, entity.y, dir);
  leaveCell(w, entity.x, entity.y, { leaver: entity });
  entity.x = nx;
  entity.y = ny;
  // A top that goes away under the step (dirt, a blue fake wall) is gone once the mirror has stepped on it.
  const arrivedOn = ConfigRegistry.getTile(w.terrain[ny][nx]);
  if (arrivedOn.transformsToOnStep) {
    w.terrain[ny][nx] = arrivedOn.transformsToOnStep;
    w.gridMutatedByMove = true;
  }
  takeItemUnder(w, entity);
  return resolveMonsterArrival(ctx, entity, true) ? 'moved' : 'killed';
}

/** A mirror picks up what it steps on, except the chips and the bonus flags the player collects. */
function takeItemUnder(w: EpoxyWorld, entity: RuntimeEntity): void {
  const itemId = w.items[entity.y][entity.x];
  if (!itemId) return;
  const kind = ConfigRegistry.getTile(itemId).collectible;
  if (kind === undefined || !MIRROR_TAKES_COLLECTIBLES.includes(kind)) return;
  // CC2 engine: it keeps what it takes (keys, boots, dynamite, stones), up to four tools; a refused pickup stays on the floor.
  if (hasCc2MirrorCadence(w)) mirrorTakesItem(w, entity, entity.x, entity.y, itemId);
  else w.items[entity.y][entity.x] = null;
}

/**
 * Every mirror of the player's character steps once in `dir`, the way the player just attempted to move (a blocked
 * attempt counts). A mirror that a floor carries (Chip's mirror on ice) goes on with the floor instead. Returns false
 * when a step killed the player, so the caller stops processing.
 */
export function steerMirrors(ctx: EpoxyContext, dir: Direction): boolean {
  const w = ctx.world;
  for (const entity of activeMirrors(w, dir)) {
    if (!isOnGrid(w, entity.uid)) continue;
    const def = mirrorDefOf(entity);
    if (def === undefined) continue;
    // Ice holds the mirror to its slide; a force floor can be walked off against its push.
    const tile = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]);
    if (tile.slideType === 'ice' && floorCarry(entity, def, tile, w) !== null) continue;
    const outcome = stepMirror(ctx, entity, def, dir);
    if (outcome !== 'stayed') w.beamDirty = true;
    if (outcome === 'killed') return false;
  }
  return true;
}

/**
 * The tick of a mirror on its own: the floor it stands on carries it (Chip's mirror on ice, either on a force
 * floor), at the pace of a sliding player. Returns false when the step killed the player.
 */
export function stepMirrorFloor(ctx: EpoxyContext, entity: RuntimeEntity): boolean {
  const w = ctx.world;
  const cc2 = hasCc2MirrorCadence(w);
  if (entity.cooldownTicks > 0) {
    entity.cooldownTicks--;
    // CC2 engine: the pass in which the countdown ends is the pass its step ends in (see RuntimeEntity.stepEndedPass).
    if (cc2 && entity.cooldownTicks === 0) {
      entity.stepEndedPass = currentEntityPass(w);
      entity.stepEndedCell = entity.y * mapWidth(w) + entity.x;
    }
    return true;
  }
  const def = mirrorDefOf(entity);
  if (def === undefined) return true;
  const tile = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]);
  const carried = floorCarry(entity, def, tile, w);
  if (cc2 && carried === null) return decideMirrorStep(ctx, entity, def);
  if (carried === null) return true;
  const slideCooldown = ConfigRegistry.getGame().timing.slideCooldownTicks;
  // CC2 engine: the step's own cooldown is set before the arrival, so a pulse arrival it queues gets the right due.
  entity.cooldownTicks = cc2 ? CC2_MIRROR_WALK_COOLDOWN_TICKS : tile.slideType === 'force' ? slideCooldown + FORCE_SLIDE_EXTRA_COOLDOWN_TICKS : slideCooldown;
  let outcome = stepMirror(ctx, entity, def, carried);
  // CC2 engine: the step time comes from the cell entered (half a walking step onto ice or a force floor), as any actor's.
  if (cc2) entity.cooldownTicks = mirrorStepCooldown(w, entity);
  if (outcome === 'stayed' && tile.slideType === 'ice') {
    // Blocked on ice, the mirror bounces back the way it came.
    const bounce = OPPOSITE_DIRECTION[carried];
    outcome = stepMirror(ctx, entity, def, tile.cc3dCornerBounce === true ? bounce : tile.deflectionMap?.[bounce] ?? bounce);
    // A refused bounce on a CC3D corner leaves the mirror facing the exit again, so the corner does not turn it back out.
    if (outcome === 'stayed' && tile.cc3dCornerBounce === true) entity.dir = carried;
  }
  if (outcome !== 'stayed') w.beamDirty = true;
  return outcome !== 'killed';
}

/** CC2 engine: the cooldown a mirror's step ends with, read from the cell it entered: half a walking step onto ice or a force floor. */
function mirrorStepCooldown(w: EpoxyWorld, entity: RuntimeEntity): number {
  const tile = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]);
  return tile.slideType !== undefined && !holdsProtectionFor(entity, tile) ? CC2_MIRROR_SLIDE_COOLDOWN_TICKS : CC2_MIRROR_WALK_COOLDOWN_TICKS;
}

/**
 * CC2 engine: the move a mirror reads this pass, or null when there is none. Lexy runs the actors in reverse list order and
 * the player is one of them (game.js:531-541, swap_players game.js:1408): a mirror listed before the player runs after him
 * and reads the decision of this tick, one listed after him (a clone spawned later counts as after) reads the previous
 * tick's.
 */
function decidedMoveFor(w: EpoxyWorld, entity: RuntimeEntity): Direction | null {
  const move = w.mirrorMove;
  if (move === undefined) return null;
  const playerOrdinal = w.player.listOrdinal;
  const listedBeforePlayer = entity.listOrdinal !== undefined && playerOrdinal !== undefined && entity.listOrdinal < playerOrdinal;
  return listedBeforePlayer ? move.remembered : move.snapshot;
}

/**
 * CC2 engine: the decision of a mirror that no floor carries. It steps the way the player decided while he is the character
 * it mirrors, then waits a walking step. A mirror a shut trap held is pushed out forward the pass the trap opens, whatever
 * the player decided and whoever he is (Lexy attempt_out_of_turn_step, tiletypes.js:1768-1777).
 */
function decideMirrorStep(ctx: EpoxyContext, entity: RuntimeEntity, def: EntityDefinition): boolean {
  const w = ctx.world;
  let ejected = false;
  if (ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]).isTrap === true) {
    if (isCellClosedTrap(w, entity.x, entity.y)) entity.trapHeld = true;
    else if (entity.trapHeld === true) {
      delete entity.trapHeld;
      ejected = true;
    }
  }
  let want: Direction | null;
  if (ejected) want = entity.dir;
  else {
    if (def.mirrorsCharacter !== playerCharacterOf(w) || !w.player.alive || w.levelCompleted) return true;
    want = decidedMoveFor(w, entity);
  }
  if (want === null) return true;
  // The step's own cooldown is set before the arrival, so a button press it queues lands when the step ends.
  entity.cooldownTicks = CC2_MIRROR_WALK_COOLDOWN_TICKS;
  const outcome = stepMirror(ctx, entity, def, want);
  entity.cooldownTicks = outcome === 'moved' ? mirrorStepCooldown(w, entity) : 0;
  if (outcome === 'moved' && isCellClosedTrap(w, entity.x, entity.y)) entity.trapHeld = true;
  if (outcome !== 'stayed') w.beamDirty = true;
  return outcome !== 'killed';
}
