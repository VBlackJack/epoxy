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
import { cellEdgeMask } from './EdgeRules';
import { AudioManager } from '../audio/AudioManager';
import { FORCE_CYCLE_ORDER } from '../config/constants';
import {
  BLOCK_TARGET_TILE_ID,
  BRIBE_ITEM_ID,
  CELL_EDGE_BITS,
  CELL_EDGE_CANOPY_BIT,
  CELL_EDGE_SIDE_ORDER,
  FLOOR_TILE_ID,
  OPPOSITE_DIRECTION,
  SPENT_REVEAL_KEY_PREFIX,
  PLAYER_CHARACTER_KEY_PREFIX,
  CC3D_ARRIVAL_KEY_PREFIX,
  CC2_PLAYER_VIEW_KEY_PREFIX,
  CC2_HIDDEN_STATE_KEY_PREFIX,
  PLAYERS_KEY_PREFIX,
  DEFAULT_PLAYER_CHARACTER,
  RAIL_STATE_KEY_PREFIX,
  SWIVEL_ENTRY_KEY_PREFIX,
  TIMER_PAUSE_KEY_PREFIX,
  TOGGLE_PARITY_KEY_PREFIX,
  FORCE_CYCLE_KEY_PREFIX,
  LIT_CHARGE_KEY_PREFIX
} from './coreConstants';
import { countPausedTick } from './epoxy/epoxyCc2Items';
import { railStateKey, railStateOf, restoreRailState } from './epoxy/epoxyRailsCc2';
import { CC2_SPLASH_BLOCK_PASSES } from './epoxy/epoxyBlocks';
import { copyLitCharges, detonateCharges, lightCharge, litChargesStateKey } from './epoxy/epoxyCharges';
import { lightDepartedDynamite, setDownDynamite } from './epoxy/epoxyDynamite';
import { setHoldDoors, setPoweredCells, triggerButton } from './epoxy/epoxyDevices';
import {
  copySignalPulses,
  copySignalState,
  fireSignalSinks,
  counterValuesOf,
  poweredSignalCellsOf,
  restoreSignalPulses,
  settleWorldSignals,
  SIGNAL_PHASE_MOVE,
  SIGNAL_PHASE_TICK,
  signalLinksOf
} from './epoxy/epoxySignals';
import { cloneSignalState, createSignalState } from './epoxy/signalNetwork';
import { updateEntities } from './epoxy/epoxyMonsters';
import { usesCc2Engine } from './epoxy/ccRules';
import { CC2_HORIZONTAL_DIRECTIONS, CC2_MAX_HELD_KEYS, hasOpposingPair, resolveCc2HeldOrder } from './epoxy/cc2HeldInput';
import {
  CC2_FORCE_ENTRY_MOVE_COOLDOWN_TICKS,
  CC2_SLIDE_ENTRY_EXTRA_TICKS,
  FORCE_FLOOR_MOVE_COOLDOWN_TICKS,
  executePlayerMove,
  slapBlockAhead,
  steerMirrorsOnce,
  isCarriedByForceFloor,
  playerWalkCooldown,
  processPlayerSlideStep,
  applyCc3dStepEnd,
  cc2PlayerViewOf,
  recordCc2PlayerView,
  resetCc2PlayerView,
  processTeleportExit,
  softPadOverrideDue,
  takeSoftPadOverride,
  syncToolBelt,
  toolBeltOf,
  usesToolBelt,
  resumeForceCarry,
  tickParkedPlayers
} from './epoxy/epoxyPlayer';
import { startLevelWorld } from './epoxy/epoxyLevelStart';
import { teleportEntity } from './epoxy/epoxyTeleports';
import { refreshBeams, resolveLasers } from './epoxy/epoxyLasers';
import { droppedActorId, launchRollingBall } from './epoxy/epoxyRollingBall';
import { advanceShots, canThrowStone, shotsStateKey, throwStone } from './epoxy/epoxyShots';
import { mergeBeamCells, turnTurrets, turretPhaseKey } from './epoxy/epoxyTurrets';
import {
  EpoxyContext,
  EpoxyVisualKind,
  EpoxyWorld,
  NO_PLAY_START_TICK,
  playerCharacterOf,
  rotatePlayers,
  revealedTerrain,
  canPlayerEnter,
  cc3dArrivalKey,
  cc2PlayerViewKey,
  cc2HiddenStateKey,
  copyCc2PlayerView,
  copyCc3dArrival,
  buildGhostBar,
  blastedEdgeDiff,
  createEpoxyWorld,
  ghostBarEdited,
  getEntityAt,
  holdsItem,
  isCellClosedTrap,
  isCovered,
  killPlayer,
  mapHeight,
  mapWidth,
  rebuildDeviceLookups,
  refreshTrapLatch
} from './epoxy/epoxyWorld';
import {
  BeamCell,
  CloneLink,
  CompiledLevel,
  Direction,
  GridPoint,
  BlockSplash,
  LitCharge,
  PlayerCharacter,
  PlayerState,
  RuntimeEntity,
  Shot,
  SignalLink,
  SignalPulseState,
  SignalState,
  TileDefinition,
  TimedMove,
  TrapLink,
  PlayerSnapshot,
  UndoSnapshot
} from './types';

/** Collectibles held as a count beside the keys: a key colour, a blast charge, a pocket gate and a hurl stone. */
const COUNTED_COLLECTIBLES: ReadonlySet<string> = new Set(['key', 'charge', 'gate', 'stone', 'token']);

/** Pairs of boots needed for the cycle key to change anything. */
const MIN_BOOTS_TO_CYCLE = 2;
/** The order in which CC2 slaps the blocks next to the player when two direction keys are held (Lexy: north, south, west, east). */
const CC2_SLAP_ORDER: readonly Direction[] = ['N', 'S', 'W', 'E'];

/** The panels of a level without cell edges. */
const NO_PANELS: ReadonlyMap<number, readonly Direction[]> = new Map();
/** The canopy cells of a level without a canopy. */
const NO_CANOPIES: ReadonlySet<number> = new Set();

/** Copies an entity for a snapshot: the array fields are copied too, so the live entity and the snapshot never share one. */
export function copyEntity(e: RuntimeEntity): RuntimeEntity {
  const copy = { ...e };
  if (e.heldTools !== undefined) copy.heldTools = [...e.heldTools];
  if (e.heldKeys !== undefined) copy.heldKeys = [...e.heldKeys];
  return copy;
}

export class GameEngine {
  /** The play state of the loaded level, shared with the engine modules. */
  private readonly w: EpoxyWorld = createEpoxyWorld();
  private readonly ctx: EpoxyContext;

  /** The panels built from this mask; rebuilt when a level with other cell edges loads. */
  private panelsMask: Uint8Array | null = null;
  private panelsView: ReadonlyMap<number, readonly Direction[]> = NO_PANELS;
  private canopyView: ReadonlySet<number> = NO_CANOPIES;

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
      teleportEntity: (entity, fromX, fromY, dir, landOnPad) => teleportEntity(this.ctx, entity, fromX, fromY, dir, landOnPad)
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

    startLevelWorld(this.ctx, level, seed);
    this.ticksElapsed = 0;
    this.stepsCount = 0;
    this.lastLevelScore = 0;
    this.lastTimeBonus = 0;
    this.paused = false;
    this.undoStack = [];
    this.moveHistory = [];
    this.timedMoveHistory = [];
  }

  /**
   * Replay option of the CC2 replay check: the random force floors start their shared turn at `dir` (the replay header's force
   * floor start, Lexy game.js:3061-3069). Only a CC2-engine level honours it, and only a call made right after loadLevel; live
   * play keeps the default start.
   */
  public setReplayForceStart(dir: Direction): void {
    if (!usesCc2Engine(this.w.level)) return;
    this.w.forceCycleTurn = FORCE_CYCLE_ORDER.indexOf(dir as (typeof FORCE_CYCLE_ORDER)[number]);
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
  /** Debug: pushes since the level loaded that moved a block other than the one pushed directly (chains, partial ones included). */
  public getChainPushCount(): number {
    return this.w.chainPushCount;
  }

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
   * The shots in flight, in the order they were fired; undefined on a level without shot launchers or hurl stones,
   * so nothing about shots reaches a level that has none. The list is shared: do not mutate it.
   */
  public getShots(): readonly Shot[] | undefined {
    return this.w.hasShots ? this.w.shots : undefined;
  }

  /** The state of the signal network; undefined on a level without one, so nothing about it reaches such a level or its hash. */
  public getSignalState(): SignalState | undefined {
    return copySignalState(this.w);
  }

  /** The pulse memory of the signal network (arrivals not yet read, presses carried); undefined when empty, so nothing about it reaches a level without pulses or its hash. */
  public getSignalPulses(): SignalPulseState | undefined {
    return copySignalPulses(this.w);
  }

  /** The compiled signal links by cell coordinates; undefined on a level without signals. Read only, for drawing. */
  public getSignalLinks(): readonly SignalLink[] | undefined {
    return signalLinksOf(this.w);
  }

  /** The cells (y * width + x) whose signal node is on at the last settle; undefined without signals. Read only, for drawing. */
  public getPoweredSignalCells(): ReadonlySet<number> | undefined {
    return poweredSignalCellsOf(this.w);
  }

  /** The count of each counter gate by cell (y * width + x); undefined without a counter. Read only, for drawing. */
  public getCounterValues(): ReadonlyMap<number, number> | undefined {
    return counterValuesOf(this.w);
  }

  /** Sink edges the signal network has reported since the level loaded; a diagnostic, undefined without signals. */
  public getSignalEdgeCounts(): { rising: number; falling: number } | undefined {
    return this.w.signals === undefined ? undefined : { ...this.w.signals.edgeCounts };
  }

  /**
   * The parity of the toggle presses, one bit per toggle family that hides a toggle wall or flame jet under a removable top;
   * undefined on a level that hides none, so nothing about it reaches a level without one.
   */
  public getToggleParity(): number | undefined {
    return this.w.coveredToggleBits !== 0 ? this.w.toggleParity : undefined;
  }

  /** The character the player is now (the level's character until a transmogrifier switches it). */
  public getPlayerCharacter(): PlayerCharacter {
    return playerCharacterOf(this.w);
  }

  /** True when the level has several players, so that the state of the others is part of snapshots, hashes and search keys. */
  private hasSeveralPlayers(): boolean {
    return (this.w.level.extraPlayers?.length ?? 0) > 0;
  }

  /**
   * The players not controlled now, in swap order; undefined on a level with one player, so nothing about them reaches
   * a native level, its hash or its search keys. The list is shared: do not mutate it.
   */
  public getParkedPlayers(): readonly PlayerState[] | undefined {
    return this.hasSeveralPlayers() ? this.w.parked : undefined;
  }

  /** How many players already left through an exit; undefined on a level with one player. */
  public getExitedPlayers(): number | undefined {
    return this.hasSeveralPlayers() ? this.w.exitedPlayers : undefined;
  }

  /**
   * The player's character while a transmogrifier made it differ from the level's; undefined otherwise, so nothing about it
   * reaches a level whose player never crossed one, its hash or its search keys.
   */
  public getPlayerCharacterSwitch(): PlayerCharacter | undefined {
    if (this.hasSeveralPlayers()) return undefined;
    const character = playerCharacterOf(this.w);
    return character !== (this.w.level.character ?? DEFAULT_PLAYER_CHARACTER) ? character : undefined;
  }

  /** Arrivals counted on turning force floors; undefined on a level without one, so nothing about it reaches a level without one. */
  public getForceCycleTurn(): number | undefined {
    return this.w.hasForceCycle ? this.w.forceCycleTurn : undefined;
  }

  /**
   * Whether a toggle clock holds the level timer; undefined on a level without a toggle clock, so nothing about it reaches
   * a level without one or its hash.
   */
  public getPausedTicks(): number {
    return this.w.pausedTicks;
  }

  public isTimerPaused(): boolean | undefined {
    return this.w.hasToggleClock ? this.w.timerPaused : undefined;
  }

  /**
   * The track cells of the level as [cell index, active segment or -1 without a switch, side the last actor came in by], by
   * cell; undefined on a level without track cells, so nothing about them reaches a level without one or its hash.
   * The segments each cell holds are static and live in the level's `railTracks`.
   */
  public getRailState(): readonly (readonly [number, number, Direction])[] | undefined {
    return this.w.railCells.size > 0 ? railStateOf(this.w) : undefined;
  }

  /**
   * The blast charges lit and not yet blasted, with the absolute tick each blasts at; undefined when none is lit,
   * so nothing about charges reaches a level without one or its hash.
   */
  public getBlockSplashes(): readonly BlockSplash[] | undefined {
    if (this.w.blockSplashes.size === 0) return undefined;
    const width = this.getMapWidth();
    const out: BlockSplash[] = [];
    for (const [cell, until] of this.w.blockSplashes) {
      const passes = until - this.w.ccMonsterClock;
      if (passes > 0) {
        out.push({
          x: cell % width,
          y: Math.floor(cell / width),
          left: Math.min(1, passes / CC2_SPLASH_BLOCK_PASSES),
          kind: this.w.blockExplosions.has(cell) ? 'explosion' : 'splash'
        });
      }
    }
    return out.length > 0 ? out : undefined;
  }

  public getLitCharges(): readonly LitCharge[] | undefined {
    return this.w.litCharges.length > 0 ? copyLitCharges(this.w) : undefined;
  }

  /**
   * The runtime state beyond the grid that tells search states apart: the shots in flight, the toggle
   * parity, the spent reveal cells and the entry side recorded on swivel doors. An empty string on a level with none of them, so the keys of other levels stay as they were.
   */
  public getRuntimeKeyExtra(): string {
    const parity = this.getToggleParity();
    const spent = this.getSpentRevealCells();
    const parts = [shotsStateKey(this.getShots())].filter((part) => part !== '');
    if (parity !== undefined) parts.push(`${TOGGLE_PARITY_KEY_PREFIX}${parity}`);
    const forceCycleTurn = this.getForceCycleTurn();
    if (forceCycleTurn !== undefined) parts.push(`${FORCE_CYCLE_KEY_PREFIX}${forceCycleTurn % FORCE_CYCLE_ORDER.length}`);
    const switched = this.getPlayerCharacterSwitch();
    if (switched !== undefined) parts.push(`${PLAYER_CHARACTER_KEY_PREFIX}${switched}`);
    if (this.hasSeveralPlayers()) parts.push(`${PLAYERS_KEY_PREFIX}${this.playersStateKey()}`);
    if (this.w.hasToggleClock) parts.push(`${TIMER_PAUSE_KEY_PREFIX}${this.w.timerPaused ? 1 : 0}`);
    if (this.w.litCharges.length > 0) parts.push(`${LIT_CHARGE_KEY_PREFIX}${litChargesStateKey(this.w, this.ticksElapsed)}`);
    if (spent !== undefined) parts.push(`${SPENT_REVEAL_KEY_PREFIX}${spent.join(',')}`);
    if (this.w.swivelEntry.size > 0) {
      const entries = [...this.w.swivelEntry].sort((a, b) => a[0] - b[0]).map(([cell, side]) => `${cell}${side}`);
      parts.push(`${SWIVEL_ENTRY_KEY_PREFIX}${entries.join(',')}`);
    }
    if (this.w.railCells.size > 0) parts.push(`${RAIL_STATE_KEY_PREFIX}${railStateKey(this.w)}`);
    const arrivals = cc3dArrivalKey(this.w);
    if (arrivals !== '') parts.push(`${CC3D_ARRIVAL_KEY_PREFIX}${arrivals}`);
    // The teeth of a CC2-engine level aim at the apparent player position, so it tells search states apart.
    if (usesCc2Engine(this.w.level)) {
      const view = cc2PlayerViewKey(this.w);
      if (view !== '') parts.push(`${CC2_PLAYER_VIEW_KEY_PREFIX}${view}`);
      const hidden = cc2HiddenStateKey(this.w);
      if (hidden !== '') parts.push(`${CC2_HIDDEN_STATE_KEY_PREFIX}${hidden}`);
    }
    return parts.join('|');
  }

  /** Search state of the other players: the exit count, then each parked player's cell, facing, motion, inventory and character. */
  private playersStateKey(): string {
    const one = (p: PlayerState): string =>
      [
        p.x,
        p.y,
        p.dir,
        p.isSliding ? p.slideDir : '-',
        p.moveCooldown,
        p.slideCooldown,
        p.character ?? DEFAULT_PLAYER_CHARACTER,
        Object.entries(p.keys)
          .filter(([, count]) => count > 0)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([id, count]) => `${id}x${count}`)
          .join('+'),
        [...p.boots].sort().join('+'),
        p.belt !== undefined && p.belt.length > 0 ? p.belt.join('+') : '',
        p.softPadDue === true ? 'f' : ''
      ].join(',');
    return `${this.w.exitedPlayers}:${this.w.parked.map(one).join(';')}`;
  }

  /**
   * The cells that revealed their hidden terrain and hold their original top again (a block sunk in the
   * revealed water makes dirt again), by sorted cell index; undefined when there is none. Such a cell looks
   * as it did before the reveal but no longer hides anything, so it tells search states apart.
   */
  public getSpentRevealCells(): number[] | undefined {
    if (this.w.revealedCells.size === 0) return undefined;
    const width = this.w.terrain[0]?.length ?? 0;
    const spent = [...this.w.revealedCells]
      .filter((index) => {
        const row = Math.floor(index / width);
        const original = this.w.level.terrain[row];
        return this.w.terrain[row][index % width] === original[index % width];
      })
      .sort((a, b) => a - b);
    return spent.length > 0 ? spent : undefined;
  }

  /**
   * The terrain a removable top at the cell would show once opened now, or undefined when it hides none
   * or the cell has already revealed it.
   */
  public getRevealedTerrain(x: number, y: number): string | undefined {
    return revealedTerrain(this.w, x, y) ?? undefined;
  }

  public getChipsRemaining(): number {
    return Math.max(0, this.w.chipsRemaining);
  }

  public getTimeRemainingSeconds(): number {
    const { ticksPerSecond } = ConfigRegistry.getGame().timing;
    // The ticks a toggle clock held the timer do not count (always 0 on a level without one).
    const elapsedSec = Math.floor((this.ticksElapsed - this.w.pausedTicks) / ticksPerSecond);
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

  /** Keys, blast charges, pocket gates, hurl stones and boots the player holds, in the order of tiles.json. */
  public getHeldItems(): string[] {
    const held: string[] = [];
    for (const id of Object.keys(ConfigRegistry.getTiles().tiles)) {
      const def = ConfigRegistry.getTile(id);
      if (COUNTED_COLLECTIBLES.has(def.collectible ?? '') && (this.w.player.keys[id] || 0) > 0) held.push(id);
      else if (def.collectible === 'boot' && this.w.player.boots.has(id)) held.push(id);
    }
    return held;
  }

  /** True when the player holds the item: a key of that colour, or those boots. */
  public holdsItem(itemId: string): boolean {
    return holdsItem(this.w, itemId);
  }

  /** Whether the player, with what they carry now, may step on the tile (the rule of a step, for the path tools). */
  public canPlayerStepOn(tile: TileDefinition, itemId?: string | null): boolean {
    return canPlayerEnter(this.w, tile, itemId);
  }

  /**
   * Puts a held key or pair of boots down on the player's cell. The cell must
   * hold no item; the drop does not pick the item up again, since pickups only
   * happen on entering a cell. A held blast charge goes down lit instead, and
   * blasts when its fuse has run out; a held pocket gate becomes a teleporter
   * pad on a plain floor cell. Returns false when nothing was dropped.
   */
  public dropItem(itemId: string | null): boolean {
    const dropped = this.dropItemNow(itemId);
    // CC2 engine: what was put down leaves the belt, the oldest tool of its kind first.
    if (dropped && usesToolBelt(this.w) && itemId !== null) {
      const player = this.w.player;
      const at = player.belt?.indexOf(itemId) ?? -1;
      if (player.belt !== undefined && at >= 0) player.belt.splice(at, 1);
      syncToolBelt(player);
    }
    return dropped;
  }

  private dropItemNow(itemId: string | null): boolean {
    if (!this.beginInput()) return false;
    if (!itemId || !this.holdsItem(itemId)) {
      this.w.statusBannerKey = 'hud.messages.drop_nothing';
      return false;
    }
    // A toll token is never set down: it is spent at a thief or kept.
    // On a belt level the bribe is a tool like the others (Lexy tiletypes.js bribe) and is set down; the toll token never is.
    if (ConfigRegistry.getTile(itemId).collectible === 'token' && !(itemId === BRIBE_ITEM_ID && usesToolBelt(this.w))) {
      this.w.statusBannerKey = itemId === BRIBE_ITEM_ID ? 'hud.messages.drop_bribe' : 'hud.messages.drop_token';
      AudioManager.playSfx('blocked');
      return false;
    }
    // A hurl stone is thrown ahead, not set down: the cell under the player does not matter. On a CC2-engine level the bowling
    // ball is set down like any item and rolls off as an actor.
    if (ConfigRegistry.getTile(itemId).collectible === 'stone') return usesCc2Engine(this.w.level) && droppedActorId(itemId) !== undefined ? this.setDownRollingBall(itemId) : this.throwHeldStone(itemId);
    const x = this.w.player.x;
    const y = this.w.player.y;
    if (this.w.items[y][x] !== null) {
      this.w.statusBannerKey = 'hud.messages.drop_cell_occupied';
      AudioManager.playSfx('blocked');
      return false;
    }
    // The boots that keep the player safe on this very cell stay on their feet. A level imported from CC2 plays
    // by the CC2 rule, which allows the drop: the hazard only acts on arrival, so the player stays alive.
    if (this.w.level.cc2 === undefined && ConfigRegistry.getTile(this.w.terrain[y][x]).protectedByItem === itemId) {
      this.w.statusBannerKey = 'hud.messages.drop_protected';
      AudioManager.playSfx('blocked');
      return false;
    }

    const def = ConfigRegistry.getTile(itemId);
    // A pocket gate is set down as a pad on plain floor only: no other terrain, and nothing hidden under the floor.
    if (def.collectible === 'gate' && (this.w.terrain[y][x] !== FLOOR_TILE_ID || isCovered(this.w, x, y))) {
      this.w.statusBannerKey = 'hud.messages.drop_not_floor';
      AudioManager.playSfx('blocked');
      return false;
    }

    this.saveUndoSnapshot();
    if (COUNTED_COLLECTIBLES.has(def.collectible ?? '')) {
      const left = (this.w.player.keys[itemId] || 0) - 1;
      if (left > 0) {
        this.w.player.keys[itemId] = left;
      } else {
        delete this.w.player.keys[itemId];
      }
    } else {
      this.w.player.boots.delete(itemId);
    }
    if (def.collectible === 'charge' && def.cc2Dynamite === true) {
      // Dynamite lights once the player has left the cell, not when it is set down.
      setDownDynamite(this.w, x, y, itemId);
    } else if (def.collectible === 'charge') {
      lightCharge(this.w, x, y, def.dropsAs as string, this.ticksElapsed, ConfigRegistry.getGame().timing.chargeFuseTicks);
    } else if (def.collectible === 'gate') {
      // The pad stays for good; the player stands on it and does not jump, since a jump happens on arrival only.
      this.w.terrain[y][x] = def.dropsAsTerrain as string;
    } else {
      this.w.items[y][x] = itemId;
    }
    // An item on the cell may stop a turret beam that opacity 'block' reads.
    this.w.beamDirty = true;
    this.w.statusBannerKey = null;
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir: this.w.player.dir, drop: itemId });
    AudioManager.playSfx('item');
    this.emitVisual('item', x, y, def.colorKey || 'blue');
    return true;
  }

  /**
   * CC2 engine: sets the bowling ball down on the player's cell, where it becomes a rolling ball that leaves at once toward the
   * way faced. Refused, with no tick and the ball kept, while the player is in the cooldown of a step and when the cell holds an
   * item; never refused by what is ahead (a ball that cannot roll is spent). Returns false when nothing was set down.
   */
  private setDownRollingBall(itemId: string): boolean {
    const { x, y, dir } = this.w.player;
    if (this.w.player.moveCooldown > 0) {
      this.w.statusBannerKey = 'hud.messages.throw_busy';
      AudioManager.playSfx('blocked');
      return false;
    }
    if (this.w.items[y][x] !== null) {
      this.w.statusBannerKey = 'hud.messages.drop_cell_occupied';
      AudioManager.playSfx('blocked');
      return false;
    }
    this.saveUndoSnapshot();
    const left = (this.w.player.keys[itemId] || 0) - 1;
    if (left > 0) {
      this.w.player.keys[itemId] = left;
    } else {
      delete this.w.player.keys[itemId];
    }
    launchRollingBall(this.ctx, x, y, dir, itemId);
    this.w.beamDirty = true;
    this.w.statusBannerKey = null;
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir, drop: itemId });
    AudioManager.playSfx('item');
    return true;
  }

  /**
   * Throws the held hurl stone one cell ahead in the direction faced. Refused, with no tick and the stone kept, while
   * the player is sliding or still in the cooldown of a step, and when the cell ahead would stop the stone at once.
   * The stone is single-use: it is gone once it ends. Returns false when nothing was thrown.
   */
  private throwHeldStone(itemId: string): boolean {
    const { x, y, dir } = this.w.player;
    if (this.w.player.isSliding || this.w.player.moveCooldown > 0) {
      this.w.statusBannerKey = 'hud.messages.throw_busy';
      AudioManager.playSfx('blocked');
      return false;
    }
    if (!canThrowStone(this.w, x, y, dir)) {
      this.w.statusBannerKey = 'hud.messages.throw_blocked';
      AudioManager.playSfx('blocked');
      return false;
    }
    this.saveUndoSnapshot();
    const left = (this.w.player.keys[itemId] || 0) - 1;
    if (left > 0) {
      this.w.player.keys[itemId] = left;
    } else {
      delete this.w.player.keys[itemId];
    }
    throwStone(this.ctx);
    // A bomb or a block gone from a beam path changes the beams.
    this.w.beamDirty = true;
    this.w.statusBannerKey = null;
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir, drop: itemId });
    AudioManager.playSfx('item');
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
      entities: this.w.entities.map(copyEntity),
      player: this.snapshotPlayer(this.w.player),
      // Only a level with several players saves the others and the count of those who left.
      ...(this.hasSeveralPlayers()
        ? { parked: this.w.parked.map((p) => this.snapshotPlayer(p)), exitedPlayers: this.w.exitedPlayers }
        : {}),
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
      // Only a level with shot launchers or hurl stones has shots to put back.
      ...(this.w.hasShots ? { shots: this.w.shots.map((shot) => ({ ...shot })) } : {}),
      // Only a level with a toggle wall or flame jet under a removable top reads the parity of the presses.
      ...(this.w.coveredToggleBits !== 0 ? { toggleParity: this.w.toggleParity } : {}),
      // Only a level with a turning force floor counts arrivals on it.
      ...(this.w.hasForceCycle ? { forceCycleTurn: this.w.forceCycleTurn } : {}),
      // Only a player a transmogrifier switched has a character to put back.
      ...(this.getPlayerCharacterSwitch() !== undefined ? { playerCharacter: playerCharacterOf(this.w) } : {}),
      // Only a level with a toggle clock can hold its timer.
      ...(this.w.hasToggleClock ? { timerPaused: this.w.timerPaused, pausedTicks: this.w.pausedTicks } : {}),
      // Only a classic-rules level reads the entity-pass clock (the teeth cycle).
      ...(this.w.ccRules || this.w.cc3dPace ? { ccMonsterClock: this.w.ccMonsterClock } : {}),
      // Only a CC2-engine level that has run a tick has an apparent player position.
      ...(this.w.cc2PlayerView !== undefined && usesCc2Engine(this.w.level) ? { cc2PlayerView: copyCc2PlayerView(this.w.cc2PlayerView) } : {}),
      // Only a CC2-engine level with a splash still lasting has one to put back.
      ...(this.w.blockSplashes.size > 0 ? { blockSplashes: [...this.w.blockSplashes] } : {}),
      ...(this.w.blockExplosions.size > 0 ? { blockExplosions: [...this.w.blockExplosions] } : {}),
      ...(this.w.ccGenerators !== null ? { ccGenerators: [this.w.ccGenerators.walkerHigh, this.w.ccGenerators.walkerLow, this.w.ccGenerators.main] as [number, number, number] } : {}),
      // Only a CC2 level that set a blob modifier has one to put back.
      ...(this.w.ccGenerators?.blobModifier !== undefined ? { ccBlobModifier: this.w.ccGenerators.blobModifier } : {}),
      // Only a CC2-engine level with a wire-fired cloner or launcher waiting for the next tick has edges to put back.
      ...(this.w.cc2DeferredSinkEdges.length > 0 ? { cc2DeferredSinkEdges: this.w.cc2DeferredSinkEdges.map((edge) => ({ ...edge })) } : {}),
      ...(this.w.cc2BrownHeld !== undefined ? { cc2BrownHeld: [...this.w.cc2BrownHeld] } : {}),
      // Only a CC2-engine level with a decision for the mirror players to copy, a blasted wall or a blasted ghost bar cell has them to put back.
      ...(this.w.mirrorMove !== undefined ? { mirrorMove: { ...this.w.mirrorMove } } : {}),
      ...(this.w.blastedEdgeMask !== undefined ? { blastedEdgeMask: Array.from(this.w.blastedEdgeMask) } : {}),
      ...(ghostBarEdited(this.w) ? { ghostBar: [...(this.w.ghostBar as Set<number>)] } : {}),
      // Only a CC2-engine level with a button toggled by a rolling ball has cells to put back.
      ...(this.w.cc2ToggledButtonCells.length > 0 ? { cc2ToggledButtonCells: [...this.w.cc2ToggledButtonCells] } : {}),
      ...(this.w.ccRules ? { ccSlots: [...this.w.ccSlots] } : {}),
      ...(this.w.ccArrivals.length > 0 ? { ccArrivals: this.w.ccArrivals.map((a) => ({ ...a })) } : {}),
      // Only a level with a lit blast charge has a fuse to put back.
      ...(this.w.litCharges.length > 0 ? { litCharges: copyLitCharges(this.w) } : {}),
      // Only a level that revealed something has revealed cells to put back.
      ...(this.w.revealedCells.size > 0 ? { revealedCells: [...this.w.revealedCells] } : {}),
      // Only a level with an actor inside a swivel door has an entry side to put back.
      ...(this.w.swivelEntry.size > 0 ? { swivelEntry: [...this.w.swivelEntry] } : {}),
      // Only a level with track cells has switches and entry sides to put back.
      ...(this.w.railCells.size > 0 ? { railState: railStateOf(this.w) } : {}),
      // Only a level with a signal network has network state to put back.
      ...(this.w.signals !== undefined ? { signals: cloneSignalState(this.w.signals.state) } : {}),
      // Only a pulse button with an arrival not yet read, or a press carried, has memory to put back.
      ...(copySignalPulses(this.w) !== undefined ? { signalPulses: copySignalPulses(this.w) } : {})
    };
  }

  /** Copies one player for a snapshot; a level with several players keeps each player's own character. */
  private snapshotPlayer(p: PlayerState): PlayerSnapshot {
    return {
      x: p.x,
      y: p.y,
      dir: p.dir,
      isSliding: p.isSliding,
      slideDir: p.slideDir,
      moveCooldown: p.moveCooldown,
      slideCooldown: p.slideCooldown,
      inWater: p.inWater,
      keys: { ...p.keys },
      boots: Array.from(p.boots),
      ...(p.forcePermission !== undefined ? { forcePermission: p.forcePermission } : {}),
      ...(p.teleportExit !== undefined ? { teleportExit: p.teleportExit } : {}),
      ...(p.cc3dArrival !== undefined ? { cc3dArrival: copyCc3dArrival(p.cc3dArrival) } : {}),
      ...(p.belt !== undefined && p.belt.length > 0 ? { belt: [...p.belt] } : {}),
      ...(p.softPadDue === true ? { softPadDue: true as const } : {}),
      ...(p.listOrdinal !== undefined ? { listOrdinal: p.listOrdinal } : {}),
      ...(this.hasSeveralPlayers() ? { character: p.character ?? this.w.level.character ?? DEFAULT_PLAYER_CHARACTER } : {})
    };
  }

  /** Builds a live player from a snapshot of one; `character` is the one the snapshot kept, if any. */
  private restorePlayer(snap: PlayerSnapshot, character: PlayerCharacter | undefined): PlayerState {
    return {
      x: snap.x,
      y: snap.y,
      dir: snap.dir,
      alive: true,
      deathReasonKey: null,
      isSliding: snap.isSliding,
      slideDir: snap.slideDir,
      moveCooldown: snap.moveCooldown,
      slideCooldown: snap.slideCooldown,
      inWater: snap.inWater,
      keys: { ...snap.keys },
      boots: new Set(snap.boots),
      ...(snap.forcePermission !== undefined ? { forcePermission: snap.forcePermission } : {}),
      ...(snap.teleportExit !== undefined ? { teleportExit: snap.teleportExit } : {}),
      ...(snap.cc3dArrival !== undefined ? { cc3dArrival: copyCc3dArrival(snap.cc3dArrival) } : {}),
      ...(snap.belt !== undefined ? { belt: [...snap.belt] } : {}),
      ...(snap.softPadDue === true ? { softPadDue: true as const } : {}),
      ...(snap.listOrdinal !== undefined ? { listOrdinal: snap.listOrdinal } : {}),
      ...(character !== undefined ? { character } : {})
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
    this.w.entities = snap.entities.map(copyEntity);
    this.w.player = this.restorePlayer(snap.player, snap.player.character ?? snap.playerCharacter);
    this.w.parked = (snap.parked ?? []).map((p) => this.restorePlayer(p, p.character));
    this.w.exitedPlayers = snap.exitedPlayers ?? 0;
    this.w.swappedIn = null;
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
    this.w.toggleParity = snap.toggleParity ?? 0;
    this.w.forceCycleTurn = snap.forceCycleTurn ?? 0;
    this.w.timerPaused = snap.timerPaused ?? false;
    this.w.pausedTicks = snap.pausedTicks ?? 0;
    this.w.ccMonsterClock = snap.ccMonsterClock ?? 0;
    this.w.blockSplashes = new Map(snap.blockSplashes ?? []);
    this.w.blockExplosions = new Set(snap.blockExplosions ?? []);
    this.w.cc2PlayerView = snap.cc2PlayerView !== undefined ? copyCc2PlayerView(snap.cc2PlayerView) : undefined;
    if (this.w.ccGenerators !== null && snap.ccGenerators !== undefined) {
      [this.w.ccGenerators.walkerHigh, this.w.ccGenerators.walkerLow, this.w.ccGenerators.main] = snap.ccGenerators;
      if (snap.ccBlobModifier !== undefined) this.w.ccGenerators.blobModifier = snap.ccBlobModifier;
      else delete this.w.ccGenerators.blobModifier;
    }
    this.w.cc2DeferredSinkEdges = (snap.cc2DeferredSinkEdges ?? []).map((edge) => ({ ...edge }));
    this.w.cc2BrownHeld = snap.cc2BrownHeld !== undefined ? [...snap.cc2BrownHeld] : undefined;
    this.w.cc2ToggledButtonCells = snap.cc2ToggledButtonCells !== undefined ? [...snap.cc2ToggledButtonCells] : [];
    this.w.mirrorMove = snap.mirrorMove !== undefined ? { ...snap.mirrorMove } : undefined;
    // The walls a blast removed come back as an array of their own; with none removed the level's memoized mask is the live one again.
    if (snap.blastedEdgeMask !== undefined) {
      this.w.blastedEdgeMask = Uint8Array.from(snap.blastedEdgeMask);
      this.w.edgeMask = this.w.blastedEdgeMask;
    } else if (this.w.blastedEdgeMask !== undefined) {
      this.w.blastedEdgeMask = undefined;
      this.w.edgeMask = cellEdgeMask(this.w.level);
    }
    this.w.ghostBar = snap.ghostBar !== undefined ? new Set(snap.ghostBar) : buildGhostBar(this.w.level, mapWidth(this.w), mapHeight(this.w));
    this.w.ccSlots = snap.ccSlots !== undefined ? [...snap.ccSlots] : [];
    this.w.ccArrivals = (snap.ccArrivals ?? []).map((a) => ({ ...a }));
    this.w.ccArrivalsRunning = false;
    // The uids of what was removed since the snapshot are not those of the world put back (a uid is reused after an undo).
    this.w.removedUids.clear();
    this.w.litCharges = (snap.litCharges ?? []).map((charge) => ({ ...charge }));
    // A blast may have turned a device into floor: the devices are listed from the terrain put back.
    if (this.w.hasDynamite) rebuildDeviceLookups(this.w);
    this.w.revealedCells = new Set(snap.revealedCells ?? []);
    this.w.swivelEntry = new Map(snap.swivelEntry ?? []);
    restoreRailState(this.w, snap.railState);
    if (this.w.signals !== undefined) {
      this.w.signals.state = snap.signals ? cloneSignalState(snap.signals) : createSignalState(this.w.signals.network);
      restoreSignalPulses(this.w, snap.signalPulses);
    }
    // The launchers fired in the undone moment may fire again.
    this.w.firedLaunchers.clear();
    this.w.inTick = false;
    // The traps are read from the world as put back, signals included.
    refreshTrapLatch(this.w);
    this.w.levelCompleted = false;
    this.w.statusBannerKey = null;
    this.w.beamDirty = true;
  }

  /**
   * CC2 engine: acts on what the player's step left pending once it has ended (see applyCc3dStepEnd). Called at the start of
   * every entry point that consumes input, so the effects of a step act when the next tick or input begins (the original
   * runs them in the first frame of the tick after the wait ran out). Idempotent: nothing is pending the second time. The
   * entity pass that follows is the one that closes the previous tick, which w.cc2BeforePass tells a clone machine.
   * Returns false when the effects ended the level or killed the player.
   */
  private flushCc2StepEnd(): boolean {
    const w = this.w;
    if (!usesCc2Engine(w.level) || w.cc3dPace || w.player.cc3dArrival === undefined) return w.player.alive && !w.levelCompleted;
    w.cc2BeforePass = true;
    try {
      applyCc3dStepEnd(this.ctx);
    } finally {
      w.cc2BeforePass = undefined;
    }
    // The pending effects may have moved him (a teleporter jump): where he appears to be as the next tick starts changes with it.
    if (w.player.cc3dArrival === undefined) recordCc2PlayerView(w);
    return w.player.alive && !w.levelCompleted;
  }

  /**
   * CC2 engine: lets the step-end effects the player's finished step left pending act now instead of at the start of the
   * next tick or input, so that what is drawn and read between ticks (HUD, renderer, click-to-move safety) is the state
   * after them. Idempotent and equivalent to the flush the next entry point does anyway, so a replay is unchanged.
   * A no-op on any other level, while paused, dead or once the level ended.
   */
  public flushPendingStepEnd(): void {
    if (this.paused || !this.w.player.alive || this.w.levelCompleted) return;
    this.flushCc2StepEnd();
  }

  /** Start of an input-consuming entry point: false while paused, dead or once the level ended; otherwise the pending step-end effects act first. */
  private beginInput(): boolean {
    if (this.paused || !this.w.player.alive || this.w.levelCompleted) return false;
    return this.flushCc2StepEnd();
  }

  public tick(): void {
    if (this.paused || !this.w.player.alive || this.w.levelCompleted) {
      return;
    }
    if (!this.flushCc2StepEnd()) return;

    // Entities and terrain may change during the tick, so the cached beams cannot be trusted past it.
    this.w.beamDirty = true;
    this.ticksElapsed++;
    countPausedTick(this.w);
    if (this.getTimeRemainingSeconds() <= 0 && this.w.level.timeLimitSeconds > 0) {
      killPlayer(this.ctx, 'hud.messages.death_time', 'death');
      return;
    }

    // A shot fired from here to the end of the pass is advanced by this very tick.
    this.w.inTick = true;
    this.beginMirrorTick();
    if (this.w.player.moveCooldown > 0) {
      this.w.player.moveCooldown--;
    }
    // A converted CC3D level: what the player's step onto a cell does acts when that step ends.
    if (this.w.cc3dPace && !applyCc3dStepEnd(this.ctx)) {
      this.w.inTick = false;
      return;
    }

    // Classic rules: a floor keeps trying to carry the player, so a blocked or never started push still grants the choice.
    // A converted CC3D level retries the carry every tick too (a refused push is tried again, a start on a force floor is carried).
    if (this.w.ccRules || this.w.cc3dPace) resumeForceCarry(this.w);
    if (this.w.player.isSliding) {
      if (this.w.player.slideCooldown > 0) {
        this.w.player.slideCooldown--;
        if (this.w.cc3dPace && this.w.player.slideCooldown === 0 && !applyCc3dStepEnd(this.ctx)) {
          this.w.inTick = false;
          return;
        }
      } else {
        processPlayerSlideStep(this.ctx);
      }
    }
    // Classic rules and converted CC3D levels: a player on a teleporter pad leaves it by his forced exit step.
    if (this.w.ccRules || this.w.cc3dPace) processTeleportExit(this.ctx);
    // The players not controlled finish their forced moves (slides, force floors); they take no voluntary move.
    if (this.w.parked.length > 0) tickParkedPlayers(this.ctx);

    // A charge whose fuse ran out blasts first, before any creature or block moves.
    // Not once the level is won: a player who reached the exit this tick is out of the blast.
    const aliveBeforeBlasts = this.w.player.alive;
    if (!this.w.levelCompleted) detonateCharges(this.ctx, this.ticksElapsed);
    if (aliveBeforeBlasts && !this.w.player.alive) {
      this.w.inTick = false;
      return;
    }
    updateEntities(this.ctx);
    advanceShots(this.ctx);
    this.w.inTick = false;
    // Before the laser pass, which may return early; doors settle at the end of each pass.
    // The signals settle before the doors they drive; a no-op without signals.
    const edges = this.w.signals !== undefined ? settleWorldSignals(this.w, false, SIGNAL_PHASE_TICK) : [];
    setPoweredCells(this.ctx);
    setHoldDoors(this.ctx);
    // The launchers and clone machines wired to a signal fire after the doors, sharing the per-tick launcher cap with the buttons.
    fireSignalSinks(this.ctx, edges, SIGNAL_PHASE_TICK);
    // A new tick lets every launcher fire again; a move made before it counts with it. Cleared only now, so a launcher
    // fired by a signal in this pass counts with the buttons of the pass.
    this.w.firedLaunchers.clear();
    turnTurrets(this.w, this.ticksElapsed);
    resolveLasers(this.ctx);
    // A converted CC3D level recomputes its traps once, at the end of the tick (after the signals and lasers settled).
    refreshTrapLatch(this.w);
    this.checkTargetsWin();
    // CC2 engine: what the step onto a cell does acts when that step ends, at the start of the next tick or input
    // (flushCc2StepEnd); a brown button it held was held for this tick only.
    // Cleared at the tick end, so a held button is only ever visible between an input (or flush) and the tick.
    this.w.cc2BrownHeld = undefined;
    // CC2 engine: the belt follows what the tick took from the player (a thief, a spent bribe); getToolBelt is a pure read.
    if (usesToolBelt(this.w)) syncToolBelt(this.w.player);
    // CC2 engine: where the player appears to be as the next tick starts, before the input of that tick moves him.
    recordCc2PlayerView(this.w);
    this.endMirrorTick();
  }

  /**
   * CC2 engine, start of a tick (before the player's cooldown runs): the place where a player free to decide who decided
   * nothing leaves no move for the mirror players to copy. A no-op until the mirror rules fill it in.
   */
  private beginMirrorTick(): void {
    // Intentionally empty: the mirror cadence is not modelled yet.
  }

  /**
   * CC2 engine, end of a tick: the place where the mirror players' remembered decision is carried to the next tick.
   * A no-op until the mirror rules fill it in.
   */
  private endMirrorTick(): void {
    // Intentionally empty: the mirror cadence is not modelled yet.
  }

  /**
   * The direction keys held now, most recent first. Without the two-key rules of the CC2 engine (any other level, or
   * one key) this is attemptPlayerMove(dirs[0]). On a CC2-engine level, an opposing pair or more than two keys are
   * ignored; with two orthogonal keys the player first slaps (pushes) the blocks beside him toward both, then steps
   * toward the key matching his facing (else the horizontal one) and falls back to the other when that is blocked. The
   * mirror players follow the decision once. The two keys are one undo step and one recorded move ({dir, alt}).
   */
  public attemptPlayerMoveHeld(dirs: readonly Direction[]): boolean {
    if (dirs.length === 0) return false;
    if (!this.beginInput()) return false;
    const keys = dirs.filter((d, i) => dirs.indexOf(d) === i);
    if (!usesCc2Engine(this.w.level) || this.w.cc3dPace || keys.length === 1) return this.attemptPlayerMove(dirs[0]);
    if (keys.length > CC2_MAX_HELD_KEYS || hasOpposingPair(keys)) return false;
    if (this.paused || !this.w.player.alive || this.w.levelCompleted) return false;
    const player = this.w.player;
    // A soft pad (red, yellow) leaves the exit to the player's own decision: a held pair is a move from the pad.
    const softOverride = softPadOverrideDue(this.w);
    // A player who cannot decide this tick (waiting out a step, locked on ice, leaving a teleporter) does nothing at all.
    if (player.moveCooldown > 0 || (player.teleportExit !== undefined && !softOverride) || (player.isSliding && ConfigRegistry.getTile(this.w.terrain[player.y][player.x]).slideType === 'ice')) {
      return false;
    }
    // The force-floor refusal of attemptPlayerMove: a player still being carried has no choice yet, so nothing turns.
    if (this.w.ccRules && player.forcePermission !== true && isCarriedByForceFloor(this.w, ConfigRegistry.getTile(this.w.terrain[player.y][player.x]))) {
      return false;
    }
    const order = resolveCc2HeldOrder(keys, player.dir);
    // A player in a closed trap only turns: the first key of the order decides, as one key would.
    if (isCellClosedTrap(this.w, player.x, player.y)) return this.attemptPlayerMove(order[0]);

    const undoBefore = [...this.undoStack];
    const tickAtMove = this.ticksElapsed;
    const historyBefore = this.timedMoveHistory.length;
    const dirBefore = player.dir;
    const permissionBefore = player.forcePermission;
    let mutated = false;
    this.saveUndoSnapshot();
    if (softOverride) takeSoftPadOverride(this.w);
    const undoWithSlap = [...this.undoStack];
    let slapped = false;
    for (const slapDir of CC2_SLAP_ORDER) {
      if (keys.includes(slapDir) && slapBlockAhead(this.ctx, slapDir)) slapped = true;
    }
    let moved = false;
    let decision = order[0];
    if (this.w.player.alive && !this.w.levelCompleted) {
      this.w.mirrorsHeldBack = true;
      try {
        for (const dir of order) {
          decision = dir;
          moved = this.attemptPlayerMove(dir);
          // A refused step that still altered the world (a revealed wall, pushed blocks) is a move of its own.
          if (this.w.gridMutatedByMove || this.w.rejectedPushMovedBlocks) mutated = true;
          if (moved) break;
        }
        if (!moved) {
          // Both ways refused: he faces the horizontal key, as the original does.
          decision = order.find((d) => CC2_HORIZONTAL_DIRECTIONS.includes(d)) ?? order[0];
          player.dir = decision;
        }
      } finally {
        this.w.mirrorsHeldBack = false;
      }
      // The controlled player stays in place unless he left through an exit, which hands control on without a copy.
      if (this.w.player === player && player.exited !== true) steerMirrorsOnce(this.ctx, decision);
    }
    const changed = slapped || moved || mutated || softOverride || player.dir !== dirBefore || player.forcePermission !== permissionBefore;
    // The attempts recorded and pushed snapshots of their own; the hold keeps one of each, or none.
    this.timedMoveHistory.length = historyBefore;
    this.undoStack.length = 0;
    if (!changed) {
      this.undoStack.push(...undoBefore);
      return false;
    }
    this.undoStack.push(...undoWithSlap);
    this.timedMoveHistory.push({ tick: tickAtMove, dir: keys[0], alt: keys[1] });
    return moved;
  }

  public attemptPlayerMove(dir: Direction): boolean {
    if (!this.beginInput()) return false;
    const currentTile = ConfigRegistry.getTile(this.w.terrain[this.w.player.y][this.w.player.x]);
    const isLockedByIce = this.w.player.isSliding && currentTile.slideType === 'ice';
    // A soft pad (red, yellow) leaves the exit to the player's own decision: a direction is a normal move from the pad.
    const softOverride = softPadOverrideDue(this.w);
    // A converted CC3D level: the player decides only once his step is over, so one still waiting to act (a chip, a clone
    // switch, a jump) bars the input. It always acts at the true end of the step (see applyCc3dStepEnd), so this never sticks.
    if (isLockedByIce || this.w.player.moveCooldown > 0 || (this.w.player.teleportExit !== undefined && !softOverride) || (this.w.cc3dPace && this.w.player.cc3dArrival !== undefined)) {
      return false;
    }

    if (isCarriedByForceFloor(this.w, currentTile)) {
      // Classic rules: the floor carries the player until it has carried him once; only then may he choose a direction.
      if (this.w.ccRules && this.w.player.forcePermission !== true) return false;
      const activeForceDir: Direction | null =
        currentTile.forceDirection && currentTile.forceDirection !== 'RANDOM'
          ? currentTile.forceDirection
          : this.w.player.slideDir;
      // A converted CC3D level: the player resting on a force floor whose forced step was refused keeps its drift, and his
      // input along that axis is refused both ways (Cc3dSimulation.inputAllowed).
      const keptDrift = this.w.cc3dPace && !this.w.player.isSliding;
      // CC2 engine: a player with the choice may walk against the floor (Lexy: any direction overrides a force floor).
      const refusesOpposite = !usesCc2Engine(this.w.level);
      if (activeForceDir && ((refusesOpposite && dir === OPPOSITE_DIRECTION[activeForceDir]) || (keptDrift && dir === activeForceDir))) {
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
    if (softOverride) takeSoftPadOverride(this.w);
    // CC2 engine: the teeth of the coming tick aim at where he stands now, not at the cell this move takes him to.
    if (usesCc2Engine(this.w.level) && this.w.cc2PlayerView === undefined) this.w.cc2PlayerView = cc2PlayerViewOf(this.w);
    this.w.gridMutatedByMove = false;
    this.w.rejectedPushMovedBlocks = false;
    // The mover may leave through an exit during the move, which hands control to the next player.
    const mover = this.w.player;
    const permissionBefore = mover.forcePermission;
    const fromX = mover.x;
    const fromY = mover.y;
    const moved = executePlayerMove(this.ctx, dir, false);
    this.w.beamDirty = true;
    // A converted CC3D level: a step into a monster kills the player where he stands; it counts as a step (Cc3dSimulation.decidePlayer) but leaves nothing behind.
    const diedInPlace = moved && this.w.cc3dPace && !mover.alive && mover.x === fromX && mover.y === fromY;
    if (moved) {
      if (!diedInPlace) lightDepartedDynamite(this.w, this.ticksElapsed);
      const edges = this.w.signals !== undefined ? settleWorldSignals(this.w, false, SIGNAL_PHASE_MOVE) : [];
      // The relay pads follow the signals after the move: a jump made during the move read each pad as it stood before it.
      setPoweredCells(this.ctx);
      setHoldDoors(this.ctx);
      // The move never clears firedLaunchers: a launcher fired here by a signal blocks the fire buttons of the
      // following tick, as one fired by a button does (see the clear in tick()).
      fireSignalSinks(this.ctx, edges, SIGNAL_PHASE_MOVE);
      this.stepsCount++;
      // The turrets' clock starts with the first step.
      if (this.w.hasTurrets && this.w.playStartTick === NO_PLAY_START_TICK) this.w.playStartTick = tickAtMove;
      this.moveHistory.push(dir);
      this.timedMoveHistory.push({ tick: tickAtMove, dir });
      if (mover.exited !== true) {
        const destTile = ConfigRegistry.getTile(this.w.terrain[this.w.player.y][this.w.player.x]);
        // Boots cancel the push, so a booted player keeps the walking cadence.
        this.w.player.moveCooldown = isCarriedByForceFloor(this.w, destTile)
          ? FORCE_FLOOR_MOVE_COOLDOWN_TICKS
          : playerWalkCooldown(this.w);
        // CC2 engine: a voluntary step onto ice or a force floor lasts the time of the tile it enters; boots do not shorten it.
        if (usesCc2Engine(this.w.level) && this.w.ccRules && this.w.player.isSliding && this.w.player.alive) {
          this.w.player.slideCooldown += CC2_SLIDE_ENTRY_EXTRA_TICKS;
          if (isCarriedByForceFloor(this.w, destTile)) this.w.player.moveCooldown = CC2_FORCE_ENTRY_MOVE_COOLDOWN_TICKS;
        }
      }
      resolveLasers(this.ctx);
      this.checkTargetsWin();
    } else {
      // A move that revealed an underlay and was then rejected still spends the key and drops its undo
      // snapshot; the bump is not in moveHistory, only the timed history records it (below).
      // A chain push that stopped partway moved blocks: its snapshot stays so that undo puts them back.
      // A refused move on a soft pad still ended the forced exit: it keeps its undo step.
      if (!this.w.rejectedPushMovedBlocks && !softOverride) this.undoStack.pop();
      if (this.w.gridMutatedByMove || this.w.rejectedPushMovedBlocks || softOverride || this.w.player.dir !== dirBefore || mover.forcePermission !== permissionBefore) {
        this.timedMoveHistory.push({ tick: tickAtMove, dir });
      }
    }
    return moved;
  }

  /**
   * The swap key (Lexy's Labyrinth `swap_players`): control passes to the next player of the level. Refused when nobody
   * else is on the map, while paused or once the level ended. The swap is one undo step and is recorded so that a
   * recorded solution replays it.
   */
  public swapPlayer(): boolean {
    if (!this.beginInput() || this.w.parked.length === 0) return false;
    this.saveUndoSnapshot();
    rotatePlayers(this.w);
    resetCc2PlayerView(this.w);
    this.w.beamDirty = true;
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir: this.w.player.dir, swap: true });
    return true;
  }

  /**
   * The cycle key (Lexy's Labyrinth cycle_inventory): the pair of boots held longest goes to the end of the list, so the
   * next pair is the one the drop key puts down. Only on a CC2-engine level, and only with two pairs or more; false (nothing
   * recorded, no undo step) otherwise, while paused, dead or once the level ended. One undo step, recorded so that a recorded
   * solution replays it.
   */
  public cycleInventory(): boolean {
    if (!usesCc2Engine(this.w.level) || !this.beginInput()) return false;
    if (usesToolBelt(this.w)) return this.cycleToolBelt();
    const boots = this.w.player.boots;
    if (boots.size < MIN_BOOTS_TO_CYCLE) return false;
    this.saveUndoSnapshot();
    const oldest = boots.values().next().value as string;
    boots.delete(oldest);
    boots.add(oldest);
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir: this.w.player.dir, cycle: true });
    return true;
  }

  /**
   * CC2 engine, four-tool belt: the tool held longest goes to the end of the belt, so the next tool is the one the drop key
   * puts down (a boot keeps its place in the boots too). Needs two tools or more; one undo step, recorded like the boots cycle.
   */
  private cycleToolBelt(): boolean {
    const belt = syncToolBelt(this.w.player);
    if (belt.length < MIN_BOOTS_TO_CYCLE) return false;
    this.saveUndoSnapshot();
    const oldest = belt.shift() as string;
    belt.push(oldest);
    this.w.player.belt = belt;
    const boots = this.w.player.boots;
    if (boots.has(oldest)) {
      boots.delete(oldest);
      boots.add(oldest);
    }
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir: this.w.player.dir, cycle: true });
    return true;
  }

  /** CC2 engine: the tools of the controlled player in belt order, oldest first; undefined when the level keeps no belt. */
  public getToolBelt(): readonly string[] | undefined {
    return usesToolBelt(this.w) ? toolBeltOf(this.w.player) : undefined;
  }

  /**
   * The CC2 wave 3 state that has no other getter, for the simulation hash: the blob modifier, the deferred wire-fired
   * sink edges, the mirror players' remembered decision, the blasted walls and the edited ghost bar. Undefined while none is set, so a level that uses none hashes as before.
   */
  public getCc2WaveState(): { blobModifier?: number; deferredSinkEdges?: { cell: number; rising: boolean }[]; brownHeld?: number[]; toggledButtons?: number[]; mirrorMove?: { remembered: Direction | null; snapshot: Direction | null; attempted: boolean }; blastedEdges?: string[]; ghostBar?: number[] } | undefined {
    const blobModifier = this.w.ccGenerators?.blobModifier;
    const edges = this.w.cc2DeferredSinkEdges;
    const brownHeld = this.w.cc2BrownHeld;
    const toggled = this.w.cc2ToggledButtonCells;
    const mirrorMove = this.w.mirrorMove;
    const blasted = blastedEdgeDiff(this.w);
    const barEdited = ghostBarEdited(this.w);
    if (blobModifier === undefined && edges.length === 0 && brownHeld === undefined && toggled.length === 0 && mirrorMove === undefined && blasted.length === 0 && !barEdited) return undefined;
    return {
      ...(blobModifier !== undefined ? { blobModifier } : {}),
      ...(brownHeld !== undefined ? { brownHeld: [...brownHeld] } : {}),
      ...(toggled.length > 0 ? { toggledButtons: [...toggled] } : {}),
      ...(edges.length > 0 ? { deferredSinkEdges: edges.map((edge) => ({ ...edge })) } : {}),
      ...(mirrorMove !== undefined ? { mirrorMove: { ...mirrorMove } } : {}),
      ...(blasted.length > 0 ? { blastedEdges: blasted } : {}),
      ...(barEdited ? { ghostBar: [...(this.w.ghostBar as Set<number>)].sort((a, b) => a - b) } : {})
    };
  }

  /**
   * Turn in place: the player faces `dir` without stepping, so that a thrown stone can be aimed. Costs nothing: no tick,
   * no move cooldown, no step, no undo snapshot, no sound, no mirror, laser or signal effect. Allowed during the cooldown
   * of a step and inside a closed trap. Refused (false, nothing recorded) while paused, dead or once the level ended, on
   * the classic and converted CC3D rules, while sliding, carried by a force floor, waiting to leave a teleporter or to
   * land from a CC3D arrival, and when already facing `dir`. The turn is recorded in the timed history so that a
   * recorded solution replays it; undo restores the facing through the previous snapshot and truncates the entry.
   */
  public turnPlayer(dir: Direction): boolean {
    if (!this.beginInput()) return false;
    if (this.w.ccRules || this.w.cc3dPace) return false;
    const player = this.w.player;
    if (player.isSliding || player.teleportExit !== undefined || player.cc3dArrival !== undefined) return false;
    if (dir === player.dir) return false;
    const currentTile = ConfigRegistry.getTile(this.w.terrain[player.y][player.x]);
    if (isCarriedByForceFloor(this.w, currentTile)) return false;
    player.dir = dir;
    this.timedMoveHistory.push({ tick: this.ticksElapsed, dir, turn: true });
    return true;
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
    if (mask === null) {
      this.canopyView = NO_CANOPIES;
      return NO_PANELS;
    }
    if (this.panelsMask !== mask) {
      const panels = new Map<number, readonly Direction[]>();
      const canopies = new Set<number>();
      mask.forEach((bits, index) => {
        const sides = CELL_EDGE_SIDE_ORDER.filter((side) => (bits & CELL_EDGE_BITS[side]) !== 0);
        if (sides.length > 0) panels.set(index, sides);
        if ((bits & CELL_EDGE_CANOPY_BIT) !== 0) canopies.add(index);
      });
      this.panelsMask = mask;
      this.panelsView = panels;
      this.canopyView = canopies;
    }
    return this.panelsView;
  }

  /**
   * The cells a canopy covers, by cell index (y * width + x). Static for the level; empty when it has none. The set
   * is shared: do not mutate it.
   */
  public getCanopyCells(): ReadonlySet<number> {
    this.getPanels();
    return this.canopyView;
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
    return occupant !== undefined && occupant.kind === 'block' && !occupant.isSliding && occupant.arrivalTicks === undefined;
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
    // Nothing fires after the win: the wire-fired edges still waiting are dropped.
    this.w.cc2DeferredSinkEdges = [];
    this.w.cc2BrownHeld = undefined;
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
