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
import { Direction, RuntimeEntity } from '../types';
import { followsCcCadence, OPPOSITE_DIRECTION } from '../coreConstants';
import { canMonsterEnter, slideImmune, stepClassicMonsterOutOfTurn } from './epoxyMonsters';
import { forceCycleArrival } from './epoxyForceCycle';
import { isCarriedByForceFloor, processPlayerSlideStep, resumeForceCarry } from './epoxyPlayer';
import { usesCc2Engine } from './ccRules';
import { settleBlockArrival, stepSlidingBlock } from './epoxyBlocks';
import { setHoldDoors, setPoweredCells } from './epoxyDevices';
import {
  fireSignalSinks,
  fireSinksBeforePass,
  GATE_SETTLE_PRE_PASS0,
  GATE_SETTLE_PRE_PASS1,
  GATE_SETTLE_FRAME0,
  GATE_SETTLE_FRAME1,
  sampleFrameStart,
  settleWorldSignals,
  SIGNAL_PHASE_TICK
} from './epoxySignals';
import { EpoxyContext, EpoxyWorld } from './epoxyWorld';

/**
 * CC2 engine, the block half of the Lexy frame clock (steam-strict: three frames per tic; frames 0 and 1 make forced decisions
 * only, frame 2 every decision; each frame is decision, action, wire, game.js:869-888 and 1050-1063). A block whose slide steps
 * or plain arrival fall in frame 0 or 1 is moved by a pre-pass that runs once per tick before any decision; everything that
 * starts in frame 2 keeps the tick timing of the main pass.
 *
 * Where the pre-pass runs: on a level without actor order (the CC2 levels with parked players) at the end of the previous tick,
 * since Lexy runs frames 0 and 1 right after the cleanup of the tic before (game.js:872-889); on a level with actor order inside
 * the open entity pass, at its start. The second placement is a fit to the existing calibrations, not a Lexy rule: running it at
 * the end of the previous tick for those levels loses Boiler and map045.
 */

/** Lexy frames per tic. */
const FRAMES_PER_TICK = 3;
/** Frames of a step onto a cell that is not a slide (Lexy walk cooldown, game.js:2218-2242). */
const PLAIN_STEP_FRAMES = 12;
/** Frames of a step onto ice or a force floor. */
const SLIDE_STEP_FRAMES = 6;
/** The frame of the decisions: the main pass. */
const DECISION_FRAME = 2;
/** The pre-passes before the next slide step of a slider that just stepped in the pre-pass (two tics later, same frame). */
const SLIDE_STEP_PRE_PASSES = 2;
/** The frames the pre-pass covers, in the order Lexy visits them. */
const PRE_PASS_FRAMES: readonly (0 | 1)[] = [0, 1];
/** Ticks before the first slide step of a block a standing player's decision pushed onto a slide (frame 1). */
const DECISION_PUSH_SLIDE_TICKS = 2;

/** Whether the frame model runs on this world. */
export function frameModelOn(w: EpoxyWorld): boolean {
  return usesCc2Engine(w.level) && !w.cc3dPace;
}

/** Pre-passes still to come before the coming tick's main pass: this tick's one too when it has not run yet. */
function pendingPrePass(w: EpoxyWorld): number {
  return w.cc2PrePassDone === true ? 0 : 1;
}

/** Clears the slide frame of a block. */
function clearSlideFrame(block: RuntimeEntity): void {
  delete block.cc2SlideFrame;
  delete block.cc2SlideDue;
}

/** Clears the held arrival of a block. */
function clearHeldArrival(block: RuntimeEntity): void {
  delete block.cc2ArrivalWait;
  delete block.cc2ArrivalFrame;
}

/**
 * Gives a block that has just started to slide the frame of its slide steps: `frame` (0 or 1) taken `ticks` ticks from now.
 * Frame 2 is the base timing and clears the tag.
 */
export function tagSlideFrame(w: EpoxyWorld, block: RuntimeEntity, frame: 0 | 1 | 2, ticks: number): void {
  if (!frameModelOn(w)) return;
  if (frame === DECISION_FRAME || !block.isSliding || block.arrivalTicks !== undefined || ConfigRegistry.getTile(w.terrain[block.y]?.[block.x]).slideType === undefined) {
    clearSlideFrame(block);
    return;
  }
  block.cc2SlideFrame = frame;
  block.cc2SlideDue = ticks + pendingPrePass(w);
}

/**
 * Holds the plain-step arrival of a block that ends `total` frames after frame 0 of the coming pre-pass's tick. `counted`: the
 * coming pre-pass still to run counts in the wait (false inside a pre-pass, which is that one).
 */
export function holdFrameArrival(w: EpoxyWorld, block: RuntimeEntity, total: number, counted = true): void {
  if (!frameModelOn(w) || block.arrivalTicks === undefined) return;
  // A block on a clone machine never settles: its arrival only counts down (finishClonerOccupantStep), in every frame. Holding it
  // here would settle it in frames 0 and 1 and leave it counting down in frame 2.
  if (ConfigRegistry.getTile(w.terrain[block.y]?.[block.x]).isCloneMachine === true) return;
  block.cc2ArrivalWait = Math.floor(total / FRAMES_PER_TICK) + (counted ? pendingPrePass(w) : 0);
  block.cc2ArrivalFrame = (total % FRAMES_PER_TICK) as 0 | 1 | 2;
}

/**
 * Holds the plain-step arrival of a block whose step started in the main pass (frame 2): a 12-frame step from the decision frame
 * ends 11 frames later, in frame 1 of the fourth tick after, before that tick's decisions (game.js:2218-2242, 869-888).
 */
export function holdMainPassArrival(w: EpoxyWorld, block: RuntimeEntity): void {
  holdFrameArrival(w, block, DECISION_FRAME + PLAIN_STEP_FRAMES - 1);
}

/**
 * A block the player pushed (or a slider pushed) has just moved: its frame. `byPlayer`: the player's decision (frame 2) or, when
 * he slides, his forced move of the action phase. `sliderFrame`: the frame of the sliding block that pushed it (else undefined).
 * `later`: the block comes later than its pusher in the reverse list loop (its own cooldown runs in the same frame).
 * Frame arithmetic (game.js:2218-2242): a decision push onto a plain cell ends 10 frames after frame 2 (frame 0 of t+4); onto
 * ice the first slide step is in frame 1 two ticks later; a slider of frame s pushes: s + 6 - d (ice) or s + 11 - d (plain).
 */
export function tagPushedBlock(w: EpoxyWorld, block: RuntimeEntity, byPlayer: boolean, playerSliding: boolean, later: boolean, sliderFrame: 0 | 1 | 2 | undefined): void {
  if (!frameModelOn(w) || !w.entities.includes(block)) return;
  const d = later ? 1 : 0;
  // A push made by the player's forced step in the pre-pass happens in that step's frame, not in frame 2.
  const inPrePass = w.cc2PrePassPlayer === true && w.cc2PrePassFrame !== undefined;
  const pushFrame = inPrePass ? (w.cc2PrePassFrame as 0 | 1) : DECISION_FRAME;
  if (byPlayer) {
    if (block.arrivalTicks !== undefined) {
      // Onto a plain cell: the 12-frame out-of-turn step of frame 2 ends 10 frames later after a decision-phase push, 11 - d
      // after a sliding player's action-phase push.
      const dd = playerSliding ? d : 1;
      holdFrameArrival(w, block, pushFrame + PLAIN_STEP_FRAMES - 1 - dd, !inPrePass);
    } else if (playerSliding) {
      const total = pushFrame + SLIDE_STEP_FRAMES - d;
      tagSlideFrame(w, block, (total % FRAMES_PER_TICK) as 0 | 1 | 2, Math.floor(total / FRAMES_PER_TICK));
    } else tagSlideFrame(w, block, 1, DECISION_PUSH_SLIDE_TICKS);
    return;
  }
  if (sliderFrame === undefined) return;
  if (block.arrivalTicks === undefined && block.isSliding) {
    const total = sliderFrame + SLIDE_STEP_FRAMES - d;
    tagSlideFrame(w, block, (total % FRAMES_PER_TICK) as 0 | 1 | 2, Math.floor(total / FRAMES_PER_TICK));
  } else if (block.arrivalTicks !== undefined && w.cc2PrePassStepping === true) {
    holdFrameArrival(w, block, sliderFrame + PLAIN_STEP_FRAMES - 1 - d, false);
  }
}

/** Settles the held arrival of a block whose plain step ends in frame `frame` before the decisions. */
function settleFrameArrival(ctx: EpoxyContext, block: RuntimeEntity, frame: 0 | 1): void {
  const w = ctx.world;
  clearHeldArrival(block);
  delete block.arrivalTicks;
  // The press frame reaches a clone it releases; this is not a press before a pass that counts the clone down at once.
  w.cc2ReleaseFrame = frame;
  try {
    settleBlockArrival(ctx, block, block.dir, true);
  } finally {
    delete w.cc2ReleaseFrame;
  }
  if (w.entities.includes(block)) block.cc2PrePassMoved = true;
  w.cc2PrePassArrived = true;
}

/** Whether a held arrival's wait has run out (a wait below zero, which no path should make, still settles). */
function arrivalDue(wait: number): boolean {
  return wait <= 0;
}

/**
 * The slide steps Lexy takes in frames 0 and 1 of the tick, before the decisions of frame 2, and the arrivals of plain steps that
 * end in frame 0 or 1: frame 0 first, then frame 1; in each, the actors in reverse list order. Returns the frame of the first
 * arrival it settled (the earliest, since frame 0 runs first), undefined when none settled.
 */
function runPrePass(ctx: EpoxyContext): 0 | 1 | undefined {
  const w = ctx.world;
  let arrivalFrame: 0 | 1 | undefined;
  const pendingArrivals = w.entities.filter((e) => e.kind === 'block' && e.cc2ArrivalWait !== undefined);
  for (const block of pendingArrivals) block.cc2ArrivalWait = (block.cc2ArrivalWait ?? 0) - 1;
  // The sources before frame 0 moves anything: the frame-0 wire phase lets in what that frame changed.
  const frameStart = w.cc2WireFrameNext === 0 ? sampleFrameStart(w) : undefined;
  let afterFrame0: ReadonlyMap<number, boolean> | undefined;
  for (const frame of PRE_PASS_FRAMES) {
    // The player is an actor of the list (Lexy reading order): in the reverse loop he moves just before the first actor listed
    // ahead of him, after the loop when none is.
    let playerStepped = false;
    const playerOrdinal = w.player.listOrdinal;
    for (const block of [...w.entities].reverse()) {
      if (w.levelCompleted) return arrivalFrame;
      if (!playerStepped && playerOrdinal !== undefined && block.listOrdinal !== undefined && block.listOrdinal < playerOrdinal) {
        playerStepped = true;
        if (!playerFrameStep(ctx, frame)) return arrivalFrame;
        if (w.levelCompleted) return arrivalFrame;
      }
      if (block.kind === 'monster' && monsterFrameStep(w, block, frame)) {
        if (!stepMonsterInFrame(ctx, block, frame)) return arrivalFrame;
        // A slide step on ice refused in frame 0 is decided again in frame 1 (Lexy forces a decision in every frame, game.js:869-888).
        if (frame === 0 && monsterSlideHere(w, block) === 'ice' && block.cc2PrePassMoved !== true && block.cc2SlideFrame === 0 && w.entities.includes(block)) block.cc2SlideFrame = 1;
        continue;
      }
      if (block.kind === 'monster' && monsterRffRetry(w, block)) {
        if (!retryRffMonster(ctx, block, frame)) return arrivalFrame;
        continue;
      }
      if (block.kind === 'monster' && monsterIceRetry(w, block)) {
        if (!stepMonsterInFrame(ctx, block, frame)) return arrivalFrame;
        continue;
      }
      if (block.kind === 'monster' && monsterForcedRetry(w, block)) {
        if (!retryForcedMonster(ctx, block, frame)) return arrivalFrame;
        continue;
      }
      if (block.kind !== 'block' || w.removedUids.has(block.uid) || !w.entities.includes(block)) continue;
      if (block.cc2ArrivalWait !== undefined && arrivalDue(block.cc2ArrivalWait) && block.cc2ArrivalFrame === frame) {
        settleFrameArrival(ctx, block, frame);
        arrivalFrame ??= frame;
        if (!w.player.alive) return arrivalFrame;
        continue;
      }
      if (block.cc2SlideFrame !== frame) continue;
      if (!block.isSliding || block.arrivalTicks !== undefined) {
        clearSlideFrame(block);
        continue;
      }
      if ((block.cc2SlideDue ?? 1) > 1) {
        block.cc2SlideDue = (block.cc2SlideDue ?? 1) - 1;
        continue;
      }
      const x = block.x;
      const y = block.y;
      block.cooldownTicks = 0;
      w.cc2PrePassStepping = true;
      w.cc2PrePassFrame = frame;
      let res: ReturnType<typeof stepSlidingBlock> | undefined;
      try {
        res = stepSlidingBlock(ctx, block);
      } finally {
        delete w.cc2PrePassStepping;
        delete w.cc2PrePassFrame;
      }
      if (!w.player.alive) return arrivalFrame;
      if (!w.entities.includes(block)) continue;
      // The main pass of this tick does not move it again.
      block.cc2PrePassMoved = true;
      if (block.arrivalTicks !== undefined) {
        // Off the slide onto a plain cell: a 12-frame step from this frame, ending 11 frames later (f + 11).
        clearSlideFrame(block);
        holdFrameArrival(w, block, frame + PLAIN_STEP_FRAMES - 1, false);
      } else if (block.isSliding && (block.x !== x || block.y !== y)) {
        block.cc2SlideFrame = frame;
        block.cc2SlideDue = SLIDE_STEP_PRE_PASSES;
      } else if (frame === 0 && frameModelOn(w) && res?.refusedOnForce === true && res.retryDir !== undefined && block.x === x && block.y === y && fixedForceFloor(w, block)) {
        // Refused on a fixed force floor in frame 0 by an actor: it tries again in frame 1 (refused there, the main pass takes it).
        block.isSliding = true;
        block.dir = res.retryDir;
        block.cc2SlideFrame = 1;
        block.cc2SlideDue = 1;
        delete block.cc2PrePassMoved;
        block.cooldownTicks = 0;
      } else {
        // Boxed in or stopped: it tries again in the main pass, at the base timing.
        clearSlideFrame(block);
        delete block.cc2PrePassMoved;
        block.cooldownTicks = 0;
      }
    }
    if (!playerStepped && !playerFrameStep(ctx, frame)) return arrivalFrame;
    if (w.levelCompleted) return arrivalFrame;
    // The frame-1 phase reads the sources as frame 0 left them for the toggle switches that frame flipped.
    if (frame === 0 && w.cc2WireFrameNext === 0) afterFrame0 = sampleFrameStart(w);
    if (!runFrameWirePhase(ctx, frame, frame === 0 ? frameStart : afterFrame0)) return arrivalFrame;
    if (w.levelCompleted) return arrivalFrame;
  }
  // The retry of a refused ice slide lasts the frames of this pre-pass only: the stamp is deleted with it.
  dropIceRefusals(w);
  // The retry of a refused forced step lasts the frames of this pre-pass only.
  delete w.player.cc2FrameRetry;
  // A plain step that ends in frame 2 ends in the main pass: its turn settles it.
  for (const block of pendingArrivals) {
    if (block.cc2ArrivalWait !== undefined && arrivalDue(block.cc2ArrivalWait) && block.cc2ArrivalFrame === DECISION_FRAME && w.entities.includes(block)) {
      clearHeldArrival(block);
      block.arrivalTicks = 1;
    }
  }
  return arrivalFrame;
}

/** Whether the world holds anything the pre-pass acts on. */
function prePassHasWork(w: EpoxyWorld): boolean {
  if (frameModelOn(w) && (w.player.cc2FrameRetry === true || w.player.cc2SlideFrame !== undefined)) return true;
  return w.entities.some((e) => e.cc2SlideFrame !== undefined || e.cc2ArrivalWait !== undefined || (e.kind === 'monster' && (monsterForcedRetry(w, e) || monsterRffRetry(w, e) || monsterIceRetry(w, e))));
}

/**
 * A monster at rest on ice whose slide the last main pass (frame 2) refused retries in frames 0 and 1 of the next tic: Lexy decides
 * the forced slide again in every frame (game.js:869-888) and bonks each time (1164-1210), so a ball jammed behind another leaves in
 * the frame after the one ahead of it has gone. Only a monster the pass stamped (cc2IceRefused is the pass clock of its refusal), so
 * one that has just arrived or never tried is not retried; a monster the ice does not carry (monsterSlideHere: cleats, ghosts) is
 * not either. Lane w24_ice_pair_w; the lane w24_ice_btn_retry pins the press of such a step (see resolveMonsterArrival: a frame-0
 * step ends in frame 2 of the tic before, after its decisions).
 */
function monsterIceRetry(w: EpoxyWorld, e: RuntimeEntity): boolean {
  if (e.cc2SlideFrame !== undefined) return false;
  if (!frameModelOn(w) || e.cooldownTicks !== 0 || w.removedUids.has(e.uid) || !w.entities.includes(e)) return false;
  if (e.cc2PrePassMoved === true) return false;
  if (!followsCcCadence(e.type, true) || e.atLoadCell === true || e.teleportExit !== undefined) return false;
  if (monsterSlideHere(w, e) !== 'ice') return false;
  return e.cc2IceRefused === w.ccMonsterClock;
}

/** The refusal stamps live until the pre-pass that reads them, which deletes them at its end. */
function dropIceRefusals(w: EpoxyWorld): void {
  for (const e of w.entities) delete e.cc2IceRefused;
}

/**
 * Monster half, minimal: a monster on a force floor whose forced step was refused at the decisions of the last tic retries it in
 * frames 0 and 1 (frames 0 and 1 make forced decisions, game.js:869-888 and 1702-1720; the force floor's slide, 1014-1019 and
 * 1127-1158; force_floor on_arrive, tiletypes.js:3395-3399; the combined action phase, game.js:1074-1088). Not a monster that has
 * just arrived: its first try is at frame 2 (the main pass). A step it takes there tags its slide frame (tagMonsterSlide), so its
 * later force-floor steps stay in that frame, as Lexy keeps them.
 */
export function monsterForcedRetry(w: EpoxyWorld, e: RuntimeEntity): boolean {
  if (!frameModelOn(w) || e.cooldownTicks !== 0 || w.removedUids.has(e.uid) || !w.entities.includes(e)) return false;
  if (e.cc2PrePassMoved === true) return false;
  if (!followsCcCadence(e.type, true) || e.atLoadCell === true || e.teleportExit !== undefined) return false;
  const def = ConfigRegistry.getEntityDef(e.type);
  if (def?.ignoresFloorEffects === true || def?.ignoresSlidingFloors === true || def?.steeredBy !== undefined) return false;
  const tile = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]);
  if (tile.slideType !== 'force' || tile.forceCycle === true || tile.forceDirection === undefined || tile.forceDirection === 'RANDOM' || tile.isCloneMachine === true) return false;
  // A step that ended in the last pass: it arrived in the frames just before, so its first forced try is the main pass.
  const coming = w.ccMonsterClock + 1;
  if (e.stepEndedPass !== undefined && e.stepEndedPass >= coming - 1) return false;
  if ((e.heldTools ?? []).length > 0) return false;
  return true;
}

/**
 * A monster at rest on a turning force floor whose forced step was refused at the last decisions retries in frames 0 and 1, as one
 * on a fixed force floor does (monsterForcedRetry); the retry bonks, so the floor turns it and it tries the new way (Lexy
 * _possibly_bonk, game.js:1127-1162; MAP120 t424, ftrace).
 */
function monsterRffRetry(w: EpoxyWorld, e: RuntimeEntity): boolean {
  if (!frameModelOn(w) || e.cooldownTicks !== 0 || w.removedUids.has(e.uid) || !w.entities.includes(e)) return false;
  if (e.cc2PrePassMoved === true) return false;
  if (!followsCcCadence(e.type, true) || e.atLoadCell === true || e.teleportExit !== undefined) return false;
  const def = ConfigRegistry.getEntityDef(e.type);
  if (def?.ignoresFloorEffects === true || def?.ignoresSlidingFloors === true || def?.steeredBy !== undefined) return false;
  const tile = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]);
  if (tile.forceCycle !== true || tile.isCloneMachine === true || slideImmune(w, e, tile)) return false;
  const coming = w.ccMonsterClock + 1;
  if (e.stepEndedPass !== undefined && e.stepEndedPass >= coming - 1) return false;
  if ((e.heldTools ?? []).length > 0) return false;
  return true;
}

/** One frame's try of a monster on a turning floor: its way, else the floor turns it and it tries the new way. False when the player died. */
function retryRffMonster(ctx: EpoxyContext, e: RuntimeEntity, frame: 0 | 1): boolean {
  const w = ctx.world;
  let dir = e.dir;
  if (!canMonsterEnter(w, e, dir)) {
    const redraw = forceCycleArrival(w, ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]));
    if (redraw === null) return w.player.alive;
    e.dir = redraw;
    dir = redraw;
    if (!canMonsterEnter(w, e, dir)) return w.player.alive;
  }
  return stepMonsterAlong(ctx, e, dir, frame);
}

/** The slide floor that carries a monster here (ice, or a force floor, a turning one included: it goes the way the floor gave it), else undefined. */
function monsterSlideHere(w: EpoxyWorld, e: RuntimeEntity): 'ice' | 'force' | undefined {
  const def = ConfigRegistry.getEntityDef(e.type);
  if (def?.ignoresFloorEffects === true || def?.ignoresSlidingFloors === true || def?.steeredBy !== undefined) return undefined;
  const tile = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]);
  if (tile.isCloneMachine === true || slideImmune(w, e, tile)) return undefined;
  if (tile.slideType === 'ice') return 'ice';
  if (tile.slideType !== 'force') return undefined;
  if (tile.forceCycle === true) return 'force';
  return tile.forceDirection !== undefined && tile.forceDirection !== 'RANDOM' ? 'force' : undefined;
}

/** A monster that has just slid in pre-pass frame `frame` keeps that frame for its next slide step while a slide carries it. */
function tagMonsterSlide(w: EpoxyWorld, e: RuntimeEntity, frame: 0 | 1): void {
  if (monsterSlideHere(w, e) !== undefined && e.cooldownTicks > 0) e.cc2SlideFrame = frame;
  else delete e.cc2SlideFrame;
}

/**
 * Whether a monster tagged with a slide frame steps in this frame of the pre-pass (Lexy game.js:869-888: a slide step keeps its
 * frame; MAP120 t849-t857, a paramecium forced in frame 0 keeps frame 0). The tag of a monster no slide carries any more is dropped.
 */
function monsterFrameStep(w: EpoxyWorld, e: RuntimeEntity, frame: 0 | 1): boolean {
  if (e.cc2SlideFrame === undefined) return false;
  if (!frameModelOn(w) || e.cooldownTicks !== 0 || w.removedUids.has(e.uid) || !w.entities.includes(e)) return false;
  if (e.cc2PrePassMoved === true) return false;
  if (!followsCcCadence(e.type, true) || e.atLoadCell === true || e.teleportExit !== undefined) return false;
  if ((e.heldTools ?? []).length > 0) return false;
  if (monsterSlideHere(w, e) === undefined) {
    delete e.cc2SlideFrame;
    return false;
  }
  return e.cc2SlideFrame === frame;
}

/** The slide step of a tagged monster in a frame of the pre-pass. False when the player died. */
function stepMonsterInFrame(ctx: EpoxyContext, e: RuntimeEntity, frame: 0 | 1): boolean {
  const w = ctx.world;
  const tile = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]);
  // A turning floor: refused in its tagged frame, the monster bonks there and the floor turns it (Lexy game.js:1127-1162,
  // _possibly_bonk), as in the retry of an untagged one.
  if (tile.forceCycle === true) return retryRffMonster(ctx, e, frame);
  const plan = (tile.slideType === 'ice' ? tile.deflectionMap?.[e.dir] || e.dir : tile.forceDirection) as Direction;
  if (tile.slideType === 'ice') {
    const bounce = (tile.deflectionMap?.[OPPOSITE_DIRECTION[plan]] || OPPOSITE_DIRECTION[plan]) as Direction;
    if (!canMonsterEnter(w, e, plan) && !canMonsterEnter(w, e, bounce)) {
      // The refused retry bonks: the monster faces the bounce way (Lexy game.js:1192-1207).
      e.dir = bounce;
      return w.player.alive;
    }
  } else if (!canMonsterEnter(w, e, plan)) return w.player.alive;
  return stepMonsterAlong(ctx, e, plan, frame);
}

/**
 * One out-of-turn step of a monster along `dir` in pre-pass frame `frame`: the plan is set first, so the step takes the plan branch
 * (no direction is chosen, no random number is drawn). When it moved, the main pass skips the monster and its slide frame is tagged.
 * False when the player died.
 */
function stepMonsterAlong(ctx: EpoxyContext, e: RuntimeEntity, dir: Direction, frame: 0 | 1): boolean {
  const w = ctx.world;
  const x = e.x;
  const y = e.y;
  w.ccPlans.set(e.uid, dir);
  // Only the pre-pass inside an open entity pass of a tick times the press by the frame: the tick-start pre-pass of a parked level and the
  // parked end-of-tick one keep their press timing.
  if (w.ccPassOpen && w.inTick) w.cc2PrePassMonsterFrame = frame;
  try {
    if (!stepClassicMonsterOutOfTurn(ctx, e)) return false;
  } finally {
    w.ccPlans.delete(e.uid);
    delete w.cc2PrePassMonsterFrame;
  }
  if (w.entities.includes(e) && (e.x !== x || e.y !== y)) {
    e.cc2PrePassMoved = true;
    tagMonsterSlide(w, e, frame);
  }
  return w.player.alive;
}

/**
 * Tries the forced step of a monster in the pre-pass; when it goes, the main pass of the tick skips it. False when the player
 * died. It sets the plan first, so the step takes the plan branch: no direction is chosen and no random number is drawn.
 */
function retryForcedMonster(ctx: EpoxyContext, e: RuntimeEntity, frame: 0 | 1): boolean {
  const w = ctx.world;
  const dir = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]).forceDirection as Direction;
  if (!canMonsterEnter(w, e, dir)) return w.player.alive;
  return stepMonsterAlong(ctx, e, dir, frame);
}

/**
 * The player half of the pre-pass: a player whose forced step on a force floor was refused at frame 2 tries it again in frames 0
 * and 1 of the next tic (forced decisions, game.js:869-888), before his input; once a forced step goes in frame f, his next forced
 * steps on the force floor stay in frame f, before the input of their tic, which they therefore refuse (map054 t617-t632 ftrace).
 * Only the controlled player in his own slot (a parked player never takes a mark). False when he died.
 */
function playerFrameStep(ctx: EpoxyContext, frame: 0 | 1): boolean {
  const w = ctx.world;
  const p = w.player;
  if (!frameModelOn(w) || !p.alive || w.levelCompleted || w.swappedIn !== null || p.cc2PrePassMoved === true) return p.alive;
  const tile = ConfigRegistry.getTile(w.terrain[p.y]?.[p.x]);
  if (tile.slideType !== 'force' || !isCarriedByForceFloor(w, tile)) {
    delete p.cc2SlideFrame;
    delete p.cc2FrameRetry;
    return true;
  }
  const retry = p.cc2FrameRetry === true;
  const due = retry || (p.cc2SlideFrame === frame && p.isSliding && p.slideCooldown === 0);
  if (!due || p.moveCooldown > 0) return true;
  if (!p.isSliding) {
    if (tile.forceCycle === true) {
      p.isSliding = true;
      p.slideDir = p.dir;
      p.slideCooldown = 0;
    } else resumeForceCarry(w);
  }
  if (!p.isSliding) return true;
  const x = p.x;
  const y = p.y;
  w.cc2PrePassPlayer = true;
  w.cc2PrePassFrame = frame;
  try {
    processPlayerSlideStep(ctx);
  } finally {
    delete w.cc2PrePassPlayer;
    delete w.cc2PrePassFrame;
  }
  if (!p.alive) return false;
  // A step that handed control on (an exit) leaves the marks to the swap.
  if (p !== w.player) return true;
  if (p.x !== x || p.y !== y) {
    delete p.cc2FrameRetry;
    p.cc2PrePassMoved = true;
    const here = ConfigRegistry.getTile(w.terrain[p.y]?.[p.x]);
    if (p.isSliding && here.slideType === 'force' && isCarriedByForceFloor(w, here)) p.cc2SlideFrame = frame;
    else delete p.cc2SlideFrame;
  } else if (!retry) {
    // Its frame step refused: it becomes a retry in the frames left, then the main pass.
    p.cc2FrameRetry = true;
    delete p.cc2SlideFrame;
  }
  return true;
}

/** Runs the pre-pass and, when a block arrived in it, the wire phase that arrival reaches. False when the player died. */
function runPrePassAndWires(ctx: EpoxyContext): boolean {
  const w = ctx.world;
  let arrived = false;
  let arrivalFrame: 0 | 1 | undefined;
  try {
    arrivalFrame = runPrePass(ctx);
    arrived = w.cc2PrePassArrived === true;
  } finally {
    delete w.cc2PrePassArrived;
  }
  if (!w.player.alive) return false;
  // An arrival no frame wire phase read (none was due: the first tick, or a network outside the frame model) reaches the wires here.
  if (arrived && w.signals !== undefined) {
    // A frame-0 arrival reaches two wire phases before the decisions (f0, f1), a frame-1 arrival one: the gates step that often.
    const edges = settleWorldSignals(w, false, SIGNAL_PHASE_TICK, arrivalFrame === 0 ? GATE_SETTLE_PRE_PASS0 : GATE_SETTLE_PRE_PASS1);
    setPoweredCells(ctx);
    setHoldDoors(ctx);
    fireSignalSinks(ctx, edges, SIGNAL_PHASE_TICK);
    // The clone machines and launchers that rose fire in that wire phase too, not at the next tick. The press is the arrival of this
    // pre-pass, in its frame: the settled block carries no frame of its own (a clone does), so the frame is given here, else a frame-0
    // arrival would release its clone as a press of frame 1 (game.js:869-888). fireSinksBeforePass sets cc2BeforePass, so the clone is
    // counted down by the pass at once: the pre-pass does set that flag, through this call.
    fireSinksBeforePass(ctx, arrivalFrame);
  }
  return w.player.alive;
}

/**
 * The frame-0 and frame-1 moves of the tick, then the wire phase they reach (an arrival of frame 0 or 1 reaches the wires in its
 * frame's wire phase, game.js:869-888), once per tick before any decision. False when the player died.
 * `betweenTicks`: called from the end of the previous tick, outside any tick; with nothing to run it keeps no state. Inside a tick
 * (tick start, pass start) the done mark is always set, so a tag the pass makes counts from the next tick.
 */
export function runFramePrePass(ctx: EpoxyContext, betweenTicks = false): boolean {
  const w = ctx.world;
  if (!frameModelOn(w) || w.cc2PrePassDone === true) return w.player.alive;
  if (betweenTicks && !prePassHasWork(w)) return w.player.alive;
  w.cc2PrePassDone = true;
  if (!betweenTicks && w.ccMonsterClock === 0) tagLoadedForceBlocks(w);
  if (!prePassHasWork(w)) return w.player.alive;
  return runPrePassAndWires(ctx);
}

/**
 * The Lexy wire phase of pre-pass frame `frame` (game.js:872-889), when it is the one due (cc2WireFrameNext): the frame-0 phase lets
 * in what that frame changed against `frameStart`, the frame-1 phase every source. What rises fires as at the tick end; on actor order
 * the directly wired clone machines and launchers fire too, before the decisions, as frame releases. An arrival of the pre-pass is
 * read here (its own settle is not needed). False when the player died.
 */
function runFrameWirePhase(ctx: EpoxyContext, frame: 0 | 1, frameStart: ReadonlyMap<number, boolean> | undefined): boolean {
  const w = ctx.world;
  if (w.signals === undefined || w.cc2WireFrameNext !== frame) return w.player.alive;
  if (frame === 0) w.cc2WireFrameNext = 1;
  else delete w.cc2WireFrameNext;
  const arrived = w.cc2PrePassArrived === true;
  delete w.cc2PrePassArrived;
  const edges = settleWorldSignals(w, false, SIGNAL_PHASE_TICK, frame === 0 ? GATE_SETTLE_FRAME0 : GATE_SETTLE_FRAME1, undefined, frameStart);
  setPoweredCells(ctx);
  setHoldDoors(ctx);
  // A frame phase comes before the frame-2 pass of its tic: what it releases reads the pass as a before-pass release does (the pass
  // view closed: the monster clock of the pass to come, no turn of this pass spent).
  const passOpen = w.ccPassOpen;
  w.ccPassOpen = false;
  try {
    fireSignalSinks(ctx, edges, SIGNAL_PHASE_TICK, undefined, frame);
    if (!w.player.alive || w.levelCompleted) return w.player.alive;
    if (arrived || w.cc2ActorOrder === true) fireSinksBeforePass(ctx, arrived ? frame : undefined, true);
  } finally {
    w.ccPassOpen = passOpen;
  }
  return w.player.alive;
}

/**
 * The frame wire phases still due when the pre-pass did not run them (it had nothing to move, or it was cut short). Nothing moved in
 * frame 0, so the pure sample taken now is the frame-start one: the frame-0 phase lets in a frame-0 arrival and a pulse source's press
 * (the pure sample reads a pulse at its last level, so the pending press counts as a change).
 */
export function finishFrameWirePhases(ctx: EpoxyContext): void {
  const w = ctx.world;
  if (w.cc2WireFrameNext === undefined) return;
  if (!w.player.alive || w.levelCompleted || w.signals === undefined) {
    delete w.cc2WireFrameNext;
    return;
  }
  if (w.cc2WireFrameNext === 0 && !runFrameWirePhase(ctx, 0, sampleFrameStart(w))) return;
  if (w.cc2WireFrameNext === 1) runFrameWirePhase(ctx, 1, undefined);
}

/** A new level, or a restored state: no pre-pass is running or done. */
export function resetFrameWorld(w: EpoxyWorld): void {
  delete w.cc2WireFrameNext;
  delete w.cc2PrePassDone;
  delete w.cc2PrePassArrived;
  delete w.cc2PrePassStepping;
  delete w.cc2PrePassFrame;
  delete w.cc2PrePassMonsterFrame;
  delete w.cc2PrePassPlayer;
}

/** The end of a tick's entity pass: the next tick's pre-pass is still to come, and nothing the pre-pass moved is still marked. */
export function closeFramePass(w: EpoxyWorld): void {
  delete w.cc2PrePassDone;
  for (const e of w.entities) if (e.cc2PrePassMoved === true) delete e.cc2PrePassMoved;
  for (const pl of [w.player, ...w.parked]) delete pl.cc2PrePassMoved;
}

/** The frame of the slider stepping in the pre-pass now, else undefined (the main pass: frame 2). */
export function steppingFrame(w: EpoxyWorld, slider: RuntimeEntity | undefined): 0 | 1 | 2 | undefined {
  if (slider === undefined) return undefined;
  return w.cc2PrePassStepping === true ? w.cc2PrePassFrame : DECISION_FRAME;
}

/** Whether the block stands on a fixed force floor (not a turning or random one, which keep the after-pass retry). */
export function fixedForceFloor(w: EpoxyWorld, block: RuntimeEntity): boolean {
  const tile = ConfigRegistry.getTile(w.terrain[block.y]?.[block.x]);
  return tile.slideType === 'force' && tile.forceCycle !== true && tile.forceDirection !== undefined && tile.forceDirection !== 'RANDOM';
}

/**
 * A block loaded on a fixed force floor first slides in frame 1 of tic 0 (Lexy lanes w24_ff_pair_w, w26_ff_fireball, w26_ff_off: t0f1),
 * so the tic-0 pre-pass tags it for frame 1; it keeps that frame. Run once, at the first pre-pass of the level.
 */
function tagLoadedForceBlocks(w: EpoxyWorld): void {
  if (!frameModelOn(w)) return;
  for (const e of w.entities) {
    // A block marked as landed by a move (cc2SlideArrived) is not a block at its load state.
    if (e.kind !== 'block' || e.cc2SlideArrived === true || e.arrivalTicks !== undefined || e.cc2SlideFrame !== undefined || e.cc2ArrivalWait !== undefined) continue;
    const tile = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]);
    if (!fixedForceFloor(w, e) || tile.isCloneMachine === true) continue;
    if (ConfigRegistry.getEntityDef(e.type)?.slidesOnForce !== true) continue;
    e.isSliding = true;
    e.dir = tile.forceDirection as Direction;
    e.cooldownTicks = 0;
    e.cc2SlideFrame = 1;
    e.cc2SlideDue = 1;
  }
}
