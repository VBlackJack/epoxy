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

import { LevelSizeBounds } from '../config/ConfigValidation';
import { FLOOR_TILE_ID, WALL_TILE_ID } from '../core/coreConstants';
import { Direction, LauncherLink } from '../core/types';
import {
  EDITOR_CLONE_BUTTON_TILE,
  EDITOR_CLONER_TILE,
  EDITOR_DEFAULT_CLONE_TEMPLATE,
  EDITOR_SHOT_LAUNCHER_TILES,
  EDITOR_SHOT_TRIGGER_TILE,
  EDITOR_TRAP_BUTTON_TILE,
  EDITOR_TRAP_TILE
} from '../ui/uiConstants';
import { edgesAt, removeEdgesWhere, replaceEdges, toggleSide, translate as translateEdges } from './editorCellEdges';
import { cloneMap, EditorMap } from './editorDocument';
import { pruneUnderlays, removeUnderlaysWhere, replaceUnderlays, translateUnderlays, underlayAt } from './editorUnderlays';
import {
  dropLauncherLinksAt,
  holdsShotLauncher,
  holdsShotTrigger,
  isShotLauncherTile,
  isShotTriggerTile,
  launcherCountAt,
  launcherLinkTouches,
  pruneLauncherLinks,
  setLauncherLinks,
  translateLauncherLinks
} from './editorLauncherLinks';
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

/** Which kind of link a wire tool draws. */
export type WireKind = 'trap' | 'clone' | 'launcher';

/** The wires that close on a second click; the launcher wire stays open and toggles links until it is finished. */
export type LinkWireKind = Exclude<WireKind, 'launcher'>;

/** Outcome of closing a wire. */
export interface WireResult extends MapEditResult {
  /** True when the wire was refused; `refusal` says why. */
  refused: boolean;
  /** Why the wire was refused, when it was. */
  refusal?: WireRefusal;
  /** True when a clone wire ended on a clone machine with no creature on it, so the link got the default template. */
  emptyCloner?: boolean;
}

/** 'same_cell': source and target are one cell. 'missing_button': the source no longer holds the wire's button. */
export type WireRefusal = 'same_cell' | 'missing_button';

/** What a resize dropped or moved, so the UI can say it. */
export interface ResizeReport {
  droppedEntities: number;
  droppedTrapLinks: number;
  droppedCloneLinks: number;
  /** Shot trigger to launcher links that lost an end; absent from a report that dropped none. */
  droppedLauncherLinks?: number;
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
 * Removes every trap, clone and launcher link that has an end on the cell; returns how many were removed.
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
  return trapBefore - map.trapLinks.length + (cloneBefore - map.cloneLinks.length) + launcherDropped;
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
  // A device still hidden under the new top keeps its links; one that is gone loses them.
  if (hidden) removedLinks += pruneLauncherLinks(map);
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
    !(source.launcherLinks ?? []).some((l) => launcherLinkTouches(l, x, y));
  if (empty) return { ...unchanged(source), playerStartKept };
  const map = cloneMap(source);
  map.terrain[y][x] = FLOOR_TILE_ID;
  map.items[y][x] = null;
  map.entities = map.entities.filter((e) => !(e.x === x && e.y === y));
  removeEdgesWhere(map, (ex, ey) => ex === x && ey === y);
  const removedUnderlays = removeUnderlaysWhere(map, (ux, uy) => ux === x && uy === y);
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
  if (anyHidden) removedLinks += pruneLauncherLinks(map);
  return { map, changed: true, removedLinks, removedUnderlays, playerStartKept: false };
}

/** Terrain placed at the button end and at the target end of a wire. */
function wireTiles(kind: LinkWireKind): { button: string; target: string } {
  return kind === 'trap'
    ? { button: EDITOR_TRAP_BUTTON_TILE, target: EDITOR_TRAP_TILE }
    : { button: EDITOR_CLONE_BUTTON_TILE, target: EDITOR_CLONER_TILE };
}

/** The tile a wire tool puts at its button end (the shot trigger for the launcher wire). */
export function wireButtonTile(kind: WireKind): string {
  return kind === 'launcher' ? EDITOR_SHOT_TRIGGER_TILE : wireTiles(kind).button;
}

/** First click of a wire tool: puts the button tile on the source cell. */
export function placeWireButton(source: EditorMap, kind: LinkWireKind, x: number, y: number): MapEditResult {
  return paintTerrain(source, x, y, wireTiles(kind).button);
}

/** First click of the launcher wire on a cell that is no trigger: puts a shot trigger there. */
export function startLauncherWire(source: EditorMap, x: number, y: number): MapEditResult {
  return paintTerrain(source, x, y, EDITOR_SHOT_TRIGGER_TILE);
}

/** Outcome of a click on a launcher while a launcher wire is open. */
export interface LauncherLinkResult extends MapEditResult {
  /** True when the click was refused; `refusal` says why. */
  refused: boolean;
  refusal?: WireRefusal;
  /** What the click did to the link, when it did something. */
  action?: 'linked' | 'unlinked';
  /** How many launchers the trigger fires after the edit. */
  count: number;
}

/**
 * A click on a cell while a launcher wire is open: a launcher already linked to the trigger is unlinked; a launcher
 * not linked yet is linked and keeps its tile and facing; any other cell gets a shot launcher facing `facing` and is
 * linked. Every link change goes through setLauncherLinks. Refused (and unchanged) when the trigger is gone, or the
 * click is on the trigger itself.
 */
export function toggleLauncherLink(
  source: EditorMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  facing: Direction
): LauncherLinkResult {
  const none = (refusal?: WireRefusal): LauncherLinkResult => ({
    ...unchanged(source),
    refused: refusal !== undefined,
    ...(refusal ? { refusal } : {}),
    count: launcherCountAt(source, from.x, from.y)
  });
  if (source.cc3d) return none();
  if (!inGrid(source, from.x, from.y) || !inGrid(source, to.x, to.y)) return none();
  if (from.x === to.x && from.y === to.y) return none('same_cell');
  if (!holdsShotTrigger(source, from.x, from.y)) return none('missing_button');
  const joinsThePair = (l: LauncherLink): boolean =>
    l.buttonX === from.x && l.buttonY === from.y && l.launcherX === to.x && l.launcherY === to.y;
  if ((source.launcherLinks ?? []).some(joinsThePair)) {
    const map = cloneMap(source);
    setLauncherLinks(map, (map.launcherLinks ?? []).filter((l) => !joinsThePair(l)));
    return { map, changed: true, removedLinks: 0, removedUnderlays: 0, playerStartKept: false, refused: false, action: 'unlinked', count: launcherCountAt(map, from.x, from.y) };
  }
  // A cell that already holds a launcher (on top or hidden) keeps its tile and facing; any other cell is painted.
  const painted = holdsShotLauncher(source, to.x, to.y)
    ? { map: cloneMap(source), removedLinks: 0, removedUnderlays: 0 }
    : paintTerrain(source, to.x, to.y, EDITOR_SHOT_LAUNCHER_TILES[facing]);
  const map = cloneMap(painted.map);
  setLauncherLinks(map, [...(map.launcherLinks ?? []), { buttonX: from.x, buttonY: from.y, launcherX: to.x, launcherY: to.y }]);
  return {
    map,
    changed: true,
    removedLinks: painted.removedLinks,
    removedUnderlays: painted.removedUnderlays,
    playerStartKept: false,
    refused: false,
    action: 'linked',
    count: launcherCountAt(map, from.x, from.y)
  };
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
 * toggleLauncherLink it never adds a link or paints a launcher.
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
 * Second click of a wire tool: puts the target tile on the target cell and
 * records the link. A wire whose source is its target is refused and changes
 * nothing, and so is a wire whose source no longer holds the button. A link already joining the same two cells is replaced, not doubled.
 * A clone link copies the entity standing on the cloner, else the default
 * template facing `fallbackDir`.
 */
export function placeWireLink(
  source: EditorMap,
  kind: LinkWireKind,
  from: { x: number; y: number },
  to: { x: number; y: number },
  fallbackDir: Direction
): WireResult {
  if (source.cc3d) return { ...unchanged(source), refused: false }; // a CC3D map is edited through cc3dEdits only
  if (!inGrid(source, from.x, from.y) || !inGrid(source, to.x, to.y)) return { ...unchanged(source), refused: false };
  if (from.x === to.x && from.y === to.y) return { ...unchanged(source), refused: true, refusal: 'same_cell' };
  const tiles = wireTiles(kind);
  if (source.terrain[from.y][from.x] !== tiles.button) {
    return { ...unchanged(source), refused: true, refusal: 'missing_button' };
  }
  const painted = paintTerrain(source, to.x, to.y, tiles.target);
  const map = cloneMap(painted.map);
  let emptyCloner = false;
  if (kind === 'trap') {
    map.trapLinks = map.trapLinks.filter((l) => !(l.buttonX === from.x && l.buttonY === from.y && l.trapX === to.x && l.trapY === to.y));
    map.trapLinks.push({ buttonX: from.x, buttonY: from.y, trapX: to.x, trapY: to.y });
  } else {
    const onCloner = map.entities.find((e) => e.x === to.x && e.y === to.y);
    emptyCloner = onCloner === undefined;
    map.cloneLinks = map.cloneLinks.filter((l) => !(l.buttonX === from.x && l.buttonY === from.y && l.clonerX === to.x && l.clonerY === to.y));
    map.cloneLinks.push({
      buttonX: from.x,
      buttonY: from.y,
      clonerX: to.x,
      clonerY: to.y,
      templateType: onCloner?.type ?? EDITOR_DEFAULT_CLONE_TEMPLATE,
      templateDir: onCloner?.dir ?? fallbackDir
    });
  }
  // The map was copied from the painted one, which already pruned the hidden terrain of the target cell.
  return { map, changed: true, removedLinks: painted.removedLinks, removedUnderlays: painted.removedUnderlays, playerStartKept: false, refused: false, ...(emptyCloner ? { emptyCloner } : {}) };
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

  const kept = translateEdges(source.cellEdges ?? [], dx, dy, newWidth, newHeight).filter((e) => alive(e.x, e.y));
  report.droppedEdges = (source.cellEdges?.length ?? 0) - kept.length;

  const resized: EditorMap = { terrain, items, entities, trapLinks, cloneLinks, playerStart: { x: startX, y: startY, dir: source.playerStart.dir } };
  replaceEdges(resized, kept);
  setLauncherLinks(resized, launcherLinks);
  // The hidden terrain stays with its cell, then only what the new terrain on top can still hide is kept.
  replaceUnderlays(resized, translateUnderlays(source.underlays ?? [], dx, dy, newWidth, newHeight).filter((u) => alive(u.x, u.y)));
  report.droppedUnderlays = (source.underlays?.length ?? 0) - (resized.underlays?.length ?? 0);
  return {
    map: resized,
    width: newWidth,
    height: newHeight,
    changed: true,
    report
  };
}
