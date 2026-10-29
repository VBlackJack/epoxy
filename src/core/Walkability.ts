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

import { TileDefinition } from './types';

/**
 * Whether the player can stand on a tile once every lock, socket and toggle
 * wall is dealt with. Doors, sockets and toggle walls count as open and
 * hazards as crossable; only walls and the like are solid. One definition
 * for the guard check, the scorer and the metrics, so they never disagree.
 */
export function isPlayerWalkable(tile: TileDefinition): boolean {
  return Boolean(tile.passableByPlayer || tile.requiredKey || tile.requiresAllChips || tile.togglesTo);
}
