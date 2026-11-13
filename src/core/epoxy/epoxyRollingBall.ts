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
import { ROLLING_BALL_ENTITY_ID, ROLLING_BALL_PATTERN, STONE_DEATH_REASON_KEY } from '../coreConstants';
import type { ButtonAction, Direction, EntityDefinition, PlayerState, RuntimeEntity } from '../types';
import { usesCc2Engine } from './ccRules';
import { CC2_SPLASH_BLOCK_PASSES } from './epoxyBlocks';
import { canMonsterEnter, stepClassicMonsterOutOfTurn } from './epoxyMonsters';
import { railRedirect } from './epoxyRailsCc2';
import { toggleHeldButton } from './epoxySignals';
import { type EpoxyContext, type EpoxyWorld, getEntityAt, killPlayerAt, mapWidth, playerAtCell, removeEntity } from './epoxyWorld';

/** Ticks added to the countdown of a ball after its first step out of the player's cell: it spends a whole step there, counted from the drop. */
const LAUNCH_EXTRA_COOLDOWN_TICKS = 1;
/** Sound of a ball blowing up, and of the actor it kills. */
const BALL_BLAST_SFX = 'bomb';
/** The buttons an actor holds down by standing on them (the orange one is a held signal source, the brown one a trap hold): removed in place, the ball leaves them held (Lexy transmutes it, no on_depart). */
const HELD_SIGNAL_SOURCE = 'held';
const HELD_BUTTON_ACTIONS: readonly ButtonAction[] = ['hold_trap'];

/** What stops a rolling ball: an actor (a block, a monster or a player) it kills as it blows up, or the terrain. */
type BallBlocker = { entity: RuntimeEntity } | { player: PlayerState } | 'terrain';

/** True for the definition of the CC2 rolling ball. */
export function isRollingBallDef(def: EntityDefinition | undefined): boolean {
  return def?.movementPattern === ROLLING_BALL_PATTERN;
}

/** True for a rolling ball entity. */
export function isRollingBall(entity: RuntimeEntity): boolean {
  return isRollingBallDef(ConfigRegistry.getEntityDef(entity.type));
}

/** CC2 engine: leaves the blast of an explosion on the cell, which bars the real player for a few entity passes (as a block a bomb destroyed does). */
function leaveBlast(w: EpoxyWorld, x: number, y: number): void {
  const cell = y * mapWidth(w) + x;
  w.blockSplashes.set(cell, w.ccMonsterClock + CC2_SPLASH_BLOCK_PASSES);
  w.blockExplosions.add(cell);
}

/** An actor removed in place from a button that an actor holds down leaves it held: no release runs (Lexy: the tile becomes an animation). */
function keepHeldButton(w: EpoxyWorld, x: number, y: number): void {
  const tile = ConfigRegistry.getTile(w.terrain[y]?.[x]);
  if (tile.signalSource === HELD_SIGNAL_SOURCE || (tile.buttonAction !== undefined && HELD_BUTTON_ACTIONS.includes(tile.buttonAction))) {
    toggleHeldButton(w, x, y);
  }
}

/** What the ball would run into trying to roll from its cell toward `dir`, or null when the way is free. */
function ballBlocker(w: EpoxyWorld, ball: RuntimeEntity, dir: Direction): BallBlocker | null {
  // The same probe a step makes (a track turns it, an appearing wall looks like floor); the occupants are judged here.
  if (!canMonsterEnter(w, ball, dir, true, false, true)) return 'terrain';
  const vec = DIRECTION_VECTORS[railRedirect(w, ball.x, ball.y, dir, 'walker')];
  const nx = ball.x + vec.dx;
  const ny = ball.y + vec.dy;
  const player = playerAtCell(w, nx, ny);
  if (player !== undefined) return { player };
  const entity = getEntityAt(w, nx, ny);
  return entity !== undefined ? { entity } : null;
}

/**
 * Blows the ball up where it stands: it is gone, and its cell holds a blast that bars the player (a ball spent at the very
 * moment it is set down leaves a harmless one: `bars` false). A button it held down stays held.
 */
export function explodeRollingBall(ctx: EpoxyContext, ball: RuntimeEntity, bars = true): void {
  const w = ctx.world;
  removeEntity(w, ball.uid);
  w.beamDirty = true;
  AudioManager.playSfx(BALL_BLAST_SFX);
  ctx.emitVisual('explosion', ball.x, ball.y);
  if (bars) leaveBlast(w, ball.x, ball.y);
  keepHeldButton(w, ball.x, ball.y);
}

/** Kills what stopped the ball (a helmet does not protect a player), then blows the ball up. Returns false when a player died. */
function settleBlocked(ctx: EpoxyContext, ball: RuntimeEntity, blocker: BallBlocker, bars: boolean): boolean {
  const w = ctx.world;
  if (blocker !== 'terrain') {
    if ('player' in blocker) {
      killPlayerAt(ctx, blocker.player, STONE_DEATH_REASON_KEY, BALL_BLAST_SFX);
    } else {
      const victim = blocker.entity;
      removeEntity(w, victim.uid);
      w.beamDirty = true;
      ctx.emitVisual('explosion', victim.x, victim.y);
      leaveBlast(w, victim.x, victim.y);
      keepHeldButton(w, victim.x, victim.y);
    }
  }
  explodeRollingBall(ctx, ball, bars);
  return w.player.alive;
}

/**
 * The rolling ball's own check of the way it is about to roll (Lexy rolling_ball.on_blocked): an actor in the way is killed and the
 * ball blows up, also while it slides; terrain in the way blows it up unless it slides (on ice or a force floor it only bounces
 * or stops). Called at its decision and again when its step is tried. Returns false when the player was killed.
 */
export function checkBallWay(ctx: EpoxyContext, ball: RuntimeEntity, dir: Direction): boolean {
  const w = ctx.world;
  const blocker = ballBlocker(w, ball, dir);
  if (blocker === null) return true;
  if (blocker === 'terrain' && ConfigRegistry.getTile(w.terrain[ball.y]?.[ball.x]).slideType !== undefined) return true;
  return settleBlocked(ctx, ball, blocker, true);
}

/**
 * The rolling ball's on_bumped (Lexy tiletypes.js rolling_ball): an actor whose decision (or step) probes the cell of a ball, in
 * whichever way it was only trying, blows up with it. Called by the probe of a monster that picks its way, not by the entry test.
 * Only the entities are touched (no visual): the probing monster is gone from the list afterwards.
 */
export function bumpRollingBall(w: EpoxyWorld, monster: RuntimeEntity, wanted: Direction): void {
  if (!usesCc2Engine(w.level)) return;
  const moved = ConfigRegistry.getEntityDef(monster.type)?.ignoresFloorEffects === true ? wanted : railRedirect(w, monster.x, monster.y, wanted, 'walker');
  const vec = DIRECTION_VECTORS[moved];
  const nx = monster.x + vec.dx;
  const ny = monster.y + vec.dy;
  const ball = w.entities.find((e) => e.x === nx && e.y === ny && e.uid !== monster.uid && isRollingBall(e));
  if (ball === undefined) return;
  removeEntity(w, monster.uid);
  removeEntity(w, ball.uid);
  w.beamDirty = true;
  AudioManager.playSfx(BALL_BLAST_SFX);
  for (const spent of [monster, ball]) {
    leaveBlast(w, spent.x, spent.y);
    keepHeldButton(w, spent.x, spent.y);
  }
}

/**
 * The CC2 bowling ball as an actor: the `rolling_ball` monster a player sets down on a CC2-engine level. It is added at the end
 * of the entity list and leaves the cell it was set down in at once, into the cell the player faces, by the step of any
 * monster (a track, ice or a force floor does not turn this first step). A ball that cannot enter that cell is spent: an actor
 * there is killed and the ball blows up. Returns true when the ball was set down (it may be spent at once), false when this
 * level does not play the ball as an actor.
 */
export function launchRollingBall(ctx: EpoxyContext, x: number, y: number, dir: Direction): boolean {
  const w = ctx.world;
  if (!usesCc2Engine(w.level)) return false;
  // A uid removed earlier in this pass (or before an undo) must not make the new ball look removed.
  w.removedUids.clear();
  const ball: RuntimeEntity = { uid: w.nextEntityUid++, type: ROLLING_BALL_ENTITY_ID, kind: 'monster', x, y, dir, cooldownTicks: 0, isSliding: false };
  w.entities.push(ball);
  const blocker = ballBlocker(w, ball, dir);
  if (blocker !== null) {
    settleBlocked(ctx, ball, blocker, false);
    return true;
  }
  // The first step is taken out of turn, toward the way faced whatever the floor of the cell says.
  w.ccPlans.set(ball.uid, dir);
  stepClassicMonsterOutOfTurn(ctx, ball);
  w.ccPlans.delete(ball.uid);
  if (w.entities.includes(ball) && ball.cooldownTicks > 0) ball.cooldownTicks += LAUNCH_EXTRA_COOLDOWN_TICKS;
  return true;
}
