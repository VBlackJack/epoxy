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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompiledLevel } from '../core/types';
import { mountModals, pressKey, resetWindowListeners, settleAsync, stubLayout, trackWindowListeners } from '../test/domFixture';
import type { SharePreviewRequest } from './sharePreviewDialog';
import { SHARE_PREVIEW_THUMBNAIL_COUNT } from './uiConstants';

let showSharePreview: (request: SharePreviewRequest) => Promise<string>;
let makeLevel: (id: string, overrides?: Record<string, unknown>) => CompiledLevel;

function request(overrides: Partial<SharePreviewRequest> = {}): SharePreviewRequest {
  return {
    name: 'Shared <b>pack</b>',
    author: 'Ada',
    description: 'First line\nSecond line',
    levels: [makeLevel('a'), makeLevel('b', { winRule: 'targets' })],
    duplicate: false,
    ...overrides
  };
}

function element(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function isHidden(id: string): boolean {
  return element(id).classList.contains('hidden');
}

beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  mountModals('share-preview-modal');
  const { i18n } = await import('../i18n/I18nManager');
  i18n.setLocale('en');
  const { loadTestConfigs } = await import('../test/loadTestConfigs');
  loadTestConfigs();
  ({ makeLevel } = (await import('../test/packFixtures')) as unknown as { makeLevel: typeof makeLevel });
  ({ showSharePreview } = (await import('./sharePreviewDialog')) as unknown as { showSharePreview: typeof showSharePreview });
});

afterEach(() => {
  resetWindowListeners();
});

describe('share preview dialog (DOM)', () => {
  it('shows the pack as text only, with the level count, the badges and the thumbnails', () => {
    void showSharePreview(request({ levels: Array.from({ length: SHARE_PREVIEW_THUMBNAIL_COUNT + 3 }, (_, i) => makeLevel(`l${i}`, i === 0 ? { winRule: 'targets' } : {})) }));
    expect(isHidden('share-preview-modal')).toBe(false);
    expect(element('share-preview-name').textContent).toBe('Shared <b>pack</b>');
    expect(element('share-preview-name').querySelector('b')).toBeNull();
    expect(element('share-preview-author').textContent).toBe('By Ada');
    expect(element('share-preview-description').textContent).toBe('First line\nSecond line');
    expect(element('share-preview-count').textContent).toBe(`${SHARE_PREVIEW_THUMBNAIL_COUNT + 3} levels`);
    const badges = Array.from(element('share-preview-badges').children).map((el) => el.className);
    expect(badges).toEqual(['packs-badge packs-badge-epoxy', 'packs-badge packs-badge-sokoban']);
    expect(element('share-preview-thumbs').querySelectorAll('canvas')).toHaveLength(SHARE_PREVIEW_THUMBNAIL_COUNT);
  });

  it('hides the author and description lines when the pack has none', () => {
    void showSharePreview(request({ author: undefined, description: undefined }));
    expect(isHidden('share-preview-author')).toBe(true);
    expect(isHidden('share-preview-description')).toBe(true);
  });

  it('offers Import and Import and play, with focus on Cancel', () => {
    void showSharePreview(request());
    expect(isHidden('share-preview-import-btn')).toBe(false);
    expect(isHidden('share-preview-import-play-btn')).toBe(false);
    expect(isHidden('share-preview-play-btn')).toBe(true);
    expect(isHidden('share-preview-status')).toBe(true);
    expect(document.activeElement).toBe(element('share-preview-cancel-btn'));
  });

  it('answers with the button pressed and closes', async () => {
    for (const [buttonId, expected] of [
      ['share-preview-import-btn', 'import'],
      ['share-preview-import-play-btn', 'import_play'],
      ['share-preview-cancel-btn', 'cancel']
    ] as const) {
      const answer = showSharePreview(request());
      element(buttonId).click();
      expect(await answer).toBe(expected);
      expect(isHidden('share-preview-modal')).toBe(true);
    }
  });

  it('answers cancel on Escape and on the backdrop', async () => {
    const byEscape = showSharePreview(request());
    pressKey(document.activeElement as Element, 'Escape');
    expect(await byEscape).toBe('cancel');
    expect(isHidden('share-preview-modal')).toBe(true);

    const byBackdrop = showSharePreview(request());
    element('share-preview-modal').click();
    expect(await byBackdrop).toBe('cancel');
  });

  it('says the pack is already in the library and offers only Play and Cancel', async () => {
    const answer = showSharePreview(request({ duplicate: true }));
    expect(isHidden('share-preview-status')).toBe(false);
    expect(element('share-preview-status').textContent).toBe('Already in your library');
    expect(isHidden('share-preview-import-btn')).toBe(true);
    expect(isHidden('share-preview-import-play-btn')).toBe(true);
    expect(isHidden('share-preview-play-btn')).toBe(false);
    element('share-preview-play-btn').click();
    expect(await answer).toBe('play');
  });

  it('keeps Tab inside the dialog', async () => {
    void showSharePreview(request());
    const visible = ['share-preview-cancel-btn', 'share-preview-import-btn', 'share-preview-import-play-btn'];
    const seen: string[] = [];
    for (let i = 0; i < visible.length; i++) {
      seen.push((document.activeElement as HTMLElement).id);
      pressKey(document.activeElement as Element, 'Tab');
      await settleAsync();
    }
    expect(seen).toEqual(visible);
    expect((document.activeElement as HTMLElement).id).toBe(visible[0]);
  });

  it('abandons a preview still open when another is asked for', async () => {
    const first = showSharePreview(request({ name: 'One' }));
    const second = showSharePreview(request({ name: 'Two' }));
    expect(await first).toBe('cancel');
    expect(element('share-preview-name').textContent).toBe('Two');
    element('share-preview-import-btn').click();
    expect(await second).toBe('import');
  });
});
