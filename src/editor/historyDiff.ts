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

import { DEFAULT_PLAYER_CHARACTER, DEFAULT_RULESET } from '../core/coreConstants';
import type { CloneLink, EntityPlacement, TrapLink } from '../core/types';
import { dirtyCc3dCells } from './cc3dLayerDiff';
import { differingEdgeCells } from './editorCellEdges';
import { differingRailTrackCells } from './editorRailTracks';
import { differingUnderlayCells } from './editorUnderlays';
import { differingLauncherLinks } from './editorLauncherLinks';
import type { EditorDocument } from './editorDocument';

export interface HistoryCell {
  x: number;
  y: number;
}

/** What an undo or redo changed, in terms the editor can scroll to and announce. */
export interface HistoryDiff {
  /** Cells that differ, row by row; null when the two documents cannot be compared cell by cell (the grid changed). */
  cells: HistoryCell[] | null;
  /** The grid has another width or height. */
  sizeChanged: boolean;
  /** Only the level settings (title, hint, rules...) differ: no cell and no size. */
  metadataOnly: boolean;
}

function sizeOf(doc: EditorDocument): { width: number; height: number } {
  if (doc.cc3d) return { width: doc.cc3d.width, height: doc.cc3d.height };
  return { width: doc.terrain[0]?.length ?? 0, height: doc.terrain.length };
}

function metadataDiffers(a: EditorDocument, b: EditorDocument): boolean {
  return (
    a.title !== b.title ||
    a.hint !== b.hint ||
    a.author !== b.author ||
    a.password !== b.password ||
    a.timeLimitSeconds !== b.timeLimitSeconds ||
    a.chipsRequired !== b.chipsRequired ||
    a.winRule !== b.winRule ||
    (a.ruleset ?? DEFAULT_RULESET) !== (b.ruleset ?? DEFAULT_RULESET) ||
    (a.character ?? DEFAULT_PLAYER_CHARACTER) !== (b.character ?? DEFAULT_PLAYER_CHARACTER)
  );
}

/** Items held by only one of the two lists, compared by the key of their explicit fields. */
function unmatched<T>(before: readonly T[], after: readonly T[], keyOf: (item: T) => string): T[] {
  const left = new Set(before.map(keyOf));
  const right = new Set(after.map(keyOf));
  return [...before.filter((item) => !right.has(keyOf(item))), ...after.filter((item) => !left.has(keyOf(item)))];
}

const KEY_SEPARATOR = '|';

const entityKey = (e: EntityPlacement): string => [e.x, e.y, e.type, e.dir].join(KEY_SEPARATOR);
const trapLinkKey = (l: TrapLink): string => [l.buttonX, l.buttonY, l.trapX, l.trapY].join(KEY_SEPARATOR);
const cloneLinkKey = (l: CloneLink): string => [l.buttonX, l.buttonY, l.clonerX, l.clonerY, l.templateType, l.templateDir].join(KEY_SEPARATOR);

function epoxyDirtyCells(before: EditorDocument, after: EditorDocument, width: number, height: number): HistoryCell[] {
  const dirty: HistoryCell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (before.terrain[y][x] !== after.terrain[y][x] || (before.items[y]?.[x] ?? null) !== (after.items[y]?.[x] ?? null)) {
        dirty.push({ x, y });
      }
    }
  }
  // An entity counts at its position, whichever side holds it: moved, retyped, turned, added or removed.
  for (const e of unmatched(before.entities, after.entities, entityKey)) dirty.push({ x: e.x, y: e.y });
  for (const link of unmatched(before.trapLinks, after.trapLinks, trapLinkKey)) {
    dirty.push({ x: link.buttonX, y: link.buttonY }, { x: link.trapX, y: link.trapY });
  }
  for (const link of unmatched(before.cloneLinks, after.cloneLinks, cloneLinkKey)) {
    dirty.push({ x: link.buttonX, y: link.buttonY }, { x: link.clonerX, y: link.clonerY });
  }
  for (const link of differingLauncherLinks(before.launcherLinks, after.launcherLinks)) {
    dirty.push({ x: link.buttonX, y: link.buttonY }, { x: link.launcherX, y: link.launcherY });
  }
  // A thin wall counts at its cell, whichever side holds it: added, removed or changed sides.
  dirty.push(...differingEdgeCells(before.cellEdges, after.cellEdges));
  // A track cell's segments count at its cell too.
  dirty.push(...differingRailTrackCells(before.railTracks, after.railTracks));
  // Hidden terrain counts at its cell as well.
  dirty.push(...differingUnderlayCells(before.underlays, after.underlays));
  const a = before.playerStart;
  const b = after.playerStart;
  if (a.x !== b.x || a.y !== b.y || a.dir !== b.dir) dirty.push({ x: a.x, y: a.y }, { x: b.x, y: b.y });
  return dirty;
}

/** The cells in row-major order, once each, inside the grid. */
function normalize(cells: readonly HistoryCell[], width: number, height: number): HistoryCell[] {
  const seen = new Map<number, HistoryCell>();
  for (const cell of cells) {
    if (cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height) seen.set(cell.y * width + cell.x, cell);
  }
  return [...seen.entries()].sort(([i], [j]) => i - j).map(([, cell]) => cell);
}

/**
 * Compares the document an undo or redo left with the one it came from. A CC3D map is compared by the
 * references of its immutable cells; an Epoxy map by value: terrain, items, entities by position, the
 * endpoints of the links that differ, and the player start.
 */
export function historyDiff(before: EditorDocument, after: EditorDocument): HistoryDiff {
  const was = sizeOf(before);
  const now = sizeOf(after);
  const sizeChanged = was.width !== now.width || was.height !== now.height;
  if (sizeChanged || Boolean(before.cc3d) !== Boolean(after.cc3d)) return { cells: null, sizeChanged, metadataOnly: false };
  const raw =
    before.cc3d && after.cc3d
      ? (dirtyCc3dCells(before.cc3d, after.cc3d) ?? []).map((index) => ({ x: index % now.width, y: Math.floor(index / now.width) }))
      : epoxyDirtyCells(before, after, now.width, now.height);
  const cells = normalize(raw, now.width, now.height);
  return { cells, sizeChanged: false, metadataOnly: cells.length === 0 && metadataDiffers(before, after) };
}
