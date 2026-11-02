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

import {
  BeamCell,
  CloneLink,
  CompiledLevel,
  Direction,
  PlayerState,
  RuntimeEntity,
  TimedMove,
  TrapLink
} from './types';

export type VisualEventKind = 'chip' | 'item' | 'unlock' | 'splash' | 'explosion' | 'teleport' | 'win';

export type WinCallback = (
  levelId: string,
  timeRemaining: number,
  steps: number,
  score: number,
  moves: Direction[]
) => void;

export type VisualEventCallback = (kind: VisualEventKind, x: number, y: number, colorKey?: string) => void;

/**
 * What the page and the renderer need from a running level. The Epoxy engine
 * and the Lynx engine both satisfy it, so the page plays a level with
 * whichever one its ruleset asks for.
 */
export interface PlayEngine {
  setOnWinCallback(cb: WinCallback): void;
  setOnVisualEventCallback(cb: VisualEventCallback): void;

  loadLevel(level: CompiledLevel, seed?: number): void;
  tick(): void;
  attemptPlayerMove(dir: Direction): boolean;
  /**
   * Optional. Tells the engine which direction is held down right now (null
   * when none), called once per tick by the page. An engine that has it reads
   * a press from attemptPlayerMove and a hold from here; an engine without it
   * is sent attemptPlayerMove every tick while a direction is held.
   */
  holdPlayerDirection?(dir: Direction | null): void;
  dropItem(itemId: string | null): boolean;
  holdsItem(itemId: string): boolean;
  undo(): boolean;
  canUndo(): boolean;

  getTerrain(): string[][];
  getItems(): (string | null)[][];
  getEntities(): RuntimeEntity[];
  getPlayer(): PlayerState;
  getLevel(): CompiledLevel;
  /**
   * Optional. The cells a laser beam crosses right now (empty without lasers).
   * Derived state, never part of a snapshot; an engine without lasers omits it.
   */
  getBeamCells?(): readonly BeamCell[];
  getTrapLinks(): TrapLink[];
  getCloneLinks(): CloneLink[];
  getMapWidth(): number;
  getMapHeight(): number;
  isCellClosedTrap(x: number, y: number): boolean;

  getChipsRemaining(): number;
  getTargetsProgress(): { covered: number; total: number };
  getTick(): number;
  getTimeRemainingSeconds(): number;
  getTimedMoveHistory(): TimedMove[];
  getStepsCount(): number;

  getTotalScore(): number;
  getLastLevelScore(): number;
  getLastTimeBonus(): number;
  /** Starts the next level from a score earned under another engine. */
  carryTotalScore(total: number): void;

  isLevelCompleted(): boolean;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  togglePause(): boolean;
  isPlayerOnHint(): boolean;
  getStatusBannerKey(): string | null;
}
