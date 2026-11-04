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
import {
  BOMB_ITEM_ID,
  CHIP_ITEM_ID,
  DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
  GRAY_BUTTON_RADIUS,
  CHANNEL_TOGGLE_PARITY_BITS,
  FIRE_LAUNCHERS_ACTION,
  GREEN_TOGGLE_PARITY_BIT,
  OPPOSITE_DIRECTION,
  STEER_MONSTERS_ACTION,
  channelOfButtonAction
} from '../coreConstants';
import { ButtonAction, ChannelColor, Direction, RuntimeEntity, TileDefinition } from '../types';
import { isCanBlockEnter, moveBlockTo } from './epoxyBlocks';
import { canMonsterEnter, resolveMonsterArrival } from './epoxyMonsters';
import { fireLaunchers } from './epoxyShots';
import { steerMonsters } from './epoxySteering';
import {
  EpoxyContext,
  EpoxyWorld,
  getEntityAt,
  holdColorsOpen,
  isInBounds,
  killPlayer,
  removeEntity
} from './epoxyWorld';

/** Hard cap on live entities, so a cloner wired to a held button cannot flood the grid. */
const MAX_ACTIVE_ENTITIES = 512;

/** Sound played when hold doors open or close. */
const HOLD_DOOR_SFX = 'door';

/** Returns false when a clone spawned by the button killed the player. */
export function triggerButton(ctx: EpoxyContext, bx: number, by: number, action: ButtonAction): boolean {
  const w = ctx.world;
  AudioManager.playSfx('button');

  if (action === 'toggle_walls') {
    swapTerrain(w, (tile) => tile.togglesTo);
    flipToggleParity(w, GREEN_TOGGLE_PARITY_BIT);
  } else if (channelOfButtonAction(action) !== undefined) {
    // A colour button swaps the walls of its own channel only; green walls and the other colours stay.
    const channel = channelOfButtonAction(action);
    swapTerrain(w, (tile) => (tile.toggleChannel === channel ? tile.channelTogglesTo : undefined));
    flipToggleParity(w, CHANNEL_TOGGLE_PARITY_BITS[channel as ChannelColor] ?? 0);
  } else if (action === 'toggle_flames') {
    swapTerrain(w, (tile) => tile.flameTogglesTo);
    burnPlayerIfFlamesLit(ctx);
    burnEntitiesOnFire(ctx);
  } else if (action === 'swap_chips_bombs') {
    swapChipsAndBombs(w, bx, by);
  } else if (action === 'reverse_tanks') {
    for (const ent of w.entities) {
      if (ConfigRegistry.getEntityDef(ent.type)?.reversedByButton) {
        ent.dir = OPPOSITE_DIRECTION[ent.dir];
      }
    }
  } else if (action === STEER_MONSTERS_ACTION) {
    // The player's step ends on the pad: the puppets step the way the player moved.
    if (!steerMonsters(ctx, w.player.dir)) return false;
  } else if (action === FIRE_LAUNCHERS_ACTION) {
    if (!fireLaunchers(ctx, bx, by)) return false;
  } else if (action === 'trigger_cloner') {
    const links = w.cloneLinks.filter((l) => l.buttonX === bx && l.buttonY === by);
    if (links.length > 0) {
      for (const link of links) {
        if (!spawnFromCloner(ctx, link.clonerX, link.clonerY, link.templateType, link.templateDir)) {
          return false;
        }
      }
    } else {
      // Fallback: trigger any clone machine that has an entity template sitting on it
      for (const ent of [...w.entities]) {
        if (ConfigRegistry.getTile(w.terrain[ent.y]?.[ent.x]).isCloneMachine) {
          if (!spawnFromCloner(ctx, ent.x, ent.y, ent.type, ent.dir)) return false;
        }
      }
    }
  }
  return true;
}

/** Records one press of a toggle family, when the level hides a wall of that family under a removable top. */
function flipToggleParity(w: EpoxyWorld, bit: number): void {
  if ((w.coveredToggleBits & bit) !== 0) w.toggleParity ^= bit;
}

/**
 * Sets every hold door from the plates of its colour: open while the colour has at least one plate and
 * every one of them is pressed, closed otherwise (a colour with no plate keeps its doors shut). A door
 * that closes on an occupied cell follows its `holdDoorClosesOnOccupant` rule: shut at once by default,
 * the occupant may leave and nothing may enter, or kept open until the cell is free. Returns true when a
 * door changed, so the caller can retrace the lasers. Returns at once on a level without hold doors.
 * The pass reads the plates as they are when it runs: doors settle at the end of a tick or move, while
 * a brown trap reads its button live.
 */
export function setHoldDoors(ctx: EpoxyContext, playSound: boolean = true): boolean {
  const w = ctx.world;
  if (w.holdDoors.length === 0) return false;

  const platesOpen = holdColorsOpen(w);

  let changed = false;
  for (const { x, y } of w.holdDoors) {
    const tile = ConfigRegistry.getTile(w.terrain[y][x]);
    if (tile.holdDoorColor === undefined || !tile.holdDoorTogglesTo) continue;
    const wantsOpen = platesOpen.get(tile.holdDoorColor) === true;
    if (tile.holdDoorOpen === wantsOpen) continue;
    const occupied = (w.player.x === x && w.player.y === y) || getEntityAt(w, x, y) !== undefined;
    if (!wantsOpen && occupied && tile.holdDoorClosesOnOccupant === false) continue;
    w.terrain[y][x] = tile.holdDoorTogglesTo;
    changed = true;
  }
  if (changed) {
    if (playSound) AudioManager.playSfx(HOLD_DOOR_SFX);
    w.beamDirty = true;
  }
  return changed;
}

/**
 * Swaps chips and bombs in the square region centered on `(bx, by)`. The chip count
 * the exit asks for stays as it is: a chip turned into a bomb never stands in for one
 * collected, so the button cannot open the exit early.
 */
function swapChipsAndBombs(w: EpoxyWorld, bx: number, by: number): void {
  const minY = Math.max(0, by - GRAY_BUTTON_RADIUS);
  const maxY = Math.min(w.items.length - 1, by + GRAY_BUTTON_RADIUS);
  for (let y = minY; y <= maxY; y++) {
    const minX = Math.max(0, bx - GRAY_BUTTON_RADIUS);
    const maxX = Math.min(w.items[y].length - 1, bx + GRAY_BUTTON_RADIUS);
    for (let x = minX; x <= maxX; x++) {
      const item = w.items[y][x];
      if (item === CHIP_ITEM_ID) {
        w.items[y][x] = BOMB_ITEM_ID;
      } else if (item === BOMB_ITEM_ID) {
        w.items[y][x] = CHIP_ITEM_ID;
      }
    }
  }
}

/** Replaces every tile for which `target` names a terrain by that terrain. */
function swapTerrain(w: EpoxyWorld, target: (tile: TileDefinition) => string | undefined): void {
  for (let y = 0; y < w.terrain.length; y++) {
    for (let x = 0; x < w.terrain[y].length; x++) {
      const next = target(ConfigRegistry.getTile(w.terrain[y][x]));
      if (next) {
        w.terrain[y][x] = next;
      }
    }
  }
}

/**
 * Applies the fire rule to every entity standing on fire after the jets were
 * swapped, as if it had just stepped there: a block that fire destroys melts
 * (leaving what its definition names), a monster that is not immune dies.
 */
function burnEntitiesOnFire(ctx: EpoxyContext): void {
  const w = ctx.world;
  for (const entity of [...w.entities]) {
    const tile = ConfigRegistry.getTile(w.terrain[entity.y][entity.x]);
    if (tile.hazard !== 'fire') continue;
    const def = ConfigRegistry.getEntityDef(entity.type);
    if (entity.kind === 'block') {
      if (!def?.destroyedByFire) continue;
      if (def.meltsInFireTo) {
        w.terrain[entity.y][entity.x] = def.meltsInFireTo;
      }
    } else if (def?.immuneToFire) {
      continue;
    }
    removeEntity(w, entity.uid);
    AudioManager.playSfx('burn');
    ctx.emitVisual('explosion', entity.x, entity.y);
  }
}

/** A flame jet lit under the player (a monster or block pressed the button) burns them. */
function burnPlayerIfFlamesLit(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (!w.player.alive) return;
  const tile = ConfigRegistry.getTile(w.terrain[w.player.y][w.player.x]);
  if (tile.hazard === 'fire' && (!tile.protectedByItem || !w.player.boots.has(tile.protectedByItem))) {
    ctx.emitVisual('explosion', w.player.x, w.player.y);
    killPlayer(ctx, 'hud.messages.death_fire', 'burn');
  }
}

/**
 * Spawns a copy of the template in front of the cloner, using the same
 * entry rules as a regular monster step or block push, so a clone never
 * appears inside a wall or another blocked cell. Returns false when the
 * clone's arrival killed the player, so the caller stops processing.
 */
function spawnFromCloner(
  ctx: EpoxyContext,
  clonerX: number,
  clonerY: number,
  templateType: string,
  templateDir: Direction
): boolean {
  const w = ctx.world;
  if (w.entities.length >= MAX_ACTIVE_ENTITIES) return true;

  const vec = DIRECTION_VECTORS[templateDir];
  const spawnX = clonerX + vec.dx;
  const spawnY = clonerY + vec.dy;
  if (!isInBounds(w, spawnX, spawnY)) return true;
  if (w.player.x === spawnX && w.player.y === spawnY) return true;

  const def = ConfigRegistry.getEntityDef(templateType);
  const kind = def?.kind || 'block';
  const probe: RuntimeEntity = {
    uid: 0,
    type: templateType,
    kind,
    x: clonerX,
    y: clonerY,
    dir: templateDir,
    cooldownTicks: 0,
    isSliding: false
  };
  const canEnter =
    kind === 'block'
      ? isCanBlockEnter(w, probe, spawnX, spawnY, templateDir)
      : canMonsterEnter(w, probe, templateDir);
  if (!canEnter) return true;

  // A turret clone fires the way its template does now (templates turn), else the way it is spawned.
  const template = w.entities.find((e) => e.x === clonerX && e.y === clonerY && e.type === templateType);
  const spawned: RuntimeEntity = {
    uid: w.nextEntityUid++,
    type: templateType,
    kind,
    x: spawnX,
    y: spawnY,
    dir: templateDir,
    cooldownTicks: def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
    isSliding: kind === 'block',
    ...(def?.turretBeam ? { facing: template?.facing ?? templateDir } : {})
  };
  w.entities.push(spawned);
  if (spawned.kind === 'block') {
    moveBlockTo(ctx, spawned, spawnX, spawnY, templateDir);
  } else {
    return resolveMonsterArrival(ctx, spawned, true);
  }
  return true;
}
