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

import type { TwsReplayPlayer } from '../core/cclp/twsReplay';
import { mayRecordWin } from './twsSolution';

/**
 * The state of a run that started from a Tile World solution: the replay itself (while it plays), and the "seeded" mark
 * that stays on the run after the player takes over. A seeded run uses the file's seed and stepping, so it is never recorded
 * and the walk aids that copy the game (tapped paths, the monster forecast) stay off. The page asks this one object, so
 * every guard reads the same answer.
 */
export class TwsRun {
  private current: TwsReplayPlayer | null = null;
  private seededRun = false;
  private scoreBase: number | null = null;

  /** The replay that is playing, or null. */
  public player(): TwsReplayPlayer | null {
    return this.current;
  }

  /** A TWS replay starts; `totalScore` is the player's total now, which no win of this run may raise. */
  public begin(player: TwsReplayPlayer, totalScore: number): void {
    this.current = player;
    this.seededRun = true;
    this.scoreBase = totalScore;
  }

  /** The replay ends or the player takes over; the run stays seeded. */
  public stopReplay(): void {
    this.current = null;
  }

  /** A plain load (restart, other level): the run is an ordinary one again. */
  public clear(): void {
    this.current = null;
    this.seededRun = false;
    this.scoreBase = null;
  }

  /** The one predicate every "a replay owns the engine" guard reads: the stored-solution replay or a TWS replay. */
  public replayActive(isReplaying: boolean): boolean {
    return isReplaying || this.current !== null;
  }

  /** True while the run uses the file's seed and stepping, replay or takeover. */
  public seeded(): boolean {
    return this.seededRun;
  }

  /** The walk aids that copy the game with its default seed (tapped paths, the monster forecast) may run. */
  public walkAidsAllowed(): boolean {
    return !this.seededRun;
  }

  public mayRecordWin(isReplaying: boolean, testPlaying: boolean): boolean {
    return mayRecordWin({ replaying: isReplaying, tws: this.current !== null, seededRun: this.seededRun, testPlaying });
  }

  /** The total score to put back after a win of this run, or null when the run is an ordinary one. */
  public totalScoreToCarry(): number | null {
    return this.seededRun ? this.scoreBase : null;
  }
}
