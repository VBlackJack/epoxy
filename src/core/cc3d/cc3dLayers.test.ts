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
import { deriveDisplayLayers } from './cc3dLayers';
import type { Cc3dCell } from './model';

const floor = (): Cc3dCell => ({ terrain: [{ kind: 'floor' }], panels: [], item: null });

describe('deriveDisplayLayers', () => {
  it('derives terrain, item and entity layers row by row', () => {
    const cells: Cc3dCell[] = [
      floor(),
      { terrain: [{ kind: 'floor' }, { kind: 'door', color: 'red' }], panels: [], item: null },
      { terrain: [{ kind: 'floor' }], panels: ['N'], item: { kind: 'key', color: 'blue' } },
      { terrain: [{ kind: 'force', dir: 'E' }], panels: [], item: { kind: 'fish' } }
    ];
    const layers = deriveDisplayLayers({
      width: 2,
      height: 2,
      cells,
      mobs: [{ kind: 'walker', x: 1, y: 0, dir: 'S' }]
    });
    expect(layers.terrain).toEqual([
      ['floor', 'door_red'],
      ['thin_wall_n', 'force_e']
    ]);
    expect(layers.items).toEqual([
      [null, null],
      ['key_blue', 'chip']
    ]);
    expect(layers.entities).toEqual([{ x: 1, y: 0, type: 'walker', dir: 'S' }]);
  });
});
