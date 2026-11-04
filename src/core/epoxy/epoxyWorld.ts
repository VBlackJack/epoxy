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
import { BLOCK_TARGET_TILE_ID } from '../coreConstants';
import { cellEdgeMask, isEdgeBlockedAt } from '../EdgeRules';
import { SeededRandom } from '../Random';
import {
  BeamCell,
  ButtonAction,
  ChannelColor,
  CloneLink,
  CompiledLevel,
  Direction,
  GridPoint,
  PlayerState,
  RelativeTurn,
  RuntimeEntity,
  TileDefinition,
  TrapLink
} from '../types';

/** Group of the teleporters that declare none: they all chain together. */
export const DEFAULT_TELEPORT_GROUP = '';
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
  player: PlayerState;
  /** Thin walls of the level's cell edges, one bit per side (see cellEdgeMask); static, null when none. */
  edgeMask: Uint8Array | null;

  chipsRemaining: number;
  /** Seconds gained from stopwatch items in this level, net of penalties. */
  extraTimeSeconds: number;
  /** Points from bonus flags, paid with the level score at the exit. */
  levelBonusPoints: number;
  /** Factor applied to the level score at the exit, raised by multiplier items. */
  levelScoreMultiplier: number;
  levelCompleted: boolean;
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
  beamCells: BeamCell[];
  litReceiverCells: GridPoint[];
  /** True while a mirror on a beam path is sliding. */
  beamHasSlidingMirror: boolean;
  beamDirty: boolean;
  removedUids: Set<number>;
  /** Set when a rejected player move still altered the grid (revealed wall, opened door). */
  gridMutatedByMove: boolean;
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
    edgeMask: null,
    chipsRemaining: 0,
    extraTimeSeconds: 0,
    levelBonusPoints: 0,
    levelScoreMultiplier: BASE_LEVEL_SCORE_MULTIPLIER,
    levelCompleted: false,
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
    litReceiverCells: [],
    beamHasSlidingMirror: false,
    beamDirty: true,
    removedUids: new Set<number>(),
    gridMutatedByMove: false
  };
}

export function buildLevelLookups(w: EpoxyWorld): void {
  w.edgeMask = cellEdgeMask(w.level);
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
  for (let y = 0; y < w.terrain.length; y++) {
    for (let x = 0; x < w.terrain[y].length; x++) {
      const tile = ConfigRegistry.getTile(w.terrain[y][x]);
      if (tile.buttonAction === 'hold_trap') w.holdTrapButtons.push({ x, y });
      if (tile.laserEmitter) w.laserEmitters.push({ x, y, dir: tile.laserEmitter });
      if (tile.laserReceiverGroup !== undefined) w.laserReceivers.push({ x, y });
      if (tile.laserGateGroup !== undefined) w.laserGates.push({ x, y });
      if (tile.plateColor !== undefined) w.plates.push({ x, y, color: tile.plateColor });
      if (tile.holdDoorColor !== undefined) w.holdDoors.push({ x, y, color: tile.holdDoorColor });
      if (coversTargets && w.terrain[y][x] === BLOCK_TARGET_TILE_ID) w.targetCells.push({ x, y });
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
  }
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
  dir: Direction
): boolean {
  return isEdgeBlockedAt(w.terrain, w.edgeMask, fromX, fromY, toX, toY, dir);
}

/**
 * Whether the player may stand on a tile: it must be passable and must not
 * bar an item they carry. Walking and teleporting share this rule.
 */
export function canPlayerEnter(w: EpoxyWorld, tile: TileDefinition): boolean {
  if (!tile.passableByPlayer) return false;
  return !(tile.forbiddenItem && holdsItem(w, tile.forbiddenItem));
}

/** Applies the terrain change, if any, of a cell the player or a block has just left. */
export function leaveCell(w: EpoxyWorld, x: number, y: number): void {
  const tile = ConfigRegistry.getTile(w.terrain[y][x]);
  if (tile.transformsToOnLeave) {
    w.terrain[y][x] = tile.transformsToOnLeave;
  }
}

export function isCellClosedTrap(w: EpoxyWorld, tx: number, ty: number): boolean {
  const tile = ConfigRegistry.getTile(w.terrain[ty]?.[tx]);
  if (!tile.isTrap) return false;

  const specificLinks = w.trapLinksByTrap.get(cellKey(tx, ty));
  if (specificLinks && specificLinks.length > 0) {
    return !specificLinks.some((l) => isButtonPressed(w, l.buttonX, l.buttonY));
  }

  // Unlinked trap: any held trap button releases it
  return !w.holdTrapButtons.some((b) => isButtonPressed(w, b.x, b.y));
}

export function isButtonPressed(w: EpoxyWorld, bx: number, by: number): boolean {
  if (w.player.x === bx && w.player.y === by) return true;
  return w.entities.some((e) => e.x === bx && e.y === by);
}

/**
 * Whether something presses the plate at a cell: the live player, a block at rest (a colour block only
 * on a plate of its own colour) or a monster that presses plates. A sliding entity is passing, not
 * pressing. Brown buttons keep their own rule (`isButtonPressed`), which every occupant satisfies.
 */
export function pressesPlate(w: EpoxyWorld, x: number, y: number, color: ChannelColor): boolean {
  if (w.player.alive && w.player.x === x && w.player.y === y) return true;
  return w.entities.some((e) => e.x === x && e.y === y && !e.isSliding && entityPressesPlate(e.type, e.kind, color));
}

/**
 * Whether an entity of this type, standing still on a plate of this colour, presses it: a block does
 * (a colour block only on a plate of its own colour) unless its definition says otherwise, a monster
 * only when its definition says so.
 */
export function entityPressesPlate(type: string, kind: 'block' | 'monster', color: ChannelColor): boolean {
  const def = ConfigRegistry.getEntityDef(type);
  if (kind === 'block') {
    return def?.pressesPlates !== false && (def?.plateColor === undefined || def.plateColor === color);
  }
  return def?.pressesPlates === true;
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
