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
  CloneLink,
  CompiledLevel,
  Direction,
  PlayerState,
  RelativeTurn,
  RuntimeEntity,
  TrapLink,
  UndoSnapshot
} from './types';

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
  private totalScore: number = 0;
  private lastLevelScore: number = 0;
  private lastTimeBonus: number = 0;
  private levelCompleted: boolean = false;
  private paused: boolean = false;
  private statusBannerKey: string | null = null;
  private nextEntityUid: number = 1;
  private undoStack: UndoSnapshot[] = [];
  private moveHistory: Direction[] = [];
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

  public loadLevel(level: CompiledLevel): void {
    this.level = level;
    this.terrain = level.terrain.map((row) => [...row]);
    this.items = level.items.map((row) => [...row]);
    this.trapLinks = level.trapLinks.map((l) => ({ ...l }));
    this.cloneLinks = level.cloneLinks.map((l) => ({ ...l }));
    this.nextEntityUid = 1;

    this.entities = level.entities.map((e) => {
      const def = ConfigRegistry.getEntityDef(e.type);
      return {
        uid: this.nextEntityUid++,
        type: e.type,
        kind: def?.kind || 'monster',
        x: e.x,
        y: e.y,
        dir: e.dir,
        cooldownTicks: def?.moveIntervalTicks || 4,
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
    this.lastLevelScore = 0;
    this.lastTimeBonus = 0;
    this.levelCompleted = false;
    this.paused = false;
    this.statusBannerKey = null;
    this.undoStack = [];
    this.moveHistory = [];
  }

  public getMoveHistory(): Direction[] {
    return [...this.moveHistory];
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
    return Math.max(0, this.level.timeLimitSeconds - elapsedSec);
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

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public saveUndoSnapshot(): void {
    const maxSnapshots = ConfigRegistry.getGame().timing.maxUndoSnapshots;
    if (this.undoStack.length >= maxSnapshots) {
      this.undoStack.shift();
    }
    this.undoStack.push({
      terrain: this.terrain.map((r) => [...r]),
      items: this.items.map((r) => [...r]),
      entities: this.entities.map((e) => ({ ...e })),
      player: {
        x: this.player.x,
        y: this.player.y,
        dir: this.player.dir,
        isSliding: this.player.isSliding,
        slideDir: this.player.slideDir,
        inWater: this.player.inWater,
        keys: { ...this.player.keys },
        boots: Array.from(this.player.boots)
      },
      chipsRemaining: this.chipsRemaining,
      ticksElapsed: this.ticksElapsed,
      stepsCount: this.stepsCount,
      moveHistoryLength: this.moveHistory.length
    });
  }

  public undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;

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
      moveCooldown: 0,
      slideCooldown: 0,
      inWater: snap.player.inWater,
      keys: { ...snap.player.keys },
      boots: new Set(snap.player.boots)
    };
    this.chipsRemaining = snap.chipsRemaining;
    this.ticksElapsed = snap.ticksElapsed;
    this.stepsCount = snap.stepsCount;
    this.moveHistory.length = snap.moveHistoryLength;
    this.levelCompleted = false;
    this.statusBannerKey = null;
    AudioManager.playSfx('step');
    return true;
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
      if (activeForceDir && dir === this.getOppositeDirection(activeForceDir)) {
        AudioManager.playSfx('blocked');
        return false;
      }
    }

    if (this.isCellClosedTrap(this.player.x, this.player.y)) {
      this.player.dir = dir;
      AudioManager.playSfx('blocked');
      return false;
    }

    this.saveUndoSnapshot();
    const moved = this.executePlayerMove(dir, false);
    if (moved) {
      this.stepsCount++;
      this.moveHistory.push(dir);
      const destTile = ConfigRegistry.getTile(this.terrain[this.player.y][this.player.x]);
      this.player.moveCooldown =
        destTile.slideType === 'force'
          ? 1
          : ConfigRegistry.getGame().timing.playerMoveCooldownTicks;
    } else {
      this.undoStack.pop();
    }
    return moved;
  }

  private isEdgeBlocked(fromX: number, fromY: number, toX: number, toY: number, dir: Direction): boolean {
    const currentTile = ConfigRegistry.getTile(this.terrain[fromY][fromX]);
    const targetTile = ConfigRegistry.getTile(this.terrain[toY][toX]);
    const opposite = this.getOppositeDirection(dir);

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
      AudioManager.playSfx('blocked');
      return false;
    }

    if (targetTile.requiresAllChips) {
      if (this.chipsRemaining <= 0) {
        this.terrain[targetY][targetX] = targetTile.transformsToOnUnlock || 'floor';
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
        this.terrain[targetY][targetX] = 'floor';
        AudioManager.playSfx('door');
        this.emitVisual('unlock', targetX, targetY, targetTile.colorKey || 'yellow');
      } else {
        if (!fromSlide) AudioManager.playSfx('blocked');
        return false;
      }
    }

    const updatedTargetTile = ConfigRegistry.getTile(this.terrain[targetY][targetX]);
    if (!updatedTargetTile.passableByPlayer) {
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
        this.player.x = targetX;
        this.player.y = targetY;
        this.killPlayer('hud.messages.death_monster', 'death');
        return true;
      }
    }

    this.player.x = targetX;
    this.player.y = targetY;
    this.statusBannerKey = null;

    if (!fromSlide) {
      AudioManager.playSfx('step');
    }

    this.resolvePlayerArrival(dir);
    return true;
  }

  private resolvePlayerArrival(entryDir: Direction): void {
    const x = this.player.x;
    const y = this.player.y;
    let tileId = this.terrain[y][x];
    let tile = ConfigRegistry.getTile(tileId);

    if (tile.transformsToOnStep) {
      this.terrain[y][x] = tile.transformsToOnStep;
      tileId = this.terrain[y][x];
      tile = ConfigRegistry.getTile(tileId);
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
      }
    }

    if (tile.stealsBoots && this.player.boots.size > 0) {
      this.player.boots.clear();
      this.statusBannerKey = 'hud.messages.thief_stole';
      AudioManager.playSfx('thief');
    }

    if (tile.buttonAction) {
      this.triggerButton(x, y, tile.buttonAction);
    }

    if (tile.isTeleporter) {
      this.emitVisual('teleport', x, y);
      this.teleportPlayer(x, y, entryDir);
      this.emitVisual('teleport', this.player.x, this.player.y);
      tileId = this.terrain[this.player.y][this.player.x];
      tile = ConfigRegistry.getTile(tileId);
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
        forceDir = ORDERED_DIRECTIONS[Math.floor(Math.random() * ORDERED_DIRECTIONS.length)];
      } else if (tile.forceDirection) {
        forceDir = tile.forceDirection;
      }
      this.player.isSliding = true;
      this.player.slideDir = forceDir;
      this.player.dir = forceDir;
      this.player.slideCooldown = ConfigRegistry.getGame().timing.slideCooldownTicks + 1;
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
        const bounceDir = this.getOppositeDirection(dir);
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

  private moveBlockTo(block: RuntimeEntity, destX: number, destY: number, dir: Direction): void {
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

    if (itemId && ConfigRegistry.getTile(itemId).hazard === 'bomb') {
      this.items[destY][destX] = null;
      this.removeEntity(block.uid);
      AudioManager.playSfx('bomb');
      this.emitVisual('explosion', destX, destY);
      return;
    }

    if (tile.hazard === 'water') {
      this.terrain[destY][destX] = blockDef?.waterTransformsTo || tile.blockTransformsTo || 'dirt';
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

    if (tile.isTeleporter) {
      this.teleportEntity(block, destX, destY, dir);
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
    const snapshotEntities = [...this.entities];
    for (const entity of snapshotEntities) {
      if (!this.entities.some((e) => e.uid === entity.uid)) continue;

      // Entities sitting directly on a clone_machine act as templates and do not move on their own
      if (this.terrain[entity.y]?.[entity.x] === 'clone_machine') {
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
          const bounceDir = this.getOppositeDirection(slideDir);
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
      entity.cooldownTicks = def?.moveIntervalTicks || 5;

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

      if (this.player.x === nx && this.player.y === ny && this.player.alive) {
        this.killPlayer('hud.messages.death_monster', 'death');
        return;
      }

      const destTile = ConfigRegistry.getTile(this.terrain[ny][nx]);
      const destItem = this.items[ny][nx];

      if (destItem && ConfigRegistry.getTile(destItem).hazard === 'bomb') {
        this.items[ny][nx] = null;
        this.removeEntity(entity.uid);
        AudioManager.playSfx('bomb');
        continue;
      }

      if (destTile.hazard === 'water' && !def?.immuneToWater) {
        this.removeEntity(entity.uid);
        AudioManager.playSfx('splash');
        continue;
      }
      if (destTile.hazard === 'fire' && !def?.immuneToFire) {
        this.removeEntity(entity.uid);
        AudioManager.playSfx('burn');
        continue;
      }

      if (destTile.buttonAction) {
        this.triggerButton(nx, ny, destTile.buttonAction);
      }

      if (destTile.isTeleporter) {
        this.teleportEntity(entity, nx, ny, chosenDir);
      }
    }
  }

  private chooseMonsterDirection(monster: RuntimeEntity): Direction | null {
    const def = ConfigRegistry.getEntityDef(monster.type);
    if (!def) return null;

    const currentTile = ConfigRegistry.getTile(this.terrain[monster.y][monster.x]);
    if (currentTile.slideType === 'ice') {
      const slideDir = currentTile.deflectionMap?.[monster.dir] || monster.dir;
      if (this.canMonsterEnter(monster, slideDir)) return slideDir;
      const bounce = this.getOppositeDirection(slideDir);
      if (this.canMonsterEnter(monster, bounce)) return bounce;
      return null;
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
      this.shuffleArray(turns);
      for (const turn of turns) {
        const d = this.applyRelativeTurn(monster.dir, turn);
        if (this.canMonsterEnter(monster, d)) return d;
      }
      return null;
    }

    if (def.movementPattern === 'pure_random') {
      const dirs: Direction[] = [...ORDERED_DIRECTIONS];
      this.shuffleArray(dirs);
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

  private triggerButton(
    bx: number,
    by: number,
    action: 'toggle_walls' | 'reverse_tanks' | 'hold_trap' | 'trigger_cloner'
  ): void {
    AudioManager.playSfx('button');
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;

    if (action === 'toggle_walls') {
      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          const tile = ConfigRegistry.getTile(this.terrain[y][x]);
          if (tile.togglesTo) {
            this.terrain[y][x] = tile.togglesTo;
          }
        }
      }
    } else if (action === 'reverse_tanks') {
      for (const ent of this.entities) {
        if (ent.type === 'tank') {
          ent.dir = this.getOppositeDirection(ent.dir);
        }
      }
    } else if (action === 'trigger_cloner') {
      const links = this.cloneLinks.filter((l) => l.buttonX === bx && l.buttonY === by);
      if (links.length > 0) {
        for (const link of links) {
          this.spawnFromCloner(link.clonerX, link.clonerY, link.templateType, link.templateDir);
        }
      } else {
        // Fallback: trigger any clone_machine that has an entity template sitting on it
        for (const ent of [...this.entities]) {
          if (this.terrain[ent.y]?.[ent.x] === 'clone_machine') {
            this.spawnFromCloner(ent.x, ent.y, ent.type, ent.dir);
          }
        }
      }
    }
  }

  private spawnFromCloner(
    clonerX: number,
    clonerY: number,
    templateType: string,
    templateDir: Direction
  ): void {
    const vec = DIRECTION_VECTORS[templateDir];
    const spawnX = clonerX + vec.dx;
    const spawnY = clonerY + vec.dy;
    if (!this.isInBounds(spawnX, spawnY)) return;
    if (this.getEntityAt(spawnX, spawnY)) return;
    if (this.player.x === spawnX && this.player.y === spawnY) return;

    const def = ConfigRegistry.getEntityDef(templateType);
    const spawned: RuntimeEntity = {
      uid: this.nextEntityUid++,
      type: templateType,
      kind: def?.kind || 'block',
      x: spawnX,
      y: spawnY,
      dir: templateDir,
      cooldownTicks: def?.moveIntervalTicks || 4,
      isSliding: def?.kind === 'block'
    };
    this.entities.push(spawned);
    if (spawned.kind === 'block') {
      this.moveBlockTo(spawned, spawnX, spawnY, templateDir);
    }
  }

  public isCellClosedTrap(tx: number, ty: number): boolean {
    const tile = ConfigRegistry.getTile(this.terrain[ty]?.[tx]);
    if (!tile.isTrap) return false;

    const specificLinks = this.trapLinks.filter((l) => l.trapX === tx && l.trapY === ty);
    if (specificLinks.length > 0) {
      return !specificLinks.some((l) => this.isButtonPressed(l.buttonX, l.buttonY));
    }

    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        if (this.terrain[y][x] === 'button_brown' && this.isButtonPressed(x, y)) {
          return false;
        }
      }
    }
    return true;
  }

  private isButtonPressed(bx: number, by: number): boolean {
    if (this.player.x === bx && this.player.y === by) return true;
    return this.entities.some((e) => e.x === bx && e.y === by);
  }

  private teleportPlayer(fromX: number, fromY: number, dir: Direction): void {
    const teleporters = this.getAllTeleporters();
    if (teleporters.length <= 1) return;

    const startIdx = teleporters.findIndex((t) => t.x === fromX && t.y === fromY);
    if (startIdx < 0) return;

    AudioManager.playSfx('teleport');
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
          if (exitTile.passableByPlayer && !this.getEntityAt(exitX, exitY)) {
            if (exitTile.transformsToOnStep) {
              this.terrain[exitY][exitX] = exitTile.transformsToOnStep;
            }
            this.player.x = exitX;
            this.player.y = exitY;
            this.player.dir = tryDir;
            return;
          }
        }
      }
    }
  }

  private teleportEntity(entity: RuntimeEntity, fromX: number, fromY: number, dir: Direction): void {
    const teleporters = this.getAllTeleporters();
    if (teleporters.length <= 1) return;

    const startIdx = teleporters.findIndex((t) => t.x === fromX && t.y === fromY);
    if (startIdx < 0) return;

    const vec = DIRECTION_VECTORS[dir];
    for (let i = 1; i <= teleporters.length; i++) {
      const idx = (startIdx - i + teleporters.length) % teleporters.length;
      const candidate = teleporters[idx];
      const exitX = candidate.x + vec.dx;
      const exitY = candidate.y + vec.dy;
      if (this.isInBounds(exitX, exitY)) {
        const exitTile = ConfigRegistry.getTile(this.terrain[exitY][exitX]);
        if (exitTile.passableByMonster && !this.getEntityAt(exitX, exitY)) {
          entity.x = exitX;
          entity.y = exitY;
          return;
        }
      }
    }
  }

  private getAllTeleporters(): Array<{ x: number; y: number }> {
    const list: Array<{ x: number; y: number }> = [];
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        if (ConfigRegistry.getTile(this.terrain[y][x]).isTeleporter) {
          list.push({ x, y });
        }
      }
    }
    return list;
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
    this.lastLevelScore = timing.levelBasePoints * this.level.number + this.lastTimeBonus;
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
  }

  private isInBounds(x: number, y: number): boolean {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    return x >= 0 && x < mapWidth && y >= 0 && y < mapHeight;
  }

  private getOppositeDirection(dir: Direction): Direction {
    switch (dir) {
      case 'N':
        return 'S';
      case 'S':
        return 'N';
      case 'E':
        return 'W';
      case 'W':
        return 'E';
    }
  }

  private applyRelativeTurn(dir: Direction, turn: RelativeTurn): Direction {
    const idx = ORDERED_DIRECTIONS.indexOf(dir);
    switch (turn) {
      case 'FORWARD':
        return dir;
      case 'RIGHT':
        return ORDERED_DIRECTIONS[(idx + 1) % 4];
      case 'BACK':
        return ORDERED_DIRECTIONS[(idx + 2) % 4];
      case 'LEFT':
        return ORDERED_DIRECTIONS[(idx + 3) % 4];
    }
  }

  private shuffleArray<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}
