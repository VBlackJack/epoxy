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
 * using the key up, is stopped by what stops that character (dirt and gravel for Melinda without boots, a sign for
 * the other character), pushes blocks, takes the items lying on its way, presses the buttons it steps on and dies in
 * water, fire and bombs. Chip's mirror slides on ice; Melinda's does not. It kills the player on contact, whoever
 * moves into the other, and its own death does not end the level.
 */

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../../config/constants';
import { FLOOR_TILE_ID, MELINDA_CHARACTER, OPPOSITE_DIRECTION } from '../coreConstants';
import { Direction, EntityDefinition, RuntimeEntity, TileDefinition } from '../types';
import { attemptPushBlock } from './epoxyBlocks';
import { resolveMonsterArrival } from './epoxyMonsters';
import { shieldedPlayerAt } from './epoxyWard';
import { leaveSwivel } from './epoxySwivels';
import { EpoxyContext, EpoxyWorld, getEntityAt, isCellClosedTrap, isEdgeBlocked, isInBounds, isOpenFishGate, leaveCell, playerAtCell, playerCharacterOf, shotAt, takeRevealedTerrain } from './epoxyWorld';

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

/** The direction a mirror slides in on the tile it stands on, or null when the floor does not carry it. */
function floorCarry(entity: RuntimeEntity, def: EntityDefinition, tile: TileDefinition, w: EpoxyWorld): Direction | null {
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
  const vec = DIRECTION_VECTORS[dir];
  const nx = entity.x + vec.dx;
  const ny = entity.y + vec.dy;
  if (!isInBounds(w, nx, ny)) return false;
  if (isEdgeBlocked(w, entity.x, entity.y, nx, ny, dir)) return false;
  if (w.shots.length > 0 && shotAt(w, nx, ny)?.payload !== undefined) return false;
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
  if (tile.requiredKey) {
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
  // The boots a character needs on dirt and gravel: a mirror holds none.
  if (tile.bootsForCharacter?.[character] !== undefined) return false;
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
  if (kind !== undefined && MIRROR_TAKES_COLLECTIBLES.includes(kind)) w.items[entity.y][entity.x] = null;
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
  if (entity.cooldownTicks > 0) {
    entity.cooldownTicks--;
    return true;
  }
  const def = mirrorDefOf(entity);
  if (def === undefined) return true;
  const tile = ConfigRegistry.getTile(w.terrain[entity.y]?.[entity.x]);
  const carried = floorCarry(entity, def, tile, w);
  if (carried === null) return true;
  const slideCooldown = ConfigRegistry.getGame().timing.slideCooldownTicks;
  entity.cooldownTicks = tile.slideType === 'force' ? slideCooldown + FORCE_SLIDE_EXTRA_COOLDOWN_TICKS : slideCooldown;
  let outcome = stepMirror(ctx, entity, def, carried);
  if (outcome === 'stayed' && tile.slideType === 'ice') {
    // Blocked on ice, the mirror bounces back the way it came.
    const bounce = OPPOSITE_DIRECTION[carried];
    outcome = stepMirror(ctx, entity, def, tile.deflectionMap?.[bounce] ?? bounce);
  }
  if (outcome !== 'stayed') w.beamDirty = true;
  return outcome !== 'killed';
}
