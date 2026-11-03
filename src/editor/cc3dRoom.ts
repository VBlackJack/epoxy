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

import { type Cc3dCell, type Cc3dLevel, normalizeCell } from '../core/cc3d/model';
import type { Direction } from '../core/types';

/** Id of the "Empty CC3D room" choice of the New dialog; no template may take it. */
export const CC3D_ROOM_CHOICE_ID = 'cc3d_room';

/** Where the player of a new room stands, and which way it faces. */
const ROOM_START_CELL = 1;
const ROOM_START_FACING: Direction = 'S';
/** The exit sits this many cells in from the far corner. */
const ROOM_EXIT_INSET = 2;
const MIN_ROOM_SIZE = 4;

/**
 * A new CC3D room: a wall ring, floor inside, the player in the north-west corner of the floor and an
 * exit in the south-east one. A size under the minimum is raised to it so the room always has a floor,
 * a start and an exit that are three different cells.
 */
export function emptyCc3dRoom(width: number, height: number): Cc3dLevel {
  const w = Math.max(MIN_ROOM_SIZE, Math.floor(width));
  const h = Math.max(MIN_ROOM_SIZE, Math.floor(height));
  const exitX = w - ROOM_EXIT_INSET;
  const exitY = h - ROOM_EXIT_INSET;
  const cells: Cc3dCell[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const layers = border ? [{ kind: 'wall' as const }] : x === exitX && y === exitY ? [{ kind: 'exit' as const }] : [];
      cells.push({ terrain: normalizeCell(layers), panels: [], item: null });
    }
  }
  return { width: w, height: h, cells, mobs: [], player: { x: ROOM_START_CELL, y: ROOM_START_CELL, dir: ROOM_START_FACING } };
}
