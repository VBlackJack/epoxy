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
import { cc3dModel, stacked, type GlyphMeaning } from '../core/cc3d/cc3dTestMaps';
import { normalizeCell, type Cc3dLevel } from '../core/cc3d/model';
import { EDITOR_CC3D_MAX_LINK_MESSAGES } from '../ui/uiConstants';
import { placeLayer, placeMob, removeMob } from './cc3dEdits';
import { describeLinkChanges, diffCc3dLinks, linkOverlayFor, MESSAGE_CC3D_LINK_MORE } from './cc3dLinkOverlay';

const GLYPHS: Record<string, GlyphMeaning> = {
  b: stacked({ kind: 'floor' }, { kind: 'trap_control' }),
  c: stacked({ kind: 'floor' }, { kind: 'trap' }),
  m: stacked({ kind: 'floor' }, { kind: 'clone_machine' }),
  Y: { stack: [{ kind: 'floor' }, { kind: 'clone_machine' }], mob: { kind: 'block_dirt' } },
  z: stacked({ kind: 'floor' }, { kind: 'clone_switch' }),
  l: stacked({ kind: 'floor' }, { kind: 'laser_controller' }),
  B: { mob: { kind: 'laser_shooter', dir: 'E' } },
  q: stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' })
};

function level(rows: string[]): Cc3dLevel {
  const model = cc3dModel(rows, GLYPHS);
  return { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
}

describe('link overlay', () => {
  it('points a trap control at its trap, and a trap back at the controls that open it', () => {
    const map = level(['#######', '#@b.c.#', '#######']);
    const fromControl = linkOverlayFor(map, { x: 2, y: 1 });
    expect(fromControl.arrows).toEqual([{ kind: 'trap', from: { x: 2, y: 1 }, to: { x: 4, y: 1 } }]);
    expect(linkOverlayFor(map, { x: 4, y: 1 }).arrows).toEqual(fromControl.arrows);
    expect(linkOverlayFor(map, { x: 3, y: 1 })).toEqual({ arrows: [], highlights: [], badges: [] });
  });

  it('points a teleport at the cell an arrival there would use', () => {
    const map = level(['######', '#@tkt#', '######']);
    const overlay = linkOverlayFor(map, { x: 4, y: 1 });
    expect(overlay.arrows.map((arrow) => [arrow.kind, arrow.from, arrow.to])).toContainEqual(['teleport', { x: 4, y: 1 }, { x: 2, y: 1 }]);
  });

  it('shows a clone switch, its machine and the template mob with a badge', () => {
    const map = level(['######', '#@zY.#', '######']);
    const overlay = linkOverlayFor(map, { x: 2, y: 1 });
    expect(overlay.arrows).toEqual([
      { kind: 'clone', from: { x: 2, y: 1 }, to: { x: 3, y: 1 } },
      { kind: 'template', from: { x: 3, y: 1 }, to: { x: 3, y: 1 } }
    ]);
    expect(overlay.badges).toEqual([{ x: 3, y: 1 }]);
    // Looking at the machine itself shows the same chain.
    expect(linkOverlayFor(map, { x: 3, y: 1 }).badges).toEqual([{ x: 3, y: 1 }]);
  });

  it('points a laser controller at the nearest shooter', () => {
    const map = level(['######', '#@l.B#', '######']);
    expect(linkOverlayFor(map, { x: 2, y: 1 }).arrows).toEqual([{ kind: 'laser', from: { x: 2, y: 1 }, to: { x: 4, y: 1 } }]);
  });

  it('highlights the cells of the same colour group, and nothing for a lone device', () => {
    const map = level(['#######', '#@qJ.q#', '#######']);
    const overlay = linkOverlayFor(map, { x: 2, y: 1 });
    expect(overlay.highlights).toEqual(expect.arrayContaining([{ x: 3, y: 1 }, { x: 5, y: 1 }]));
    expect(overlay.highlights).toHaveLength(2);
    expect(linkOverlayFor(map, { x: 1, y: 1 }).highlights).toEqual([]);
  });

  it('is empty outside the grid', () => {
    expect(linkOverlayFor(level(['###', '#@#', '###']), { x: 9, y: 9 }).arrows).toEqual([]);
  });
});

describe('link changes after an edit', () => {
  it('reports a trap control that now opens another trap', () => {
    const before = level(['#########', '#@b..c.c#', '#########']);
    const after = placeLayer(before, 3, 1, { kind: 'trap' });
    const changes = diffCc3dLinks(before, after);
    expect(changes).toEqual([{ kind: 'trap', from: { x: 2, y: 1 }, to: { x: 3, y: 1 }, was: { x: 5, y: 1 } }]);
    expect(describeLinkChanges(changes)).toEqual([{ key: 'editor.cc3d.status.link_trap', params: { x: 2, y: 1, toX: 3, toY: 1 } }]);
  });

  it('reports a link that lost its target, with the message for none', () => {
    const before = level(['#######', '#@b.c.#', '#######']);
    const after = placeLayer(before, 4, 1, { kind: 'water' });
    // The trap sat on the floor of that cell, so replacing the base keeps it: remove it through a plain floor.
    expect(diffCc3dLinks(before, after)).toEqual([]);
    const gone: Cc3dLevel = { ...before, cells: before.cells.map((cell, index) => (index === 1 * before.width + 4 ? { ...cell, terrain: [{ kind: 'floor' as const }] } : cell)) };
    const changes = diffCc3dLinks(before, gone);
    expect(changes).toEqual([{ kind: 'trap', from: { x: 2, y: 1 }, to: null, was: { x: 4, y: 1 } }]);
    expect(describeLinkChanges(changes)).toEqual([{ key: 'editor.cc3d.status.link_trap_none', params: { x: 2, y: 1 } }]);
  });

  it('reports a clone switch whose nearest machine changed, and a laser controller whose shooter changed', () => {
    const clones = level(['#########', '#@z..m..m#', '#########']);
    const nearer = placeLayer(clones, 3, 1, { kind: 'clone_machine' });
    expect(diffCc3dLinks(clones, nearer).map((change) => [change.kind, change.to])).toEqual([['clone_switch', { x: 3, y: 1 }]]);
    const lasers = level(['#########', '#@l.....B#', '#########']);
    const closer = placeMob(lasers, { kind: 'laser_shooter', x: 3, y: 1, dir: 'E' });
    expect(diffCc3dLinks(lasers, closer).map((change) => [change.kind, change.to])).toEqual([['laser', { x: 3, y: 1 }]]);
    expect(diffCc3dLinks(closer, removeMob(closer, 3, 1)).map((change) => change.to)).toEqual([{ x: 8, y: 1 }]);
  });

  it('does not count a new source, a vanished source, a template or an unrelated edit', () => {
    const before = level(['#########', '#@..c..m#', '#########']);
    const withControl = placeLayer(before, 2, 1, { kind: 'trap_control' });
    expect(diffCc3dLinks(before, withControl)).toEqual([]);
    expect(diffCc3dLinks(withControl, before)).toEqual([]);
    expect(diffCc3dLinks(before, placeMob(before, { kind: 'block_dirt', x: 7, y: 1, dir: 'N' }))).toEqual([]);
    expect(diffCc3dLinks(before, before)).toEqual([]);
  });

  it('spells out the first changes and counts the rest, in the plural when it must', () => {
    const many = Array.from({ length: EDITOR_CC3D_MAX_LINK_MESSAGES + 2 }, (_, i) => ({
      kind: 'teleport' as const,
      from: { x: i, y: 0 },
      to: { x: i + 1, y: 0 },
      was: null
    }));
    const messages = describeLinkChanges(many);
    expect(messages).toHaveLength(EDITOR_CC3D_MAX_LINK_MESSAGES + 1);
    expect(messages.at(-1)).toEqual({ key: MESSAGE_CC3D_LINK_MORE, params: { count: 2 } });
    expect(describeLinkChanges(many.slice(0, EDITOR_CC3D_MAX_LINK_MESSAGES))).toHaveLength(EDITOR_CC3D_MAX_LINK_MESSAGES);
    expect(describeLinkChanges([])).toEqual([]);
  });
});
