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

import { Direction } from '../core/types';
import { EditorMap } from './editorDocument';
import {
  eraseCell,
  floodFillTerrain,
  MapEditResult,
  paintEntity,
  paintItem,
  paintPlayerStart,
  paintTerrain,
  placeWireButton,
  placeWireLink,
  toggleCellEdge,
  WireKind,
  WireRefusal
} from './mapEdits';

export type EditorTool = 'brush' | 'fill' | 'eraser' | 'picker' | 'select';

export const EDITOR_TOOLS: readonly EditorTool[] = ['brush', 'fill', 'eraser', 'picker', 'select'];

export type BrushKind = 'terrain' | 'item' | 'entity' | 'player_start' | 'wire_trap' | 'wire_cloner' | 'cell_edge';

/** Id of the thin wall entry of the Epoxy palette (the CC3D palettes keep their own 'panel' entry). */
export const CELL_EDGE_BRUSH_ID = 'cell_edge';

/** What the brush tool places: a palette entry. */
export interface Brush {
  kind: BrushKind;
  id: string;
}

/** The button of a wire that waits for its target. */
export interface PendingWire {
  kind: WireKind;
  x: number;
  y: number;
}

/** A status line the editor announces, as a locale key and its parameters. */
export interface ToolMessage {
  key: string;
  params?: Record<string, string | number>;
}

export const MESSAGE_WIRE_SELECT_TARGET = 'editor.palette.status.wire_select_target';
export const MESSAGE_WIRE_LINKED = 'editor.palette.status.wire_linked';
export const MESSAGE_LINKS_REMOVED = 'editor.layout.status.links_removed';
export const MESSAGE_UNDERLAYS_REMOVED = 'editor.layout.status.underlays_removed';
export const MESSAGE_UNDERLAYS_ERASED = 'editor.layout.status.underlays_erased.label';
export const MESSAGE_START_KEPT = 'editor.layout.status.start_kept';
export const MESSAGE_FILL_NEEDS_TERRAIN = 'editor.layout.status.fill_needs_terrain';
export const MESSAGE_WIRE_SAME_CELL = 'editor.layout.status.wire_same_cell';
export const MESSAGE_WIRE_MISSING_BUTTON = 'editor.layout.status.wire_missing_button';
export const MESSAGE_WIRE_CANCELLED = 'editor.layout.status.wire_cancelled';
export const MESSAGE_WIRE_CANCELLED_BUTTON_LEFT = 'editor.layout.status.wire_cancelled_button_left';

const WIRE_REFUSAL_MESSAGES: Record<WireRefusal, string> = {
  same_cell: MESSAGE_WIRE_SAME_CELL,
  missing_button: MESSAGE_WIRE_MISSING_BUTTON
};

export interface ToolInput {
  map: EditorMap;
  tool: EditorTool;
  brush: Brush;
  dir: Direction;
  /** The side of the cell a thin wall acts on (the pointer's nearest side); the facing when absent. */
  side?: Direction;
  x: number;
  y: number;
  pendingWire: PendingWire | null;
  /** True for the secondary button: it erases whatever the tool is. */
  forceErase?: boolean;
}

export interface ToolOutcome {
  map: EditorMap;
  changed: boolean;
  pendingWire: PendingWire | null;
  messages: ToolMessage[];
}

function wireKindOf(brush: Brush): WireKind | null {
  if (brush.kind === 'wire_trap') return 'trap';
  if (brush.kind === 'wire_cloner') return 'clone';
  return null;
}

function removedLinksMessage(removed: number): ToolMessage[] {
  return removed > 0 ? [{ key: MESSAGE_LINKS_REMOVED, params: { count: removed } }] : [];
}

function removedUnderlaysMessage(removed: number, key: string = MESSAGE_UNDERLAYS_REMOVED): ToolMessage[] {
  return removed > 0 ? [{ key, params: { count: removed } }] : [];
}

function fromEdit(
  result: MapEditResult,
  pendingWire: PendingWire | null,
  messages: ToolMessage[] = [],
  underlaysKey: string = MESSAGE_UNDERLAYS_REMOVED
): ToolOutcome {
  return {
    map: result.map,
    changed: result.changed,
    pendingWire,
    messages: [...messages, ...removedLinksMessage(result.removedLinks), ...removedUnderlaysMessage(result.removedUnderlays, underlaysKey)]
  };
}

function eraseOutcome(input: ToolInput): ToolOutcome {
  const result = eraseCell(input.map, input.x, input.y);
  return fromEdit(result, input.pendingWire, result.playerStartKept ? [{ key: MESSAGE_START_KEPT }] : [], MESSAGE_UNDERLAYS_ERASED);
}

function wireOutcome(input: ToolInput, kind: WireKind): ToolOutcome {
  const { map, x, y, pendingWire } = input;
  if (!pendingWire) {
    const placed = placeWireButton(map, kind, x, y);
    return fromEdit(placed, { kind, x, y }, [{ key: MESSAGE_WIRE_SELECT_TARGET }]);
  }
  const linked = placeWireLink(map, pendingWire.kind, pendingWire, { x, y }, input.dir);
  if (linked.refused) {
    const key = linked.refusal ? WIRE_REFUSAL_MESSAGES[linked.refusal] : MESSAGE_WIRE_MISSING_BUTTON;
    return { map, changed: false, pendingWire, messages: [{ key }] };
  }
  return fromEdit(linked, null, [{ key: MESSAGE_WIRE_LINKED }]);
}

/**
 * Applies the active tool at a cell. Pure: the caller stores the resulting
 * map, pending wire and messages, and decides what a change means for history.
 */
export function applyTool(input: ToolInput): ToolOutcome {
  const { map, tool, brush, dir, x, y } = input;
  if (input.forceErase || tool === 'eraser') return eraseOutcome(input);
  // The picker takes from the map and the selection tool works on rectangles: neither paints a single cell.
  if (tool === 'picker' || tool === 'select') return { map, changed: false, pendingWire: input.pendingWire, messages: [] };
  if (tool === 'fill') {
    if (brush.kind !== 'terrain') {
      return { map, changed: false, pendingWire: input.pendingWire, messages: [{ key: MESSAGE_FILL_NEEDS_TERRAIN }] };
    }
    return fromEdit(floodFillTerrain(map, x, y, brush.id), input.pendingWire);
  }
  const wire = wireKindOf(brush);
  if (wire) return wireOutcome(input, wire);
  switch (brush.kind) {
    case 'terrain':
      return fromEdit(paintTerrain(map, x, y, brush.id), input.pendingWire);
    case 'item':
      return fromEdit(paintItem(map, x, y, brush.id), input.pendingWire);
    case 'entity':
      return fromEdit(paintEntity(map, x, y, brush.id, dir), input.pendingWire);
    case 'player_start':
      return fromEdit(paintPlayerStart(map, x, y, dir), input.pendingWire);
    case 'cell_edge':
      return fromEdit(toggleCellEdge(map, x, y, input.side ?? dir), input.pendingWire);
    default:
      return { map, changed: false, pendingWire: input.pendingWire, messages: [] };
  }
}

/** True when holding the pointer down and moving keeps painting: wires, fills and thin walls act once per click. */
export function continuesOnDrag(tool: EditorTool, brush: Brush, forceErase: boolean): boolean {
  if (forceErase || tool === 'eraser') return true;
  if (tool !== 'brush') return false;
  return wireKindOf(brush) === null && brush.kind !== 'cell_edge';
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

/** Whether a wire that is dropped leaves its button on the map with no link. */
export function leavesLooseButton(map: EditorMap, pending: PendingWire, buttonTileId: string): boolean {
  if (map.terrain[pending.y]?.[pending.x] !== buttonTileId) return false;
  const linked =
    map.trapLinks.some((l) => l.buttonX === pending.x && l.buttonY === pending.y) ||
    map.cloneLinks.some((l) => l.buttonX === pending.x && l.buttonY === pending.y);
  return !linked;
}
