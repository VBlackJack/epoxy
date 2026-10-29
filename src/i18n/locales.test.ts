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
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import indexHtml from '../../index.html?raw';
import { resolveMessage, TranslationNode } from './messageFormat';

const EN = enLocale as TranslationNode;
const FR = frLocale as TranslationNode;

/** Every source file under src/, recursively, as raw text. */
const SOURCE_FILES = import.meta.glob(['../**/*.ts', '!../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

function collectKeyPaths(node: TranslationNode, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node).flatMap(([key, child]) =>
    collectKeyPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

function collectStrings(node: TranslationNode): string[] {
  if (typeof node === 'string') return [node];
  return Object.values(node).flatMap(collectStrings);
}

/** Config files, which reference translation keys through i18nKey fields. */
const CONFIG_FILES = import.meta.glob('../../public/configs/*.json', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

/**
 * Literal translation keys: t('...') calls, data-i18n* attributes, and
 * i18nKey fields in source (validator issues, packs) and config files.
 */
function collectReferencedKeys(): string[] {
  const keys = new Set<string>();
  const patterns = [
    /\bt\(\s*'([a-z0-9_.]+)'/g,
    /data-i18n(?:-[a-z-]+)?="([a-z0-9_.]+)"/g,
    /\bi18nKey:\s*'([a-z0-9_.]+)'/g,
    /"i18nKey":\s*"([a-z0-9_.]+)"/g
  ];
  for (const text of [...Object.values(SOURCE_FILES), ...Object.values(CONFIG_FILES), indexHtml]) {
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        keys.add(match[1]);
      }
    }
  }
  return [...keys];
}

describe('locale files', () => {
  it('en.json and fr.json have identical key sets', () => {
    const enKeys = collectKeyPaths(EN).sort();
    const frKeys = collectKeyPaths(FR).sort();
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
  });

  it('parity check walks nested levels', () => {
    expect(collectKeyPaths(EN)).toContain('editor.palette.category.terrain.label');
  });

  it('source scan reaches nested directories', () => {
    expect(Object.keys(SOURCE_FILES).some((p) => p.endsWith('editor/LevelEditor.ts'))).toBe(true);
    expect(Object.keys(SOURCE_FILES).some((p) => p.endsWith('main.ts'))).toBe(true);
    expect(Object.keys(CONFIG_FILES).some((p) => p.endsWith('tiles.json'))).toBe(true);
  });

  it('every literal key referenced by the UI exists in both locales', () => {
    const referenced = collectReferencedKeys();
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((k) => resolveMessage(EN, k) === undefined)).toEqual([]);
    expect(referenced.filter((k) => resolveMessage(FR, k) === undefined)).toEqual([]);
  });

  it('uses no em dash, en dash or typographic substitutes', () => {
    // en dash, em dash, curly quotes, ellipsis, no-break space, oe and ae ligatures
    const bannedCodePoints = [
      0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x00a0, 0x0152, 0x0153, 0x00c6, 0x00e6
    ];
    const banned = new RegExp(`[${String.fromCodePoint(...bannedCodePoints)}]`);
    for (const locale of [EN, FR]) {
      expect(collectStrings(locale).filter((s) => banned.test(s))).toEqual([]);
    }
  });
});
