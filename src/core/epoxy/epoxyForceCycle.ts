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

import { FORCE_CYCLE_ORDER } from '../../config/constants';
import type { Direction, TileDefinition } from '../types';
import type { EpoxyWorld } from './epoxyWorld';

/**
 * The direction a turning force floor pushes an actor that has just arrived on it, or null when the tile is not
 * a turning force floor. Every arrival of any actor (player, block or monster, carried or not, protected or not)
 * on any such cell takes the next direction of the level's shared turn: the first arrival pushes east, then
 * south, west and north, and east again.
 */
export function forceCycleArrival(w: EpoxyWorld, tile: TileDefinition): Direction | null {
  if (tile.forceCycle !== true) return null;
  const dir = FORCE_CYCLE_ORDER[w.forceCycleTurn % FORCE_CYCLE_ORDER.length];
  w.forceCycleTurn++;
  return dir;
}
