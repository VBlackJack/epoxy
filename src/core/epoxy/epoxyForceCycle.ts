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

import { FORCE_CYCLE_ORDER } from '../../config/constants';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import type { Direction, PlayerState, RuntimeEntity, TileDefinition } from '../types';
import { usesCc2Engine } from './ccRules';
import type { EpoxyWorld } from './epoxyWorld';

/**
 * The direction a turning force floor pushes an actor that has just arrived on it, or null when the tile is not
 * a turning force floor. Every arrival of any actor (player, block or monster, carried or not, protected or not)
 * on any such cell takes the next direction of the level's shared turn: the first arrival pushes east, then
 * south, west and north, and east again.
 */
export function forceCycleArrival(w: EpoxyWorld, tile: TileDefinition): Direction | null {
  if (tile.forceCycle !== true) return null;
  const dir = FORCE_CYCLE_ORDER[w.forceCycleTurn % FORCE_CYCLE_ORDER.length];
  w.forceCycleTurn++;
  return dir;
}

/** An actor that holds a deferred turning-floor draw: a monster, a block or a player. */
type RffActor = RuntimeEntity | PlayerState;

/**
 * Whether the deferred turning-floor draws of wave 35 run on this world: the CC2 engine off the CC3D pace, on a level with one player
 * (actor order). Every helper below acts only then, so a level with several players or parked players keeps its draw at the step start.
 */
export function rffActive(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace && w.cc2ActorOrder === true;
}

/** Lexy frames per tic. */
export const CC2_FRAMES_PER_TICK = 3;
/** The frame of the main pass inside a tic (frames 0 and 1 are the pre-pass frames). */
const MAIN_PASS_FRAME = 2;
/** The remembered arrival frame is pruned once it is older than this many frames. */
const RFF_ARRIVED_PRUNE_FRAMES = 3;

/** Absolute frame index (tick * 3 + frame) of the moment the code runs: a pre-pass frame, the main pass, or before the pass (frame 2). */
export function rffNow(w: EpoxyWorld): number {
  if (w.cc2RffPre !== undefined) return (w.ccMonsterClock + 1) * CC2_FRAMES_PER_TICK + w.cc2RffPre;
  if (w.cc2RffMain === true && w.ccPassOpen) return w.ccMonsterClock * CC2_FRAMES_PER_TICK + MAIN_PASS_FRAME;
  return (w.ccMonsterClock + 1) * CC2_FRAMES_PER_TICK + MAIN_PASS_FRAME;
}

/** Absolute frame of a step start: the pre-pass frame of the stepping monster, block or player when given, else rffNow. */
export function rffStepStart(w: EpoxyWorld, preFrame: 0 | 1 | undefined): number {
  if (preFrame !== undefined) return (w.ccMonsterClock + 1) * CC2_FRAMES_PER_TICK + preFrame;
  return rffNow(w);
}

/** Marks a deferred draw: the step onto a turning floor started at absolute frame `abs`; its due frame is set once the wait is known. */
export function rffDefer(actor: RffActor, abs: number): void {
  actor.cc2RffStart = abs;
  delete actor.cc2RffDue;
}

/** Whether an actor holds a deferred draw (started or due). */
export function rffHolds(actor: RffActor): boolean {
  return actor.cc2RffDue !== undefined || actor.cc2RffStart !== undefined;
}

/** Turns a step start into the due arrival frame once the step's wait is known (the first visit after the step). */
function rffFinalize(actor: RffActor, ticks: number): void {
  if (actor.cc2RffStart === undefined) return;
  actor.cc2RffDue = actor.cc2RffStart + CC2_FRAMES_PER_TICK * ticks - 1;
  delete actor.cc2RffStart;
}

/**
 * The deferred arrival draw of a monster or block, made when it is due at the running frame (or at once with `force`). Lexy draws in
 * on_stand from step_on_cell, in the cooldown phase of the actor's slot of the arrival frame.
 */
export function drawRffEntity(w: EpoxyWorld, e: RuntimeEntity, force = false): void {
  if (!rffActive(w)) return;
  // The remembered arrival frame only gates the bonk retries of the frames right after it: pruned once older than 3 frames.
  if (e.cc2RffArrived !== undefined && e.cc2RffArrived < rffNow(w) - RFF_ARRIVED_PRUNE_FRAMES) delete e.cc2RffArrived;
  rffFinalize(e, e.cooldownTicks + 1);
  const due = e.cc2RffDue;
  if (due === undefined) return;
  if (!force && due > rffNow(w)) return;
  delete e.cc2RffDue;
  e.cc2RffArrived = due;
  if (!w.entities.includes(e)) return;
  const dir = forceCycleArrival(w, ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]));
  if (dir !== null) e.dir = dir;
}

/**
 * The deferred arrival draw of the player (w.player, a parked one inside withPlayer), made when due at the running frame (or at once
 * with `force`). A player whose suction boots cancel the floor draws nothing (Lexy: a forceproof actor's on_stand returns first).
 */
export function drawRffPlayer(w: EpoxyWorld, force = false): void {
  if (!rffActive(w)) return;
  const p = w.player;
  rffFinalize(p, Math.max(p.moveCooldown, p.isSliding ? p.slideCooldown : 0) + 1);
  const due = p.cc2RffDue;
  if (due === undefined) return;
  if (!force && due > rffNow(w)) return;
  delete p.cc2RffDue;
  if (!p.alive) return;
  const tile = ConfigRegistry.getTile(w.terrain[p.y]?.[p.x]);
  if (tile.protectedByItem && p.boots.has(tile.protectedByItem)) return;
  const dir = forceCycleArrival(w, tile);
  if (dir === null) return;
  if (p.isSliding) {
    p.slideDir = dir;
    p.dir = dir;
  }
}

/**
 * Whether a monster whose turning-floor arrival was drawn arrived before the running frame (it then retries, bonks, in it); undefined
 * when it holds no remembered arrival or a draw is still pending.
 */
export function rffArrivedBefore(w: EpoxyWorld, e: RuntimeEntity): boolean | undefined {
  if (!rffActive(w)) return undefined;
  const arr = e.cc2RffArrived;
  if (arr === undefined || e.cc2RffDue !== undefined || e.cc2RffStart !== undefined) return undefined;
  return arr < rffNow(w);
}

/** A pushed block tagged for its first slide step at `frame` after `ticks` pre-passes arrives the frame before: its draw is due then. */
export function rffDueFromTag(w: EpoxyWorld, block: RuntimeEntity, frame: 0 | 1 | 2, ticks: number): void {
  if (!rffActive(w) || block.cc2RffStart === undefined) return;
  delete block.cc2RffStart;
  block.cc2RffDue = (Math.floor(rffNow(w) / CC2_FRAMES_PER_TICK) + ticks) * CC2_FRAMES_PER_TICK + frame - 1;
}

/**
 * Tic 0, frame 0, at the actor's slot: a monster or block loaded at rest on a turning floor draws in the idle phase (Lexy on_stand from
 * do_actor_idle) and tries the drawn way from frame 1 on. `subject` tells whether the floor acts on this actor at all.
 */
export function drawRffLoadEntity(w: EpoxyWorld, e: RuntimeEntity, subject: boolean): void {
  if (!rffActive(w) || !subject || !w.entities.includes(e) || (e.kind !== 'block' && e.cooldownTicks !== 0)) return;
  const tile = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]);
  if (tile.forceCycle !== true) return;
  const dir = forceCycleArrival(w, tile);
  if (dir === null) return;
  e.dir = dir;
  e.cc2RffArrived = rffNow(w);
  delete e.atLoadCell;
  if (e.kind === 'block') {
    e.isSliding = true;
    e.cooldownTicks = 0;
    e.cc2RffStuck = true;
  }
}

/** Tic 0, frame 0, at the player's slot: a player loaded at rest on a turning floor draws and is carried; suction boots draw nothing. */
export function drawRffLoadPlayer(w: EpoxyWorld): void {
  if (!rffActive(w)) return;
  const p = w.player;
  if (!p.alive || p.moveCooldown !== 0) return;
  const tile = ConfigRegistry.getTile(w.terrain[p.y]?.[p.x]);
  if (tile.forceCycle !== true) return;
  if (tile.protectedByItem && p.boots.has(tile.protectedByItem)) return;
  const dir = forceCycleArrival(w, tile);
  if (dir === null) return;
  p.dir = dir;
  p.slideDir = dir;
  p.isSliding = true;
  p.slideCooldown = 0;
  p.cc2FrameRetry = true;
}

/** RFY: a yellow tank (steered monster) of an actor-order CC2 level is carried by a turning floor as any monster (Lexy: one actor model). */
export function isRffYellowTank(w: EpoxyWorld, e: RuntimeEntity): boolean {
  return rffActive(w) && e.kind === 'monster' && ConfigRegistry.getEntityDef(e.type)?.steeredBy !== undefined;
}
