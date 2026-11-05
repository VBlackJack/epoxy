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
import { t } from '../i18n/I18nManager';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { lossyExportNotice } from './exportNotice';

describe('lossyExportNotice', () => {
  beforeEach(() => {
    loadTestConfigs();
  });

  it('names the CC3D levels a .CCL export left out', () => {
    const notice = lossyExportNotice({
      replaced: [],
      lost: [],
      refused: [{ levelId: 'cc3d_a', reason: 'cc3d_ruleset' }]
    });
    expect(notice).toBe(t('app.export.refused_cc3d_ruleset.label', { levels: 'cc3d_a' }));
  });

  it('names the levels with signal wiring a .DAT export left out, with a label in both languages', () => {
    const notice = lossyExportNotice({
      replaced: [],
      lost: [],
      refused: [{ levelId: 'wired_a', reason: 'signal_content' }]
    });
    expect(notice).toBe(t('app.export.refused_signal_content.label', { levels: 'wired_a' }));
    expect(notice).toContain('wired_a');
    expect(notice).not.toBe('app.export.refused_signal_content.label');
  });

  it('names the levels with an Epoxy-only item (slow-time charm, speed boots) a .DAT export left out', () => {
    const notice = lossyExportNotice({
      replaced: [],
      lost: [],
      refused: [{ levelId: 'charmed_a', reason: 'epoxy_only_items' }]
    });
    expect(notice).toBe(t('app.export.refused_epoxy_only_items.label', { levels: 'charmed_a' }));
  });

  it('names the levels with a puppet, a puppet control or a skitter a .DAT export left out', () => {
    const notice = lossyExportNotice({
      replaced: [],
      lost: [],
      refused: [{ levelId: 'puppet_a', reason: 'epoxy_only_monsters' }]
    });
    expect(notice).toBe(t('app.export.refused_epoxy_only_monsters.label', { levels: 'puppet_a' }));
    expect(notice).not.toBe('app.export.refused_epoxy_only_monsters.label');
  });

  it('names the transmogrifier among the Epoxy-only monster content a .DAT export refuses', () => {
    const notice = lossyExportNotice({
      replaced: [],
      lost: [],
      refused: [{ levelId: 'swap_a', reason: 'epoxy_only_monsters' }]
    });
    expect(notice).toContain('swap_a');
    expect(notice).toMatch(/Transmogrifier|Transmogrificateur/);
  });

  it('has no notice for an exact export', () => {
    expect(lossyExportNotice({ replaced: [], lost: [] })).toBeNull();
  });
});
