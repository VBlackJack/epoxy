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
import { OPPOSITE_DIRECTION } from './coreConstants';
import { Direction } from './types';

/**
 * Whether a thin wall or a one-way tile stops a step between two adjacent
 * cells. Shared by the engine and the level validator so both read the edges
 * the same way: an edge is blocked from either side.
 */
export function isEdgeBlockedBetween(fromId: string, toId: string, dir: Direction): boolean {
  const fromTile = ConfigRegistry.getTile(fromId);
  const toTile = ConfigRegistry.getTile(toId);
  const opposite = OPPOSITE_DIRECTION[dir];

  if (fromTile.blockedEdges?.includes(dir)) return true;
  if (toTile.blockedEdges?.includes(opposite)) return true;
  if (fromTile.blockedEntryDirections?.includes(opposite)) return true;
  if (toTile.blockedEntryDirections?.includes(dir)) return true;
  return false;
}
