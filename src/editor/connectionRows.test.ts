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
import type { CompiledLevel } from '../core/types';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { resolveMessage, type TranslationNode } from '../i18n/messageFormat';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { EDITOR_CONNECTIONS_MAX_ROWS } from '../ui/uiConstants';
import {
  CHANNEL_NAME_KEYS,
  CONNECTIONS_KEYS,
  KIND_NAME_KEYS,
  ROLE_NAME_KEYS,
  SYSTEM_NAME_KEYS,
  connectionCellName,
  connectionRows
} from './connectionRows';

const WIDTH = 14;
const HEIGHT = 10;

interface Extra {
  items?: Record<string, string>;
  entities?: Array<{ x: number; y: number; type: string }>;
  underlays?: Array<{ x: number; y: number; terrain: string }>;
  trapLinks?: CompiledLevel['trapLinks'];
  cloneLinks?: CompiledLevel['cloneLinks'];
  launcherLinks?: CompiledLevel['launcherLinks'];
  ruleset?: CompiledLevel['ruleset'];
}

/** A floor level with the given terrain at "x,y" keys. */
function makeLevel(terrain: Record<string, string>, extra: Extra = {}): CompiledLevel {
  const items = Array.from({ length: HEIGHT }, () => Array<string | null>(WIDTH).fill(null));
  for (const [key, id] of Object.entries(extra.items ?? {})) {
    const [x, y] = key.split(',').map(Number);
    items[y][x] = id;
  }
  return {
    id: 'connection_rows_test',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: 0, y: 0, dir: 'S' },
    terrain: Array.from({ length: HEIGHT }, (_, y) => Array.from({ length: WIDTH }, (_, x) => terrain[`${x},${y}`] ?? 'floor')),
    items,
    entities: (extra.entities ?? []).map((e) => ({ ...e, dir: 'S' as const })),
    trapLinks: extra.trapLinks ?? [],
    cloneLinks: extra.cloneLinks ?? [],
    ...(extra.launcherLinks ? { launcherLinks: extra.launcherLinks } : {}),
    ...(extra.underlays ? { underlays: extra.underlays } : {}),
    ...(extra.ruleset ? { ruleset: extra.ruleset } : {})
  };
}

const cloneLink = (buttonX: number, buttonY: number, clonerX: number, clonerY: number): CompiledLevel['cloneLinks'][number] => ({
  buttonX,
  buttonY,
  clonerX,
  clonerY,
  templateType: 'dirt_block',
  templateDir: 'N'
});

beforeEach(() => {
  loadTestConfigs();
});

describe('connectionRows', () => {
  it('lists the traps of a brown button, the linked one with an Unlink and the unlinked one as a fallback', () => {
    const level = makeLevel(
      { '1,1': 'button_brown', '4,1': 'trap', '6,1': 'trap' },
      { trapLinks: [{ buttonX: 1, buttonY: 1, trapX: 4, trapY: 1 }] }
    );
    const view = connectionRows(level, 1, 1);
    expect(view.caption).toEqual({ key: CONNECTIONS_KEYS.cell, x: 1, y: 1, name: { key: ROLE_NAME_KEYS.trap_button } });
    expect(view.controls?.rows).toEqual([
      {
        x: 4,
        y: 1,
        kind: 'link',
        system: 'trap',
        fallback: false,
        name: { key: ROLE_NAME_KEYS.trap },
        unlink: { system: 'trap', button: { x: 1, y: 1 }, target: { x: 4, y: 1 } }
      },
      { x: 6, y: 1, kind: 'level', system: 'trap', fallback: true, name: { key: ROLE_NAME_KEYS.trap }, unlink: null }
    ]);
    expect(view.controlledBy?.rows).toEqual([]);
    expect(view.controlledBy?.empty).toEqual({ key: CONNECTIONS_KEYS.noneControlled });
    expect(view.note).toEqual({ key: CONNECTIONS_KEYS.fallbackTrapButton });
    expect(view.link).toEqual({ type: 'start', system: 'trap', end: 'button', blocked: false });
  });

  it('tells a linked trap from an unlinked one, and unlinks from the button end', () => {
    const linked = makeLevel(
      { '1,1': 'button_brown', '2,1': 'button_brown', '4,1': 'trap' },
      { trapLinks: [{ buttonX: 1, buttonY: 1, trapX: 4, trapY: 1 }] }
    );
    const view = connectionRows(linked, 4, 1);
    expect(view.controlledBy?.rows.map((r) => [r.x, r.y, r.kind])).toEqual([[1, 1, 'link']]);
    expect(view.controlledBy?.rows[0].unlink).toEqual({ system: 'trap', button: { x: 1, y: 1 }, target: { x: 4, y: 1 } });
    expect(view.note).toEqual({ key: CONNECTIONS_KEYS.fallbackTrapLinked });
    expect(view.link).toEqual({ type: 'start', system: 'trap', end: 'target', blocked: false });

    const unlinked = connectionRows(makeLevel({ '1,1': 'button_brown', '2,1': 'button_brown', '4,1': 'trap' }), 4, 1);
    expect(unlinked.controlledBy?.rows.map((r) => [r.x, r.y, r.fallback])).toEqual([
      [1, 1, true],
      [2, 1, true]
    ]);
    expect(unlinked.controlledBy?.rows.every((r) => r.unlink === null)).toBe(true);
    expect(unlinked.note).toEqual({ key: CONNECTIONS_KEYS.fallbackTrapUnlinked });
  });

  it('spells out the red button fallback: every machine with a creature, or nothing', () => {
    const base = { '1,1': 'button_red', '4,1': 'clone_machine' };
    const withCreature = connectionRows(makeLevel(base, { entities: [{ x: 4, y: 1, type: 'walker' }] }), 1, 1);
    expect(withCreature.controls?.rows.map((r) => [r.x, r.y, r.fallback])).toEqual([[4, 1, true]]);
    expect(withCreature.note).toEqual({ key: CONNECTIONS_KEYS.fallbackCloneAny });
    expect(withCreature.link).toEqual({ type: 'start', system: 'clone', end: 'button', blocked: false });

    const empty = connectionRows(makeLevel(base), 1, 1);
    expect(empty.controls?.rows).toEqual([]);
    expect(empty.controls?.empty).toEqual({ key: CONNECTIONS_KEYS.noneControls });
    expect(empty.note).toEqual({ key: CONNECTIONS_KEYS.fallbackCloneNone });

    const linked = connectionRows(makeLevel(base, { cloneLinks: [cloneLink(1, 1, 4, 1)] }), 1, 1);
    expect(linked.controls?.rows[0].unlink).toEqual({ system: 'clone', button: { x: 1, y: 1 }, target: { x: 4, y: 1 } });
    expect(linked.note).toBeNull();
  });

  it('handles the shot trigger: no link fires nothing, a link unlinks from either end', () => {
    const base = { '1,1': 'shot_trigger', '4,1': 'shot_launcher_n' };
    const bare = connectionRows(makeLevel(base), 1, 1);
    expect(bare.note).toEqual({ key: CONNECTIONS_KEYS.fallbackShotUnlinked });
    expect(bare.link).toEqual({ type: 'start', system: 'shot', end: 'button', blocked: false });

    const level = makeLevel(base, { launcherLinks: [{ buttonX: 1, buttonY: 1, launcherX: 4, launcherY: 1 }] });
    const trigger = connectionRows(level, 1, 1);
    expect(trigger.note).toBeNull();
    expect(trigger.controls?.rows[0].unlink).toEqual({ system: 'shot', button: { x: 1, y: 1 }, target: { x: 4, y: 1 } });
    const launcher = connectionRows(level, 4, 1);
    expect(launcher.controlledBy?.rows[0].unlink).toEqual({ system: 'shot', button: { x: 1, y: 1 }, target: { x: 4, y: 1 } });
    expect(launcher.link).toEqual({ type: 'start', system: 'shot', end: 'target', blocked: false });
  });

  it('blocks a hidden trap or clone device but not a hidden shot trigger', () => {
    const hiddenBrown = makeLevel({ '2,2': 'door_red' }, { underlays: [{ x: 2, y: 2, terrain: 'button_brown' }] });
    const brown = connectionRows(hiddenBrown, 2, 2);
    expect(brown.caption?.key).toBe(CONNECTIONS_KEYS.cellHidden);
    expect(brown.link).toEqual({ type: 'start', system: 'trap', end: 'button', blocked: true });

    const hiddenTrigger = makeLevel({ '2,2': 'door_red' }, { underlays: [{ x: 2, y: 2, terrain: 'shot_trigger' }] });
    expect(connectionRows(hiddenTrigger, 2, 2).link).toEqual({ type: 'start', system: 'shot', end: 'button', blocked: false });
  });

  it('offers the Link button for a shot device hidden under a top tile that plays another role', () => {
    const trigger = connectionRows(makeLevel({ '2,2': 'teleport_red' }, { underlays: [{ x: 2, y: 2, terrain: 'shot_trigger' }] }), 2, 2);
    expect(trigger.link).toEqual({ type: 'start', system: 'shot', end: 'button', blocked: false });
    const launcher = connectionRows(makeLevel({ '2,2': 'teleport_red' }, { underlays: [{ x: 2, y: 2, terrain: 'shot_launcher_e' }] }), 2, 2);
    expect(launcher.link).toEqual({ type: 'start', system: 'shot', end: 'target', blocked: false });
    expect(connectionRows(makeLevel({ '2,2': 'teleport_red' }), 2, 2).link).toBeNull();
  });

  it('names a row after the other cell device, else its item, else its tile', () => {
    const level = makeLevel({ '5,5': 'button_gray', '6,5': 'floor' }, { items: { '6,5': 'chip', '5,5': 'bomb' } });
    const view = connectionRows(level, 5, 5);
    const names = view.controls?.rows.map((r) => [r.x, r.y, r.name.key]);
    const chip = ConfigRegistry.getTile('chip').i18nKey;
    expect(names).toContainEqual([6, 5, chip]);
    // The gray button swaps what lies on its own cell too: that relation to itself is not listed, either way.
    expect(view.controls?.rows.some((r) => r.x === 5 && r.y === 5)).toBe(false);
    expect(view.controlledBy?.rows.some((r) => r.x === 5 && r.y === 5)).toBe(false);
    expect(connectionCellName(level, 6, 5)).toEqual({ key: chip });
    expect(connectionCellName(level, 7, 5)).toEqual({ key: ConfigRegistry.getTile('floor').i18nKey });
    expect(connectionCellName(level, 5, 5)).toEqual({ key: ROLE_NAME_KEYS.swap_button });
    // A chip inside the radius is named after its item and lists the button that swaps it.
    const chipView = connectionRows(level, 6, 5);
    expect(chipView.caption).toEqual({ key: CONNECTIONS_KEYS.cell, x: 6, y: 5, name: { key: chip } });
    expect(chipView.controlledBy?.rows.map((r) => r.name.key)).toEqual([ROLE_NAME_KEYS.swap_button]);
  });

  it('caps colour rows per mechanism with a count of the rest, and never caps links', () => {
    const terrain: Record<string, string> = {};
    const extraTeleporters = 3;
    for (let i = 0; i < EDITOR_CONNECTIONS_MAX_ROWS + extraTeleporters; i++) terrain[`${i},0`] = 'teleport_red';
    const view = connectionRows(makeLevel(terrain), 0, 0);
    expect(view.controls?.rows).toHaveLength(EDITOR_CONNECTIONS_MAX_ROWS);
    // The cell relates to every other teleporter of its group: all but itself, minus the rows shown.
    expect(view.controls?.more).toBe(extraTeleporters - 1);
    expect(view.controls?.empty).toBeNull();

    const links: CompiledLevel['trapLinks'] = [];
    const traps: Record<string, string> = { '0,5': 'button_brown' };
    for (let i = 0; i < EDITOR_CONNECTIONS_MAX_ROWS + 3; i++) {
      traps[`${i},6`] = 'trap';
      links.push({ buttonX: 0, buttonY: 5, trapX: i, trapY: 6 });
    }
    const many = connectionRows(makeLevel(traps, { trapLinks: links }), 0, 5);
    expect(many.controls?.rows).toHaveLength(EDITOR_CONNECTIONS_MAX_ROWS + 3);
    expect(many.controls?.more).toBe(0);
  });

  it('says a laser emitter is wired to nothing, and an empty cell holds no mechanism', () => {
    const level = makeLevel({ '3,3': 'laser_emitter_n' });
    expect(connectionRows(level, 3, 3).note).toEqual({ key: CONNECTIONS_KEYS.fallbackLaserEmitter });
    const empty = connectionRows(level, 7, 7);
    expect(empty.caption).toEqual({ key: CONNECTIONS_KEYS.noDevice, x: 7, y: 7, name: null });
    expect(empty.controls?.empty).toEqual({ key: CONNECTIONS_KEYS.noneControls });
    expect(empty.controlledBy?.empty).toEqual({ key: CONNECTIONS_KEYS.noneControlled });
    expect(empty.note).toBeNull();
    expect(empty.link).toBeNull();
  });

  it('lists nothing under Lynx rules but says where the connections are, and nothing outside the grid', () => {
    const lynx = connectionRows(makeLevel({ '1,1': 'button_brown', '2,1': 'trap' }, { ruleset: 'lynx' }), 1, 1);
    expect(lynx.controls).toBeNull();
    expect(lynx.controlledBy).toBeNull();
    expect(lynx.note).toEqual({ key: CONNECTIONS_KEYS.epoxyOnly });
    // A Lynx level still links traps and clone machines (a Link button), but has no shot devices.
    expect(lynx.link).toEqual({ type: 'start', system: 'trap', end: 'button', blocked: false });
    const lynxShot = connectionRows(makeLevel({ '1,1': 'shot_trigger' }, { ruleset: 'lynx' }), 1, 1);
    expect(lynxShot.link).toBeNull();
    const outside = connectionRows(makeLevel({}), WIDTH, 0);
    expect(outside).toEqual({ caption: null, controls: null, controlledBy: null, note: null, link: null });
  });

  it('does not modify its input', () => {
    const level = makeLevel({ '1,1': 'button_brown', '4,1': 'trap' }, { trapLinks: [{ buttonX: 1, buttonY: 1, trapX: 4, trapY: 1 }] });
    const snapshot = JSON.stringify(level);
    connectionRows(level, 1, 1);
    connectionRows(level, 4, 1);
    expect(JSON.stringify(level)).toBe(snapshot);
  });
});

describe('connection locale keys', () => {
  const EN = enLocale as TranslationNode;
  const FR = frLocale as TranslationNode;
  const ALL_KEYS = [
    ...Object.values(CONNECTIONS_KEYS),
    ...Object.values(ROLE_NAME_KEYS),
    ...Object.values(SYSTEM_NAME_KEYS),
    ...Object.values(KIND_NAME_KEYS),
    ...Object.values(CHANNEL_NAME_KEYS)
  ];

  it('covers all 21 roles and 11 mechanisms', () => {
    expect(Object.keys(ROLE_NAME_KEYS)).toHaveLength(21);
    expect(Object.keys(SYSTEM_NAME_KEYS)).toHaveLength(11);
  });

  it('has every key the view model names in both languages', () => {
    expect(ALL_KEYS.filter((key) => resolveMessage(EN, key) === undefined)).toEqual([]);
    expect(ALL_KEYS.filter((key) => resolveMessage(FR, key) === undefined)).toEqual([]);
  });
});
