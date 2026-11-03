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

import { DEFAULT_RULESET } from '../core/coreConstants';
import { featuresFor } from '../core/RulesetFeatures';
import type { CompiledLevel, PlaytestConfig, PlayerState, TimedMove } from '../core/types';
import { hasStoredSolution } from '../ui/levelFeedback';
import {
  PlaytestAssists,
  PlaytestLeaveReason,
  PlaytestRating,
  PlaytestRecorder,
  PlaytestSession
} from './PlaytestRecorder';
import { buildPlaytestExport, PlaytestExport, PlaytestStore } from './PlaytestStore';

/** Opens and closes a held-item drop in a compact trace. */
const DROP_OPEN = '[';
const DROP_CLOSE = ']';

/** One move per letter (N, E, S, W); an item drop is written `[item_id]`. */
export function compactTrace(moves: readonly TimedMove[]): string {
  return moves.map((m) => (m.drop ? `${DROP_OPEN}${m.drop}${DROP_CLOSE}` : m.dir)).join('');
}

/** The play aids a level offers, as the page would show them. */
export function assistsFor(level: CompiledLevel): PlaytestAssists {
  const features = featuresFor(level);
  return {
    hintAvailable: features.objectiveMarker || features.blockHint,
    solutionAvailable: features.solutionReplay && hasStoredSolution(level),
    deadEndWatch: features.deadEndWatch
  };
}

/** What the controller reads from the running engine. */
export interface PlaytestEngineView {
  getTimedMoveHistory(): TimedMove[];
  getStepsCount(): number;
  getPlayer(): PlayerState;
  isPaused(): boolean;
  isLevelCompleted(): boolean;
  getLevel(): CompiledLevel;
}

/** What the page says about the moment of a tick. */
export interface PlaytestTickState {
  /** The play view is on screen with no dialog or drawer over it. */
  playing: boolean;
  /** A solution or score replay drives the board. */
  replaying: boolean;
}

/** Context of the rating form. */
export interface PlaytestRatingContext {
  levelNumber: number;
  won: boolean;
}

export interface PlaytestControllerDeps {
  engine: () => PlaytestEngineView;
  store: PlaytestStore;
  config: PlaytestConfig;
  appVersion: string;
  now: () => number;
  isPageVisible: () => boolean;
  /** Shows the rating form; resolves null when it is skipped. */
  askRating: (context: PlaytestRatingContext) => Promise<PlaytestRating | null>;
  /** The enabled flag or the session count changed. */
  onChange: () => void;
}

/**
 * Glue between the page and the recorder: reads the engine when an event
 * needs it, keeps the play clock honest and saves what was recorded. The page
 * only calls the hooks; with Playtest off every hook returns at once.
 */
export class PlaytestController {
  private readonly recorder: PlaytestRecorder;
  private enabled: boolean;
  /** Level object the open session is played on, to notice another one loaded behind our back. */
  private trackedLevel: CompiledLevel | null = null;

  public constructor(private readonly deps: PlaytestControllerDeps) {
    this.recorder = new PlaytestRecorder(deps.config, deps.appVersion, deps.store.loadSessions());
    this.enabled = deps.store.isEnabled();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public sessionCount(): number {
    return this.recorder.getSessions().length;
  }

  public setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (!enabled) this.closeOpen('tab_close', false);
    this.enabled = enabled;
    this.deps.store.setEnabled(enabled);
    this.deps.onChange();
  }

  /** The content of the download, or null when nothing was recorded. The series in progress is not part of it. */
  public buildExport(): PlaytestExport | null {
    const sessions = this.recorder.getSessions();
    if (sessions.length === 0) return null;
    return buildPlaytestExport(sessions, this.deps.appVersion, this.deps.now());
  }

  public clearData(): void {
    this.recorder.clear();
    this.trackedLevel = null;
    this.deps.store.clearSessions();
    this.deps.onChange();
  }

  /** Call before another level replaces the one on screen, while the engine still holds the old one. */
  public levelLeaving(nextPackId: string): void {
    if (!this.enabled) return;
    const open = this.recorder.openLevelKey();
    if (!open) return;
    this.closeOpen(open.packId === nextPackId ? 'level_change' : 'pack_change');
  }

  /** Call once the level of a series is loaded and ready to play. */
  public levelStarted(packId: string): void {
    if (!this.enabled) return;
    const level = this.deps.engine().getLevel();
    this.closeOpen('level_change');
    this.recorder.beginLevel(
      {
        packId,
        levelId: level.id,
        levelNumber: level.number,
        ruleset: level.ruleset ?? DEFAULT_RULESET,
        assists: assistsFor(level)
      },
      this.deps.now()
    );
    this.trackedLevel = level;
  }

  /** Once per game tick: keeps the clock, the move count and the death watch current. */
  public tick(state: PlaytestTickState): void {
    if (!this.enabled || !this.recorder.hasOpenSession()) return;
    const engine = this.deps.engine();
    if (engine.getLevel() !== this.trackedLevel) {
      // Another level was loaded without a start hook (an editor test play).
      this.closeOpen('level_change');
      return;
    }
    const now = this.deps.now();
    const player = engine.getPlayer();
    this.recorder.observeSteps(engine.getStepsCount());
    if (!state.replaying && !player.alive) {
      this.recorder.death(now, { cause: player.deathReasonKey, x: player.x, y: player.y });
    }
    const active =
      state.playing &&
      !state.replaying &&
      this.deps.isPageVisible() &&
      !engine.isPaused() &&
      player.alive &&
      !engine.isLevelCompleted();
    this.recorder.setActive(active, now);
  }

  public restarted(): void {
    if (!this.guard()) return;
    this.recorder.observeSteps(this.deps.engine().getStepsCount());
    this.recorder.restart(this.deps.now(), this.trace());
  }

  public undone(): void {
    if (this.guard()) this.recorder.undo();
  }

  public hintUsed(): void {
    if (this.guard()) this.recorder.hint();
  }

  public deadEndShown(): void {
    if (this.guard()) this.recorder.deadEndTriggered();
  }

  /** Call after the tester confirmed the solution and before the replay reloads the level. */
  public solutionViewed(): void {
    if (!this.guard()) return;
    this.recorder.observeSteps(this.deps.engine().getStepsCount());
    this.recorder.solutionView(this.deps.now(), this.trace());
  }

  /** The engine reported a win (never a replay's). */
  public won(): void {
    if (!this.guard()) return;
    this.recorder.observeSteps(this.deps.engine().getStepsCount());
    const session = this.recorder.win(this.deps.now(), this.trace());
    if (session) this.finish(session, true);
  }

  /** The page is closing or going away: the series ends and is saved, no form is shown. */
  public pageHiding(): void {
    this.closeOpen('tab_close', false);
  }

  /** Stops the clock while the tab is hidden and restarts it when it returns, on the next tick. */
  public visibilityChanged(): void {
    if (!this.enabled || this.deps.isPageVisible()) return;
    this.recorder.setActive(false, this.deps.now());
  }

  /** The open series, if any, is only valid while the tracked level is still on screen. */
  private guard(): boolean {
    return this.enabled && this.recorder.hasOpenSession() && this.deps.engine().getLevel() === this.trackedLevel;
  }

  private trace(): string {
    return compactTrace(this.deps.engine().getTimedMoveHistory());
  }

  private closeOpen(reason: PlaytestLeaveReason, askRating = true): void {
    if (!this.recorder.hasOpenSession()) return;
    const sameLevel = this.deps.engine().getLevel() === this.trackedLevel;
    this.recorder.observeSteps(sameLevel ? this.deps.engine().getStepsCount() : 0);
    const session = this.recorder.leave(reason, this.deps.now(), sameLevel ? this.trace() : null);
    this.trackedLevel = null;
    if (session) this.finish(session, false, askRating);
  }

  private finish(session: PlaytestSession, won: boolean, askRating = true): void {
    this.deps.store.saveSessions(this.recorder.getSessions());
    this.deps.onChange();
    if (!askRating || (!won && session.totalMoves === 0)) return;
    void this.deps.askRating({ levelNumber: session.levelNumber, won }).then((rating) => {
      if (!rating) return;
      if (this.recorder.attachRating(session.id, rating)) this.deps.store.saveSessions(this.recorder.getSessions());
    });
  }
}
