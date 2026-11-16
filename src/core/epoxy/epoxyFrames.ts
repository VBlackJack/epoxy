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
import { followsCcCadence } from '../coreConstants';
import { canMonsterEnter, stepClassicMonsterOutOfTurn } from './epoxyMonsters';
import { usesCc2Engine } from './ccRules';
import { settleBlockArrival, stepSlidingBlock } from './epoxyBlocks';
import { setHoldDoors, setPoweredCells } from './epoxyDevices';
import { fireSignalSinks, fireSinksBeforePass, settleWorldSignals, SIGNAL_PHASE_TICK } from './epoxySignals';
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
 * A block the player pushed (or a slider pushed) has just moved: its frame. `byPlayer`: the player's decision (frame 2) or, when
 * he slides, his forced move of the action phase. `sliderFrame`: the frame of the sliding block that pushed it (else undefined).
 * `later`: the block comes later than its pusher in the reverse list loop (its own cooldown runs in the same frame).
 * Frame arithmetic (game.js:2218-2242): a decision push onto a plain cell ends 10 frames after frame 2 (frame 0 of t+4); onto
 * ice the first slide step is in frame 1 two ticks later; a slider of frame s pushes: s + 6 - d (ice) or s + 11 - d (plain).
 */
export function tagPushedBlock(w: EpoxyWorld, block: RuntimeEntity, byPlayer: boolean, playerSliding: boolean, later: boolean, sliderFrame: 0 | 1 | 2 | undefined): void {
  if (!frameModelOn(w) || !w.entities.includes(block)) return;
  const d = later ? 1 : 0;
  if (byPlayer) {
    if (block.arrivalTicks !== undefined) {
      // Onto a plain cell: the 12-frame out-of-turn step of frame 2 ends 10 frames later after a decision-phase push, 11 - d
      // after a sliding player's action-phase push.
      const dd = playerSliding ? d : 1;
      holdFrameArrival(w, block, DECISION_FRAME + PLAIN_STEP_FRAMES - 1 - dd);
    } else if (playerSliding) {
      const total = DECISION_FRAME + SLIDE_STEP_FRAMES - d;
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
  for (const frame of PRE_PASS_FRAMES) {
    for (const block of [...w.entities].reverse()) {
      if (block.kind === 'monster' && monsterForcedRetry(w, block)) {
        if (!retryForcedMonster(ctx, block)) return arrivalFrame;
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
      try {
        stepSlidingBlock(ctx, block);
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
      } else {
        // Boxed in or stopped: it tries again in the main pass, at the base timing.
        clearSlideFrame(block);
        delete block.cc2PrePassMoved;
        block.cooldownTicks = 0;
      }
    }
  }
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
  return w.entities.some((e) => e.cc2SlideFrame !== undefined || e.cc2ArrivalWait !== undefined || (e.kind === 'monster' && monsterForcedRetry(w, e)));
}

/**
 * Monster half, minimal: a monster on a force floor whose forced step was refused at the decisions of the last tic retries it in
 * frames 0 and 1 (frames 0 and 1 make forced decisions, game.js:869-888 and 1702-1720; the force floor's slide, 1014-1019 and
 * 1127-1158; force_floor on_arrive, tiletypes.js:3395-3399; the combined action phase, game.js:1074-1088). Not a monster that has
 * just arrived: its first try is at frame 2 (the main pass). Partial scope: Lexy keeps such a monster's later force-floor steps in
 * frame 0; here they go back to the tick timing. The bonk cycling of a forced move (RFF) is not modelled.
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
 * Tries the forced step of a monster in the pre-pass; when it goes, the main pass of the tick skips it. False when the player
 * died. It sets the plan first, so the step takes the plan branch: no direction is chosen and no random number is drawn.
 */
function retryForcedMonster(ctx: EpoxyContext, e: RuntimeEntity): boolean {
  const w = ctx.world;
  const dir = ConfigRegistry.getTile(w.terrain[e.y]?.[e.x]).forceDirection as Direction;
  if (!canMonsterEnter(w, e, dir)) return w.player.alive;
  const x = e.x;
  const y = e.y;
  w.ccPlans.set(e.uid, dir);
  try {
    if (!stepClassicMonsterOutOfTurn(ctx, e)) return false;
  } finally {
    w.ccPlans.delete(e.uid);
  }
  if (w.entities.includes(e) && (e.x !== x || e.y !== y)) e.cc2PrePassMoved = true;
  return w.player.alive;
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
  if (arrived && w.signals !== undefined) {
    const edges = settleWorldSignals(w, false, SIGNAL_PHASE_TICK);
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
  if (!prePassHasWork(w)) return w.player.alive;
  return runPrePassAndWires(ctx);
}

/** A new level, or a restored state: no pre-pass is running or done. */
export function resetFrameWorld(w: EpoxyWorld): void {
  delete w.cc2PrePassDone;
  delete w.cc2PrePassArrived;
  delete w.cc2PrePassStepping;
  delete w.cc2PrePassFrame;
}

/** The end of a tick's entity pass: the next tick's pre-pass is still to come, and nothing the pre-pass moved is still marked. */
export function closeFramePass(w: EpoxyWorld): void {
  delete w.cc2PrePassDone;
  for (const e of w.entities) if (e.cc2PrePassMoved === true) delete e.cc2PrePassMoved;
}

/** The frame of the slider stepping in the pre-pass now, else undefined (the main pass: frame 2). */
export function steppingFrame(w: EpoxyWorld, slider: RuntimeEntity | undefined): 0 | 1 | 2 | undefined {
  if (slider === undefined) return undefined;
  return w.cc2PrePassStepping === true ? w.cc2PrePassFrame : DECISION_FRAME;
}
