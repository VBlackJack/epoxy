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
import { levelHasCanopy } from '../core/EdgeRules';
import type { CompiledLevel } from '../core/types';
import { PACK_JSON_VERSION_V13 } from '../config/constants';
import { serializePack } from '../packs/packJson';
import { i18n } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { hasCanopyAt, toggleCanopyAt } from './editorCellEdges';
import { EditorMap } from './editorDocument';
import {
  applyTool,
  Brush,
  CANOPY_BRUSH_ID,
  CELL_EDGE_BRUSH_ID,
  continuesOnDrag,
  isCanopyBrush,
  MESSAGE_FILL_NEEDS_TERRAIN,
  ToolInput
} from './editorTools';
import { cellEdgeAvailability } from './paletteAvailability';

const SIZE = 5;
const CENTER = 2;

function blank(): EditorMap {
  const terrain = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 'floor'));
  const items = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null as string | null));
  return { terrain, items, entities: [], trapLinks: [], cloneLinks: [], playerStart: { x: 0, y: 0, dir: 'S' } };
}

function input(overrides: Partial<ToolInput> & { map: EditorMap }): ToolInput {
  return { tool: 'brush', brush: CANOPY, dir: 'S', x: CENTER, y: CENTER, ...overrides };
}

const CANOPY: Brush = { kind: 'cell_edge', id: CANOPY_BRUSH_ID };
const WALL: Brush = { kind: 'cell_edge', id: CELL_EDGE_BRUSH_ID };

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
});

describe('toggleCanopyAt', () => {
  it('flips the flag, keeping the thin walls of the cell', () => {
    const map = blank();
    map.cellEdges = [{ x: CENTER, y: CENTER, sides: ['N'] }];
    expect(toggleCanopyAt(map, CENTER, CENTER)).toBe(true);
    expect(map.cellEdges).toEqual([{ x: CENTER, y: CENTER, sides: ['N'], canopy: true }]);
    expect(hasCanopyAt(map, CENTER, CENTER)).toBe(true);
    expect(toggleCanopyAt(map, CENTER, CENTER)).toBe(true);
    expect(map.cellEdges).toEqual([{ x: CENTER, y: CENTER, sides: ['N'] }]);
  });

  it('drops the entry when neither walls nor canopy are left, and the field with it', () => {
    const map = blank();
    toggleCanopyAt(map, CENTER, CENTER);
    expect(map.cellEdges).toEqual([{ x: CENTER, y: CENTER, sides: [], canopy: true }]);
    toggleCanopyAt(map, CENTER, CENTER);
    expect(map.cellEdges).toBeUndefined();
  });

  it('does nothing outside the grid or when the cell is already as asked', () => {
    const map = blank();
    expect(toggleCanopyAt(map, SIZE, 0)).toBe(false);
    expect(toggleCanopyAt(map, 0, -1)).toBe(false);
    expect(toggleCanopyAt(map, CENTER, CENTER, 'clear')).toBe(false);
    expect(toggleCanopyAt(map, CENTER, CENTER, 'set')).toBe(true);
    expect(toggleCanopyAt(map, CENTER, CENTER, 'set')).toBe(false);
  });
});

describe('canopy brush', () => {
  it('toggles through the tool dispatch without touching the source map', () => {
    const map = blank();
    const on = applyTool(input({ map }));
    expect(on.changed).toBe(true);
    expect(on.map.cellEdges).toEqual([{ x: CENTER, y: CENTER, sides: [], canopy: true }]);
    expect(map.cellEdges).toBeUndefined();
    expect(applyTool(input({ map: on.map })).map.cellEdges).toBeUndefined();
  });

  it('keeps the canopy when the last thin wall of the cell is opened', () => {
    const walled = applyTool(input({ map: applyTool(input({ map: blank() })).map, brush: WALL, side: 'E' })).map;
    expect(walled.cellEdges).toEqual([{ x: CENTER, y: CENTER, sides: ['E'], canopy: true }]);
    const opened = applyTool(input({ map: walled, brush: WALL, side: 'E' })).map;
    expect(opened.cellEdges).toEqual([{ x: CENTER, y: CENTER, sides: [], canopy: true }]);
  });

  it('sets and clears on request, a no-op when the cell already is so', () => {
    const map = blank();
    expect(applyTool(input({ map, canopyMode: 'clear' })).changed).toBe(false);
    const on = applyTool(input({ map, canopyMode: 'set' }));
    expect(on.changed).toBe(true);
    expect(applyTool(input({ map: on.map, canopyMode: 'set' })).changed).toBe(false);
    expect(applyTool(input({ map: on.map, canopyMode: 'clear' })).map.cellEdges).toBeUndefined();
  });

  it('leaves a cell outside the grid alone', () => {
    expect(applyTool(input({ map: blank(), x: 9, y: 9 })).changed).toBe(false);
  });

  it('continues on drag, unlike the thin wall, and refuses to fill', () => {
    expect(continuesOnDrag('brush', CANOPY, false)).toBe(true);
    expect(continuesOnDrag('brush', WALL, false)).toBe(false);
    expect(isCanopyBrush(CANOPY)).toBe(true);
    expect(isCanopyBrush(WALL)).toBe(false);
    const outcome = applyTool(input({ map: blank(), tool: 'fill' }));
    expect(outcome.changed).toBe(false);
    expect(outcome.messages).toEqual([{ key: MESSAGE_FILL_NEEDS_TERRAIN }]);
  });

  it('is cleared by the eraser, alone on its cell or with thin walls', () => {
    const map = blank();
    map.cellEdges = [
      { x: CENTER, y: CENTER, sides: [], canopy: true },
      { x: 3, y: CENTER, sides: ['W'], canopy: true }
    ];
    const first = applyTool(input({ map, tool: 'eraser' }));
    expect(first.changed).toBe(true);
    expect(first.map.cellEdges).toEqual([{ x: 3, y: CENTER, sides: ['W'], canopy: true }]);
    expect(applyTool(input({ map: first.map, tool: 'eraser', x: 3 })).map.cellEdges).toBeUndefined();
    expect(applyTool(input({ map, forceErase: true })).map.cellEdges).toHaveLength(1);
    expect(applyTool(input({ map: blank(), tool: 'eraser' })).changed).toBe(false);
  });

  it('is available under Epoxy rules and refused under Lynx rules', () => {
    expect(cellEdgeAvailability('epoxy').available).toBe(true);
    expect(cellEdgeAvailability('lynx').available).toBe(false);
  });
});

describe('a level with a canopy', () => {
  it('is written as pack format 13 and read back with its canopy', () => {
    const map = applyTool(input({ map: blank() })).map;
    const level: CompiledLevel = {
      id: 'lvl_canopy',
      number: 1,
      password: 'TEST',
      timeLimitSeconds: 0,
      chipsRequired: 0,
      playerStart: map.playerStart,
      terrain: map.terrain,
      items: map.items,
      entities: [],
      trapLinks: [],
      cloneLinks: [],
      cellEdges: map.cellEdges
    };
    expect(levelHasCanopy(level)).toBe(true);
    const file = JSON.parse(serializePack('Canopy', [level])) as { version: number; levels: CompiledLevel[] };
    expect(file.version).toBe(PACK_JSON_VERSION_V13);
    expect(file.levels[0].cellEdges).toEqual([{ x: CENTER, y: CENTER, sides: [], canopy: true }]);
    // Taking the canopy off again lets the pack fall back to an older format.
    const bare = applyTool(input({ map, canopyMode: 'clear' })).map;
    const plain = { ...level, cellEdges: bare.cellEdges };
    expect(JSON.parse(serializePack('Canopy', [plain])).version).toBeLessThan(PACK_JSON_VERSION_V13);
  });
});
