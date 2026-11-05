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
import type { RelationSystem } from '../core/DeviceRelations';
import { resolveMessage, type TranslationNode } from '../i18n/messageFormat';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { SYSTEM_NAME_KEYS } from './connectionRows';
import { DEFAULT_SECTION_STATE, INSPECTOR_SECTIONS } from './inspectorSections';
import {
  CC3D_MECHANISM_HELP_ROWS,
  MECHANISM_HELP_ROWS,
  MECHANISMS_HELP_CC3D_TOP_LAYER_KEY,
  MECHANISMS_HELP_KEYS_KEY,
  MECHANISMS_HELP_LYNX_KEY,
  MECHANISMS_HELP_TITLE_KEY
} from './mechanismsHelp';

const EN = enLocale as TranslationNode;
const FR = frLocale as TranslationNode;

/** Words the editor's own wording no longer uses: a connection is a link. */
const BANNED_WORDS = /(?<![\p{L}\p{N}_])(wire|wires|wired|wiring|fil|fils|câble|câbles|câblé|câblage)(?![\p{L}\p{N}_])/iu;

function leaves(node: TranslationNode, prefix: string): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node).flatMap(([key, child]) => leaves(child, `${prefix}.${key}`));
}

describe('mechanism help rows', () => {
  it('has one row for every mechanism, once', () => {
    const systems = Object.keys(SYSTEM_NAME_KEYS).sort();
    expect(MECHANISM_HELP_ROWS.map((row) => row.system).sort()).toEqual(systems);
  });

  it('names each mechanism like the Connections rows do', () => {
    for (const row of MECHANISM_HELP_ROWS) expect(row.nameKey).toBe(SYSTEM_NAME_KEYS[row.system as RelationSystem]);
  });

  it('groups the mechanisms by how their parts meet', () => {
    const kinds = (kind: string): string[] => MECHANISM_HELP_ROWS.filter((row) => row.kind === kind).map((row) => row.system);
    expect(kinds('link')).toEqual(['trap', 'clone', 'shot', 'signal']);
    expect(kinds('colour')).toEqual(['plate', 'toggle', 'teleport', 'laser']);
    expect(kinds('level')).toEqual(['tank', 'flame', 'swap', 'puppet']);
  });

  it('has a non-empty sentence for each row, the title, the keys and the Lynx line, in both locales', () => {
    const keys = [
      MECHANISMS_HELP_TITLE_KEY,
      MECHANISMS_HELP_KEYS_KEY,
      MECHANISMS_HELP_LYNX_KEY,
      ...MECHANISM_HELP_ROWS.flatMap((row) => [row.howKey, row.unlinkedKey])
    ];
    for (const locale of [EN, FR]) {
      for (const key of keys) expect((resolveMessage(locale, key) ?? '').length).toBeGreaterThan(0);
    }
  });

  it('names the keys K, T, L, Shift+R and Shift+F', () => {
    const en = resolveMessage(EN, MECHANISMS_HELP_KEYS_KEY) ?? '';
    for (const key of ['K ', 'T ', 'L ', 'Shift+R', 'Shift+F']) expect(en).toContain(key);
    const fr = resolveMessage(FR, MECHANISMS_HELP_KEYS_KEY) ?? '';
    for (const key of ['K ', 'T ', 'L ', 'Maj+R', 'Maj+F']) expect(fr).toContain(key);
  });
});

describe('CC3D mechanism help rows', () => {
  it('has the eight CC3D mechanisms once, each with a name and a sentence in both locales', () => {
    expect(CC3D_MECHANISM_HELP_ROWS.map((row) => row.system)).toEqual(['trap', 'teleport', 'clone', 'laser', 'toggle', 'hold', 'golem_blue', 'golem_yellow']);
    const keys = [MECHANISMS_HELP_CC3D_TOP_LAYER_KEY, ...CC3D_MECHANISM_HELP_ROWS.flatMap((row) => [row.nameKey, row.howKey])];
    for (const locale of [EN, FR]) {
      for (const key of keys) expect((resolveMessage(locale, key) ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('inspector mechanisms section', () => {
  it('is a section that starts closed', () => {
    expect(INSPECTOR_SECTIONS).toContain('mechanisms');
    expect(DEFAULT_SECTION_STATE.mechanisms).toBe(false);
  });
});

describe('editor wording', () => {
  it('leaves no wire or fil wording in the editor strings, in either locale', () => {
    for (const [name, locale] of [['en', EN], ['fr', FR]] as const) {
      const editor = (locale as Record<string, TranslationNode>).editor;
      const found = leaves(editor, 'editor').filter(([, value]) => BANNED_WORDS.test(value));
      expect({ name, found }).toEqual({ name, found: [] });
    }
  });

  it('leaves no wire or câble wording in the HUD strings or the objective hints, in either locale', () => {
    for (const [name, locale] of [['en', EN], ['fr', FR]] as const) {
      const root = locale as Record<string, TranslationNode>;
      const hud = leaves(root.hud, 'hud');
      const hints = leaves((root.levels as Record<string, TranslationNode>).procedural, 'levels.procedural');
      expect(hud.some(([key]) => key.endsWith('kb_objective.label'))).toBe(true);
      expect(hints.some(([key]) => key === 'levels.procedural.default.hint')).toBe(true);
      const found = [...hud, ...hints].filter(([, value]) => BANNED_WORDS.test(value));
      expect({ name, found }).toEqual({ name, found: [] });
    }
  });

  it('writes the multi-direction swivel door and thin panel names with the direction in parentheses, in both locales', () => {
    const names = (locale: TranslationNode): Record<string, { name: string }> =>
      (locale as unknown as Record<string, Record<string, { name: string }>>).tiles;
    const pattern = /^[^()]+ \([\p{L}]+-[\p{L}]+\)$/u;
    for (const locale of [EN, FR]) {
      const tiles = names(locale);
      for (const corner of ['ne', 'se', 'sw', 'nw']) expect(tiles[`swivel_door_${corner}`].name).toMatch(pattern);
      for (const pair of ['ne', 'se', 'sw', 'nw', 'ns', 'ew']) expect(tiles[`thin_wall_${pair}`].name).toMatch(pattern);
    }
  });
});
