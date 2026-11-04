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
