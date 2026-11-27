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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { CclpEngine } from '../core/cclp/CclpEngine';
import { GameEngine } from '../core/GameEngine';
import type { PlayEngine } from '../core/PlayEngine';
import { Direction, GridPoint, PlayerState } from '../core/types';
import { TIMING_DEFAULTS } from './uiConstants';
import { CclpSandbox, EpoxySandbox, ForkEngine, Sandbox } from './walkSandbox';
import type { AsideStep } from './walkStepAside';

/**
 * The monster watch of a tapped walk. Before each step the walk asks what the next few steps would do, played by the
 * engine's own rules on a private copy of the game (never on the game on screen), and steps, waits or stops on the answer.
 * Nothing here reaches the game on screen: it only reads it, so recorded runs and scores are those of the presses the walk
 * makes, as before.
 */

/** Upper bound on the ticks of one forecast: ice and force floors may carry Chip for long. */
const MAX_FORECAST_TICKS = 160;

/** Steps the forecast follows past the one about to be taken (game.json timing). */
export function walkLookaheadSteps(): number {
  return ConfigRegistry.getGame().timing.walkLookaheadSteps ?? TIMING_DEFAULTS.walkLookaheadSteps;
}

/** Milliseconds one forecast decision may take before the walk goes on without the watch (game.json timing). */
export function walkForecastBudgetMs(): number {
  return ConfigRegistry.getGame().timing.walkForecastBudgetMs ?? TIMING_DEFAULTS.walkForecastBudgetMs;
}

/** Ticks a walk stands waiting for a monster to pass before it gives up: the seconds of game.json timing at its tick rate. */
export function maxWalkWaitTicks(): number {
  const timing = ConfigRegistry.getGame().timing;
  return Math.ceil((timing.walkWaitSeconds ?? TIMING_DEFAULTS.walkWaitSeconds) * timing.ticksPerSecond);
}

/** go: take the step; wait: stand still this tick and ask again; stop: neither stepping nor standing keeps Chip alive. */
export type StepVerdict = 'go' | 'wait' | 'stop';

/** The planned walk: the steps left and the cell each one reaches. */
export interface ForecastPlan {
  readonly moves: readonly Direction[];
  readonly points: readonly GridPoint[];
}

type ForecastEnd = 'alive' | 'dead' | 'won' | 'timeout';
type ForecastMode = 'follow' | 'pause' | 'stay';

function ready(player: PlayerState): boolean {
  return !player.isSliding && player.moveCooldown === 0;
}

/**
 * Plays the walk on the fork. follow: every planned step in turn; pause: the first step, then standing still; stay: standing
 * still. It ends once Chip has taken the first step and the look-ahead steps more, or has stood still for as many steps' time.
 * `expired` is asked every tick: a forecast that runs out of time ends as a timeout.
 */
function play(fork: ForkEngine, plan: ForecastPlan, mode: ForecastMode, expired: () => boolean): { end: ForecastEnd; steps: number } {
  const lookahead = walkLookaheadSteps();
  const stepTicks = ConfigRegistry.getGame().timing.playerMoveCooldownTicks;
  const idleBudget = stepTicks * (lookahead + 1);
  const wanted = mode === 'stay' ? 0 : mode === 'pause' ? 1 : plan.moves.length;
  let next = 0;
  let steps = 0;
  let idle = 0;
  let target: GridPoint | null = null;
  for (let t = 0; t < MAX_FORECAST_TICKS; t++) {
    if (expired()) return { end: 'timeout', steps };
    const player = fork.getPlayer();
    if (target === null && next < wanted && ready(player)) {
      if (!fork.attemptPlayerMove(plan.moves[next])) return { end: 'alive', steps };
      target = plan.points[next];
    }
    if (target === null) idle++;
    fork.tick();
    if (fork.isLevelCompleted()) return { end: 'won', steps };
    const after = fork.getPlayer();
    if (!after.alive) return { end: 'dead', steps };
    if (target !== null) {
      if (after.x === target.x && after.y === target.y) {
        next++;
        steps++;
        target = null;
      } else if (ready(after)) {
        // Refused or carried off: the walk would stop here; what follows is standing still.
        next = wanted;
        target = null;
      }
    }
    if (steps > lookahead) return { end: 'alive', steps };
    if (idle >= idleBudget) return { end: 'alive', steps };
  }
  return { end: 'alive', steps };
}

/** Counters for the measurement harness and the tests. */
export interface ForecastStats {
  rebuilds: number;
  mismatches: number;
  timeouts: number;
  decisions: number;
  /** Step aside searches, and those that ran out of the time of their decision. */
  asideSearches: number;
  asideTimeouts: number;
}

/**
 * Answers, before each step of a tapped walk, whether to step, wait or stop. One per page; it follows the engine in play.
 * On the CCLP engine `follow` is called once per real tick, so the private copy is always at the tick on screen and a
 * decision costs the forecast only; `reset` is called when the game on screen is loaded again, undone or replayed.
 */
export class WalkForecaster {
  private sandbox: Sandbox | null = null;
  private engine: PlayEngine | null = null;
  private timeouts = 0;
  private decisions = 0;
  private asideSearches = 0;
  private asideTimeouts = 0;
  /** When the last judge began: the step aside that follows it spends what is left of the same budget. */
  private decisionStartedAt: number | null = null;

  /** `now`: the clock the per-decision budget reads (milliseconds); a test may pass its own. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  private sandboxFor(engine: PlayEngine): Sandbox | null {
    if (engine !== this.engine) {
      this.engine = engine;
      this.sandbox =
        engine instanceof CclpEngine ? new CclpSandbox(engine, this.now) : engine instanceof GameEngine ? new EpoxySandbox(engine) : null;
    }
    return this.sandbox;
  }

  /** The game on screen was loaded again, undone or replayed: the private copy is set to it again before its next use. */
  public reset(): void {
    const sandbox = this.sandbox;
    if (sandbox instanceof CclpSandbox || sandbox instanceof EpoxySandbox) sandbox.reset();
  }

  /** After each real tick of the game on screen: the CCLP copy plays that tick too. Nothing to do on another engine. */
  public follow(engine: PlayEngine): void {
    if (!(engine instanceof CclpEngine)) return;
    const sandbox = this.sandboxFor(engine);
    if (sandbox instanceof CclpSandbox) sandbox.follow();
  }

  /** For the measurement harness and the tests. */
  public stats(): ForecastStats {
    const s = this.sandbox;
    return {
      rebuilds: s instanceof CclpSandbox ? s.rebuilds : 0,
      mismatches: s instanceof CclpSandbox ? s.mismatches : 0,
      timeouts: this.timeouts,
      decisions: this.decisions,
      asideSearches: this.asideSearches,
      asideTimeouts: this.asideTimeouts
    };
  }

  private run(sandbox: Sandbox, plan: ForecastPlan, mode: ForecastMode, expired: () => boolean): { end: ForecastEnd; steps: number } | null {
    // The copy may take its time to open (the CCLP copy is built or caught up on demand): the budget is asked before and after.
    if (expired()) return { end: 'timeout', steps: 0 };
    const fork = sandbox.open();
    if (fork === null) return null;
    try {
      if (expired()) return { end: 'timeout', steps: 0 };
      return play(fork, plan, mode, expired);
    } finally {
      sandbox.close();
    }
  }

  /**
   * Called when Chip can take the next planned step. go when the step, followed by the plan or by standing still, keeps Chip
   * alive over the forecast; wait when only standing still does; stop when nothing does. go too when no forecast can be made
   * (another engine, a copy that cannot follow the game, a decision that ran out of its time budget): the walk then behaves
   * as it did without the watch.
   */
  public judge(engine: PlayEngine, plan: ForecastPlan): StepVerdict {
    if (plan.moves.length === 0) return 'go';
    const sandbox = this.sandboxFor(engine);
    if (sandbox === null) return 'go';
    this.decisions++;
    const startedAt = this.now();
    this.decisionStartedAt = startedAt;
    const budget = walkForecastBudgetMs();
    const expired = (): boolean => this.now() - startedAt > budget;
    const verdict = this.decide(sandbox, plan, expired);
    if (verdict === null) {
      this.timeouts++;
      return 'go';
    }
    return verdict;
  }

  /**
   * Called after a stop verdict: the first of `candidates` (neighbouring cells, best first) where taking that one step and
   * then standing still keeps Chip alive over the forecast, or null when none does, when no forecast can be made, or when the
   * decision runs out of its time budget (the walk then stops, as without the step aside). The step aside is part of the
   * decision of the judge before it: it spends what is left of that budget, counted from `startedAt` (by default the start
   * of the last judge, then forgotten, so a later search never reuses it).
   */
  public stepAside(engine: PlayEngine, candidates: readonly AsideStep[], startedAt?: number): AsideStep | null {
    const since = startedAt ?? this.decisionStartedAt ?? this.now();
    this.decisionStartedAt = null;
    if (candidates.length === 0) return null;
    const sandbox = this.sandboxFor(engine);
    if (sandbox === null) return null;
    this.asideSearches++;
    const budget = walkForecastBudgetMs();
    const expired = (): boolean => this.now() - since > budget;
    for (const candidate of candidates) {
      const result = this.run(sandbox, { moves: [candidate.dir], points: [candidate.point] }, 'follow', expired);
      if (result === null) return null;
      if (result.end === 'timeout') {
        this.asideTimeouts++;
        return null;
      }
      if (result.end === 'alive' && result.steps === 1) return candidate;
    }
    return null;
  }

  /** The verdict, or null when the budget ran out. */
  private decide(sandbox: Sandbox, plan: ForecastPlan, expired: () => boolean): StepVerdict | null {
    const follow = this.run(sandbox, plan, 'follow', expired);
    if (follow === null) return 'go';
    if (follow.end === 'timeout') return null;
    if (follow.end !== 'dead') return 'go';
    // The plan dies further on: the step is still worth taking when standing still after it is safe.
    if (follow.steps >= 1 && plan.moves.length > 1) {
      const pause = this.run(sandbox, plan, 'pause', expired);
      if (pause === null) return 'go';
      if (pause.end === 'timeout') return null;
      if (pause.end !== 'dead') return 'go';
    }
    const stay = this.run(sandbox, plan, 'stay', expired);
    if (stay === null) return 'go';
    if (stay.end === 'timeout') return null;
    return stay.end === 'dead' ? 'stop' : 'wait';
  }
}
