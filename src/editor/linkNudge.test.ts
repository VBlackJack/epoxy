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
import { nudgeMessages, soleChangedCell } from './linkSession';

const SIZE = 7;
const CELL = { x: 3, y: 3 };

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
});

function room(): EditorMap {
  const terrain = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => 'floor'));
  const items = Array.from({ length: SIZE }, () => Array<string | null>(SIZE).fill(null));
  return { terrain, items, entities: [], trapLinks: [], cloneLinks: [], playerStart: { x: 1, y: 1, dir: 'S' } };
}

function withTile(tile: string, at = CELL): EditorMap {
  const map = room();
  map.terrain[at.y][at.x] = tile;
  return map;
}

describe('nudgeMessages', () => {
  it('names the device, says how to link it and what it does unlinked', () => {
    expect(nudgeMessages(withTile('button_brown'), CELL.x, CELL.y, 'epoxy')).toEqual([
      { key: 'editor.link.nudge.label', params: { role: 'Brown button' } },
      { key: 'editor.link.fallback.trap_button.label' }
    ]);
  });

  it('covers every linkable device of an Epoxy level', () => {
    const expected: Record<string, string> = {
      button_brown: 'trap_button',
      button_red: 'clone_button',
      trap: 'trap',
      clone_machine: 'clone_machine',
      shot_trigger: 'shot_trigger',
      shot_launcher_e: 'shot_launcher'
    };
    for (const [tile, role] of Object.entries(expected)) {
      const messages = nudgeMessages(withTile(tile), CELL.x, CELL.y, 'epoxy');
      expect(messages.map((m) => m.key), tile).toEqual(['editor.link.nudge.label', `editor.link.fallback.${role}.label`]);
    }
  });

  it('uses the Lynx wording under Lynx rules, and says nothing about a shot device there', () => {
    expect(nudgeMessages(withTile('trap'), CELL.x, CELL.y, 'lynx').map((m) => m.key)).toEqual([
      'editor.link.nudge.label',
      'editor.link.fallback_lynx.trap.label'
    ]);
    expect(nudgeMessages(withTile('shot_trigger'), CELL.x, CELL.y, 'lynx')).toEqual([]);
  });

  it('is quiet for a linked device, a plain cell, a hidden device and a CC3D level', () => {
    const linked = withTile('button_brown');
    linked.trapLinks = [{ buttonX: CELL.x, buttonY: CELL.y, trapX: 5, trapY: 5 }];
    expect(nudgeMessages(linked, CELL.x, CELL.y, 'epoxy')).toEqual([]);
    expect(nudgeMessages(room(), CELL.x, CELL.y, 'epoxy')).toEqual([]);
    const hidden = withTile('door_red');
    hidden.underlays = [{ x: CELL.x, y: CELL.y, terrain: 'trap' }];
    expect(nudgeMessages(hidden, CELL.x, CELL.y, 'epoxy')).toEqual([]);
    expect(nudgeMessages(withTile('trap'), CELL.x, CELL.y, 'cc3d')).toEqual([]);
  });
});

describe('soleChangedCell', () => {
  it('finds the one cell a placement changed', () => {
    expect(soleChangedCell(room(), withTile('trap'))).toEqual(CELL);
  });

  it('finds a cell whose hidden terrain changed', () => {
    const after = withTile('door_red');
    const before = withTile('door_red');
    after.underlays = [{ x: CELL.x, y: CELL.y, terrain: 'trap' }];
    expect(soleChangedCell(before, after)).toEqual(CELL);
  });

  it('is null when nothing changed, when several cells changed, and when the size changed', () => {
    expect(soleChangedCell(room(), room())).toBeNull();
    const two = withTile('trap');
    two.terrain[1][1] = 'trap';
    expect(soleChangedCell(room(), two)).toBeNull();
    const taller = room();
    taller.terrain.push(Array.from({ length: SIZE }, () => 'floor'));
    taller.items.push(Array<string | null>(SIZE).fill(null));
    expect(soleChangedCell(room(), taller)).toBeNull();
  });
});
