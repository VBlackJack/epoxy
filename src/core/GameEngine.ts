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
import { DIRECTION_VECTORS, ORDERED_DIRECTIONS } from '../config/constants';
import { AudioManager } from '../audio/AudioManager';
import { stepTerrainOf } from '../audio/stepTerrain';
import {
  BOMB_ITEM_ID,
  CHIP_ITEM_ID,
  GRAY_BUTTON_RADIUS,
  DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
  FLOOR_TILE_ID,
  OPPOSITE_DIRECTION,
  SUNK_BLOCK_TILE_ID
} from './coreConstants';
import {
  BASE_LEVEL_SCORE_MULTIPLIER,
  DEFAULT_TELEPORT_GROUP,
  EpoxyContext,
  EpoxyVisualKind,
  EpoxyWorld,
  applyRelativeTurn,
  buildLevelLookups,
  canPlayerEnter,
  createEpoxyWorld,
  getEntityAt,
  holdsItem,
  isCellClosedTrap,
  isEdgeBlocked,
  isInBounds,
  killPlayer,
  leaveCell,
  mapHeight,
  mapWidth,
  removeEntity
} from './epoxy/epoxyWorld';
import { refreshBeams, resolveLasers } from './epoxy/epoxyLasers';
import { SeededRandom } from './Random';
import {
  BeamCell,
  ButtonAction,
  CloneLink,
  CompiledLevel,
  Direction,
  GridPoint,
  PlayerState,
  RelativeTurn,
  RuntimeEntity,
  TileDefinition,
  TimedMove,
  TrapLink,
  UndoSnapshot
} from './types';

/** Move cooldown after stepping onto a force floor, so the floor can carry the player. */
const FORCE_FLOOR_MOVE_COOLDOWN_TICKS = 1;
/** Extra slide delay on force floors, on top of timing.slideCooldownTicks. */
const FORCE_SLIDE_EXTRA_COOLDOWN_TICKS = 1;
/** Hard cap on live entities, so a cloner wired to a held button cannot flood the grid. */
const MAX_ACTIVE_ENTITIES = 512;

export class GameEngine {
  /** The play state of the loaded level, shared with the engine modules. */
  private readonly w: EpoxyWorld = createEpoxyWorld();
  private readonly ctx: EpoxyContext;

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
      triggerButton: (x, y, action) => this.triggerButton(x, y, action),
      teleportEntity: (entity, fromX, fromY, dir) => this.teleportEntity(entity, fromX, fromY, dir)
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
        isSliding: false
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
    this.w.beamDirty = true;
  }

  /** Teleporters that a jump from the teleporter at (x, y) may land on, itself included. */
  private teleportersLinkedTo(x: number, y: number): GridPoint[] {
    const group = ConfigRegistry.getTile(this.w.terrain[y][x]).teleportGroup ?? DEFAULT_TELEPORT_GROUP;
    return this.w.teleportersByGroup.get(group) ?? [];
  }

  /** Successful player moves, in order. */
  public getMoveHistory(): Direction[] {
    return [...this.moveHistory];
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
      timedMoveHistoryLength: this.timedMoveHistory.length
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

    if (this.w.player.moveCooldown > 0) {
      this.w.player.moveCooldown--;
    }

    if (this.w.player.isSliding) {
      if (this.w.player.slideCooldown > 0) {
        this.w.player.slideCooldown--;
      } else {
        this.processPlayerSlideStep();
      }
    }

    this.updateEntities();
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

    if (this.isCarriedByForceFloor(currentTile)) {
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
    const moved = this.executePlayerMove(dir, false);
    this.w.beamDirty = true;
    if (moved) {
      this.stepsCount++;
      this.moveHistory.push(dir);
      this.timedMoveHistory.push({ tick: tickAtMove, dir });
      const destTile = ConfigRegistry.getTile(this.w.terrain[this.w.player.y][this.w.player.x]);
      // Boots cancel the push, so a booted player keeps the walking cadence.
      this.w.player.moveCooldown = this.isCarriedByForceFloor(destTile)
        ? FORCE_FLOOR_MOVE_COOLDOWN_TICKS
        : ConfigRegistry.getGame().timing.playerMoveCooldownTicks;
      resolveLasers(this.ctx);
      this.checkTargetsWin();
    } else {
      this.undoStack.pop();
      if (this.w.gridMutatedByMove || this.w.player.dir !== dirBefore) {
        this.timedMoveHistory.push({ tick: tickAtMove, dir });
      }
    }
    return moved;
  }

  /** Whether the tile is a force floor that pushes the player, i.e. one the held boots do not cancel. */
  private isCarriedByForceFloor(tile: TileDefinition): boolean {
    return tile.slideType === 'force' && (!tile.protectedByItem || !this.w.player.boots.has(tile.protectedByItem));
  }

  private executePlayerMove(dir: Direction, fromSlide: boolean): boolean {
    this.w.player.dir = dir;
    const vec = DIRECTION_VECTORS[dir];
    const targetX = this.w.player.x + vec.dx;
    const targetY = this.w.player.y + vec.dy;

    if (!isInBounds(this.w, targetX, targetY)) {
      AudioManager.playSfx('blocked');
      return false;
    }

    if (isEdgeBlocked(this.w, this.w.player.x, this.w.player.y, targetX, targetY, dir)) {
      if (!fromSlide) AudioManager.playSfx('blocked');
      return false;
    }

    const targetTileId = this.w.terrain[targetY][targetX];
    const targetTile = ConfigRegistry.getTile(targetTileId);

    if (targetTile.revealsToOnTouch) {
      this.w.terrain[targetY][targetX] = targetTile.revealsToOnTouch;
      this.w.gridMutatedByMove = true;
      AudioManager.playSfx('blocked');
      return false;
    }

    if (targetTile.requiresAllChips) {
      if (this.w.chipsRemaining <= 0) {
        this.w.terrain[targetY][targetX] = targetTile.transformsToOnUnlock || FLOOR_TILE_ID;
        this.w.gridMutatedByMove = true;
        AudioManager.playSfx('socket');
        this.emitVisual('unlock', targetX, targetY, 'yellow');
      } else {
        this.w.statusBannerKey = 'hud.messages.socket_locked';
        AudioManager.playSfx('blocked');
        return false;
      }
    }

    if (targetTile.requiredKey) {
      const keyCount = this.w.player.keys[targetTile.requiredKey] || 0;
      if (keyCount > 0) {
        if (targetTile.consumesKey) {
          this.w.player.keys[targetTile.requiredKey] = keyCount - 1;
        }
        this.w.terrain[targetY][targetX] = targetTile.transformsToOnUnlock || FLOOR_TILE_ID;
        this.w.gridMutatedByMove = true;
        AudioManager.playSfx('door');
        this.emitVisual('unlock', targetX, targetY, targetTile.colorKey || 'yellow');
      } else {
        if (!fromSlide) AudioManager.playSfx('blocked');
        return false;
      }
    }

    const updatedTargetTile = ConfigRegistry.getTile(this.w.terrain[targetY][targetX]);
    if (!canPlayerEnter(this.w, updatedTargetTile)) {
      // A barrier against an item the player carries: solid until the item is dropped elsewhere.
      if (updatedTargetTile.passableByPlayer) this.w.statusBannerKey = 'hud.messages.forbidden_item';
      if (!fromSlide) AudioManager.playSfx('blocked');
      return false;
    }

    const entityAtTarget = getEntityAt(this.w, targetX, targetY);
    if (entityAtTarget) {
      if (entityAtTarget.kind === 'block') {
        const pushed = this.attemptPushBlock(entityAtTarget, dir);
        if (!pushed) {
          if (!fromSlide) AudioManager.playSfx('blocked');
          return false;
        }
      } else if (entityAtTarget.kind === 'monster') {
        leaveCell(this.w, this.w.player.x, this.w.player.y);
        this.w.player.x = targetX;
        this.w.player.y = targetY;
        killPlayer(this.ctx, 'hud.messages.death_monster', 'death');
        return true;
      }
    }

    leaveCell(this.w, this.w.player.x, this.w.player.y);
    this.w.player.x = targetX;
    this.w.player.y = targetY;
    this.w.statusBannerKey = null;

    if (!fromSlide) {
      AudioManager.playStep(stepTerrainOf(ConfigRegistry.getTile(this.w.terrain[targetY][targetX]), this.w.player.boots));
    }

    this.resolvePlayerArrival(dir, true);
    return true;
  }

  /**
   * Applies the effects of the cell the player just entered. A teleporter is
   * resolved first: the player jumps, then the arrival cell (items, thief,
   * buttons, hazards, exit) is resolved at the destination coordinates.
   */
  private resolvePlayerArrival(entryDir: Direction, allowTeleport: boolean): void {
    const x = this.w.player.x;
    const y = this.w.player.y;
    let tile = ConfigRegistry.getTile(this.w.terrain[y][x]);

    if (tile.isTeleporter && allowTeleport) {
      this.emitVisual('teleport', x, y);
      if (this.teleportPlayer(x, y, entryDir)) {
        this.emitVisual('teleport', this.w.player.x, this.w.player.y);
        this.resolvePlayerArrival(this.w.player.dir, false);
        return;
      }
    }

    if (tile.transformsToOnStep) {
      this.w.terrain[y][x] = tile.transformsToOnStep;
      tile = ConfigRegistry.getTile(this.w.terrain[y][x]);
    }

    const itemId = this.w.items[y][x];
    if (itemId) {
      const itemDef = ConfigRegistry.getTile(itemId);
      if (itemDef.hazard === 'bomb') {
        this.w.items[y][x] = null;
        this.emitVisual('explosion', x, y, 'red');
        killPlayer(this.ctx, 'hud.messages.death_bomb', 'bomb');
        return;
      }
      if (itemDef.collectible === 'chip') {
        this.w.items[y][x] = null;
        this.w.chipsRemaining = Math.max(0, this.w.chipsRemaining - 1);
        AudioManager.playSfx('chip');
        this.emitVisual('chip', x, y, 'green');
      } else if (itemDef.collectible === 'key') {
        this.w.items[y][x] = null;
        this.w.player.keys[itemId] = (this.w.player.keys[itemId] || 0) + 1;
        AudioManager.playSfx('item');
        this.emitVisual('item', x, y, itemDef.colorKey || 'yellow');
      } else if (itemDef.collectible === 'boot') {
        this.w.items[y][x] = null;
        this.w.player.boots.add(itemId);
        AudioManager.playSfx('item');
        this.emitVisual('item', x, y, 'blue');
      } else if (itemDef.collectible === 'bonus') {
        this.w.items[y][x] = null;
        this.collectBonus(itemDef);
        AudioManager.playSfx('item');
        this.emitVisual('item', x, y, itemDef.colorKey || 'yellow');
      }
    }

    if (tile.stealsBoots && this.w.player.boots.size > 0) {
      this.w.player.boots.clear();
      this.w.statusBannerKey = 'hud.messages.thief_stole';
      AudioManager.playSfx('thief');
    }

    if (tile.stealsKeys && Object.values(this.w.player.keys).some((count) => count > 0)) {
      this.w.player.keys = {};
      this.w.statusBannerKey = 'hud.messages.thief_stole_keys';
      AudioManager.playSfx('thief');
    }

    if (tile.buttonAction) {
      this.triggerButton(x, y, tile.buttonAction);
      if (!this.w.player.alive) return;
    }

    this.w.player.inWater = tile.hazard === 'water';
    if (tile.hazard === 'water' && (!tile.protectedByItem || !this.w.player.boots.has(tile.protectedByItem))) {
      this.emitVisual('splash', x, y);
      killPlayer(this.ctx, 'hud.messages.death_water', 'death');
      return;
    }
    if (tile.hazard === 'fire' && (!tile.protectedByItem || !this.w.player.boots.has(tile.protectedByItem))) {
      this.emitVisual('explosion', x, y);
      killPlayer(this.ctx, 'hud.messages.death_fire', 'burn');
      return;
    }

    if (tile.hazard === 'slime' && (!tile.protectedByItem || !this.w.player.boots.has(tile.protectedByItem))) {
      this.emitVisual('splash', x, y, 'green');
      killPlayer(this.ctx, 'hud.messages.death_slime', 'death');
      return;
    }

    if (tile.isLevelExit) {
      this.emitVisual('win', x, y);
      this.completeLevel();
      return;
    }

    this.evaluatePlayerSliding(tile, entryDir);
  }

  /**
   * Applies a picked up bonus item: flag points join the level score paid at
   * the exit (where the multiplier applies to them too), a multiplier raises
   * that score, and a stopwatch moves the time left (an untimed level stays
   * untimed).
   */
  private collectBonus(itemDef: TileDefinition): void {
    if (itemDef.scoreBonus) {
      this.w.levelBonusPoints += itemDef.scoreBonus;
      this.w.statusBannerKey = 'hud.messages.score_bonus_picked';
    }
    if (itemDef.scoreMultiplier) {
      this.w.levelScoreMultiplier *= itemDef.scoreMultiplier;
      this.w.statusBannerKey = 'hud.messages.score_multiplier_picked';
    }
    if (itemDef.timeBonusSeconds) {
      if (this.w.level.timeLimitSeconds > 0) {
        this.w.extraTimeSeconds += itemDef.timeBonusSeconds;
      }
      this.w.statusBannerKey =
        itemDef.timeBonusSeconds > 0 ? 'hud.messages.time_bonus_picked' : 'hud.messages.time_penalty_picked';
    }
  }

  private evaluatePlayerSliding(tile: ReturnType<typeof ConfigRegistry.getTile>, entryDir: Direction): void {
    if (tile.slideType === 'ice') {
      if (tile.protectedByItem && this.w.player.boots.has(tile.protectedByItem)) {
        this.w.player.isSliding = false;
        this.w.player.slideDir = null;
        return;
      }
      const nextDir = tile.deflectionMap?.[entryDir] || entryDir;
      this.w.player.isSliding = true;
      this.w.player.slideDir = nextDir;
      this.w.player.dir = nextDir;
      this.w.player.slideCooldown = ConfigRegistry.getGame().timing.slideCooldownTicks;
      return;
    }

    if (tile.slideType === 'force') {
      if (tile.protectedByItem && this.w.player.boots.has(tile.protectedByItem)) {
        this.w.player.isSliding = false;
        this.w.player.slideDir = null;
        return;
      }
      let forceDir: Direction = entryDir;
      if (tile.forceDirection === 'RANDOM') {
        forceDir = ORDERED_DIRECTIONS[this.w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)];
      } else if (tile.forceDirection) {
        forceDir = tile.forceDirection;
      }
      this.w.player.isSliding = true;
      this.w.player.slideDir = forceDir;
      this.w.player.dir = forceDir;
      this.w.player.slideCooldown =
        ConfigRegistry.getGame().timing.slideCooldownTicks + FORCE_SLIDE_EXTRA_COOLDOWN_TICKS;
      return;
    }

    this.w.player.isSliding = false;
    this.w.player.slideDir = null;
  }

  private processPlayerSlideStep(): void {
    const dir = this.w.player.slideDir || this.w.player.dir;
    const currentTile = ConfigRegistry.getTile(this.w.terrain[this.w.player.y][this.w.player.x]);

    const moved = this.executePlayerMove(dir, true);
    if (!moved) {
      if (currentTile.slideType === 'ice') {
        const bounceDir = OPPOSITE_DIRECTION[dir];
        const deflectedBounce = currentTile.deflectionMap?.[bounceDir] || bounceDir;
        this.w.player.slideDir = deflectedBounce;
        this.w.player.dir = deflectedBounce;
        const bouncedMoved = this.executePlayerMove(deflectedBounce, true);
        if (!bouncedMoved) {
          this.w.player.isSliding = false;
          this.w.player.slideDir = null;
        }
      } else {
        this.w.player.isSliding = false;
        this.w.player.slideDir = null;
      }
    }
    this.checkTargetsWin();
  }

  private attemptPushBlock(block: RuntimeEntity, dir: Direction): boolean {
    if (isCellClosedTrap(this.w, block.x, block.y)) {
      return false;
    }
    const vec = DIRECTION_VECTORS[dir];
    const destX = block.x + vec.dx;
    const destY = block.y + vec.dy;

    if (!this.isCanBlockEnter(block, destX, destY, dir)) {
      return false;
    }

    this.moveBlockTo(block, destX, destY, dir);
    return true;
  }

  private isCanBlockEnter(block: RuntimeEntity, destX: number, destY: number, dir: Direction): boolean {
    if (!isInBounds(this.w, destX, destY)) return false;
    if (isEdgeBlocked(this.w, block.x, block.y, destX, destY, dir)) return false;

    const destTile = ConfigRegistry.getTile(this.w.terrain[destY][destX]);
    if (!destTile.passableByBlock) return false;
    if (destTile.hazard && ConfigRegistry.getEntityDef(block.type)?.refusesHazards?.includes(destTile.hazard)) {
      return false;
    }

    const existingEntity = getEntityAt(this.w, destX, destY);
    if (existingEntity) return false;

    return true;
  }

  private moveBlockTo(
    block: RuntimeEntity,
    destX: number,
    destY: number,
    dir: Direction,
    allowTeleport = true
  ): void {
    // A clone spawns in place and leaves no cell behind.
    if (block.x !== destX || block.y !== destY) {
      leaveCell(this.w, block.x, block.y);
    }
    block.x = destX;
    block.y = destY;
    block.dir = dir;

    const blockDef = ConfigRegistry.getEntityDef(block.type);
    const tileId = this.w.terrain[destY][destX];
    const tile = ConfigRegistry.getTile(tileId);
    const itemId = this.w.items[destY][destX];

    if (this.w.player.x === destX && this.w.player.y === destY && this.w.player.alive) {
      killPlayer(this.ctx, 'hud.messages.death_block', 'death');
      return;
    }

    if (itemId && ConfigRegistry.getTile(itemId).hazard === 'bomb' && blockDef?.destroyedByBomb) {
      this.w.items[destY][destX] = null;
      removeEntity(this.w, block.uid);
      AudioManager.playSfx('bomb');
      this.emitVisual('explosion', destX, destY);
      return;
    }

    if (tile.hazard === 'water') {
      this.w.terrain[destY][destX] = blockDef?.waterTransformsTo || tile.blockTransformsTo || SUNK_BLOCK_TILE_ID;
      removeEntity(this.w, block.uid);
      AudioManager.playSfx('splash');
      this.emitVisual('splash', destX, destY);
      return;
    }

    if (tile.hazard === 'slime') {
      this.w.terrain[destY][destX] = tile.blockTransformsTo || FLOOR_TILE_ID;
      removeEntity(this.w, block.uid);
      AudioManager.playSfx('splash');
      this.emitVisual('splash', destX, destY, 'green');
      return;
    }

    if (tile.hazard === 'fire' && blockDef?.destroyedByFire) {
      if (blockDef.meltsInFireTo) {
        this.w.terrain[destY][destX] = blockDef.meltsInFireTo;
      }
      removeEntity(this.w, block.uid);
      AudioManager.playSfx('burn');
      return;
    }

    if (tile.buttonAction) {
      this.triggerButton(destX, destY, tile.buttonAction);
      if (!this.w.player.alive) return;
    }

    // A jump resolves the arrival (and the sliding state) at the exit itself.
    if (tile.isTeleporter && allowTeleport && this.teleportEntity(block, destX, destY, dir)) {
      return;
    }

    const updatedTile = ConfigRegistry.getTile(this.w.terrain[block.y][block.x]);
    if (updatedTile.slideType === 'ice' && blockDef?.slidesOnIce) {
      block.dir = updatedTile.deflectionMap?.[dir] || dir;
      block.isSliding = true;
      block.cooldownTicks = ConfigRegistry.getGame().timing.slideCooldownTicks;
    } else if (updatedTile.slideType === 'force' && blockDef?.slidesOnForce) {
      block.dir =
        updatedTile.forceDirection === 'RANDOM' || !updatedTile.forceDirection
          ? dir
          : updatedTile.forceDirection;
      block.isSliding = true;
      block.cooldownTicks = ConfigRegistry.getGame().timing.slideCooldownTicks;
    } else {
      block.isSliding = false;
    }
  }

  private updateEntities(): void {
    this.w.removedUids.clear();
    const snapshotEntities = [...this.w.entities];
    for (const entity of snapshotEntities) {
      if (this.w.removedUids.has(entity.uid)) continue;

      // Entities sitting directly on a clone machine act as templates and do not move on their own
      if (ConfigRegistry.getTile(this.w.terrain[entity.y]?.[entity.x]).isCloneMachine) {
        continue;
      }

      if (entity.kind === 'block') {
        if (!entity.isSliding) continue;
        if (entity.cooldownTicks > 0) {
          entity.cooldownTicks--;
          continue;
        }
        const tile = ConfigRegistry.getTile(this.w.terrain[entity.y][entity.x]);
        const slideDir = entity.dir;
        const vec = DIRECTION_VECTORS[slideDir];
        const nx = entity.x + vec.dx;
        const ny = entity.y + vec.dy;

        if (this.isCanBlockEnter(entity, nx, ny, slideDir)) {
          this.moveBlockTo(entity, nx, ny, slideDir);
        } else if (tile.slideType === 'ice') {
          const bounceDir = OPPOSITE_DIRECTION[slideDir];
          const deflected = tile.deflectionMap?.[bounceDir] || bounceDir;
          const bVec = DIRECTION_VECTORS[deflected];
          if (this.isCanBlockEnter(entity, entity.x + bVec.dx, entity.y + bVec.dy, deflected)) {
            this.moveBlockTo(entity, entity.x + bVec.dx, entity.y + bVec.dy, deflected);
          } else {
            entity.isSliding = false;
          }
        } else {
          entity.isSliding = false;
        }
        continue;
      }

      if (entity.cooldownTicks > 0) {
        entity.cooldownTicks--;
        continue;
      }

      const def = ConfigRegistry.getEntityDef(entity.type);
      entity.cooldownTicks = def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS;

      if (isCellClosedTrap(this.w, entity.x, entity.y)) {
        continue;
      }

      const chosenDir = this.chooseMonsterDirection(entity);
      if (!chosenDir) continue;

      const vec = DIRECTION_VECTORS[chosenDir];
      const nx = entity.x + vec.dx;
      const ny = entity.y + vec.dy;
      entity.x = nx;
      entity.y = ny;
      entity.dir = chosenDir;

      if (!this.resolveMonsterArrival(entity, true)) return;
    }
  }

  /**
   * Applies the effects of the cell a monster has just entered (by a step, a
   * teleport or a clone spawn): the player under it dies, a bomb or water or
   * fire removes it, a button is pressed and a teleporter jumps it on.
   * Returns false when the player was killed, so the caller stops processing.
   */
  private resolveMonsterArrival(entity: RuntimeEntity, allowTeleport: boolean): boolean {
    const nx = entity.x;
    const ny = entity.y;
    const def = ConfigRegistry.getEntityDef(entity.type);

    if (this.w.player.x === nx && this.w.player.y === ny && this.w.player.alive) {
      killPlayer(this.ctx, 'hud.messages.death_monster', 'death');
      return false;
    }

    const destTile = ConfigRegistry.getTile(this.w.terrain[ny][nx]);
    const destItem = this.w.items[ny][nx];

    if (destItem && ConfigRegistry.getTile(destItem).hazard === 'bomb') {
      this.w.items[ny][nx] = null;
      removeEntity(this.w, entity.uid);
      AudioManager.playSfx('bomb');
      return true;
    }

    if (destTile.hazard === 'water' && !def?.immuneToWater) {
      removeEntity(this.w, entity.uid);
      AudioManager.playSfx('splash');
      return true;
    }
    if (destTile.hazard === 'fire' && !def?.immuneToFire) {
      removeEntity(this.w, entity.uid);
      AudioManager.playSfx('burn');
      return true;
    }

    if (destTile.hazard === 'slime') {
      removeEntity(this.w, entity.uid);
      AudioManager.playSfx('splash');
      return true;
    }

    if (destTile.buttonAction && !this.triggerButton(nx, ny, destTile.buttonAction)) {
      return false;
    }

    if (destTile.isTeleporter && allowTeleport) {
      return this.teleportEntity(entity, nx, ny, entity.dir) ? this.resolveMonsterArrival(entity, false) : true;
    }
    return true;
  }

  private chooseMonsterDirection(monster: RuntimeEntity): Direction | null {
    const def = ConfigRegistry.getEntityDef(monster.type);
    if (!def) return null;

    const currentTile = ConfigRegistry.getTile(this.w.terrain[monster.y][monster.x]);
    if (currentTile.slideType === 'ice') {
      const slideDir = currentTile.deflectionMap?.[monster.dir] || monster.dir;
      if (this.canMonsterEnter(monster, slideDir)) return slideDir;
      const bounce = OPPOSITE_DIRECTION[slideDir];
      if (this.canMonsterEnter(monster, bounce)) return bounce;
      return null;
    }

    if (currentTile.slideType === 'force' && currentTile.forceDirection) {
      const forceDir =
        currentTile.forceDirection === 'RANDOM'
          ? ORDERED_DIRECTIONS[this.w.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)]
          : currentTile.forceDirection;
      return this.canMonsterEnter(monster, forceDir) ? forceDir : null;
    }

    if (def.movementPattern === 'chase_player') {
      const dx = this.w.player.x - monster.x;
      const dy = this.w.player.y - monster.y;
      const candidates: Direction[] = [];
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx !== 0) candidates.push(dx > 0 ? 'E' : 'W');
        if (dy !== 0) candidates.push(dy > 0 ? 'S' : 'N');
      } else {
        if (dy !== 0) candidates.push(dy > 0 ? 'S' : 'N');
        if (dx !== 0) candidates.push(dx > 0 ? 'E' : 'W');
      }
      for (const c of candidates) {
        if (this.canMonsterEnter(monster, c)) return c;
      }
      return null;
    }

    if (def.movementPattern === 'forward_else_random') {
      if (this.canMonsterEnter(monster, monster.dir)) {
        return monster.dir;
      }
      const turns: RelativeTurn[] = ['LEFT', 'RIGHT', 'BACK'];
      this.w.rng.shuffle(turns);
      for (const turn of turns) {
        const d = applyRelativeTurn(monster.dir, turn);
        if (this.canMonsterEnter(monster, d)) return d;
      }
      return null;
    }

    if (def.movementPattern === 'pure_random') {
      const dirs: Direction[] = [...ORDERED_DIRECTIONS];
      this.w.rng.shuffle(dirs);
      for (const d of dirs) {
        if (this.canMonsterEnter(monster, d)) return d;
      }
      return null;
    }

    const turnOrder = def.turnOrder || ['FORWARD'];
    for (const rel of turnOrder) {
      const candidateDir = applyRelativeTurn(monster.dir, rel);
      if (this.canMonsterEnter(monster, candidateDir)) {
        return candidateDir;
      }
    }

    return null;
  }

  private canMonsterEnter(monster: RuntimeEntity, dir: Direction): boolean {
    const vec = DIRECTION_VECTORS[dir];
    const nx = monster.x + vec.dx;
    const ny = monster.y + vec.dy;
    if (!isInBounds(this.w, nx, ny)) return false;
    if (isEdgeBlocked(this.w, monster.x, monster.y, nx, ny, dir)) return false;

    const destTile = ConfigRegistry.getTile(this.w.terrain[ny][nx]);
    const def = ConfigRegistry.getEntityDef(monster.type);

    if (!destTile.passableByMonster && !(destTile.hazard === 'fire' && def?.immuneToFire)) {
      return false;
    }
    if (destTile.hazard === 'fire' && def?.avoidsFire) return false;

    const itemId = this.w.items[ny][nx];
    if (itemId && ConfigRegistry.getTile(itemId).hazard !== 'bomb') {
      return false;
    }

    const existing = getEntityAt(this.w, nx, ny);
    if (existing) return false;

    return true;
  }

  /** Returns false when a clone spawned by the button killed the player. */
  private triggerButton(bx: number, by: number, action: ButtonAction): boolean {
    AudioManager.playSfx('button');

    if (action === 'toggle_walls') {
      this.swapTerrain((tile) => tile.togglesTo);
    } else if (action === 'toggle_flames') {
      this.swapTerrain((tile) => tile.flameTogglesTo);
      this.burnPlayerIfFlamesLit();
      this.burnEntitiesOnFire();
    } else if (action === 'swap_chips_bombs') {
      this.swapChipsAndBombs(bx, by);
    } else if (action === 'reverse_tanks') {
      for (const ent of this.w.entities) {
        if (ConfigRegistry.getEntityDef(ent.type)?.reversedByButton) {
          ent.dir = OPPOSITE_DIRECTION[ent.dir];
        }
      }
    } else if (action === 'trigger_cloner') {
      const links = this.w.cloneLinks.filter((l) => l.buttonX === bx && l.buttonY === by);
      if (links.length > 0) {
        for (const link of links) {
          if (!this.spawnFromCloner(link.clonerX, link.clonerY, link.templateType, link.templateDir)) {
            return false;
          }
        }
      } else {
        // Fallback: trigger any clone machine that has an entity template sitting on it
        for (const ent of [...this.w.entities]) {
          if (ConfigRegistry.getTile(this.w.terrain[ent.y]?.[ent.x]).isCloneMachine) {
            if (!this.spawnFromCloner(ent.x, ent.y, ent.type, ent.dir)) return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Swaps chips and bombs in the square region centered on `(bx, by)`. The chip count
   * the exit asks for stays as it is: a chip turned into a bomb never stands in for one
   * collected, so the button cannot open the exit early.
   */
  private swapChipsAndBombs(bx: number, by: number): void {
    const minY = Math.max(0, by - GRAY_BUTTON_RADIUS);
    const maxY = Math.min(this.w.items.length - 1, by + GRAY_BUTTON_RADIUS);
    for (let y = minY; y <= maxY; y++) {
      const minX = Math.max(0, bx - GRAY_BUTTON_RADIUS);
      const maxX = Math.min(this.w.items[y].length - 1, bx + GRAY_BUTTON_RADIUS);
      for (let x = minX; x <= maxX; x++) {
        const item = this.w.items[y][x];
        if (item === CHIP_ITEM_ID) {
          this.w.items[y][x] = BOMB_ITEM_ID;
        } else if (item === BOMB_ITEM_ID) {
          this.w.items[y][x] = CHIP_ITEM_ID;
        }
      }
    }
  }

  /** Replaces every tile for which `target` names a terrain by that terrain. */
  private swapTerrain(target: (tile: TileDefinition) => string | undefined): void {
    for (let y = 0; y < this.w.terrain.length; y++) {
      for (let x = 0; x < this.w.terrain[y].length; x++) {
        const next = target(ConfigRegistry.getTile(this.w.terrain[y][x]));
        if (next) {
          this.w.terrain[y][x] = next;
        }
      }
    }
  }

  /**
   * Applies the fire rule to every entity standing on fire after the jets were
   * swapped, as if it had just stepped there: a block that fire destroys melts
   * (leaving what its definition names), a monster that is not immune dies.
   */
  private burnEntitiesOnFire(): void {
    for (const entity of [...this.w.entities]) {
      const tile = ConfigRegistry.getTile(this.w.terrain[entity.y][entity.x]);
      if (tile.hazard !== 'fire') continue;
      const def = ConfigRegistry.getEntityDef(entity.type);
      if (entity.kind === 'block') {
        if (!def?.destroyedByFire) continue;
        if (def.meltsInFireTo) {
          this.w.terrain[entity.y][entity.x] = def.meltsInFireTo;
        }
      } else if (def?.immuneToFire) {
        continue;
      }
      removeEntity(this.w, entity.uid);
      AudioManager.playSfx('burn');
      this.emitVisual('explosion', entity.x, entity.y);
    }
  }

  /** A flame jet lit under the player (a monster or block pressed the button) burns them. */
  private burnPlayerIfFlamesLit(): void {
    if (!this.w.player.alive) return;
    const tile = ConfigRegistry.getTile(this.w.terrain[this.w.player.y][this.w.player.x]);
    if (tile.hazard === 'fire' && (!tile.protectedByItem || !this.w.player.boots.has(tile.protectedByItem))) {
      this.emitVisual('explosion', this.w.player.x, this.w.player.y);
      killPlayer(this.ctx, 'hud.messages.death_fire', 'burn');
    }
  }

  /**
   * Spawns a copy of the template in front of the cloner, using the same
   * entry rules as a regular monster step or block push, so a clone never
   * appears inside a wall or another blocked cell. Returns false when the
   * clone's arrival killed the player, so the caller stops processing.
   */
  private spawnFromCloner(
    clonerX: number,
    clonerY: number,
    templateType: string,
    templateDir: Direction
  ): boolean {
    if (this.w.entities.length >= MAX_ACTIVE_ENTITIES) return true;

    const vec = DIRECTION_VECTORS[templateDir];
    const spawnX = clonerX + vec.dx;
    const spawnY = clonerY + vec.dy;
    if (!isInBounds(this.w, spawnX, spawnY)) return true;
    if (this.w.player.x === spawnX && this.w.player.y === spawnY) return true;

    const def = ConfigRegistry.getEntityDef(templateType);
    const kind = def?.kind || 'block';
    const probe: RuntimeEntity = {
      uid: 0,
      type: templateType,
      kind,
      x: clonerX,
      y: clonerY,
      dir: templateDir,
      cooldownTicks: 0,
      isSliding: false
    };
    const canEnter =
      kind === 'block'
        ? this.isCanBlockEnter(probe, spawnX, spawnY, templateDir)
        : this.canMonsterEnter(probe, templateDir);
    if (!canEnter) return true;

    const spawned: RuntimeEntity = {
      uid: this.w.nextEntityUid++,
      type: templateType,
      kind,
      x: spawnX,
      y: spawnY,
      dir: templateDir,
      cooldownTicks: def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
      isSliding: kind === 'block'
    };
    this.w.entities.push(spawned);
    if (spawned.kind === 'block') {
      this.moveBlockTo(spawned, spawnX, spawnY, templateDir);
    } else {
      return this.resolveMonsterArrival(spawned, true);
    }
    return true;
  }

  /**
   * Moves the player out of the next free teleporter of the same group.
   * Returns false when no exit exists.
   */
  private teleportPlayer(fromX: number, fromY: number, dir: Direction): boolean {
    const teleporters = this.teleportersLinkedTo(fromX, fromY);
    if (teleporters.length <= 1) return false;

    const startIdx = teleporters.findIndex((t) => t.x === fromX && t.y === fromY);
    if (startIdx < 0) return false;

    const candidateDirs: Direction[] = [
      dir,
      ...ORDERED_DIRECTIONS.filter((d) => d !== dir)
    ];

    for (let i = 1; i <= teleporters.length; i++) {
      const idx = (startIdx - i + teleporters.length) % teleporters.length;
      const candidate = teleporters[idx];
      for (const tryDir of candidateDirs) {
        const vec = DIRECTION_VECTORS[tryDir];
        const exitX = candidate.x + vec.dx;
        const exitY = candidate.y + vec.dy;
        if (isInBounds(this.w, exitX, exitY)) {
          const exitTile = ConfigRegistry.getTile(this.w.terrain[exitY][exitX]);
          if (
            canPlayerEnter(this.w, exitTile) &&
            !getEntityAt(this.w, exitX, exitY) &&
            !isEdgeBlocked(this.w, candidate.x, candidate.y, exitX, exitY, tryDir)
          ) {
            AudioManager.playSfx('teleport');
            this.w.player.x = exitX;
            this.w.player.y = exitY;
            this.w.player.dir = tryDir;
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Moves a block or monster out of the next teleporter of the same group
   * whose exit it could step onto from there, then resolves the arrival on
   * the exit cell. Returns false when no exit exists and the entity stays.
   */
  private teleportEntity(entity: RuntimeEntity, fromX: number, fromY: number, dir: Direction): boolean {
    const teleporters = this.teleportersLinkedTo(fromX, fromY);
    if (teleporters.length <= 1) return false;

    const startIdx = teleporters.findIndex((t) => t.x === fromX && t.y === fromY);
    if (startIdx < 0) return false;

    const vec = DIRECTION_VECTORS[dir];
    for (let i = 1; i <= teleporters.length; i++) {
      const idx = (startIdx - i + teleporters.length) % teleporters.length;
      const candidate = teleporters[idx];
      const exitX = candidate.x + vec.dx;
      const exitY = candidate.y + vec.dy;
      // Same entry rules as a regular step, evaluated as if the entity stood on the candidate pad.
      const probe: RuntimeEntity = { ...entity, x: candidate.x, y: candidate.y, dir };
      const canExit =
        entity.kind === 'block'
          ? this.isCanBlockEnter(probe, exitX, exitY, dir)
          : this.canMonsterEnter(probe, dir);
      if (!canExit) continue;

      entity.x = exitX;
      entity.y = exitY;
      entity.dir = dir;
      if (entity.kind === 'block') {
        // Already standing on the exit cell: resolves the arrival without another jump.
        this.moveBlockTo(entity, exitX, exitY, dir, false);
      }
      return true;
    }
    return false;
  }

  public isCellClosedTrap(tx: number, ty: number): boolean {
    return isCellClosedTrap(this.w, tx, ty);
  }

  /**
   * The cells a laser beam crosses right now, each with the axes the beam
   * follows in it. Empty on a level without emitters. The list is derived from
   * the grid and the entities (never snapshotted) and is shared: do not mutate it.
   */
  public getBeamCells(): readonly BeamCell[] {
    refreshBeams(this.w);
    return this.w.beamCells;
  }

  /** The laser receivers a beam reaches right now. */
  public getLitReceivers(): readonly GridPoint[] {
    refreshBeams(this.w);
    return this.w.litReceiverCells;
  }

  /** True when a block at rest holds the target cell. */
  private isTargetCovered({ x, y }: GridPoint): boolean {
    const occupant = getEntityAt(this.w, x, y);
    return occupant !== undefined && occupant.kind === 'block' && !occupant.isSliding;
  }

  /** How many targets of a 'targets' level hold a block at rest, out of how many there are. */
  getTargetsProgress(): { covered: number; total: number } {
    return {
      covered: this.w.targetCells.filter((cell) => this.isTargetCovered(cell)).length,
      total: this.w.targetCells.length
    };
  }

  /**
   * Ends a 'targets' level once every target holds a block that has come to
   * rest. A level without targets never ends this way, and a dead player
   * never wins. Called wherever a block may have settled.
   */
  private checkTargetsWin(): void {
    if (this.w.targetCells.length === 0 || this.w.levelCompleted || !this.w.player.alive) return;
    if (!this.w.targetCells.every((cell) => this.isTargetCovered(cell))) return;
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
