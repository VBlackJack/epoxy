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
import { Ruleset } from '../core/types';
import { i18n } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { emptyCc3dRoom } from './cc3dRoom';
import { EditorMap } from './editorDocument';
import {
  LinkSession,
  nudgeMessages,
  partnerCandidates,
  sessionClick,
  sessionRoleAt,
  sessionSourceHolds,
  startLinkSession
} from './linkSession';

const EPOXY: Ruleset = 'epoxy';
const LYNX: Ruleset = 'lynx';

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
});

/** A bordered 9 x 9 map with one unlinked pair per system: brown (2,2) / trap (5,2), red (2,4) / cloner (5,4), trigger (2,6) / launcher (5,6). */
function pairs(): EditorMap {
  const terrain: string[][] = [];
  const items: (string | null)[][] = [];
  for (let y = 0; y < 9; y++) {
    terrain.push([]);
    items.push([]);
    for (let x = 0; x < 9; x++) {
      terrain[y].push(x === 0 || y === 0 || x === 8 || y === 8 ? 'wall' : 'floor');
      items[y].push(null);
    }
  }
  terrain[2][2] = 'button_brown';
  terrain[2][5] = 'trap';
  terrain[4][2] = 'button_red';
  terrain[4][5] = 'clone_machine';
  terrain[6][2] = 'shot_trigger';
  terrain[6][5] = 'shot_launcher_e';
  return { terrain, items, entities: [], trapLinks: [], cloneLinks: [], playerStart: { x: 1, y: 1, dir: 'S' } };
}

const brown: LinkSession = { system: 'trap', end: 'button', x: 2, y: 2 };
const trap: LinkSession = { system: 'trap', end: 'target', x: 5, y: 2 };
const red: LinkSession = { system: 'clone', end: 'button', x: 2, y: 4 };
const cloner: LinkSession = { system: 'clone', end: 'target', x: 5, y: 4 };
const trigger: LinkSession = { system: 'shot', end: 'button', x: 2, y: 6 };
const launcher: LinkSession = { system: 'shot', end: 'target', x: 5, y: 6 };

describe('sessionRoleAt', () => {
  it('reads the role of every device from its tile flags', () => {
    const map = pairs();
    expect(sessionRoleAt(map, 2, 2, EPOXY)).toEqual({ system: 'trap', end: 'button', blocked: false });
    expect(sessionRoleAt(map, 5, 2, EPOXY)).toEqual({ system: 'trap', end: 'target', blocked: false });
    expect(sessionRoleAt(map, 2, 4, EPOXY)).toEqual({ system: 'clone', end: 'button', blocked: false });
    expect(sessionRoleAt(map, 5, 4, EPOXY)).toEqual({ system: 'clone', end: 'target', blocked: false });
    expect(sessionRoleAt(map, 2, 6, EPOXY)).toEqual({ system: 'shot', end: 'button', blocked: false });
    expect(sessionRoleAt(map, 5, 6, EPOXY)).toEqual({ system: 'shot', end: 'target', blocked: false });
  });

  it('is null on a plain cell, outside the grid, and on a CC3D map', () => {
    const map = pairs();
    expect(sessionRoleAt(map, 3, 3, EPOXY)).toBeNull();
    expect(sessionRoleAt(map, 20, 3, EPOXY)).toBeNull();
    expect(sessionRoleAt({ ...map, cc3d: emptyCc3dRoom(5, 5) }, 2, 2, EPOXY)).toBeNull();
    expect(sessionRoleAt(map, 2, 2, 'cc3d')).toBeNull();
  });

  it('blocks a trap or clone device hidden under another tile, and allows a hidden shot device', () => {
    const map = pairs();
    map.terrain[2][5] = 'door_red';
    map.terrain[4][5] = 'door_red';
    map.terrain[6][5] = 'door_red';
    map.underlays = [
      { x: 5, y: 2, terrain: 'trap' },
      { x: 5, y: 4, terrain: 'clone_machine' },
      { x: 5, y: 6, terrain: 'shot_launcher_e' }
    ];
    expect(sessionRoleAt(map, 5, 2, EPOXY)).toEqual({ system: 'trap', end: 'target', blocked: true });
    expect(sessionRoleAt(map, 5, 4, EPOXY)).toEqual({ system: 'clone', end: 'target', blocked: true });
    expect(sessionRoleAt(map, 5, 6, EPOXY)).toEqual({ system: 'shot', end: 'target', blocked: false });
  });

  it('has no shot role in a Lynx level', () => {
    const map = pairs();
    expect(sessionRoleAt(map, 2, 6, LYNX)).toBeNull();
    expect(sessionRoleAt(map, 5, 6, LYNX)).toBeNull();
    expect(sessionRoleAt(map, 2, 2, LYNX)).toEqual({ system: 'trap', end: 'button', blocked: false });
  });
});

describe('partnerCandidates', () => {
  it('lists the opposite end and marks the linked ones, from both ends', () => {
    const map = pairs();
    map.terrain[3][5] = 'trap';
    map.trapLinks = [{ buttonX: 2, buttonY: 2, trapX: 5, trapY: 3 }];
    const forward = partnerCandidates(map, brown, EPOXY);
    expect(forward.candidates).toEqual([{ x: 5, y: 2 }, { x: 5, y: 3 }]);
    expect(forward.linked).toEqual([{ x: 5, y: 3 }]);
    const reverse = partnerCandidates(map, { system: 'trap', end: 'target', x: 5, y: 3 }, EPOXY);
    expect(reverse.candidates).toEqual([{ x: 2, y: 2 }]);
    expect(reverse.linked).toEqual([{ x: 2, y: 2 }]);
  });

  it('excludes a hidden trap, includes a hidden launcher, and offers no shot partner in Lynx', () => {
    const map = pairs();
    map.terrain[2][5] = 'door_red';
    map.terrain[6][5] = 'door_red';
    map.underlays = [{ x: 5, y: 2, terrain: 'trap' }, { x: 5, y: 6, terrain: 'shot_launcher_e' }];
    expect(partnerCandidates(map, brown, EPOXY).candidates).toEqual([]);
    expect(partnerCandidates(map, trigger, EPOXY).candidates).toEqual([{ x: 5, y: 6 }]);
    expect(partnerCandidates(map, trigger, LYNX).candidates).toEqual([]);
  });
});

describe('startLinkSession', () => {
  it('starts on a device and says what it does while unlinked', () => {
    const result = startLinkSession(pairs(), 2, 2, EPOXY);
    expect(result.session).toEqual(brown);
    expect(result.messages.map((m) => m.key)).toEqual(['editor.link.started.label', 'editor.link.fallback.trap_button.label']);
  });

  it('refuses a hidden device, an empty cell and a CC3D map', () => {
    const map = pairs();
    map.terrain[2][5] = 'door_red';
    map.underlays = [{ x: 5, y: 2, terrain: 'trap' }];
    expect(startLinkSession(map, 5, 2, EPOXY).messages[0].key).toBe('editor.link.refused.hidden.label');
    expect(startLinkSession(map, 3, 3, EPOXY).messages[0].key).toBe('editor.link.nothing.label');
    expect(startLinkSession({ ...map, cc3d: emptyCc3dRoom(5, 5) }, 2, 2, EPOXY).session).toBeNull();
  });
});

describe('sessionClick: linking an existing partner, both ways, for every system', () => {
  const cases: Array<[string, LinkSession, LinkSession]> = [
    ['trap', brown, trap],
    ['clone', red, cloner],
    ['shot', trigger, launcher]
  ];
  for (const [name, button, target] of cases) {
    it(`links and unlinks the ${name} pair from the button`, () => {
      const map = pairs();
      const linked = sessionClick(map, button, target, 'S', EPOXY);
      expect(linked.map).toBeDefined();
      expect(linked.session).toEqual(button);
      expect(linked.messages[0].key).toBe('editor.link.linked.label');
      expect(linked.messages[0].params?.count).toBe(1);
      expect(linked.map?.terrain).toEqual(map.terrain);
      const unlinked = sessionClick(linked.map!, button, target, 'S', EPOXY);
      expect(unlinked.messages[0].key).toBe('editor.link.unlinked.label');
      expect(unlinked.messages[0].params?.count).toBe(0);
    });

    it(`links and unlinks the ${name} pair from the target`, () => {
      const linked = sessionClick(pairs(), target, button, 'S', EPOXY);
      expect(linked.messages[0].key).toBe('editor.link.linked.label');
      expect(linked.session).toEqual(target);
      const unlinked = sessionClick(linked.map!, target, button, 'S', EPOXY);
      expect(unlinked.messages[0].key).toBe('editor.link.unlinked.label');
    });
  }

  it('links a trap that is hidden for the shot system only when the launcher is hidden', () => {
    const map = pairs();
    map.terrain[6][5] = 'door_red';
    map.underlays = [{ x: 5, y: 6, terrain: 'shot_launcher_e' }];
    const result = sessionClick(map, trigger, { x: 5, y: 6 }, 'S', EPOXY);
    expect(result.map?.launcherLinks).toHaveLength(1);
  });

  it('warns when a clone link lands on a cloner with no creature', () => {
    const result = sessionClick(pairs(), red, cloner, 'W', EPOXY);
    expect(result.messages.map((m) => m.key)).toEqual(['editor.link.linked.label', 'editor.layout.status.wire_empty_cloner.label']);
    expect(result.map?.cloneLinks[0]).toMatchObject({ templateType: 'dirt_block', templateDir: 'W' });
  });
});

describe('sessionClick: decision order', () => {
  it('ends the session on the source and reports the link count', () => {
    const result = sessionClick(pairs(), brown, brown, 'S', EPOXY);
    expect(result.session).toBeNull();
    expect(result.map).toBeUndefined();
    expect(result.messages[0].key).toBe('editor.link.done.label');
  });

  it('switches the source on a device of the same role without editing', () => {
    const map = pairs();
    map.terrain[3][3] = 'button_brown';
    const result = sessionClick(map, brown, { x: 3, y: 3 }, 'S', EPOXY);
    expect(result.session).toEqual({ system: 'trap', end: 'button', x: 3, y: 3 });
    expect(result.map).toBeUndefined();
    expect(result.messages[0].key).toBe('editor.link.started.label');
  });

  it('refuses a hidden trap or clone partner, naming its role', () => {
    const map = pairs();
    map.terrain[2][5] = 'door_red';
    map.underlays = [{ x: 5, y: 2, terrain: 'trap' }];
    const result = sessionClick(map, brown, { x: 5, y: 2 }, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.session).toEqual(brown);
    expect(result.messages[0].key).toBe('editor.link.refused.hidden.label');
    expect(result.messages[0].params?.role).toBe('Trap');
  });

  it('places the partner on a free floor cell as one edit, from the button and from the target', () => {
    const map = pairs();
    const placed = sessionClick(map, brown, { x: 3, y: 3 }, 'S', EPOXY);
    expect(placed.map?.terrain[3][3]).toBe('trap');
    expect(placed.map?.trapLinks).toEqual([{ buttonX: 2, buttonY: 2, trapX: 3, trapY: 3 }]);
    expect(placed.messages[0].key).toBe('editor.link.placed.label');
    const reverse = sessionClick(map, trap, { x: 3, y: 3 }, 'S', EPOXY);
    expect(reverse.map?.terrain[3][3]).toBe('button_brown');
    expect(reverse.map?.trapLinks).toEqual([{ buttonX: 3, buttonY: 3, trapX: 5, trapY: 2 }]);
    const launcherPlaced = sessionClick(map, trigger, { x: 3, y: 7 }, 'N', EPOXY);
    expect(launcherPlaced.map?.terrain[7][3]).toBe('shot_launcher_n');
    const triggerPlaced = sessionClick(map, launcher, { x: 3, y: 3 }, 'N', EPOXY);
    expect(triggerPlaced.map?.terrain[3][3]).toBe('shot_trigger');
    const clonerPlaced = sessionClick(map, red, { x: 3, y: 3 }, 'E', EPOXY);
    expect(clonerPlaced.map?.terrain[3][3]).toBe('clone_machine');
    expect(clonerPlaced.messages[1].key).toBe('editor.layout.status.wire_empty_cloner.label');
    const redPlaced = sessionClick(map, cloner, { x: 3, y: 3 }, 'E', EPOXY);
    expect(redPlaced.map?.terrain[3][3]).toBe('button_red');
  });

  it('refuses a floor cell that hides terrain', () => {
    const map = pairs();
    map.underlays = [{ x: 3, y: 3, terrain: 'ice' }];
    const result = sessionClick(map, brown, { x: 3, y: 3 }, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.messages[0].key).toBe('editor.link.refused.not_free.label');
  });

  it('refuses anything else without repainting, naming what is there and what is expected', () => {
    const map = pairs();
    const snapshot = JSON.stringify(map);
    for (const cell of [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 5, y: 4 }, { x: 2, y: 6 }]) {
      const result = sessionClick(map, brown, cell, 'S', EPOXY);
      expect(result.map).toBeUndefined();
      expect(result.session).toEqual(brown);
      expect(result.messages[0].key).toBe('editor.link.refused.other.label');
      expect(result.messages[0].params?.expected).toBe('Trap');
    }
    expect(JSON.stringify(map)).toBe(snapshot);
    expect(sessionClick(map, brown, { x: 0, y: 0 }, 'S', EPOXY).messages[0].params?.found).toBe('Wall');
  });

  it('ends the session when the source no longer holds its role', () => {
    const map = pairs();
    map.terrain[2][2] = 'floor';
    expect(sessionSourceHolds(map, brown, EPOXY)).toBe(false);
    const result = sessionClick(map, brown, { x: 3, y: 3 }, 'S', EPOXY);
    expect(result.session).toBeNull();
    expect(result.map).toBeUndefined();
    expect(result.messages[0].key).toBe('editor.link.source_gone.label');
  });

  it('ends the session on a CC3D map', () => {
    const result = sessionClick({ ...pairs(), cc3d: emptyCc3dRoom(5, 5) }, brown, { x: 5, y: 2 }, 'S', EPOXY);
    expect(result.session).toBeNull();
    expect(result.messages[0].key).toBe('editor.link.unavailable.label');
  });

  it('keeps the session and says nothing for a click outside the grid', () => {
    const result = sessionClick(pairs(), brown, { x: 30, y: 2 }, 'S', EPOXY);
    expect(result.session).toEqual(brown);
    expect(result.messages).toEqual([]);
  });
});

describe('sessionClick: Lynx keeps one link per button', () => {
  it('replaces the button link when linking a second trap', () => {
    const map = pairs();
    map.terrain[3][5] = 'trap';
    const first = sessionClick(map, brown, { x: 5, y: 2 }, 'S', LYNX);
    expect(first.messages.map((m) => m.key)).toEqual(['editor.link.linked.label']);
    const second = sessionClick(first.map!, brown, { x: 5, y: 3 }, 'S', LYNX);
    expect(second.map?.trapLinks).toEqual([{ buttonX: 2, buttonY: 2, trapX: 5, trapY: 3 }]);
    expect(second.messages.map((m) => m.key)).toEqual(['editor.link.linked.label', 'editor.link.replaced.label']);
  });

  it('unlinks an existing pair', () => {
    const linked = sessionClick(pairs(), brown, { x: 5, y: 2 }, 'S', LYNX).map!;
    const result = sessionClick(linked, brown, { x: 5, y: 2 }, 'S', LYNX);
    expect(result.map?.trapLinks).toEqual([]);
    expect(result.messages[0].key).toBe('editor.link.unlinked.label');
  });

  it('re-points a button that already has a link when linking from a target', () => {
    const map = pairs();
    map.terrain[3][5] = 'trap';
    const linked = sessionClick(map, brown, { x: 5, y: 2 }, 'S', LYNX).map!;
    const result = sessionClick(linked, { system: 'trap', end: 'target', x: 5, y: 3 }, { x: 2, y: 2 }, 'S', LYNX);
    expect(result.map?.trapLinks).toEqual([{ buttonX: 2, buttonY: 2, trapX: 5, trapY: 3 }]);
    expect(result.messages.map((m) => m.key)).toContain('editor.link.replaced.label');
  });

  it('places a clone machine and replaces the old link of the red button', () => {
    const linked = sessionClick(pairs(), red, cloner, 'S', LYNX).map!;
    const result = sessionClick(linked, red, { x: 3, y: 3 }, 'S', LYNX);
    expect(result.map?.cloneLinks).toHaveLength(1);
    expect(result.map?.cloneLinks[0]).toMatchObject({ clonerX: 3, clonerY: 3 });
    expect(result.messages.map((m) => m.key)).toContain('editor.link.replaced.label');
  });

  it('says what an unlinked device does under Lynx, with the Lynx wording and not the Epoxy one', () => {
    const cases: Array<[number, number, string]> = [
      [2, 2, 'trap_button'],
      [5, 2, 'trap'],
      [2, 4, 'clone_button'],
      [5, 4, 'clone_machine']
    ];
    for (const [x, y, id] of cases) {
      expect(startLinkSession(pairs(), x, y, LYNX).messages.map((m) => m.key)).toEqual([
        'editor.link.started.label',
        `editor.link.fallback_lynx.${id}.label`
      ]);
      expect(startLinkSession(pairs(), x, y, EPOXY).messages[1].key).toBe(`editor.link.fallback.${id}.label`);
    }
  });

  it('gives the Lynx fallback wording in both locales', () => {
    for (const locale of ['en', 'fr'] as const) {
      i18n.setLocale(locale);
      for (const id of ['trap_button', 'trap', 'clone_button', 'clone_machine']) {
        const key = `editor.link.fallback_lynx.${id}.label`;
        expect(i18n.t(key), `${locale} ${key}`).not.toBe(key);
      }
    }
    i18n.setLocale('en');
  });

  it('keeps the Lynx wording when the session switches to another device', () => {
    const map = pairs();
    map.terrain[3][3] = 'button_brown';
    const result = sessionClick(map, brown, { x: 3, y: 3 }, 'S', LYNX);
    expect(result.messages.map((m) => m.key)).toEqual(['editor.link.started.label', 'editor.link.fallback_lynx.trap_button.label']);
  });

  it('warns about an empty clone machine under Epoxy rules only', () => {
    const epoxy = sessionClick(pairs(), red, cloner, 'S', EPOXY);
    expect(epoxy.messages.length).toBeGreaterThan(1);
    const lynx = sessionClick(pairs(), red, cloner, 'S', LYNX);
    expect(lynx.messages.map((m) => m.key)).toEqual(['editor.link.linked.label']);
  });

  it('refuses shot devices: the click names the cell as not linkable', () => {
    const result = sessionClick(pairs(), brown, { x: 2, y: 6 }, 'S', LYNX);
    expect(result.map).toBeUndefined();
    expect(result.messages[0].key).toBe('editor.link.refused.other.label');
  });
});

describe('signal sessions', () => {
  const PLATE = { x: 1, y: 1 };
  const AND = { x: 3, y: 1 };
  const OR = { x: 5, y: 1 };
  const DOOR = { x: 7, y: 1 };
  const plateSession: LinkSession = { system: 'signal', end: 'button', x: PLATE.x, y: PLATE.y };
  const doorSession: LinkSession = { system: 'signal', end: 'target', x: DOOR.x, y: DOOR.y };

  /** A bordered 9 x 5 map with a plate, an AND gate, an OR gate and a hold door in a row. */
  function wires(): EditorMap {
    const map = pairs();
    map.terrain = map.terrain.slice(0, 5).map((row) => row.map(() => 'floor'));
    map.items = map.items.slice(0, 5);
    map.terrain[1][1] = 'signal_plate';
    map.terrain[1][3] = 'signal_gate_and';
    map.terrain[1][5] = 'signal_gate_or';
    map.terrain[1][7] = 'hold_door_red_closed';
    return map;
  }

  it('reads the plate and the gate as outputs and the hold door as an input', () => {
    const map = wires();
    expect(sessionRoleAt(map, PLATE.x, PLATE.y, EPOXY)).toEqual({ system: 'signal', end: 'button', blocked: false });
    expect(sessionRoleAt(map, AND.x, AND.y, EPOXY)).toEqual({ system: 'signal', end: 'button', blocked: false });
    expect(sessionRoleAt(map, DOOR.x, DOOR.y, EPOXY)).toEqual({ system: 'signal', end: 'target', blocked: false });
  });

  it('starts on a plate and offers the gates and doors as partners', () => {
    const map = wires();
    const started = startLinkSession(map, PLATE.x, PLATE.y, EPOXY);
    expect(started.session).toEqual(plateSession);
    expect(started.messages.map((m) => m.key)).toEqual(['editor.link.started_signal.label', 'editor.link.fallback.signal_out.label']);
    expect(partnerCandidates(map, plateSession, EPOXY).candidates).toEqual([AND, OR, DOOR]);
  });

  it('links a plate to an AND gate, the AND gate to a door, and keeps the session open', () => {
    let map = wires();
    const first = sessionClick(map, plateSession, AND, 'S', EPOXY);
    expect(first.session).toEqual(plateSession);
    expect(first.map?.signalLinks).toEqual([{ fromX: 1, fromY: 1, toX: 3, toY: 1 }]);
    expect(first.messages.map((m) => m.key)).toEqual(['editor.link.linked.label']);
    map = first.map as EditorMap;
    const gateSession = startLinkSession(map, AND.x, AND.y, EPOXY).session as LinkSession;
    expect(gateSession).toEqual({ system: 'signal', end: 'button', x: AND.x, y: AND.y });
    const second = sessionClick(map, gateSession, DOOR, 'S', EPOXY);
    expect(second.map?.signalLinks).toEqual([
      { fromX: 1, fromY: 1, toX: 3, toY: 1 },
      { fromX: 3, fromY: 1, toX: 7, toY: 1 }
    ]);
    expect(second.map?.terrain).toEqual(map.terrain);
    expect(second.session).toEqual(gateSession);
  });

  it('unlinks a wire by clicking its partner again', () => {
    const linked = sessionClick(wires(), plateSession, AND, 'S', EPOXY).map as EditorMap;
    const again = sessionClick(linked, plateSession, AND, 'S', EPOXY);
    expect(again.map?.signalLinks).toBeUndefined();
    expect(again.messages.map((m) => m.key)).toEqual(['editor.link.unlinked.label']);
  });

  it('lets a gate be linked into: a gate clicked from a gate session is a partner, not a new source', () => {
    const map = wires();
    const result = sessionClick(map, { system: 'signal', end: 'button', x: AND.x, y: AND.y }, OR, 'S', EPOXY);
    expect(result.map?.signalLinks).toEqual([{ fromX: 3, fromY: 1, toX: 5, toY: 1 }]);
    expect(result.session).toEqual({ system: 'signal', end: 'button', x: AND.x, y: AND.y });
  });

  it('switches the source when another source is clicked', () => {
    const map = wires();
    map.terrain[3][1] = 'signal_plate';
    const result = sessionClick(map, plateSession, { x: 1, y: 3 }, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.session).toEqual({ system: 'signal', end: 'button', x: 1, y: 3 });
  });

  it('starts on a hold door as the input end and links from sources and gates', () => {
    const map = wires();
    const started = startLinkSession(map, DOOR.x, DOOR.y, EPOXY);
    expect(started.session).toEqual(doorSession);
    expect(started.messages.map((m) => m.key)).toEqual(['editor.link.started_signal.label', 'editor.link.fallback.signal_in.label']);
    expect(partnerCandidates(map, doorSession, EPOXY).candidates).toEqual([PLATE, AND, OR]);
    const fromGate = sessionClick(map, doorSession, OR, 'S', EPOXY);
    expect(fromGate.map?.signalLinks).toEqual([{ fromX: 5, fromY: 1, toX: 7, toY: 1 }]);
    expect(fromGate.session).toEqual(doorSession);
  });

  it('refuses a click that would close a cycle with a message, editing nothing', () => {
    let map = sessionClick(wires(), plateSession, AND, 'S', EPOXY).map as EditorMap;
    map = sessionClick(map, { system: 'signal', end: 'button', x: AND.x, y: AND.y }, OR, 'S', EPOXY).map as EditorMap;
    const orSession: LinkSession = { system: 'signal', end: 'button', x: OR.x, y: OR.y };
    const result = sessionClick(map, orSession, AND, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.session).toEqual(orSession);
    expect(result.messages).toEqual([{ key: 'editor.link.refused.cycle.label', params: { x: AND.x, y: AND.y } }]);
    expect(i18n.t('editor.link.refused.cycle.label', { x: 3, y: 1 })).not.toBe('editor.link.refused.cycle.label');
  });

  it('places no partner on a free floor cell', () => {
    const result = sessionClick(wires(), plateSession, { x: 2, y: 3 }, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.session).toEqual(plateSession);
  });

  it('ends when its source is gone', () => {
    const map = wires();
    map.terrain[1][1] = 'floor';
    const result = sessionClick(map, plateSession, AND, 'S', EPOXY);
    expect(result.session).toBeNull();
    expect(result.messages[0].key).toBe('editor.link.source_gone.label');
  });

  it('refuses a hidden signal device and offers nothing under Lynx rules', () => {
    const map = wires();
    map.terrain[1][3] = 'door_red';
    map.underlays = [{ x: 3, y: 1, terrain: 'signal_gate_and' }];
    expect(startLinkSession(map, AND.x, AND.y, EPOXY).messages[0].key).toBe('editor.link.refused.hidden.label');
    expect(sessionClick(map, plateSession, AND, 'S', EPOXY).messages[0].key).toBe('editor.link.refused.hidden.label');
    expect(sessionRoleAt(wires(), PLATE.x, PLATE.y, LYNX)).toBeNull();
    expect(startLinkSession(wires(), PLATE.x, PLATE.y, LYNX)).toEqual({ session: null, messages: [{ key: 'editor.palette.unavailable.epoxy_only.label' }] });
    expect(partnerCandidates(wires(), plateSession, LYNX).candidates).toEqual([]);
    expect(sessionSourceHolds(wires(), plateSession, LYNX)).toBe(false);
    const lynxClick = sessionClick(wires(), plateSession, AND, 'S', LYNX);
    expect(lynxClick.map).toBeUndefined();
    expect(lynxClick.session).toBeNull();
  });

  it('has its labels in both languages', () => {
    for (const locale of ['en', 'fr'] as const) {
      i18n.setLocale(locale);
      for (const id of ['signal_out', 'signal_in', 'signal_source', 'signal_gate']) {
        const key = `editor.connections.role.${id}.label`;
        expect(i18n.t(key), `${locale} ${key}`).not.toBe(key);
      }
      for (const id of ['signal_out', 'signal_in']) {
        const key = `editor.link.fallback.${id}.label`;
        expect(i18n.t(key), `${locale} ${key}`).not.toBe(key);
      }
    }
    i18n.setLocale('en');
  });
});

describe('signal sessions: edge sinks', () => {
  /** A bordered 9 x 9 map with a pulse button, a shot launcher, a clone machine and a hold door in a row. */
  function sinks(): EditorMap {
    const map = pairs();
    map.terrain[4][5] = 'floor';
    map.terrain[6][5] = 'floor';
    map.terrain[1][1] = 'signal_button';
    map.terrain[1][3] = 'shot_launcher_e';
    map.terrain[1][5] = 'clone_machine';
    map.terrain[1][7] = 'hold_door_red_closed';
    return map;
  }
  const button: LinkSession = { system: 'signal', end: 'button', x: 1, y: 1 };

  it('offers the launcher and the clone machine as partners of a signal output', () => {
    const { candidates } = partnerCandidates(sinks(), button, EPOXY);
    expect(candidates).toEqual(expect.arrayContaining([{ x: 3, y: 1 }, { x: 5, y: 1 }, { x: 7, y: 1 }]));
  });

  it('links and unlinks a signal button to a launcher and to a clone machine by clicking them', () => {
    let map = sinks();
    for (const target of [{ x: 3, y: 1 }, { x: 5, y: 1 }]) {
      const result = sessionClick(map, button, target, 'S', EPOXY);
      expect(result.map, `${target.x}`).toBeDefined();
      expect(result.session).toEqual(button);
      map = result.map as EditorMap;
    }
    expect(map.signalLinks).toEqual([
      { fromX: 1, fromY: 1, toX: 3, toY: 1 },
      { fromX: 1, fromY: 1, toX: 5, toY: 1 }
    ]);
    expect(map.launcherLinks ?? []).toEqual([]);
    expect(map.cloneLinks).toEqual([]);
    const again = sessionClick(map, button, { x: 3, y: 1 }, 'S', EPOXY);
    expect(again.map?.signalLinks).toEqual([{ fromX: 1, fromY: 1, toX: 5, toY: 1 }]);
  });

  it('refuses a second signal into a launcher with the single-input message', () => {
    const map = sinks();
    map.terrain[2][1] = 'signal_button';
    const first = sessionClick(map, button, { x: 3, y: 1 }, 'S', EPOXY).map as EditorMap;
    const second: LinkSession = { system: 'signal', end: 'button', x: 1, y: 2 };
    const result = sessionClick(first, second, { x: 3, y: 1 }, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.messages).toEqual([{ key: 'editor.link.refused.single_input.label', params: { x: 3, y: 1 } }]);
  });

  it('keeps the launcher as a shot device when a session starts on it', () => {
    expect(sessionRoleAt(sinks(), 3, 1, EPOXY)).toEqual({ system: 'shot', end: 'target', blocked: false });
  });
});

describe('signal sessions: wording and single inputs', () => {
  function row(): EditorMap {
    const map = pairs();
    map.terrain[1][1] = 'signal_plate';
    map.terrain[2][1] = 'signal_plate';
    map.terrain[1][3] = 'hold_door_red_closed';
    map.terrain[1][5] = 'laser_receiver_red';
    map.terrain[1][7] = 'signal_gate_and';
    return map;
  }
  const plate: LinkSession = { system: 'signal', end: 'button', x: 1, y: 1 };

  it('refuses a second signal into a hold door with the single-input message', () => {
    const first = sessionClick(row(), plate, { x: 3, y: 1 }, 'S', EPOXY).map as EditorMap;
    const second: LinkSession = { system: 'signal', end: 'button', x: 1, y: 2 };
    const result = sessionClick(first, second, { x: 3, y: 1 }, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.messages).toEqual([{ key: 'editor.link.refused.single_input.label', params: { x: 3, y: 1 } }]);
  });

  it('uses its own started and refusal wording, which never offers to place a partner', () => {
    const started = startLinkSession(row(), 1, 1, EPOXY);
    expect(started.messages[0].key).toBe('editor.link.started_signal.label');
    const refused = sessionClick(row(), plate, { x: 0, y: 0 }, 'S', EPOXY);
    expect(refused.messages[0].key).toBe('editor.link.refused.other_signal.label');
    for (const locale of ['en', 'fr'] as const) {
      i18n.setLocale(locale);
      for (const key of ['editor.link.started_signal.label', 'editor.link.refused.other_signal.label', 'editor.link.refused.single_input.label']) {
        expect(i18n.t(key), `${locale} ${key}`).not.toBe(key);
      }
    }
    i18n.setLocale('en');
  });

  it('gives no placement nudge to a hold door or a laser receiver, but one to a plate and a gate', () => {
    const map = row();
    expect(nudgeMessages(map, 3, 1, EPOXY)).toEqual([]);
    expect(nudgeMessages(map, 5, 1, EPOXY)).toEqual([]);
    expect(nudgeMessages(map, 1, 1, EPOXY)).not.toEqual([]);
    expect(nudgeMessages(map, 7, 1, EPOXY)).not.toEqual([]);
  });
});

describe('signal sessions started from a launcher or a clone machine', () => {
  const PLATE = { x: 3, y: 3 };
  const GATE = { x: 6, y: 3 };
  const LAUNCHER = { x: 5, y: 6 };
  const CLONER = { x: 5, y: 4 };
  const launcherSignal: LinkSession = { system: 'signal', end: 'target', x: LAUNCHER.x, y: LAUNCHER.y };
  const clonerSignal: LinkSession = { system: 'signal', end: 'target', x: CLONER.x, y: CLONER.y };

  function sinks(): EditorMap {
    const map = pairs();
    map.terrain[PLATE.y][PLATE.x] = 'signal_plate';
    map.terrain[GATE.y][GATE.x] = 'signal_gate_and';
    return map;
  }

  it('keeps starting a shot or clone session by default', () => {
    const map = sinks();
    expect(startLinkSession(map, LAUNCHER.x, LAUNCHER.y, EPOXY).session).toEqual(launcher);
    expect(startLinkSession(map, CLONER.x, CLONER.y, EPOXY).session).toEqual(cloner);
  });

  it('starts a signal session on a launcher and on a clone machine', () => {
    const map = sinks();
    const fromLauncher = startLinkSession(map, LAUNCHER.x, LAUNCHER.y, EPOXY, 'signal');
    expect(fromLauncher.session).toEqual(launcherSignal);
    expect(fromLauncher.messages.map((m) => m.key)).toEqual(['editor.link.started_signal.label', 'editor.link.fallback.signal_in.label']);
    expect(startLinkSession(map, CLONER.x, CLONER.y, EPOXY, 'signal').session).toEqual(clonerSignal);
    expect(sessionSourceHolds(map, launcherSignal, EPOXY)).toBe(true);
    expect(partnerCandidates(map, launcherSignal, EPOXY).candidates).toEqual([PLATE, GATE]);
  });

  it('refuses a signal session on a device with no signal input, in Lynx and on CC3D', () => {
    const map = sinks();
    expect(startLinkSession(map, 2, 2, EPOXY, 'signal').messages.map((m) => m.key)).toEqual(['editor.link.nothing.label']);
    expect(startLinkSession(map, CLONER.x, CLONER.y, LYNX, 'signal').session).toBeNull();
    expect(startLinkSession({ ...map, cc3d: emptyCc3dRoom(5, 5) }, CLONER.x, CLONER.y, EPOXY, 'signal').messages.map((m) => m.key)).toEqual(['editor.link.unavailable.label']);
  });

  it('links a source and a gate to a launcher and a clone machine, and unlinks on a second click', () => {
    const map = sinks();
    const plate = sessionClick(map, launcherSignal, PLATE, 'S', EPOXY);
    expect(plate.map?.signalLinks).toEqual([{ fromX: 3, fromY: 3, toX: 5, toY: 6 }]);
    expect(plate.session).toEqual(launcherSignal);
    expect(plate.map?.launcherLinks ?? []).toEqual([]);
    const gate = sessionClick(map, clonerSignal, GATE, 'S', EPOXY);
    expect(gate.map?.signalLinks).toEqual([{ fromX: 6, fromY: 3, toX: 5, toY: 4 }]);
    expect(gate.map?.cloneLinks).toEqual([]);
    const again = sessionClick(plate.map as EditorMap, launcherSignal, PLATE, 'S', EPOXY);
    expect(again.map?.signalLinks).toBeUndefined();
  });

  it('refuses a second input on a sink that already has one, editing nothing', () => {
    const linked = sessionClick(sinks(), launcherSignal, PLATE, 'S', EPOXY).map as EditorMap;
    const result = sessionClick(linked, launcherSignal, GATE, 'S', EPOXY);
    expect(result.map).toBeUndefined();
    expect(result.messages.map((m) => m.key)).toEqual(['editor.link.refused.single_input.label']);
  });

  it('moves to another sink when one is clicked, and refuses a click on a non-signal cell', () => {
    const map = sinks();
    const moved = sessionClick(map, launcherSignal, CLONER, 'S', EPOXY);
    expect(moved.map).toBeUndefined();
    expect(moved.session).toEqual(clonerSignal);
    const refused = sessionClick(map, launcherSignal, { x: 2, y: 2 }, 'S', EPOXY);
    expect(refused.map).toBeUndefined();
    expect(refused.messages.map((m) => m.key)).toEqual(['editor.link.refused.other_signal.label']);
  });

  it('leaves shot and clone sessions unchanged: a click on a plate is still refused', () => {
    const map = sinks();
    expect(sessionClick(map, launcher, PLATE, 'S', EPOXY).map).toBeUndefined();
    expect(sessionClick(map, cloner, PLATE, 'S', EPOXY).map).toBeUndefined();
    expect(sessionClick(map, launcher, { x: 2, y: 6 }, 'S', EPOXY).map?.launcherLinks).toHaveLength(1);
  });
});
