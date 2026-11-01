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


import { TileDefinition } from '../core/types';

/**
 * Terrain key of the footstep onto a tile: its slide type (a force floor
 * counts even when the boots cancel the push, it is still the floor
 * material), else its hazard when the boots protect from it, else null.
 * Without the boots a hazard keeps the plain step: the splash or burn sound
 * follows on its own. Shared by both engines.
 */
export function stepTerrainOf(tile: TileDefinition, boots: ReadonlySet<string>): string | null {
  if (tile.slideType) return tile.slideType;
  if (tile.hazard && tile.protectedByItem && boots.has(tile.protectedByItem)) return tile.hazard;
  return null;
}
