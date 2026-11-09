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

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigRegistry } from '../config/ConfigRegistry';
import { PACK_JSON_VERSION } from '../config/constants';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { makeLevel } from '../test/packFixtures';
import { parsePackJson, serializePack } from '../packs/packJson';
import { CellHintPanel, withCellHint } from './cellHintPanel';
import { cellHintAt, setCellHint } from './editorCellHints';
import { sameDocument, type EditorMap } from './editorDocument';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { eraseCell, floodFillTerrain, paintTerrain, resizeMap } from './mapEdits';
import { clearRect, moveRect } from './selectionEdits';

beforeEach(() => {
  loadTestConfigs();
});

/** A bordered 8 x 5 room with hint tiles at (2, 1) and (5, 3), each with a text of its own. */
function hintMap(): EditorMap {
  const terrain: string[][] = Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 8 }, (_, x) => (x === 0 || y === 0 || x === 7 || y === 4 ? 'wall' : 'floor'))
  );
  terrain[1][2] = 'hint';
  terrain[3][5] = 'hint';
  return {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' },
    cellHints: [
      { x: 2, y: 1, text: 'first' },
      { x: 5, y: 3, text: 'second' }
    ]
  };
}

describe('setCellHint', () => {
  it('sets, replaces and clears the text of a hint tile', () => {
    const map = hintMap();
    expect(setCellHint(map, 2, 1, 'changed')).toBe(true);
    expect(cellHintAt(map, 2, 1)).toBe('changed');
    expect(setCellHint(map, 2, 1, 'changed')).toBe(false);
    expect(setCellHint(map, 2, 1, '   ')).toBe(true);
    expect(cellHintAt(map, 2, 1)).toBeUndefined();
    expect(map.cellHints).toEqual([{ x: 5, y: 3, text: 'second' }]);
    expect(setCellHint(map, 5, 3, '')).toBe(true);
    expect('cellHints' in map).toBe(false);
  });

  it('refuses a cell that is not a hint tile', () => {
    const map = hintMap();
    expect(setCellHint(map, 3, 2, 'nope')).toBe(false);
    expect(cellHintAt(map, 3, 2)).toBeUndefined();
  });

  it('is exposed on a copy by withCellHint, which leaves the source untouched and refuses a no-op', () => {
    const map = hintMap();
    const next = withCellHint(map, 2, 1, 'new');
    expect(next && cellHintAt(next, 2, 1)).toBe('new');
    expect(cellHintAt(map, 2, 1)).toBe('first');
    expect(withCellHint(map, 2, 1, 'first')).toBeNull();
  });
});

describe('edits that change or move a hint tile', () => {
  it('drops the text of a tile that is painted over, erased or flood filled, and keeps the others', () => {
    const painted = paintTerrain(hintMap(), 2, 1, 'wall').map;
    expect(painted.cellHints).toEqual([{ x: 5, y: 3, text: 'second' }]);
    const erased = eraseCell(hintMap(), 5, 3).map;
    expect(erased.cellHints).toEqual([{ x: 2, y: 1, text: 'first' }]);
    const filled = floodFillTerrain(hintMap(), 2, 1, 'wall').map;
    expect(filled.cellHints).toEqual([{ x: 5, y: 3, text: 'second' }]);
  });

  it('keeps the text when the tile is painted with itself', () => {
    expect(paintTerrain(hintMap(), 2, 1, 'hint').map.cellHints).toHaveLength(2);
  });

  it('moves the text with the tile in a selection move', () => {
    const moved = moveRect(hintMap(), { x: 1, y: 1, width: 3, height: 2 }, 1, 1).map;
    expect(moved.terrain[2][3]).toBe('hint');
    expect(cellHintAt(moved, 3, 2)).toBe('first');
    expect(cellHintAt(moved, 2, 1)).toBeUndefined();
    expect(cellHintAt(moved, 5, 3)).toBe('second');
  });

  it('drops the text of a cleared selection', () => {
    const cleared = clearRect(hintMap(), { x: 1, y: 1, width: 3, height: 2 }).map;
    expect(cleared.cellHints).toEqual([{ x: 5, y: 3, text: 'second' }]);
  });

  it('follows its tile when the map is resized from another anchor, and drops it when cropped away', () => {
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const grown = resizeMap(hintMap(), 10, 7, bounds, { col: 1, row: 1 }).map;
    expect(grown.cellHints).toEqual([
      { x: 3, y: 2, text: 'first' },
      { x: 6, y: 4, text: 'second' }
    ]);
    const cropped = resizeMap(hintMap(), 5, 5, bounds).map;
    expect(cropped.cellHints).toEqual([{ x: 2, y: 1, text: 'first' }]);
  });
});

describe('document round trip', () => {
  const exportContext = { id: 'cell_hints', number: 1, password: 'TEST', fallbackTitle: 'Hints' };

  it('keeps the texts through load, compare and save', () => {
    const level = { ...makeLevel('hints', { terrain: hintMap().terrain }), cellHints: hintMap().cellHints };
    const doc = documentFromLevel(level, { title: 'T', hint: 'Level hint' });
    expect(doc.cellHints).toEqual(hintMap().cellHints);
    const saved = levelFromDocument(doc, exportContext);
    expect(saved.cellHints).toEqual(hintMap().cellHints);
    expect(sameDocument(doc, documentFromLevel(saved, { title: 'T', hint: 'Level hint' }))).toBe(true);
    const edited = { ...doc, cellHints: [{ x: 2, y: 1, text: 'other' }] };
    expect(sameDocument(doc, edited)).toBe(false);
  });

  it('drops an orphan text on load and on save, and writes no field without text', () => {
    const level = { ...makeLevel('orphan', { terrain: hintMap().terrain }), cellHints: [{ x: 3, y: 2, text: 'orphan' }] };
    const doc = documentFromLevel(level, { title: 'T', hint: '' });
    expect('cellHints' in doc).toBe(false);
    expect('cellHints' in levelFromDocument({ ...doc, cellHints: [{ x: 3, y: 2, text: 'orphan' }] }, exportContext)).toBe(false);
  });
});

describe('older builds', () => {
  it('writes the texts into a pack without raising its version, and reads them back', () => {
    const level = { ...makeLevel('hints', { terrain: hintMap().terrain }), cellHints: hintMap().cellHints };
    const text = serializePack('P', [level]);
    expect(JSON.parse(text).version).toBe(PACK_JSON_VERSION);
    const parsed = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set(), () => 7000);
    expect(parsed.ok && parsed.levels[0].cellHints).toEqual(hintMap().cellHints);
  });
});

describe('Cell section panel', () => {
  it('shows a box for a hint tile only, filled with its text', () => {
    let committed: EditorMap | null = null;
    const doc = documentFromLevel({ ...makeLevel('p', { terrain: hintMap().terrain }), cellHints: hintMap().cellHints }, { title: 'T', hint: '' });
    const panel = new CellHintPanel({ commit: (map) => ((committed = map), true) }, () => doc);
    expect(panel.render(doc, 3, 2)).toBeNull();
    const root = panel.render(doc, 2, 1);
    const area = root?.querySelector('textarea');
    expect(area?.value).toBe('first');
    if (!area) return;
    area.value = 'edited';
    area.dispatchEvent(new Event('change'));
    expect(committed && cellHintAt(committed, 2, 1)).toBe('edited');
  });

  it('commits nothing when the text did not change', () => {
    let calls = 0;
    const doc = documentFromLevel({ ...makeLevel('p', { terrain: hintMap().terrain }), cellHints: hintMap().cellHints }, { title: 'T', hint: '' });
    const panel = new CellHintPanel({ commit: () => (calls++, true) }, () => doc);
    const area = panel.render(doc, 2, 1)?.querySelector('textarea');
    area?.dispatchEvent(new Event('change'));
    expect(calls).toBe(0);
  });
});
