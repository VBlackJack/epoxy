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
import { Direction } from '../types';
import { EpoxyWorld, mapWidth } from './epoxyWorld';

/** The side counter-clockwise of each side (N, W, S, E around the cell). */
const COUNTER_CLOCKWISE_SIDE: Readonly<Record<Direction, Direction>> = {
  N: 'W',
  W: 'S',
  S: 'E',
  E: 'N'
};

/**
 * An actor arrived in the cell by moving `dir`: when the cell is a swivel door, remembers the side it
 * came in by (the opposite of `dir`). The door turns when the actor leaves.
 */
export function enterSwivel(w: EpoxyWorld, x: number, y: number, dir: Direction): void {
  if (!ConfigRegistry.getTile(w.terrain[y][x]).swivelTurns) return;
  w.swivelEntry.set(y * mapWidth(w) + x, OPPOSITE_DIRECTION[dir]);
}

/**
 * An actor is about to leave the cell: a swivel door with a recorded entry side makes a quarter turn so
 * that side closes (clockwise when the side counter-clockwise of it is closed, else counter-clockwise).
 * A door nobody entered (an actor placed on it at the start) does not turn.
 */
export function leaveSwivel(w: EpoxyWorld, x: number, y: number): void {
  const key = y * mapWidth(w) + x;
  const entry = w.swivelEntry.get(key);
  if (entry === undefined) return;
  w.swivelEntry.delete(key);
  const tile = ConfigRegistry.getTile(w.terrain[y][x]);
  if (!tile.swivelTurns) return;
  const clockwise = tile.blockedEdges?.includes(COUNTER_CLOCKWISE_SIDE[entry]) === true;
  w.terrain[y][x] = clockwise ? tile.swivelTurns.cw : tile.swivelTurns.ccw;
  w.beamDirty = true;
}
