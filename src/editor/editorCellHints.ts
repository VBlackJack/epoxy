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

/**
 * The cell hints (`cellHints`) of an editor map: the text a single hint tile shows in place of the level hint.
 * The editor holds them in canonical form, and only on cells that still hold a hint tile, so a hint tile that is
 * painted over, erased, cut or cropped away takes its text with it, and one that is moved or pasted brings it along.
 */

import { ConfigRegistry } from '../config/ConfigRegistry';
import { normalizeCellHints } from '../config/ConfigValidation';
import type { CellHint } from '../core/types';

/** The cell hints of a map, as the editor reads and rewrites them (never on a CC3D level). */
export interface CellHintHolder {
  terrain: string[][];
  cellHints?: CellHint[];
}

/** True when the cell holds a tile that shows the hint. */
function holdsHintTile(terrain: readonly (readonly string[])[], x: number, y: number): boolean {
  const id = terrain[y]?.[x];
  return id !== undefined && ConfigRegistry.isTerrainTile(id) && ConfigRegistry.getTile(id).showsHint === true;
}

/** The cell hints in canonical form (see normalizeCellHints), kept on hint tiles only; undefined when none is left. */
export function canonicalCellHints(hints: readonly CellHint[] | undefined, terrain: readonly (readonly string[])[]): CellHint[] | undefined {
  if (!hints || hints.length === 0) return undefined;
  const normalized = normalizeCellHints(hints, terrain[0]?.length ?? 0, terrain.length);
  const kept = (normalized ?? []).filter((entry) => holdsHintTile(terrain, entry.x, entry.y));
  return kept.length > 0 ? kept : undefined;
}

/** Deep copy of a list of cell hints; undefined when it is absent or empty. */
export function cloneCellHints(hints: readonly CellHint[] | undefined): CellHint[] | undefined {
  if (!hints || hints.length === 0) return undefined;
  return hints.map((entry) => ({ ...entry }));
}

/** The cell hints moved by (dx, dy), with the ones that leave the new grid dropped. */
export function translateCellHints(hints: readonly CellHint[], dx: number, dy: number, width: number, height: number): CellHint[] {
  return hints
    .map((entry) => ({ ...entry, x: entry.x + dx, y: entry.y + dy }))
    .filter((entry) => entry.x >= 0 && entry.x < width && entry.y >= 0 && entry.y < height);
}

/** Replaces the cell hints of a map by the canonical form of `hints`; the field is removed when none is left. */
export function replaceCellHints(map: CellHintHolder, hints: readonly CellHint[]): void {
  const canonical = canonicalCellHints(hints, map.terrain);
  if (canonical) map.cellHints = canonical;
  else delete map.cellHints;
}

/** Removes the cell hints of the cells the predicate picks; returns how many went. The map is changed in place. */
export function removeCellHintsWhere(map: CellHintHolder, predicate: (x: number, y: number) => boolean): number {
  const before = map.cellHints ?? [];
  const kept = before.filter((entry) => !predicate(entry.x, entry.y));
  if (kept.length !== before.length) replaceCellHints(map, kept);
  return before.length - kept.length;
}

/** The text of a cell hint, or undefined when the cell has none. */
export function cellHintAt(map: Pick<CellHintHolder, 'cellHints'>, x: number, y: number): string | undefined {
  return map.cellHints?.find((entry) => entry.x === x && entry.y === y)?.text;
}

/**
 * Sets the text of the hint tile at (x, y); an empty text removes the entry, so the tile shows the level hint again.
 * The map is changed in place. Returns false when the cell is not a hint tile or nothing changed.
 */
export function setCellHint(map: CellHintHolder, x: number, y: number, text: string): boolean {
  if (!holdsHintTile(map.terrain, x, y)) return false;
  const before = JSON.stringify(map.cellHints ?? null);
  const others = (map.cellHints ?? []).filter((entry) => !(entry.x === x && entry.y === y));
  replaceCellHints(map, text.trim() === '' ? others : [...others, { x, y, text }]);
  return JSON.stringify(map.cellHints ?? null) !== before;
}

/** The cells whose cell hint differs between two lists, as grid positions. */
export function differingCellHintCells(
  before: readonly CellHint[] | undefined,
  after: readonly CellHint[] | undefined
): Array<{ x: number; y: number }> {
  const keyed = (hints: readonly CellHint[] | undefined): Map<string, string> => {
    const map = new Map<string, string>();
    for (const entry of hints ?? []) map.set(`${entry.x},${entry.y}`, entry.text);
    return map;
  };
  const was = keyed(before);
  const now = keyed(after);
  const cells = new Map<string, { x: number; y: number }>();
  for (const entry of [...(before ?? []), ...(after ?? [])]) {
    const key = `${entry.x},${entry.y}`;
    if (was.get(key) !== now.get(key)) cells.set(key, { x: entry.x, y: entry.y });
  }
  return [...cells.values()];
}
