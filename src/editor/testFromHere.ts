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
import { CC3D_CLASS_FLOOR, cellAt, terrainClass, topTerrain } from '../core/cc3d/model';
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

/** The rulesets whose levels the editor can play from another start: Epoxy (also the default), Lynx and CC3D. */
function supportsTestFromHere(ruleset: Ruleset | undefined): boolean {
  return ruleset === undefined || ruleset === 'epoxy' || ruleset === 'lynx' || ruleset === 'cc3d';
}

/**
 * The cell "Test from here" would start on: the keyboard cursor, which a click
 * or a paint on the canvas also sets, else the last hovered cell.
 */
export function pickTestCell(cursor: GridCell | null, lastHover: GridCell | null): GridCell | null {
  return cursor ?? lastHover;
}

/** CC3D terrain a player must not start on: it kills, or it ends the level at once. */
const CC3D_UNSAFE_START_KINDS: readonly string[] = ['water', 'fire', 'exit'];

/** The start rule of a CC3D level: a bare floor-like top layer that is not a hazard, with no mob on it. */
function cc3dStartCellProblem(map: Pick<EditorMap, 'cc3d'>, cell: GridCell | null): TestFromHereBlock | null {
  const cc3d = map.cc3d;
  if (!cc3d) return 'not_supported';
  if (!cell) return 'no_cell';
  const target = cellAt(cc3d, cell.x, cell.y);
  if (!target) return 'no_cell';
  const top = topTerrain(target);
  if (terrainClass(top.kind) !== CC3D_CLASS_FLOOR || CC3D_UNSAFE_START_KINDS.includes(top.kind)) return 'not_walkable';
  if (cc3d.mobs.some((mob) => mob.x === cell.x && mob.y === cell.y)) return 'not_walkable';
  return null;
}

/**
 * Whether the player may start on a cell: inside the map, on a floor the
 * player walks on (no wall, hazard, exit or locked tile) and not on an
 * entity or a hazardous item such as a bomb. Walls and entities are the cells
 * the validator warns about for the start.
 */
export function startCellProblem(
  map: Pick<EditorMap, 'terrain' | 'entities' | 'items' | 'cc3d'> & { ruleset?: Ruleset },
  cell: GridCell | null
): TestFromHereBlock | null {
  if (!supportsTestFromHere(map.ruleset)) return 'not_supported';
  if (map.ruleset === 'cc3d') return cc3dStartCellProblem(map, cell);
  if (!cell) return 'no_cell';
  const row = map.terrain[cell.y];
  if (!row || cell.x < 0 || cell.x >= row.length) return 'no_cell';
  const id = row[cell.x];
  const tile = ConfigRegistry.getTile(id);
  const walkable =
    id !== WALL_TILE_ID && tile.passableByPlayer === true && !tile.hazard && !tile.isLevelExit && !tile.requiredKey;
  if (!walkable) return 'not_walkable';
  if (map.entities.some((e) => e.x === cell.x && e.y === cell.y)) return 'not_walkable';
  const item = map.items[cell.y]?.[cell.x];
  if (item && ConfigRegistry.getTile(item).hazard) return 'not_walkable';
  return null;
}

/**
 * A copy of the level that starts on `cell`, facing the way the saved start
 * faces. Nothing is shared with the source, so the editor's level is never
 * touched by the test. The other players of a level with several keep their starts, so the test plays the
 * whole team; the one that stood on the chosen cell gives it up to the main player.
 */
export function levelStartingAt(level: CompiledLevel, cell: GridCell): CompiledLevel {
  const copy = structuredClone(level);
  copy.playerStart = { x: cell.x, y: cell.y, dir: level.playerStart.dir };
  // The chosen cell is a start of its own, so an imported level without one becomes playable from there
  delete copy.missingStart;
  if (copy.extraPlayers) {
    copy.extraPlayers = copy.extraPlayers.filter((p) => p.x !== cell.x || p.y !== cell.y);
    if (copy.extraPlayers.length === 0) delete copy.extraPlayers;
  }
  if (copy.cc3d) {
    const dir = level.cc3d?.player.dir;
    copy.cc3d.player = dir === undefined ? { x: cell.x, y: cell.y } : { x: cell.x, y: cell.y, dir };
  }
  return copy;
}
