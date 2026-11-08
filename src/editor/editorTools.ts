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

import { EXTRA_PLAYERS_MAX } from '../core/coreConstants';
import { Direction, PlayerCharacter } from '../core/types';
import { clonerTemplateMessage } from './cellDescription';
import { CanopyMode, hasCanopyAt, toggleCanopyAt } from './editorCellEdges';
import { cloneMap, EditorMap } from './editorDocument';
import { extraPlayerAt } from './editorExtraPlayers';
import { defaultExtraCharacter, placeExtraPlayer } from './extraPlayerEdits';
import {
  eraseCell,
  floodFillTerrain,
  MapEditResult,
  paintEntity,
  paintItem,
  paintPlayerStart,
  paintTerrain,
  toggleCellEdge
} from './mapEdits';

export type EditorTool = 'brush' | 'fill' | 'eraser' | 'picker' | 'select';

export const EDITOR_TOOLS: readonly EditorTool[] = ['brush', 'fill', 'eraser', 'picker', 'select'];

export type BrushKind = 'terrain' | 'item' | 'entity' | 'player_start' | 'extra_player_start' | 'cell_edge';

/** Id of the thin wall entry of the Epoxy palette (the CC3D palettes keep their own 'panel' entry). */
export const CELL_EDGE_BRUSH_ID = 'cell_edge';

/** Id of the entry of the Epoxy palette that places the start of another player. */
export const EXTRA_PLAYER_BRUSH_ID = 'extra_player_start';

/** Id of the canopy entry of the Epoxy palette: a cell_edge brush that edits the roof flag instead of a side. */
export const CANOPY_BRUSH_ID = 'canopy';

/** What the brush tool places: a palette entry. */
export interface Brush {
  kind: BrushKind;
  id: string;
}

/** A status line the editor announces, as a locale key and its parameters. */
export interface ToolMessage {
  key: string;
  params?: Record<string, string | number>;
}

export const MESSAGE_LINKS_REMOVED = 'editor.layout.status.links_removed';
export const MESSAGE_UNDERLAYS_REMOVED = 'editor.layout.status.underlays_removed';
export const MESSAGE_UNDERLAYS_ERASED = 'editor.layout.status.underlays_erased.label';
export const MESSAGE_START_KEPT = 'editor.layout.status.start_kept';
export const MESSAGE_FILL_NEEDS_TERRAIN = 'editor.layout.status.fill_needs_terrain';
export const MESSAGE_EXTRA_ON_START = 'editor.extra_players.status.on_start.label';
export const MESSAGE_EXTRA_TOO_MANY = 'editor.extra_players.status.too_many.label';
export const MESSAGE_START_ON_EXTRA = 'editor.extra_players.status.start_on_extra.label';

export interface ToolInput {
  map: EditorMap;
  tool: EditorTool;
  brush: Brush;
  dir: Direction;
  /** The side of the cell a thin wall acts on (the pointer's nearest side); the facing when absent. */
  side?: Direction;
  x: number;
  y: number;
  /** True for the secondary button: it erases whatever the tool is. */
  forceErase?: boolean;
  /** Canopy brush only: a drag puts the canopy on (or takes it off) every cell it crosses, as its first cell did. */
  canopyMode?: CanopyMode;
  /** Second player brush only: the character a new start takes. */
  extraCharacter?: PlayerCharacter;
}

export interface ToolOutcome {
  map: EditorMap;
  changed: boolean;
  messages: ToolMessage[];
}

function removedLinksMessage(removed: number): ToolMessage[] {
  return removed > 0 ? [{ key: MESSAGE_LINKS_REMOVED, params: { count: removed } }] : [];
}

function removedUnderlaysMessage(removed: number, key: string = MESSAGE_UNDERLAYS_REMOVED): ToolMessage[] {
  return removed > 0 ? [{ key, params: { count: removed } }] : [];
}

function fromEdit(result: MapEditResult, messages: ToolMessage[] = [], underlaysKey: string = MESSAGE_UNDERLAYS_REMOVED): ToolOutcome {
  return {
    map: result.map,
    changed: result.changed,
    messages: [
      ...messages,
      ...(result.clonerTemplates ?? []).map(clonerTemplateMessage),
      ...removedLinksMessage(result.removedLinks),
      ...removedUnderlaysMessage(result.removedUnderlays, underlaysKey)
    ]
  };
}

function eraseOutcome(input: ToolInput): ToolOutcome {
  let result = eraseCell(input.map, input.x, input.y);
  // A cell that holds only a canopy has nothing else to clear, so the eraser takes the roof off itself.
  if (hasCanopyAt(result.map, input.x, input.y)) {
    const map = cloneMap(result.map);
    toggleCanopyAt(map, input.x, input.y, 'clear');
    result = { ...result, map, changed: true };
  }
  return fromEdit(result, result.playerStartKept ? [{ key: MESSAGE_START_KEPT }] : [], MESSAGE_UNDERLAYS_ERASED);
}

/** True when the brush is the canopy entry. */
export function isCanopyBrush(brush: Brush): boolean {
  return brush.kind === 'cell_edge' && brush.id === CANOPY_BRUSH_ID;
}

/** Edits the canopy flag of a cell; a CC3D map has none. */
function paintCanopy(source: EditorMap, x: number, y: number, mode: CanopyMode): ToolOutcome {
  if (source.cc3d) return { map: source, changed: false, messages: [] };
  const map = cloneMap(source);
  if (!toggleCanopyAt(map, x, y, mode)) return { map: source, changed: false, messages: [] };
  return { map, changed: true, messages: [] };
}

/**
 * Applies the active tool at a cell. Pure: the caller stores the resulting
 * map and messages, and decides what a change means for history.
 */
export function applyTool(input: ToolInput): ToolOutcome {
  const { map, tool, brush, dir, x, y } = input;
  if (input.forceErase || tool === 'eraser') return eraseOutcome(input);
  // The picker takes from the map and the selection tool works on rectangles: neither paints a single cell.
  if (tool === 'picker' || tool === 'select') return { map, changed: false, messages: [] };
  if (tool === 'fill') {
    if (brush.kind !== 'terrain') {
      return { map, changed: false, messages: [{ key: MESSAGE_FILL_NEEDS_TERRAIN }] };
    }
    return fromEdit(floodFillTerrain(map, x, y, brush.id));
  }
  switch (brush.kind) {
    case 'terrain':
      return fromEdit(paintTerrain(map, x, y, brush.id));
    case 'item':
      return fromEdit(paintItem(map, x, y, brush.id));
    case 'entity':
      return fromEdit(paintEntity(map, x, y, brush.id, dir));
    case 'player_start':
      // Two starts never share a cell: the main start does not move onto the start of another player.
      if (extraPlayerAt(map, x, y)) return { map, changed: false, messages: [{ key: MESSAGE_START_ON_EXTRA }] };
      return fromEdit(paintPlayerStart(map, x, y, dir));
    case 'extra_player_start': {
      const placed = placeExtraPlayer(map, x, y, dir, input.extraCharacter ?? defaultExtraCharacter(undefined));
      const refusal =
        placed.refusal === 'on_start'
          ? [{ key: MESSAGE_EXTRA_ON_START }]
          : placed.refusal === 'too_many'
            ? [{ key: MESSAGE_EXTRA_TOO_MANY, params: { count: EXTRA_PLAYERS_MAX } }]
            : [];
      return { map: placed.map, changed: placed.changed, messages: refusal };
    }
    case 'cell_edge':
      if (brush.id === CANOPY_BRUSH_ID) return paintCanopy(map, x, y, input.canopyMode ?? 'toggle');
      return fromEdit(toggleCellEdge(map, x, y, input.side ?? dir));
    default:
      return { map, changed: false, messages: [] };
  }
}

/** True when holding the pointer down and moving keeps painting: fills and thin walls act once per click. */
export function continuesOnDrag(tool: EditorTool, brush: Brush, forceErase: boolean): boolean {
  if (forceErase || tool === 'eraser') return true;
  if (tool !== 'brush') return false;
  return brush.kind !== 'cell_edge' || brush.id === CANOPY_BRUSH_ID;
}

/** What the picker takes from a cell. */
export interface PickedCell {
  brush: Brush;
  /** Facing of the picked entity, when it was one. */
  dir?: Direction;
}

/** The entity of a cell, else its item, else its terrain. */
export function pickFromCell(map: EditorMap, x: number, y: number, floorId: string): PickedCell {
  const entity = map.entities.find((e) => e.x === x && e.y === y);
  if (entity) return { brush: { kind: 'entity', id: entity.type }, dir: entity.dir };
  const item = map.items[y]?.[x];
  if (item) return { brush: { kind: 'item', id: item } };
  return { brush: { kind: 'terrain', id: map.terrain[y]?.[x] ?? floorId } };
}
