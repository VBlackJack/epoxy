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

import { DIRECTION_VECTORS } from '../config/constants';
import { CclpEngine } from '../core/cclp/CclpEngine';
import { cclpPathView } from '../core/cclp/cclpPathView';
import { GameEngine } from '../core/GameEngine';
import { PathEngine, Pathfinder } from '../core/Pathfinder';
import { PlayEngine } from '../core/PlayEngine';
import { Direction, GridPoint, PlayerState } from '../core/types';
import type { StepVerdict } from './walkForecast';
import type { AsideStep } from './walkStepAside';

/**
 * The tap-to-path walk on the CCLP engine, one tick at a time. Lynx keeps a press made during a step for Chip's next
 * decision, which would skip the safety check and leave a stray step behind after a cancel, and it takes a press it cannot
 * play. So a press is sent only when Chip can take it, and the walk follows what Chip did, not what the press promised.
 * The helper changes neither the plan nor the engine beyond the one press: the caller owns the queue.
 */

/** What the walk reads from the engine and the one thing it does to it. */
export interface WalkEngine {
  isPaused(): boolean;
  getPlayer(): PlayerState;
  /** True when Chip would take a direction at his next decision. */
  canChipTakeInput(): boolean;
  attemptPlayerMove(dir: Direction): boolean;
}

/** The planned walk: the steps left and the cell each one reaches. */
export interface WalkPlan {
  readonly moves: readonly Direction[];
  readonly points: readonly GridPoint[];
}

/**
 * idle: nothing to do this tick, keep the plan; stop: drop the plan; sent: a press was made towards `target`; wait: a monster
 * makes the step deadly but standing still is safe, keep the plan and ask again next tick; danger: neither is safe, drop the plan;
 * aside: neither is safe, a press was made off the plan towards `target`, a neighbouring cell the forecast keeps Chip alive on.
 */
export type WalkStart =
  | { kind: 'idle' }
  | { kind: 'stop' }
  | { kind: 'sent'; target: GridPoint }
  | { kind: 'wait' }
  | { kind: 'danger' }
  | { kind: 'aside'; dir: Direction; target: GridPoint };

/** The step aside: a neighbouring cell where one step then standing still keeps Chip alive, or null (see WalkForecaster.stepAside). */
export type WalkAside = (plan: WalkPlan) => AsideStep | null;

/** The monster watch: whether the next step, then what follows, keeps Chip alive (see WalkForecaster). */
export type WalkJudge = (plan: WalkPlan) => StepVerdict;

/** advanced: Chip reached the cell, drop the step; stopped: he did not and is free, drop the plan; waiting: still moving. */
export type WalkEnd = 'advanced' | 'stopped' | 'waiting';

function canMove(player: PlayerState): boolean {
  return !player.isSliding && player.moveCooldown === 0;
}

/** Before the tick: sends the next step when, and only when, Chip can take it. */
export function startWalkStep(plan: WalkPlan, engine: WalkEngine, view: PathEngine, judge?: WalkJudge, aside?: WalkAside): WalkStart {
  if (plan.moves.length === 0) return { kind: 'idle' };
  // A paused game does not walk, and a walk planned before the pause is not resumed after it.
  if (engine.isPaused()) return { kind: 'stop' };
  const player = engine.getPlayer();
  if (!canMove(player)) return { kind: 'idle' };
  const dir = plan.moves[0];
  const target = plan.points[0];
  const vec = DIRECTION_VECTORS[dir];
  // Chip is not where the plan left him (carried off, teleported): the rest of the path no longer applies.
  if (target === undefined || player.x + vec.dx !== target.x || player.y + vec.dy !== target.y) return { kind: 'stop' };
  // A forced move he may not override is due: a press would be kept and played later.
  if (!engine.canChipTakeInput()) return { kind: 'stop' };
  if (!Pathfinder.isNextStepSafe(view, dir, plan.moves.length === 1)) return { kind: 'stop' };
  const verdict = judge?.(plan) ?? 'go';
  if (verdict === 'wait') return { kind: 'wait' };
  if (verdict === 'stop') {
    const step = aside?.(plan) ?? null;
    if (step === null || !engine.attemptPlayerMove(step.dir)) return { kind: 'danger' };
    return { kind: 'aside', dir: step.dir, target: step.point };
  }
  if (!engine.attemptPlayerMove(dir)) return { kind: 'stop' };
  return { kind: 'sent', target };
}

/** After the tick: whether Chip stands on the cell the press went to. */
export function endWalkStep(engine: Pick<WalkEngine, 'getPlayer'>, start: WalkStart): WalkEnd {
  if (start.kind !== 'sent' && start.kind !== 'aside') return 'waiting';
  const player = engine.getPlayer();
  if (player.x === start.target.x && player.y === start.target.y) return 'advanced';
  return canMove(player) ? 'stopped' : 'waiting';
}

/** The running level as the path and objective searches read it: the Epoxy engine itself, the CCLP view, null for any other engine. */
export function pathEngineOf(engine: PlayEngine): PathEngine | null {
  if (engine instanceof CclpEngine) return cclpPathView(engine);
  return engine instanceof GameEngine ? engine : null;
}

/** Whether a pad direction takes the move from a tapped path: on the CCLP engine only, where the walk is ours. */
export function padCancelsWalk(engine: PlayEngine, direction: Direction | null): boolean {
  return direction !== null && engine instanceof CclpEngine;
}
