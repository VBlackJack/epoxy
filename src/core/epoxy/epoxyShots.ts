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
import { FLOOR_TILE_ID, reflectOnMirror } from '../coreConstants';
import { Direction, RuntimeEntity, Shot, ShotEffect } from '../types';
import {
  EpoxyContext,
  EpoxyWorld,
  cellKey,
  getEntityAt,
  isEdgeBlocked,
  isInBounds,
  killPlayer,
  removeEntity,
  shotAt
} from './epoxyWorld';

/** Reason shown when a shot kills the player. */
const SHOT_DEATH_REASON_KEY = 'hud.messages.death_laser';
/** Sound played when a shot kills or destroys something. */
const SHOT_HIT_SFX = 'burn';
/** Sound played when a shot sets a bomb item off. */
const SHOT_BOMB_SFX = 'bomb';
/** What a shot does to a monster when its definition does not say. */
const DEFAULT_MONSTER_SHOT_EFFECT: ShotEffect = 'destroy';
/** What a shot does to a block that is not a mirror when its definition does not say. */
const DEFAULT_BLOCK_SHOT_EFFECT: ShotEffect = 'stop';
/** What a shot does to a mirror when its definition does not say. */
const MIRROR_SHOT_EFFECT: ShotEffect = 'reflect';

/** What a shot does to the entity: its definition says, else a mirror reflects, a monster dies and a block stops it. */
export function shotEffectOf(entity: RuntimeEntity): ShotEffect {
  const def = ConfigRegistry.getEntityDef(entity.type);
  if (def?.shotEffect !== undefined) return def.shotEffect;
  if (def?.mirrorAxis !== undefined) return MIRROR_SHOT_EFFECT;
  return entity.kind === 'monster' ? DEFAULT_MONSTER_SHOT_EFFECT : DEFAULT_BLOCK_SHOT_EFFECT;
}

/**
 * Identity of the shots in flight for the exhaustive searches: empty when there are none (or the level has
 * no launchers, `undefined`), so every other key stays as it was.
 */
export function shotsStateKey(shots: readonly Shot[] | undefined): string {
  if (shots === undefined || shots.length === 0) return '';
  return `S${shots.map((s) => `${s.x},${s.y},${s.dir},${s.cooldown}`).sort().join(';')}`;
}

/** Removes the first shot in the cell, spent by what ran into it. Returns false when there is none. */
export function consumeShotAt(w: EpoxyWorld, x: number, y: number): boolean {
  const shot = shotAt(w, x, y);
  if (!shot) return false;
  w.shots = w.shots.filter((s) => s !== shot);
  return true;
}

/** Kills the player who ran into a shot (the caller spent the shot). */
export function killPlayerByShot(ctx: EpoxyContext): void {
  killPlayer(ctx, SHOT_DEATH_REASON_KEY, SHOT_HIT_SFX);
}

/** Removes a monster that ran into a shot (the caller spent the shot). */
export function killMonsterByShot(ctx: EpoxyContext, entity: RuntimeEntity): void {
  destroyEntityByShot(ctx, entity);
}

function destroyEntityByShot(ctx: EpoxyContext, entity: RuntimeEntity): void {
  const w = ctx.world;
  removeEntity(w, entity.uid);
  // A block or monster gone from a beam path changes the beams.
  w.beamDirty = true;
  AudioManager.playSfx(SHOT_HIT_SFX);
  ctx.emitVisual('explosion', entity.x, entity.y);
}

/** What a shot did on entering a cell: it flew on turning to `dir`, or it ended. */
type ShotEntry = { flies: true; dir: Direction } | { flies: false };

const ENDED: ShotEntry = { flies: false };

/**
 * Resolves a shot entering the cell next to (fromX, fromY) in `dir`. It ends at the map edge, a thin
 * wall and any cell that is not laser transparent. Otherwise: the player there dies; an entity acts on it
 * as its shotEffect says (a mirror turns it from its front and is destroyed with it from behind, a monster
 * dies, an ice block melts, another block stops it); with no entity, a bomb item goes off with it and any
 * other item stops it. A shot meets the entity of a cell before its item. Water, fire, ice, force floors,
 * plates, buttons and teleporters do nothing to it, and it presses and takes none.
 */
function enterCell(ctx: EpoxyContext, fromX: number, fromY: number, dir: Direction): ShotEntry {
  const w = ctx.world;
  const vec = DIRECTION_VECTORS[dir];
  const nx = fromX + vec.dx;
  const ny = fromY + vec.dy;
  if (!isInBounds(w, nx, ny) || isEdgeBlocked(w, fromX, fromY, nx, ny, dir)) return ENDED;
  if (ConfigRegistry.getTile(w.terrain[ny][nx]).laserTransparent !== true) return ENDED;

  if (w.player.alive && w.player.x === nx && w.player.y === ny) {
    killPlayerByShot(ctx);
    return ENDED;
  }

  const entity = getEntityAt(w, nx, ny);
  if (entity) return enterEntityCell(ctx, entity, dir);

  const itemId = w.items[ny][nx];
  if (itemId) {
    if (ConfigRegistry.getTile(itemId).hazard === 'bomb') {
      w.items[ny][nx] = null;
      AudioManager.playSfx(SHOT_BOMB_SFX);
      ctx.emitVisual('explosion', nx, ny);
    }
    return ENDED;
  }
  return { flies: true, dir };
}

/** The effect of a shot entering the cell of an entity. */
function enterEntityCell(ctx: EpoxyContext, entity: RuntimeEntity, dir: Direction): ShotEntry {
  const w = ctx.world;
  const effect = shotEffectOf(entity);
  if (effect === 'stop') return ENDED;
  if (effect === 'reflect') {
    const def = ConfigRegistry.getEntityDef(entity.type);
    const turned = def?.mirrorAxis === undefined ? null : reflectOnMirror(def.mirrorAxis, def.mirrorFrontCorner, dir);
    if (turned !== null) return { flies: true, dir: turned };
    // The back of a one-sided mirror: it is destroyed with the shot.
    destroyEntityByShot(ctx, entity);
    return ENDED;
  }
  if (effect === 'melt') {
    const melted = ConfigRegistry.getEntityDef(entity.type)?.meltsInFireTo;
    // Only a block standing on plain floor leaves what it melts into; elsewhere the terrain stays.
    if (melted !== undefined && w.terrain[entity.y][entity.x] === FLOOR_TILE_ID) w.terrain[entity.y][entity.x] = melted;
  }
  destroyEntityByShot(ctx, entity);
  return ENDED;
}

/**
 * Fires every launcher linked to the trigger at (bx, by). A launcher fires at most once per tick and only
 * while its cell still holds a launcher (one under a removable top is silent until the top is gone). The
 * shot enters the cell in front of the launcher at once; if it survives that cell it flies on. A trigger
 * without a link fires nothing. Returns false when a shot killed the player.
 */
export function fireLaunchers(ctx: EpoxyContext, bx: number, by: number): boolean {
  const w = ctx.world;
  if (!w.hasLaunchers) return w.player.alive;
  for (const link of w.launcherLinks) {
    if (link.buttonX !== bx || link.buttonY !== by) continue;
    if (!fireLauncherAt(ctx, link.launcherX, link.launcherY)) return false;
  }
  return true;
}

/**
 * Fires the launcher at (lx, ly) once: the same rules as a trigger's link (the per-tick cap, the tile check, the
 * first cell entered at once), used by a trigger link and by a signal sink. Does nothing on a level without
 * launchers or when the cell holds no launcher now. Returns false when a shot killed the player.
 */
export function fireLauncherAt(ctx: EpoxyContext, lx: number, ly: number): boolean {
  const w = ctx.world;
  if (!w.hasLaunchers) return w.player.alive;
  const launcher = ConfigRegistry.getTile(w.terrain[ly]?.[lx]).shotLauncher;
  if (!launcher) return true;
  const key = cellKey(lx, ly);
  if (w.firedLaunchers.has(key)) return true;
  w.firedLaunchers.add(key);

  const entry = enterCell(ctx, lx, ly, launcher.dir);
  if (!w.player.alive) return false;
  if (!entry.flies) return true;
  const vec = DIRECTION_VECTORS[launcher.dir];
  // Fired during a tick, the shot is advanced by that same tick: it starts one tick later to keep its pace.
  w.shots.push({
    x: lx + vec.dx,
    y: ly + vec.dy,
    dir: entry.dir,
    cooldown: w.inTick ? w.shotStepTicks : w.shotStepTicks - 1
  });
  return true;
}

/**
 * Moves the shots on by a tick, in the order they were fired: a shot waits out its cooldown, then crosses
 * one cell and waits again. Does nothing while the player is dead or the level is won. A shot another
 * shot's step already spent is skipped.
 */
export function advanceShots(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (w.shots.length === 0 || !w.player.alive || w.levelCompleted) return;
  for (const shot of [...w.shots]) {
    if (!w.shots.includes(shot)) continue;
    if (shot.cooldown > 0) {
      shot.cooldown--;
      continue;
    }
    const entry = enterCell(ctx, shot.x, shot.y, shot.dir);
    if (entry.flies) {
      const vec = DIRECTION_VECTORS[shot.dir];
      shot.x += vec.dx;
      shot.y += vec.dy;
      shot.dir = entry.dir;
      shot.cooldown = w.shotStepTicks - 1;
    } else {
      w.shots = w.shots.filter((s) => s !== shot);
    }
    if (!w.player.alive) return;
  }
}
