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
  MESSAGE_FILL_NEEDS_TERRAIN,
  MESSAGE_LINKS_REMOVED,
  MESSAGE_START_KEPT,
  pickFromCell,
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
    ...overrides
  };
}

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

describe('device tiles', () => {
  it('paints a brown button or a trap like any tile, without placing a link', () => {
    const map = blank(6, 6);
    const button = applyTool(input({ map, brush: { kind: 'terrain', id: 'button_brown' }, x: 1, y: 1 }));
    expect(button.map.terrain[1][1]).toBe('button_brown');
    expect(button.map.trapLinks).toEqual([]);
    const trap = applyTool(input({ map: button.map, brush: { kind: 'terrain', id: 'trap' }, x: 4, y: 4 }));
    expect(trap.map.terrain[4][4]).toBe('trap');
    expect(trap.map.trapLinks).toEqual([]);
  });
});

describe('continuesOnDrag', () => {
  it('keeps painting for plain brushes and the eraser only', () => {
    const terrain: Brush = { kind: 'terrain', id: 'wall' };
    expect(continuesOnDrag('brush', terrain, false)).toBe(true);
    expect(continuesOnDrag('eraser', terrain, false)).toBe(true);
    expect(continuesOnDrag('brush', terrain, true)).toBe(true);
    expect(continuesOnDrag('fill', terrain, false)).toBe(false);
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

describe('shot devices as plain tiles', () => {
  const keys = (messages: ReadonlyArray<{ key: string }>): string[] => messages.map((message) => message.key);

  function withDevices(): EditorMap {
    const map = blank(8, 8);
    map.terrain[1][1] = 'shot_trigger';
    map.terrain[1][5] = 'shot_launcher_w';
    return map;
  }

  it('paints a shot trigger or a launcher like any tile, without a link', () => {
    const trigger = applyTool(input({ map: blank(8, 8), brush: { kind: 'terrain', id: 'shot_trigger' }, x: 2, y: 2 }));
    expect(trigger.map.terrain[2][2]).toBe('shot_trigger');
    expect(trigger.map.launcherLinks).toBeUndefined();
  });

  it('reports the links removed by painting a plain tile over a linked button', () => {
    const map = withDevices();
    map.terrain[4][4] = 'button_brown';
    map.terrain[4][5] = 'trap';
    map.trapLinks = [{ buttonX: 4, buttonY: 4, trapX: 5, trapY: 4 }];
    const out = applyTool(input({ map, brush: { kind: 'terrain', id: 'shot_launcher_e' }, x: 4, y: 4 }));
    expect(keys(out.messages)).toEqual([MESSAGE_LINKS_REMOVED]);
  });

  it('erases a launcher cell and its links', () => {
    const map = withDevices();
    map.launcherLinks = [{ buttonX: 1, buttonY: 1, launcherX: 5, launcherY: 1 }];
    const erased = applyTool(input({ map, tool: 'eraser', x: 5, y: 1 }));
    expect(erased.map.terrain[1][5]).toBe('floor');
    expect(erased.map.launcherLinks).toBeUndefined();
    expect(erased.messages).toContainEqual({ key: MESSAGE_LINKS_REMOVED, params: { count: 1 } });
  });
});

describe('clone template messages', () => {
  beforeEach(() => {
    loadTestConfigs();
    i18n.setLocale('en');
  });

  it('announces the new template when a creature is painted on a linked clone machine', () => {
    const map = blank(6, 6);
    map.terrain[4][4] = 'clone_machine';
    map.cloneLinks = [{ buttonX: 1, buttonY: 1, clonerX: 4, clonerY: 4, templateType: 'dirt_block', templateDir: 'S' }];
    const out = applyTool(input({ map, brush: { kind: 'entity', id: 'walker' }, dir: 'E', x: 4, y: 4 }));
    expect(out.map.cloneLinks[0]).toMatchObject({ templateType: 'walker', templateDir: 'E' });
    expect(out.messages.map((m) => m.key)).toContain('editor.layout.status.cloner_template.label');
  });
});
