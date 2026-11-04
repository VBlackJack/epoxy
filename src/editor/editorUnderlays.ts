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

import { normalizeUnderlays } from '../config/ConfigValidation';
import { DEFAULT_RULESET } from '../core/coreConstants';
import type { CellUnderlay } from '../core/types';


/** The hidden terrain of a map, as the editor reads and rewrites it (Epoxy levels only, never CC3D). */
export interface UnderlayHolder {
  terrain: string[][];
  underlays?: CellUnderlay[];
}

/**
 * The underlays in canonical form (see normalizeUnderlays): only those still valid under the terrain on top,
 * sorted, one per cell. Undefined when none is left.
 */
export function canonicalUnderlays(
  underlays: readonly CellUnderlay[] | undefined,
  terrain: readonly (readonly string[])[]
): CellUnderlay[] | undefined {
  if (!underlays || underlays.length === 0) return undefined;
  return normalizeUnderlays(underlays, terrain, DEFAULT_RULESET) ?? undefined;
}

/** Deep copy of a list of underlays; undefined when it is absent or empty. */
export function cloneUnderlays(underlays: readonly CellUnderlay[] | undefined): CellUnderlay[] | undefined {
  if (!underlays || underlays.length === 0) return undefined;
  return underlays.map((entry) => ({ x: entry.x, y: entry.y, terrain: entry.terrain }));
}

/** True when the map hides terrain under at least one cell. */
export function hasUnderlays(map: Pick<UnderlayHolder, 'underlays'>): boolean {
  return (map.underlays?.length ?? 0) > 0;
}

/** The terrain id hidden under a cell, or undefined when it hides none. */
export function underlayAt(map: Pick<UnderlayHolder, 'underlays'>, x: number, y: number): string | undefined {
  return map.underlays?.find((entry) => entry.x === x && entry.y === y)?.terrain;
}

/** Stores the underlays of a map in canonical form, or removes the field when none is left. */
function commit(map: UnderlayHolder, underlays: readonly CellUnderlay[]): void {
  const canonical = canonicalUnderlays(underlays, map.terrain);
  if (canonical) map.underlays = canonical;
  else delete map.underlays;
}

/** Sets the terrain hidden under one cell (null clears it). The map is changed in place. */
export function setUnderlayAt(map: UnderlayHolder, x: number, y: number, terrain: string | null): void {
  const others = (map.underlays ?? []).filter((entry) => !(entry.x === x && entry.y === y));
  commit(map, terrain === null ? others : [...others, { x, y, terrain }]);
}

/** Removes the underlays of every cell the predicate accepts; returns how many were removed. The map is changed in place. */
export function removeUnderlaysWhere(map: UnderlayHolder, predicate: (x: number, y: number) => boolean): number {
  const before = map.underlays ?? [];
  const kept = before.filter((entry) => !predicate(entry.x, entry.y));
  if (kept.length !== before.length) commit(map, kept);
  return before.length - kept.length;
}

/** The underlays moved by a step; entries leaving the grid are dropped. */
export function translateUnderlays(
  underlays: readonly CellUnderlay[],
  dx: number,
  dy: number,
  width: number,
  height: number
): CellUnderlay[] {
  return underlays
    .map((entry) => ({ x: entry.x + dx, y: entry.y + dy, terrain: entry.terrain }))
    .filter((entry) => entry.x >= 0 && entry.y >= 0 && entry.x < width && entry.y < height);
}

/** Replaces the underlays of a map by a list that may be in any order; stored canonical, field removed when empty. */
export function replaceUnderlays(map: UnderlayHolder, underlays: readonly CellUnderlay[]): void {
  commit(map, underlays);
}

/**
 * Drops the underlays that the terrain now on top can no longer hide (the top was changed to something the
 * player does not remove, or the underlay would turn back into it). Returns how many were dropped.
 * The map is changed in place.
 */
export function pruneUnderlays(map: UnderlayHolder): number {
  const before = map.underlays;
  if (!before || before.length === 0) return 0;
  commit(map, before);
  return before.length - (map.underlays?.length ?? 0);
}

/** The cells whose hidden terrain differs between two lists of underlays, as grid positions. */
export function differingUnderlayCells(
  before: readonly CellUnderlay[] | undefined,
  after: readonly CellUnderlay[] | undefined
): Array<{ x: number; y: number }> {
  const idsOf = (underlays: readonly CellUnderlay[] | undefined): Map<string, string> => {
    const map = new Map<string, string>();
    for (const entry of underlays ?? []) map.set(`${entry.x},${entry.y}`, entry.terrain);
    return map;
  };
  const was = idsOf(before);
  const now = idsOf(after);
  const cells = new Map<string, { x: number; y: number }>();
  for (const entry of [...(before ?? []), ...(after ?? [])]) {
    const key = `${entry.x},${entry.y}`;
    if (was.get(key) !== now.get(key)) cells.set(key, { x: entry.x, y: entry.y });
  }
  return [...cells.values()];
}
