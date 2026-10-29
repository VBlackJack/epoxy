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

import { afterEach, describe, expect, it } from 'vitest';
import { i18n, t } from './I18nManager';

describe('I18nManager', () => {
  const initial = i18n.getLocale();
  afterEach(() => {
    i18n.setLocale(initial);
  });

  it('switches locale without a DOM and notifies listeners', () => {
    let calls = 0;
    i18n.onChange(() => {
      calls++;
    });
    i18n.setLocale('en');
    expect(i18n.getLocale()).toBe('en');
    expect(calls).toBeGreaterThan(0);
  });

  it('ignores an unknown locale', () => {
    i18n.setLocale('en');
    i18n.setLocale('xx');
    expect(i18n.getLocale()).toBe('en');
  });

  it('pluralizes bundled messages per locale', () => {
    i18n.setLocale('en');
    expect(t('app.packs.procedural_toast.label', { count: 1 })).toContain('1 new procedural level,');
    i18n.setLocale('fr');
    expect(t('app.packs.imported_toast.label', { name: 'X', count: 1 })).toContain('(1 niveau)');
    expect(t('app.packs.imported_toast.label', { name: 'X', count: 3 })).toContain('(3 niveaux)');
  });

  it('returns the key itself for a key missing everywhere', () => {
    expect(t('does.not.exist.label')).toBe('does.not.exist.label');
  });
});
