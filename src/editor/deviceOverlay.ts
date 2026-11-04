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

import type { DeviceRelations, RelationSystem } from '../core/DeviceRelations';
import { EDITOR_RELATION_MAX_ARROWS } from '../ui/uiConstants';

/**
 * What the canvas draws for the connections of a cell of an Epoxy level: arrows from the controlling cell to the
 * controlled one, and outlines for the cells that are related without a direction worth drawing. Pure: the editor
 * draws it with the colour of each mechanism.
 */

export interface OverlayPoint {
  x: number;
  y: number;
}

export interface DeviceOverlayArrow {
  system: RelationSystem;
  from: OverlayPoint;
  to: OverlayPoint;
}

export interface DeviceOverlay {
  arrows: DeviceOverlayArrow[];
  /** Related cells that get an outline: the teleporter group, and the colour and level-wide cells past the arrow cap. */
  highlights: Array<OverlayPoint & { system: RelationSystem }>;
}

/**
 * The overlay of one cell. What it controls is drawn from it to the target, what controls it from the source to it.
 * Explicit links always get an arrow. Teleporters only get outlines (the group has no direction). Colour and
 * level-wide arrows stop at EDITOR_RELATION_MAX_ARROWS; the cells past the cap are outlined instead. A relation of a
 * cell to itself (the gray button) draws nothing.
 */
export function deviceOverlayFor(rel: DeviceRelations, cell: OverlayPoint): DeviceOverlay {
  const arrows: DeviceOverlayArrow[] = [];
  const highlights: DeviceOverlay['highlights'] = [];
  const arrowKeys = new Set<string>();
  const highlightKeys = new Set<string>();
  let capped = 0;
  const highlight = (x: number, y: number, system: RelationSystem): void => {
    const key = `${x},${y}`;
    if (highlightKeys.has(key)) return;
    highlightKeys.add(key);
    highlights.push({ x, y, system });
  };
  const add = (system: RelationSystem, kind: string, from: OverlayPoint, to: OverlayPoint, other: OverlayPoint): void => {
    if (other.x === cell.x && other.y === cell.y) return;
    if (system === 'teleport') {
      highlight(other.x, other.y, system);
      return;
    }
    const key = `${system}:${from.x},${from.y}>${to.x},${to.y}`;
    if (arrowKeys.has(key)) return;
    if (kind !== 'link') {
      if (capped >= EDITOR_RELATION_MAX_ARROWS) {
        highlight(other.x, other.y, system);
        return;
      }
      capped++;
    }
    arrowKeys.add(key);
    arrows.push({ system, from, to });
  };
  // Links first, so that they are never the ones pushed past the cap.
  const ordered = [
    ...rel.controls.map((r) => ({ r, out: true })),
    ...rel.controlledBy.map((r) => ({ r, out: false }))
  ].sort((a, b) => Number(b.r.kind === 'link') - Number(a.r.kind === 'link'));
  for (const { r, out } of ordered) {
    const other = { x: r.x, y: r.y };
    if (out) add(r.system, r.kind, { x: cell.x, y: cell.y }, other, other);
    else add(r.system, r.kind, other, { x: cell.x, y: cell.y }, other);
  }
  return { arrows, highlights };
}
