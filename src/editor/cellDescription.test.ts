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
import { i18n, t } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { describeEditorCell } from './cellDescription';
import type { EditorMap } from './editorDocument';

const WIDTH = 4;
const HEIGHT = 3;

function emptyMap(): EditorMap {
  const terrain = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => 'floor'));
  return {
    terrain,
    items: terrain.map((row) => row.map(() => null)),
    entities: [],
    trapLinks: [],
    cloneLinks: [],
    playerStart: { x: 0, y: 0, dir: 'N' }
  };
}

const spoken = (parts: ReturnType<typeof describeEditorCell>): string => parts.map((part) => t(part.key, part.params)).join(' ');
const nameOf = (id: string): string => t(ConfigRegistry.getTile(id)?.i18nKey ?? id);

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
});

describe('describeEditorCell', () => {
  it('starts with the coordinates and names the tile', () => {
    const parts = describeEditorCell({ map: emptyMap(), x: 2, y: 1 });
    expect(parts[0]).toEqual({ key: 'editor.palette.status.coords', params: { x: 2, y: 1 } });
    expect(spoken(parts)).toBe(`Tile (2, 1) ${nameOf('floor')}`);
  });

  it('adds the item and the creature with its facing', () => {
    const map = emptyMap();
    map.items[1][2] = 'chip';
    map.entities.push({ x: 2, y: 1, type: 'walker', dir: 'E' });
    const text = spoken(describeEditorCell({ map, x: 2, y: 1 }));
    expect(text).toContain(`item: ${nameOf('chip')}`);
    expect(text).toContain('facing east');
  });

  it('speaks the facing of a puppet, which moves only under steering', () => {
    const map = emptyMap();
    map.entities.push({ x: 2, y: 1, type: 'puppet', dir: 'E' });
    expect(spoken(describeEditorCell({ map, x: 2, y: 1 }))).toContain('facing east');
  });

  it('names a block or a mirror without a facing', () => {
    for (const type of ['dirt_block', 'mirror_slash']) {
      const map = emptyMap();
      map.entities.push({ x: 2, y: 1, type, dir: 'E' });
      const text = spoken(describeEditorCell({ map, x: 2, y: 1 }));
      expect(text).not.toContain('facing');
      expect(text).toContain(t(ConfigRegistry.getEntityDef(type)?.i18nKey ?? type));
    }
  });

  it('says where the player starts and which way it faces', () => {
    expect(spoken(describeEditorCell({ map: emptyMap(), x: 0, y: 0 }))).toContain('Player start, facing north');
  });

  it('lists a CC3D stack bottom first, as given', () => {
    const text = spoken(describeEditorCell({ map: emptyMap(), x: 1, y: 1, cc3dNames: ['Floor', 'Red door', 'Fish'] }));
    expect(text).toBe('Tile (1, 1) Floor Red door Fish');
  });

  it('says a cell is outside the grid', () => {
    for (const [x, y] of [[-1, 0], [WIDTH, 0], [0, HEIGHT], [0, -1]]) {
      expect(spoken(describeEditorCell({ map: emptyMap(), x, y }))).toBe(`Tile (${x}, ${y}) Outside the grid`);
    }
  });

  it('speaks French', () => {
    i18n.setLocale('fr');
    expect(spoken(describeEditorCell({ map: emptyMap(), x: 0, y: 0 }))).toContain('Départ du joueur, tourné vers le nord');
  });
});
