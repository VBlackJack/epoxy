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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { ORDERED_DIRECTIONS } from '../../config/constants';
import { AudioManager } from '../../audio/AudioManager';
import { BLOCK_TARGET_TILE_ID, DEFAULT_PLAYER_CHARACTER, FLOOR_TILE_ID, MELINDA_CHARACTER, toggleParityBitOf, toggleWallOtherForm } from '../coreConstants';
import { cellEdgeMask, isEdgeBlockedAt } from '../EdgeRules';
import { SeededRandom } from '../Random';
import { underlayAt, underlayMap } from '../Underlays';
import { isConvertedCc3dLevel } from '../cc3d/cc3dConstants';
import { usesCcRules } from './ccRules';
import type { CcGenerators } from './ccGenerators';
import type { CcArrival } from '../types';
import { railEdgeBlocked } from './epoxyRailsCc2';
import type { RailActor, RailCellState } from './epoxyRailsCc2';
import type { SignalRuntime } from './epoxySignals';
import {
  BeamCell,
  ButtonAction,
  ChannelColor,
  CloneLink,
  CompiledLevel,
  Direction,
  GridPoint,
  LauncherLink,
  PlayerState,
  RelativeTurn,
  LitCharge,
  PlayerCharacter,
  RuntimeEntity,
  Shot,
  TileDefinition,
  TrapLink
} from '../types';

/** Group of the teleporters that declare none: they all chain together. */
export const DEFAULT_TELEPORT_GROUP = '';
/** The world's play start tick while the player has not taken a first step. */
export const NO_PLAY_START_TICK = -1;
/** Level score factor before any multiplier item is picked up. */
export const BASE_LEVEL_SCORE_MULTIPLIER = 1;

/** A cell of a colour channel: a pressure plate or a hold door, with the colour it belongs to. */
export interface ChannelCell extends GridPoint {
  color: ChannelColor;
}

/** Kinds of visual event the engine reports to its renderer. */
export type EpoxyVisualKind = 'chip' | 'item' | 'unlock' | 'splash' | 'explosion' | 'teleport' | 'win';

/**
 * The play state of one Epoxy level, shared by every engine module. Made once
 * by the engine and never replaced: modules read and reassign its fields (for
 * instance `entities`, which removing an entity replaces), so a field must be
 * read at the time it is used and never kept across a call that may change it.
 */
export interface EpoxyWorld {
  level: CompiledLevel;
  terrain: string[][];
  items: (string | null)[][];
  entities: RuntimeEntity[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
  /** The controlled player (the only one on a native level). */
  player: PlayerState;
  /**
   * The players on the map that are not controlled now, in swap order (Lexy's Labyrinth `remaining_players` minus the
   * controlled one); empty on a level with one player.
   */
  parked: PlayerState[];
  /** Players that already left through an exit; 0 on a level with one player. */
  exitedPlayers: number;
  /** The parked player now standing in the controlled slot for a step of its own (see withPlayer); null otherwise. Transient. */
  swappedIn: PlayerState | null;
  /**
   * The shots in flight, in the order they were fired. Empty on a level without launchers. A shot is not
   * an entity: it is no occupant of a cell for the hold doors, the traps or the targets.
   */
  shots: Shot[];
  /** Thin walls of the level's cell edges, one bit per side (see cellEdgeMask); static, null when none. */
  edgeMask: Uint8Array | null;
  /** Terrain hidden under removable tops by cell index (see underlayMap); static, null when none. */
  underlays: ReadonlyMap<number, string> | null;

  /**
   * Parity bits of the toggle families (green, colour channels, flame jets) that have a tile hidden under a
   * removable top (see toggleParityBitOf); static, 0 when none is hidden. A bit is flipped by each press of
   * its family's button so a tile revealed later shows the form the presses left it in.
   */
  coveredToggleBits: number;
  /**
   * Cells (by index y * width + x) whose hidden terrain was already revealed. A cell reveals at most once:
   * when its top comes back (a block sunk in the revealed water makes dirt again) it hides nothing.
   * Empty at load.
   */
  revealedCells: Set<number>;
  /**
   * The side an actor came into a swivel door by, per cell (index y * width + x). The door turns when the
   * actor leaves. Empty at load.
   */
  swivelEntry: Map<number, Direction>;
  /**
   * The Chip's Challenge 2 track cells by cell index (y * width + x): their segments, the active one of a switch and the
   * side the last actor came in by (see epoxyRailsCc2). Empty on a level without track cells.
   */
  railCells: Map<number, RailCellState>;
  /** One bit per covered toggle family, set while an odd number of presses happened; 0 at load. */
  toggleParity: number;
  /** Arrivals counted so far on turning force floors, by any actor; picks the next direction of the shared turn. 0 at load. */
  forceCycleTurn: number;
  /** The blast charges dropped and not yet blasted, in the order they were lit; empty on a level without charges. */
  litCharges: LitCharge[];
  /** True when the level places dynamite, which can turn terrain into floor; fixed for the level. */
  hasDynamite: boolean;
  /** True when the level has a turning force floor, even one hidden under a removable top; fixed for the level. */
  hasForceCycle: boolean;
  /** True when the level places a toggle clock; fixed for the level. Only such a level counts paused ticks. */
  hasToggleClock: boolean;
  /** True while a toggle clock holds the level timer; false at load. */
  timerPaused: boolean;
  /** Ticks the level timer stood paused so far; they do not count toward the time spent. 0 at load. */
  pausedTicks: number;
  chipsRemaining: number;
  /** Seconds gained from stopwatch items in this level, net of penalties. */
  extraTimeSeconds: number;
  /** Points from bonus flags, paid with the level score at the exit. */
  levelBonusPoints: number;
  /** Factor applied to the level score at the exit, raised by multiplier items. */
  levelScoreMultiplier: number;
  levelCompleted: boolean;
  /** True when the level has a turret, or a clone machine that may spawn one; fixed for the level. */
  hasTurrets: boolean;
  /** True when the level has a shot launcher, even one hidden under a removable top; fixed for the level. */
  hasLaunchers: boolean;
  /** True when shots can exist on this level: it has a shot launcher or places a hurl stone; fixed for the level. */
  hasShots: boolean;
  /** True when the level plays with the classic Chip's Challenge rules (see usesCcRules); fixed for the level, read by later batches. */
  ccRules: boolean;
  /**
   * True when the level is a CC3D level converted to Epoxy that plays on the Epoxy engine (never one with the classic
   * rules): the player and the blocks it pushes keep the CC3D pace on ice and force floors; fixed for the level.
   */
  cc3dPace: boolean;
  /** Uids of the entities the running entity pass has already visited (empty outside a pass); read to count a deferred arrival down in the tick of its push. */
  entityPassSeen: Set<number>;
  /** Entity-update passes run since the level started (the teeth cycle of a classic-rules level and the press queue of a converted CC3D level read it); counts only while ccRules or cc3dPace. */
  ccMonsterClock: number;
  /** The walker and blob generators of a classic-rules level (a .DAT or a CC2 import); null on every native level. */
  ccGenerators: CcGenerators | null;
  /** Creature slots of a classic-rules level: the uid held by each slot, null for a freed one; the entity list follows this order. Saved with the undo snapshot. */
  ccSlots: (number | null)[];
  /** The directions the classic monsters decided on in the decision pass of the current entity pass; transient, never saved. */
  ccPlans: Map<number, Direction | null>;
  /** Monster button presses waiting to take effect on a classic-rules level, oldest first; saved with the undo snapshot. */
  ccArrivals: CcArrival[];
  /** True while the queued arrivals of a classic-rules level are applied (the press then counts from the current pass); transient. */
  ccArrivalsRunning: boolean;
  /** True while an entity pass of a classic-rules level runs (the clock already counts it); transient, never saved. */
  ccPassOpen: boolean;
  /** Ticks a shot takes per cell on this level (every launcher tile declares the same count); 0 without launchers. */
  shotStepTicks: number;
  /** The triggers wired to launchers, as the level declares them; static, empty when none. */
  launcherLinks: LauncherLink[];
  /** True while GameEngine.tick() runs: a shot fired then is still to be advanced by the same tick. */
  inTick: boolean;
  /** The launchers (by cell key) that already fired in this tick; a launcher fires at most once per tick. Transient. */
  firedLaunchers: Set<string>;
  /** Tick of the player's first step (NO_PLAY_START_TICK until then); only turret levels read it. */
  playStartTick: number;
  /** The level's signal network; undefined on a level without one, which every signal step then skips. */
  signals: SignalRuntime | undefined;
  statusBannerKey: string | null;
  nextEntityUid: number;
  rng: SeededRandom;

  // Lookups built once per level: these cells never change tile type during play.
  trapLinksByTrap: Map<string, TrapLink[]>;
  holdTrapButtons: GridPoint[];
  /** Block target cells of a level won by covering them; empty for any other level. */
  targetCells: GridPoint[];
  /** Teleporter cells by group: a jump lands on a teleporter of the same group only. */
  teleportersByGroup: Map<string, GridPoint[]>;
  /** Laser emitters of the level in reading order, with the direction each one fires in. */
  laserEmitters: Array<GridPoint & { dir: Direction }>;
  /** Laser receiver cells in reading order. */
  laserReceivers: GridPoint[];
  /** Laser gate cells in reading order; a gate cell stays a gate, only its open or closed form changes. */
  laserGates: GridPoint[];
  /** Pressure plate cells in reading order; empty on a level without plates. */
  plates: ChannelCell[];
  /** Hold door cells in reading order; a door cell stays a door, only its open or closed form changes. */
  holdDoors: ChannelCell[];
  // Derived from the grid and the entities, never snapshotted: rebuilt after load, restore and any change.
  /** Cells the laser emitters' beams cross (turret beams are kept apart in turretBeamCells). */
  beamCells: BeamCell[];
  /** Cells the turret beams cross; empty on a level without turrets. */
  turretBeamCells: BeamCell[];
  litReceiverCells: GridPoint[];
  /** True while a mirror on a beam path is sliding. */
  beamHasSlidingMirror: boolean;
  beamDirty: boolean;
  removedUids: Set<number>;
  /** Set when a rejected player move still altered the grid (revealed wall, opened door). */
  gridMutatedByMove: boolean;
  /** Set when a push that was refused still moved blocks (a chain that stopped partway): the move keeps its undo snapshot. */
  rejectedPushMovedBlocks: boolean;
  /** Pushes that moved a block other than the one pushed directly (a chain, partial ones included); a debug counter. */
  chainPushCount: number;
}

/**
 * What the engine modules call on each other and on the engine. The hooks
 * upward (`triggerButton`, `teleportEntity`) keep the module imports acyclic.
 */
export interface EpoxyContext {
  readonly world: EpoxyWorld;
  emitVisual(kind: EpoxyVisualKind, x: number, y: number, colorKey?: string): void;
  completeLevel(): void;
  checkTargetsWin(): void;
  /** Returns false when a clone spawned by the button killed the player. */
  triggerButton(x: number, y: number, action: ButtonAction): boolean;
  teleportEntity(entity: RuntimeEntity, fromX: number, fromY: number, dir: Direction): boolean;
}

/** The state of an engine before any level is loaded. */
export function createEpoxyWorld(): EpoxyWorld {
  return {
    level: undefined as unknown as CompiledLevel,
    terrain: [],
    items: [],
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    player: undefined as unknown as PlayerState,
    parked: [],
    exitedPlayers: 0,
    swappedIn: null,
    shots: [],
    edgeMask: null,
    underlays: null,
    coveredToggleBits: 0,
    revealedCells: new Set<number>(),
    swivelEntry: new Map<number, Direction>(),
    railCells: new Map<number, RailCellState>(),
    toggleParity: 0,
    forceCycleTurn: 0,
    litCharges: [],
    hasDynamite: false,
    hasForceCycle: false,
    hasToggleClock: false,
    timerPaused: false,
    pausedTicks: 0,
    chipsRemaining: 0,
    extraTimeSeconds: 0,
    levelBonusPoints: 0,
    levelScoreMultiplier: BASE_LEVEL_SCORE_MULTIPLIER,
    levelCompleted: false,
    hasTurrets: false,
    hasLaunchers: false,
    hasShots: false,
    ccRules: false,
    cc3dPace: false,
    entityPassSeen: new Set(),
    ccMonsterClock: 0,
    ccGenerators: null,
    ccSlots: [],
    ccPlans: new Map<number, Direction | null>(),
    ccArrivals: [],
    ccArrivalsRunning: false,
    ccPassOpen: false,
    shotStepTicks: 0,
    launcherLinks: [],
    inTick: false,
    firedLaunchers: new Set<string>(),
    playStartTick: NO_PLAY_START_TICK,
    signals: undefined,
    statusBannerKey: null,
    nextEntityUid: 1,
    rng: new SeededRandom(0),
    trapLinksByTrap: new Map<string, TrapLink[]>(),
    holdTrapButtons: [],
    targetCells: [],
    teleportersByGroup: new Map<string, GridPoint[]>(),
    laserEmitters: [],
    laserReceivers: [],
    laserGates: [],
    plates: [],
    holdDoors: [],
    beamCells: [],
    turretBeamCells: [],
    litReceiverCells: [],
    beamHasSlidingMirror: false,
    beamDirty: true,
    removedUids: new Set<number>(),
    gridMutatedByMove: false,
    rejectedPushMovedBlocks: false,
    chainPushCount: 0
  };
}

/** True when the level has a turret now, or a clone machine that may spawn one. */
export function levelHasTurrets(w: EpoxyWorld): boolean {
  if (w.entities.some((e) => ConfigRegistry.getEntityDef(e.type)?.turretBeam !== undefined)) return true;
  return w.cloneLinks.some((link) => ConfigRegistry.getEntityDef(link.templateType)?.turretBeam !== undefined);
}

export function buildLevelLookups(w: EpoxyWorld): void {
  w.edgeMask = cellEdgeMask(w.level);
  w.hasTurrets = levelHasTurrets(w);
  w.launcherLinks = (w.level.launcherLinks ?? []).map((l) => ({ ...l }));
  w.hasLaunchers = false;
  w.hasShots = false;
  w.ccRules = usesCcRules(w.level);
  w.cc3dPace = !w.ccRules && isConvertedCc3dLevel(w.level);
  w.shotStepTicks = 0;
  w.shots = [];
  w.firedLaunchers.clear();
  w.inTick = false;
  w.turretBeamCells = [];
  w.underlays = underlayMap(w.level);
  w.coveredToggleBits = 0;
  w.revealedCells = new Set<number>();
  w.toggleParity = 0;
  w.forceCycleTurn = 0;
  w.litCharges = [];
  w.hasDynamite = w.items.some((row) => row.some((id) => id !== null && ConfigRegistry.getTile(id).cc2Dynamite === true));
  w.hasForceCycle = false;
  w.hasToggleClock = false;
  w.timerPaused = false;
  w.pausedTicks = 0;
  w.trapLinksByTrap.clear();
  for (const link of w.trapLinks) {
    const key = cellKey(link.trapX, link.trapY);
    const list = w.trapLinksByTrap.get(key);
    if (list) {
      list.push(link);
    } else {
      w.trapLinksByTrap.set(key, [link]);
    }
  }

  w.holdTrapButtons = [];
  w.targetCells = [];
  w.laserEmitters = [];
  w.laserReceivers = [];
  w.laserGates = [];
  w.plates = [];
  w.holdDoors = [];
  const coversTargets = w.level.winRule === 'targets';
  w.teleportersByGroup.clear();
  const width = mapWidth(w);
  for (let y = 0; y < w.terrain.length; y++) {
    for (let x = 0; x < w.terrain[y].length; x++) {
      registerDevices(w, x, y, w.terrain[y][x], coversTargets);
      if (ConfigRegistry.getTile(w.terrain[y][x]).forceCycle === true) w.hasForceCycle = true;
      // A device hidden under a removable top is listed too; every use checks that the top is that device now.
      const hidden = underlayAt(w.underlays, width, x, y);
      if (hidden !== undefined) {
        registerDevices(w, x, y, hidden, coversTargets);
        w.coveredToggleBits |= toggleParityBitOf(ConfigRegistry.getTile(hidden));
        if (ConfigRegistry.getTile(hidden).forceCycle === true) w.hasForceCycle = true;
      }
    }
  }
  w.hasToggleClock = w.items.some((row) => row.some((id) => id !== null && ConfigRegistry.getTile(id).togglesTimer === true));
  // A level that places a hurl stone has shots too, though it may have no launcher.
  w.hasShots = w.hasLaunchers || w.items.some((row) => row.some((id) => id !== null && ConfigRegistry.getTile(id).collectible === 'stone'));
}

/** Sound played when an actor arrives on a toggle switch. */
const TOGGLE_SWITCH_SFX = 'button';

/** Monster step factor when no held boots slow the monsters. */
const NORMAL_MONSTER_SLOWDOWN = 1;

/**
 * How many times longer every monster takes per step: the largest slowsMonsters among the boots the player
 * holds, 1 when none slows them. Sliding blocks, the player and the timer never read it.
 */
export function monsterSlowdown(w: EpoxyWorld): number {
  let factor = NORMAL_MONSTER_SLOWDOWN;
  for (const bootId of w.player.boots) {
    factor = Math.max(factor, ConfigRegistry.getTile(bootId).slowsMonsters ?? NORMAL_MONSTER_SLOWDOWN);
  }
  return factor;
}

/** Player step factor when no held boots haste the player. */
const NORMAL_PLAYER_HASTE = 1;

/**
 * How many times faster the player walks: the largest hastesPlayer among the boots held, exactly 1 when none
 * hastes the player. Ice and force floor timings never read it.
 */
export function playerHaste(w: EpoxyWorld): number {
  let factor = NORMAL_PLAYER_HASTE;
  for (const bootId of w.player.boots) {
    factor = Math.max(factor, ConfigRegistry.getTile(bootId).hastesPlayer ?? NORMAL_PLAYER_HASTE);
  }
  return factor;
}

/**
 * Lists the devices of the grid again, from the terrain as it is now. Dynamite turns terrain into floor, so a device it
 * destroyed must leave the lists the laser, hold door, plate and teleporter passes walk. A device hidden under a removable
 * top stays listed, as at load.
 */
export function rebuildDeviceLookups(w: EpoxyWorld): void {
  w.holdTrapButtons = [];
  w.targetCells = [];
  w.laserEmitters = [];
  w.laserReceivers = [];
  w.laserGates = [];
  w.plates = [];
  w.holdDoors = [];
  w.teleportersByGroup.clear();
  const coversTargets = w.level.winRule === 'targets';
  const width = mapWidth(w);
  for (let y = 0; y < w.terrain.length; y++) {
    for (let x = 0; x < w.terrain[y].length; x++) {
      registerDevices(w, x, y, w.terrain[y][x], coversTargets);
      const hidden = underlayAt(w.underlays, width, x, y);
      if (hidden !== undefined) registerDevices(w, x, y, hidden, coversTargets);
    }
  }
}

/** Lists the cell in the device lookups its terrain belongs to. */
function registerDevices(w: EpoxyWorld, x: number, y: number, terrainId: string, coversTargets: boolean): void {
  const tile = ConfigRegistry.getTile(terrainId);
  if (tile.buttonAction === 'hold_trap') w.holdTrapButtons.push({ x, y });
  if (tile.laserEmitter) w.laserEmitters.push({ x, y, dir: tile.laserEmitter });
  if (tile.shotLauncher) {
    w.hasLaunchers = true;
    w.shotStepTicks = tile.shotLauncher.stepTicks;
  }
  if (tile.laserReceiverGroup !== undefined) w.laserReceivers.push({ x, y });
  if (tile.laserGateGroup !== undefined) w.laserGates.push({ x, y });
  if (tile.plateColor !== undefined) w.plates.push({ x, y, color: tile.plateColor });
  if (tile.holdDoorColor !== undefined) w.holdDoors.push({ x, y, color: tile.holdDoorColor });
  if (coversTargets && terrainId === BLOCK_TARGET_TILE_ID) w.targetCells.push({ x, y });
  if (tile.isTeleporter) {
    const group = tile.teleportGroup ?? DEFAULT_TELEPORT_GROUP;
    const list = w.teleportersByGroup.get(group);
    if (list) {
      list.push({ x, y });
    } else {
      w.teleportersByGroup.set(group, [{ x, y }]);
    }
  }
}

/**
 * Whether the cell still hides its underlay: it has one, still holds the top the level started with and has
 * not revealed it yet.
 */
export function isCovered(w: EpoxyWorld, x: number, y: number): boolean {
  const width = mapWidth(w);
  return (
    underlayAt(w.underlays, width, x, y) !== undefined &&
    w.terrain[y][x] === w.level.terrain[y][x] &&
    !w.revealedCells.has(y * width + x)
  );
}

/**
 * The groups of the laser receivers that are lit now. A receiver hidden under a removable top is no
 * receiver until revealed: only the terrain at a lit cell counts.
 */
export function litLaserGroups(w: EpoxyWorld): Set<string> {
  const litGroups = new Set<string>();
  for (const { x, y } of w.litReceiverCells) {
    const group = ConfigRegistry.getTile(w.terrain[y][x]).laserReceiverGroup;
    if (group !== undefined) litGroups.add(group);
  }
  return litGroups;
}

/**
 * The terrain a removable top reveals at the cell when the player removes it, or null when the cell
 * hides none, no longer holds the top the level started with, or has already revealed it. Pure: it
 * records nothing (see takeRevealedTerrain).
 */
export function revealedTerrain(w: EpoxyWorld, x: number, y: number): string | null {
  if (!isCovered(w, x, y)) return null;
  const hidden = underlayAt(w.underlays, mapWidth(w), x, y) as string;
  const tile = ConfigRegistry.getTile(hidden);
  // A toggle wall or flame jet shows the form the presses of its family have left it in.
  const parityBit = toggleParityBitOf(tile);
  if (parityBit !== 0 && (w.toggleParity & parityBit) !== 0) return toggleWallOtherForm(tile) ?? hidden;
  // A hold door shows the form its colour's plates call for now.
  if (tile.holdDoorColor !== undefined && tile.holdDoorTogglesTo !== undefined) {
    const wantsOpen = visibleHoldDoorForm(w, tile.holdDoorColor) ?? holdColorsOpen(w).get(tile.holdDoorColor) === true;
    return tile.holdDoorOpen === wantsOpen ? hidden : tile.holdDoorTogglesTo;
  }
  // A laser gate shows the form its receivers call for now: open while its group is lit.
  if (tile.laserGateGroup !== undefined && tile.laserGateTogglesTo !== undefined) {
    const wantsOpen = litLaserGroups(w).has(tile.laserGateGroup);
    return tile.laserGateOpen === wantsOpen ? hidden : tile.laserGateTogglesTo;
  }
  return hidden;
}

/** Like revealedTerrain, and marks the cell as revealed when it hides something. Called where the reveal happens. */
export function takeRevealedTerrain(w: EpoxyWorld, x: number, y: number): string | null {
  const revealed = revealedTerrain(w, x, y);
  if (revealed !== null) w.revealedCells.add(y * mapWidth(w) + x);
  return revealed;
}

/** Whether a tile is a fish gate that lets every mover in now: no chip is left to collect. */
export function isOpenFishGate(w: EpoxyWorld, tile: TileDefinition): boolean {
  return tile.fishGate === true && w.chipsRemaining <= 0;
}

/**
 * A block or monster has entered an open fish gate: the gate turns into what it hid, or into its unlock terrain, the
 * way it does under the player (same sound and visual). The caller judges the arrival on what shows afterwards.
 * Does nothing on any other cell.
 */
export function consumeFishGate(ctx: EpoxyContext, x: number, y: number): void {
  const w = ctx.world;
  const tile = ConfigRegistry.getTile(w.terrain[y][x]);
  if (!isOpenFishGate(w, tile)) return;
  w.terrain[y][x] = takeRevealedTerrain(w, x, y) ?? (tile.transformsToOnUnlock || FLOOR_TILE_ID);
  AudioManager.playSfx('socket');
  ctx.emitVisual('unlock', x, y, 'yellow');
}

/** The open (true) or closed (false) form of a hold door of the colour in plain sight, undefined when none is. */
function visibleHoldDoorForm(w: EpoxyWorld, color: ChannelColor): boolean | undefined {
  for (const door of w.holdDoors) {
    const tile = ConfigRegistry.getTile(w.terrain[door.y][door.x]);
    if (tile.holdDoorColor === color && tile.holdDoorOpen !== undefined) return tile.holdDoorOpen;
  }
  return undefined;
}

/**
 * Whether each colour's hold doors are called open by its plates: open while the colour has at least one
 * plate and every one is pressed. A plate hidden under a cell that still holds its original top counts in
 * the total and is never pressed. A colour with no plate is absent from the map (its doors stay shut).
 */
export function holdColorsOpen(w: EpoxyWorld): Map<ChannelColor, boolean> {
  const open = new Map<ChannelColor, boolean>();
  const width = mapWidth(w);
  for (const plate of w.plates) {
    let pressed: boolean;
    if (ConfigRegistry.getTile(w.terrain[plate.y][plate.x]).plateColor === plate.color) {
      pressed = pressesPlate(w, plate.x, plate.y, plate.color);
    } else if (
      isCovered(w, plate.x, plate.y) &&
      ConfigRegistry.getTile(underlayAt(w.underlays, width, plate.x, plate.y) as string).plateColor === plate.color
    ) {
      pressed = false;
    } else {
      continue;
    }
    open.set(plate.color, (open.get(plate.color) ?? true) && pressed);
  }
  // A sink of the signal network counts as a pressed plate of its colour when on and an unpressed one when off.
  if (w.signals !== undefined) {
    for (const index of w.signals.network.sinkIndexes) {
      const color = w.signals.defs.get(index)?.color;
      if (color !== undefined) open.set(color, (open.get(color) ?? true) && signalSinkOn(w, index));
    }
  }
  return open;
}

/** True when the player holds the item: a key of that colour, or those boots. */
export function holdsItem(w: EpoxyWorld, itemId: string): boolean {
  return (w.player.keys[itemId] || 0) > 0 || w.player.boots.has(itemId);
}

export function isEdgeBlocked(
  w: EpoxyWorld,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  dir: Direction,
  beam = false,
  rail: RailActor = 'walker'
): boolean {
  if (isEdgeBlockedAt(w.terrain, w.edgeMask, fromX, fromY, toX, toY, dir, beam)) return true;
  // The tracks of a Chip's Challenge 2 track cell stop walkers, slides and blocks, never a beam or a shot.
  return !beam && w.railCells.size > 0 && railEdgeBlocked(w, fromX, fromY, toX, toY, dir, rail);
}

/**
 * Whether the player may stand on a tile: it must be passable and must not
 * bar an item they carry, on the terrain or through a no-sign on the item layer
 * (itemId, the item of the same cell). Walking and teleporting share this rule.
 */
export function canPlayerEnter(w: EpoxyWorld, tile: TileDefinition, itemId?: string | null): boolean {
  if (!tile.passableByPlayer) return false;
  const character = playerCharacterOf(w);
  // A gender sign is a wall for the other character; the boots a character needs on dirt and gravel are checked here too.
  if (tile.characterOnly !== undefined && tile.characterOnly !== character) return false;
  const neededBoots = tile.bootsForCharacter?.[character];
  if (neededBoots !== undefined && !w.player.boots.has(neededBoots)) return false;
  if (tile.forbiddenItem && holdsItem(w, tile.forbiddenItem)) return false;
  // A no-sign lying on the item layer bars the same way, and the terrain under it keeps working.
  return !barsCarriedItem(w, itemId);
}

/** Whether the item layer holds a no-sign for an item the player carries. */
function barsCarriedItem(w: EpoxyWorld, itemId: string | null | undefined): boolean {
  if (!itemId) return false;
  const barred = ConfigRegistry.getTile(itemId).forbiddenItem;
  return barred !== undefined && holdsItem(w, barred);
}

/**
 * The character the controlled player is now: its own character, which is the level's (Chip unless the level names
 * another) until a transmogrifier switches it. Each player of a level with several has its own.
 */
export function playerCharacterOf(w: EpoxyWorld): PlayerCharacter {
  return w.player.character ?? w.level.character ?? DEFAULT_PLAYER_CHARACTER;
}

/** Every player still on the map: the controlled one first, then the parked ones in swap order. */
export function playersOf(w: EpoxyWorld): readonly PlayerState[] {
  return w.parked.length === 0 ? [w.player] : [w.player, ...w.parked];
}

/** The living player standing on the cell, controlled or parked; undefined when none. */
export function playerAtCell(w: EpoxyWorld, x: number, y: number): PlayerState | undefined {
  if (w.player.alive && w.player.x === x && w.player.y === y) return w.player;
  for (const p of w.parked) {
    if (p.alive && p.x === x && p.y === y) return p;
  }
  return undefined;
}

/**
 * Runs `fn` with the parked player `p` as the controlled one, so the single-player code (slides, force floors, hazards,
 * pick-ups) serves it unchanged. The controlled player is back afterwards, except when `p` died: a dead player stays
 * in the controlled slot (the level is lost, and the death is read from there). A player that left through an exit
 * is dropped.
 */
export function withPlayer<T>(w: EpoxyWorld, p: PlayerState, fn: () => T): T {
  const index = w.parked.indexOf(p);
  if (index < 0) return fn();
  const active = w.player;
  const outerSwap = w.swappedIn;
  w.player = p;
  w.parked[index] = active;
  w.swappedIn = p;
  try {
    return fn();
  } finally {
    w.swappedIn = outerSwap;
    if (w.player !== p) {
      // A death during the callback already promoted the dead player to the controlled slot, and every other player is
      // in the queue exactly once: restoring by slot would duplicate `p` and lose the dead one. Only drop `p` if it left.
      if (p.exited === true) w.parked.splice(w.parked.indexOf(p), 1);
    } else if (p.exited === true) {
      // The slot holds the controlled player again; the exited one is gone.
      w.player = active;
      w.parked.splice(index, 1);
    } else if (p.alive) {
      w.player = active;
      w.parked[index] = p;
    }
  }
}

/**
 * Lets the controlled player leave through an exit (or completes the level when it is the last one). A player that
 * leaves while others remain is flagged `exited`; it is dropped by `withPlayer` when it was a parked player taking its
 * own step, and by `dropExitedController` when it was the controlled one (the next player then takes control).
 * Returns true when the level is complete.
 */
export function leaveThroughExit(w: EpoxyWorld): boolean {
  if (w.parked.length === 0) return true;
  w.player.exited = true;
  w.exitedPlayers++;
  return false;
}

/** Drops the controlled player once it has left through an exit and hands control to the next one; true when it did. */
export function dropExitedController(w: EpoxyWorld): boolean {
  if (w.player.exited !== true || w.swappedIn !== null) return false;
  const next = w.parked.shift();
  if (next !== undefined) w.player = next;
  return true;
}

/**
 * Hands control to the next parked player; the controlled one goes to the back of the queue. False when nobody is parked.
 * Cooldowns are left as they are, as Lexy's Labyrinth `swap_players` only clears the remembered moves: a player that
 * receives control mid-slide keeps sliding and its move cooldown has kept running down while it was parked.
 */
export function rotatePlayers(w: EpoxyWorld): boolean {
  const next = w.parked.shift();
  if (next === undefined) return false;
  w.parked.push(w.player);
  w.player = next;
  return true;
}

/** Kills `p`, controlled or parked: a parked player that dies takes the controlled slot, as the level is lost. */
export function killPlayerAt(ctx: EpoxyContext, p: PlayerState, reasonKey: string, sfxId: string): void {
  const w = ctx.world;
  if (p !== w.player) {
    const index = w.parked.indexOf(p);
    if (index >= 0) {
      w.parked[index] = w.player;
      w.player = p;
    }
  }
  killPlayer(ctx, reasonKey, sfxId);
}

/**
 * Whether the player cannot slide on a tile: the boots the tile names protect them, or they are a character who
 * never slides on ice (Melinda treats ice, corners included, as the player with ice skates does).
 */
export function playerGripsTile(w: EpoxyWorld, tile: TileDefinition): boolean {
  if (tile.protectedByItem !== undefined && w.player.boots.has(tile.protectedByItem)) return true;
  return tile.slideType === 'ice' && playerCharacterOf(w) === MELINDA_CHARACTER;
}

/** Who leaves a cell, for the tiles that judge the leaver (the CC2 turtle and pop-up wall, the open trap's button). */
export interface LeaveOptions {
  /** The monster or block that leaves; absent for the player. */
  leaver?: RuntimeEntity;
  /** The player that leaves; absent for a monster or a block. Its own cell must not hold the cell up. */
  leavingPlayer?: PlayerState;
  /** The leaver sinks nothing (a glider leaves a CC2 turtle afloat). */
  afloat?: boolean;
}

/**
 * Applies the terrain change, if any, of a cell the player, a monster or a block has just left. A CC2 turtle (a tile
 * that bars some monsters and sinks on leave) keeps afloat while another actor still stands on the cell, and behind a
 * leaver that leaves turtles afloat (Lexy's Labyrinth tiletypes.js, turtle.on_depart). A CC2 pop-up wall (a tile that
 * is held while occupied) waits while any other actor, a block, a monster or a player, still stands on the cell,
 * whoever leaves it. A brown button that nobody presses any more closes the open traps linked to it.
 */
export function leaveCell(w: EpoxyWorld, x: number, y: number, options?: LeaveOptions): void {
  const tile = ConfigRegistry.getTile(w.terrain[y][x]);
  if (tile.buttonAction === 'hold_trap') closeOpenTrapsOfButton(w, x, y, options);
  if (!tile.transformsToOnLeave) return;
  if (tile.heldWhileOccupied === true) {
    // Lexy's Labyrinth: a ghost, which the floor does not touch, never pops the wall it leaves.
    if (options?.leaver !== undefined && ConfigRegistry.getEntityDef(options.leaver.type)?.ignoresFloorEffects === true) return;
    if (otherActorStands(w, x, y, options)) return;
  } else if (tile.barsMonsters !== undefined) {
    if (options?.afloat === true) return;
    if (w.entities.some((e) => e !== options?.leaver && e.x === x && e.y === y)) return;
    // A player who stays on the cell holds it up too (when a monster or a block is the one that leaves).
    if (options?.leaver !== undefined && playerAtCell(w, x, y) !== undefined) return;
  }
  w.terrain[y][x] = tile.transformsToOnLeave;
}

/** Whether an actor other than the leaver stands on the cell: an entity, or a player that is not the one leaving. */
function otherActorStands(w: EpoxyWorld, x: number, y: number, options?: LeaveOptions): boolean {
  if (w.entities.some((e) => e !== options?.leaver && e.x === x && e.y === y)) return true;
  return playersOf(w).some((p) => p.alive && p !== options?.leavingPlayer && p.x === x && p.y === y);
}

/**
 * A brown button has just lost the leaver: when nothing else presses it, every open trap linked to it closes into the
 * trap it names (the wired trap when a wire ends on it). The swap is terrain only, so an undo puts the open trap back.
 */
function closeOpenTrapsOfButton(w: EpoxyWorld, x: number, y: number, options?: LeaveOptions): void {
  if (!w.trapLinks.some((l) => l.buttonX === x && l.buttonY === y)) return;
  // A phasing monster (pressesPlates false in its definition) never worked the button, so its leaving frees nothing.
  const pressesButton = (e: RuntimeEntity): boolean =>
    !(e.kind === 'monster' && ConfigRegistry.getEntityDef(e.type)?.pressesPlates === false);
  if (options?.leaver !== undefined && !pressesButton(options.leaver)) return;
  if (w.entities.some((e) => e !== options?.leaver && e.x === x && e.y === y && pressesButton(e))) return;
  if (playersOf(w).some((p) => p.alive && p !== options?.leavingPlayer && p.x === x && p.y === y)) return;
  for (const link of w.trapLinks) {
    if (link.buttonX === x && link.buttonY === y) closeOpenTrapAt(w, link.trapX, link.trapY);
  }
}

/**
 * Closes the open trap in a cell: it becomes the trap it closes to, or the wired trap when a wire ends on the cell. Does
 * nothing on any other terrain. An actor that stands on the cell is held from now on, as in any closed trap.
 */
export function closeOpenTrapAt(w: EpoxyWorld, x: number, y: number): void {
  const tile = ConfigRegistry.getTile(w.terrain[y]?.[x]);
  if (tile.closesTo === undefined) return;
  const wired = tile.closesToWired !== undefined && w.signals?.network.indexOfCell.has(y * mapWidth(w) + x) === true;
  w.terrain[y][x] = wired ? (tile.closesToWired as string) : tile.closesTo;
}

/**
 * A monster leaves its cell. A monster that may enter turtles sinks the classic turtle it leaves unless it leaves them
 * afloat; on a CC2 turtle every monster takes part, and the turtle judges who leaves it. A pop-up wall, and the brown
 * button an open trap hangs on, are judged for every monster too.
 */
export function monsterLeavesCell(w: EpoxyWorld, entity: RuntimeEntity): void {
  const def = ConfigRegistry.getEntityDef(entity.type);
  const afloat = def?.leavesTurtlesAfloat === true;
  const tile = ConfigRegistry.getTile(w.terrain[entity.y][entity.x]);
  if (tile.barsMonsters !== undefined || tile.heldWhileOccupied === true || tile.buttonAction === 'hold_trap') {
    leaveCell(w, entity.x, entity.y, { leaver: entity, afloat });
  } else if (def?.entersTurtles === true && !afloat) {
    leaveCell(w, entity.x, entity.y);
  }
}

/**
 * Whether a level sink of the signal network is on now: its input is on, or a gray area button holds it on for this
 * settle. `index` is the node index (the order of the state arrays); a flip or firing sink never asks.
 */
export function signalSinkOn(w: EpoxyWorld, index: number): boolean {
  const runtime = w.signals;
  if (runtime === undefined) return false;
  return runtime.state.lastOutputs[index] || runtime.lit.has(runtime.network.nodes[index].cell);
}

/** Whether the cell holds a wired trap whose signal is on now (see signalSinkOn). */
function isWiredTrapPowered(w: EpoxyWorld, tx: number, ty: number): boolean {
  const runtime = w.signals;
  if (runtime === undefined) return false;
  const cell = ty * mapWidth(w) + tx;
  // A gray area button holds a trap on whether or not a wire ends on it.
  if (runtime.lit.has(cell)) return true;
  const index = runtime.network.indexOfCell.get(cell);
  return index !== undefined && runtime.defs.get(index)?.powers === true && signalSinkOn(w, index);
}

export function isCellClosedTrap(w: EpoxyWorld, tx: number, ty: number): boolean {
  const tile = ConfigRegistry.getTile(w.terrain[ty]?.[tx]);
  if (!tile.isTrap) return false;
  // A sealed trap holds for good: no button, wire or link works it.
  if (tile.sealedTrap === true) return true;
  // An open trap holds nothing until it closes into a trap.
  if (tile.closesTo !== undefined) return false;
  // A wired trap is also open while its signal is on, besides while a brown button is held.
  if (tile.wiredTrap === true && isWiredTrapPowered(w, tx, ty)) return false;

  const specificLinks = w.trapLinksByTrap.get(cellKey(tx, ty));
  if (specificLinks && specificLinks.length > 0) {
    return !specificLinks.some((l) => isButtonPressed(w, l.buttonX, l.buttonY));
  }

  // Unlinked trap: any held trap button releases it
  // A button hidden under a removable top is listed too, and presses nothing until the top is gone.
  return !w.holdTrapButtons.some(
    (b) => ConfigRegistry.getTile(w.terrain[b.y][b.x]).buttonAction === 'hold_trap' && isButtonPressed(w, b.x, b.y)
  );
}

export function isButtonPressed(w: EpoxyWorld, bx: number, by: number): boolean {
  if (w.player.x === bx && w.player.y === by) return true;
  if (w.parked.some((p) => p.x === bx && p.y === by)) return true;
  // A phasing monster (pressesPlates false in its definition) passes over a held button without working it.
  return w.entities.some((e) => e.x === bx && e.y === by && !(e.kind === 'monster' && ConfigRegistry.getEntityDef(e.type)?.pressesPlates === false));
}

/** On a converted CC3D level a monster presses a plate only once it rests (its step has ended). */
function isAtRest(w: EpoxyWorld, e: RuntimeEntity): boolean {
  return !(w.cc3dPace && e.kind === 'monster' && e.cooldownTicks > 0);
}

/**
 * Whether something presses the plate at a cell: the live player, a block at rest, its step ended (a colour block only
 * on a plate of its own colour) or a monster that presses plates. A sliding entity is passing, not
 * pressing. Brown buttons keep their own rule (`isButtonPressed`), which every occupant satisfies.
 */
export function pressesPlate(w: EpoxyWorld, x: number, y: number, color: ChannelColor): boolean {
  if (playerAtCell(w, x, y) !== undefined) return true;
  return w.entities.some((e) => e.x === x && e.y === y && !e.isSliding && e.arrivalTicks === undefined && isAtRest(w, e) && entityPressesPlate(e.type, e.kind, color));
}

/**
 * Whether an entity of this type, standing still on a plate of this colour, presses it: a block does
 * (a colour block only on a plate of its own colour) unless its definition says otherwise, a monster
 * unless it flies; an explicit `pressesPlates` in the definition wins in both cases.
 */
export function entityPressesPlate(type: string, kind: 'block' | 'monster', color: ChannelColor): boolean {
  const def = ConfigRegistry.getEntityDef(type);
  if (kind === 'block') {
    return def?.pressesPlates !== false && (def?.plateColor === undefined || def.plateColor === color);
  }
  return def?.pressesPlates ?? def?.flying !== true;
}

/**
 * Records an arrival on a cell for the pulse buttons of the signal network: the player, or a monster or block
 * that presses plates (the entity argument; null for the player). The next settle reads it and clears it. Does
 * nothing on a level without pulse buttons or toggle switches, or on a cell that is neither. A toggle switch flips
 * to its other form on every such arrival, at once.
 */
export function notePulseArrival(w: EpoxyWorld, x: number, y: number, entity: RuntimeEntity | null): void {
  const runtime = w.signals;
  const cell = y * mapWidth(w) + x;
  const isPulse = runtime?.pulseCells.has(cell) === true;
  // An unwired toggle switch still changes form (only the level reading needs the network), so the tile decides.
  const isToggle = ConfigRegistry.getTile(w.terrain[y][x]).signalSource === 'toggle';
  if (!isPulse && !isToggle) return;
  if (entity !== null) {
    const ownColor: ChannelColor = ConfigRegistry.getEntityDef(entity.type)?.plateColor ?? 'red';
    if (!entityPressesPlate(entity.type, entity.kind, ownColor)) return;
  }
  if (isPulse) runtime?.pending.add(cell);
  // A toggle switch becomes its other form at every arrival; the next settle reads the new level as a change.
  if (isToggle) {
    const twin = ConfigRegistry.getTile(w.terrain[y][x]).signalToggleTwin;
    if (twin !== undefined) {
      w.terrain[y][x] = twin;
      AudioManager.playSfx(TOGGLE_SWITCH_SFX);
    }
  }
}

export function killPlayer(ctx: EpoxyContext, reasonKey: string, sfxId: string): void {
  const w = ctx.world;
  w.player.alive = false;
  w.player.isSliding = false;
  w.player.deathReasonKey = reasonKey;
  ctx.emitVisual('explosion', w.player.x, w.player.y, 'red');
  AudioManager.playSfx(sfxId);
}

export function getEntityAt(w: EpoxyWorld, x: number, y: number): RuntimeEntity | undefined {
  return w.entities.find((e) => e.x === x && e.y === y);
}

/** The shot in the cell, if any. Two shots may share a cell: the first fired is returned. */
export function shotAt(w: EpoxyWorld, x: number, y: number): Shot | undefined {
  return w.shots.find((s) => s.x === x && s.y === y);
}

/**
 * Adds a cloned entity. On a classic-rules level the creature takes the first free slot of the list, as the classic
 * game does (a freed slot is reused, so the entity pass, which runs from the end of the list, reaches it in that
 * position); elsewhere it goes to the end.
 */
export function addClonedEntity(w: EpoxyWorld, entity: RuntimeEntity): void {
  if (!w.ccRules) {
    w.entities.push(entity);
    return;
  }
  const live = new Set(w.entities.map((e) => e.uid));
  const slots = w.ccSlots;
  for (let i = 0; i < slots.length; i++) {
    const held = slots[i];
    if (held !== null && !live.has(held)) slots[i] = null;
  }
  const free = slots.indexOf(null);
  if (free >= 0) slots[free] = entity.uid;
  else slots.push(entity.uid);
  const byUid = new Map<number, RuntimeEntity>(w.entities.map((e) => [e.uid, e]));
  byUid.set(entity.uid, entity);
  w.entities = slots.filter((u): u is number => u !== null && byUid.has(u)).map((u) => byUid.get(u) as RuntimeEntity);
}

export function removeEntity(w: EpoxyWorld, uid: number): void {
  w.entities = w.entities.filter((e) => e.uid !== uid);
  w.removedUids.add(uid);
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Width of the loaded level, in cells; levels set their own size. */
export function mapWidth(w: EpoxyWorld): number {
  return w.terrain[0]?.length ?? 0;
}

/** Height of the loaded level, in cells. */
export function mapHeight(w: EpoxyWorld): number {
  return w.terrain.length;
}

export function isInBounds(w: EpoxyWorld, x: number, y: number): boolean {
  return x >= 0 && x < mapWidth(w) && y >= 0 && y < mapHeight(w);
}

export function applyRelativeTurn(dir: Direction, turn: RelativeTurn): Direction {
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
