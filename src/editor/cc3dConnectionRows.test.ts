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
import { cc3dLinks } from '../core/cc3d/cc3dLinks';
import { cc3dModel, stacked, type GlyphMeaning } from '../core/cc3d/cc3dTestMaps';
import { normalizeCell, type Cc3dLevel } from '../core/cc3d/model';
import { smallCc3dLevel } from './cc3dEditorFixtures';
import { resolveMessage, type TranslationNode } from '../i18n/messageFormat';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EDITOR_CONNECTIONS_MAX_ROWS } from '../ui/uiConstants';
import { CC3D_CONNECTION_KEYS, cc3dConnectionRows } from './cc3dConnectionRows';
import { linkOverlayFor } from './cc3dLinkOverlay';
import { CC3D_SYSTEM_NAME_KEYS, CONNECTIONS_KEYS, type ConnectionRow, type ConnectionView, SYSTEM_NAME_KEYS, systemNameKey } from './connectionRows';

const EN = enLocale as TranslationNode;
const FR = frLocale as TranslationNode;

const GLYPHS: Record<string, GlyphMeaning> = {
  b: stacked({ kind: 'floor' }, { kind: 'trap_control' }),
  c: stacked({ kind: 'floor' }, { kind: 'trap' }),
  m: stacked({ kind: 'floor' }, { kind: 'clone_machine' }),
  Y: { stack: [{ kind: 'floor' }, { kind: 'clone_machine' }], mob: { kind: 'block_dirt' } },
  z: stacked({ kind: 'floor' }, { kind: 'clone_switch' }),
  l: stacked({ kind: 'floor' }, { kind: 'laser_controller' }),
  B: { mob: { kind: 'laser_shooter', dir: 'E' } },
  q: stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' }),
  p: stacked({ kind: 'floor' }, { kind: 'plate', color: 'green' }),
  '1': stacked({ kind: 'floor' }, { kind: 'golem_control_blue' }),
  '2': stacked({ kind: 'floor' }, { kind: 'golem_control_yellow' }),
  '3': { mob: { kind: 'golem_blue' } },
  '4': { mob: { kind: 'golem_yellow' } },
  U: stacked({ kind: 'floor' }, { kind: 'clone_switch' }, { kind: 'trap' })
};

function level(rows: string[]): Cc3dLevel {
  const model = cc3dModel(rows, GLYPHS);
  return { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
}

function viewAt(map: Cc3dLevel, x: number, y: number): ConnectionView {
  return cc3dConnectionRows(map, x, y, cc3dLinks(map));
}

const where = (rows: readonly ConnectionRow[]): string[] => rows.map((row) => `${row.x},${row.y}`);

/** Every map of the suite: each device of the section appears in at least one of them. */
const MAPS: Record<string, string[]> = {
  traps: ['############', '#@b.c.b.c.c#', '############'],
  trapWrap: ['#######', '#@c.b.#', '#######'],
  noTrap: ['#####', '#@b.#', '#####'],
  teleports: ['##########', '#@t.k.t.k#', '##########'],
  loneTeleports: ['#######', '#@t.k.#', '#######'],
  clone: ['#########', '#@z.Y.m.#', '#########'],
  noMachine: ['####', '#@z#', '####'],
  laser: ['#######', '#@l.B.#', '#######'],
  noShooter: ['#####', '#@l.#', '#####'],
  toggles: ['###########', '#@q.J.q.J.#', '###########'],
  holds: ['######', '#@p.H#', '######'],
  golems: ['##########', '#@1.3.4.2#', '##########'],
  buried: ['######', '#@U.m#', '######']
};

beforeEach(() => {
  loadTestConfigs();
});

describe('the Connections rows of a CC3D level', () => {
  it('lists the trap a trap control opens, and the controls that open a trap', () => {
    const map = level(MAPS.traps);
    const control = viewAt(map, 2, 1);
    expect(where(control.controls?.rows ?? [])).toEqual(['4,1']);
    expect(control.controls?.rows[0]).toMatchObject({ system: 'trap', kind: 'link', fallback: false, unlink: null });
    expect(control.controlledBy?.rows).toEqual([]);
    expect(control.controlledBy?.empty).toEqual({ key: CONNECTIONS_KEYS.noneControlled });
    expect(where(viewAt(map, 4, 1).controlledBy?.rows ?? [])).toEqual(['2,1']);
    expect(control.caption).toMatchObject({ key: CONNECTIONS_KEYS.cell, x: 2, y: 1 });
    expect(control.link).toBeNull();
  });

  it('wraps from the last cell to the first trap, and says when the level has no trap', () => {
    expect(where(viewAt(level(MAPS.trapWrap), 4, 1).controls?.rows ?? [])).toEqual(['2,1']);
    const none = viewAt(level(MAPS.noTrap), 2, 1);
    expect(none.controls?.rows).toEqual([]);
    expect(none.note).toEqual({ key: CC3D_CONNECTION_KEYS.needsTrap });
  });

  it('says a trap no control works stays closed, and nothing about a controlled one', () => {
    const map = level(MAPS.traps);
    expect(viewAt(map, 10, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.trapUncontrolled });
    expect(viewAt(map, 8, 1).note).toBeNull();
  });

  it('keeps every control of a trap: link rows are never cut by the cap', () => {
    const controls = EDITOR_CONNECTIONS_MAX_ROWS + 2;
    const map = level(['#'.repeat(controls + 4), `#@${'b'.repeat(controls)}c#`, '#'.repeat(controls + 4)]);
    const trap = viewAt(map, controls + 2, 1);
    expect(trap.controlledBy?.rows).toHaveLength(controls);
    expect(trap.controlledBy?.more).toBe(0);
  });

  it('points a teleport at the cell an arrival there would use, and lists the teleports that lead to it', () => {
    const map = level(MAPS.teleports);
    expect(where(viewAt(map, 2, 1).controls?.rows ?? [])).toEqual(['6,1']);
    expect(where(viewAt(map, 2, 1).controlledBy?.rows ?? [])).toEqual(['6,1']);
    expect(where(viewAt(map, 4, 1).controls?.rows ?? [])).toEqual(['8,1']);
    expect(viewAt(map, 2, 1).controls?.rows[0].system).toBe('teleport');
  });

  it('says a lone teleport needs another one of its colour', () => {
    const map = level(MAPS.loneTeleports);
    expect(viewAt(map, 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsTeleport, params: { colour: 'red' } });
    expect(viewAt(map, 4, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsTeleport, params: { colour: 'blue' } });
  });

  it('follows a clone switch to the nearest machine and the machine to the template standing on it', () => {
    const map = level(MAPS.clone);
    const clone = viewAt(map, 2, 1);
    expect(where(clone.controls?.rows ?? [])).toEqual(['4,1']);
    expect(clone.controls?.rows[0].system).toBe('clone');
    const machine = viewAt(map, 4, 1);
    // The machine is not listed as controlling itself, though its template stands on the same cell.
    expect(where(machine.controlledBy?.rows ?? [])).toEqual(['2,1']);
    expect(machine.controlledBy?.rows.map((row) => row.system)).toEqual(['clone']);
    expect(viewAt(map, 4, 1).controlledBy?.rows.some((row) => row.x === 4)).toBe(false);
    expect(machine.controls?.rows.map((row) => [row.system, row.x, row.y])).toEqual([['template', 4, 1]]);
    expect(machine.note).toBeNull();
  });

  it('says a machine with nothing on it needs a template, and a switch without a machine needs one', () => {
    expect(viewAt(level(MAPS.clone), 6, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsTemplate });
    expect(viewAt(level(MAPS.noMachine), 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsMachine });
  });

  it('follows a laser controller to the nearest shooter and back', () => {
    const map = level(MAPS.laser);
    expect(where(viewAt(map, 2, 1).controls?.rows ?? [])).toEqual(['4,1']);
    expect(viewAt(map, 2, 1).controls?.rows[0].system).toBe('laser');
    expect(where(viewAt(map, 4, 1).controlledBy?.rows ?? [])).toEqual(['2,1']);
    expect(viewAt(level(MAPS.noShooter), 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsShooter });
  });

  it('groups toggles by colour, with the colour as the channel, and names what is missing', () => {
    const map = level(MAPS.toggles);
    const control = viewAt(map, 2, 1);
    expect(where(control.controls?.rows ?? [])).toEqual(['4,1', '8,1']);
    expect(control.controls?.rows[0]).toMatchObject({ system: 'toggle', kind: 'colour', channel: 'green' });
    expect(where(viewAt(map, 4, 1).controlledBy?.rows ?? [])).toEqual(['2,1', '6,1']);
    expect(viewAt(level(['####', '#@q#', '####']), 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsToggleControl, params: { colour: 'green' } });
    expect(viewAt(level(['####', '#@J#', '####']), 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsToggleDoor, params: { colour: 'green' } });
  });

  it('caps the colour rows of one mechanism and counts the rest', () => {
    const doors = EDITOR_CONNECTIONS_MAX_ROWS + 3;
    const map = level(['#'.repeat(doors + 4), `#@q${'J'.repeat(doors)}#`, '#'.repeat(doors + 4)]);
    const control = viewAt(map, 2, 1);
    expect(control.controls?.rows).toHaveLength(EDITOR_CONNECTIONS_MAX_ROWS);
    expect(control.controls?.more).toBe(3);
  });

  it('pairs plates with hold doors as their own mechanism, with the notes the Epoxy plates use', () => {
    const map = level(MAPS.holds);
    expect(viewAt(map, 2, 1).controls?.rows[0]).toMatchObject({ system: 'hold', kind: 'colour', channel: 'green', x: 4, y: 1 });
    expect(viewAt(map, 4, 1).controlledBy?.rows[0]).toMatchObject({ system: 'hold', x: 2, y: 1 });
    expect(viewAt(level(['####', '#@p#', '####']), 2, 1).note).toEqual({ key: CONNECTIONS_KEYS.needsPlate, params: { colour: 'green' } });
    expect(viewAt(level(['####', '#@H#', '####']), 2, 1).note).toEqual({ key: CONNECTIONS_KEYS.needsHoldDoor, params: { colour: 'green' } });
  });

  it('ties each golem control to every golem of its kind', () => {
    const map = level(MAPS.golems);
    expect(viewAt(map, 2, 1).controls?.rows[0]).toMatchObject({ system: 'golem', kind: 'colour', channel: 'blue', x: 4, y: 1 });
    expect(where(viewAt(map, 4, 1).controlledBy?.rows ?? [])).toEqual(['2,1']);
    expect(viewAt(map, 8, 1).controls?.rows[0]).toMatchObject({ system: 'golem', channel: 'yellow', x: 6, y: 1 });
    expect(viewAt(map, 6, 1).controlledBy?.rows[0]).toMatchObject({ channel: 'yellow', x: 8, y: 1 });
  });

  it('says a golem control needs a golem, and a yellow golem needs a control (a blue one walks alone)', () => {
    expect(viewAt(level(['####', '#@1#', '####']), 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsGolem, params: { colour: 'blue' } });
    expect(viewAt(level(['####', '#@2#', '####']), 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsGolem, params: { colour: 'yellow' } });
    expect(viewAt(level(['####', '#@4#', '####']), 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsGolemControl, params: { colour: 'yellow' } });
    expect(viewAt(level(['####', '#@3#', '####']), 2, 1).note).toBeNull();
    expect(viewAt(level(MAPS.golems), 2, 1).note).toBeNull();
  });

  it('does not count a buried control as a partner for the needs notes, while still listing it', () => {
    // The only toggle control stands under a trap: it is listed on the door, but the door still says what it needs.
    const toggleUnder = stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' }, { kind: 'trap' });
    const model = cc3dModel(['######', '#@T.J#', '######'], { ...GLYPHS, T: toggleUnder });
    const map: Cc3dLevel = { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    const door = viewAt(map, 4, 1);
    expect(where(door.controlledBy?.rows ?? [])).toEqual(['2,1']);
    expect(door.note).toEqual({ key: CC3D_CONNECTION_KEYS.needsToggleDoor, params: { colour: 'green' } });
    // A yellow golem whose only control is buried still needs one.
    const golemUnder = stacked({ kind: 'floor' }, { kind: 'golem_control_yellow' }, { kind: 'trap' });
    const model2 = cc3dModel(['######', '#@T.4#', '######'], { ...GLYPHS, T: golemUnder });
    const map2: Cc3dLevel = { ...model2, cells: model2.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    const golem = viewAt(map2, 4, 1);
    expect(where(golem.controlledBy?.rows ?? [])).toEqual(['2,1']);
    expect(golem.note).toEqual({ key: CC3D_CONNECTION_KEYS.needsGolemControl, params: { colour: 'yellow' } });
  });

  it('names no CC3D row after an Epoxy-only device', () => {
    const epoxyOnly = ['trap', 'clone', 'shot', 'plate', 'toggle', 'teleport', 'laser', 'tank', 'flame', 'swap', 'puppet'].map(
      (system) => resolveMessage(EN, SYSTEM_NAME_KEYS[system as keyof typeof SYSTEM_NAME_KEYS]) ?? ''
    );
    for (const rows of Object.values(MAPS)) {
      const map = level(rows);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const view = viewAt(map, x, y);
          for (const row of [...(view.controls?.rows ?? []), ...(view.controlledBy?.rows ?? [])]) {
            expect(row.systemNameKey).toBeDefined();
            expect(epoxyOnly).not.toContain(resolveMessage(EN, row.systemNameKey ?? ''));
          }
        }
      }
    }
  });

  it('flags an entry device under another layer, which the links still count', () => {
    const map = level(MAPS.buried);
    const view = viewAt(map, 2, 1);
    expect(view.note).toEqual({ key: CC3D_CONNECTION_KEYS.buried });
    expect(where(view.controls?.rows ?? [])).toEqual(['4,1']);
  });

  it('says a device behind openable covers works once opened, and counts it as a partner', () => {
    // A toggle control under a key door is not dead: stepping in opens the door.
    const toggleUnderDoor = stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' }, { kind: 'door', color: 'green' });
    const model = cc3dModel(['######', '#@T.J#', '######'], { ...GLYPHS, T: toggleUnderDoor });
    const map: Cc3dLevel = { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    const control = viewAt(map, 2, 1);
    expect(control.note).toEqual({ key: CC3D_CONNECTION_KEYS.behindCover });
    expect(where(control.controls?.rows ?? [])).toEqual(['4,1']);
    const door = viewAt(map, 4, 1);
    expect(where(door.controlledBy?.rows ?? [])).toEqual(['2,1']);
    expect(door.note).toBeNull();
    // Stacked covers open one entry at a time: still behind covers.
    const doubleCovered = stacked({ kind: 'floor' }, { kind: 'clone_switch' }, { kind: 'door', color: 'red' }, { kind: 'socket' });
    const model2 = cc3dModel(['######', '#@S.m#', '######'], { ...GLYPHS, S: doubleCovered });
    const map2: Cc3dLevel = { ...model2, cells: model2.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    expect(viewAt(map2, 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.behindCover });
  });

  it('still names what a device behind covers needs, before the cover note', () => {
    const wrap = (rows: string[], glyph: string, stack: ReturnType<typeof stacked>): Cc3dLevel => {
      const model = cc3dModel(rows, { ...GLYPHS, [glyph]: stack });
      return { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    };
    const toggle = wrap(['####', '#@T#', '####'], 'T', stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' }, { kind: 'door', color: 'red' }));
    expect(viewAt(toggle, 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsToggleControl, params: { colour: 'green' } });
    const clone = wrap(['####', '#@S#', '####'], 'S', stacked({ kind: 'floor' }, { kind: 'clone_switch' }, { kind: 'door', color: 'red' }));
    expect(viewAt(clone, 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsMachine });
  });

  it('treats a false wall and a red socket as openable covers', () => {
    const covers = stacked({ kind: 'floor' }, { kind: 'clone_switch' }, { kind: 'false_wall' }, { kind: 'socket_red' });
    const model = cc3dModel(['######', '#@S.m#', '######'], { ...GLYPHS, S: covers });
    const map: Cc3dLevel = { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    expect(viewAt(map, 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.behindCover });
  });

  it('reads the highest layer of a kind stacked twice, so a duplicate is not buried', () => {
    const twice = stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'red' }, { kind: 'toggle_control', color: 'green' });
    const redDoor = stacked({ kind: 'floor' }, { kind: 'toggle_door', color: 'red', open: false });
    const model = cc3dModel(['######', '#@T.R#', '######'], { ...GLYPHS, T: twice, R: redDoor });
    const map: Cc3dLevel = { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    expect(viewAt(map, 2, 1).note).not.toEqual({ key: CC3D_CONNECTION_KEYS.buried });
    // cc3dLinks groups a cell by its first control layer, so the colour the door pairs with is the lower one.
    expect(viewAt(map, 4, 1).note).toBeNull();
  });

  it('keeps a device under a layer that never opens buried, and not a partner', () => {
    // A wall above the toggle control: nothing opens it.
    const toggleUnderWall = stacked({ kind: 'floor' }, { kind: 'toggle_control', color: 'green' }, { kind: 'wall' });
    const model = cc3dModel(['######', '#@T.J#', '######'], { ...GLYPHS, T: toggleUnderWall });
    const map: Cc3dLevel = { ...model, cells: model.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    expect(viewAt(map, 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.buried });
    expect(viewAt(map, 4, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.needsToggleDoor, params: { colour: 'green' } });
    // A door and a wall together: the wall keeps it buried.
    const mixed = stacked({ kind: 'floor' }, { kind: 'clone_switch' }, { kind: 'door', color: 'red' }, { kind: 'wall' });
    const model2 = cc3dModel(['######', '#@S.m#', '######'], { ...GLYPHS, S: mixed });
    const map2: Cc3dLevel = { ...model2, cells: model2.cells.map((cell) => ({ ...cell, terrain: normalizeCell(cell.terrain) })) };
    expect(viewAt(map2, 2, 1).note).toEqual({ key: CC3D_CONNECTION_KEYS.buried });
  });

  it('says a cell holds no mechanism, and has no view outside the grid', () => {
    const map = level(MAPS.traps);
    expect(viewAt(map, 3, 1).caption).toMatchObject({ key: CONNECTIONS_KEYS.noDevice, name: null });
    expect(viewAt(map, 3, 1).controls?.empty).toEqual({ key: CONNECTIONS_KEYS.noneControls });
    for (const [x, y] of [[-1, 0], [0, -1], [99, 0], [0, 99]]) {
      expect(viewAt(map, x, y)).toEqual({ caption: null, controls: null, controlledBy: null, note: null, link: null });
    }
  });

  it('has no Unlink, no fallback row and no Link button anywhere', () => {
    for (const rows of Object.values(MAPS)) {
      const map = level(rows);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const view = viewAt(map, x, y);
          expect(view.link).toBeNull();
          for (const row of [...(view.controls?.rows ?? []), ...(view.controlledBy?.rows ?? [])]) {
            expect(row.unlink).toBeNull();
            expect(row.fallback).toBe(false);
          }
        }
      }
    }
  });

  it('shows exactly the arrows of the link overlay on every cell of every map and fixture', () => {
    const arrowSystems = ['trap', 'teleport', 'clone', 'template', 'laser'];
    const combined = level(['################', '#@b.c.z.Y.m.l.B.#', '#t.k.t.k.q.J.p.H#', '#1.3.4.2.U.b.c.#', '################']);
    const fixture = smallCc3dLevel().cc3d;
    const maps = [...Object.values(MAPS).map(level), combined, ...(fixture ? [fixture] : [])];
    for (const map of maps) {
      const links = cc3dLinks(map);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const view = viewAt(map, x, y);
          const fromRows = new Set<string>();
          // A pair on one cell (a template on its machine) is a badge in the overlay, not an arrow.
          const sameCell = (row: ConnectionRow): boolean => row.x === x && row.y === y;
          for (const row of view.controls?.rows ?? []) if (arrowSystems.includes(row.system) && !sameCell(row)) fromRows.add(`${row.system}:${x},${y}>${row.x},${row.y}`);
          for (const row of view.controlledBy?.rows ?? []) if (arrowSystems.includes(row.system) && !sameCell(row)) fromRows.add(`${row.system}:${row.x},${row.y}>${x},${y}`);
          const fromOverlay = new Set(
            linkOverlayFor(map, { x, y }, links)
              .arrows.filter((a) => ((a.from.x === x && a.from.y === y) || (a.to.x === x && a.to.y === y)) && !(a.from.x === a.to.x && a.from.y === a.to.y))
              .map((a) => `${a.kind}:${a.from.x},${a.from.y}>${a.to.x},${a.to.y}`)
          );
          expect([...fromRows].sort()).toEqual([...fromOverlay].sort());
        }
      }
    }
  });

  it('names every row and note in both locales', () => {
    const keys = new Set<string>(Object.values(CC3D_CONNECTION_KEYS));
    keys.add(CONNECTIONS_KEYS.needsPlate);
    keys.add(CONNECTIONS_KEYS.needsHoldDoor);
    for (const system of Object.keys(CC3D_SYSTEM_NAME_KEYS)) keys.add(systemNameKey(system as keyof typeof CC3D_SYSTEM_NAME_KEYS));
    for (const rows of Object.values(MAPS)) {
      const map = level(rows);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const view = viewAt(map, x, y);
          for (const row of [...(view.controls?.rows ?? []), ...(view.controlledBy?.rows ?? [])]) {
            keys.add(row.name.key);
            if (row.systemNameKey) keys.add(row.systemNameKey);
          }
          if (view.caption?.name) keys.add(view.caption.name.key);
        }
      }
    }
    for (const locale of [EN, FR]) {
      for (const key of keys) expect({ key, text: (resolveMessage(locale, key) ?? '').length > 0 }).toEqual({ key, text: true });
    }
  });
});
