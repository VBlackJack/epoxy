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
  LitCharge,
  PlayerState,
  RuntimeEntity,
  Shot,
  SignalLink,
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
  /** Optional. The cells the laser emitters' beams cross, without the turret beams; an engine without turrets omits it. */
  getEmitterBeamCells?(): readonly BeamCell[];
  /**
   * Optional. The thin wall sides of the cells that have any, by cell index (y * width + x), only for
   * cells whose display id does not already show them. Derived state; an engine without panels omits it.
   */
  getPanels?(): ReadonlyMap<number, readonly Direction[]>;
  /**
   * Optional. The terrain hidden under the removable tops of the level, by cell index (y * width + x), or
   * undefined when there is none. Static level data for tools; the renderer draws the top only. An engine
   * without underlays omits it.
   */
  getUnderlays?(): ReadonlyMap<number, string> | undefined;
  /**
   * Optional. The terrain a removable top at the cell would show once opened right now (a covered toggle
   * wall, flame jet, hold door or laser gate in the form play has left it in), or undefined when it hides
   * none or the cell has already revealed it. A tool that finds this method trusts its answer, undefined
   * included; an engine without underlays omits it and the tools then read the level's own underlay.
   */
  getRevealedTerrain?(x: number, y: number): string | undefined;
  /**
   * Optional. The cells whose stack holds more layers than the one shown, by cell index (y * width + x).
   * Derived state; an engine without stacked layers omits it.
   */
  getHiddenLayerCells?(): ReadonlySet<number>;
  /** Optional. The blast charges lit and not yet blasted, with the tick each blasts at; undefined when none is lit. An engine without charges omits it. */
  getLitCharges?(): readonly LitCharge[] | undefined;
  /** Optional. The shots in flight; undefined on a level without shot launchers. An engine without them omits it. */
  getShots?(): readonly Shot[] | undefined;
  /**
   * Optional. The compiled signal links by cell coordinates; undefined on a level without signals. Read only and
   * never hashed or snapshotted. An engine without a signal network omits it.
   */
  getSignalLinks?(): readonly SignalLink[] | undefined;
  /**
   * Optional. The cells (y * width + x) whose signal node is on, as of the last settle; undefined without
   * signals. Read only and never hashed or snapshotted. An engine without a signal network omits it.
   */
  getPoweredSignalCells?(): ReadonlySet<number> | undefined;
  /** The count of each counter gate by cell index; undefined without a counter. */
  getCounterValues?(): ReadonlyMap<number, number> | undefined;
  getTrapLinks(): TrapLink[];
  getCloneLinks(): CloneLink[];
  getMapWidth(): number;
  getMapHeight(): number;
  isCellClosedTrap(x: number, y: number): boolean;

  getChipsRemaining(): number;
  getTargetsProgress(): { covered: number; total: number };
  getTick(): number;
  getTimeRemainingSeconds(): number;
  /** Optional. Whether a toggle clock holds the level timer; undefined on a level without one. An engine without toggle clocks omits it. */
  isTimerPaused?(): boolean | undefined;
  /** Optional. Ticks a toggle clock held the level timer so far; 0 or absent without one. */
  getPausedTicks?(): number;
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
