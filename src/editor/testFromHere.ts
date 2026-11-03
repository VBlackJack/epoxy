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
import { WALL_TILE_ID } from '../core/coreConstants';
import { CompiledLevel, Ruleset } from '../core/types';
import { EditorMap } from './editorDocument';

export interface GridCell {
  x: number;
  y: number;
}

/** Why "Test from here" is unavailable; each reason has a message key. */
export type TestFromHereBlock = 'no_cell' | 'not_walkable' | 'not_supported';

export const TEST_FROM_HERE_REASON_KEYS: Record<TestFromHereBlock, string> = {
  no_cell: 'editor.test_from.reason.no_cell',
  not_walkable: 'editor.test_from.reason.not_walkable',
  not_supported: 'editor.test_from.reason.not_supported'
};

/** The rulesets whose levels the editor can play from another start: Epoxy (also the default) and Lynx. */
function supportsTestFromHere(ruleset: Ruleset | undefined): boolean {
  return ruleset === undefined || ruleset === 'epoxy' || ruleset === 'lynx';
}

/**
 * The cell "Test from here" would start on: the keyboard cursor while the
 * canvas has the focus, else the last hovered cell, else the cursor.
 */
export function pickTestCell(cursor: GridCell | null, lastHover: GridCell | null, canvasFocused: boolean): GridCell | null {
  if (canvasFocused && cursor) return cursor;
  return lastHover ?? cursor;
}

/**
 * Whether the player may start on a cell: inside the map, on a floor the
 * player walks on (no wall, hazard, exit or locked tile) and not on an
 * entity, the same cells the validator warns about for the start.
 */
export function startCellProblem(
  map: Pick<EditorMap, 'terrain' | 'entities'> & { ruleset?: Ruleset },
  cell: GridCell | null
): TestFromHereBlock | null {
  if (!supportsTestFromHere(map.ruleset)) return 'not_supported';
  if (!cell) return 'no_cell';
  const row = map.terrain[cell.y];
  if (!row || cell.x < 0 || cell.x >= row.length) return 'no_cell';
  const id = row[cell.x];
  const tile = ConfigRegistry.getTile(id);
  const walkable =
    id !== WALL_TILE_ID && tile.passableByPlayer === true && !tile.hazard && !tile.isLevelExit && !tile.requiredKey;
  if (!walkable) return 'not_walkable';
  if (map.entities.some((e) => e.x === cell.x && e.y === cell.y)) return 'not_walkable';
  return null;
}

/**
 * A copy of the level that starts on `cell`, facing the way the saved start
 * faces. Nothing is shared with the source, so the editor's level is never
 * touched by the test.
 */
export function levelStartingAt(level: CompiledLevel, cell: GridCell): CompiledLevel {
  const copy = structuredClone(level);
  copy.playerStart = { x: cell.x, y: cell.y, dir: level.playerStart.dir };
  return copy;
}
