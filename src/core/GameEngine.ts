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
import {
  DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
  FLOOR_TILE_ID,
  OPPOSITE_DIRECTION,
  SUNK_BLOCK_TILE_ID
} from './coreConstants';
import { SeededRandom } from './Random';
import {
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
/** Group of the teleporters that declare none: they all chain together. */
const DEFAULT_TELEPORT_GROUP = '';
/** Level score factor before any multiplier item is picked up. */
const BASE_LEVEL_SCORE_MULTIPLIER = 1;

export class GameEngine {
  private level!: CompiledLevel;
  private terrain: string[][] = [];
  private items: (string | null)[][] = [];
  private entities: RuntimeEntity[] = [];
  private trapLinks: TrapLink[] = [];
  private cloneLinks: CloneLink[] = [];
  private player!: PlayerState;

  private chipsRemaining: number = 0;
  private ticksElapsed: number = 0;
  private stepsCount: number = 0;
  /** Seconds gained from stopwatch items in this level, net of penalties. */
  private extraTimeSeconds: number = 0;
  /** Points from bonus flags, paid with the level score at the exit. */
  private levelBonusPoints: number = 0;
  /** Factor applied to the level score at the exit, raised by multiplier items. */
  private levelScoreMultiplier: number = BASE_LEVEL_SCORE_MULTIPLIER;
  private totalScore: number = 0;
  private scoreAtLevelStart: number = 0;
  private lastLevelScore: number = 0;
  private lastTimeBonus: number = 0;
  private levelCompleted: boolean = false;
  private paused: boolean = false;
  private statusBannerKey: string | null = null;
  private nextEntityUid: number = 1;
  private undoStack: UndoSnapshot[] = [];
  private moveHistory: Direction[] = [];
  private timedMoveHistory: TimedMove[] = [];
  private rng: SeededRandom = new SeededRandom(0);

  // Lookups built once per level: these cells never change tile type during play.
  private trapLinksByTrap = new Map<string, TrapLink[]>();
  private holdTrapButtons: GridPoint[] = [];
  /** Teleporter cells by group: a jump lands on a teleporter of the same group only. */
  private teleportersByGroup = new Map<string, GridPoint[]>();
  private removedUids = new Set<number>();
  /** Set when a rejected player move still altered the grid (revealed wall, opened door). */
  private gridMutatedByMove = false;

  private onWinCallback:
    | ((levelId: string, timeRemaining: number, steps: number, score: number, moves: Direction[]) => void)
    | null = null;
  private onVisualEventCallback:
    | ((kind: 'chip' | 'item' | 'unlock' | 'splash' | 'explosion' | 'teleport' | 'win', x: number, y: number, colorKey?: string) => void)
    | null = null;

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
    kind: 'chip' | 'item' | 'unlock' | 'splash' | 'explosion' | 'teleport' | 'win',
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
    const isRestart = this.level !== undefined && this.level.id === level.id;
    if (isRestart) {
      this.totalScore = this.scoreAtLevelStart;
    } else {
      this.scoreAtLevelStart = this.totalScore;
    }

    this.level = level;
    this.terrain = level.terrain.map((row) => [...row]);
    this.items = level.items.map((row) => [...row]);
    this.trapLinks = level.trapLinks.map((l) => ({ ...l }));
    this.cloneLinks = level.cloneLinks.map((l) => ({ ...l }));
    this.nextEntityUid = 1;
    this.rng = new SeededRandom(seed ?? SeededRandom.seedFromString(level.id));

    this.entities = level.entities.map((e) => {
      const def = ConfigRegistry.getEntityDef(e.type);
      return {
        uid: this.nextEntityUid++,
        type: e.type,
        kind: def?.kind || 'monster',
        x: e.x,
        y: e.y,
        dir: e.dir,
        cooldownTicks: def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
        isSliding: false
      };
    });

    this.player = {
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

    this.chipsRemaining = level.chipsRequired;
    this.ticksElapsed = 0;
    this.stepsCount = 0;
    this.extraTimeSeconds = 0;
    this.levelBonusPoints = 0;
    this.levelScoreMultiplier = BASE_LEVEL_SCORE_MULTIPLIER;
    this.lastLevelScore = 0;
    this.lastTimeBonus = 0;
    this.levelCompleted = false;
    this.paused = false;
    this.statusBannerKey = null;
    this.undoStack = [];
    this.moveHistory = [];
    this.timedMoveHistory = [];
    this.removedUids.clear();
    this.buildLevelLookups();
  }

  private buildLevelLookups(): void {
    this.trapLinksByTrap.clear();
    for (const link of this.trapLinks) {
      const key = this.cellKey(link.trapX, link.trapY);
      const list = this.trapLinksByTrap.get(key);
      if (list) {
        list.push(link);
      } else {
        this.trapLinksByTrap.set(key, [link]);
      }
    }

    this.holdTrapButtons = [];
    this.teleportersByGroup.clear();
    for (let y = 0; y < this.terrain.length; y++) {
      for (let x = 0; x < this.terrain[y].length; x++) {
        const tile = ConfigRegistry.getTile(this.terrain[y][x]);
        if (tile.buttonAction === 'hold_trap') this.holdTrapButtons.push({ x, y });
        if (tile.isTeleporter) {
          const group = tile.teleportGroup ?? DEFAULT_TELEPORT_GROUP;
          const list = this.teleportersByGroup.get(group);
          if (list) {
            list.push({ x, y });
          } else {
            this.teleportersByGroup.set(group, [{ x, y }]);
          }
        }
      }
    }
  }

  /** Teleporters that a jump from the teleporter at (x, y) may land on, itself included. */
  private teleportersLinkedTo(x: number, y: number): GridPoint[] {
    const group = ConfigRegistry.getTile(this.terrain[y][x]).teleportGroup ?? DEFAULT_TELEPORT_GROUP;
    return this.teleportersByGroup.get(group) ?? [];
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

  public getLevel(): CompiledLevel {
    return this.level;
  }

  public getTerrain(): string[][] {
    return this.terrain;
  }

  public getItems(): (string | null)[][] {
    return this.items;
  }

  public getEntities(): RuntimeEntity[] {
    return this.entities;
  }

  public getTrapLinks(): TrapLink[] {
    return this.trapLinks;
  }

  public getCloneLinks(): CloneLink[] {
    return this.cloneLinks;
  }

  public getPlayer(): PlayerState {
    return this.player;
  }

  public getChipsRemaining(): number {
    return Math.max(0, this.chipsRemaining);
  }

  public getTimeRemainingSeconds(): number {
    const { ticksPerSecond } = ConfigRegistry.getGame().timing;
    const elapsedSec = Math.floor(this.ticksElapsed / ticksPerSecond);
    return Math.max(0, this.level.timeLimitSeconds + this.extraTimeSeconds - elapsedSec);
  }

  /** Seconds gained from stopwatch items in this level, net of penalties. */
  public getExtraTimeSeconds(): number {
    return this.extraTimeSeconds;
  }

  /** Factor the level score is multiplied by at the exit. */
  public getLevelScoreMultiplier(): number {
    return this.levelScoreMultiplier;
  }

  /** Points from bonus flags picked up in this level, paid with the level score at the exit. */
  public getLevelBonusPoints(): number {
    return this.levelBonusPoints;
  }

  /** Keys and boots the player holds, keys first, in the order of tiles.json. */
  public getHeldItems(): string[] {
    const held: string[] = [];
    for (const id of Object.keys(ConfigRegistry.getTiles().tiles)) {
      const def = ConfigRegistry.getTile(id);
      if (def.collectible === 'key' && (this.player.keys[id] || 0) > 0) held.push(id);
      else if (def.collectible === 'boot' && this.player.boots.has(id)) held.push(id);
    }
    return held;
  }

  /** True when the player holds the item: a key of that colour, or those boots. */
  public holdsItem(itemId: string): boolean {
    return (this.player.keys[itemId] || 0) > 0 || this.player.boots.has(itemId);
  }

  /**
   * Puts a held key or pair of boots down on the player's cell. The cell must
   * hold no item; the drop does not pick the item up again, since pickups only
   * happen on entering a cell. Returns false when nothing was dropped.
   */
  public dropItem(itemId: string | null): boolean {
    if (this.paused || !this.player.alive || this.levelCompleted) return false;
    if (!itemId || !this.holdsItem(itemId)) {
      this.statusBannerKey = 'hud.messages.drop_nothing';
      return false;
    }
    const x = this.player.x;
    const y = this.player.y;
    if (this.items[y][x] !== null) {
      this.statusBannerKey = 'hud.messages.drop_cell_occupied';
      AudioManager.playSfx('blocked');
      return false;
    }
    // The boots that keep the player safe on this very cell stay on their feet.
    if (ConfigRegistry.getTile(this.terrain[y][x]).protectedByItem === itemId) {
      this.statusBannerKey = 'hud.messages.drop_protected';
      AudioManager.playSfx('blocked');
      return false;
    }

    this.saveUndoSnapshot();
    const def = ConfigRegistry.getTile(itemId);
    if (def.collectible === 'key') {
      const left = (this.player.keys[itemId] || 0) - 1;
      if (left > 0) {
        this.player.keys[itemId] = left;
      } else {
        delete this.player.keys[itemId];
      }
    } else {
      this.player.boots.delete(itemId);
    }
    this.items[y][x] = itemId;
    this.statusBannerKey = null;
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir: this.player.dir, drop: itemId });
    AudioManager.playSfx('item');
    this.emitVisual('item', x, y, def.colorKey || 'blue');
    return true;
  }

  public getStepsCount(): number {
    return this.stepsCount;
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
    return this.levelCompleted;
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
    return this.statusBannerKey;
  }

  public isPlayerOnHint(): boolean {
    const tileId = this.terrain[this.player.y]?.[this.player.x];
    return ConfigRegistry.getTile(tileId).showsHint === true;
  }

  /** Undo is refused once the level is won: the score is already awarded. */
  public canUndo(): boolean {
    return !this.levelCompleted && this.undoStack.length > 0;
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
      terrain: this.terrain.map((r) => [...r]),
      items: this.items.map((r) => [...r]),
      entities: this.entities.map((e) => ({ ...e })),
      player: {
        x: this.player.x,
        y: this.player.y,
        dir: this.player.dir,
        isSliding: this.player.isSliding,
        slideDir: this.player.slideDir,
        moveCooldown: this.player.moveCooldown,
        slideCooldown: this.player.slideCooldown,
        inWater: this.player.inWater,
        keys: { ...this.player.keys },
        boots: Array.from(this.player.boots)
      },
      chipsRemaining: this.chipsRemaining,
      ticksElapsed: this.ticksElapsed,
      stepsCount: this.stepsCount,
      totalScore: this.totalScore,
      extraTimeSeconds: this.extraTimeSeconds,
      levelBonusPoints: this.levelBonusPoints,
      levelScoreMultiplier: this.levelScoreMultiplier,
      rngState: this.rng.getState(),
      nextEntityUid: this.nextEntityUid,
      moveHistoryLength: this.moveHistory.length,
      timedMoveHistoryLength: this.timedMoveHistory.length
    };
  }

  public undo(): boolean {
    if (this.levelCompleted) return false;
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.restoreState(snap);
    AudioManager.playSfx('step');
    return true;
  }

  /** Puts back a state from captureState; the player is alive and the level not won. */
  public restoreState(snap: UndoSnapshot): void {
    this.terrain = snap.terrain.map((r) => [...r]);
    this.items = snap.items.map((r) => [...r]);
    this.entities = snap.entities.map((e) => ({ ...e }));
    this.player = {
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
    this.chipsRemaining = snap.chipsRemaining;
    this.ticksElapsed = snap.ticksElapsed;
    this.stepsCount = snap.stepsCount;
    this.totalScore = snap.totalScore;
    this.extraTimeSeconds = snap.extraTimeSeconds;
    this.levelBonusPoints = snap.levelBonusPoints;
    this.levelScoreMultiplier = snap.levelScoreMultiplier;
    this.rng.setState(snap.rngState);
    this.nextEntityUid = snap.nextEntityUid;
    this.moveHistory.length = snap.moveHistoryLength;
    this.timedMoveHistory.length = snap.timedMoveHistoryLength;
    this.levelCompleted = false;
    this.statusBannerKey = null;
  }

  public tick(): void {
    if (this.paused || !this.player.alive || this.levelCompleted) {
      return;
    }

    this.ticksElapsed++;
    if (this.getTimeRemainingSeconds() <= 0 && this.level.timeLimitSeconds > 0) {
      this.killPlayer('hud.messages.death_time', 'death');
      return;
    }

    if (this.player.moveCooldown > 0) {
      this.player.moveCooldown--;
    }

    if (this.player.isSliding) {
      if (this.player.slideCooldown > 0) {
        this.player.slideCooldown--;
      } else {
        this.processPlayerSlideStep();
      }
    }

    this.updateEntities();
  }

  public attemptPlayerMove(dir: Direction): boolean {
    if (this.paused || !this.player.alive || this.levelCompleted) {
      return false;
    }
    const currentTile = ConfigRegistry.getTile(this.terrain[this.player.y][this.player.x]);
    const isLockedByIce = this.player.isSliding && currentTile.slideType === 'ice';
    if (isLockedByIce || this.player.moveCooldown > 0) {
      return false;
    }

    if (
      currentTile.slideType === 'force' &&
      (!currentTile.protectedByItem || !this.player.boots.has(currentTile.protectedByItem))
    ) {
      const activeForceDir: Direction | null =
        currentTile.forceDirection && currentTile.forceDirection !== 'RANDOM'
          ? currentTile.forceDirection
          : this.player.slideDir;
      if (activeForceDir && dir === OPPOSITE_DIRECTION[activeForceDir]) {
        AudioManager.playSfx('blocked');
        return false;
      }
    }

    const tickAtMove = this.ticksElapsed;
    const dirBefore = this.player.dir;

    if (this.isCellClosedTrap(this.player.x, this.player.y)) {
      this.player.dir = dir;
      AudioManager.playSfx('blocked');
      if (dir !== dirBefore) {
        this.timedMoveHistory.push({ tick: tickAtMove, dir });
      }
      return false;
    }

    this.saveUndoSnapshot();
    this.gridMutatedByMove = false;
    const moved = this.executePlayerMove(dir, false);
    if (moved) {
      this.stepsCount++;
      this.moveHistory.push(dir);
      this.timedMoveHistory.push({ tick: tickAtMove, dir });
      const destTile = ConfigRegistry.getTile(this.terrain[this.player.y][this.player.x]);
      this.player.moveCooldown =
        destTile.slideType === 'force'
          ? FORCE_FLOOR_MOVE_COOLDOWN_TICKS
          : ConfigRegistry.getGame().timing.playerMoveCooldownTicks;
    } else {
      this.undoStack.pop();
      if (this.gridMutatedByMove || this.player.dir !== dirBefore) {
        this.timedMoveHistory.push({ tick: tickAtMove, dir });
      }
    }
    return moved;
  }

  private isEdgeBlocked(fromX: number, fromY: number, toX: number, toY: number, dir: Direction): boolean {
    const currentTile = ConfigRegistry.getTile(this.terrain[fromY][fromX]);
    const targetTile = ConfigRegistry.getTile(this.terrain[toY][toX]);
    const opposite = OPPOSITE_DIRECTION[dir];

    if (currentTile.blockedEdges?.includes(dir)) return true;
    if (targetTile.blockedEdges?.includes(opposite)) return true;
    if (currentTile.blockedEntryDirections?.includes(opposite)) return true;
    if (targetTile.blockedEntryDirections?.includes(dir)) return true;

    return false;
  }

  private executePlayerMove(dir: Direction, fromSlide: boolean): boolean {
    this.player.dir = dir;
    const vec = DIRECTION_VECTORS[dir];
    const targetX = this.player.x + vec.dx;
    const targetY = this.player.y + vec.dy;

    if (!this.isInBounds(targetX, targetY)) {
      AudioManager.playSfx('blocked');
      return false;
    }

    if (this.isEdgeBlocked(this.player.x, this.player.y, targetX, targetY, dir)) {
      if (!fromSlide) AudioManager.playSfx('blocked');
      return false;
    }

    const targetTileId = this.terrain[targetY][targetX];
    const targetTile = ConfigRegistry.getTile(targetTileId);

    if (targetTile.revealsToOnTouch) {
      this.terrain[targetY][targetX] = targetTile.revealsToOnTouch;
      this.gridMutatedByMove = true;
      AudioManager.playSfx('blocked');
      return false;
    }

    if (targetTile.requiresAllChips) {
      if (this.chipsRemaining <= 0) {
        this.terrain[targetY][targetX] = targetTile.transformsToOnUnlock || FLOOR_TILE_ID;
        this.gridMutatedByMove = true;
        AudioManager.playSfx('socket');
        this.emitVisual('unlock', targetX, targetY, 'yellow');
      } else {
        this.statusBannerKey = 'hud.messages.socket_locked';
        AudioManager.playSfx('blocked');
        return false;
      }
    }

    if (targetTile.requiredKey) {
      const keyCount = this.player.keys[targetTile.requiredKey] || 0;
      if (keyCount > 0) {
        if (targetTile.consumesKey) {
          this.player.keys[targetTile.requiredKey] = keyCount - 1;
        }
        this.terrain[targetY][targetX] = targetTile.transformsToOnUnlock || FLOOR_TILE_ID;
        this.gridMutatedByMove = true;
        AudioManager.playSfx('door');
        this.emitVisual('unlock', targetX, targetY, targetTile.colorKey || 'yellow');
      } else {
        if (!fromSlide) AudioManager.playSfx('blocked');
        return false;
      }
    }

    const updatedTargetTile = ConfigRegistry.getTile(this.terrain[targetY][targetX]);
    if (!this.canPlayerEnter(updatedTargetTile)) {
      // A barrier against an item the player carries: solid until the item is dropped elsewhere.
      if (updatedTargetTile.passableByPlayer) this.statusBannerKey = 'hud.messages.forbidden_item';
      if (!fromSlide) AudioManager.playSfx('blocked');
      return false;
    }

    const entityAtTarget = this.getEntityAt(targetX, targetY);
    if (entityAtTarget) {
      if (entityAtTarget.kind === 'block') {
        const pushed = this.attemptPushBlock(entityAtTarget, dir);
        if (!pushed) {
          if (!fromSlide) AudioManager.playSfx('blocked');
          return false;
        }
      } else if (entityAtTarget.kind === 'monster') {
        this.leaveCell(this.player.x, this.player.y);
        this.player.x = targetX;
        this.player.y = targetY;
        this.killPlayer('hud.messages.death_monster', 'death');
        return true;
      }
    }

    this.leaveCell(this.player.x, this.player.y);
    this.player.x = targetX;
    this.player.y = targetY;
    this.statusBannerKey = null;

    if (!fromSlide) {
      AudioManager.playSfx('step');
    }

    this.resolvePlayerArrival(dir, true);
    return true;
  }

  /**
   * Whether the player may stand on a tile: it must be passable and must not
   * bar an item they carry. Walking and teleporting share this rule.
   */
  private canPlayerEnter(tile: TileDefinition): boolean {
    if (!tile.passableByPlayer) return false;
    return !(tile.forbiddenItem && this.holdsItem(tile.forbiddenItem));
  }

  /** Applies the terrain change, if any, of a cell the player or a block has just left. */
  private leaveCell(x: number, y: number): void {
    const tile = ConfigRegistry.getTile(this.terrain[y][x]);
    if (tile.transformsToOnLeave) {
      this.terrain[y][x] = tile.transformsToOnLeave;
    }
  }

  /**
   * Applies the effects of the cell the player just entered. A teleporter is
   * resolved first: the player jumps, then the arrival cell (items, thief,
   * buttons, hazards, exit) is resolved at the destination coordinates.
   */
  private resolvePlayerArrival(entryDir: Direction, allowTeleport: boolean): void {
    const x = this.player.x;
    const y = this.player.y;
    let tile = ConfigRegistry.getTile(this.terrain[y][x]);

    if (tile.isTeleporter && allowTeleport) {
      this.emitVisual('teleport', x, y);
      if (this.teleportPlayer(x, y, entryDir)) {
        this.emitVisual('teleport', this.player.x, this.player.y);
        this.resolvePlayerArrival(this.player.dir, false);
        return;
      }
    }

    if (tile.transformsToOnStep) {
      this.terrain[y][x] = tile.transformsToOnStep;
      tile = ConfigRegistry.getTile(this.terrain[y][x]);
    }

    const itemId = this.items[y][x];
    if (itemId) {
      const itemDef = ConfigRegistry.getTile(itemId);
      if (itemDef.hazard === 'bomb') {
        this.items[y][x] = null;
        this.emitVisual('explosion', x, y, 'red');
        this.killPlayer('hud.messages.death_bomb', 'bomb');
        return;
      }
      if (itemDef.collectible === 'chip') {
        this.items[y][x] = null;
        this.chipsRemaining = Math.max(0, this.chipsRemaining - 1);
        AudioManager.playSfx('chip');
        this.emitVisual('chip', x, y, 'green');
      } else if (itemDef.collectible === 'key') {
        this.items[y][x] = null;
        this.player.keys[itemId] = (this.player.keys[itemId] || 0) + 1;
        AudioManager.playSfx('item');
        this.emitVisual('item', x, y, itemDef.colorKey || 'yellow');
      } else if (itemDef.collectible === 'boot') {
        this.items[y][x] = null;
        this.player.boots.add(itemId);
        AudioManager.playSfx('item');
        this.emitVisual('item', x, y, 'blue');
      } else if (itemDef.collectible === 'bonus') {
        this.items[y][x] = null;
        this.collectBonus(itemDef);
        AudioManager.playSfx('item');
        this.emitVisual('item', x, y, itemDef.colorKey || 'yellow');
      }
    }

    if (tile.stealsBoots && this.player.boots.size > 0) {
      this.player.boots.clear();
      this.statusBannerKey = 'hud.messages.thief_stole';
      AudioManager.playSfx('thief');
    }

    if (tile.stealsKeys && Object.values(this.player.keys).some((count) => count > 0)) {
      this.player.keys = {};
      this.statusBannerKey = 'hud.messages.thief_stole_keys';
      AudioManager.playSfx('thief');
    }

    if (tile.buttonAction) {
      this.triggerButton(x, y, tile.buttonAction);
      if (!this.player.alive) return;
    }

    this.player.inWater = tile.hazard === 'water';
    if (tile.hazard === 'water' && (!tile.protectedByItem || !this.player.boots.has(tile.protectedByItem))) {
      this.emitVisual('splash', x, y);
      this.killPlayer('hud.messages.death_water', 'splash');
      return;
    }
    if (tile.hazard === 'fire' && (!tile.protectedByItem || !this.player.boots.has(tile.protectedByItem))) {
      this.emitVisual('explosion', x, y);
      this.killPlayer('hud.messages.death_fire', 'burn');
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
      this.levelBonusPoints += itemDef.scoreBonus;
      this.statusBannerKey = 'hud.messages.score_bonus_picked';
    }
    if (itemDef.scoreMultiplier) {
      this.levelScoreMultiplier *= itemDef.scoreMultiplier;
      this.statusBannerKey = 'hud.messages.score_multiplier_picked';
    }
    if (itemDef.timeBonusSeconds) {
      if (this.level.timeLimitSeconds > 0) {
        this.extraTimeSeconds += itemDef.timeBonusSeconds;
      }
      this.statusBannerKey =
        itemDef.timeBonusSeconds > 0 ? 'hud.messages.time_bonus_picked' : 'hud.messages.time_penalty_picked';
    }
  }

  private evaluatePlayerSliding(tile: ReturnType<typeof ConfigRegistry.getTile>, entryDir: Direction): void {
    if (tile.slideType === 'ice') {
      if (tile.protectedByItem && this.player.boots.has(tile.protectedByItem)) {
        this.player.isSliding = false;
        this.player.slideDir = null;
        return;
      }
      const nextDir = tile.deflectionMap?.[entryDir] || entryDir;
      this.player.isSliding = true;
      this.player.slideDir = nextDir;
      this.player.dir = nextDir;
      this.player.slideCooldown = ConfigRegistry.getGame().timing.slideCooldownTicks;
      return;
    }

    if (tile.slideType === 'force') {
      if (tile.protectedByItem && this.player.boots.has(tile.protectedByItem)) {
        this.player.isSliding = false;
        this.player.slideDir = null;
        return;
      }
      let forceDir: Direction = entryDir;
      if (tile.forceDirection === 'RANDOM') {
        forceDir = ORDERED_DIRECTIONS[this.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)];
      } else if (tile.forceDirection) {
        forceDir = tile.forceDirection;
      }
      this.player.isSliding = true;
      this.player.slideDir = forceDir;
      this.player.dir = forceDir;
      this.player.slideCooldown =
        ConfigRegistry.getGame().timing.slideCooldownTicks + FORCE_SLIDE_EXTRA_COOLDOWN_TICKS;
      return;
    }

    this.player.isSliding = false;
    this.player.slideDir = null;
  }

  private processPlayerSlideStep(): void {
    const dir = this.player.slideDir || this.player.dir;
    const currentTile = ConfigRegistry.getTile(this.terrain[this.player.y][this.player.x]);

    const moved = this.executePlayerMove(dir, true);
    if (!moved) {
      if (currentTile.slideType === 'ice') {
        const bounceDir = OPPOSITE_DIRECTION[dir];
        const deflectedBounce = currentTile.deflectionMap?.[bounceDir] || bounceDir;
        this.player.slideDir = deflectedBounce;
        this.player.dir = deflectedBounce;
        const bouncedMoved = this.executePlayerMove(deflectedBounce, true);
        if (!bouncedMoved) {
          this.player.isSliding = false;
          this.player.slideDir = null;
        }
      } else {
        this.player.isSliding = false;
        this.player.slideDir = null;
      }
    }
  }

  private attemptPushBlock(block: RuntimeEntity, dir: Direction): boolean {
    if (this.isCellClosedTrap(block.x, block.y)) {
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
    if (!this.isInBounds(destX, destY)) return false;
    if (this.isEdgeBlocked(block.x, block.y, destX, destY, dir)) return false;

    const destTile = ConfigRegistry.getTile(this.terrain[destY][destX]);
    if (!destTile.passableByBlock) return false;

    const existingEntity = this.getEntityAt(destX, destY);
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
      this.leaveCell(block.x, block.y);
    }
    block.x = destX;
    block.y = destY;
    block.dir = dir;

    const blockDef = ConfigRegistry.getEntityDef(block.type);
    const tileId = this.terrain[destY][destX];
    const tile = ConfigRegistry.getTile(tileId);
    const itemId = this.items[destY][destX];

    if (this.player.x === destX && this.player.y === destY && this.player.alive) {
      this.killPlayer('hud.messages.death_block', 'death');
      return;
    }

    if (itemId && ConfigRegistry.getTile(itemId).hazard === 'bomb' && blockDef?.destroyedByBomb) {
      this.items[destY][destX] = null;
      this.removeEntity(block.uid);
      AudioManager.playSfx('bomb');
      this.emitVisual('explosion', destX, destY);
      return;
    }

    if (tile.hazard === 'water') {
      this.terrain[destY][destX] = blockDef?.waterTransformsTo || tile.blockTransformsTo || SUNK_BLOCK_TILE_ID;
      this.removeEntity(block.uid);
      AudioManager.playSfx('splash');
      this.emitVisual('splash', destX, destY);
      return;
    }

    if (tile.hazard === 'fire' && blockDef?.destroyedByFire) {
      if (blockDef.meltsInFireTo) {
        this.terrain[destY][destX] = blockDef.meltsInFireTo;
      }
      this.removeEntity(block.uid);
      AudioManager.playSfx('burn');
      return;
    }

    if (tile.buttonAction) {
      this.triggerButton(destX, destY, tile.buttonAction);
    }

    // A jump resolves the arrival (and the sliding state) at the exit itself.
    if (tile.isTeleporter && allowTeleport && this.teleportEntity(block, destX, destY, dir)) {
      return;
    }

    const updatedTile = ConfigRegistry.getTile(this.terrain[block.y][block.x]);
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
    this.removedUids.clear();
    const snapshotEntities = [...this.entities];
    for (const entity of snapshotEntities) {
      if (this.removedUids.has(entity.uid)) continue;

      // Entities sitting directly on a clone machine act as templates and do not move on their own
      if (ConfigRegistry.getTile(this.terrain[entity.y]?.[entity.x]).isCloneMachine) {
        continue;
      }

      if (entity.kind === 'block') {
        if (!entity.isSliding) continue;
        if (entity.cooldownTicks > 0) {
          entity.cooldownTicks--;
          continue;
        }
        const tile = ConfigRegistry.getTile(this.terrain[entity.y][entity.x]);
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

      if (this.isCellClosedTrap(entity.x, entity.y)) {
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

    if (this.player.x === nx && this.player.y === ny && this.player.alive) {
      this.killPlayer('hud.messages.death_monster', 'death');
      return false;
    }

    const destTile = ConfigRegistry.getTile(this.terrain[ny][nx]);
    const destItem = this.items[ny][nx];

    if (destItem && ConfigRegistry.getTile(destItem).hazard === 'bomb') {
      this.items[ny][nx] = null;
      this.removeEntity(entity.uid);
      AudioManager.playSfx('bomb');
      return true;
    }

    if (destTile.hazard === 'water' && !def?.immuneToWater) {
      this.removeEntity(entity.uid);
      AudioManager.playSfx('splash');
      return true;
    }
    if (destTile.hazard === 'fire' && !def?.immuneToFire) {
      this.removeEntity(entity.uid);
      AudioManager.playSfx('burn');
      return true;
    }

    if (destTile.buttonAction) {
      this.triggerButton(nx, ny, destTile.buttonAction);
    }

    if (destTile.isTeleporter && allowTeleport) {
      return this.teleportEntity(entity, nx, ny, entity.dir) ? this.resolveMonsterArrival(entity, false) : true;
    }
    return true;
  }

  private chooseMonsterDirection(monster: RuntimeEntity): Direction | null {
    const def = ConfigRegistry.getEntityDef(monster.type);
    if (!def) return null;

    const currentTile = ConfigRegistry.getTile(this.terrain[monster.y][monster.x]);
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
          ? ORDERED_DIRECTIONS[this.rng.nextInt(0, ORDERED_DIRECTIONS.length - 1)]
          : currentTile.forceDirection;
      return this.canMonsterEnter(monster, forceDir) ? forceDir : null;
    }

    if (def.movementPattern === 'chase_player') {
      const dx = this.player.x - monster.x;
      const dy = this.player.y - monster.y;
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
      this.rng.shuffle(turns);
      for (const turn of turns) {
        const d = this.applyRelativeTurn(monster.dir, turn);
        if (this.canMonsterEnter(monster, d)) return d;
      }
      return null;
    }

    if (def.movementPattern === 'pure_random') {
      const dirs: Direction[] = [...ORDERED_DIRECTIONS];
      this.rng.shuffle(dirs);
      for (const d of dirs) {
        if (this.canMonsterEnter(monster, d)) return d;
      }
      return null;
    }

    const turnOrder = def.turnOrder || ['FORWARD'];
    for (const rel of turnOrder) {
      const candidateDir = this.applyRelativeTurn(monster.dir, rel);
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
    if (!this.isInBounds(nx, ny)) return false;
    if (this.isEdgeBlocked(monster.x, monster.y, nx, ny, dir)) return false;

    const destTile = ConfigRegistry.getTile(this.terrain[ny][nx]);
    const def = ConfigRegistry.getEntityDef(monster.type);

    if (!destTile.passableByMonster && !(destTile.hazard === 'fire' && def?.immuneToFire)) {
      return false;
    }
    if (destTile.hazard === 'fire' && def?.avoidsFire) return false;

    const itemId = this.items[ny][nx];
    if (itemId && ConfigRegistry.getTile(itemId).hazard !== 'bomb') {
      return false;
    }

    const existing = this.getEntityAt(nx, ny);
    if (existing) return false;

    return true;
  }

  private triggerButton(bx: number, by: number, action: ButtonAction): void {
    AudioManager.playSfx('button');

    if (action === 'toggle_walls') {
      this.swapTerrain((tile) => tile.togglesTo);
    } else if (action === 'toggle_flames') {
      this.swapTerrain((tile) => tile.flameTogglesTo);
      this.burnPlayerIfFlamesLit();
      this.burnEntitiesOnFire();
    } else if (action === 'reverse_tanks') {
      for (const ent of this.entities) {
        if (ConfigRegistry.getEntityDef(ent.type)?.reversedByButton) {
          ent.dir = OPPOSITE_DIRECTION[ent.dir];
        }
      }
    } else if (action === 'trigger_cloner') {
      const links = this.cloneLinks.filter((l) => l.buttonX === bx && l.buttonY === by);
      if (links.length > 0) {
        for (const link of links) {
          this.spawnFromCloner(link.clonerX, link.clonerY, link.templateType, link.templateDir);
        }
      } else {
        // Fallback: trigger any clone machine that has an entity template sitting on it
        for (const ent of [...this.entities]) {
          if (ConfigRegistry.getTile(this.terrain[ent.y]?.[ent.x]).isCloneMachine) {
            this.spawnFromCloner(ent.x, ent.y, ent.type, ent.dir);
          }
        }
      }
    }
  }

  /** Replaces every tile for which `target` names a terrain by that terrain. */
  private swapTerrain(target: (tile: TileDefinition) => string | undefined): void {
    for (let y = 0; y < this.terrain.length; y++) {
      for (let x = 0; x < this.terrain[y].length; x++) {
        const next = target(ConfigRegistry.getTile(this.terrain[y][x]));
        if (next) {
          this.terrain[y][x] = next;
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
    for (const entity of [...this.entities]) {
      const tile = ConfigRegistry.getTile(this.terrain[entity.y][entity.x]);
      if (tile.hazard !== 'fire') continue;
      const def = ConfigRegistry.getEntityDef(entity.type);
      if (entity.kind === 'block') {
        if (!def?.destroyedByFire) continue;
        if (def.meltsInFireTo) {
          this.terrain[entity.y][entity.x] = def.meltsInFireTo;
        }
      } else if (def?.immuneToFire) {
        continue;
      }
      this.removeEntity(entity.uid);
      AudioManager.playSfx('burn');
      this.emitVisual('explosion', entity.x, entity.y);
    }
  }

  /** A flame jet lit under the player (a monster or block pressed the button) burns them. */
  private burnPlayerIfFlamesLit(): void {
    if (!this.player.alive) return;
    const tile = ConfigRegistry.getTile(this.terrain[this.player.y][this.player.x]);
    if (tile.hazard === 'fire' && (!tile.protectedByItem || !this.player.boots.has(tile.protectedByItem))) {
      this.emitVisual('explosion', this.player.x, this.player.y);
      this.killPlayer('hud.messages.death_fire', 'burn');
    }
  }

  /**
   * Spawns a copy of the template in front of the cloner, using the same
   * entry rules as a regular monster step or block push, so a clone never
   * appears inside a wall or another blocked cell.
   */
  private spawnFromCloner(
    clonerX: number,
    clonerY: number,
    templateType: string,
    templateDir: Direction
  ): void {
    if (this.entities.length >= MAX_ACTIVE_ENTITIES) return;

    const vec = DIRECTION_VECTORS[templateDir];
    const spawnX = clonerX + vec.dx;
    const spawnY = clonerY + vec.dy;
    if (!this.isInBounds(spawnX, spawnY)) return;
    if (this.player.x === spawnX && this.player.y === spawnY) return;

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
    if (!canEnter) return;

    const spawned: RuntimeEntity = {
      uid: this.nextEntityUid++,
      type: templateType,
      kind,
      x: spawnX,
      y: spawnY,
      dir: templateDir,
      cooldownTicks: def?.moveIntervalTicks || DEFAULT_MONSTER_MOVE_INTERVAL_TICKS,
      isSliding: kind === 'block'
    };
    this.entities.push(spawned);
    if (spawned.kind === 'block') {
      this.moveBlockTo(spawned, spawnX, spawnY, templateDir);
    } else {
      this.resolveMonsterArrival(spawned, true);
    }
  }

  public isCellClosedTrap(tx: number, ty: number): boolean {
    const tile = ConfigRegistry.getTile(this.terrain[ty]?.[tx]);
    if (!tile.isTrap) return false;

    const specificLinks = this.trapLinksByTrap.get(this.cellKey(tx, ty));
    if (specificLinks && specificLinks.length > 0) {
      return !specificLinks.some((l) => this.isButtonPressed(l.buttonX, l.buttonY));
    }

    // Unlinked trap: any held trap button releases it
    return !this.holdTrapButtons.some((b) => this.isButtonPressed(b.x, b.y));
  }

  private isButtonPressed(bx: number, by: number): boolean {
    if (this.player.x === bx && this.player.y === by) return true;
    return this.entities.some((e) => e.x === bx && e.y === by);
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
        if (this.isInBounds(exitX, exitY)) {
          const exitTile = ConfigRegistry.getTile(this.terrain[exitY][exitX]);
          if (
            this.canPlayerEnter(exitTile) &&
            !this.getEntityAt(exitX, exitY) &&
            !this.isEdgeBlocked(candidate.x, candidate.y, exitX, exitY, tryDir)
          ) {
            AudioManager.playSfx('teleport');
            this.player.x = exitX;
            this.player.y = exitY;
            this.player.dir = tryDir;
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

  private killPlayer(reasonKey: string, sfxId: string): void {
    this.player.alive = false;
    this.player.isSliding = false;
    this.player.deathReasonKey = reasonKey;
    this.emitVisual('explosion', this.player.x, this.player.y, 'red');
    AudioManager.playSfx(sfxId);
  }

  private completeLevel(): void {
    this.levelCompleted = true;
    this.player.isSliding = false;
    const timing = ConfigRegistry.getGame().timing;
    const timeRemaining = this.getTimeRemainingSeconds();
    this.lastTimeBonus = timeRemaining * timing.timeBonusMultiplier;
    this.lastLevelScore =
      (timing.levelBasePoints * this.level.number + this.lastTimeBonus + this.levelBonusPoints) *
      this.levelScoreMultiplier;
    this.totalScore += this.lastLevelScore;
    AudioManager.playSfx('win');
    if (this.onWinCallback) {
      this.onWinCallback(
        this.level.id,
        timeRemaining,
        this.stepsCount,
        this.lastLevelScore,
        [...this.moveHistory]
      );
    }
  }

  private getEntityAt(x: number, y: number): RuntimeEntity | undefined {
    return this.entities.find((e) => e.x === x && e.y === y);
  }

  private removeEntity(uid: number): void {
    this.entities = this.entities.filter((e) => e.uid !== uid);
    this.removedUids.add(uid);
  }

  private cellKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  /** Width of the loaded level, in cells; levels set their own size. */
  public getMapWidth(): number {
    return this.terrain[0]?.length ?? 0;
  }

  /** Height of the loaded level, in cells. */
  public getMapHeight(): number {
    return this.terrain.length;
  }

  private isInBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.getMapWidth() && y >= 0 && y < this.getMapHeight();
  }

  private applyRelativeTurn(dir: Direction, turn: RelativeTurn): Direction {
    const idx = ORDERED_DIRECTIONS.indexOf(dir);
    const count = ORDERED_DIRECTIONS.length;
    switch (turn) {
      case 'FORWARD':
        return dir;
      case 'RIGHT':
        return ORDERED_DIRECTIONS[(idx + 1) % count];
      case 'BACK':
        return ORDERED_DIRECTIONS[(idx + 2) % count];
      case 'LEFT':
        return ORDERED_DIRECTIONS[(idx + 3) % count];
    }
  }
}
