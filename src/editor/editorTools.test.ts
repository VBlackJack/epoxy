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
import { EditorMap } from './editorDocument';
import {
  applyTool,
  Brush,
  continuesOnDrag,
  leavesLooseButton,
  MESSAGE_FILL_NEEDS_TERRAIN,
  MESSAGE_LINKS_REMOVED,
  MESSAGE_START_KEPT,
  MESSAGE_WIRE_LINKED,
  MESSAGE_WIRE_MISSING_BUTTON,
  MESSAGE_WIRE_SAME_CELL,
  MESSAGE_WIRE_SELECT_TARGET,
  pickFromCell,
  PendingWire,
  ToolInput
} from './editorTools';

function blank(width: number, height: number): EditorMap {
  const terrain = Array.from({ length: height }, () => Array.from({ length: width }, () => 'floor'));
  const items = Array.from({ length: height }, () => Array.from({ length: width }, () => null as string | null));
  return { terrain, items, entities: [], trapLinks: [], cloneLinks: [], playerStart: { x: 0, y: 0, dir: 'S' } };
}

function input(overrides: Partial<ToolInput> & { map: EditorMap }): ToolInput {
  return {
    tool: 'brush',
    brush: { kind: 'terrain', id: 'wall' },
    dir: 'S',
    x: 2,
    y: 2,
    pendingWire: null,
    ...overrides
  };
}

const TRAP: Brush = { kind: 'wire_trap', id: 'wire_trap' };

describe('applyTool', () => {
  it('paints terrain, items and entities with the brush', () => {
    const map = blank(5, 5);
    expect(applyTool(input({ map })).map.terrain[2][2]).toBe('wall');
    expect(applyTool(input({ map, brush: { kind: 'item', id: 'chip' } })).map.items[2][2]).toBe('chip');
    const entity = applyTool(input({ map, brush: { kind: 'entity', id: 'bug' }, dir: 'E' }));
    expect(entity.map.entities).toEqual([{ x: 2, y: 2, type: 'bug', dir: 'E' }]);
    const start = applyTool(input({ map, brush: { kind: 'player_start', id: 'player_start' }, dir: 'W' }));
    expect(start.map.playerStart).toEqual({ x: 2, y: 2, dir: 'W' });
  });

  it('reports a no-op as unchanged', () => {
    const map = blank(5, 5);
    const outcome = applyTool(input({ map, brush: { kind: 'terrain', id: 'floor' } }));
    expect(outcome.changed).toBe(false);
  });

  it('flood fills only with a terrain brush', () => {
    const map = blank(4, 4);
    const filled = applyTool(input({ map, tool: 'fill', x: 0, y: 0 }));
    expect(filled.changed).toBe(true);
    expect(filled.map.terrain.flat().every((tile) => tile === 'wall')).toBe(true);
    const refused = applyTool(input({ map, tool: 'fill', brush: { kind: 'item', id: 'chip' } }));
    expect(refused.changed).toBe(false);
    expect(refused.messages).toEqual([{ key: MESSAGE_FILL_NEEDS_TERRAIN }]);
  });

  it('erases with the eraser tool and with the secondary button', () => {
    const map = blank(5, 5);
    map.terrain[2][2] = 'wall';
    expect(applyTool(input({ map, tool: 'eraser' })).map.terrain[2][2]).toBe('floor');
    expect(applyTool(input({ map, forceErase: true })).map.terrain[2][2]).toBe('floor');
  });

  it('says when the eraser leaves the player start in place', () => {
    const map = blank(5, 5);
    map.playerStart = { x: 2, y: 2, dir: 'S' };
    const outcome = applyTool(input({ map, tool: 'eraser' }));
    expect(outcome.messages).toContainEqual({ key: MESSAGE_START_KEPT });
  });

  it('announces the links an overwrite removed', () => {
    const map = blank(6, 6);
    map.terrain[1][1] = 'button_brown';
    map.terrain[3][3] = 'trap';
    map.trapLinks = [{ buttonX: 1, buttonY: 1, trapX: 3, trapY: 3 }];
    const outcome = applyTool(input({ map, x: 3, y: 3, tool: 'eraser' }));
    expect(outcome.map.trapLinks).toEqual([]);
    expect(outcome.messages).toContainEqual({ key: MESSAGE_LINKS_REMOVED, params: { count: 1 } });
  });

  it('does nothing for the picker tool', () => {
    const map = blank(5, 5);
    const outcome = applyTool(input({ map, tool: 'picker' }));
    expect(outcome.changed).toBe(false);
    expect(outcome.map).toBe(map);
  });
});

describe('wires', () => {
  it('places the button first and waits for the target', () => {
    const map = blank(6, 6);
    const first = applyTool(input({ map, brush: TRAP, x: 1, y: 1 }));
    expect(first.map.terrain[1][1]).toBe('button_brown');
    expect(first.pendingWire).toEqual({ kind: 'trap', x: 1, y: 1 });
    expect(first.messages).toContainEqual({ key: MESSAGE_WIRE_SELECT_TARGET });
  });

  it('links the pending button to the target', () => {
    const map = blank(6, 6);
    const first = applyTool(input({ map, brush: TRAP, x: 1, y: 1 }));
    const second = applyTool(input({ map: first.map, brush: TRAP, x: 4, y: 4, pendingWire: first.pendingWire }));
    expect(second.pendingWire).toBeNull();
    expect(second.map.terrain[4][4]).toBe('trap');
    expect(second.map.trapLinks).toEqual([{ buttonX: 1, buttonY: 1, trapX: 4, trapY: 4 }]);
    expect(second.messages).toContainEqual({ key: MESSAGE_WIRE_LINKED });
  });

  it('refuses a target on the button itself and keeps the wire pending', () => {
    const map = blank(6, 6);
    const first = applyTool(input({ map, brush: TRAP, x: 1, y: 1 }));
    const second = applyTool(input({ map: first.map, brush: TRAP, x: 1, y: 1, pendingWire: first.pendingWire }));
    expect(second.changed).toBe(false);
    expect(second.pendingWire).toEqual(first.pendingWire);
    expect(second.messages).toEqual([{ key: MESSAGE_WIRE_SAME_CELL }]);
  });

  it('refuses a link whose button is gone', () => {
    const map = blank(6, 6);
    const pending: PendingWire = { kind: 'trap', x: 1, y: 1 };
    const outcome = applyTool(input({ map, brush: TRAP, x: 3, y: 3, pendingWire: pending }));
    expect(outcome.changed).toBe(false);
    expect(outcome.messages).toEqual([{ key: MESSAGE_WIRE_MISSING_BUTTON }]);
  });

  it('detects a button left without a link', () => {
    const map = blank(6, 6);
    const first = applyTool(input({ map, brush: TRAP, x: 1, y: 1 }));
    expect(leavesLooseButton(first.map, first.pendingWire as PendingWire, 'button_brown')).toBe(true);
    expect(leavesLooseButton(map, { kind: 'trap', x: 1, y: 1 }, 'button_brown')).toBe(false);
  });
});

describe('continuesOnDrag', () => {
  it('keeps painting for plain brushes and the eraser only', () => {
    const terrain: Brush = { kind: 'terrain', id: 'wall' };
    expect(continuesOnDrag('brush', terrain, false)).toBe(true);
    expect(continuesOnDrag('eraser', terrain, false)).toBe(true);
    expect(continuesOnDrag('brush', terrain, true)).toBe(true);
    expect(continuesOnDrag('fill', terrain, false)).toBe(false);
    expect(continuesOnDrag('brush', TRAP, false)).toBe(false);
    expect(continuesOnDrag('picker', terrain, false)).toBe(false);
  });
});

describe('pickFromCell', () => {
  it('prefers the entity, then the item, then the terrain', () => {
    const map = blank(4, 4);
    map.terrain[1][1] = 'wall';
    map.items[1][1] = 'chip';
    expect(pickFromCell(map, 1, 1, 'floor').brush).toEqual({ kind: 'item', id: 'chip' });
    map.entities = [{ x: 1, y: 1, type: 'bug', dir: 'W' }];
    expect(pickFromCell(map, 1, 1, 'floor')).toEqual({ brush: { kind: 'entity', id: 'bug' }, dir: 'W' });
    expect(pickFromCell(map, 2, 2, 'floor').brush).toEqual({ kind: 'terrain', id: 'floor' });
  });
});
