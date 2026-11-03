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

import { ORDERED_DIRECTIONS } from '../config/constants';
import { type Cc3dLevel, cellAt, topTerrain } from '../core/cc3d/model';
import type { Direction } from '../core/types';
import {
  clearPanels,
  eraseCell,
  eraseTop,
  placeLayer,
  placeMob,
  removeMob,
  setItem,
  setPanelSide,
  setPlayer
} from './cc3dEdits';
import {
  type Cc3dBrushAttributes,
  type Cc3dPaletteEntry,
  entryIdOfLayer,
  itemOf,
  layerOf,
  mobOf
} from './cc3dPalette';
import type { EditorTool, ToolMessage } from './editorTools';

/**
 * The tools of the editor on a CC3D level, as pure functions of the level: the brush places what the
 * palette entry stands for, the eraser removes the topmost thing of a cell (Shift: the whole cell), the
 * picker reads a cell back into an entry. The caller keeps the level and the history.
 */

export const MESSAGE_CC3D_MOB_ON_START = 'editor.cc3d.status.mob_on_start';
export const MESSAGE_CC3D_START_ON_MOB = 'editor.cc3d.status.start_on_mob';
/** Why fill, select and resize do not act on a CC3D level. */
export const CC3D_TOOL_UNAVAILABLE_KEY = 'editor.cc3d.tool_unavailable.label';
export const CC3D_RESIZE_UNAVAILABLE_KEY = 'editor.cc3d.resize_unavailable.label';

/** The tools that work on whole Epoxy or Lynx layers and have no CC3D meaning. */
const UNAVAILABLE_TOOLS: readonly EditorTool[] = ['fill', 'select'];

/** The i18n key of the reason a tool is off on a CC3D level, or null when it works. */
export function cc3dToolBlock(tool: EditorTool): string | null {
  return UNAVAILABLE_TOOLS.includes(tool) ? CC3D_TOOL_UNAVAILABLE_KEY : null;
}

export interface Cc3dToolInput {
  level: Cc3dLevel;
  tool: EditorTool;
  /** The selected palette entry, or null when none is. */
  entry: Cc3dPaletteEntry | null;
  attrs: Cc3dBrushAttributes;
  /** The direction control: a mob's facing, a force floor's push, the panel side of a keyboard action. */
  dir: Direction;
  x: number;
  y: number;
  /** The side of the cell a pointer click is nearest to; the panel mode toggles this one. */
  side: Direction;
  /** True for the secondary button: it erases whatever the tool is. */
  forceErase?: boolean;
  /** True with Shift held on the eraser: the whole cell goes. */
  wholeCell?: boolean;
}

export interface Cc3dToolOutcome {
  level: Cc3dLevel;
  changed: boolean;
  messages: ToolMessage[];
}

function outcome(before: Cc3dLevel, after: Cc3dLevel, messages: ToolMessage[] = []): Cc3dToolOutcome {
  return { level: after, changed: after !== before, messages };
}

/**
 * What the plain eraser takes from a cell, topmost first as it is drawn: the creature or block, else the
 * item, else the top layer of the stack, else (a plain floor) the thin walls.
 */
export function eraseTopmost(level: Cc3dLevel, x: number, y: number): Cc3dLevel {
  const cell = cellAt(level, x, y);
  if (!cell) return level;
  if (level.mobs.some((mob) => mob.x === x && mob.y === y)) return removeMob(level, x, y);
  if (cell.item) return setItem(level, x, y, null);
  // A base that is not plain floor (water, an exit...) goes back to plain floor too.
  if (cell.terrain.length > 1 || cell.terrain[0].kind !== 'floor') return eraseTop(level, x, y);
  return clearPanels(level, x, y);
}

/** The thin wall side a brush acts on: the one nearest the pointer, else (the keyboard) the direction control. */
function toggledPanel(input: Cc3dToolInput): Cc3dLevel {
  const cell = cellAt(input.level, input.x, input.y);
  if (!cell) return input.level;
  return setPanelSide(input.level, input.x, input.y, input.side, !cell.panels.includes(input.side));
}

function brushOutcome(input: Cc3dToolInput): Cc3dToolOutcome {
  const { level, entry, attrs, dir, x, y } = input;
  if (!entry) return outcome(level, level);
  switch (entry.action) {
    case 'layer':
      return outcome(level, placeLayer(level, x, y, layerOf(entry, attrs, dir)));
    case 'item':
      return outcome(level, setItem(level, x, y, itemOf(entry, attrs)));
    case 'panel':
      return outcome(level, toggledPanel(input));
    case 'mob': {
      const placed = placeMob(level, mobOf(entry, attrs, dir, x, y));
      const refused = placed === level && level.player.x === x && level.player.y === y;
      return outcome(level, placed, refused ? [{ key: MESSAGE_CC3D_MOB_ON_START }] : []);
    }
    case 'player': {
      const placed = setPlayer(level, x, y, dir);
      const refused = placed === level && level.mobs.some((mob) => mob.x === x && mob.y === y);
      return outcome(level, placed, refused ? [{ key: MESSAGE_CC3D_START_ON_MOB }] : []);
    }
  }
}

/** Applies the active tool at a cell. Fill and select (and the picker, which only reads) change nothing. */
export function applyCc3dTool(input: Cc3dToolInput): Cc3dToolOutcome {
  const { level, tool, x, y } = input;
  if (input.forceErase || tool === 'eraser') {
    return outcome(level, input.wholeCell ? eraseCell(level, x, y) : eraseTopmost(level, x, y));
  }
  if (tool === 'brush') return brushOutcome(input);
  return outcome(level, level);
}

/** True when holding the pointer down and moving keeps acting: a thin wall toggles once per click. */
export function cc3dContinuesOnDrag(tool: EditorTool, entry: Cc3dPaletteEntry | null, forceErase: boolean): boolean {
  if (forceErase || tool === 'eraser') return true;
  return tool === 'brush' && entry !== null && entry.action !== 'panel';
}

/**
 * The side of a cell a point inside it is nearest to; `fx` and `fy` are the position in the cell, from
 * 0 (west, north) to 1 (east, south). A tie goes to the first of N, E, S, W.
 */
export function nearestSide(fx: number, fy: number): Direction {
  const distances: Record<Direction, number> = { N: fy, E: 1 - fx, S: 1 - fy, W: fx };
  return ORDERED_DIRECTIONS.reduce((best, side) => (distances[side] < distances[best] ? side : best), ORDERED_DIRECTIONS[0]);
}

/** What the picker takes from a cell: the entry to select, the attributes and facing to take with it. */
export interface Cc3dPicked {
  entryId: string;
  attrs: Partial<Cc3dBrushAttributes>;
  dir?: Direction;
}

/** The creature or block of a cell, else its item, else its top layer. Null for a cell outside the grid. */
export function pickCc3dCell(level: Cc3dLevel, x: number, y: number): Cc3dPicked | null {
  const cell = cellAt(level, x, y);
  if (!cell) return null;
  const mob = level.mobs.find((m) => m.x === x && m.y === y);
  if (mob) {
    const attrs: Partial<Cc3dBrushAttributes> = {};
    if (mob.color) attrs.color = mob.color;
    if (mob.mirror) attrs.mirror = mob.mirror;
    return { entryId: `mob:${mob.kind}`, attrs, dir: mob.dir };
  }
  if (cell.item) return { entryId: `item:${cell.item.kind}`, attrs: cell.item.color ? { color: cell.item.color } : {} };
  const top = topTerrain(cell);
  const attrs: Partial<Cc3dBrushAttributes> = {};
  if (top.color) attrs.color = top.color;
  if (top.corner) attrs.corner = top.corner;
  return { entryId: entryIdOfLayer(top), attrs, ...(top.dir ? { dir: top.dir } : {}) };
}
