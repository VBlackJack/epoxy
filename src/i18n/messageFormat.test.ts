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
import { formatMessage, resolveMessage, translate, TranslationNode } from './messageFormat';

const LOCALES: Record<string, TranslationNode> = {
  fr: {
    a: { greet: { label: 'Bonjour {name}' } },
    only_fr: { label: 'seulement fr' }
  },
  en: {
    a: { greet: { label: 'Hello {name}' } },
    only_en: { label: 'only en' }
  }
};

describe('resolveMessage', () => {
  it('resolves a full key and a key that stops on a leaf object', () => {
    expect(resolveMessage(LOCALES.en, 'a.greet.label')).toBe('Hello {name}');
    expect(resolveMessage(LOCALES.en, 'a.greet')).toBe('Hello {name}');
  });

  it('returns undefined for a missing key', () => {
    expect(resolveMessage(LOCALES.en, 'a.missing.label')).toBeUndefined();
  });
});

describe('translate fallback', () => {
  it('uses the current locale first', () => {
    expect(translate(LOCALES, 'en', 'fr', 'a.greet.label', { name: 'Ada' })).toBe('Hello Ada');
  });

  it('falls back to the default locale when the key is missing', () => {
    expect(translate(LOCALES, 'en', 'fr', 'only_fr.label')).toBe('seulement fr');
  });

  it('returns the key when no locale has it', () => {
    expect(translate(LOCALES, 'en', 'fr', 'nowhere.label')).toBe('nowhere.label');
  });

  it('falls back when the current locale is unknown', () => {
    expect(translate(LOCALES, 'de', 'fr', 'only_fr.label')).toBe('seulement fr');
  });
});

describe('formatMessage plurals', () => {
  const tpl = '{count, plural, one {# level} other {# levels}} imported';

  it('selects the English one and other forms', () => {
    expect(formatMessage(tpl, { count: 1 }, 'en')).toBe('1 level imported');
    expect(formatMessage(tpl, { count: 0 }, 'en')).toBe('0 levels imported');
    expect(formatMessage(tpl, { count: 5 }, 'en')).toBe('5 levels imported');
  });

  it('treats 0 and 1 as singular in French', () => {
    const fr = '{count, plural, one {# niveau} other {# niveaux}}';
    expect(formatMessage(fr, { count: 0 }, 'fr')).toBe('0 niveau');
    expect(formatMessage(fr, { count: 1 }, 'fr')).toBe('1 niveau');
    expect(formatMessage(fr, { count: 2 }, 'fr')).toBe('2 niveaux');
  });

  it('handles several plural blocks and plain placeholders together', () => {
    const msg = '{doors, plural, one {# door} other {# doors}} for {keys, plural, one {# key} other {# keys}} ({key})';
    expect(formatMessage(msg, { doors: 3, keys: 1, key: 'Red Key' }, 'en')).toBe('3 doors for 1 key (Red Key)');
  });

  it('accepts numeric strings', () => {
    expect(formatMessage(tpl, { count: '1' }, 'en')).toBe('1 level imported');
  });

  it('falls back to the other branch when the category has no branch', () => {
    expect(formatMessage('{n, plural, other {# items}}', { n: 1 }, 'en')).toBe('1 items');
  });

  it('leaves a plural block untouched when its parameter is missing', () => {
    expect(formatMessage(tpl, { other: 2 }, 'en')).toBe(tpl);
  });

  it('replaces repeated placeholders and keeps unknown ones', () => {
    expect(formatMessage('{size}x{size} {unknown}', { size: 9 }, 'en')).toBe('9x9 {unknown}');
  });
});
