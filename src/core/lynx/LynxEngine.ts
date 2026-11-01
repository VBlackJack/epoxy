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

import { AudioManager } from '../../audio/AudioManager';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { PlayEngine, VisualEventCallback, WinCallback } from '../PlayEngine';
import { SeededRandom } from '../Random';
import { CloneLink, CompiledLevel, Direction, PlayerState, RuntimeEntity, TimedMove, TrapLink } from '../types';
import { CHIP_START_FACING, SFX, TILE } from './lynxConstants';
import { World } from './model';
import { LYNX_RULE_MODULES } from './rules';
import { buildRuleBook, RuleBook } from './ruleBook';
import { RuleModule } from './ruleApi';
import { Simulation } from './Simulation';
import { entitiesOf, playerOf } from './views';
import { buildWorld, ReplayOptions } from './worldBuilder';

/** Plays a sound effect by its audio.json id. */
export type SoundPlayer = (effectId: string) => void;

const playWithAudioManager: SoundPlayer = (effectId) => AudioManager.playSfx(effectId);

/** What undo restores: the world plus how much of both move histories had been recorded. */
interface UndoSnapshot {
  world: World;
  moveCount: number;
  timedMoveCount: number;
}

const NO_PLAYER: PlayerState = {
  x: 0,
  y: 0,
  dir: CHIP_START_FACING,
  alive: true,
  deathReasonKey: null,
  isSliding: false,
  slideDir: null,
  moveCooldown: 0,
  slideCooldown: 0,
  inWater: false,
  keys: {},
  boots: new Set<string>()
};

/**
 * The Lynx rules for Epoxy (spec: local/clean/lynx-rules-spec.md). This class
 * is the contract with the page: scores, undo, pause, histories and the views.
 * The play itself is the Simulation; the tile, monster and phase rules that
 * are not core live in the modules of ./rules.
 */
export class LynxEngine implements PlayEngine {
  private onWin: WinCallback | null = null;
  private onVisual: VisualEventCallback | null = null;
  private level: CompiledLevel | null = null;
  private sim: Simulation | null = null;
  private book: RuleBook | null = null;
  private unsupported: string[] = [];
  private replayOptions: ReplayOptions = {};
  private undoStack: UndoSnapshot[] = [];
  private paused = false;
  private winReported = false;
  private totalScore = 0;
  private totalScoreAtLevelStart = 0;
  private lastLevelScore = 0;
  private lastTimeBonus = 0;

  constructor(
    private readonly sound: SoundPlayer = playWithAudioManager,
    private readonly modules: readonly RuleModule[] = LYNX_RULE_MODULES
  ) {}

  // -------------------------------------------------------------- callbacks

  public setOnWinCallback(cb: WinCallback): void {
    this.onWin = cb;
  }

  public setOnVisualEventCallback(cb: VisualEventCallback): void {
    this.onVisual = cb;
  }

  // ------------------------------------------------------------------ setup

  /**
   * For a replay harness only: the phase offset (0 to 7) and the starting
   * direction of the random force floors. Applies to the next load, then resets.
   */
  public setReplayOptions(options: ReplayOptions): void {
    this.replayOptions = options;
  }

  /** Sorted distinct ids that play as walls or were left out of play. */
  public getUnsupportedTiles(): string[] {
    return [...this.unsupported];
  }

  public loadLevel(level: CompiledLevel, seed?: number): void {
    if (this.level !== null && this.level.id === level.id) this.totalScore = this.totalScoreAtLevelStart;
    else this.totalScoreAtLevelStart = this.totalScore;

    const book = buildRuleBook(this.modules);
    const built = buildWorld(level, book, seed ?? SeededRandom.seedFromString(level.id), this.replayOptions);
    this.replayOptions = {};
    this.level = level;
    this.book = book;
    this.unsupported = built.unsupported;
    const ticksPerSecond = ConfigRegistry.getGame().timing.ticksPerSecond;
    this.sim = new Simulation(
      level,
      built.world,
      book,
      { visual: (kind, x, y, color) => this.onVisual?.(kind, x, y, color), sound: this.sound },
      ticksPerSecond
    );
    this.undoStack = [];
    this.paused = false;
    this.winReported = false;
    this.lastLevelScore = 0;
    this.lastTimeBonus = 0;
    for (const module of book.modules) module.onLoad?.(this.sim);
  }

  // ------------------------------------------------------------------- play

  public tick(): void {
    const sim = this.sim;
    if (!sim || this.paused || !sim.world.chipState.alive || sim.world.complete) return;
    const snapshot = sim.pending !== null || sim.held !== null ? this.captureSnapshot(sim) : null;
    sim.tickOnce();
    if (snapshot && sim.report.chipTookInput && sim.report.chipStartedStep) this.keepSnapshot(snapshot);
    if (sim.world.complete && !this.winReported) this.reportWin(sim);
  }

  public attemptPlayerMove(dir: Direction): boolean {
    const sim = this.sim;
    if (!sim || this.paused || !sim.world.chipState.alive || sim.world.complete) return false;
    sim.pending = dir;
    return sim.chipCanTakeInput();
  }

  public holdPlayerDirection(dir: Direction | null): void {
    if (this.sim) this.sim.held = dir;
  }

  public dropItem(_itemId: string | null): boolean {
    return false;
  }

  public holdsItem(itemId: string): boolean {
    const chipState = this.sim?.world.chipState;
    if (!chipState) return false;
    return (chipState.keys[itemId] ?? 0) > 0 || chipState.boots.has(itemId);
  }

  // ------------------------------------------------------------------- undo

  private captureSnapshot(sim: Simulation): UndoSnapshot {
    return { world: sim.capture(), moveCount: sim.moves.length, timedMoveCount: sim.timedMoves.length };
  }

  private keepSnapshot(snapshot: UndoSnapshot): void {
    this.undoStack.push(snapshot);
    const limit = ConfigRegistry.getGame().timing.maxUndoSnapshots;
    if (this.undoStack.length > limit) this.undoStack.shift();
  }

  public undo(): boolean {
    const sim = this.sim;
    if (!sim || sim.world.complete) return false;
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    sim.restore(snapshot.world);
    sim.moves.length = snapshot.moveCount;
    sim.timedMoves.length = snapshot.timedMoveCount;
    this.sound(SFX.step);
    return true;
  }

  public canUndo(): boolean {
    return this.sim !== null && !this.sim.world.complete && this.undoStack.length > 0;
  }

  // ------------------------------------------------------------------ views

  public getTerrain(): string[][] {
    return this.sim?.world.terrain ?? [];
  }

  public getItems(): (string | null)[][] {
    return this.sim?.world.items ?? [];
  }

  public getEntities(): RuntimeEntity[] {
    return this.sim ? entitiesOf(this.sim.world) : [];
  }

  public getPlayer(): PlayerState {
    return this.sim ? playerOf(this.sim.world) : { ...NO_PLAYER, keys: {}, boots: new Set<string>() };
  }

  public getLevel(): CompiledLevel {
    if (this.level === null) throw new Error('No Lynx level is loaded');
    return this.level;
  }

  public getTrapLinks(): TrapLink[] {
    return this.level?.trapLinks ?? [];
  }

  public getCloneLinks(): CloneLink[] {
    return this.level?.cloneLinks ?? [];
  }

  public getMapWidth(): number {
    return this.sim?.width ?? 0;
  }

  public getMapHeight(): number {
    return this.sim?.height ?? 0;
  }

  public isCellClosedTrap(x: number, y: number): boolean {
    const sim = this.sim;
    if (!sim || !this.book) return false;
    for (const module of this.book.modules) {
      const answer = module.isCellClosedTrap?.(sim, x, y);
      if (answer !== null && answer !== undefined) return answer;
    }
    return false;
  }

  public getChipsRemaining(): number {
    return Math.max(0, this.sim?.world.chipsRemaining ?? 0);
  }

  public getTargetsProgress(): { covered: number; total: number } {
    return { covered: 0, total: 0 };
  }

  public getTick(): number {
    return this.sim?.world.tick ?? 0;
  }

  public getTimeRemainingSeconds(): number {
    const limit = this.level?.timeLimitSeconds ?? 0;
    if (limit <= 0) return 0;
    const ticksPerSecond = ConfigRegistry.getGame().timing.ticksPerSecond;
    return Math.max(0, limit - Math.floor(this.getTick() / ticksPerSecond));
  }

  public getTimedMoveHistory(): TimedMove[] {
    return (this.sim?.timedMoves ?? []).map((move) => ({ ...move }));
  }

  public getStepsCount(): number {
    return this.sim?.world.steps ?? 0;
  }

  // ------------------------------------------------------------------ score

  public getTotalScore(): number {
    return this.totalScore;
  }

  public getLastLevelScore(): number {
    return this.lastLevelScore;
  }

  public getLastTimeBonus(): number {
    return this.lastTimeBonus;
  }

  public carryTotalScore(total: number): void {
    this.totalScore = total;
    this.totalScoreAtLevelStart = total;
  }

  private reportWin(sim: Simulation): void {
    this.winReported = true;
    const { chip } = sim.world;
    const timing = ConfigRegistry.getGame().timing;
    const level = this.getLevel();
    const remaining = this.getTimeRemainingSeconds();
    this.lastTimeBonus = remaining * timing.timeBonusMultiplier;
    this.lastLevelScore = timing.levelBasePoints * level.number + this.lastTimeBonus;
    this.totalScore += this.lastLevelScore;
    this.sound(SFX.win);
    this.onVisual?.('win', chip.x, chip.y);
    this.onWin?.(level.id, remaining, this.getStepsCount(), this.lastLevelScore, [...sim.moves]);
  }

  // ------------------------------------------------------------------ state

  public isLevelCompleted(): boolean {
    return this.sim?.world.complete ?? false;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  public togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  public isPlayerOnHint(): boolean {
    const sim = this.sim;
    if (!sim) return false;
    const { chip, chipState } = sim.world;
    return chipState.alive && chip.remaining === 0 && sim.tileIdAt(chip.x, chip.y) === TILE.hint;
  }

  public getStatusBannerKey(): string | null {
    return null;
  }
}
