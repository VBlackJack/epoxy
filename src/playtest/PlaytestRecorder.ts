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

import type { PlaytestConfig } from '../core/types';

/** Play aids the level offered when it started. */
export interface PlaytestAssists {
  hintAvailable: boolean;
  solutionAvailable: boolean;
  deadEndWatch: boolean;
}

/** What identifies the level a series of attempts is played on. */
export interface PlaytestLevelInfo {
  packId: string;
  levelId: string;
  levelNumber: number;
  ruleset: string;
  assists: PlaytestAssists;
}

export interface PlaytestDeath {
  attempt: number;
  /** Translation key of the death reason, as the engine reports it. */
  cause: string | null;
  x: number;
  y: number;
  /** Active play time of the session when the death happened. */
  atActiveMs: number;
}

export type PlaytestLeaveReason = 'level_change' | 'pack_change' | 'tab_close' | 'editor' | 'mode_off';

export type PlaytestOutcome =
  | { kind: 'win'; attempt: number; moves: number; activeMs: number }
  | { kind: 'leave'; reason: PlaytestLeaveReason }
  /** Only in an export or a saved snapshot: the series was still going on. */
  | { kind: 'in_progress' };

export interface PlaytestRating {
  difficulty: number | null;
  fun: number | null;
  /** Whether the tester had an aha moment; null when not answered. */
  aha: boolean | null;
  note: string;
}

export interface PlaytestSession extends PlaytestLevelInfo {
  id: string;
  appVersion: string;
  startedAt: number;
  endedAt: number;
  /** Play time without pauses, hidden tab, dialogs and waiting on a death or win screen. */
  activeMs: number;
  attempts: number;
  restarts: number;
  undos: number;
  hintUses: number;
  solutionViews: number;
  deadEndTriggers: number;
  /** Moves over every attempt of the series. */
  totalMoves: number;
  deathCount: number;
  /** The first deaths, up to the configured bound. */
  deaths: PlaytestDeath[];
  outcome: PlaytestOutcome;
  /** Moves of the winning attempt, compact; null when the level was not won. */
  winTrace: string | null;
  /** Moves of the last attempt, compact. */
  lastTrace: string | null;
  /** A trace was cut at the configured length. */
  tracesTruncated: boolean;
  rating: PlaytestRating | null;
}

/** What the page reports about a death. */
export interface DeathReport {
  cause: string | null;
  x: number;
  y: number;
}

/** Runtime state of the session in progress. */
interface OpenSession {
  session: PlaytestSession;
  /** Moves of the attempt on screen. */
  attemptSteps: number;
  attemptActiveMs: number;
  /** Moment the clock last started running; null while it is stopped. */
  activeSince: number | null;
  /** The player is dead and that death is already recorded. */
  deathOpen: boolean;
  /** A solution replay owns the board: its moves are not the tester's. */
  replayOwnsBoard: boolean;
}

/**
 * Collects the objective facts of a series of attempts on a level. Pure
 * logic: the page feeds it events and a clock, a store keeps the result.
 */
export class PlaytestRecorder {
  private readonly finished: PlaytestSession[];
  private open: OpenSession | null = null;
  private sequence = 0;

  public constructor(
    private readonly limits: PlaytestConfig,
    private readonly appVersion: string,
    restored: readonly PlaytestSession[] = []
  ) {
    this.finished = restored.slice(-limits.maxSessions);
  }

  public getSessions(): readonly PlaytestSession[] {
    return this.finished;
  }

  public hasOpenSession(): boolean {
    return this.open !== null;
  }

  /** Identity of the level of the session in progress, null when none is. */
  public openLevelKey(): { packId: string; levelId: string } | null {
    return this.open ? { packId: this.open.session.packId, levelId: this.open.session.levelId } : null;
  }

  /**
   * Starts a series on a level. A series still open is ended first and
   * returned; the reason tells a pack change from a level change.
   */
  public beginLevel(info: PlaytestLevelInfo, now: number): PlaytestSession | null {
    const previous = this.open;
    const left = previous
      ? this.leave(previous.session.packId === info.packId ? 'level_change' : 'pack_change', now, null)
      : null;
    this.sequence += 1;
    this.open = {
      session: {
        ...info,
        assists: { ...info.assists },
        id: `s${now}-${this.sequence}`,
        appVersion: this.appVersion,
        startedAt: now,
        endedAt: now,
        activeMs: 0,
        attempts: 1,
        restarts: 0,
        undos: 0,
        hintUses: 0,
        solutionViews: 0,
        deadEndTriggers: 0,
        totalMoves: 0,
        deathCount: 0,
        deaths: [],
        outcome: { kind: 'leave', reason: 'level_change' },
        winTrace: null,
        lastTrace: null,
        tracesTruncated: false,
        rating: null
      },
      attemptSteps: 0,
      attemptActiveMs: 0,
      activeSince: null,
      deathOpen: false,
      replayOwnsBoard: false
    };
    return left;
  }

  /** Starts or stops the play clock; calling it with the current state changes nothing. */
  public setActive(active: boolean, now: number): void {
    const open = this.open;
    if (!open) return;
    if (active && open.activeSince === null) {
      open.activeSince = now;
    } else if (!active && open.activeSince !== null) {
      this.flushClock(open, now);
      open.activeSince = null;
    }
  }

  /** Reports the move count of the attempt on screen. */
  public observeSteps(steps: number): void {
    if (this.open && !this.open.replayOwnsBoard) this.open.attemptSteps = steps;
  }

  /** The tester restarted the level: the attempt on screen ends and a new one begins. */
  public restart(now: number, trace: string): void {
    const open = this.open;
    if (!open) return;
    this.flushClock(open, now);
    this.endAttempt(open, trace);
    open.session.restarts += 1;
    open.session.attempts += 1;
    open.attemptActiveMs = 0;
    open.deathOpen = false;
    open.replayOwnsBoard = false;
  }

  /** The tester undid a move, which also brings a dead player back. */
  public undo(): void {
    if (!this.open) return;
    this.open.session.undos += 1;
    this.open.deathOpen = false;
  }

  public hint(): void {
    if (this.open) this.open.session.hintUses += 1;
  }

  public deadEndTriggered(): void {
    if (this.open) this.open.session.deadEndTriggers += 1;
  }

  /** The tester asked for the solution (the replay itself is reported by replayStarted). */
  public solutionView(): void {
    if (this.open) this.open.session.solutionViews += 1;
  }

  /**
   * A replay (solution or score) is about to drive the board: the attempt so
   * far is kept and nothing the replay does is recorded until a restart.
   */
  public replayStarted(now: number, trace: string): void {
    const open = this.open;
    if (!open || open.replayOwnsBoard) return;
    this.flushClock(open, now);
    this.endAttempt(open, trace);
    open.replayOwnsBoard = true;
  }

  /** Records a death once per life; undoing or restarting allows the next one. */
  public death(now: number, report: DeathReport): void {
    const open = this.open;
    if (!open || open.deathOpen || open.replayOwnsBoard) return;
    open.deathOpen = true;
    this.flushClock(open, now);
    const session = open.session;
    session.deathCount += 1;
    if (session.deaths.length < this.limits.maxDeathsPerSession) {
      session.deaths.push({
        attempt: session.attempts,
        cause: report.cause,
        x: report.x,
        y: report.y,
        atActiveMs: session.activeMs
      });
    }
  }

  /** The level was won: the series ends. Ignored while a solution replay owns the board. */
  public win(now: number, trace: string): PlaytestSession | null {
    const open = this.open;
    if (!open || open.replayOwnsBoard) return null;
    this.flushClock(open, now);
    const outcome: PlaytestOutcome = {
      kind: 'win',
      attempt: open.session.attempts,
      moves: open.attemptSteps,
      activeMs: open.attemptActiveMs
    };
    this.endAttempt(open, trace);
    open.session.winTrace = open.session.lastTrace;
    return this.close(open, now, outcome);
  }

  /**
   * The tester left the level without winning it. A null trace keeps the one
   * already recorded. Returns the closed session.
   */
  public leave(reason: PlaytestLeaveReason, now: number, trace: string | null): PlaytestSession | null {
    const open = this.open;
    if (!open) return null;
    this.flushClock(open, now);
    if (trace !== null) {
      this.endAttempt(open, trace);
    } else if (!open.replayOwnsBoard) {
      open.session.totalMoves += open.attemptSteps;
      open.attemptSteps = 0;
    }
    if (open.replayOwnsBoard && this.isUntouched(open.session)) {
      // Someone only watched a replay: nothing worth a session.
      this.open = null;
      return null;
    }
    return this.close(open, now, { kind: 'leave', reason });
  }

  /**
   * A copy of the series in progress, clock flushed, for an export or a saved
   * snapshot. The series goes on; the copy keeps the id and says in_progress.
   */
  public snapshot(now: number, trace: string | null): PlaytestSession | null {
    const open = this.open;
    if (!open) return null;
    this.flushClock(open, now);
    const copy = structuredClone(open.session);
    if (!open.replayOwnsBoard) {
      copy.totalMoves += open.attemptSteps;
      if (trace !== null) copy.lastTrace = trace.slice(0, this.limits.maxTraceLength);
      copy.tracesTruncated = copy.tracesTruncated || (trace !== null && trace.length > this.limits.maxTraceLength);
    }
    copy.endedAt = now;
    copy.outcome = { kind: 'in_progress' };
    return copy;
  }

  /** Drops the oldest finished session; false when there is none. */
  public dropOldest(): boolean {
    return this.finished.shift() !== undefined;
  }

  private isUntouched(session: PlaytestSession): boolean {
    return (
      session.totalMoves === 0 &&
      session.deathCount === 0 &&
      session.restarts === 0 &&
      session.undos === 0 &&
      session.hintUses === 0 &&
      session.solutionViews === 0
    );
  }

  /** Attaches the tester's rating to a finished session; false when it is gone. */
  public attachRating(sessionId: string, rating: PlaytestRating): boolean {
    const session = this.finished.find((s) => s.id === sessionId);
    if (!session) return false;
    session.rating = { ...rating };
    return true;
  }

  public clear(): void {
    this.finished.length = 0;
    this.open = null;
  }

  /** Moves made in the series so far, finished attempts included. */
  public movesSoFar(): number {
    const open = this.open;
    if (!open) return 0;
    return open.session.totalMoves + (open.replayOwnsBoard ? 0 : open.attemptSteps);
  }

  private flushClock(open: OpenSession, now: number): void {
    if (open.activeSince === null) return;
    const elapsed = Math.max(0, now - open.activeSince);
    open.session.activeMs += elapsed;
    open.attemptActiveMs += elapsed;
    open.activeSince = now;
  }

  private endAttempt(open: OpenSession, trace: string): void {
    if (!open.replayOwnsBoard) {
      open.session.totalMoves += open.attemptSteps;
      open.session.lastTrace = this.clip(open, trace);
    }
    open.attemptSteps = 0;
  }

  private clip(open: OpenSession, trace: string): string {
    if (trace.length <= this.limits.maxTraceLength) return trace;
    open.session.tracesTruncated = true;
    return trace.slice(0, this.limits.maxTraceLength);
  }

  private close(open: OpenSession, now: number, outcome: PlaytestOutcome): PlaytestSession {
    open.session.endedAt = now;
    open.session.outcome = outcome;
    this.open = null;
    this.finished.push(open.session);
    while (this.finished.length > this.limits.maxSessions) this.finished.shift();
    return open.session;
  }
}
