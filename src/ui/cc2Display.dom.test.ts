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

// @vitest-environment happy-dom
// DOM tests opt in with the line above; the default environment stays node (see vitest.config.ts).

import { beforeEach, describe, expect, it } from 'vitest';
import type { CompiledLevel } from '../core/types';
import { i18n } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { cc2CoverageBadge, cc2ImportNoticeLines, cc2MechanicLabel, cc2PlayBannerText, cc2SummaryLines } from './cc2Display';

function level(verdict: 'exact' | 'approx' | 'lost', lost: string[] = []): Pick<CompiledLevel, 'cc2'> {
  return {
    cc2: { v: 1, sha256: 'e'.repeat(64), file: 'a.c2m', order: 1, gridHash: 'h', coverage: { verdict, lost, approx: [] } }
  };
}

beforeEach(() => {
  loadTestConfigs();
  i18n.setLocale('en');
});

describe('CC2 coverage badge and banner', () => {
  it('makes a badge for each verdict and none for another level', () => {
    const labels = { exact: 'Exact', approx: 'Approximate', lost: 'Not playable' } as const;
    for (const verdict of ['exact', 'approx', 'lost'] as const) {
      const badge = cc2CoverageBadge(level(verdict));
      expect(badge?.textContent).toBe(labels[verdict]);
      expect(badge?.classList.contains(`packs-badge-cc2-${verdict}`)).toBe(true);
    }
    expect(cc2CoverageBadge({})).toBeNull();
  });

  it('names the mechanics Epoxy does not play in the banner, and shows none for a playable level', () => {
    expect(cc2PlayBannerText(level('lost', ['purple_wall', 'multiple_players']))).toContain('multiple players');
    expect(cc2PlayBannerText(level('lost', ['purple_wall']))).toMatch(
      /^This level uses CC2 mechanics that Epoxy does not play yet: /
    );
    expect(cc2PlayBannerText(level('approx'))).toBeNull();
    expect(cc2PlayBannerText({})).toBeNull();
  });

  it('labels a reserved element by its own name and any other key in words', () => {
    expect(cc2MechanicLabel('steel_wall_with_destroyer')).toBe('steel wall with destroyer');
    expect(cc2MechanicLabel('purple_wall')).not.toBe('purple_wall');
  });

  it('writes the import summary in both languages', () => {
    const summary = { levelCount: 3, exact: 1, approx: 1, lost: 1, skipped: 1, tooLarge: 2, appended: 2, warningCount: 4, lostKeys: ['rover'] };
    expect(cc2SummaryLines(summary)).toHaveLength(6);
    expect(cc2SummaryLines(summary)[0]).toBe('3 levels imported: 1 exact, 1 approximate, 1 not playable as imported.');
    i18n.setLocale('fr');
    expect(cc2SummaryLines(summary)[0]).toContain('3 niveaux importés');
    i18n.setLocale('en');
  });

  it('says in both languages that the original files were not kept, only when that is so', () => {
    const summary = { levelCount: 1, exact: 1, approx: 0, lost: 0, skipped: 0, tooLarge: 1, appended: 0, warningCount: 0, lostKeys: [] };
    const kept = cc2ImportNoticeLines(summary, true);
    const lost = cc2ImportNoticeLines(summary, false);
    expect(lost).toHaveLength(kept.length + 1);
    expect(lost[lost.length - 1]).toContain('could not be stored');
    expect(kept.some((line) => line.includes('over the size limit'))).toBe(true);
    i18n.setLocale('fr');
    expect(cc2ImportNoticeLines(summary, false).pop()).toContain("n'ont pas pu");
    i18n.setLocale('en');
  });
});
