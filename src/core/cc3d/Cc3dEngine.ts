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
import { stepTerrainOf } from '../../audio/stepTerrain';
import { ConfigRegistry } from '../../config/ConfigRegistry';
import { PlayEngine, VisualEventCallback, WinCallback } from '../PlayEngine';
import { SeededRandom } from '../Random';
import { BeamCell, CloneLink, CompiledLevel, Direction, PlayerState, RuntimeEntity, TimedMove, TrapLink } from '../types';
import { Cc3dSimulation, Cc3dSnapshot } from './Cc3dSimulation';
import { BOT_ROTATION_SECONDS, PLAYER_START_FACING, SFX } from './cc3dConstants';
import { isSupportedMonster } from './cc3dMonsterTraits';
import { World, buildWorld, cellAt, isBlockKind, isInertMob } from './cc3dWorld';
import { displayItemId, displayMobId, displayShowsPanels, displayTerrainId } from './display';
import type { Cc3dColor, Cc3dItemKind, Cc3dTerrainKind } from './model';

/** Where the engine sends its sounds, so tests can listen in. */
export interface SoundPlayer {
  /** Plays a sound effect by its audio.json id. */
  effect(effectId: string): void;
  /** Plays the footstep of a terrain key, or the plain step when it is null. */
  step(terrain: string | null): void;
}

const playWithAudioManager: SoundPlayer = {
  effect: (effectId) => AudioManager.playSfx(effectId),
  step: (terrain) => AudioManager.playStep(terrain)
};

/** Terrain kinds whose device does nothing yet (none since P3). */
const UNSUPPORTED_TERRAIN: readonly Cc3dTerrainKind[] = [];

/** Items collected but without effect yet. */
const UNSUPPORTED_ITEMS: readonly Cc3dItemKind[] = [];

/** What undo restores: the world state plus how much of both move histories had been recorded. */
interface UndoSnapshot {
  state: Cc3dSnapshot;
  moveCount: number;
  timedMoveCount: number;
}

const NO_PLAYER: PlayerState = {
  x: 0,
  y: 0,
  dir: PLAYER_START_FACING,
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

/** The keys a player holds, by display id (key_red...), only the colours he has. */
function keysByDisplayId(keys: Record<Cc3dColor, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [color, count] of Object.entries(keys)) {
    const id = displayItemId({ kind: 'key', color: color as Cc3dColor });
    if (count > 0 && id) result[id] = count;
  }
  return result;
}

/** The tools a player holds, by display id (boots_ice...). */
function toolsByDisplayId(tools: readonly Cc3dItemKind[]): Set<string> {
  const ids = new Set<string>();
  for (const kind of tools) {
    const id = displayItemId({ kind });
    if (id) ids.add(id);
  }
  return ids;
}

/** Distinct kinds present in the world that the engine does not play yet, sorted. */
function unsupportedKinds(world: World): string[] {
  const found = new Set<string>();
  for (const cell of world.cells) {
    for (const t of cell.terrain) if (UNSUPPORTED_TERRAIN.includes(t.kind)) found.add(t.kind);
    if (cell.item && UNSUPPORTED_ITEMS.includes(cell.item.kind)) found.add(cell.item.kind);
  }
  for (const mob of world.mobs) if (!isBlockKind(mob.kind) && !isSupportedMonster(mob.kind) && !isInertMob(mob.kind)) found.add(mob.kind);
  return [...found].sort();
}

/**
 * The play engine of the 'cc3d' ruleset (written from a prose rules spec). It reads only
 * CompiledLevel.cc3d. This class is the contract with the page (scores, undo,
 * pause, histories, views); the play itself is the Cc3dSimulation.
 */
export class Cc3dEngine implements PlayEngine {
  private onWin: WinCallback | null = null;
  private onVisual: VisualEventCallback | null = null;
  private level: CompiledLevel | null = null;
  private sim: Cc3dSimulation | null = null;
  private unsupported: string[] = [];
  private terrainView: string[][] = [];
  private itemView: (string | null)[][] = [];
  private panelView = new Map<number, readonly Direction[]>();
  private hiddenLayerView = new Set<number>();
  private undoStack: UndoSnapshot[] = [];
  private paused = false;
  private winReported = false;
  private totalScore = 0;
  private totalScoreAtLevelStart = 0;
  private lastLevelScore = 0;
  private lastTimeBonus = 0;

  constructor(private readonly sound: SoundPlayer = playWithAudioManager) {}

  // -------------------------------------------------------------- callbacks

  public setOnWinCallback(cb: WinCallback): void {
    this.onWin = cb;
  }

  public setOnVisualEventCallback(cb: VisualEventCallback): void {
    this.onVisual = cb;
  }

  // ------------------------------------------------------------------ setup

  /** Sorted distinct kinds that are placeholders or have no effect yet. */
  public getUnsupportedTiles(): string[] {
    return [...this.unsupported];
  }

  public loadLevel(level: CompiledLevel, seed?: number): void {
    const data = level.cc3d;
    if (!data) throw new Error(`CC3D engine: level ${level.id} carries no cc3d data`);
    if (this.level !== null && this.level.id === level.id) this.totalScore = this.totalScoreAtLevelStart;
    else this.totalScoreAtLevelStart = this.totalScore;

    const world = buildWorld(data, seed ?? SeededRandom.seedFromString(level.id));
    this.level = level;
    this.unsupported = unsupportedKinds(world);
    const ticksPerSecond = ConfigRegistry.getGame().timing.ticksPerSecond;
    this.sim = new Cc3dSimulation(
      world,
      {
        visual: (kind, x, y, color) => this.onVisual?.(kind, x, y, color),
        sound: (id) => this.sound.effect(id),
        step: (x, y) => this.playStep(x, y)
      },
      level.timeLimitSeconds * ticksPerSecond,
      BOT_ROTATION_SECONDS * ticksPerSecond
    );
    this.undoStack = [];
    this.paused = false;
    this.winReported = false;
    this.lastLevelScore = 0;
    this.lastTimeBonus = 0;
    this.rebuildViews();
  }

  private playStep(x: number, y: number): void {
    const tile = ConfigRegistry.getTile(this.terrainView[y]?.[x] ?? '');
    const tools = this.sim ? toolsByDisplayId(this.sim.world.player.tools) : new Set<string>();
    this.sound.step(stepTerrainOf(tile, tools));
  }

  // ------------------------------------------------------------------- play

  /** Test hook: begins play as if the player had taken his first step. */
  public beginPlayForTests(): void {
    this.sim?.beginPlay();
  }

  public tick(): void {
    const sim = this.sim;
    if (!sim || this.paused || !sim.world.player.alive || sim.world.complete) return;
    // Only a player at rest with an input can start a step, so only then is a snapshot worth taking.
    const wantsStep = sim.world.player.remaining === 0 && (sim.pending !== null || sim.held !== null);
    const snapshot = wantsStep ? this.captureSnapshot(sim) : null;
    sim.tickOnce();
    if (snapshot) {
      if (sim.report.tookInput && sim.report.startedStep) this.keepSnapshot(sim, snapshot);
      else sim.discardSnapshot(snapshot.state);
    }
    this.refreshViews();
    if (sim.world.complete && !this.winReported) this.reportWin(sim);
  }

  public attemptPlayerMove(dir: Direction): boolean {
    const sim = this.sim;
    if (!sim || this.paused || !sim.world.player.alive || sim.world.complete) return false;
    sim.pending = dir;
    return sim.world.player.remaining === 0;
  }

  public holdPlayerDirection(dir: Direction | null): void {
    if (this.sim) this.sim.held = dir;
  }

  public dropItem(_itemId: string | null): boolean {
    return false;
  }

  public holdsItem(itemId: string): boolean {
    const player = this.sim?.world.player;
    if (!player) return false;
    return (keysByDisplayId(player.keys)[itemId] ?? 0) > 0 || toolsByDisplayId(player.tools).has(itemId);
  }

  // ------------------------------------------------------------------- undo

  private captureSnapshot(sim: Cc3dSimulation): UndoSnapshot {
    return { state: sim.beginSnapshot(), moveCount: sim.moves.length, timedMoveCount: sim.timedMoves.length };
  }

  private keepSnapshot(sim: Cc3dSimulation, snapshot: UndoSnapshot): void {
    sim.keepSnapshot(snapshot.state);
    this.undoStack.push(snapshot);
    const limit = ConfigRegistry.getGame().timing.maxUndoSnapshots;
    if (this.undoStack.length > limit) this.undoStack.shift();
  }

  public undo(): boolean {
    const sim = this.sim;
    if (!sim || sim.world.complete) return false;
    const snapshot = this.undoStack.pop();
    if (!snapshot) return false;
    sim.restoreSnapshot(snapshot.state, this.undoStack[this.undoStack.length - 1]?.state);
    sim.moves.length = snapshot.moveCount;
    sim.timedMoves.length = snapshot.timedMoveCount;
    this.refreshViews();
    this.sound.step(null);
    return true;
  }

  public canUndo(): boolean {
    return this.sim !== null && !this.sim.world.complete && this.undoStack.length > 0;
  }

  // ------------------------------------------------------------------ views

  private rebuildViews(): void {
    const world = this.sim?.world;
    if (!world) return;
    this.terrainView = Array.from({ length: world.height }, () => new Array<string>(world.width));
    this.itemView = Array.from({ length: world.height }, () => new Array<string | null>(world.width).fill(null));
    this.panelView.clear();
    this.hiddenLayerView.clear();
    for (let i = 0; i < world.cells.length; i++) this.refreshCell(world, i);
    world.changed = [];
  }

  private refreshViews(): void {
    const world = this.sim?.world;
    if (!world) return;
    for (const index of world.changed) this.refreshCell(world, index);
    world.changed = [];
  }

  private refreshCell(world: World, index: number): void {
    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const cell = world.cells[index];
    this.terrainView[y][x] = displayTerrainId(cell);
    this.itemView[y][x] = displayItemId(cell.item);
    // Panels the display id already shows (plain floor) are not repeated here, so nothing draws twice.
    if (cell.panels.length > 0 && !displayShowsPanels(cell)) this.panelView.set(index, cell.panels);
    else this.panelView.delete(index);
    if (cell.terrain.length > 1) this.hiddenLayerView.add(index);
    else this.hiddenLayerView.delete(index);
  }

  public getTerrain(): string[][] {
    return this.terrainView;
  }

  public getItems(): (string | null)[][] {
    return this.itemView;
  }

  public getPanels(): ReadonlyMap<number, readonly Direction[]> {
    return this.panelView;
  }

  public getHiddenLayerCells(): ReadonlySet<number> {
    return this.hiddenLayerView;
  }

  public getEntities(): RuntimeEntity[] {
    const world = this.sim?.world;
    if (!world) return [];
    return world.mobs.map((m) => ({
      uid: m.uid,
      type: displayMobId({ kind: m.kind, x: m.x, y: m.y, dir: m.dir, color: m.color, mirror: m.mirror }),
      kind: isBlockKind(m.kind) ? 'block' : 'monster',
      x: m.x,
      y: m.y,
      dir: m.dir,
      cooldownTicks: m.remaining,
      isSliding: m.carried
    }));
  }

  public getPlayer(): PlayerState {
    const world = this.sim?.world;
    if (!world) return { ...NO_PLAYER, keys: {}, boots: new Set<string>() };
    const p = world.player;
    const sliding = p.alive && p.carried;
    return {
      x: p.x,
      y: p.y,
      dir: p.dir,
      alive: p.alive,
      deathReasonKey: p.deathKey,
      isSliding: sliding,
      slideDir: sliding ? p.dir : null,
      moveCooldown: p.remaining,
      slideCooldown: sliding ? p.remaining : 0,
      inWater: false,
      keys: keysByDisplayId(p.keys),
      boots: toolsByDisplayId(p.tools)
    };
  }

  public getLevel(): CompiledLevel {
    if (this.level === null) throw new Error('No CC3D level is loaded');
    return this.level;
  }

  public getTrapLinks(): TrapLink[] {
    return this.level?.trapLinks ?? [];
  }

  public getCloneLinks(): CloneLink[] {
    return this.level?.cloneLinks ?? [];
  }

  public getMapWidth(): number {
    return this.sim?.world.width ?? 0;
  }

  public getMapHeight(): number {
    return this.sim?.world.height ?? 0;
  }

  public isCellClosedTrap(x: number, y: number): boolean {
    const cell = this.sim ? cellAt(this.sim.world, x, y) : undefined;
    const trap = cell?.terrain.find((t) => t.kind === 'trap');
    return trap !== undefined && trap.open !== true;
  }

  public getChipsRemaining(): number {
    return Math.max(0, this.sim?.world.fishRemaining ?? 0);
  }

  /** The cells covered by security-bot beams right now, for the beam overlay. */
  public getBeamCells(): readonly BeamCell[] {
    return this.sim?.world.beam ?? [];
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

  private reportWin(sim: Cc3dSimulation): void {
    this.winReported = true;
    const { player } = sim.world;
    const timing = ConfigRegistry.getGame().timing;
    const level = this.getLevel();
    const remaining = this.getTimeRemainingSeconds();
    this.lastTimeBonus = remaining * timing.timeBonusMultiplier;
    this.lastLevelScore = timing.levelBasePoints * level.number + this.lastTimeBonus;
    this.totalScore += this.lastLevelScore;
    this.sound.effect(SFX.win);
    this.onVisual?.('win', player.x, player.y);
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
    return false;
  }

  public getStatusBannerKey(): string | null {
    return null;
  }
}
