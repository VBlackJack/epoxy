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

import { CclpEngine } from '../core/cclp/CclpEngine';
import { cclpPathView } from '../core/cclp/cclpPathView';
import { GameEngine } from '../core/GameEngine';
import { PathEngine } from '../core/Pathfinder';
import type { PlayEngine } from '../core/PlayEngine';
import { Direction, GridPoint } from '../core/types';
import { endWalkStep, pathEngineOf, startWalkStep, WalkPlan, WalkStart } from './cclpAutoWalk';
import { startEpoxyWalkStep, WalkWait } from './epoxyAutoWalk';
import type { StepVerdict } from './walkForecast';
import { AsideStep, stepAsideCandidates, WalkDetour } from './walkStepAside';

/**
 * The tapped walk of the page, one tick at a time: the plan, the wait for a monster to pass and the steps aside, on every
 * engine. The page ticks it and draws what it reports; the tests and the measurement harness tick the very same code, so no
 * rule of the walk lives only in the page.
 *
 * Per tick: `beforeTick` sends the step (or the step aside) when the world allows it, the engine ticks, then `afterTick`
 * follows what Chip did. Nothing here draws or speaks: the result says what changed and what to tell the player.
 */

/** The monster watch the walk asks: see WalkForecaster. */
export interface WalkWatch {
  /** The clock of the decision budget. */
  clock(): number;
  /** `startedAt`: when the decision began (the judge and the step aside after it share one budget). */
  judge(engine: PlayEngine, plan: WalkPlan, startedAt: number): StepVerdict;
  stepAside(engine: PlayEngine, candidates: readonly AsideStep[], startedAt: number): AsideStep | null;
}

/** What to tell the player: a wait began; the walk ends because a monster blocks the way; the walk stepped aside. */
export type WalkNotice = 'wait' | 'stop' | 'aside';

/** What a call changed: the walk was dropped, the drawn path changed, and what the player is to be told, if anything. */
export interface WalkChange {
  readonly notice: WalkNotice | null;
  readonly cleared: boolean;
  readonly changed: boolean;
}

/** The result of `beforeTick`: what changed, and what `afterTick` needs to follow the press. */
export interface WalkTurn extends WalkChange {
  /** The CCLP press made this tick: Lynx takes a press it cannot play, so it is checked after the tick. */
  readonly cclp: WalkStart;
  /** CC2 actor order: the press is stored and played by the tick, so its outcome is read after the tick. */
  readonly stored: boolean;
}

interface Pending {
  notice: WalkNotice | null;
  cleared: boolean;
  changed: boolean;
}

export class TappedWalk {
  /** The steps left and the cell each one reaches. */
  public moves: Direction[] = [];
  public points: GridPoint[] = [];

  /** The wait counter and the detour are built here before the config is loaded: neither reads it until it is used. */
  constructor(
    private readonly watch: WalkWatch,
    public readonly wait: WalkWait = new WalkWait(),
    public readonly detour: WalkDetour = new WalkDetour()
  ) {}

  /** Whether a plan is left to walk. */
  public get active(): boolean {
    return this.moves.length > 0;
  }

  /**
   * A new walk. `tapped`: the player tapped the goal, so the walk may step aside when a monster leaves no other way; any
   * other walk (the block puzzle hint) never does. A new walk waits from zero.
   */
  public begin(moves: Direction[], points: GridPoint[], tapped: boolean): void {
    this.wait.clear();
    this.moves = moves;
    this.points = points;
    const goal = points[points.length - 1];
    if (tapped && goal !== undefined) this.detour.arm(goal);
    else this.detour.disarm();
  }

  /** The walk ends, or was dropped: no plan, no wait, no step aside left. */
  public clear(): void {
    this.wait.clear();
    this.detour.clear();
    this.moves = [];
    this.points = [];
  }

  /** Before the engine ticks: sends the next step, or waits, or steps aside, or ends the walk. */
  public beforeTick(engine: PlayEngine): WalkTurn {
    const pending: Pending = { notice: null, cleared: false, changed: false };
    // When the judge of this tick began: the step aside after it spends what is left of the same budget.
    let decisionStart = 0;
    const plan: WalkPlan = { moves: this.moves, points: this.points };
    const cclp = engine instanceof CclpEngine ? engine : null;
    if (cclp) {
      const view = cclpPathView(cclp);
      const start = startWalkStep(
        plan,
        cclp,
        view,
        (p) => this.watch.judge(cclp, p, (decisionStart = this.watch.clock())),
        (p) => this.chooseAside(cclp, view, p, decisionStart)
      );
      if (start.kind === 'stop') this.drop(pending);
      else if (start.kind === 'wait') this.hold('wait', pending);
      else if (start.kind === 'danger') this.hold('stop', pending);
      else if (start.kind === 'aside') this.beginAside(start.dir, start.target, pending);
      else if (start.kind === 'sent') this.wait.clear();
      return { ...pending, cclp: start, stored: false };
    }
    const epoxy = engine instanceof GameEngine ? engine : null;
    const start = startEpoxyWalkStep(
      plan,
      engine,
      epoxy,
      (p) => this.watch.judge(engine, p, (decisionStart = this.watch.clock())),
      (p) => (epoxy ? this.chooseAside(epoxy, epoxy, p, decisionStart) : null)
    );
    let stored = false;
    if (start.kind === 'stop') this.drop(pending);
    else if (start.kind === 'wait') this.hold('wait', pending);
    else if (start.kind === 'danger') this.hold('stop', pending);
    else if (start.kind === 'aside') {
      this.beginAside(start.dir, start.target, pending);
      stored = start.stored;
      if (!stored) this.advance(engine, pending);
    } else if (start.kind === 'sent') {
      this.wait.clear();
      stored = start.stored;
      if (!stored) this.advance(engine, pending);
    }
    return { ...pending, cclp: { kind: 'idle' }, stored };
  }

  /** After the engine ticked: the walk follows what Chip did with the press. */
  public afterTick(engine: PlayEngine, turn: WalkTurn): WalkChange {
    const pending: Pending = { notice: null, cleared: false, changed: false };
    if (turn.stored) {
      // The turn of the tick played the stored step: the queue follows what it did, as it followed the step when it was played at the input.
      const epoxy = engine instanceof GameEngine ? engine : null;
      if (epoxy?.getLastPlayerTurn()?.moved === true) {
        this.advance(engine, pending);
      } else if (!engine.getPlayer().isSliding && engine.getPlayer().moveCooldown === 0) {
        this.drop(pending);
      }
    }
    // A step aside is followed like any step: the press went to a cell, and Chip is there or not.
    if (turn.cclp.kind === 'sent' || turn.cclp.kind === 'aside') {
      const end = endWalkStep(engine, turn.cclp);
      if (end === 'advanced') this.advance(engine, pending);
      else if (end === 'stopped') this.drop(pending);
    }
    return pending;
  }

  /** A stop verdict: the neighbouring cell the walk may step aside to, while this walk has steps aside left. */
  private chooseAside(engine: PlayEngine, view: PathEngine, plan: WalkPlan, startedAt: number): AsideStep | null {
    if (!this.detour.allowed() || plan.moves.length === 0) return null;
    const goal = plan.points[plan.points.length - 1];
    return this.watch.stepAside(engine, stepAsideCandidates(view, plan.moves[0], goal), startedAt);
  }

  /**
   * The monster watch held the walk back. wait: Chip stands still this tick and the step is asked again next tick, up to
   * the limit of game.json timing; stop, or a wait that lasts longer: the walk ends and the player is told why.
   */
  private hold(verdict: 'wait' | 'stop', pending: Pending): void {
    if (verdict === 'wait') {
      const held = this.wait.hold();
      if (!held.giveUp) {
        if (held.first) pending.notice = 'wait';
        return;
      }
    }
    this.drop(pending);
    pending.notice = 'stop';
  }

  /**
   * A step aside was sent: the walk is that one step, then it plans again to its goal (see advance). The wait count is the
   * walk's own and goes on: a step aside does not give a walk more time to wait.
   */
  private beginAside(dir: Direction, target: GridPoint, pending: Pending): void {
    this.detour.stepped();
    this.moves = [dir];
    this.points = [target];
    pending.changed = true;
    pending.notice = 'aside';
  }

  /** The step at the head of the queue was taken: drops it; after a step aside, plans again from here to the goal. */
  private advance(engine: PlayEngine, pending: Pending): void {
    this.moves.shift();
    this.points.shift();
    pending.changed = true;
    if (this.moves.length > 0 || !this.detour.pending) return;
    const view = pathEngineOf(engine);
    const plan = view ? this.detour.resume(view) : null;
    if (plan === null) {
      this.drop(pending);
      pending.notice = 'stop';
      return;
    }
    this.moves = plan.moves;
    this.points = plan.points;
  }

  private drop(pending: Pending): void {
    this.clear();
    pending.cleared = true;
  }
}
