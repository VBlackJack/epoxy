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
import { LevelSizeBounds } from '../config/ConfigValidation';
import { FLOOR_TILE_ID, WALL_TILE_ID } from '../core/coreConstants';
import { Direction, LauncherLink, TileDefinition } from '../core/types';
import {
  EDITOR_CLONE_BUTTON_TILE,
  EDITOR_CLONER_TILE,
  EDITOR_DEFAULT_CLONE_TEMPLATE,
  EDITOR_SHOT_LAUNCHER_TILES,
  EDITOR_SHOT_TRIGGER_TILE,
  EDITOR_TRAP_BUTTON_TILE,
  EDITOR_TRAP_TILE
} from '../ui/uiConstants';
import { removeRailTracksWhere, replaceRailTracks, translateRailTracks } from './editorRailTracks';
import { edgesAt, removeEdgesWhere, replaceEdges, toggleSide, translate as translateEdges } from './editorCellEdges';
import { cloneMap, EditorMap } from './editorDocument';
import { pruneUnderlays, removeUnderlaysWhere, replaceUnderlays, translateUnderlays, underlayAt } from './editorUnderlays';
import {
  dropLauncherLinksAt,
  holdsShotLauncher,
  holdsShotTrigger,
  isShotLauncherTile,
  isShotTriggerTile,
  launcherLinkTouches,
  pruneLauncherLinks,
  setLauncherLinks,
  translateLauncherLinks
} from './editorLauncherLinks';
import {
  appendSignalLink,
  dropSignalLinksAt,
  dropSignalPair,
  hasSignalLink,
  pruneSignalLinks,
  setSignalLinks,
  signalLinkClosesCycle,
  signalLinkCountAt,
  signalLinkTouches,
  signalTileHoldsEnd,
  signalTileTakesOneInput,
  translateSignalLinks
} from './editorSignalLinks';
import { anchorOffset, ResizeAnchor, TOP_LEFT_ANCHOR } from './resizeAnchor';

/** Outcome of a map edit. The input map is never modified; `map` is a new state. */
export interface MapEditResult {
  map: EditorMap;
  /** False when the edit left the map as it was (out of the grid, same tile, refused). */
  changed: boolean;
  /** Trap and clone links removed because one of their cells was overwritten or erased. */
  removedLinks: number;
  /** Hidden terrain removed because the terrain on top of it changed to something that can no longer hide it, or its cell was erased. */
  removedUnderlays: number;
  /** True when the edit hit the player start cell and left the start in place (eraser). */
  playerStartKept: boolean;
  /** Clone machines whose stored template followed the creature now standing on them. */
  clonerTemplates?: ClonerTemplateChange[];
}

/** A clone machine whose link template now copies the creature standing on it. */
export interface ClonerTemplateChange {
  x: number;
  y: number;
  type: string;
  dir: Direction;
}

/** What a resize dropped or moved, so the UI can say it. */
export interface ResizeReport {
  droppedEntities: number;
  droppedTrapLinks: number;
  droppedCloneLinks: number;
  /** Shot trigger to launcher links that lost an end; absent from a report that dropped none. */
  droppedLauncherLinks?: number;
  /** Signal links that lost an end; absent from a report that dropped none. */
  droppedSignalLinks?: number;
  /** Cells that lost their thin walls: cropped away, or turned to wall by the new border. */
  droppedEdges: number;
  /** Cells that lost their hidden terrain: cropped away, turned to wall by the new border, or no longer under a top that can hide it. */
  droppedUnderlays: number;
  /** True when the player start had to be moved to stay inside the new map. */
  playerStartMoved: boolean;
  /** True when the outer ring of the new map was set to wall. */
  borderKept: boolean;
}

export interface ResizeResult {
  map: EditorMap;
  /** Width and height actually applied, after clamping to the bounds. */
  width: number;
  height: number;
  /** False when the requested size equals the current one. */
  changed: boolean;
  report: ResizeReport;
}

/** Number of columns of a map. */
export function mapWidthOf(map: EditorMap): number {
  return map.terrain[0]?.length ?? 0;
}

/** Number of rows of a map. */
export function mapHeightOf(map: EditorMap): number {
  return map.terrain.length;
}

function inGrid(map: EditorMap, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < mapWidthOf(map) && y < mapHeightOf(map);
}

function unchanged(map: EditorMap): MapEditResult {
  return { map, changed: false, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/**
 * True when changing a terrain tile keeps the launcher links of its cell: a launcher turned to another facing is
 * still a launcher, and a trigger replaced by a trigger is still a trigger.
 */
export function keepsLauncherLinks(oldTileId: string, newTileId: string): boolean {
  return (
    (isShotLauncherTile(oldTileId) && isShotLauncherTile(newTileId)) || (isShotTriggerTile(oldTileId) && isShotTriggerTile(newTileId))
  );
}

/**
 * True when the cell hides a shot trigger or launcher under its top: painting a removable top over it may keep the
 * device (and so its launcher links) hidden, which the caller settles with pruneLauncherLinks once the underlays are pruned.
 */
export function hidesShotDevice(map: EditorMap, x: number, y: number): boolean {
  const hidden = underlayAt(map, x, y);
  return isShotTriggerTile(hidden) || isShotLauncherTile(hidden);
}

/**
 * Removes every trap, clone, launcher and signal link that has an end on the cell; returns how many were removed.
 * With `keepLauncherLinks` the launcher links of the cell stay (see keepsLauncherLinks).
 */
export function dropLinksAt(map: EditorMap, x: number, y: number, keepLauncherLinks = false): number {
  const trapBefore = map.trapLinks.length;
  const cloneBefore = map.cloneLinks.length;
  map.trapLinks = map.trapLinks.filter(
    (l) => !(l.buttonX === x && l.buttonY === y) && !(l.trapX === x && l.trapY === y)
  );
  map.cloneLinks = map.cloneLinks.filter(
    (l) => !(l.buttonX === x && l.buttonY === y) && !(l.clonerX === x && l.clonerY === y)
  );
  const launcherDropped = keepLauncherLinks ? 0 : dropLauncherLinksAt(map, x, y);
  const signalDropped = dropSignalLinksAt(map, x, y);
  return trapBefore - map.trapLinks.length + (cloneBefore - map.cloneLinks.length) + launcherDropped + signalDropped;
}

/**
 * Paints a terrain tile. Overwriting a cell that is the button or the target
 * of a trap or clone link with another tile removes those links, so none is
 * left dangling. Painting the tile already there keeps them. Hidden terrain under the cell stays only while the
 * new tile can still hide it; otherwise it is removed and counted.
 */
export function paintTerrain(source: EditorMap, x: number, y: number, tileId: string): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y) || source.terrain[y][x] === tileId) return unchanged(source);
  const map = cloneMap(source);
  const previous = map.terrain[y][x];
  map.terrain[y][x] = tileId;
  const hidden = hidesShotDevice(map, x, y);
  let removedLinks = dropLinksAt(map, x, y, keepsLauncherLinks(previous, tileId) || hidden);
  const removedUnderlays = pruneUnderlays(map);
  // A cell that stops being a track cell loses its tracks.
  if (map.railTracks) replaceRailTracks(map, map.railTracks);
  // A device still hidden under the new top keeps its links; one that is gone loses them.
  if (hidden) removedLinks += pruneLauncherLinks(map) + pruneSignalLinks(map);
  return { map, changed: true, removedLinks, removedUnderlays, playerStartKept: false };
}

/** Paints an item (key, chip, boots...) on the item layer. */
export function paintItem(source: EditorMap, x: number, y: number, itemId: string): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y) || source.items[y][x] === itemId) return unchanged(source);
  const map = cloneMap(source);
  map.items[y][x] = itemId;
  return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/**
 * Toggles the thin wall on one side of a cell (Epoxy levels). The wall is one line shared by two cells: a
 * closed line (the cell's own wall, or the neighbour's matching one) is removed from both cells, an open one
 * is added to the cell only; a border side belongs to its cell. Terrain such as thin_wall_* is untouched.
 */
export function toggleCellEdge(source: EditorMap, x: number, y: number, side: Direction): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map keeps its thin walls in its own layers
  if (!inGrid(source, x, y)) return unchanged(source);
  const map = cloneMap(source);
  toggleSide(map, x, y, side);
  return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/**
 * Makes every clone link ending on the cell copy the creature standing there (the engine reads the stored template, the
 * creature on the cloner is what the author sees). Returns the change, or null when there is no creature, no link, or
 * nothing to update. Stored levels are never touched until an edit reaches their cloner.
 */
export function syncCloneTemplatesAt(map: EditorMap, x: number, y: number): ClonerTemplateChange | null {
  const entity = map.entities.find((e) => e.x === x && e.y === y);
  if (!entity) return null;
  let changed = false;
  map.cloneLinks = map.cloneLinks.map((l) => {
    if (l.clonerX !== x || l.clonerY !== y || (l.templateType === entity.type && l.templateDir === entity.dir)) return l;
    changed = true;
    return { ...l, templateType: entity.type, templateDir: entity.dir };
  });
  return changed ? { x, y, type: entity.type, dir: entity.dir } : null;
}

/** Places an entity, replacing the one already on the cell. A clone link ending on the cell copies it as its template. */
export function paintEntity(source: EditorMap, x: number, y: number, type: string, dir: Direction): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y)) return unchanged(source);
  const present = source.entities.filter((e) => e.x === x && e.y === y);
  const map = cloneMap(source);
  if (present.length === 1 && present[0].type === type && present[0].dir === dir) {
    // Same creature already there: a user repaint still re-syncs a link template that drifted from it.
    const resynced = syncCloneTemplatesAt(map, x, y);
    if (!resynced) return unchanged(source);
    return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false, clonerTemplates: [resynced] };
  }
  map.entities = map.entities.filter((e) => !(e.x === x && e.y === y));
  map.entities.push({ x, y, type, dir });
  const synced = syncCloneTemplatesAt(map, x, y);
  return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false, ...(synced ? { clonerTemplates: [synced] } : {}) };
}

/** Moves the player start. */
export function paintPlayerStart(source: EditorMap, x: number, y: number, dir: Direction): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y)) return unchanged(source);
  const start = source.playerStart;
  if (start.x === x && start.y === y && start.dir === dir) return unchanged(source);
  const map = cloneMap(source);
  map.playerStart = { x, y, dir };
  delete map.missingStart;
  return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false };
}

/**
 * Erases a cell: floor terrain, no item, no entity, no link, no thin wall, no hidden terrain. The player start
 * is never erased; when it sits on the cell the result reports `playerStartKept`.
 */
export function eraseCell(source: EditorMap, x: number, y: number): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y)) return unchanged(source);
  const playerStartKept = source.playerStart.x === x && source.playerStart.y === y;
  const empty =
    source.terrain[y][x] === FLOOR_TILE_ID &&
    source.items[y][x] === null &&
    !source.entities.some((e) => e.x === x && e.y === y) &&
    edgesAt(source, x, y).length === 0 &&
    underlayAt(source, x, y) === undefined &&
    !source.trapLinks.some((l) => (l.buttonX === x && l.buttonY === y) || (l.trapX === x && l.trapY === y)) &&
    !source.cloneLinks.some((l) => (l.buttonX === x && l.buttonY === y) || (l.clonerX === x && l.clonerY === y)) &&
    !(source.launcherLinks ?? []).some((l) => launcherLinkTouches(l, x, y)) &&
    !(source.signalLinks ?? []).some((l) => signalLinkTouches(l, x, y));
  if (empty) return { ...unchanged(source), playerStartKept };
  const map = cloneMap(source);
  map.terrain[y][x] = FLOOR_TILE_ID;
  map.items[y][x] = null;
  map.entities = map.entities.filter((e) => !(e.x === x && e.y === y));
  removeEdgesWhere(map, (ex, ey) => ex === x && ey === y);
  const removedUnderlays = removeUnderlaysWhere(map, (ux, uy) => ux === x && uy === y);
  removeRailTracksWhere(map, (rx, ry) => rx === x && ry === y);
  const removedLinks = dropLinksAt(map, x, y);
  return { map, changed: true, removedLinks, removedUnderlays, playerStartKept };
}

/**
 * Replaces the 4-connected region of identical terrain that contains the cell
 * with `tileId`. Links that end on a replaced cell are removed, and so is hidden terrain the new tile cannot hide.
 */
export function floodFillTerrain(source: EditorMap, x: number, y: number, tileId: string): MapEditResult {
  if (source.cc3d) return unchanged(source); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, x, y)) return unchanged(source);
  const target = source.terrain[y][x];
  if (target === tileId) return unchanged(source);
  const map = cloneMap(source);
  const width = mapWidthOf(map);
  const height = mapHeightOf(map);
  const visited = new Set<number>();
  const queue: number[] = [y * width + x];
  let removedLinks = 0;
  let anyHidden = false;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    if (visited.has(index)) continue;
    visited.add(index);
    const cx = index % width;
    const cy = Math.floor(index / width);
    if (map.terrain[cy][cx] !== target) continue;
    map.terrain[cy][cx] = tileId;
    const hidden = hidesShotDevice(map, cx, cy);
    anyHidden ||= hidden;
    removedLinks += dropLinksAt(map, cx, cy, keepsLauncherLinks(target, tileId) || hidden);
    if (cx + 1 < width) queue.push(index + 1);
    if (cx > 0) queue.push(index - 1);
    if (cy + 1 < height) queue.push(index + width);
    if (cy > 0) queue.push(index - width);
  }
  const removedUnderlays = pruneUnderlays(map);
  if (map.railTracks) replaceRailTracks(map, map.railTracks);
  if (anyHidden) removedLinks += pruneLauncherLinks(map) + pruneSignalLinks(map);
  return { map, changed: true, removedLinks, removedUnderlays, playerStartKept: false };
}

/**
 * Removes the trap link joining a brown button to a trap, every duplicate of the pair. Unchanged (same map) when the
 * pair is absent or the map is a CC3D room. Nothing else is touched.
 */
export function removeTrapLink(
  source: EditorMap,
  button: { x: number; y: number },
  trap: { x: number; y: number }
): MapEditResult {
  if (source.cc3d) return unchanged(source);
  const joinsThePair = (l: EditorMap['trapLinks'][number]): boolean =>
    l.buttonX === button.x && l.buttonY === button.y && l.trapX === trap.x && l.trapY === trap.y;
  const removed = source.trapLinks.filter(joinsThePair).length;
  if (removed === 0) return unchanged(source);
  const map = cloneMap(source);
  map.trapLinks = map.trapLinks.filter((l) => !joinsThePair(l));
  return { map, changed: true, removedLinks: removed, removedUnderlays: 0, playerStartKept: false };
}

/**
 * Removes the clone link joining a red button to a clone machine, every duplicate of the pair. Unchanged (same map)
 * when the pair is absent or the map is a CC3D room.
 */
export function removeCloneLink(
  source: EditorMap,
  button: { x: number; y: number },
  cloner: { x: number; y: number }
): MapEditResult {
  if (source.cc3d) return unchanged(source);
  const joinsThePair = (l: EditorMap['cloneLinks'][number]): boolean =>
    l.buttonX === button.x && l.buttonY === button.y && l.clonerX === cloner.x && l.clonerY === cloner.y;
  const removed = source.cloneLinks.filter(joinsThePair).length;
  if (removed === 0) return unchanged(source);
  const map = cloneMap(source);
  map.cloneLinks = map.cloneLinks.filter((l) => !joinsThePair(l));
  return { map, changed: true, removedLinks: removed, removedUnderlays: 0, playerStartKept: false };
}

/**
 * Removes the launcher link joining a shot trigger to a shot launcher, every duplicate of the pair, through
 * setLauncherLinks. Unchanged (same map) when the pair is absent or the map is a CC3D room. Unlike
 * toggleLink it never adds a link or paints a launcher.
 */
export function removeLauncherLink(
  source: EditorMap,
  trigger: { x: number; y: number },
  launcher: { x: number; y: number }
): MapEditResult {
  if (source.cc3d) return unchanged(source);
  const joinsThePair = (l: LauncherLink): boolean =>
    l.buttonX === trigger.x && l.buttonY === trigger.y && l.launcherX === launcher.x && l.launcherY === launcher.y;
  const removed = (source.launcherLinks ?? []).filter(joinsThePair).length;
  if (removed === 0) return unchanged(source);
  const map = cloneMap(source);
  setLauncherLinks(map, (map.launcherLinks ?? []).filter((l) => !joinsThePair(l)));
  return { map, changed: true, removedLinks: removed, removedUnderlays: 0, playerStartKept: false };
}

/**
 * Removes the one signal link from the output cell to the input cell, as one edit on a copy. Unchanged (same map)
 * when the link is absent or the map is a CC3D room.
 */
export function removeSignalLink(source: EditorMap, from: { x: number; y: number }, to: { x: number; y: number }): MapEditResult {
  if (source.cc3d || !hasSignalLink(source, from, to)) return unchanged(source);
  const map = cloneMap(source);
  dropSignalPair(map, from, to);
  return { map, changed: true, removedLinks: 1, removedUnderlays: 0, playerStartKept: false };
}

/**
 * The mechanisms a link session works: brown button to trap, red button to clone machine, shot trigger to launcher,
 * and signal output (plate, receiver or gate) to signal input (gate or hold door).
 */
export type LinkSystem = 'trap' | 'clone' | 'shot' | 'signal';

/** The systems whose links the Lynx ruleset can carry (one link per button). */
export type ButtonLinkSystem = Exclude<LinkSystem, 'shot' | 'signal'>;

/**
 * Which end of a link a device is: the button (or shot trigger, or signal output) that works it, or the target it
 * works (or signal input).
 */
export type LinkEnd = 'button' | 'target';

/** Why a link edit was refused. */
export type LinkRefusal = 'same_cell' | 'missing_button' | 'missing_target' | 'not_free' | 'cycle' | 'single_input';

/** Outcome of a link edit. */
export interface LinkEditResult extends MapEditResult {
  /** True when the edit was refused; `refusal` says why. */
  refused: boolean;
  refusal?: LinkRefusal;
  /** What the edit did to the link, when it did something to a pair. */
  action?: 'linked' | 'unlinked';
  /**
   * How many links the button end has in this system after the edit (the count before it when the edit changed nothing);
   * placePartnerAndLink counts the links of the device it started from instead.
   */
  count: number;
  /** True when a clone link ended on a clone machine with no creature, so the link got the default template. */
  emptyCloner?: boolean;
  /** The template a new clone link stores. */
  template?: { type: string; dir: Direction };
  /** Other links of the button that a Lynx edit replaced. */
  replaced?: number;
  /** The tile a placement painted. */
  placed?: string;
}

/** Facing a clone link template takes when no creature stands on the cloner and the caller gave none. */
const DEFAULT_LINK_CLONE_DIR: Direction = 'S';

type Cell = { x: number; y: number };

function tileDefinitionOf(id: string | undefined): TileDefinition | undefined {
  return id !== undefined && ConfigRegistry.isTerrainTile(id) ? ConfigRegistry.getTile(id) : undefined;
}

function tileHoldsLinkEnd(tile: TileDefinition | undefined, system: ButtonLinkSystem, end: LinkEnd): boolean {
  if (!tile) return false;
  if (end === 'button') return tile.buttonAction === (system === 'trap' ? 'hold_trap' : 'trigger_cloner');
  return (system === 'trap' ? tile.isTrap : tile.isCloneMachine) === true;
}

/**
 * Whether the cell holds that end of that system where the engine reads it: on the top tile for traps and clone
 * machines (and their buttons), on top or hidden under a removable top for a shot trigger and launcher.
 */
export function holdsLinkEnd(map: EditorMap, system: LinkSystem, end: LinkEnd, x: number, y: number): boolean {
  if (system === 'shot') return end === 'button' ? holdsShotTrigger(map, x, y) : holdsShotLauncher(map, x, y);
  if (system === 'signal') return signalTileHoldsEnd(tileDefinitionOf(map.terrain[y]?.[x]), end === 'button' ? 'output' : 'input');
  return tileHoldsLinkEnd(tileDefinitionOf(map.terrain[y]?.[x]), system, end);
}

/** Whether a trap or clone device of that end is hidden under the top tile, where neither the engine nor the validator read it. */
export function hidesLinkEnd(map: EditorMap, system: LinkSystem, end: LinkEnd, x: number, y: number): boolean {
  if (system === 'signal') return signalTileHoldsEnd(tileDefinitionOf(underlayAt(map, x, y)), end === 'button' ? 'output' : 'input');
  return system !== 'shot' && tileHoldsLinkEnd(tileDefinitionOf(underlayAt(map, x, y)), system, end);
}

/** How many links of the system have that end on the cell. */
export function linkCountAt(map: EditorMap, system: LinkSystem, end: LinkEnd, x: number, y: number): number {
  if (system === 'trap') {
    return map.trapLinks.filter((l) => (end === 'button' ? l.buttonX === x && l.buttonY === y : l.trapX === x && l.trapY === y)).length;
  }
  if (system === 'clone') {
    return map.cloneLinks.filter((l) => (end === 'button' ? l.buttonX === x && l.buttonY === y : l.clonerX === x && l.clonerY === y)).length;
  }
  if (system === 'signal') return signalLinkCountAt(map, end === 'button' ? 'output' : 'input', x, y);
  return (map.launcherLinks ?? []).filter((l) => (end === 'button' ? l.buttonX === x && l.buttonY === y : l.launcherX === x && l.launcherY === y)).length;
}

/** Whether a link of the system joins the two cells. */
export function hasLink(map: EditorMap, system: LinkSystem, button: Cell, target: Cell): boolean {
  if (system === 'trap') {
    return map.trapLinks.some((l) => l.buttonX === button.x && l.buttonY === button.y && l.trapX === target.x && l.trapY === target.y);
  }
  if (system === 'clone') {
    return map.cloneLinks.some((l) => l.buttonX === button.x && l.buttonY === button.y && l.clonerX === target.x && l.clonerY === target.y);
  }
  if (system === 'signal') return hasSignalLink(map, button, target);
  return (map.launcherLinks ?? []).some(
    (l) => l.buttonX === button.x && l.buttonY === button.y && l.launcherX === target.x && l.launcherY === target.y
  );
}

/** Terrain a link session places for each end of a system; a launcher takes the facing. */
function partnerTile(system: LinkSystem, end: LinkEnd, dir: Direction): string {
  if (system === 'trap') return end === 'button' ? EDITOR_TRAP_BUTTON_TILE : EDITOR_TRAP_TILE;
  if (system === 'clone') return end === 'button' ? EDITOR_CLONE_BUTTON_TILE : EDITOR_CLONER_TILE;
  if (system === 'signal') throw new Error('A signal link places no partner tile');
  return end === 'button' ? EDITOR_SHOT_TRIGGER_TILE : EDITOR_SHOT_LAUNCHER_TILES[dir];
}

/** Why two cells cannot be linked, when they cannot. */
function endsRefusal(map: EditorMap, system: LinkSystem, button: Cell, target: Cell): LinkRefusal | undefined {
  if (button.x === target.x && button.y === target.y) return 'same_cell';
  if (!holdsLinkEnd(map, system, 'button', button.x, button.y)) return 'missing_button';
  if (!holdsLinkEnd(map, system, 'target', target.x, target.y)) return 'missing_target';
  if (system === 'signal' && !hasSignalLink(map, button, target)) {
    // A hold door and a NOT gate take one signal; the validator refuses more (join them with an OR gate).
    const takesOne = tileDefinitionOf(map.terrain[target.y]?.[target.x]);
    if ((signalTileTakesOneInput(takesOne) || takesOne?.signalGate === 'not') && signalLinkCountAt(map, 'input', target.x, target.y) > 0) {
      return 'single_input';
    }
    if (signalLinkClosesCycle(map, button, target)) return 'cycle';
  }
  return undefined;
}

function dropPair(map: EditorMap, system: LinkSystem, button: Cell, target: Cell): void {
  if (system === 'trap') {
    map.trapLinks = map.trapLinks.filter((l) => !(l.buttonX === button.x && l.buttonY === button.y && l.trapX === target.x && l.trapY === target.y));
  } else if (system === 'clone') {
    map.cloneLinks = map.cloneLinks.filter((l) => !(l.buttonX === button.x && l.buttonY === button.y && l.clonerX === target.x && l.clonerY === target.y));
  } else if (system === 'signal') {
    dropSignalPair(map, button, target);
  } else {
    setLauncherLinks(
      map,
      (map.launcherLinks ?? []).filter((l) => !(l.buttonX === button.x && l.buttonY === button.y && l.launcherX === target.x && l.launcherY === target.y))
    );
  }
}

/** Removes the links of the button that do not go to the target; returns how many. */
function dropOtherLinksOf(map: EditorMap, system: ButtonLinkSystem, button: Cell, target: Cell): number {
  const before = linkCountAt(map, system, 'button', button.x, button.y);
  if (system === 'trap') {
    map.trapLinks = map.trapLinks.filter((l) => !(l.buttonX === button.x && l.buttonY === button.y) || (l.trapX === target.x && l.trapY === target.y));
  } else {
    map.cloneLinks = map.cloneLinks.filter(
      (l) => !(l.buttonX === button.x && l.buttonY === button.y) || (l.clonerX === target.x && l.clonerY === target.y)
    );
  }
  return before - linkCountAt(map, system, 'button', button.x, button.y);
}

/**
 * Records the link in a map the caller already copied. A clone link copies the creature standing on the cloner, else
 * the default template facing `cloneDir`.
 */
function appendLink(map: EditorMap, system: LinkSystem, button: Cell, target: Cell, cloneDir: Direction): Pick<LinkEditResult, 'emptyCloner' | 'template'> {
  if (system === 'trap') {
    map.trapLinks.push({ buttonX: button.x, buttonY: button.y, trapX: target.x, trapY: target.y });
    return {};
  }
  if (system === 'clone') {
    const onCloner = map.entities.find((e) => e.x === target.x && e.y === target.y);
    const template = { type: onCloner?.type ?? EDITOR_DEFAULT_CLONE_TEMPLATE, dir: onCloner?.dir ?? cloneDir };
    map.cloneLinks.push({
      buttonX: button.x,
      buttonY: button.y,
      clonerX: target.x,
      clonerY: target.y,
      templateType: template.type,
      templateDir: template.dir
    });
    return { template, ...(onCloner === undefined ? { emptyCloner: true } : {}) };
  }
  if (system === 'signal') {
    appendSignalLink(map, button, target);
    return {};
  }
  setLauncherLinks(map, [...(map.launcherLinks ?? []), { buttonX: button.x, buttonY: button.y, launcherX: target.x, launcherY: target.y }]);
  return {};
}

/**
 * Adds one link between two devices that already stand on the map, painting nothing. `replace` (Lynx) first removes
 * the other links of the button. Unchanged (same map) when the pair is already linked and the button has no other
 * link to replace, when the map is a CC3D room or a cell is outside the grid; refused when the cells are the same
 * or an end is not the device it should be.
 */
function linkDevices(source: EditorMap, system: LinkSystem, button: Cell, target: Cell, cloneDir: Direction, replace: boolean): LinkEditResult {
  const none = (refusal?: LinkRefusal): LinkEditResult => ({
    ...unchanged(source),
    refused: refusal !== undefined,
    ...(refusal ? { refusal } : {}),
    count: source.cc3d || !inGrid(source, button.x, button.y) ? 0 : linkCountAt(source, system, 'button', button.x, button.y)
  });
  if (source.cc3d) return none(); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, button.x, button.y) || !inGrid(source, target.x, target.y)) return none();
  const refusal = endsRefusal(source, system, button, target);
  if (refusal) return none(refusal);
  const exists = hasLink(source, system, button, target);
  const others = replace && system !== 'shot' && system !== 'signal' ? linkCountAt(source, system, 'button', button.x, button.y) - (exists ? 1 : 0) : 0;
  if (exists && others <= 0) return none();
  const map = cloneMap(source);
  const replaced = others > 0 && system !== 'shot' && system !== 'signal' ? dropOtherLinksOf(map, system, button, target) : 0;
  const added = exists ? {} : appendLink(map, system, button, target, cloneDir);
  return {
    map,
    changed: true,
    removedLinks: 0,
    removedUnderlays: 0,
    playerStartKept: false,
    refused: false,
    action: 'linked',
    count: linkCountAt(map, system, 'button', button.x, button.y),
    ...added,
    ...(replaced > 0 ? { replaced } : {})
  };
}

/** Links a brown button to a trap, both already on the map. Nothing is painted; a pair already linked leaves the same map. */
export function addTrapLink(source: EditorMap, button: Cell, trap: Cell): LinkEditResult {
  return linkDevices(source, 'trap', button, trap, DEFAULT_LINK_CLONE_DIR, false);
}

/**
 * Links a red button to a clone machine, both already on the map. The template copies the creature on the cloner, else
 * the default template facing `fallbackDir` (and the result says `emptyCloner`).
 */
export function addCloneLink(source: EditorMap, button: Cell, cloner: Cell, fallbackDir: Direction): LinkEditResult {
  return linkDevices(source, 'clone', button, cloner, fallbackDir, false);
}

/** Links a shot trigger to a shot launcher, both already on the map (hidden under a removable top is fine). */
export function addLauncherLink(source: EditorMap, trigger: Cell, launcher: Cell): LinkEditResult {
  return linkDevices(source, 'shot', trigger, launcher, DEFAULT_LINK_CLONE_DIR, false);
}

/**
 * Links the pair when it is not linked, unlinks it (every duplicate) when it is. Never paints. `dir` is the clone
 * link's fallback facing. Refused like the add functions; an existing pair is unlinked even if a device is gone.
 */
export function toggleLink(source: EditorMap, system: LinkSystem, button: Cell, target: Cell, dir: Direction): LinkEditResult {
  if (!source.cc3d && inGrid(source, button.x, button.y) && inGrid(source, target.x, target.y) && hasLink(source, system, button, target)) {
    const map = cloneMap(source);
    dropPair(map, system, button, target);
    const count = linkCountAt(map, system, 'button', button.x, button.y);
    return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false, refused: false, action: 'unlinked', count };
  }
  return linkDevices(source, system, button, target, dir, false);
}

/**
 * Lynx: links the button to the target and removes the button's other links of that system (Lynx reads one link per
 * button). An existing pair stays; the result says how many other links were replaced. `dir` is the clone template's
 * fallback facing. Unchanged when the button already has exactly that link.
 */
export function replaceButtonLink(source: EditorMap, system: ButtonLinkSystem, button: Cell, target: Cell, dir: Direction): LinkEditResult {
  return linkDevices(source, system, button, target, dir, true);
}

/**
 * Puts the partner of a link session on a free floor cell and links it, as one edit. `sourceEnd` is the end the source
 * device holds: from a button the cell gets the trap, clone machine or launcher (facing `dir`), from a target a brown
 * button, red button or shot trigger. Free means the top tile is plain floor with no hidden terrain; items and creatures
 * on the cell stay (a creature on a new clone machine becomes the template). `replace` (Lynx) also removes the other
 * links of the button. Never touches an existing device: a cell that is not free is refused (`not_free`).
 */
export function placePartnerAndLink(
  source: EditorMap,
  system: LinkSystem,
  sourceEnd: LinkEnd,
  from: Cell,
  cell: Cell,
  dir: Direction,
  replace = false
): LinkEditResult {
  const none = (refusal?: LinkRefusal): LinkEditResult => ({
    ...unchanged(source),
    refused: refusal !== undefined,
    ...(refusal ? { refusal } : {}),
    count: source.cc3d || !inGrid(source, from.x, from.y) ? 0 : linkCountAt(source, system, sourceEnd, from.x, from.y)
  });
  if (source.cc3d) return none(); // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, from.x, from.y) || !inGrid(source, cell.x, cell.y)) return none();
  if (from.x === cell.x && from.y === cell.y) return none('same_cell');
  if (system === 'signal') return none('not_free'); // a signal wire joins two devices already placed: no partner is painted
  if (!holdsLinkEnd(source, system, sourceEnd, from.x, from.y)) return none(sourceEnd === 'button' ? 'missing_button' : 'missing_target');
  if (source.terrain[cell.y][cell.x] !== FLOOR_TILE_ID || underlayAt(source, cell.x, cell.y) !== undefined) return none('not_free');
  const partnerEnd: LinkEnd = sourceEnd === 'button' ? 'target' : 'button';
  const tile = partnerTile(system, partnerEnd, dir);
  const painted = paintTerrain(source, cell.x, cell.y, tile);
  const button = sourceEnd === 'button' ? from : cell;
  const target = sourceEnd === 'button' ? cell : from;
  const linked = linkDevices(painted.map, system, button, target, dir, replace);
  if (linked.refused || !linked.map) return none(linked.refusal);
  return {
    ...linked,
    removedLinks: painted.removedLinks,
    removedUnderlays: painted.removedUnderlays,
    action: 'linked',
    count: linkCountAt(linked.map, system, sourceEnd, from.x, from.y),
    placed: tile
  };
}

function hasWallBorder(map: EditorMap): boolean {
  const width = mapWidthOf(map);
  const height = mapHeightOf(map);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (onBorder && map.terrain[y][x] !== WALL_TILE_ID) return false;
    }
  }
  return true;
}

/** Smallest side that still has an inside once ringed with walls. */
const MIN_BORDERED_SIZE = 3;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Resizes the map keeping the cell of the 3 x 3 `anchor` fixed (the top-left corner by default). New cells are floor.
 * When the old map was closed by a wall border, the new one is too: an old border cell that leaves its ring side turns
 * to floor (an entity on it is dropped; a cell holding an item stays wall), and the new outer ring is walled (items,
 * entities and links on a cell that becomes wall are dropped). Thin walls and hidden terrain stay with their cell
 * (translated then clamped): those outside the new bounds, on a cell that becomes wall, or (hidden terrain) under a
 * top that can no longer hide it are dropped and counted. Entities and links outside the new bounds are dropped; the
 * player start is clamped inside. The requested size is clamped to `bounds`.
 */
export function resizeMap(
  source: EditorMap,
  width: number,
  height: number,
  bounds: LevelSizeBounds,
  anchor: ResizeAnchor = TOP_LEFT_ANCHOR
): ResizeResult {
  if (source.cc3d) return { map: source, width: mapWidthOf(source), height: mapHeightOf(source), changed: false, report: { droppedEntities: 0, droppedTrapLinks: 0, droppedCloneLinks: 0, droppedEdges: 0, droppedUnderlays: 0, playerStartMoved: false, borderKept: false } }; // a CC3D map is edited through cc3dEdits only
  const oldWidth = mapWidthOf(source);
  const oldHeight = mapHeightOf(source);
  const newWidth = clamp(Math.floor(width), bounds.minSize, bounds.maxSize);
  const newHeight = clamp(Math.floor(height), bounds.minSize, bounds.maxSize);
  const report: ResizeReport = {
    droppedEntities: 0,
    droppedTrapLinks: 0,
    droppedCloneLinks: 0,
    droppedEdges: 0,
    droppedUnderlays: 0,
    playerStartMoved: false,
    borderKept: false
  };
  if (newWidth === oldWidth && newHeight === oldHeight) {
    return { map: source, width: newWidth, height: newHeight, changed: false, report };
  }

  const bordered = hasWallBorder(source);
  const { dx, dy } = anchorOffset(anchor, newWidth - oldWidth, newHeight - oldHeight);
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  // Old border cells turned to floor: an entity standing there is dropped.
  const opened = new Set<string>();
  for (let y = 0; y < newHeight; y++) {
    terrain.push([]);
    items.push([]);
    for (let x = 0; x < newWidth; x++) {
      const fromX = x - dx;
      const fromY = y - dy;
      const kept = fromX >= 0 && fromY >= 0 && fromX < oldWidth && fromY < oldHeight;
      let tile = kept ? source.terrain[fromY][fromX] : FLOOR_TILE_ID;
      const item = kept ? source.items[fromY][fromX] : null;
      // An old ring cell that has left its ring side is opened; the walling loop below re-walls it when it lands on the new ring.
      const leftRing =
        kept &&
        ((fromX === 0 && x !== 0) ||
          (fromX === oldWidth - 1 && x !== newWidth - 1) ||
          (fromY === 0 && y !== 0) ||
          (fromY === oldHeight - 1 && y !== newHeight - 1));
      if (bordered && leftRing && tile === WALL_TILE_ID && item === null) {
        tile = FLOOR_TILE_ID;
        opened.add(`${x},${y}`);
      }
      terrain[y].push(tile);
      items[y].push(item);
    }
  }

  // With a wall border the start stays inside it, when the side is big enough to have an inside.
  const lowX = bordered && newWidth >= MIN_BORDERED_SIZE ? 1 : 0;
  const lowY = bordered && newHeight >= MIN_BORDERED_SIZE ? 1 : 0;
  const movedStartX = source.playerStart.x + dx;
  const movedStartY = source.playerStart.y + dy;
  const startX = clamp(movedStartX, lowX, newWidth - 1 - lowX);
  const startY = clamp(movedStartY, lowY, newHeight - 1 - lowY);
  report.playerStartMoved = startX !== movedStartX || startY !== movedStartY;

  // Cells that turn to wall to close the new map.
  const walled = new Set<string>();
  if (bordered) {
    report.borderKept = true;
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        const onBorder = x === 0 || y === 0 || x === newWidth - 1 || y === newHeight - 1;
        if (!onBorder || terrain[y][x] === WALL_TILE_ID) continue;
        if (x === startX && y === startY) continue;
        terrain[y][x] = WALL_TILE_ID;
        items[y][x] = null;
        walled.add(`${x},${y}`);
      }
    }
  }

  const alive = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < newWidth && y < newHeight && !walled.has(`${x},${y}`);
  const entities = source.entities
    .map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }))
    .filter((e) => alive(e.x, e.y) && !opened.has(`${e.x},${e.y}`));
  report.droppedEntities = source.entities.length - entities.length;
  const trapLinks = source.trapLinks
    .map((l) => ({ ...l, buttonX: l.buttonX + dx, buttonY: l.buttonY + dy, trapX: l.trapX + dx, trapY: l.trapY + dy }))
    .filter((l) => alive(l.buttonX, l.buttonY) && alive(l.trapX, l.trapY));
  report.droppedTrapLinks = source.trapLinks.length - trapLinks.length;
  const cloneLinks = source.cloneLinks
    .map((l) => ({ ...l, buttonX: l.buttonX + dx, buttonY: l.buttonY + dy, clonerX: l.clonerX + dx, clonerY: l.clonerY + dy }))
    .filter((l) => alive(l.buttonX, l.buttonY) && alive(l.clonerX, l.clonerY));
  report.droppedCloneLinks = source.cloneLinks.length - cloneLinks.length;
  const launcherLinks = translateLauncherLinks(source.launcherLinks ?? [], dx, dy, newWidth, newHeight).filter(
    (l) => alive(l.buttonX, l.buttonY) && alive(l.launcherX, l.launcherY)
  );
  const droppedLauncherLinks = (source.launcherLinks?.length ?? 0) - launcherLinks.length;
  if (droppedLauncherLinks > 0) report.droppedLauncherLinks = droppedLauncherLinks;

  const signalLinks = translateSignalLinks(source.signalLinks ?? [], dx, dy, newWidth, newHeight).filter(
    (l) => alive(l.fromX, l.fromY) && alive(l.toX, l.toY)
  );
  const droppedSignalLinks = (source.signalLinks?.length ?? 0) - signalLinks.length;
  if (droppedSignalLinks > 0) report.droppedSignalLinks = droppedSignalLinks;

  const kept = translateEdges(source.cellEdges ?? [], dx, dy, newWidth, newHeight).filter((e) => alive(e.x, e.y));
  report.droppedEdges = (source.cellEdges?.length ?? 0) - kept.length;

  const resized: EditorMap = { terrain, items, entities, trapLinks, cloneLinks, playerStart: { x: startX, y: startY, dir: source.playerStart.dir } };
  if (source.missingStart) resized.missingStart = true;
  replaceEdges(resized, kept);
  setLauncherLinks(resized, launcherLinks);
  setSignalLinks(resized, signalLinks);
  // The hidden terrain stays with its cell, then only what the new terrain on top can still hide is kept.
  replaceUnderlays(resized, translateUnderlays(source.underlays ?? [], dx, dy, newWidth, newHeight).filter((u) => alive(u.x, u.y)));
  report.droppedUnderlays = (source.underlays?.length ?? 0) - (resized.underlays?.length ?? 0);
  // The track cells move with their cells; the editor does not edit them.
  replaceRailTracks(resized, translateRailTracks(source.railTracks ?? [], dx, dy, newWidth, newHeight).filter((t) => alive(t.x, t.y)));
  return {
    map: resized,
    width: newWidth,
    height: newHeight,
    changed: true,
    report
  };
}
