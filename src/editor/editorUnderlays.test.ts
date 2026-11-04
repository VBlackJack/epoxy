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
import { DEFAULT_WIN_RULE } from '../core/coreConstants';
import type { CellUnderlay, CompiledLevel } from '../core/types';
import { i18n, t } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { describeEditorCell } from './cellDescription';
import { cloneDocument, cloneMap, type EditorDocument, type EditorMap, sameDocument, withEditedMap } from './editorDocument';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { applyTool } from './editorTools';
import {
  canonicalUnderlays,
  cloneUnderlays,
  differingUnderlayCells,
  hasUnderlays,
  pruneUnderlays,
  removeUnderlaysWhere,
  replaceUnderlays,
  setUnderlayAt,
  translateUnderlays,
  underlayAt
} from './editorUnderlays';
import { historyDiff } from './historyDiff';
import { eraseCell, floodFillTerrain, paintEntity, paintItem, paintPlayerStart, paintTerrain, addTrapLink, resizeMap } from './mapEdits';
import { describeResize } from './resizeReport';
import { levelMapChanged } from './saveTarget';
import { clearRect, extractClip, fillRect, moveRect, pasteClip } from './selectionEdits';

const WIDTH = 8;
const HEIGHT = 6;
const DOOR_X = 3;
const DOOR_Y = 2;
const BOUNDS = { minSize: 5, maxSize: 12 };

beforeEach(() => {
  // The terrain lookup registered by the config registry is what makes pruning real.
  loadTestConfigs();
  i18n.setLocale('en');
});

function bordered(): EditorMap {
  const terrain = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => (x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 'wall' : 'floor'))
  );
  return {
    terrain,
    items: terrain.map((row) => row.map(() => null as string | null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 1, y: 1, dir: 'S' }
  };
}

/** A room with a red door at (3, 2) hiding ice. */
function doorMap(underlays: CellUnderlay[] | null = [{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]): EditorMap {
  const map = bordered();
  map.terrain[DOOR_Y][DOOR_X] = 'door_red';
  if (underlays) map.underlays = underlays;
  return map;
}

function toDocument(map: EditorMap): EditorDocument {
  return {
    ...map,
    title: 'Room',
    hint: '',
    author: '',
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    winRule: DEFAULT_WIN_RULE,
    ruleset: undefined
  };
}

function toLevel(map: EditorMap, extra: Partial<CompiledLevel> = {}): CompiledLevel {
  return { id: 'lvl_under', number: 1, password: 'TEST', timeLimitSeconds: 0, chipsRequired: 0, ...cloneMap(map), ...extra };
}

describe('the underlay helpers', () => {
  it('canonicalise: sorted, one per cell, invalid ones dropped, undefined when none is left', () => {
    const map = bordered();
    map.terrain[2][4] = 'door_blue';
    map.terrain[2][3] = 'door_red';
    expect(
      canonicalUnderlays(
        [
          { x: 4, y: 2, terrain: 'ice' },
          { x: 3, y: 2, terrain: 'water' },
          { x: 3, y: 2, terrain: 'ice' },
          { x: 2, y: 2, terrain: 'ice' }
        ],
        map.terrain
      )
    ).toEqual([
      { x: 3, y: 2, terrain: 'water' },
      { x: 4, y: 2, terrain: 'ice' }
    ]);
    expect(canonicalUnderlays([{ x: 2, y: 2, terrain: 'ice' }], map.terrain)).toBeUndefined();
    expect(canonicalUnderlays(undefined, map.terrain)).toBeUndefined();
    expect(canonicalUnderlays([], map.terrain)).toBeUndefined();
  });

  it('clone to an independent list, and read as absent when empty', () => {
    const original: CellUnderlay[] = [{ x: 3, y: 2, terrain: 'ice' }];
    const copy = cloneUnderlays(original);
    expect(copy).toEqual(original);
    copy![0].terrain = 'water';
    expect(original[0].terrain).toBe('ice');
    expect(cloneUnderlays([])).toBeUndefined();
    expect(cloneUnderlays(undefined)).toBeUndefined();
  });

  it('are found by cell and counted', () => {
    const map = doorMap();
    expect(hasUnderlays(map)).toBe(true);
    expect(hasUnderlays({})).toBe(false);
    expect(underlayAt(map, DOOR_X, DOOR_Y)).toBe('ice');
    expect(underlayAt(map, 1, 1)).toBeUndefined();
  });

  it('set, replace and clear a cell, deleting the field when none is left', () => {
    const map = doorMap(null);
    setUnderlayAt(map, DOOR_X, DOOR_Y, 'water');
    expect(map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'water' }]);
    setUnderlayAt(map, DOOR_X, DOOR_Y, 'ice');
    expect(map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
    setUnderlayAt(map, 1, 1, 'ice'); // not under a removable top: refused by the canonical form
    expect(map.underlays).toHaveLength(1);
    setUnderlayAt(map, DOOR_X, DOOR_Y, null);
    expect('underlays' in map).toBe(false);
  });

  it('are removed by predicate, with the count', () => {
    const map = doorMap();
    map.terrain[4][4] = 'door_blue';
    setUnderlayAt(map, 4, 4, 'ice');
    expect(removeUnderlaysWhere(map, (x) => x === 4)).toBe(1);
    expect(map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
    expect(removeUnderlaysWhere(map, () => false)).toBe(0);
    expect(removeUnderlaysWhere(map, () => true)).toBe(1);
    expect('underlays' in map).toBe(false);
  });

  it('translate and drop the ones leaving the grid', () => {
    expect(
      translateUnderlays(
        [
          { x: 1, y: 1, terrain: 'ice' },
          { x: 5, y: 1, terrain: 'water' }
        ],
        1,
        2,
        6,
        4
      )
    ).toEqual([{ x: 2, y: 3, terrain: 'ice' }]);
  });

  it('replace in any order and store canonical', () => {
    const map = doorMap(null);
    map.terrain[4][4] = 'door_blue';
    replaceUnderlays(map, [
      { x: 4, y: 4, terrain: 'ice' },
      { x: DOOR_X, y: DOOR_Y, terrain: 'ice' }
    ]);
    expect(map.underlays).toEqual([
      { x: DOOR_X, y: DOOR_Y, terrain: 'ice' },
      { x: 4, y: 4, terrain: 'ice' }
    ]);
    replaceUnderlays(map, []);
    expect('underlays' in map).toBe(false);
  });

  it('prune what the top no longer hides, and count it', () => {
    const map = doorMap();
    expect(pruneUnderlays(map)).toBe(0);
    map.terrain[DOOR_Y][DOOR_X] = 'floor';
    expect(pruneUnderlays(map)).toBe(1);
    expect('underlays' in map).toBe(false);
    expect(pruneUnderlays(map)).toBe(0);
  });

  it('name the cells whose hidden terrain differs', () => {
    const a: CellUnderlay[] = [
      { x: 1, y: 1, terrain: 'ice' },
      { x: 2, y: 2, terrain: 'ice' }
    ];
    const b: CellUnderlay[] = [
      { x: 2, y: 2, terrain: 'water' },
      { x: 3, y: 3, terrain: 'ice' }
    ];
    const cells = differingUnderlayCells(a, b).map((c) => `${c.x},${c.y}`).sort();
    expect(cells).toEqual(['1,1', '2,2', '3,3']);
    expect(differingUnderlayCells(a, [...a].reverse())).toEqual([]);
    expect(differingUnderlayCells(undefined, undefined)).toEqual([]);
  });
});

describe('the document and the level', () => {
  it('round trip: a level with hidden terrain opens and exports it, without sharing the list', () => {
    const level = toLevel(doorMap());
    const doc = documentFromLevel(level, { title: 'Room', hint: '' });
    expect(doc.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
    expect(doc.underlays).not.toBe(level.underlays);
    const exported = levelFromDocument(doc, { id: 'x', number: 1, password: 'TEST', fallbackTitle: 'T' });
    expect(exported.underlays).toEqual(level.underlays);
    expect(exported.underlays).not.toBe(doc.underlays);
  });

  it('opens a level in canonical form: an underlay the top cannot hide is dropped', () => {
    const level = toLevel(doorMap([{ x: 1, y: 1, terrain: 'ice' }]));
    expect(documentFromLevel(level, { title: '', hint: '' }).underlays).toBeUndefined();
  });

  it('is absent from the level when there is none', () => {
    const doc = documentFromLevel(toLevel(doorMap(null)), { title: '', hint: '' });
    expect('underlays' in doc).toBe(false);
    expect('underlays' in levelFromDocument(doc, { id: 'x', number: 1, password: 'TEST', fallbackTitle: 'T' })).toBe(false);
  });

  it('is stripped from the export of a Lynx document', () => {
    const doc = { ...documentFromLevel(toLevel(doorMap()), { title: '', hint: '' }), ruleset: 'lynx' as const };
    const exported = levelFromDocument(doc, { id: 'x', number: 1, password: 'TEST', fallbackTitle: 'T' });
    expect('underlays' in exported).toBe(false);
  });

  it('copies independently with cloneMap and cloneDocument', () => {
    const doc = toDocument(doorMap());
    const mapCopy = cloneMap(doc);
    const docCopy = cloneDocument(doc);
    mapCopy.underlays![0].terrain = 'water';
    docCopy.underlays![0].terrain = 'water';
    expect(doc.underlays![0].terrain).toBe('ice');
  });

  it('compares with sameDocument: the hidden terrain counts, the order of a list does not', () => {
    const a = toDocument(doorMap());
    expect(sameDocument(a, cloneDocument(a))).toBe(true);
    const other = cloneDocument(a);
    other.underlays![0].terrain = 'water';
    expect(sameDocument(a, other)).toBe(false);
    expect(sameDocument(a, toDocument(doorMap(null)))).toBe(false);
    // An underlay under a top that cannot hide it reads as none, as in the canonical form.
    const stale = cloneDocument(toDocument(doorMap(null)));
    stale.underlays = [{ x: 1, y: 1, terrain: 'ice' }];
    expect(sameDocument(stale, toDocument(doorMap(null)))).toBe(true);
  });

  it('is dropped from the document by an edit that removed the last one (withEditedMap)', () => {
    const doc = toDocument(doorMap());
    const edited = paintTerrain(doc, DOOR_X, DOOR_Y, 'floor');
    expect('underlays' in edited.map).toBe(false);
    expect('underlays' in withEditedMap(doc, edited.map)).toBe(false);
  });

  it('counts as a change of the map for the save (levelMapChanged)', () => {
    const base = toLevel(doorMap(null));
    expect(levelMapChanged(base, toLevel(doorMap()))).toBe(true);
    expect(levelMapChanged(toLevel(doorMap()), toLevel(doorMap()))).toBe(false);
    expect(levelMapChanged(base, { ...base, underlays: [] })).toBe(false);
  });

  it('shows in the history diff at its cell, both ways', () => {
    const before = toDocument(doorMap());
    const after = toDocument(doorMap([{ x: DOOR_X, y: DOOR_Y, terrain: 'water' }]));
    expect(historyDiff(before, after).cells).toEqual([{ x: DOOR_X, y: DOOR_Y }]);
    expect(historyDiff(after, before).cells).toEqual([{ x: DOOR_X, y: DOOR_Y }]);
    expect(historyDiff(before, toDocument(doorMap(null))).cells).toEqual([{ x: DOOR_X, y: DOOR_Y }]);
    expect(historyDiff(before, cloneDocument(before)).cells).toEqual([]);
  });
});

describe('painting over hidden terrain', () => {
  it('keeps it while the new top can still hide it, and says nothing', () => {
    const result = paintTerrain(doorMap(), DOOR_X, DOOR_Y, 'door_blue');
    expect(result.changed).toBe(true);
    expect(result.map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
    expect(result.removedUnderlays).toBe(0);
  });

  it('drops it, with a count, when the top becomes floor or wall', () => {
    for (const top of ['floor', 'wall']) {
      const result = paintTerrain(doorMap(), DOOR_X, DOOR_Y, top);
      expect('underlays' in result.map).toBe(false);
      expect(result.removedUnderlays).toBe(1);
    }
  });

  it('drops water under dirt: a block sunk in water makes dirt again', () => {
    const source = doorMap([{ x: DOOR_X, y: DOOR_Y, terrain: 'water' }]);
    expect(source.underlays).toHaveLength(1);
    const result = paintTerrain(source, DOOR_X, DOOR_Y, 'dirt');
    expect(result.removedUnderlays).toBe(1);
    expect('underlays' in result.map).toBe(false);
  });

  it('leaves the source untouched', () => {
    const source = doorMap();
    paintTerrain(source, DOOR_X, DOOR_Y, 'floor');
    expect(source.underlays).toHaveLength(1);
  });

  it('keeps it for an item, a creature and the player start on the cell', () => {
    expect(paintItem(doorMap(), DOOR_X, DOOR_Y, 'chip').map.underlays).toHaveLength(1);
    expect(paintEntity(doorMap(), DOOR_X, DOOR_Y, 'dirt_block', 'S').map.underlays).toHaveLength(1);
    expect(paintPlayerStart(doorMap(), DOOR_X, DOOR_Y, 'S').map.underlays).toHaveLength(1);
  });

  it('is announced by the brush tool, with the plural form', () => {
    const outcome = applyTool({
      map: doorMap(),
      tool: 'brush',
      brush: { kind: 'terrain', id: 'floor' },
      dir: 'S',
      x: DOOR_X,
      y: DOOR_Y
    });
    expect(outcome.messages).toEqual([{ key: 'editor.layout.status.underlays_removed', params: { count: 1 } }]);
    expect(t('editor.layout.status.underlays_removed', { count: 1 })).toContain('1 hidden terrain was removed');
  });

  it('is dropped by a brown button painted over the cell, and a link session never places a partner on it', () => {
    const button = paintTerrain(doorMap(), DOOR_X, DOOR_Y, 'button_brown');
    expect(button.removedUnderlays).toBe(1);
    expect('underlays' in button.map).toBe(false);

    // Linking to an existing trap neither paints nor prunes: the hidden terrain of a free-floor target is refused upstream.
    const source = paintTerrain(doorMap(null), 5, 4, 'button_brown').map;
    const trap = paintTerrain({ ...source, underlays: doorMap().underlays }, 6, 4, 'trap');
    const linked = addTrapLink(trap.map, { x: 5, y: 4 }, { x: 6, y: 4 });
    expect(linked.refused).toBe(false);
    expect(linked.map.underlays).toEqual(doorMap().underlays);
  });

  it('is pruned by a flood fill across the region, keeping the cells whose top still hides', () => {
    const source = doorMap();
    source.terrain[DOOR_Y][DOOR_X + 1] = 'door_red';
    source.underlays = [
      { x: DOOR_X, y: DOOR_Y, terrain: 'ice' },
      { x: DOOR_X + 1, y: DOOR_Y, terrain: 'water' }
    ];
    const toBlue = floodFillTerrain(source, DOOR_X, DOOR_Y, 'door_blue');
    expect(toBlue.removedUnderlays).toBe(0);
    expect(toBlue.map.underlays).toHaveLength(2);
    const toFloor = floodFillTerrain(source, DOOR_X, DOOR_Y, 'floor');
    expect(toFloor.removedUnderlays).toBe(2);
    expect('underlays' in toFloor.map).toBe(false);
    // Filling the floor region leaves the doors, and so their hidden terrain, alone.
    const floorFill = floodFillTerrain(source, 1, 1, 'ice');
    expect(floorFill.removedUnderlays).toBe(0);
    expect(floorFill.map.underlays).toHaveLength(2);
  });

  it('is removed by the eraser, with the cell, and an underlay alone makes the cell erasable', () => {
    const result = eraseCell(doorMap(), DOOR_X, DOOR_Y);
    expect(result.changed).toBe(true);
    expect(result.removedUnderlays).toBe(1);
    expect(result.map.terrain[DOOR_Y][DOOR_X]).toBe('floor');
    expect('underlays' in result.map).toBe(false);
    // Another cell's hidden terrain stays.
    expect(eraseCell(doorMap(), 1, 1).map.underlays).toHaveLength(1);
    expect(eraseCell(doorMap(), 1, 1).changed).toBe(false);
  });
});

describe('resizing with hidden terrain', () => {
  it('keeps what stays inside and reports nothing', () => {
    const result = resizeMap(doorMap(), 10, 8, BOUNDS);
    expect(result.map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
    expect(result.report.droppedUnderlays).toBe(0);
    expect(describeResize(result).map((note) => note.key)).not.toContain('editor.layout.size.dropped_underlays');
  });

  it('drops and counts what a crop cuts away', () => {
    const source = doorMap(null);
    source.terrain[2][6] = 'door_red';
    source.underlays = [{ x: 6, y: 2, terrain: 'ice' }];
    const result = resizeMap(source, 6, HEIGHT, BOUNDS);
    expect('underlays' in result.map).toBe(false);
    expect(result.report.droppedUnderlays).toBe(1);
    const note = describeResize(result).find((entry) => entry.key === 'editor.layout.size.dropped_underlays');
    expect(note?.params).toEqual({ count: 1 });
    expect(t('editor.layout.size.dropped_underlays', { count: 1 })).toBe('1 cell lost its hidden terrain.');
  });

  it('drops and counts a cell the new border turns to wall', () => {
    // Shrinking so that the cell lands on the new outer ring turns it to wall.
    const ring = doorMap(null);
    ring.terrain[2][5] = 'door_red';
    ring.underlays = [{ x: 5, y: 2, terrain: 'ice' }];
    const closed = resizeMap(ring, 6, HEIGHT, BOUNDS);
    expect(closed.map.terrain[2][5]).toBe('wall');
    expect(closed.report.droppedUnderlays).toBe(1);
    expect('underlays' in closed.map).toBe(false);
  });

  it('keeps hidden terrain through a growth', () => {
    const grown = resizeMap(doorMap(), WIDTH + 2, HEIGHT + 2, BOUNDS);
    expect(grown.map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
  });
});

describe('selection edits with hidden terrain', () => {
  const rect = { x: DOOR_X, y: DOOR_Y, width: 1, height: 1 };

  it('extracts the underlays of the rectangle, relative to it', () => {
    const clip = extractClip(doorMap(), { x: 2, y: 1, width: 3, height: 2 }, false);
    expect(clip.underlays).toEqual([{ dx: 1, dy: 1, terrain: 'ice' }]);
    expect(extractClip(doorMap(), { x: 1, y: 1, width: 1, height: 1 }, false).underlays).toBeUndefined();
  });

  it('clears the underlays inside the rectangle only', () => {
    const source = doorMap();
    source.terrain[4][4] = 'door_blue';
    source.underlays = [...(source.underlays ?? []), { x: 4, y: 4, terrain: 'ice' }];
    const result = clearRect(source, rect);
    expect(result.changed).toBe(true);
    expect(result.map.underlays).toEqual([{ x: 4, y: 4, terrain: 'ice' }]);
  });

  it('moves the hidden terrain with its cell', () => {
    const result = moveRect(doorMap(), rect, 1, 1);
    expect(result.map.terrain[DOOR_Y + 1][DOOR_X + 1]).toBe('door_red');
    expect(result.map.underlays).toEqual([{ x: DOOR_X + 1, y: DOOR_Y + 1, terrain: 'ice' }]);
  });

  it('pastes the hidden terrain of the clip, and writes none where the clip has none', () => {
    const clip = extractClip(doorMap(), rect, false);
    const pasted = pasteClip(bordered(), clip, 5, 3, 'epoxy');
    expect(pasted.map.terrain[3][5]).toBe('door_red');
    expect(pasted.map.underlays).toEqual([{ x: 5, y: 3, terrain: 'ice' }]);
    // The target cell held hidden terrain: a clip without any replaces the cell, hidden terrain included.
    const plain = extractClip(bordered(), rect, false);
    const over = pasteClip(doorMap(), plain, DOOR_X, DOOR_Y, 'epoxy');
    expect(over.map.terrain[DOOR_Y][DOOR_X]).toBe('floor');
    expect('underlays' in over.map).toBe(false);
  });

  it('pastes the hidden terrain alone when the top is the same', () => {
    const clip = extractClip(doorMap(), rect, false);
    const result = pasteClip(doorMap(null), clip, DOOR_X, DOOR_Y, 'epoxy');
    expect(result.changed).toBe(true);
    expect(result.map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
    // Pasting the same thing again changes nothing.
    expect(pasteClip(doorMap(), clip, DOOR_X, DOOR_Y, 'epoxy').changed).toBe(false);
  });

  it('counts, instead of dropping silently, a non-canonical hidden terrain the defensive pass removes', () => {
    const clip = extractClip(bordered(), rect, false);
    // A hidden terrain under a plain floor cell outside the pasted area: a top that cannot hide it.
    const stale = bordered();
    stale.underlays = [{ x: 1, y: 1, terrain: 'ice' }];
    const result = pasteClip(stale, clip, 5, 3, 'epoxy');
    expect('underlays' in result.map).toBe(false);
    expect(result.droppedUnderlays).toBe(1);
  });

  it('drops it under Lynx and counts it as skipped', () => {
    const clip = extractClip(doorMap(), rect, false);
    const result = pasteClip(bordered(), clip, 5, 3, 'lynx');
    expect(result.map.terrain[3][5]).toBe('door_red');
    expect('underlays' in result.map).toBe(false);
    expect(result.skipped).toBe(1);
  });

  it('leaves the cells of the outer ring alone, and counts them apart', () => {
    const clip = extractClip(doorMap(), rect, false);
    const result = pasteClip(bordered(), clip, 0, 2, 'epoxy');
    expect(result.borderSkipped).toBe(1);
    expect('underlays' in result.map).toBe(false);
    expect(result.map.terrain[2][0]).toBe('wall');
  });

  it('keeps the hidden terrain of a cell whose pasted top is refused by the ruleset', () => {
    const clip = extractClip(bordered(), rect, false);
    clip.terrain[0][0] = 'pressure_plate_red';
    const result = pasteClip(doorMap(), clip, DOOR_X, DOOR_Y, 'lynx');
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.map.terrain[DOOR_Y][DOOR_X]).toBe('door_red');
    expect(result.map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
  });

  it('is pruned by a terrain fill, announced in the result, and kept by the others', () => {
    const area = { x: 1, y: 1, width: 6, height: 4 };
    const toFloor = fillRect(doorMap(), area, { kind: 'terrain', id: 'floor' }, 'S', 'epoxy');
    expect(toFloor.droppedUnderlays).toBe(1);
    expect('underlays' in toFloor.map).toBe(false);
    const toBlue = fillRect(doorMap(), area, { kind: 'terrain', id: 'door_blue' }, 'S', 'epoxy');
    expect(toBlue.droppedUnderlays).toBe(0);
    expect(toBlue.map.underlays).toEqual([{ x: DOOR_X, y: DOOR_Y, terrain: 'ice' }]);
    const item = fillRect(doorMap(), area, { kind: 'item', id: 'chip' }, 'S', 'epoxy');
    expect(item.map.underlays).toHaveLength(1);
    const entity = fillRect(doorMap(), area, { kind: 'entity', id: 'dirt_block' }, 'S', 'epoxy');
    expect(entity.map.underlays).toHaveLength(1);
  });
});

describe('the spoken cell', () => {
  it('names the hidden terrain after the terrain', () => {
    const parts = describeEditorCell({ map: doorMap(), x: DOOR_X, y: DOOR_Y });
    const keys = parts.map((part) => part.key);
    expect(keys.indexOf('editor.cell_speech.underlay.label')).toBe(2);
    expect(t('editor.cell_speech.underlay.label', { name: 'Ice' })).toBe('hides Ice');
    const plain = describeEditorCell({ map: doorMap(null), x: DOOR_X, y: DOOR_Y });
    expect(plain.map((part) => part.key)).not.toContain('editor.cell_speech.underlay.label');
  });
});
