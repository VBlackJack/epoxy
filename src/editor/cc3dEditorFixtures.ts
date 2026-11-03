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

import { cc3dModel } from '../core/cc3d/cc3dTestMaps';
import { normalizeCell, type Cc3dLevel } from '../core/cc3d/model';
import type { CompiledLevel } from '../core/types';
import { displayLayersOf } from './editorDocument';

/** Test helper: a CC3D level whose every stack has the floor base a real level has (the glyph "#" is a bare wall). */
export function editableCc3dModel(rows: string[]): Cc3dLevel {
  const model = cc3dModel(rows);
  return { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
}

/** Test helper: the compiled level of a model, as the importer shapes it. */
export function compiledCc3d(cc3d: Cc3dLevel, id = 'cc3d_editor_test'): CompiledLevel {
  const fish = cc3d.cells.filter((cell) => cell.item?.kind === 'fish').length;
  return {
    id,
    ruleset: 'cc3d',
    cc3d,
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: fish,
    customTitle: 'Cc3d test',
    ...displayLayersOf(cc3d)
  };
}

/** The default small level the editor tests start from. */
export function smallCc3dLevel(): CompiledLevel {
  return compiledCc3d({ ...editableCc3dModel(['#####', '#@.iX', '#.K.M', '#####']), mapId: 'small' });
}
