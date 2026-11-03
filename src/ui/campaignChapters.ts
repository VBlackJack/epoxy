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

import { CampaignChapter } from '../core/types';
import { t } from '../i18n/I18nManager';
import { preferredScrollBehavior } from './motion';

/** One level of a chapter as the dialog shows it: the level and its index in the pack. */
export interface ChapterEntry<L> {
  level: L;
  index: number;
}

/** A chapter with the levels the dialog currently lists, and its progress over all its levels. */
export interface ChapterGroup<L> {
  chapter: CampaignChapter;
  /** 1-based position of the chapter in the campaign. */
  position: number;
  /** Levels that pass the filters, in chapter order. */
  entries: Array<ChapterEntry<L>>;
  solved: number;
  /** Chapter levels present in the pack, whatever the filters say. */
  total: number;
}

/**
 * Groups pack levels under their chapters. Progress counts every level of the
 * chapter; `entries` only the shown ones. A chapter with no shown level is left out.
 */
export function groupLevelsByChapter<L extends { id: string }>(
  levels: readonly L[],
  chapters: readonly CampaignChapter[],
  isSolved: (level: L) => boolean,
  isShown: (level: L) => boolean
): Array<ChapterGroup<L>> {
  const indexById = new Map(levels.map((level, index) => [level.id, index]));
  const groups: Array<ChapterGroup<L>> = [];
  chapters.forEach((chapter, chapterIndex) => {
    const members: Array<ChapterEntry<L>> = [];
    for (const id of chapter.levels) {
      const index = indexById.get(id);
      if (index !== undefined) members.push({ level: levels[index], index });
    }
    const entries = members.filter((entry) => isShown(entry.level));
    if (entries.length === 0) return;
    groups.push({
      chapter,
      position: chapterIndex + 1,
      entries,
      solved: members.filter((entry) => isSolved(entry.level)).length,
      total: members.length
    });
  });
  return groups;
}

/** The chapter holding the level, if any. */
export function chapterOfLevel(chapters: readonly CampaignChapter[], levelId: string): CampaignChapter | undefined {
  return chapters.find((chapter) => chapter.levels.includes(levelId));
}

/** The chapter a level opens (it is the chapter's first level), with its 1-based position. */
export function chapterOpenedBy(
  chapters: readonly CampaignChapter[],
  levelId: string
): { chapter: CampaignChapter; position: number } | undefined {
  const at = chapters.findIndex((chapter) => chapter.levels[0] === levelId);
  return at < 0 ? undefined : { chapter: chapters[at], position: at + 1 };
}

/** The banner shown when a chapter begins. */
export function chapterBannerText(chapter: CampaignChapter, position: number): string {
  return t('campaign.chapter_banner.label', {
    number: position,
    title: t(chapter.titleKey),
    subtitle: t(chapter.subtitleKey)
  });
}

export interface ChapterViewOptions<L> {
  /** Where the chapters are drawn. */
  host: HTMLElement;
  /** Where the overview buttons are drawn. */
  strip: HTMLElement;
  /** Header row copied into each chapter table. */
  tableHead: HTMLTableSectionElement | null;
  groups: Array<ChapterGroup<L>>;
  buildRow: (entry: ChapterEntry<L>) => HTMLTableRowElement;
  /** Chapter open when nothing says otherwise: the one holding the current level. */
  currentChapterId: string | undefined;
  /** Open every chapter shown (a search or a filter is active). */
  openAll: boolean;
  /** Keep the open or closed state of chapters already drawn, instead of the default. */
  keepState: boolean;
}

const CHAPTER_ID_ATTRIBUTE = 'data-chapter-id';

/** Open state of the chapters currently drawn, by chapter id. */
function readOpenState(host: HTMLElement): Map<string, boolean> {
  const state = new Map<string, boolean>();
  host.querySelectorAll<HTMLDetailsElement>(`details[${CHAPTER_ID_ATTRIBUTE}]`).forEach((details) => {
    state.set(details.getAttribute(CHAPTER_ID_ATTRIBUTE) ?? '', details.open);
  });
  return state;
}

function progressText(group: ChapterGroup<unknown>): string {
  return t('hud.scores_modal.chapter_progress.label', { solved: group.solved, total: group.total });
}

function buildChapter<L>(
  group: ChapterGroup<L>,
  options: ChapterViewOptions<L>,
  open: boolean
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'scores-chapter';
  details.setAttribute(CHAPTER_ID_ATTRIBUTE, group.chapter.id);
  details.open = open;

  const summary = document.createElement('summary');
  summary.className = 'scores-chapter-summary';
  const title = document.createElement('span');
  title.className = 'scores-chapter-title';
  title.textContent = t(group.chapter.titleKey);
  const subtitle = document.createElement('span');
  subtitle.className = 'scores-chapter-subtitle';
  subtitle.textContent = t(group.chapter.subtitleKey);
  const progress = document.createElement('span');
  progress.className = 'scores-chapter-progress';
  progress.textContent = progressText(group);
  const bar = document.createElement('progress');
  bar.className = 'scores-chapter-bar';
  bar.max = group.total;
  bar.value = group.solved;
  bar.setAttribute('aria-hidden', 'true');
  summary.append(title, subtitle, progress, bar);

  const table = document.createElement('table');
  table.className = 'scores-table';
  if (options.tableHead) table.appendChild(options.tableHead.cloneNode(true));
  const body = document.createElement('tbody');
  for (const entry of group.entries) body.appendChild(options.buildRow(entry));
  table.appendChild(body);

  details.append(summary, table);
  return details;
}

function buildChip<L>(group: ChapterGroup<L>, host: HTMLElement): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'hud-btn small scores-chapter-chip';
  chip.textContent = `${group.position}: ${group.solved}/${group.total}`;
  const label = t('hud.scores_modal.chapter_chip.label', {
    title: t(group.chapter.titleKey),
    solved: group.solved,
    total: group.total
  });
  chip.title = label;
  chip.setAttribute('aria-label', label);
  chip.addEventListener('click', () => {
    const target = Array.from(host.querySelectorAll<HTMLDetailsElement>(`details[${CHAPTER_ID_ATTRIBUTE}]`)).find(
      (details) => details.getAttribute(CHAPTER_ID_ATTRIBUTE) === group.chapter.id
    );
    if (!target) return;
    target.open = true;
    target.scrollIntoView({ block: 'start', behavior: preferredScrollBehavior() });
  });
  return chip;
}

/**
 * Draws the chapter overview strip and the collapsible chapters. The chapter of
 * the current level is open by default and the others closed; a search or a
 * filter opens every chapter that still has a match.
 */
export function renderChapterView<L>(options: ChapterViewOptions<L>): void {
  const previous = options.keepState ? readOpenState(options.host) : new Map<string, boolean>();
  options.host.replaceChildren();
  options.strip.replaceChildren();
  for (const group of options.groups) {
    const id = group.chapter.id;
    const open = options.openAll || (previous.get(id) ?? id === options.currentChapterId);
    options.host.appendChild(buildChapter(group, options, open));
    options.strip.appendChild(buildChip(group, options.host));
  }
}
