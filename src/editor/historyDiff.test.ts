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
import { placeLayer } from './cc3dEdits';
import { emptyCc3dRoom } from './cc3dRoom';
import { EditorDocument, withCc3d } from './editorDocument';
import { historyDiff } from './historyDiff';

function doc(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    terrain: [
      ['wall', 'wall', 'wall'],
      ['wall', 'floor', 'floor'],
      ['wall', 'floor', 'floor']
    ],
    items: [
      [null, null, null],
      [null, null, null],
      [null, null, null]
    ],
    entities: [{ x: 1, y: 1, type: 'dirt_block', dir: 'S' }],
    trapLinks: [{ buttonX: 1, buttonY: 2, trapX: 2, trapY: 1 }],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' },
    title: 'A',
    hint: '',
    author: '',
    password: 'EDIT',
    timeLimitSeconds: 100,
    chipsRequired: 0,
    winRule: 'exit',
    ruleset: undefined,
    ...overrides
  };
}

describe('historyDiff on an Epoxy map', () => {
  it('finds nothing between equal documents', () => {
    expect(historyDiff(doc(), doc())).toEqual({ cells: [], sizeChanged: false, metadataOnly: false });
  });

  it('lists the terrain and item cells that differ, row by row', () => {
    const after = doc({
      terrain: [
        ['wall', 'wall', 'wall'],
        ['wall', 'floor', 'water'],
        ['wall', 'floor', 'floor']
      ],
      items: [
        [null, null, null],
        [null, null, null],
        ['key_red', null, null]
      ]
    });
    expect(historyDiff(doc(), after).cells).toEqual([
      { x: 2, y: 1 },
      { x: 0, y: 2 }
    ]);
  });

  it('counts an entity at the position it left and the one it reached', () => {
    const after = doc({ entities: [{ x: 2, y: 2, type: 'dirt_block', dir: 'S' }] });
    expect(historyDiff(doc(), after).cells).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 }
    ]);
    expect(historyDiff(doc(), doc({ entities: [{ x: 1, y: 1, type: 'dirt_block', dir: 'N' }] })).cells).toEqual([{ x: 1, y: 1 }]);
  });

  it('treats entities and links with another key order as equal', () => {
    const reordered = doc({
      entities: [{ dir: 'S', type: 'dirt_block', y: 1, x: 1 }],
      trapLinks: [{ trapY: 1, trapX: 2, buttonY: 2, buttonX: 1 }],
      cloneLinks: []
    });
    expect(historyDiff(doc(), reordered).cells).toEqual([]);
    const withClone = doc({ cloneLinks: [{ buttonX: 0, buttonY: 0, clonerX: 2, clonerY: 2, templateType: 'dirt_block', templateDir: 'S' }] });
    const cloneReordered = doc({ cloneLinks: [{ templateDir: 'S', templateType: 'dirt_block', clonerY: 2, clonerX: 2, buttonY: 0, buttonX: 0 }] });
    expect(historyDiff(withClone, cloneReordered).cells).toEqual([]);
  });

  it('counts both ends of a link that was added, removed or changed', () => {
    const after = doc({ trapLinks: [{ buttonX: 1, buttonY: 2, trapX: 2, trapY: 2 }] });
    expect(historyDiff(doc(), after).cells).toEqual([
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 }
    ]);
    expect(historyDiff(doc(), doc({ trapLinks: [] })).cells).toEqual([
      { x: 2, y: 1 },
      { x: 1, y: 2 }
    ]);
  });

  it('counts the old and the new player start, once each', () => {
    const after = doc({ playerStart: { x: 2, y: 2, dir: 'S' } });
    expect(historyDiff(doc(), after).cells).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 }
    ]);
    expect(historyDiff(doc(), doc({ playerStart: { x: 1, y: 1, dir: 'E' } })).cells).toEqual([{ x: 1, y: 1 }]);
  });

  it('reports a change of settings alone as metadataOnly', () => {
    expect(historyDiff(doc(), doc({ title: 'B' }))).toEqual({ cells: [], sizeChanged: false, metadataOnly: true });
    expect(historyDiff(doc(), doc({ ruleset: 'epoxy' })).metadataOnly).toBe(false);
    expect(historyDiff(doc(), doc({ ruleset: 'lynx' })).metadataOnly).toBe(true);
  });

  it('is not metadataOnly when a cell changed too', () => {
    const after = doc({ title: 'B', terrain: [['wall', 'wall', 'wall'], ['wall', 'floor', 'floor'], ['wall', 'floor', 'water']] });
    expect(historyDiff(doc(), after)).toEqual({ cells: [{ x: 2, y: 2 }], sizeChanged: false, metadataOnly: false });
  });

  it('reports a size change with no cell list', () => {
    const after = doc({
      terrain: [
        ['wall', 'wall'],
        ['wall', 'floor']
      ],
      items: [
        [null, null],
        [null, null]
      ]
    });
    expect(historyDiff(doc(), after)).toEqual({ cells: null, sizeChanged: true, metadataOnly: false });
  });
});

describe('historyDiff on a CC3D map', () => {
  const room = emptyCc3dRoom(8, 6);
  const base = withCc3d(doc(), room);

  it('finds the cells whose reference changed', () => {
    const painted = withCc3d(base, placeLayer(room, 3, 2, { kind: 'water' }));
    expect(historyDiff(base, painted)).toEqual({ cells: [{ x: 3, y: 2 }], sizeChanged: false, metadataOnly: false });
    expect(historyDiff(painted, base).cells).toEqual([{ x: 3, y: 2 }]);
  });

  it('sees no change in the same level, and a settings change alone', () => {
    expect(historyDiff(base, withCc3d(base, room)).cells).toEqual([]);
    expect(historyDiff(base, { ...base, hint: 'Look left' })).toEqual({ cells: [], sizeChanged: false, metadataOnly: true });
  });

  it('reports another size without cells', () => {
    const bigger = withCc3d(base, emptyCc3dRoom(10, 6));
    expect(historyDiff(base, bigger)).toEqual({ cells: null, sizeChanged: true, metadataOnly: false });
  });
});
