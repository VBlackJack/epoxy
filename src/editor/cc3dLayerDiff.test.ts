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

import { describe, expect, it } from 'vitest';
import type { Cc3dLevel } from '../core/cc3d/model';
import { eraseCell, placeLayer, placeMob, removeMob, rotateMob, setItem, setPanelSide, setPlayer } from './cc3dEdits';
import { dirtyCc3dCells } from './cc3dLayerDiff';
import { editableCc3dModel } from './cc3dEditorFixtures';

const WIDTH = 5;

function room(): Cc3dLevel {
  return editableCc3dModel(['#####', '#@.iX', '#.K.M', '#####']);
}

const at = (x: number, y: number): number => y * WIDTH + x;

describe('dirty cells of a CC3D level', () => {
  it('finds nothing for the same level', () => {
    const level = room();
    expect(dirtyCc3dCells(level, level)).toEqual([]);
  });

  it('finds the one cell a layer, an item or a thin wall changed', () => {
    const level = room();
    expect(dirtyCc3dCells(level, placeLayer(level, 2, 1, { kind: 'water' }))).toEqual([at(2, 1)]);
    expect(dirtyCc3dCells(level, setItem(level, 2, 2, { kind: 'fish' }))).toEqual([at(2, 2)]);
    expect(dirtyCc3dCells(level, setPanelSide(level, 3, 2, 'N', true))).toEqual([at(3, 2)]);
    expect(dirtyCc3dCells(level, eraseCell(level, 3, 1))).toEqual([at(3, 1)]);
  });

  it('finds the cells a creature appears on, leaves, turns on or is replaced on', () => {
    const level = room();
    expect(dirtyCc3dCells(level, placeMob(level, { kind: 'walker', x: 2, y: 1, dir: 'S' }))).toEqual([at(2, 1)]);
    expect(dirtyCc3dCells(level, removeMob(level, 2, 2))).toEqual([at(2, 2)]);
    expect(dirtyCc3dCells(level, rotateMob(level, 2, 2, 'E'))).toEqual([at(2, 2)]);
    // Erasing a cell with a creature changes the cell and removes the creature: the same single cell.
    expect(dirtyCc3dCells(level, eraseCell(level, 2, 2))).toEqual([at(2, 2)]);
  });

  it('finds both the old and the new cell of the player start, and a turn in place', () => {
    const level = room();
    expect(dirtyCc3dCells(level, setPlayer(level, 2, 1))?.sort()).toEqual([at(1, 1), at(2, 1)]);
    expect(dirtyCc3dCells(level, setPlayer(level, 1, 1, 'N'))).toEqual([at(1, 1)]);
  });

  it('gives up when the grid changed size', () => {
    const level = room();
    expect(dirtyCc3dCells(level, editableCc3dModel(['#####', '#@.X#']))).toBeNull();
  });
});
