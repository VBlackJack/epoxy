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

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import type { CellEdge, CompiledLevel } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { canonicalEdges, differingEdgeCells, edgesAt, hasCellEdges, setEdgesAt, translate, withoutCells } from './editorCellEdges';
import { cloneDocument, cloneMap, EditorDocument, EditorMap, sameDocument, withEditedMap } from './editorDocument';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { historyDiff } from './historyDiff';
import { eraseCell, floodFillTerrain, paintEntity, paintItem, paintTerrain, resizeMap } from './mapEdits';
import { describeResize, RESIZE_DROPPED_EDGES_KEY } from './resizeReport';
import { levelMapChanged } from './saveTarget';
import { clearRect, extractClip, moveRect, pasteClip } from './selectionEdits';

const SIZE = 7;
const ROOM_FLOOR = 'floor';
const ROOM_WALL = 'wall';

function room(size = SIZE): string[][] {
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => (x === 0 || y === 0 || x === size - 1 || y === size - 1 ? ROOM_WALL : ROOM_FLOOR))
  );
}

function map(edges?: CellEdge[]): EditorMap {
  const terrain = room();
  return {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' },
    ...(edges ? { cellEdges: edges.map((e) => ({ ...e, sides: [...e.sides] })) } : {})
  };
}

function doc(edges?: CellEdge[]): EditorDocument {
  return {
    ...map(edges),
    title: 'T',
    hint: '',
    author: '',
    password: 'EDIT',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    winRule: 'exit',
    ruleset: undefined
  };
}

const context = { id: 'lvl_edges', number: 1, password: 'EDIT', fallbackTitle: 'T' };
const EDGES: CellEdge[] = [
  { x: 2, y: 2, sides: ['N', 'W'] },
  { x: 4, y: 3, sides: ['E'] }
];

beforeEach(() => {
  loadTestConfigs();
});

describe('the cell edge helpers', () => {
  it('reads the sides of a cell, and nothing for a cell without edges', () => {
    expect(edgesAt(map(EDGES), 2, 2)).toEqual(['N', 'W']);
    expect(edgesAt(map(EDGES), 3, 3)).toEqual([]);
    expect(hasCellEdges(map(EDGES))).toBe(true);
    expect(hasCellEdges(map())).toBe(false);
  });

  it('stores the sides canonical, and removes the field when none is left', () => {
    const m = map();
    setEdgesAt(m, 3, 3, ['W', 'N']);
    setEdgesAt(m, 1, 1, ['S']);
    expect(m.cellEdges).toEqual([
      { x: 1, y: 1, sides: ['S'] },
      { x: 3, y: 3, sides: ['N', 'W'] }
    ]);
    setEdgesAt(m, 3, 3, []);
    setEdgesAt(m, 1, 1, []);
    expect(m.cellEdges).toBeUndefined();
    expect('cellEdges' in m).toBe(false);
  });

  it('removes the cells of a rectangle and counts them', () => {
    const m = map(EDGES);
    expect(withoutCells(m, { x: 2, y: 2, width: 1, height: 1 })).toBe(1);
    expect(m.cellEdges).toEqual([{ x: 4, y: 3, sides: ['E'] }]);
  });

  it('translates and drops what leaves the grid', () => {
    expect(translate(EDGES, 1, 1, SIZE, SIZE)).toEqual([
      { x: 3, y: 3, sides: ['N', 'W'] },
      { x: 5, y: 4, sides: ['E'] }
    ]);
    expect(translate(EDGES, 3, 0, SIZE, SIZE)).toEqual([{ x: 5, y: 2, sides: ['N', 'W'] }]);
  });

  it('puts an unsorted list in canonical form and finds the cells that differ', () => {
    const messy: CellEdge[] = [
      { x: 4, y: 3, sides: ['E'] },
      { x: 2, y: 2, sides: ['W'] },
      { x: 2, y: 2, sides: ['N'] }
    ];
    expect(canonicalEdges(messy, room())).toEqual(EDGES);
    expect(differingEdgeCells(EDGES, [{ x: 2, y: 2, sides: ['N'] }, EDGES[1]])).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('thin walls through the document', () => {
  it('survive a round trip through the editor document', () => {
    const level = levelFromDocument(doc(EDGES), context);
    expect(level.cellEdges).toEqual(EDGES);
    const back = documentFromLevel(level, { title: 'T', hint: '' });
    expect(back.cellEdges).toEqual(EDGES);
    expect(levelFromDocument(back, context).cellEdges).toEqual(EDGES);
  });

  it('are absent from a level that has none', () => {
    expect('cellEdges' in levelFromDocument(doc(), context)).toBe(false);
    expect('cellEdges' in levelFromDocument(doc([]), context)).toBe(false);
  });

  it('are not exported under the Lynx ruleset', () => {
    const level = levelFromDocument({ ...doc(EDGES), ruleset: 'lynx' }, context);
    expect('cellEdges' in level).toBe(false);
  });

  it('are copied by cloneMap and cloneDocument without sharing', () => {
    const source = map(EDGES);
    const copy = cloneMap(source);
    copy.cellEdges![0].sides.push('S');
    copy.cellEdges!.push({ x: 1, y: 1, sides: ['N'] });
    expect(source.cellEdges).toEqual(EDGES);
    const original = doc(EDGES);
    const docCopy = cloneDocument(original);
    expect(docCopy.cellEdges).toEqual(EDGES);
    docCopy.cellEdges![1].sides = [];
    expect(original.cellEdges).toEqual(EDGES);
  });

  it('make two documents differ when only the edges differ', () => {
    expect(sameDocument(doc(EDGES), doc(EDGES))).toBe(true);
    expect(sameDocument(doc(EDGES), doc())).toBe(false);
    expect(sameDocument(doc([]), doc())).toBe(true);
    expect(sameDocument(doc(EDGES), doc([{ x: 2, y: 2, sides: ['N'] }, EDGES[1]]))).toBe(false);
  });

  it('are dropped from the document when an edit removes the last one', () => {
    const result = eraseCell(map([EDGES[0]]), 2, 2);
    expect(withEditedMap(doc([EDGES[0]]), result.map).cellEdges).toBeUndefined();
  });

  it('count as a map change when only they differ', () => {
    const base = levelFromDocument(doc(), context);
    const withEdges = levelFromDocument(doc(EDGES), context);
    expect(levelMapChanged(base, withEdges)).toBe(true);
    expect(levelMapChanged(withEdges, levelFromDocument(doc(EDGES), context))).toBe(false);
    const empty: CompiledLevel = { ...withEdges, cellEdges: [] };
    expect(levelMapChanged(base, empty)).toBe(false);
  });

  it('count as a history change at their cells', () => {
    const diff = historyDiff(doc(), doc(EDGES));
    expect(diff.cells).toEqual([
      { x: 2, y: 2 },
      { x: 4, y: 3 }
    ]);
    expect(diff.metadataOnly).toBe(false);
    expect(historyDiff(doc(EDGES), doc([{ x: 2, y: 2, sides: ['N'] }, EDGES[1]])).cells).toEqual([{ x: 2, y: 2 }]);
  });
});

describe('map edits and thin walls', () => {
  it('keep the edges of a cell that is painted, filled, given an item or an entity', () => {
    const source = map(EDGES);
    expect(paintTerrain(source, 2, 2, 'water').map.cellEdges).toEqual(EDGES);
    expect(floodFillTerrain(source, 3, 3, 'water').map.cellEdges).toEqual(EDGES);
    expect(paintItem(source, 2, 2, 'key_red').map.cellEdges).toEqual(EDGES);
    expect(paintEntity(source, 2, 2, 'dirt_block', 'S').map.cellEdges).toEqual(EDGES);
  });

  it('are removed with the cell by the eraser', () => {
    const result = eraseCell(map(EDGES), 2, 2);
    expect(result.changed).toBe(true);
    expect(result.map.cellEdges).toEqual([EDGES[1]]);
  });

  it('make an otherwise empty cell not empty for the eraser', () => {
    expect(eraseCell(map(), 3, 3).changed).toBe(false);
    const result = eraseCell(map([{ x: 3, y: 3, sides: ['S'] }]), 3, 3);
    expect(result.changed).toBe(true);
    expect(result.map.cellEdges).toBeUndefined();
  });

  it('are kept in bounds and counted when cropped by a resize', () => {
    const edges: CellEdge[] = [
      { x: 2, y: 2, sides: ['N'] },
      { x: 6, y: 3, sides: ['E'] }
    ];
    const result = resizeMap(map(edges), 6, 6, ConfigRegistry.getLevelSizeBounds());
    expect(result.map.cellEdges).toEqual([{ x: 2, y: 2, sides: ['N'] }]);
    expect(result.report.droppedEdges).toBe(1);
    expect(describeResize(result).some((n) => n.key === RESIZE_DROPPED_EDGES_KEY && n.params?.count === 1)).toBe(true);
  });

  it('are dropped on a cell the new border turns to wall', () => {
    const edges: CellEdge[] = [
      { x: 2, y: 2, sides: ['N'] },
      { x: 4, y: 2, sides: ['E'] }
    ];
    const result = resizeMap(map(edges), 5, 5, ConfigRegistry.getLevelSizeBounds());
    expect(result.map.cellEdges).toEqual([{ x: 2, y: 2, sides: ['N'] }]);
    expect(result.report.droppedEdges).toBe(1);
  });

  it('are all kept when the map grows', () => {
    const result = resizeMap(map(EDGES), 9, 9, ConfigRegistry.getLevelSizeBounds());
    expect(result.map.cellEdges).toEqual(EDGES);
    expect(result.report.droppedEdges).toBe(0);
    expect(describeResize(result).some((n) => n.key === RESIZE_DROPPED_EDGES_KEY)).toBe(false);
  });

  it('are gone from the map once the resize dropped the last one', () => {
    const result = resizeMap(map([{ x: 6, y: 3, sides: ['E'] }]), 6, 6, ConfigRegistry.getLevelSizeBounds());
    expect('cellEdges' in result.map).toBe(false);
  });
});

describe('selection edits and thin walls', () => {
  it('copy the edges of the cells of the rectangle, relative to it', () => {
    const clip = extractClip(map(EDGES), { x: 2, y: 2, width: 3, height: 2 }, false);
    expect(clip.edges).toEqual([
      { dx: 0, dy: 0, sides: ['N', 'W'] },
      { dx: 2, dy: 1, sides: ['E'] }
    ]);
    expect(extractClip(map(), { x: 2, y: 2, width: 2, height: 2 }, false).edges).toBeUndefined();
  });

  it('are removed inside a cleared rectangle only', () => {
    const result = clearRect(map(EDGES), { x: 2, y: 2, width: 1, height: 1 });
    expect(result.changed).toBe(true);
    expect(result.map.cellEdges).toEqual([EDGES[1]]);
    expect(clearRect(map(EDGES), { x: 1, y: 1, width: 1, height: 1 }).changed).toBe(false);
  });

  it('count as a change of a cleared rectangle when they were all there was', () => {
    const result = clearRect(map([{ x: 3, y: 3, sides: ['N'] }]), { x: 3, y: 3, width: 1, height: 1 });
    expect(result.changed).toBe(true);
    expect(result.map.cellEdges).toBeUndefined();
  });

  it('move with the content and replace what the target held', () => {
    const edges: CellEdge[] = [
      { x: 2, y: 2, sides: ['N', 'W'] },
      { x: 3, y: 2, sides: ['S'] }
    ];
    const result = moveRect(map(edges), { x: 2, y: 2, width: 1, height: 1 }, 1, 0);
    expect(result.changed).toBe(true);
    expect(result.map.cellEdges).toEqual([{ x: 3, y: 2, sides: ['N', 'W'] }]);
  });

  it('move to a target without edges and leave none behind', () => {
    const result = moveRect(map([EDGES[0]]), { x: 2, y: 2, width: 1, height: 1 }, 0, 1);
    expect(result.map.cellEdges).toEqual([{ x: 2, y: 3, sides: ['N', 'W'] }]);
  });

  it('are written by a paste on the written cells, which clears the others', () => {
    const clip = extractClip(map(EDGES), { x: 2, y: 2, width: 2, height: 1 }, false);
    const target = map([
      { x: 4, y: 4, sides: ['W'] },
      { x: 5, y: 4, sides: ['S'] }
    ]);
    const result = pasteClip(target, clip, 4, 4, 'epoxy');
    expect(result.map.cellEdges).toEqual([{ x: 4, y: 4, sides: ['N', 'W'] }]);
  });

  it('are kept on cells a paste skips because they sit on the ring', () => {
    const clip = extractClip(map(EDGES), { x: 2, y: 2, width: 1, height: 1 }, false);
    const target = map([{ x: 0, y: 3, sides: ['E'] }]);
    const result = pasteClip(target, clip, 0, 3, 'epoxy');
    expect(result.borderSkipped).toBe(1);
    expect(result.map.cellEdges).toEqual([{ x: 0, y: 3, sides: ['E'] }]);
  });

  it('are dropped and counted when pasted under Lynx', () => {
    const clip = extractClip(map(EDGES), { x: 2, y: 2, width: 3, height: 2 }, false);
    const result = pasteClip(map(), clip, 2, 2, 'lynx');
    expect(result.map.cellEdges).toBeUndefined();
    expect(result.skipped).toBe(2);
  });

  it('make a paste of edges alone a change', () => {
    const clip = extractClip(map(EDGES), { x: 2, y: 2, width: 1, height: 1 }, false);
    const result = pasteClip(map(), clip, 5, 4, 'epoxy');
    expect(result.changed).toBe(true);
    expect(result.map.cellEdges).toEqual([{ x: 5, y: 4, sides: ['N', 'W'] }]);
  });
});
