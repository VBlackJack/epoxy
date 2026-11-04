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
import { i18n } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EditorMap } from './editorDocument';
import {
  applyTool,
  Brush,
  CELL_EDGE_BRUSH_ID,
  continuesOnDrag,
  leavesLooseButton,
  MESSAGE_FILL_NEEDS_TERRAIN,
  MESSAGE_LINKS_REMOVED,
  MESSAGE_START_KEPT,
  MESSAGE_WIRE_LAUNCHER_DONE,
  MESSAGE_WIRE_LAUNCHER_LINKED,
  MESSAGE_WIRE_LAUNCHER_PICKED,
  MESSAGE_WIRE_LAUNCHER_START_ON_LAUNCHER,
  MESSAGE_WIRE_LAUNCHER_TRIGGER_LEFT,
  MESSAGE_WIRE_LAUNCHER_UNLINKED,
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
const LAUNCHER_WIRE: Brush = { kind: 'wire_launcher', id: 'wire_launcher' };

// Edits read the tile config (hidden terrain, launcher roles), as the editor does.
beforeEach(() => {
  loadTestConfigs();
});

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

  it('does nothing for the select tool, which works on rectangles', () => {
    const map = blank(5, 5);
    const outcome = applyTool(input({ map, tool: 'select' }));
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

describe('thin wall brush', () => {
  const EDGE: Brush = { kind: 'cell_edge', id: CELL_EDGE_BRUSH_ID };

  it('toggles the given side, falling back to the facing', () => {
    const map = blank(5, 5);
    const withSide = applyTool(input({ map, brush: EDGE, side: 'E', dir: 'S' }));
    expect(withSide.changed).toBe(true);
    expect(withSide.map.cellEdges).toEqual([{ x: 2, y: 2, sides: ['E'] }]);
    const byFacing = applyTool(input({ map, brush: EDGE, dir: 'W' }));
    expect(byFacing.map.cellEdges).toEqual([{ x: 2, y: 2, sides: ['W'] }]);
    const again = applyTool(input({ map: withSide.map, brush: EDGE, side: 'E' }));
    expect(again.map.cellEdges).toBeUndefined();
  });

  it('acts once per click and refuses to fill', () => {
    expect(continuesOnDrag('brush', EDGE, false)).toBe(false);
    expect(continuesOnDrag('brush', { kind: 'terrain', id: 'wall' }, false)).toBe(true);
    const map = blank(5, 5);
    const outcome = applyTool(input({ map, tool: 'fill', brush: EDGE }));
    expect(outcome.changed).toBe(false);
    expect(outcome.messages).toEqual([{ key: MESSAGE_FILL_NEEDS_TERRAIN }]);
  });

  it('is not painted by the picker, and the eraser clears the walls of its own cell only', () => {
    const map = blank(5, 5);
    map.cellEdges = [
      { x: 2, y: 2, sides: ['N'] },
      { x: 3, y: 2, sides: ['W'] }
    ];
    expect(applyTool(input({ map, tool: 'picker', brush: EDGE })).changed).toBe(false);
    const erased = applyTool(input({ map, tool: 'eraser', brush: EDGE }));
    expect(erased.map.cellEdges).toEqual([{ x: 3, y: 2, sides: ['W'] }]);
  });
});

describe('the launcher wire', () => {
  const wire = (map: EditorMap, x: number, y: number, pendingWire: PendingWire | null, dir: 'N' | 'E' | 'S' | 'W' = 'S') =>
    applyTool(input({ map, brush: LAUNCHER_WIRE, x, y, pendingWire, dir }));
  const keys = (messages: ReadonlyArray<{ key: string }>): string[] => messages.map((message) => message.key);

  function withDevices(): EditorMap {
    const map = blank(8, 8);
    map.terrain[1][1] = 'shot_trigger';
    map.terrain[1][5] = 'shot_launcher_w';
    return map;
  }

  it('places a trigger on a free cell and holds it picked, without a launcher count above zero', () => {
    const first = wire(blank(8, 8), 2, 2, null);
    expect(first.changed).toBe(true);
    expect(first.map.terrain[2][2]).toBe('shot_trigger');
    expect(first.pendingWire).toEqual({ kind: 'launcher', x: 2, y: 2 });
    expect(first.messages).toEqual([{ key: MESSAGE_WIRE_LAUNCHER_PICKED, params: { count: 0 } }]);
  });

  it('picks an existing trigger without changing the map, and says how many launchers it fires', () => {
    const map = withDevices();
    map.launcherLinks = [{ buttonX: 1, buttonY: 1, launcherX: 5, launcherY: 1 }];
    const picked = wire(map, 1, 1, null);
    expect(picked.changed).toBe(false);
    expect(picked.map).toBe(map);
    expect(picked.pendingWire).toEqual({ kind: 'launcher', x: 1, y: 1 });
    expect(picked.messages).toEqual([{ key: MESSAGE_WIRE_LAUNCHER_PICKED, params: { count: 1 } }]);
  });

  it('refuses to start from a launcher', () => {
    const map = withDevices();
    const refused = wire(map, 5, 1, null);
    expect(refused.changed).toBe(false);
    expect(refused.pendingWire).toBeNull();
    expect(keys(refused.messages)).toEqual([MESSAGE_WIRE_LAUNCHER_START_ON_LAUNCHER]);
  });

  it('links an unlinked launcher keeping its tile, then unlinks it on the next click, the wire staying open', () => {
    const map = withDevices();
    const pending: PendingWire = { kind: 'launcher', x: 1, y: 1 };
    const linked = wire(map, 5, 1, pending, 'N');
    expect(linked.changed).toBe(true);
    expect(linked.map.terrain[1][5]).toBe('shot_launcher_w');
    expect(linked.map.launcherLinks).toEqual([{ buttonX: 1, buttonY: 1, launcherX: 5, launcherY: 1 }]);
    expect(linked.pendingWire).toEqual(pending);
    expect(linked.messages).toEqual([{ key: MESSAGE_WIRE_LAUNCHER_LINKED, params: { count: 1 } }]);
    const unlinked = wire(linked.map, 5, 1, pending);
    expect(unlinked.map.launcherLinks).toBeUndefined();
    expect(unlinked.pendingWire).toEqual(pending);
    expect(unlinked.messages).toEqual([{ key: MESSAGE_WIRE_LAUNCHER_UNLINKED, params: { count: 0 } }]);
  });

  it('paints a launcher facing the direction on any other cell and links it', () => {
    const map = withDevices();
    const out = wire(map, 4, 4, { kind: 'launcher', x: 1, y: 1 }, 'E');
    expect(out.map.terrain[4][4]).toBe('shot_launcher_e');
    expect(out.map.launcherLinks).toEqual([{ buttonX: 1, buttonY: 1, launcherX: 4, launcherY: 4 }]);
    expect(out.pendingWire).toEqual({ kind: 'launcher', x: 1, y: 1 });
  });

  it('reports the links removed by painting a launcher over a button', () => {
    const map = withDevices();
    map.terrain[4][4] = 'button_brown';
    map.terrain[4][5] = 'trap';
    map.trapLinks = [{ buttonX: 4, buttonY: 4, trapX: 5, trapY: 4 }];
    const out = wire(map, 4, 4, { kind: 'launcher', x: 1, y: 1 });
    expect(keys(out.messages)).toEqual([MESSAGE_WIRE_LAUNCHER_LINKED, MESSAGE_LINKS_REMOVED]);
  });

  it('finishes when the trigger is clicked again, without a change', () => {
    const map = withDevices();
    map.launcherLinks = [{ buttonX: 1, buttonY: 1, launcherX: 5, launcherY: 1 }];
    const done = wire(map, 1, 1, { kind: 'launcher', x: 1, y: 1 });
    expect(done.changed).toBe(false);
    expect(done.pendingWire).toBeNull();
    expect(done.messages).toEqual([{ key: MESSAGE_WIRE_LAUNCHER_DONE, params: { count: 1 } }]);
  });

  it('switches to another trigger when one is clicked', () => {
    const map = withDevices();
    map.terrain[3][3] = 'shot_trigger';
    map.launcherLinks = [{ buttonX: 1, buttonY: 1, launcherX: 5, launcherY: 1 }];
    const switched = wire(map, 3, 3, { kind: 'launcher', x: 1, y: 1 });
    expect(switched.changed).toBe(false);
    expect(switched.pendingWire).toEqual({ kind: 'launcher', x: 3, y: 3 });
    expect(switched.messages).toEqual([{ key: MESSAGE_WIRE_LAUNCHER_PICKED, params: { count: 0 } }]);
  });

  it('says the trigger was left without a link when switching away from a bare visible trigger', () => {
    const map = withDevices();
    map.terrain[3][3] = 'shot_trigger';
    const switched = wire(map, 3, 3, { kind: 'launcher', x: 1, y: 1 });
    expect(switched.pendingWire).toEqual({ kind: 'launcher', x: 3, y: 3 });
    expect(switched.messages).toEqual([
      { key: MESSAGE_WIRE_LAUNCHER_TRIGGER_LEFT },
      { key: MESSAGE_WIRE_LAUNCHER_PICKED, params: { count: 0 } }
    ]);
  });

  it('finishes on the picked trigger with the Escape wording when it is left without a link', () => {
    const map = withDevices();
    const done = wire(map, 1, 1, { kind: 'launcher', x: 1, y: 1 });
    expect(done.pendingWire).toBeNull();
    expect(done.messages).toEqual([{ key: MESSAGE_WIRE_LAUNCHER_TRIGGER_LEFT }]);
  });

  it('drops the wire when its trigger is gone', () => {
    const map = withDevices();
    map.terrain[1][1] = 'floor';
    const out = wire(map, 5, 1, { kind: 'launcher', x: 1, y: 1 });
    expect(out.changed).toBe(false);
    expect(out.pendingWire).toBeNull();
    expect(keys(out.messages)).toEqual([MESSAGE_WIRE_MISSING_BUTTON]);
  });

  it('acts once per click and never fills', () => {
    expect(continuesOnDrag('brush', LAUNCHER_WIRE, false)).toBe(false);
    const filled = applyTool(input({ map: blank(6, 6), tool: 'fill', brush: LAUNCHER_WIRE }));
    expect(filled.changed).toBe(false);
    expect(keys(filled.messages)).toEqual([MESSAGE_FILL_NEEDS_TERRAIN]);
  });

  it('keeps the wire open through the eraser tool but erases the cell and its links', () => {
    const map = withDevices();
    map.launcherLinks = [{ buttonX: 1, buttonY: 1, launcherX: 5, launcherY: 1 }];
    const erased = applyTool(input({ map, tool: 'eraser', brush: LAUNCHER_WIRE, x: 5, y: 1, pendingWire: { kind: 'launcher', x: 1, y: 1 } }));
    expect(erased.map.terrain[1][5]).toBe('floor');
    expect(erased.map.launcherLinks).toBeUndefined();
    expect(erased.messages).toContainEqual({ key: MESSAGE_LINKS_REMOVED, params: { count: 1 } });
  });

  it('counts a trigger with launcher links as linked when a wire is dropped', () => {
    const map = withDevices();
    const pending: PendingWire = { kind: 'launcher', x: 1, y: 1 };
    expect(leavesLooseButton(map, pending, 'shot_trigger')).toBe(true);
    map.launcherLinks = [{ buttonX: 1, buttonY: 1, launcherX: 5, launcherY: 1 }];
    expect(leavesLooseButton(map, pending, 'shot_trigger')).toBe(false);
    map.terrain[1][1] = 'floor';
    expect(leavesLooseButton(map, pending, 'shot_trigger')).toBe(false);
  });
});

describe('clone template messages', () => {
  beforeEach(() => {
    loadTestConfigs();
    i18n.setLocale('en');
  });

  const CLONER: Brush = { kind: 'wire_cloner', id: 'wire_cloner' };

  it('announces the new template when a creature is painted on a linked clone machine', () => {
    const map = blank(6, 6);
    map.terrain[4][4] = 'clone_machine';
    map.cloneLinks = [{ buttonX: 1, buttonY: 1, clonerX: 4, clonerY: 4, templateType: 'dirt_block', templateDir: 'S' }];
    const out = applyTool(input({ map, brush: { kind: 'entity', id: 'walker' }, dir: 'E', x: 4, y: 4 }));
    expect(out.map.cloneLinks[0]).toMatchObject({ templateType: 'walker', templateDir: 'E' });
    expect(out.messages.map((m) => m.key)).toContain('editor.layout.status.cloner_template.label');
  });

  it('warns when a clone wire ends on a clone machine with no creature', () => {
    const map = blank(6, 6);
    const first = applyTool(input({ map, brush: CLONER, x: 1, y: 1 }));
    const second = applyTool(input({ map: first.map, brush: CLONER, x: 4, y: 4, pendingWire: first.pendingWire }));
    expect(second.messages.map((m) => m.key)).toEqual([MESSAGE_WIRE_LINKED, 'editor.layout.status.wire_empty_cloner.label']);
  });
});
