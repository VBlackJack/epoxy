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

import { GameEngine } from '../core/GameEngine';
import { Pathfinder } from '../core/Pathfinder';
import { PlayEngine } from '../core/PlayEngine';
import { Direction, GridPoint } from '../core/types';
import { WalkAside, WalkJudge, WalkPlan } from './cclpAutoWalk';
import { maxWalkWaitTicks } from './walkForecast';

/**
 * The tap-to-path walk on the Epoxy engine, one tick at a time (the CCLP one is in cclpAutoWalk). The step check and the
 * monster watch run when Chip is free, before the press; the helper changes neither the plan nor the engine beyond the one
 * press: the caller owns the queue.
 */

/**
 * idle: nothing was done, keep the plan (Chip is mid-step); stop: drop the plan; wait: a monster makes the step deadly but
 * standing still is safe, keep the plan and ask again next tick; danger: neither is safe, drop the plan; sent: the press was
 * taken (`stored`: the engine plays it in its next turn, so the queue follows what that turn did); aside: neither is safe, a
 * press off the plan towards `target` was taken instead (`stored` as for sent).
 */
export type EpoxyWalkStart =
  | { kind: 'idle' }
  | { kind: 'stop' }
  | { kind: 'wait' }
  | { kind: 'danger' }
  | { kind: 'sent'; stored: boolean }
  | { kind: 'aside'; dir: Direction; target: GridPoint; stored: boolean };

/** Before the tick: sends the next step when the world allows it and the monster watch does not hold it back. */
export function startEpoxyWalkStep(plan: WalkPlan, engine: PlayEngine, epoxy: GameEngine | null, judge?: WalkJudge, aside?: WalkAside): EpoxyWalkStart {
  if (plan.moves.length === 0) return { kind: 'idle' };
  // A paused game does not walk, and a walk planned before the pause is not resumed after it.
  if (engine.isPaused()) return { kind: 'stop' };
  const dir = plan.moves[0];
  // A CC2 step that just ended has its effects pending until the next tick: the safety check must see them.
  epoxy?.flushPendingStepEnd();
  const walker = engine.getPlayer();
  const free = !walker.isSliding && walker.moveCooldown === 0;
  // The world moved since the path was planned (a plate crossed can open a door that shielded a beam): stop rather than step in.
  if (epoxy && free && !Pathfinder.isNextStepSafe(epoxy, dir, plan.moves.length === 1)) return { kind: 'stop' };
  // The monster watch: a step a monster would make deadly waits, or stops the walk when standing still is deadly too.
  const verdict = epoxy && free ? (judge?.(plan) ?? 'go') : 'go';
  if (verdict === 'wait') return { kind: 'wait' };
  if (verdict === 'stop') {
    const step = aside?.(plan) ?? null;
    if (step === null || !engine.attemptPlayerMove(step.dir)) return { kind: 'danger' };
    return { kind: 'aside', dir: step.dir, target: step.point, stored: epoxy?.playsInActorOrder() === true };
  }
  if (engine.attemptPlayerMove(dir)) return { kind: 'sent', stored: epoxy?.playsInActorOrder() === true };
  const after = engine.getPlayer();
  return !after.isSliding && after.moveCooldown === 0 ? { kind: 'stop' } : { kind: 'idle' };
}

/** Counts the ticks a walk has stood waiting for a monster, and ends the wait at the limit of game.json timing. */
export class WalkWait {
  private waited = 0;

  /** `limitTicks`: for a test; by default the limit is read from game.json when the wait is used, since the page builds this before the config is loaded. */
  constructor(private readonly limitTicks?: number) {}

  /** The ticks waited so far. */
  public get ticks(): number {
    return this.waited;
  }

  /** The walk moved on, ended or was dropped: the next wait counts from zero. */
  public clear(): void {
    this.waited = 0;
  }

  /**
   * One more tick of waiting. first: the wait just began (the player is told); give up: the limit is reached, the walk ends
   * (the counter restarts).
   */
  public hold(): { giveUp: boolean; first: boolean } {
    if (this.waited >= (this.limitTicks ?? maxWalkWaitTicks())) {
      this.waited = 0;
      return { giveUp: true, first: false };
    }
    const first = this.waited === 0;
    this.waited++;
    return { giveUp: false, first };
  }
}
