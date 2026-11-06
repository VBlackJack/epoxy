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

import { ConfigRegistry } from '../../config/ConfigRegistry';
import { OPPOSITE_DIRECTION } from '../coreConstants';
import { Direction, RuntimeEntity, TileDefinition } from '../types';
import { EpoxyWorld } from './epoxyWorld';

/**
 * The way a creature that came onto a rail piece moving `dir` faces next: the open side other than the one it came
 * in by, so a forward move follows the curve of a bend. Null when the tile is not a rail or the creature did not
 * come in by an open side (a teleport or a clone spawn can drop it anywhere), in which case its facing stays. On a
 * straight piece the result is `dir` itself.
 */
export function railExitFacing(tile: TileDefinition, dir: Direction): Direction | null {
  const sides = tile.railSides;
  if (sides === undefined) return null;
  const entry = OPPOSITE_DIRECTION[dir];
  if (!sides.includes(entry)) return null;
  return sides.find((side) => side !== entry) ?? null;
}

/**
 * Whether a monster steers by turning towards a wall side first (a bug, a paramecium). Its own turn order already
 * takes a bend (a left turn at a bend that opens to its left), so resetting its facing would only make it step back
 * the way it came. (Deviation from the first design, accepted: the facing reset applies to forward-first monsters.)
 */
function turnsToSideFirst(monster: RuntimeEntity): boolean {
  const first = ConfigRegistry.getEntityDef(monster.type)?.turnOrder?.[0];
  return first === 'LEFT' || first === 'RIGHT';
}

/**
 * A monster has just arrived at its cell moving in its facing: on a rail it turns to the open side it did not come
 * in by, so a forward move follows a bend. Wall followers keep their facing (see turnsToSideFirst).
 */
export function followRail(w: EpoxyWorld, monster: RuntimeEntity): void {
  if (turnsToSideFirst(monster)) return;
  const exit = railExitFacing(ConfigRegistry.getTile(w.terrain[monster.y][monster.x]), monster.dir);
  if (exit !== null) monster.dir = exit;
}
