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

/**
 * Replay of a Tile World solution (.tws) on the CCLP engine: which record of a player's file belongs to the level on screen,
 * and the per-tick keys that play it. The page calls the same TwsReplayPlayer the measurement replays, so what is measured
 * is what plays.
 */

import type { ReplayOptions } from '../lynx/worldBuilder';
import type { CompiledLevel, Direction } from '../types';
import { decodeTwsMoves, TwsEntry, TwsIndex, TwsLimits, TwsMoves, twsBitsToDirections } from '../../formats/TwsCodec';

/** Why the level on screen has no playable solution in the loaded file, or the record that plays it. */
export type TwsMatch =
  | { kind: 'playable'; entry: TwsEntry }
  | { kind: 'not_cclp' }
  | { kind: 'ms_ruleset' }
  | { kind: 'no_record' }
  | { kind: 'no_solution' }
  | { kind: 'password_mismatch'; entry: TwsEntry }
  | { kind: 'mouse_moves' };

const CCLP_RULESET = 'lynx';
const CCLP_PROFILE = 'cclp';

export type TwsLevel = Pick<CompiledLevel, 'number' | 'password' | 'ruleset' | 'rulesProfile'>;

/** True for a level a TWS file can replay: played by the CCLP engine (Lynx ruleset, CCLP rules profile). */
export function isTwsLevel(level: Pick<CompiledLevel, 'ruleset' | 'rulesProfile'>): boolean {
  return level.ruleset === CCLP_RULESET && level.rulesProfile === CCLP_PROFILE;
}

/**
 * The record of `index` for `level`: matched by level number, then checked against the level password, since a pack edited
 * or of another version can hold a different level under the same number. Only CCLP engine levels and Lynx files play.
 */
export function matchTwsRecord(index: TwsIndex, level: TwsLevel): TwsMatch {
  if (!isTwsLevel(level)) return { kind: 'not_cclp' };
  if (index.ruleset !== CCLP_RULESET) return { kind: 'ms_ruleset' };
  const entry = index.entries.get(level.number);
  if (entry === undefined) return { kind: 'no_record' };
  if (entry.password.toUpperCase() !== level.password.toUpperCase()) return { kind: 'password_mismatch', entry };
  if (!entry.hasSolution) return { kind: 'no_solution' };
  if (entry.hasMouseMoves) return { kind: 'mouse_moves' };
  return { kind: 'playable', entry };
}

/** How many levels of a pack the file plays, for the line shown once a file is loaded. */
export function countPlayableLevels(index: TwsIndex, levels: readonly TwsLevel[]): number {
  let playable = 0;
  for (const level of levels) {
    if (matchTwsRecord(index, level).kind === 'playable') playable++;
  }
  return playable;
}

/** What the player needs from the engine to load a level the way the solution was recorded. */
export interface TwsLoadTarget {
  setReplayOptions(options: ReplayOptions): void;
  loadLevel(level: CompiledLevel, seed?: number): void;
}

/** What the player needs from the engine each tick. */
export interface TwsTickTarget {
  getTick(): number;
  holdPlayerDirections?(dirs: readonly Direction[]): void;
}

/** True when the engine can load a level with a stepping, a seed and a force floor start (the Lynx engine and its kin). */
export function isTwsLoadTarget(engine: unknown): engine is TwsLoadTarget {
  const candidate = engine as Partial<TwsLoadTarget> | null;
  return typeof candidate?.setReplayOptions === 'function' && typeof candidate.loadLevel === 'function';
}

/** Plays one TWS record: loads the level with the record's start state, then holds the recorded keys tick by tick. */
export class TwsReplayPlayer {
  private cursor = 0;

  /** `graceTicks`: how long the replay keeps running, keys released, after the last recorded move. */
  constructor(
    private readonly entry: TwsEntry,
    private readonly moves: TwsMoves,
    private readonly graceTicks: number
  ) {}

  /** Loads `level` with the stepping, random seed and force floor start the solution was recorded with. */
  public load(engine: TwsLoadTarget, level: CompiledLevel): void {
    engine.setReplayOptions({ phaseOffset: this.entry.stepping, randomForceStart: this.entry.forceStart });
    engine.loadLevel(level, this.entry.seed);
    this.cursor = 0;
  }

  /** The keys held on `tick`: those of a move recorded on that tick, none otherwise. Ticks must not go backward. */
  public directionsAt(tick: number): readonly Direction[] {
    const { ticks, bits } = this.moves;
    while (this.cursor < ticks.length && ticks[this.cursor] < tick) this.cursor++;
    return this.cursor < ticks.length && ticks[this.cursor] === tick ? twsBitsToDirections(bits[this.cursor]) : twsBitsToDirections(0);
  }

  /** Holds the keys of the tick the engine is about to play. Call once before each engine tick. */
  public beforeTick(engine: TwsTickTarget): void {
    engine.holdPlayerDirections?.(this.directionsAt(engine.getTick()));
  }

  /** True once the replay has nothing left to play: the last move plus the grace has passed. */
  public isOver(tick: number): boolean {
    return tick >= this.entry.endTick + this.graceTicks;
  }

  /** Recorded moves played before `tick` and in all, for the replay banner. */
  public progress(tick: number): { step: number; total: number } {
    const { ticks } = this.moves;
    let step = this.cursor;
    while (step < ticks.length && ticks[step] < tick) step++;
    return { step, total: ticks.length };
  }
}

/** The player of a playable record: its moves are decoded now, for this one level only. */
export function createTwsPlayer(index: TwsIndex, entry: TwsEntry, limits: TwsLimits & { graceTicks: number }): TwsReplayPlayer {
  return new TwsReplayPlayer(entry, decodeTwsMoves(index, entry, limits), limits.graceTicks);
}

/** Where a TWS replay stands after a tick. */
export type TwsVerdict = 'running' | 'won' | 'died' | 'over';

/** What a replay's end looks like on a tick the engine just played: a win, a death (no grace for a dead Chip), or the end of the moves. */
export function twsVerdict(player: TwsReplayPlayer, state: { tick: number; alive: boolean; completed: boolean }): TwsVerdict {
  if (state.completed) return 'won';
  if (!state.alive) return 'died';
  return player.isOver(state.tick) ? 'over' : 'running';
}
