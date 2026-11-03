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

import { describe, expect, it, vi } from 'vitest';
import { CampaignChapter } from '../core/types';

vi.mock('../i18n/I18nManager', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}?${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join('&')}` : key
}));

import {
  chapterBannerText,
  chapterOfLevel,
  chapterOpenedBy,
  chapterToAnnounce,
  groupLevelsByChapter
} from './campaignChapters';

const CHAPTERS: CampaignChapter[] = [
  { id: 'one', titleKey: 'c.1.t', subtitleKey: 'c.1.s', levels: ['a', 'b', 'c'] },
  { id: 'two', titleKey: 'c.2.t', subtitleKey: 'c.2.s', levels: ['d', 'e'] }
];
const LEVELS = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const never = (): boolean => false;
const always = (): boolean => true;

describe('groupLevelsByChapter', () => {
  it('groups levels in chapter order with their pack index and progress', () => {
    const solved = new Set(['a', 'c', 'd']);
    const groups = groupLevelsByChapter(LEVELS, CHAPTERS, (l) => solved.has(l.id), always);
    expect(groups.map((g) => [g.chapter.id, g.position, g.solved, g.total])).toEqual([
      ['one', 1, 2, 3],
      ['two', 2, 1, 2]
    ]);
    expect(groups[1].entries.map((e) => [e.level.id, e.index])).toEqual([
      ['d', 3],
      ['e', 4]
    ]);
  });

  it('follows chapter order, not pack order, so levels can be reordered', () => {
    const reversed = [...LEVELS].reverse();
    const groups = groupLevelsByChapter(reversed, CHAPTERS, never, always);
    expect(groups[0].entries.map((e) => e.level.id)).toEqual(['a', 'b', 'c']);
    expect(groups[0].entries.map((e) => e.index)).toEqual([4, 3, 2]);
  });

  it('keeps progress over the whole chapter while the filter hides levels', () => {
    const groups = groupLevelsByChapter(LEVELS, CHAPTERS, (l) => l.id === 'a', (l) => l.id === 'b');
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.level.id)).toEqual(['b']);
    expect([groups[0].solved, groups[0].total]).toEqual([1, 3]);
  });

  it('hides a chapter with no matching level, and counts only levels the pack holds', () => {
    expect(groupLevelsByChapter(LEVELS, CHAPTERS, never, never)).toEqual([]);
    const partial = groupLevelsByChapter(LEVELS.slice(0, 4), CHAPTERS, never, always);
    expect(partial[1].total).toBe(1);
  });
});

describe('chapter lookups', () => {
  it('finds the chapter of a level', () => {
    expect(chapterOfLevel(CHAPTERS, 'e')?.id).toBe('two');
    expect(chapterOfLevel(CHAPTERS, 'zzz')).toBeUndefined();
  });

  it('knows which level opens a chapter', () => {
    expect(chapterOpenedBy(CHAPTERS, 'd')).toEqual({ chapter: CHAPTERS[1], position: 2 });
    expect(chapterOpenedBy(CHAPTERS, 'e')).toBeUndefined();
  });

  it('announces a chapter only on finishing the previous level or on a first run', () => {
    expect(chapterToAnnounce(CHAPTERS, 'd', 'finished-previous')?.position).toBe(2);
    expect(chapterToAnnounce(CHAPTERS, 'a', 'first-run')?.position).toBe(1);
    expect(chapterToAnnounce(CHAPTERS, 'd', 'other')).toBeUndefined();
    expect(chapterToAnnounce(CHAPTERS, 'e', 'finished-previous')).toBeUndefined();
  });

  it('builds the banner from the position and both keys', () => {
    expect(chapterBannerText(CHAPTERS[1], 2)).toBe(
      'campaign.chapter_banner.label?number=2&title=c.2.t&subtitle=c.2.s'
    );
  });
});
