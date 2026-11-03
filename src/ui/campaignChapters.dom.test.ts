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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignChapter } from '../core/types';
import { mountModals } from '../test/domFixture';

vi.mock('../i18n/I18nManager', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}?${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join('&')}` : key
}));

import { groupLevelsByChapter, renderChapterView } from './campaignChapters';

const CHAPTERS: CampaignChapter[] = [
  { id: 'one', titleKey: 'c.1.t', subtitleKey: 'c.1.s', levels: ['a', 'b'] },
  { id: 'two', titleKey: 'c.2.t', subtitleKey: 'c.2.s', levels: ['c', 'd'] }
];
const LEVELS = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const SOLVED = new Set(['a', 'c']);

let host: HTMLElement;
let strip: HTMLElement;

function render(
  options: { shown?: (id: string) => boolean; current?: string; openAll?: boolean; keepState?: boolean } = {}
): void {
  const shown = options.shown ?? (() => true);
  renderChapterView({
    host,
    strip,
    tableHead: document.querySelector<HTMLTableSectionElement>('#scores-table thead'),
    groups: groupLevelsByChapter(LEVELS, CHAPTERS, (l) => SOLVED.has(l.id), (l) => shown(l.id)),
    buildRow: ({ level }) => {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.textContent = level.id;
      tr.appendChild(td);
      return tr;
    },
    currentChapterId: options.current,
    openAll: options.openAll ?? false,
    keepState: options.keepState ?? false
  });
}

function details(): HTMLDetailsElement[] {
  return Array.from(host.querySelectorAll('details'));
}

beforeEach(() => {
  mountModals('scores-modal');
  host = document.getElementById('scores-chapters') as HTMLElement;
  strip = document.getElementById('scores-chapter-strip') as HTMLElement;
  Element.prototype.scrollIntoView = vi.fn();
});

describe('Levels dialog markup', () => {
  it('holds the chapter containers and a named flat table', () => {
    expect(host).not.toBeNull();
    expect(strip).not.toBeNull();
    expect(document.getElementById('scores-table')).not.toBeNull();
  });
});

describe('chapter view (DOM)', () => {
  it('draws one collapsible chapter per group with title, subtitle, progress and a bar', () => {
    render({ current: 'two' });
    const all = details();
    expect(all.map((d) => d.getAttribute('data-chapter-id'))).toEqual(['one', 'two']);
    expect(all[0].querySelector('.scores-chapter-title')?.textContent).toBe('c.1.t');
    expect(all[0].querySelector('.scores-chapter-subtitle')?.textContent).toBe('c.1.s');
    expect(all[0].querySelector('.scores-chapter-progress')?.textContent).toBe(
      'hud.scores_modal.chapter_progress.label?solved=1&total=2'
    );
    const bar = all[0].querySelector('progress') as HTMLProgressElement;
    expect([bar.value, bar.max]).toEqual([1, 2]);
    expect(Array.from(all[1].querySelectorAll('tbody td')).map((td) => td.textContent)).toEqual(['c', 'd']);
  });

  it('opens the chapter of the current level and closes the others', () => {
    render({ current: 'two' });
    expect(details().map((d) => d.open)).toEqual([false, true]);
  });

  it('copies the table header into each chapter table', () => {
    render();
    const headers = host.querySelectorAll('thead');
    expect(headers).toHaveLength(2);
    expect(headers[0].querySelectorAll('th').length).toBeGreaterThan(0);
  });

  it('hides a chapter with no matching level, in the list and in the strip', () => {
    render({ shown: (id) => id === 'd', openAll: true });
    expect(details().map((d) => d.getAttribute('data-chapter-id'))).toEqual(['two']);
    expect(strip.querySelectorAll('button')).toHaveLength(1);
    expect(host.querySelectorAll('tbody td')).toHaveLength(1);
  });

  it('opens every remaining chapter when a filter is active', () => {
    render({ current: 'one', openAll: true });
    expect(details().every((d) => d.open)).toBe(true);
  });

  it('keeps what the player opened or closed when redrawn with keepState', () => {
    render({ current: 'one' });
    details()[0].open = false;
    details()[1].open = true;
    render({ current: 'one', keepState: true });
    expect(details().map((d) => d.open)).toEqual([false, true]);
    render({ current: 'one', keepState: false });
    expect(details().map((d) => d.open)).toEqual([true, false]);
  });

  it('draws one overview button per chapter with its progress, and a chapter button opens and scrolls to its chapter', () => {
    render({ current: 'one' });
    const chips = Array.from(strip.querySelectorAll('button'));
    expect(chips.map((b) => b.textContent)).toEqual(['1: 1/2', '2: 1/2']);
    expect(chips[1].getAttribute('aria-label')).toBe('hud.scores_modal.chapter_chip.label?title=c.2.t&solved=1&total=2');
    expect(details()[1].open).toBe(false);
    chips[1].click();
    expect(details()[1].open).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
