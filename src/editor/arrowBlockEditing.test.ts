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
import { Direction } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EditorDocument, EditorMap, withEditedMap } from './editorDocument';
import { documentFromLevel, levelFromDocument } from './editorLevelIo';
import { rotateClockwise } from './editorKeyboard';
import { entityHasFacing } from './entityFacing';
import { paintEntity } from './mapEdits';
import { extractClip, fillRect, moveRect, pasteClip } from './selectionEdits';

const ARROW_BLOCK_IDS = ['arrow_block_one', 'arrow_block_line', 'arrow_block_corner', 'arrow_block_tee'] as const;
const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];
const SIZE = 9;
const CELL = { x: 3, y: 3 };

beforeEach(() => {
  loadTestConfigs();
});

function room(): EditorMap {
  const terrain = Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? 'wall' : 'floor'))
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

describe('arrow blocks in the editor', () => {
  it('turns with the direction control for each of the four types, and a plain block does not', () => {
    for (const id of ARROW_BLOCK_IDS) expect(entityHasFacing(id), id).toBe(true);
    expect(entityHasFacing('dirt_block')).toBe(false);
  });

  it('cycles through all four directions when the block is turned in place', () => {
    for (const id of ARROW_BLOCK_IDS) {
      let map = paintEntity(room(), CELL.x, CELL.y, id, 'N').map;
      const seen: Direction[] = [];
      for (let turn = 0; turn < DIRECTIONS.length; turn++) {
        const entity = map.entities.find((e) => e.x === CELL.x && e.y === CELL.y);
        expect(entity?.type, id).toBe(id);
        seen.push(entity!.dir);
        const result = paintEntity(map, CELL.x, CELL.y, id, rotateClockwise(entity!.dir));
        expect(result.changed, id).toBe(true);
        map = result.map;
      }
      expect(seen, id).toEqual(DIRECTIONS);
      expect(map.entities.find((e) => e.x === CELL.x && e.y === CELL.y)?.dir, id).toBe('N');
    }
  });

  it('keeps the direction through a save and a load, including a JSON round trip', () => {
    const map = room();
    ARROW_BLOCK_IDS.forEach((id, index) => map.entities.push({ x: 1 + index, y: 4, type: id, dir: DIRECTIONS[index] }));
    const level = levelFromDocument(toDocument(map), { id: 'lvl', number: 1, password: 'TEST', fallbackTitle: 'T' });
    const reloaded = documentFromLevel(JSON.parse(JSON.stringify(level)), { title: 'Room', hint: '' });
    expect(reloaded.entities).toEqual(map.entities);
  });

  it('keeps the direction when a region is copied and pasted', () => {
    const map = room();
    ARROW_BLOCK_IDS.forEach((id, index) => map.entities.push({ x: 1 + index, y: 2, type: id, dir: DIRECTIONS[index] }));
    const clip = extractClip(map, { x: 1, y: 2, width: ARROW_BLOCK_IDS.length, height: 1 }, false);
    const pasted = pasteClip(room(), clip, 1, 6, 'epoxy');
    ARROW_BLOCK_IDS.forEach((id, index) => {
      expect(pasted.map.entities, id).toContainEqual({ x: 1 + index, y: 6, type: id, dir: DIRECTIONS[index] });
    });
  });

  it('keeps the direction when a region is moved', () => {
    const map = room();
    map.entities.push({ x: 2, y: 2, type: 'arrow_block_tee', dir: 'W' });
    const moved = moveRect(map, { x: 2, y: 2, width: 1, height: 1 }, 2, 3);
    expect(moved.map.entities).toContainEqual({ x: 4, y: 5, type: 'arrow_block_tee', dir: 'W' });
  });

  it('stamps the direction of the control onto every cell of a fill', () => {
    const result = fillRect(room(), { x: 2, y: 2, width: 2, height: 2 }, { kind: 'entity', id: 'arrow_block_corner' }, 'E', 'epoxy');
    const placed = result.map.entities.filter((e) => e.type === 'arrow_block_corner');
    expect(placed).toHaveLength(4);
    expect(placed.every((e) => e.dir === 'E')).toBe(true);
  });

  it('does not place an arrow block into a Lynx map by a fill or a paste', () => {
    const refused = fillRect(room(), { x: 2, y: 2, width: 1, height: 1 }, { kind: 'entity', id: 'arrow_block_one' }, 'N', 'lynx');
    expect(refused.changed).toBe(false);
    const map = room();
    map.entities.push({ x: 2, y: 2, type: 'arrow_block_one', dir: 'N' });
    const clip = extractClip(map, { x: 2, y: 2, width: 1, height: 1 }, false);
    expect(pasteClip(room(), clip, 4, 4, 'lynx').map.entities).toEqual([]);
  });

  it('keeps withEditedMap documents equal to their painted map', () => {
    const doc = withEditedMap(toDocument(room()), paintEntity(room(), 2, 2, 'arrow_block_line', 'S').map);
    expect(doc.entities).toEqual([{ x: 2, y: 2, type: 'arrow_block_line', dir: 'S' }]);
  });
});
