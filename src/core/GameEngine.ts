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
import { AudioManager } from '../audio/AudioManager';
import {
  BLOCK_TARGET_TILE_ID,
  CELL_EDGE_BITS,
  CELL_EDGE_SIDE_ORDER,
  DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
  OPPOSITE_DIRECTION
} from './coreConstants';
import { setHoldDoors, triggerButton } from './epoxy/epoxyDevices';
import { updateEntities } from './epoxy/epoxyMonsters';
import {
  FORCE_FLOOR_MOVE_COOLDOWN_TICKS,
  executePlayerMove,
  isCarriedByForceFloor,
  processPlayerSlideStep
} from './epoxy/epoxyPlayer';
import { teleportEntity } from './epoxy/epoxyTeleports';
import { refreshBeams, resolveLasers } from './epoxy/epoxyLasers';
import { advanceShots } from './epoxy/epoxyShots';
import { mergeBeamCells, turnTurrets, turretPhaseKey } from './epoxy/epoxyTurrets';
import {
  BASE_LEVEL_SCORE_MULTIPLIER,
  EpoxyContext,
  EpoxyVisualKind,
  EpoxyWorld,
  NO_PLAY_START_TICK,
  buildLevelLookups,
  createEpoxyWorld,
  getEntityAt,
  holdsItem,
  isCellClosedTrap,
  killPlayer,
  mapHeight,
  mapWidth
} from './epoxy/epoxyWorld';
import { SeededRandom } from './Random';
import {
  BeamCell,
  CloneLink,
  CompiledLevel,
  Direction,
  GridPoint,
  PlayerState,
  RuntimeEntity,
  Shot,
  TimedMove,
  TrapLink,
  UndoSnapshot
} from './types';

/** The panels of a level without cell edges. */
const NO_PANELS: ReadonlyMap<number, readonly Direction[]> = new Map();

export class GameEngine {
  /** The play state of the loaded level, shared with the engine modules. */
  private readonly w: EpoxyWorld = createEpoxyWorld();
  private readonly ctx: EpoxyContext;

  /** The panels built from this mask; rebuilt when a level with other cell edges loads. */
  private panelsMask: Uint8Array | null = null;
  private panelsView: ReadonlyMap<number, readonly Direction[]> = NO_PANELS;

  private ticksElapsed: number = 0;
  private stepsCount: number = 0;
  private totalScore: number = 0;
  private scoreAtLevelStart: number = 0;
  private lastLevelScore: number = 0;
  private lastTimeBonus: number = 0;
  private paused: boolean = false;
  private undoStack: UndoSnapshot[] = [];
  private moveHistory: Direction[] = [];
  private timedMoveHistory: TimedMove[] = [];

  private onWinCallback:
    | ((levelId: string, timeRemaining: number, steps: number, score: number, moves: Direction[]) => void)
    | null = null;
  private onVisualEventCallback:
    | ((kind: 'chip' | 'item' | 'unlock' | 'splash' | 'explosion' | 'teleport' | 'win', x: number, y: number, colorKey?: string) => void)
    | null = null;

  constructor() {
    this.ctx = {
      world: this.w,
      emitVisual: (kind, x, y, colorKey) => this.emitVisual(kind, x, y, colorKey),
      completeLevel: () => this.completeLevel(),
      checkTargetsWin: () => this.checkTargetsWin(),
      triggerButton: (x, y, action) => triggerButton(this.ctx, x, y, action),
      teleportEntity: (entity, fromX, fromY, dir) => teleportEntity(this.ctx, entity, fromX, fromY, dir)
    };
  }

  public setOnWinCallback(
    cb: (levelId: string, timeRemaining: number, steps: number, score: number, moves: Direction[]) => void
  ): void {
    this.onWinCallback = cb;
  }

  public setOnVisualEventCallback(
    cb: (
      kind: 'chip' | 'item' | 'unlock' | 'splash' | 'explosion' | 'teleport' | 'win',
      x: number,
      y: number,
      colorKey?: string
    ) => void
  ): void {
    this.onVisualEventCallback = cb;
  }

  private emitVisual(
    kind: EpoxyVisualKind,
    x: number,
    y: number,
    colorKey?: string
  ): void {
    if (this.onVisualEventCallback) {
      this.onVisualEventCallback(kind, x, y, colorKey);
    }
  }

  /**
   * Starts (or restarts) a level. The random generator is seeded from the
   * level id unless a seed is given, so a level always plays out the same way
   * for the same inputs. Reloading the level that is already loaded is a
   * restart: the total score goes back to its value when the level started.
   */
  public loadLevel(level: CompiledLevel, seed?: number): void {
    const isRestart = this.w.level !== undefined && this.w.level.id === level.id;
    if (isRestart) {
      this.totalScore = this.scoreAtLevelStart;
    } else {
      this.scoreAtLevelStart = this.totalScore;
    }

    this.w.level = level;
    this.w.terrain = level.terrain.map((row) => [...row]);
    this.w.items = level.items.map((row) => [...row]);
    this.w.trapLinks = level.trapLinks.map((l) => ({ ...l }));
    this.w.cloneLinks = level.cloneLinks.map((l) => ({ ...l }));
    this.w.nextEntityUid = 1;
    this.w.rng = new SeededRandom(seed ?? SeededRandom.seedFromString(level.id));

    this.w.entities = level.entities.map((e) => {
      const def = ConfigRegistry.getEntityDef(e.type);
      return {
        uid: this.w.nextEntityUid++,
        type: e.type,
        kind: def?.kind || 'monster',
        x: e.x,
        y: e.y,
        dir: e.dir,
        cooldownTicks: def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
        isSliding: false,
        // A turret fires the way it was placed; its direction stays the way it is pushed or slides.
        ...(def?.turretBeam ? { facing: e.dir } : {})
      };
    });

    this.w.player = {
      x: level.playerStart.x,
      y: level.playerStart.y,
      dir: level.playerStart.dir,
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

    this.w.chipsRemaining = level.chipsRequired;
    this.ticksElapsed = 0;
    this.stepsCount = 0;
    this.w.playStartTick = NO_PLAY_START_TICK;
    this.w.extraTimeSeconds = 0;
    this.w.levelBonusPoints = 0;
    this.w.levelScoreMultiplier = BASE_LEVEL_SCORE_MULTIPLIER;
    this.lastLevelScore = 0;
    this.lastTimeBonus = 0;
    this.w.levelCompleted = false;
    this.paused = false;
    this.w.statusBannerKey = null;
    this.undoStack = [];
    this.moveHistory = [];
    this.timedMoveHistory = [];
    this.w.removedUids.clear();
    buildLevelLookups(this.w);
    // A hold door starts in the state its plates ask for (a block may start on a plate); no sound at load.
    setHoldDoors(this.ctx, false);
    this.w.beamDirty = true;
  }

  /** Successful player moves, in order. */
  public getMoveHistory(): Direction[] {
    return [...this.moveHistory];
  }

  /**
   * Where the turrets' clock stands, for searches that tell game states apart: empty on a level
   * without turrets (every other key stays as it was).
   */
  public getTurretPhaseKey(): string {
    return turretPhaseKey(this.w, this.ticksElapsed);
  }

  /** Ticks elapsed since loadLevel (rolled back by undo). */
  public getTick(): number {
    return this.ticksElapsed;
  }

  /**
   * Player moves stamped with the tick at which they were applied, meant for
   * replays: load the level, then before each tick() apply every move whose
   * tick equals getTick(), in order. The history holds every successful move
   * plus every rejected attempt that still changed the simulation (turned the
   * player, revealed a wall, opened a door). Attempts rejected without any
   * effect (cooldown, ice lock, pushing against a force floor) are left out.
   */
  public getTimedMoveHistory(): TimedMove[] {
    return this.timedMoveHistory.map((m) => ({ ...m }));
  }

  /** Width of the loaded level, in cells; levels set their own size. */
  public getMapWidth(): number {
    return mapWidth(this.w);
  }

  /** Height of the loaded level, in cells. */
  public getMapHeight(): number {
    return mapHeight(this.w);
  }

  public getLevel(): CompiledLevel {
    return this.w.level;
  }

  public getTerrain(): string[][] {
    return this.w.terrain;
  }

  public getItems(): (string | null)[][] {
    return this.w.items;
  }

  public getEntities(): RuntimeEntity[] {
    return this.w.entities;
  }

  public getTrapLinks(): TrapLink[] {
    return this.w.trapLinks;
  }

  public getCloneLinks(): CloneLink[] {
    return this.w.cloneLinks;
  }

  public getPlayer(): PlayerState {
    return this.w.player;
  }

  /**
   * The shots in flight, in the order they were fired; undefined on a level without shot launchers, so
   * nothing about shots reaches a level that has none. The list is shared: do not mutate it.
   */
  public getShots(): readonly Shot[] | undefined {
    return this.w.hasLaunchers ? this.w.shots : undefined;
  }

  public getChipsRemaining(): number {
    return Math.max(0, this.w.chipsRemaining);
  }

  public getTimeRemainingSeconds(): number {
    const { ticksPerSecond } = ConfigRegistry.getGame().timing;
    const elapsedSec = Math.floor(this.ticksElapsed / ticksPerSecond);
    return Math.max(0, this.w.level.timeLimitSeconds + this.w.extraTimeSeconds - elapsedSec);
  }

  /** Seconds gained from stopwatch items in this level, net of penalties. */
  public getExtraTimeSeconds(): number {
    return this.w.extraTimeSeconds;
  }

  /** Factor the level score is multiplied by at the exit. */
  public getLevelScoreMultiplier(): number {
    return this.w.levelScoreMultiplier;
  }

  /** Points from bonus flags picked up in this level, paid with the level score at the exit. */
  public getLevelBonusPoints(): number {
    return this.w.levelBonusPoints;
  }

  /** Keys and boots the player holds, keys first, in the order of tiles.json. */
  public getHeldItems(): string[] {
    const held: string[] = [];
    for (const id of Object.keys(ConfigRegistry.getTiles().tiles)) {
      const def = ConfigRegistry.getTile(id);
      if (def.collectible === 'key' && (this.w.player.keys[id] || 0) > 0) held.push(id);
      else if (def.collectible === 'boot' && this.w.player.boots.has(id)) held.push(id);
    }
    return held;
  }

  /** True when the player holds the item: a key of that colour, or those boots. */
  public holdsItem(itemId: string): boolean {
    return holdsItem(this.w, itemId);
  }

  /**
   * Puts a held key or pair of boots down on the player's cell. The cell must
   * hold no item; the drop does not pick the item up again, since pickups only
   * happen on entering a cell. Returns false when nothing was dropped.
   */
  public dropItem(itemId: string | null): boolean {
    if (this.paused || !this.w.player.alive || this.w.levelCompleted) return false;
    if (!itemId || !this.holdsItem(itemId)) {
      this.w.statusBannerKey = 'hud.messages.drop_nothing';
      return false;
    }
    const x = this.w.player.x;
    const y = this.w.player.y;
    if (this.w.items[y][x] !== null) {
      this.w.statusBannerKey = 'hud.messages.drop_cell_occupied';
      AudioManager.playSfx('blocked');
      return false;
    }
    // The boots that keep the player safe on this very cell stay on their feet.
    if (ConfigRegistry.getTile(this.w.terrain[y][x]).protectedByItem === itemId) {
      this.w.statusBannerKey = 'hud.messages.drop_protected';
      AudioManager.playSfx('blocked');
      return false;
    }

    this.saveUndoSnapshot();
    const def = ConfigRegistry.getTile(itemId);
    if (def.collectible === 'key') {
      const left = (this.w.player.keys[itemId] || 0) - 1;
      if (left > 0) {
        this.w.player.keys[itemId] = left;
      } else {
        delete this.w.player.keys[itemId];
      }
    } else {
      this.w.player.boots.delete(itemId);
    }
    this.w.items[y][x] = itemId;
    // An item on the cell may stop a turret beam that opacity 'block' reads.
    this.w.beamDirty = true;
    this.w.statusBannerKey = null;
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir: this.w.player.dir, drop: itemId });
    AudioManager.playSfx('item');
    this.emitVisual('item', x, y, def.colorKey || 'blue');
    return true;
  }

  public getStepsCount(): number {
    return this.stepsCount;
  }

  /**
   * Starts this engine from a score earned elsewhere: the page plays levels of
   * different rulesets with different engines, and the total score runs on.
   */
  public carryTotalScore(total: number): void {
    this.totalScore = total;
    this.scoreAtLevelStart = total;
  }

  public getTotalScore(): number {
    return this.totalScore;
  }

  public getLastLevelScore(): number {
    return this.lastLevelScore;
  }

  public getLastTimeBonus(): number {
    return this.lastTimeBonus;
  }

  public isLevelCompleted(): boolean {
    return this.w.levelCompleted;
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

  public getStatusBannerKey(): string | null {
    return this.w.statusBannerKey;
  }

  public isPlayerOnHint(): boolean {
    const tileId = this.w.terrain[this.w.player.y]?.[this.w.player.x];
    return ConfigRegistry.getTile(tileId).showsHint === true;
  }

  /** Undo is refused once the level is won: the score is already awarded. */
  public canUndo(): boolean {
    return !this.w.levelCompleted && this.undoStack.length > 0;
  }

  public saveUndoSnapshot(): void {
    const maxSnapshots = ConfigRegistry.getGame().timing.maxUndoSnapshots;
    if (this.undoStack.length >= maxSnapshots) {
      this.undoStack.shift();
    }
    this.undoStack.push(this.captureState());
  }

  /**
   * Copies the whole mutable game state. Undo uses it, and so does the piece
   * solver, which explores moves by restoring states instead of replaying.
   */
  public captureState(): UndoSnapshot {
    return {
      terrain: this.w.terrain.map((r) => [...r]),
      items: this.w.items.map((r) => [...r]),
      entities: this.w.entities.map((e) => ({ ...e })),
      player: {
        x: this.w.player.x,
        y: this.w.player.y,
        dir: this.w.player.dir,
        isSliding: this.w.player.isSliding,
        slideDir: this.w.player.slideDir,
        moveCooldown: this.w.player.moveCooldown,
        slideCooldown: this.w.player.slideCooldown,
        inWater: this.w.player.inWater,
        keys: { ...this.w.player.keys },
        boots: Array.from(this.w.player.boots)
      },
      chipsRemaining: this.w.chipsRemaining,
      ticksElapsed: this.ticksElapsed,
      stepsCount: this.stepsCount,
      totalScore: this.totalScore,
      extraTimeSeconds: this.w.extraTimeSeconds,
      levelBonusPoints: this.w.levelBonusPoints,
      levelScoreMultiplier: this.w.levelScoreMultiplier,
      rngState: this.w.rng.getState(),
      nextEntityUid: this.w.nextEntityUid,
      moveHistoryLength: this.moveHistory.length,
      timedMoveHistoryLength: this.timedMoveHistory.length,
      // Only a level with turrets reads the play start; the other snapshots stay as they were.
      ...(this.w.hasTurrets ? { playStartTick: this.w.playStartTick } : {}),
      // Only a level with shot launchers has shots to put back.
      ...(this.w.hasLaunchers ? { shots: this.w.shots.map((shot) => ({ ...shot })) } : {})
    };
  }

  public undo(): boolean {
    if (this.w.levelCompleted) return false;
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.restoreState(snap);
    AudioManager.playStep(null);
    return true;
  }

  /** Puts back a state from captureState; the player is alive and the level not won. */
  public restoreState(snap: UndoSnapshot): void {
    this.w.terrain = snap.terrain.map((r) => [...r]);
    this.w.items = snap.items.map((r) => [...r]);
    this.w.entities = snap.entities.map((e) => ({ ...e }));
    this.w.player = {
      x: snap.player.x,
      y: snap.player.y,
      dir: snap.player.dir,
      alive: true,
      deathReasonKey: null,
      isSliding: snap.player.isSliding,
      slideDir: snap.player.slideDir,
      moveCooldown: snap.player.moveCooldown,
      slideCooldown: snap.player.slideCooldown,
      inWater: snap.player.inWater,
      keys: { ...snap.player.keys },
      boots: new Set(snap.player.boots)
    };
    this.w.chipsRemaining = snap.chipsRemaining;
    this.ticksElapsed = snap.ticksElapsed;
    this.stepsCount = snap.stepsCount;
    this.totalScore = snap.totalScore;
    this.w.extraTimeSeconds = snap.extraTimeSeconds;
    this.w.levelBonusPoints = snap.levelBonusPoints;
    this.w.levelScoreMultiplier = snap.levelScoreMultiplier;
    this.w.rng.setState(snap.rngState);
    this.w.nextEntityUid = snap.nextEntityUid;
    this.moveHistory.length = snap.moveHistoryLength;
    this.timedMoveHistory.length = snap.timedMoveHistoryLength;
    this.w.playStartTick = snap.playStartTick ?? NO_PLAY_START_TICK;
    this.w.shots = (snap.shots ?? []).map((shot) => ({ ...shot }));
    // The launchers fired in the undone moment may fire again.
    this.w.firedLaunchers.clear();
    this.w.inTick = false;
    this.w.levelCompleted = false;
    this.w.statusBannerKey = null;
    this.w.beamDirty = true;
  }

  public tick(): void {
    if (this.paused || !this.w.player.alive || this.w.levelCompleted) {
      return;
    }

    // Entities and terrain may change during the tick, so the cached beams cannot be trusted past it.
    this.w.beamDirty = true;
    this.ticksElapsed++;
    if (this.getTimeRemainingSeconds() <= 0 && this.w.level.timeLimitSeconds > 0) {
      killPlayer(this.ctx, 'hud.messages.death_time', 'death');
      return;
    }

    // A shot fired from here to the end of the pass is advanced by this very tick.
    this.w.inTick = true;
    if (this.w.player.moveCooldown > 0) {
      this.w.player.moveCooldown--;
    }

    if (this.w.player.isSliding) {
      if (this.w.player.slideCooldown > 0) {
        this.w.player.slideCooldown--;
      } else {
        processPlayerSlideStep(this.ctx);
      }
    }

    updateEntities(this.ctx);
    advanceShots(this.ctx);
    this.w.inTick = false;
    // A new tick lets every launcher fire again; a move made before it counts with it.
    this.w.firedLaunchers.clear();
    // Before the laser pass, which may return early; doors settle at the end of each pass.
    setHoldDoors(this.ctx);
    turnTurrets(this.w, this.ticksElapsed);
    resolveLasers(this.ctx);
    this.checkTargetsWin();
  }

  public attemptPlayerMove(dir: Direction): boolean {
    if (this.paused || !this.w.player.alive || this.w.levelCompleted) {
      return false;
    }
    const currentTile = ConfigRegistry.getTile(this.w.terrain[this.w.player.y][this.w.player.x]);
    const isLockedByIce = this.w.player.isSliding && currentTile.slideType === 'ice';
    if (isLockedByIce || this.w.player.moveCooldown > 0) {
      return false;
    }

    if (isCarriedByForceFloor(this.w, currentTile)) {
      const activeForceDir: Direction | null =
        currentTile.forceDirection && currentTile.forceDirection !== 'RANDOM'
          ? currentTile.forceDirection
          : this.w.player.slideDir;
      if (activeForceDir && dir === OPPOSITE_DIRECTION[activeForceDir]) {
        AudioManager.playSfx('blocked');
        return false;
      }
    }

    const tickAtMove = this.ticksElapsed;
    const dirBefore = this.w.player.dir;

    if (isCellClosedTrap(this.w, this.w.player.x, this.w.player.y)) {
      this.w.player.dir = dir;
      AudioManager.playSfx('blocked');
      if (dir !== dirBefore) {
        this.timedMoveHistory.push({ tick: tickAtMove, dir });
      }
      return false;
    }

    this.saveUndoSnapshot();
    this.w.gridMutatedByMove = false;
    const moved = executePlayerMove(this.ctx, dir, false);
    this.w.beamDirty = true;
    if (moved) {
      setHoldDoors(this.ctx);
      this.stepsCount++;
      // The turrets' clock starts with the first step.
      if (this.w.hasTurrets && this.w.playStartTick === NO_PLAY_START_TICK) this.w.playStartTick = tickAtMove;
      this.moveHistory.push(dir);
      this.timedMoveHistory.push({ tick: tickAtMove, dir });
      const destTile = ConfigRegistry.getTile(this.w.terrain[this.w.player.y][this.w.player.x]);
      // Boots cancel the push, so a booted player keeps the walking cadence.
      this.w.player.moveCooldown = isCarriedByForceFloor(this.w, destTile)
        ? FORCE_FLOOR_MOVE_COOLDOWN_TICKS
        : ConfigRegistry.getGame().timing.playerMoveCooldownTicks;
      resolveLasers(this.ctx);
      this.checkTargetsWin();
    } else {
      // A move that revealed an underlay and was then rejected still spends the key and drops its undo
      // snapshot; the bump is not in moveHistory, only the timed history records it (below).
      this.undoStack.pop();
      if (this.w.gridMutatedByMove || this.w.player.dir !== dirBefore) {
        this.timedMoveHistory.push({ tick: tickAtMove, dir });
      }
    }
    return moved;
  }

  public isCellClosedTrap(tx: number, ty: number): boolean {
    return isCellClosedTrap(this.w, tx, ty);
  }

  /**
   * The thin wall sides of the cells that carry cell edges, by cell index (y * width + x). Static for
   * the level; empty when it has none. The map is shared: do not mutate it.
   */
  public getPanels(): ReadonlyMap<number, readonly Direction[]> {
    const mask = this.w.edgeMask;
    if (mask === null) return NO_PANELS;
    if (this.panelsMask !== mask) {
      const panels = new Map<number, readonly Direction[]>();
      mask.forEach((bits, index) => {
        if (bits !== 0) panels.set(index, CELL_EDGE_SIDE_ORDER.filter((side) => (bits & CELL_EDGE_BITS[side]) !== 0));
      });
      this.panelsMask = mask;
      this.panelsView = panels;
    }
    return this.panelsView;
  }

  /**
   * The terrain hidden under the removable tops of the level, by cell index (y * width + x); undefined
   * when the level has none. Static: it is the level's own data, never part of a snapshot.
   */
  public getUnderlays(): ReadonlyMap<number, string> | undefined {
    return this.w.underlays ?? undefined;
  }

  /**
   * The cells a laser beam crosses right now, each with the axes the beam
   * follows in it. Empty on a level without emitters. The list is derived from
   * the grid and the entities (never snapshotted) and is shared: do not mutate it.
   */
  public getBeamCells(): readonly BeamCell[] {
    refreshBeams(this.w);
    return mergeBeamCells(this.w.beamCells, this.w.turretBeamCells);
  }

  /** The cells the laser emitters' beams cross, turret beams left out; shared: do not mutate it. */
  public getEmitterBeamCells(): readonly BeamCell[] {
    refreshBeams(this.w);
    return this.w.beamCells;
  }

  /** The laser receivers a beam reaches right now. */
  public getLitReceivers(): readonly GridPoint[] {
    refreshBeams(this.w);
    return this.w.litReceiverCells;
  }

  /** The target cells that are a target now: one hidden under a removable top is not, until the top is gone. */
  private liveTargetCells(): GridPoint[] {
    return this.w.underlays === null
      ? this.w.targetCells
      : this.w.targetCells.filter(({ x, y }) => this.w.terrain[y][x] === BLOCK_TARGET_TILE_ID);
  }

  /** True when a block at rest holds the target cell. */
  private isTargetCovered({ x, y }: GridPoint): boolean {
    const occupant = getEntityAt(this.w, x, y);
    return occupant !== undefined && occupant.kind === 'block' && !occupant.isSliding;
  }

  /** How many targets of a 'targets' level hold a block at rest, out of how many there are. */
  getTargetsProgress(): { covered: number; total: number } {
    const targets = this.liveTargetCells();
    return {
      covered: targets.filter((cell) => this.isTargetCovered(cell)).length,
      total: targets.length
    };
  }

  /**
   * Ends a 'targets' level once every target holds a block that has come to
   * rest. A level without targets never ends this way, and a dead player
   * never wins. Called wherever a block may have settled.
   */
  private checkTargetsWin(): void {
    if (this.w.levelCompleted || !this.w.player.alive) return;
    const targets = this.liveTargetCells();
    if (targets.length === 0 || !targets.every((cell) => this.isTargetCovered(cell))) return;
    this.emitVisual('win', this.w.player.x, this.w.player.y);
    this.completeLevel();
  }

  private completeLevel(): void {
    this.w.levelCompleted = true;
    this.w.player.isSliding = false;
    const timing = ConfigRegistry.getGame().timing;
    const timeRemaining = this.getTimeRemainingSeconds();
    this.lastTimeBonus = timeRemaining * timing.timeBonusMultiplier;
    this.lastLevelScore =
      (timing.levelBasePoints * this.w.level.number + this.lastTimeBonus + this.w.levelBonusPoints) *
      this.w.levelScoreMultiplier;
    this.totalScore += this.lastLevelScore;
    AudioManager.playSfx('win');
    if (this.onWinCallback) {
      this.onWinCallback(
        this.w.level.id,
        timeRemaining,
        this.stepsCount,
        this.lastLevelScore,
        [...this.moveHistory]
      );
    }
  }

}
