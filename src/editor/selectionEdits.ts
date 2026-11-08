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

import { FLOOR_TILE_ID } from '../core/coreConstants';
import { CellEdge, CellUnderlay, CloneLink, Direction, LauncherLink, SignalLink, TrapLink } from '../core/types';
import { canonicalEdges, removeEdgesWhere, replaceEdges } from './editorCellEdges';
import { cloneMap, EditorMap } from './editorDocument';
import type { Brush } from './editorTools';
import { canonicalLauncherLinks, pruneLauncherLinks, setLauncherLinks } from './editorLauncherLinks';
import { canonicalSignalLinks, pruneSignalLinks, setSignalLinks } from './editorSignalLinks';
import { canonicalUnderlays, pruneUnderlays, removeUnderlaysWhere, replaceUnderlays } from './editorUnderlays';
import {
  ClonerTemplateChange,
  dropLinksAt,
  hasLink,
  hidesShotDevice,
  holdsLinkEnd,
  keepsLauncherLinks,
  mapHeightOf,
  mapWidthOf,
  syncCloneTemplatesAt
} from './mapEdits';
import { EditableRuleset, entityAvailability, tileAvailability } from './paletteAvailability';

/** A rectangle of cells: its top-left cell and its size, both at least 1 once normalised. */
export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An entity of a clip, positioned relative to the clip's top-left cell. */
export interface ClipEntity {
  dx: number;
  dy: number;
  type: string;
  dir: Direction;
}

/** The thin walls of one cell of a clip, positioned relative to the clip's top-left cell. */
export interface ClipEdge {
  dx: number;
  dy: number;
  sides: Direction[];
}

/** The terrain hidden under one cell of a clip, positioned relative to the clip's top-left cell. */
export interface ClipUnderlay {
  dx: number;
  dy: number;
  terrain: string;
}

/**
 * The content of a rectangle of cells, detached from the map. It carries the links whose two ends lie inside the
 * rectangle (not on the outer ring); a link with an end outside is never carried, so one clip can be pasted many
 * times, or into another level.
 */
export interface Clip {
  width: number;
  height: number;
  terrain: string[][];
  items: (string | null)[][];
  entities: ClipEntity[];
  /** Thin walls of the clipped cells; absent when none has any. A Lynx level has no such walls, so they are dropped there. */
  edges?: ClipEdge[];
  /** Terrain hidden under the clipped cells; absent when none hides any. A Lynx level has no hidden terrain, so it is dropped there. */
  underlays?: ClipUnderlay[];
  /** Brown button to trap links with both ends inside the clip, in clip-relative cells; absent when none. */
  trapLinks?: TrapLink[];
  /** Red button to clone machine links with both ends inside the clip, in clip-relative cells (templates kept); absent when none. */
  cloneLinks?: CloneLink[];
  /** Shot trigger to launcher links with both ends inside the clip, in clip-relative cells; absent when none. */
  launcherLinks?: LauncherLink[];
  /** Links with an end inside the rectangle that the clip could not carry (the other end outside, or an end on the ring); absent when none. */
  linksLeftOut?: number;
  /** The player start, relative to the clip, when the clip carries it; null otherwise. */
  playerStart: { dx: number; dy: number; dir: Direction } | null;
}

/** Outcome of a selection edit. The input map is never modified. */
export interface SelectionEditResult {
  map: EditorMap;
  /** False when the edit left the map as it was. */
  changed: boolean;
  /** Links dropped because one end was cleared, overwritten, or left behind by a move. */
  droppedLinks: number;
  /** Palette entries of a clip skipped because the level's ruleset cannot play them; for an entity fill, the start cell it left alone. */
  skipped: number;
  /** Cells left alone because they sit on the outer ring of the map, which a paste or a move never writes. */
  borderSkipped: number;
  /** True when the edit hit the player start cell and left the start in place (clear, entity fill). */
  playerStartKept: boolean;
  /** Hidden terrain removed because a terrain fill left a top that cannot hide it; only a fill reports it. */
  droppedUnderlays?: number;
  /** Clone machines whose stored template followed the creature a fill put on them. */
  clonerTemplates?: ClonerTemplateChange[];
  /** Links of a pasted clip that were written on the map; absent when the clip carried none. */
  pastedLinks?: number;
  /** Links a pasted clip carried that could not be written (an end off the map, on the ring or on a skipped cell, or a rule of the level); absent when none. */
  linksNotPasted?: number;
  /** The cells the edit produced or targeted, clipped to the map; null when none are inside it. */
  rect: CellRect | null;
}

/** A step of a move, in cells. */
export interface MoveStep {
  dx: number;
  dy: number;
}

/** True for the cells of the outer ring: first and last row, first and last column. */
function onRing(map: EditorMap, x: number, y: number): boolean {
  return x === 0 || y === 0 || x === mapWidthOf(map) - 1 || y === mapHeightOf(map) - 1;
}

function inGrid(map: EditorMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < mapWidthOf(map) && y < mapHeightOf(map);
}

/** True when the cell lies inside the rectangle. */
export function rectContains(rect: CellRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/** The rectangle spanned by two cells in any order, clipped to a width by height grid. */
export function rectFromCells(
  a: { x: number; y: number },
  b: { x: number; y: number },
  gridWidth: number,
  gridHeight: number
): CellRect {
  const clamp = (value: number, size: number): number => Math.min(Math.max(0, size - 1), Math.max(0, value));
  const x0 = clamp(Math.min(a.x, b.x), gridWidth);
  const y0 = clamp(Math.min(a.y, b.y), gridHeight);
  const x1 = clamp(Math.max(a.x, b.x), gridWidth);
  const y1 = clamp(Math.max(a.y, b.y), gridHeight);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The rectangle shifted by a step. */
export function shiftRect(rect: CellRect, dx: number, dy: number): CellRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/** Reduces a step so the rectangle stays inside the grid. */
export function clampMoveStep(rect: CellRect, dx: number, dy: number, gridWidth: number, gridHeight: number): MoveStep {
  const clamp = (step: number, origin: number, size: number, grid: number): number =>
    Math.min(grid - (origin + size), Math.max(-origin, step));
  return { dx: clamp(dx, rect.x, rect.width, gridWidth), dy: clamp(dy, rect.y, rect.height, gridHeight) };
}

/** The part of a rectangle that lies inside the grid, or null when none does. */
export function clipRectToGrid(rect: CellRect, gridWidth: number, gridHeight: number): CellRect | null {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(gridWidth, rect.x + rect.width);
  const y1 = Math.min(gridHeight, rect.y + rect.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** Whether two maps hold the same layers; the order of the entities does not matter. */
function sameMapLayers(a: EditorMap, b: EditorMap): boolean {
  const normalize = (map: EditorMap): string =>
    JSON.stringify({
      terrain: map.terrain,
      items: map.items,
      entities: [...map.entities].sort((l, m) => l.y - m.y || l.x - m.x || l.type.localeCompare(m.type)),
      trapLinks: map.trapLinks,
      cloneLinks: map.cloneLinks,
      playerStart: map.playerStart,
      cellEdges: canonicalEdges(map.cellEdges, map.terrain) ?? [],
      underlays: canonicalUnderlays(map.underlays, map.terrain) ?? [],
      launcherLinks: canonicalLauncherLinks(map.launcherLinks, map.terrain, map.underlays) ?? [],
      signalLinks: canonicalSignalLinks(map.signalLinks, map.terrain) ?? []
    });
  return normalize(a) === normalize(b);
}

/**
 * Copies the content of the cells of a rectangle inside the map. The player
 * start is unique: it goes into the clip only when `includePlayerStart` is set
 * (cut), and a copy leaves it out.
 */
export function extractClip(map: EditorMap, rect: CellRect, includePlayerStart: boolean): Clip {
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  for (let cy = 0; cy < rect.height; cy++) {
    terrain.push([]);
    items.push([]);
    for (let cx = 0; cx < rect.width; cx++) {
      terrain[cy].push(map.terrain[rect.y + cy][rect.x + cx]);
      items[cy].push(map.items[rect.y + cy][rect.x + cx]);
    }
  }
  const entities: ClipEntity[] = map.entities
    .filter((e) => rectContains(rect, e.x, e.y))
    .map((e) => ({ dx: e.x - rect.x, dy: e.y - rect.y, type: e.type, dir: e.dir }));
  const edges: ClipEdge[] = (map.cellEdges ?? [])
    .filter((e) => rectContains(rect, e.x, e.y))
    .map((e) => ({ dx: e.x - rect.x, dy: e.y - rect.y, sides: [...e.sides] }));
  const underlays: ClipUnderlay[] = (map.underlays ?? [])
    .filter((u) => rectContains(rect, u.x, u.y))
    .map((u) => ({ dx: u.x - rect.x, dy: u.y - rect.y, terrain: u.terrain }));
  const start = map.playerStart;
  const playerStart =
    includePlayerStart && rectContains(rect, start.x, start.y)
      ? { dx: start.x - rect.x, dy: start.y - rect.y, dir: start.dir }
      : null;
  // A link is carried when both ends are inside the rectangle and off the ring (a paste never writes the ring).
  const carried = (x: number, y: number): boolean => rectContains(rect, x, y) && !onRing(map, x, y);
  let linksLeftOut = 0;
  const carryLinks = <T>(links: readonly T[], ends: (l: T) => [number, number, number, number], shift: (l: T) => T): T[] => {
    const kept: T[] = [];
    for (const l of links) {
      const [ax, ay, bx, by] = ends(l);
      if (carried(ax, ay) && carried(bx, by)) kept.push(shift(l));
      else if (rectContains(rect, ax, ay) || rectContains(rect, bx, by)) linksLeftOut++;
    }
    return kept;
  };
  const trapLinks = carryLinks(
    map.trapLinks,
    (l) => [l.buttonX, l.buttonY, l.trapX, l.trapY],
    (l) => ({ buttonX: l.buttonX - rect.x, buttonY: l.buttonY - rect.y, trapX: l.trapX - rect.x, trapY: l.trapY - rect.y })
  );
  const cloneLinks = carryLinks(
    map.cloneLinks,
    (l) => [l.buttonX, l.buttonY, l.clonerX, l.clonerY],
    (l) => ({ ...l, buttonX: l.buttonX - rect.x, buttonY: l.buttonY - rect.y, clonerX: l.clonerX - rect.x, clonerY: l.clonerY - rect.y })
  );
  const launcherLinks = carryLinks(
    canonicalLauncherLinks(map.launcherLinks, map.terrain, map.underlays) ?? [],
    (l) => [l.buttonX, l.buttonY, l.launcherX, l.launcherY],
    (l) => ({
      buttonX: l.buttonX - rect.x,
      buttonY: l.buttonY - rect.y,
      launcherX: l.launcherX - rect.x,
      launcherY: l.launcherY - rect.y
    })
  );
  return {
    width: rect.width,
    height: rect.height,
    terrain,
    items,
    entities,
    ...(edges.length > 0 ? { edges } : {}),
    ...(underlays.length > 0 ? { underlays } : {}),
    ...(trapLinks.length > 0 ? { trapLinks } : {}),
    ...(cloneLinks.length > 0 ? { cloneLinks } : {}),
    ...(launcherLinks.length > 0 ? { launcherLinks } : {}),
    ...(linksLeftOut > 0 ? { linksLeftOut } : {}),
    playerStart
  };
}

function clearCells(map: EditorMap, rect: CellRect, keep: (x: number, y: number) => boolean = () => false): void {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (keep(x, y)) continue;
      map.terrain[y][x] = FLOOR_TILE_ID;
      map.items[y][x] = null;
    }
  }
  map.entities = map.entities.filter((e) => !rectContains(rect, e.x, e.y) || keep(e.x, e.y));
  removeEdgesWhere(map, (x, y) => rectContains(rect, x, y) && !keep(x, y));
  removeUnderlaysWhere(map, (x, y) => rectContains(rect, x, y) && !keep(x, y));
}

/**
 * Clears the cells of a rectangle to floor, removes their thin walls and hidden terrain and drops the links that end in
 * it. The player start stays where it is, and the result says so.
 */
export function clearRect(source: EditorMap, rect: CellRect): SelectionEditResult {
  if (source.cc3d) return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect: null }; // a CC3D map is edited through cc3dEdits only
  const map = cloneMap(source);
  clearCells(map, rect);
  let droppedLinks = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) droppedLinks += dropLinksAt(map, x, y);
  }
  const playerStartKept = rectContains(rect, source.playerStart.x, source.playerStart.y);
  return { map, changed: !sameMapLayers(source, map), droppedLinks, skipped: 0, borderSkipped: 0, playerStartKept, rect };
}

/**
 * Writes a clip onto the map with its top-left cell on (originX, originY).
 * Cells outside the map are clipped. Writing a cell drops the links ending
 * there, whatever the tile. With a ruleset, a cell whose terrain that ruleset
 * cannot play is left out whole (it keeps what it had, entity included) and
 * counted once; an item or entity it cannot play is left out alone and counted.
 * The outer ring of the map is never written: its cells are left out whole and
 * counted apart. A written cell takes the thin walls of the clip (none when the clip has none there);
 * under Lynx, which has no thin walls, the clip's are dropped and each counts as skipped. Hidden terrain
 * follows its cell the same way: a written cell takes the clip's (none when the clip has none there), Lynx
 * drops and counts it, and a cell left out keeps its own. With `sourceOrigin` (a move), clip cells that came from the
 * ring are left out too, so the ring stays where it is.
 */
function stampClip(
  map: EditorMap,
  clip: Clip,
  originX: number,
  originY: number,
  ruleset: EditableRuleset | null,
  sourceOrigin: { x: number; y: number } | null = null
): { skipped: number; borderSkipped: number; droppedLinks: number; droppedUnderlays: number; writtenCells: ReadonlySet<string> } {
  let skipped = 0;
  let borderSkipped = 0;
  let droppedLinks = 0;
  const fromRing = (cx: number, cy: number): boolean =>
    sourceOrigin !== null && onRing(map, sourceOrigin.x + cx, sourceOrigin.y + cy);
  const ringCells = new Set<string>();
  const tileOk = (id: string): boolean => ruleset === null || tileAvailability(ruleset, id).available;
  const keepEntities = new Set<string>();
  const skippedCells = new Set<string>();
  const writtenCells = new Set<string>();
  for (let cy = 0; cy < clip.height; cy++) {
    for (let cx = 0; cx < clip.width; cx++) {
      const x = originX + cx;
      const y = originY + cy;
      if (!inGrid(map, x, y)) continue;
      if (onRing(map, x, y) || fromRing(cx, cy)) {
        ringCells.add(`${x},${y}`);
        keepEntities.add(`${x},${y}`);
      } else if (!tileOk(clip.terrain[cy][cx])) {
        skippedCells.add(`${x},${y}`);
        keepEntities.add(`${x},${y}`);
      }
    }
  }
  for (const e of clip.entities) {
    const x = originX + e.dx;
    const y = originY + e.dy;
    if (inGrid(map, x, y) && ruleset !== null && !entityAvailability(ruleset, e.type).available) keepEntities.add(`${x},${y}`);
  }
  for (let cy = 0; cy < clip.height; cy++) {
    for (let cx = 0; cx < clip.width; cx++) {
      const x = originX + cx;
      const y = originY + cy;
      if (!inGrid(map, x, y)) continue;
      if (ringCells.has(`${x},${y}`)) {
        borderSkipped++;
        continue;
      }
      if (skippedCells.has(`${x},${y}`)) {
        skipped++;
        continue;
      }
      map.terrain[y][x] = clip.terrain[cy][cx];
      writtenCells.add(`${x},${y}`);
      droppedLinks += dropLinksAt(map, x, y);
      const item = clip.items[cy][cx];
      if (item === null || tileOk(item)) map.items[y][x] = item;
      else skipped++;
    }
  }
  map.entities = map.entities.filter((e) => {
    const inside = e.x >= originX && e.y >= originY && e.x < originX + clip.width && e.y < originY + clip.height;
    return !inside || keepEntities.has(`${e.x},${e.y}`);
  });
  for (const e of clip.entities) {
    const x = originX + e.dx;
    const y = originY + e.dy;
    if (!inGrid(map, x, y)) continue;
    if (keepEntities.has(`${x},${y}`)) {
      if (!skippedCells.has(`${x},${y}`) && !ringCells.has(`${x},${y}`)) skipped++;
      continue;
    }
    map.entities.push({ x, y, type: e.type, dir: e.dir });
  }
  const keptEdges = (map.cellEdges ?? []).filter((e) => !writtenCells.has(`${e.x},${e.y}`));
  const pastedEdges: CellEdge[] = [];
  for (const e of clip.edges ?? []) {
    const x = originX + e.dx;
    const y = originY + e.dy;
    if (!writtenCells.has(`${x},${y}`)) continue;
    if (ruleset === 'lynx') skipped++;
    else pastedEdges.push({ x, y, sides: [...e.sides] });
  }
  if (keptEdges.length !== (map.cellEdges?.length ?? 0) || pastedEdges.length > 0) replaceEdges(map, [...keptEdges, ...pastedEdges]);
  const keptUnderlays = (map.underlays ?? []).filter((u) => !writtenCells.has(`${u.x},${u.y}`));
  const pastedUnderlays: CellUnderlay[] = [];
  for (const u of clip.underlays ?? []) {
    const x = originX + u.dx;
    const y = originY + u.dy;
    if (!writtenCells.has(`${x},${y}`)) continue;
    if (ruleset === 'lynx') skipped++;
    else pastedUnderlays.push({ x, y, terrain: u.terrain });
  }
  if (keptUnderlays.length !== (map.underlays?.length ?? 0) || pastedUnderlays.length > 0) {
    replaceUnderlays(map, [...keptUnderlays, ...pastedUnderlays]);
  }
  // Defensive canonical pass: the clip's underlays are expected to be valid already, but a hand-built or stale clip
  // could leave a top that cannot hide the terrain under it. Anything dropped here is counted, never silent.
  const droppedUnderlays = pruneUnderlays(map);
  if (clip.playerStart) {
    const x = originX + clip.playerStart.dx;
    const y = originY + clip.playerStart.dy;
    if (inGrid(map, x, y) && !ringCells.has(`${x},${y}`)) {
      map.playerStart = { x, y, dir: clip.playerStart.dir };
      delete map.missingStart;
    }
  }
  return { skipped, borderSkipped, droppedLinks, droppedUnderlays, writtenCells };
}

/** A link as a string that does not depend on the order of its fields. */
function linkIdentity(link: object): string {
  return JSON.stringify(Object.entries(link).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** What a list of links gained and lost between two states, by identity; `same` when it is the same set. */
function diffLinks(before: readonly object[] | undefined, after: readonly object[] | undefined): { dropped: number; added: number; same: boolean } {
  const was = new Set((before ?? []).map(linkIdentity));
  const is = new Set((after ?? []).map(linkIdentity));
  let dropped = 0;
  let added = 0;
  for (const key of was) if (!is.has(key)) dropped++;
  for (const key of is) if (!was.has(key)) added++;
  return { dropped, added, same: dropped === 0 && added === 0 && (before?.length ?? 0) === (after?.length ?? 0) };
}

/** How many links a clip carries, all systems together. */
export function clipLinkCount(clip: Clip): number {
  return (clip.trapLinks?.length ?? 0) + (clip.cloneLinks?.length ?? 0) + (clip.launcherLinks?.length ?? 0);
}

/**
 * Writes the links of a clip whose cells were just stamped. A link is kept only when both of its ends, translated, are
 * in the grid, on cells the paste really wrote, and still hold the device the system needs there. Lynx has no shot
 * links and reads only the first valid link of a button (the engine's firstValidLinks rule), so the rest are left out.
 * Returns how many links were written and how many were not.
 */
function pasteClipLinks(
  map: EditorMap,
  clip: Clip,
  originX: number,
  originY: number,
  ruleset: EditableRuleset,
  writtenCells: ReadonlySet<string>
): { pasted: number; notPasted: number } {
  const total = clipLinkCount(clip);
  if (total === 0) return { pasted: 0, notPasted: 0 };
  const lynx = ruleset === 'lynx';
  const usable = (x: number, y: number): boolean => inGrid(map, x, y) && writtenCells.has(`${x},${y}`);
  let pasted = 0;

  const trapButtons = new Set<string>();
  for (const l of clip.trapLinks ?? []) {
    const button = { x: originX + l.buttonX, y: originY + l.buttonY };
    const target = { x: originX + l.trapX, y: originY + l.trapY };
    if (!usable(button.x, button.y) || !usable(target.x, target.y)) continue;
    if (!holdsLinkEnd(map, 'trap', 'button', button.x, button.y) || !holdsLinkEnd(map, 'trap', 'target', target.x, target.y)) continue;
    if (hasLink(map, 'trap', button, target)) continue;
    if (lynx && trapButtons.has(`${button.x},${button.y}`)) continue;
    trapButtons.add(`${button.x},${button.y}`);
    map.trapLinks.push({ buttonX: button.x, buttonY: button.y, trapX: target.x, trapY: target.y });
    pasted++;
  }

  const cloneButtons = new Set<string>();
  for (const l of clip.cloneLinks ?? []) {
    const button = { x: originX + l.buttonX, y: originY + l.buttonY };
    const target = { x: originX + l.clonerX, y: originY + l.clonerY };
    if (!usable(button.x, button.y) || !usable(target.x, target.y)) continue;
    if (!holdsLinkEnd(map, 'clone', 'button', button.x, button.y) || !holdsLinkEnd(map, 'clone', 'target', target.x, target.y)) continue;
    if (hasLink(map, 'clone', button, target)) continue;
    if (lynx && cloneButtons.has(`${button.x},${button.y}`)) continue;
    cloneButtons.add(`${button.x},${button.y}`);
    map.cloneLinks.push({ ...l, buttonX: button.x, buttonY: button.y, clonerX: target.x, clonerY: target.y });
    // The engine reads the stored template, the author sees the creature on the cloner: a creature there wins.
    syncCloneTemplatesAt(map, target.x, target.y);
    pasted++;
  }

  if (!lynx && (clip.launcherLinks?.length ?? 0) > 0) {
    const accepted: LauncherLink[] = [];
    for (const l of clip.launcherLinks ?? []) {
      const link: LauncherLink = {
        buttonX: originX + l.buttonX,
        buttonY: originY + l.buttonY,
        launcherX: originX + l.launcherX,
        launcherY: originY + l.launcherY
      };
      if (!usable(link.buttonX, link.buttonY) || !usable(link.launcherX, link.launcherY)) continue;
      if (!holdsLinkEnd(map, 'shot', 'button', link.buttonX, link.buttonY) || !holdsLinkEnd(map, 'shot', 'target', link.launcherX, link.launcherY)) continue;
      if (hasLink(map, 'shot', { x: link.buttonX, y: link.buttonY }, { x: link.launcherX, y: link.launcherY })) continue;
      accepted.push(link);
    }
    if (accepted.length > 0) {
      setLauncherLinks(map, [...(map.launcherLinks ?? []), ...accepted]);
      pruneLauncherLinks(map);
      const kept = new Set((map.launcherLinks ?? []).map((l) => `${l.buttonX},${l.buttonY},${l.launcherX},${l.launcherY}`));
      const seen = new Set<string>();
      for (const l of accepted) {
        const key = `${l.buttonX},${l.buttonY},${l.launcherX},${l.launcherY}`;
        if (kept.has(key) && !seen.has(key)) pasted++;
        seen.add(key);
      }
    }
  }
  return { pasted, notPasted: total - pasted };
}

/**
 * Pastes a clip with its top-left cell on (originX, originY). The links the clip carries are written at their new
 * place when both ends land on cells the paste wrote and still fit the level's rules; the others are counted. A
 * clip that carries the player start moves the start; a copy never does. The ruleset of the level decides which
 * entries are skipped.
 */
export function pasteClip(
  source: EditorMap,
  clip: Clip,
  originX: number,
  originY: number,
  ruleset: EditableRuleset
): SelectionEditResult {
  if (source.cc3d) return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect: null }; // a CC3D map is edited through cc3dEdits only
  const rect = clipRectToGrid(
    { x: originX, y: originY, width: clip.width, height: clip.height },
    mapWidthOf(source),
    mapHeightOf(source)
  );
  if (!rect) return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect: null };
  const map = cloneMap(source);
  const { skipped, borderSkipped, droppedUnderlays, writtenCells } = stampClip(map, clip, originX, originY, ruleset);
  const links = pasteClipLinks(map, clip, originX, originY, ruleset, writtenCells);
  // Count by what really differs from the source, per system: a link dropped by the overwrite and written back
  // identically (a paste onto its own cells) is neither dropped nor pasted, and the source array is put back as it was
  // (link order is meaningful under Lynx).
  const trap = diffLinks(source.trapLinks, map.trapLinks);
  if (trap.same) map.trapLinks = source.trapLinks.map((l) => ({ ...l }));
  const clone = diffLinks(source.cloneLinks, map.cloneLinks);
  if (clone.same) map.cloneLinks = source.cloneLinks.map((l) => ({ ...l }));
  const launcher = diffLinks(source.launcherLinks, map.launcherLinks);
  if (launcher.same) {
    if (source.launcherLinks) map.launcherLinks = source.launcherLinks.map((l) => ({ ...l }));
    else delete map.launcherLinks;
  }
  const droppedLinksNet = trap.dropped + clone.dropped + launcher.dropped;
  const pastedLinks = trap.added + clone.added + launcher.added;
  return {
    map,
    changed: !sameMapLayers(source, map),
    droppedLinks: droppedLinksNet,
    skipped,
    borderSkipped,
    playerStartKept: false,
    rect,
    droppedUnderlays,
    ...(pastedLinks > 0 ? { pastedLinks } : {}),
    ...(links.notPasted > 0 ? { linksNotPasted: links.notPasted } : {})
  };
}

/**
 * Moves the content of a rectangle by a step, leaving floor behind and
 * overwriting what is at the destination. A selection that would leave the
 * map does not move. Links with both ends in the rectangle move with it; links
 * with one end in it are dropped, and so are links ending on a cell the move
 * overwrites. The player start moves when it is inside the rectangle.
 */
export function moveRect(source: EditorMap, rect: CellRect, dx: number, dy: number): SelectionEditResult {
  if (source.cc3d) return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect: null }; // a CC3D map is edited through cc3dEdits only
  const destination = shiftRect(rect, dx, dy);
  const fits =
    destination.x >= 0 &&
    destination.y >= 0 &&
    destination.x + destination.width <= mapWidthOf(source) &&
    destination.y + destination.height <= mapHeightOf(source);
  if (!fits || (dx === 0 && dy === 0)) {
    return { map: source, changed: false, droppedLinks: 0, skipped: 0, borderSkipped: 0, playerStartKept: false, rect };
  }
  const clip = extractClip(source, rect, true);
  const map = cloneMap(source);

  // Source cells on the ring stay where they are and do not move.
  const inSource = (x: number, y: number): boolean => rectContains(rect, x, y) && !onRing(source, x, y);
  let droppedLinks = 0;
  const keptTrap: TrapLink[] = [];
  const movedTrap: TrapLink[] = [];
  for (const l of map.trapLinks) {
    const button = inSource(l.buttonX, l.buttonY);
    const target = inSource(l.trapX, l.trapY);
    if (button && target) {
      movedTrap.push({ buttonX: l.buttonX + dx, buttonY: l.buttonY + dy, trapX: l.trapX + dx, trapY: l.trapY + dy });
    } else if (button || target) {
      droppedLinks++;
    } else {
      keptTrap.push(l);
    }
  }
  const keptClone: CloneLink[] = [];
  const movedClone: CloneLink[] = [];
  for (const l of map.cloneLinks) {
    const button = inSource(l.buttonX, l.buttonY);
    const target = inSource(l.clonerX, l.clonerY);
    if (button && target) {
      movedClone.push({ ...l, buttonX: l.buttonX + dx, buttonY: l.buttonY + dy, clonerX: l.clonerX + dx, clonerY: l.clonerY + dy });
    } else if (button || target) {
      droppedLinks++;
    } else {
      keptClone.push(l);
    }
  }
  const keptLauncher: LauncherLink[] = [];
  const movedLauncher: LauncherLink[] = [];
  for (const l of map.launcherLinks ?? []) {
    const button = inSource(l.buttonX, l.buttonY);
    const launcher = inSource(l.launcherX, l.launcherY);
    if (button && launcher) {
      movedLauncher.push({ buttonX: l.buttonX + dx, buttonY: l.buttonY + dy, launcherX: l.launcherX + dx, launcherY: l.launcherY + dy });
    } else if (button || launcher) {
      droppedLinks++;
    } else {
      keptLauncher.push(l);
    }
  }
  const keptSignal: SignalLink[] = [];
  const movedSignal: SignalLink[] = [];
  for (const l of map.signalLinks ?? []) {
    const from = inSource(l.fromX, l.fromY);
    const to = inSource(l.toX, l.toY);
    if (from && to) {
      movedSignal.push({ ...l, fromX: l.fromX + dx, fromY: l.fromY + dy, toX: l.toX + dx, toY: l.toY + dy });
    } else if (from || to) {
      droppedLinks++;
    } else {
      keptSignal.push(l);
    }
  }
  map.trapLinks = keptTrap;
  map.cloneLinks = keptClone;
  setLauncherLinks(map, keptLauncher);
  setSignalLinks(map, keptSignal);

  clearCells(map, rect, (x, y) => onRing(source, x, y));
  const stamped = stampClip(map, clip, destination.x, destination.y, null, { x: rect.x, y: rect.y });
  droppedLinks += stamped.droppedLinks;
  map.trapLinks.push(...movedTrap);
  map.cloneLinks.push(...movedClone);
  setLauncherLinks(map, [...(map.launcherLinks ?? []), ...movedLauncher]);
  setSignalLinks(map, [...(map.signalLinks ?? []), ...movedSignal]);
  return {
    map,
    changed: !sameMapLayers(source, map),
    droppedLinks,
    skipped: 0,
    borderSkipped: stamped.borderSkipped,
    playerStartKept: false,
    rect: destination,
    droppedUnderlays: stamped.droppedUnderlays
  };
}

/** Why a fill of a selection was refused; the editor turns it into a status message. */
export type FillRefusal =
  /** The entry cannot be played by the level's ruleset; `reasonKey` says why. */
  | { reason: 'unavailable'; reasonKey: string }
  /** Thin walls are drawn with the brush: they have no content to fill with. */
  | { reason: 'cell_edge' }
  /** The player start is not content: it places one thing, not a layer of cells. */
  | { reason: 'unsupported' };

/** The refusal a brush meets when it fills a selection, or null when it can fill. */
export function fillBrushRefusal(brush: Brush, ruleset: EditableRuleset): FillRefusal | null {
  switch (brush.kind) {
    case 'cell_edge':
      return { reason: 'cell_edge' };
    case 'player_start':
      return { reason: 'unsupported' };
    case 'terrain':
    case 'item': {
      const availability = tileAvailability(ruleset, brush.id);
      return availability.available ? null : { reason: 'unavailable', reasonKey: availability.reasonKey };
    }
    case 'entity': {
      const availability = entityAvailability(ruleset, brush.id);
      return availability.available ? null : { reason: 'unavailable', reasonKey: availability.reasonKey };
    }
  }
}

/** Outcome of filling a selection: an ordinary selection edit, or the reason it was refused (the map is then untouched). */
export interface FillRectResult extends SelectionEditResult {
  refusal: FillRefusal | null;
}

/**
 * Fills the cells of a rectangle with a palette entry, as painting each of them would: a terrain tile drops the
 * links of the cells whose terrain changes, an item writes the item layer only, an entity replaces whatever
 * stands on the cell, facing `dir` (the player start cell is left alone and reported). The thin walls of a
 * cell stay, as when painting; hidden terrain stays only under a terrain that can still hide it, and the result counts
 * what a terrain fill removed. The outer ring is never written: its cells are counted apart. An entry the
 * level's ruleset cannot play, the player start or a thin wall refuses the whole fill.
 */
export function fillRect(source: EditorMap, rect: CellRect, brush: Brush, dir: Direction, ruleset: EditableRuleset): FillRectResult {
  const untouched = (refusal: FillRefusal | null): FillRectResult => ({
    map: source,
    changed: false,
    droppedLinks: 0,
    skipped: 0,
    borderSkipped: 0,
    playerStartKept: false,
    rect: null,
    refusal
  });
  if (source.cc3d) return untouched(null); // a CC3D map is edited through cc3dAreaEdits only
  const refusal = fillBrushRefusal(brush, ruleset);
  if (refusal) return untouched(refusal);
  const area = clipRectToGrid(rect, mapWidthOf(source), mapHeightOf(source));
  if (!area) return untouched(null);
  const map = cloneMap(source);
  let droppedLinks = 0;
  let anyHidden = false;
  let borderSkipped = 0;
  let skipped = 0;
  const clonerTemplates: ClonerTemplateChange[] = [];
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      if (onRing(map, x, y)) {
        borderSkipped++;
        continue;
      }
      if (brush.kind === 'terrain') {
        const previous = map.terrain[y][x];
        if (previous === brush.id) continue;
        map.terrain[y][x] = brush.id;
        const hidden = hidesShotDevice(map, x, y);
        anyHidden ||= hidden;
        droppedLinks += dropLinksAt(map, x, y, keepsLauncherLinks(previous, brush.id) || hidden);
      } else if (brush.kind === 'item') {
        map.items[y][x] = brush.id;
      } else if (x === source.playerStart.x && y === source.playerStart.y) {
        skipped++;
      } else {
        const present = map.entities.filter((e) => e.x === x && e.y === y);
        if (present.length === 1 && present[0].type === brush.id && present[0].dir === dir) {
          // Same creature already there: a user fill still re-syncs a link template that drifted from it.
          const resynced = syncCloneTemplatesAt(map, x, y);
          if (resynced) clonerTemplates.push(resynced);
          continue;
        }
        map.entities = map.entities.filter((e) => !(e.x === x && e.y === y));
        map.entities.push({ x, y, type: brush.id, dir });
        const synced = syncCloneTemplatesAt(map, x, y);
        if (synced) clonerTemplates.push(synced);
      }
    }
  }
  const droppedUnderlays = brush.kind === 'terrain' ? pruneUnderlays(map) : 0;
  if (anyHidden) droppedLinks += pruneLauncherLinks(map) + pruneSignalLinks(map);
  return {
    map,
    changed: !sameMapLayers(source, map),
    droppedLinks,
    skipped,
    borderSkipped,
    playerStartKept: skipped > 0,
    droppedUnderlays,
    ...(clonerTemplates.length > 0 ? { clonerTemplates } : {}),
    rect: area,
    refusal: null
  };
}
