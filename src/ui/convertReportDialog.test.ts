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
import { EPOXY_COVERAGE } from '../core/cc3d/epoxyCoverage';
import enLocale from '../locales/en.json';
import frLocale from '../locales/fr.json';
import { resolveMessage, TranslationNode } from '../i18n/messageFormat';
import { coverageKey } from './convertReportDialog';

const EN = enLocale as TranslationNode;
const FR = frLocale as TranslationNode;
const PARTS = ['name', 'label'] as const;

describe('CC3D coverage labels', () => {
  it('has a name and a reason in English and in French for every coverage key', () => {
    const missing: string[] = [];
    for (const key of Object.keys(EPOXY_COVERAGE)) {
      for (const part of PARTS) {
        for (const [lang, tree] of [['en', EN], ['fr', FR]] as const) {
          const text = resolveMessage(tree, coverageKey(key, part));
          if (typeof text !== 'string' || text.trim() === '') missing.push(`${lang}:${key}.${part}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the English reason of the coverage table as the English label', () => {
    for (const [key, entry] of Object.entries(EPOXY_COVERAGE)) {
      expect(resolveMessage(EN, coverageKey(key, 'label'))).toBe(entry.reason);
    }
  });

  it('translates the reasons: no French label is the English text', () => {
    const same = Object.keys(EPOXY_COVERAGE).filter(
      (key) => resolveMessage(FR, coverageKey(key, 'label')) === resolveMessage(EN, coverageKey(key, 'label'))
    );
    expect(same).toEqual([]);
  });
});
