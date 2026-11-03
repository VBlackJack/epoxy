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

import { CompiledLevel } from '../core/types';
import { t } from '../i18n/I18nManager';
import { closeDialog, openDialog } from './dialog';
import { ThumbnailBatch } from './levelThumbnailView';
import { badgeLabelKey, engineBadgesOf } from './packManagerModel';
import { SHARE_PREVIEW_THUMBNAIL_COUNT, THUMBNAIL_LEVEL_BOX } from './uiConstants';

/**
 * Preview of a pack received through a share link. The dialog only answers; storing the
 * pack, if the player asks for it, is the caller's job, so nothing is kept before a click.
 */

const MODAL_ID = 'share-preview-modal';
const HIDDEN_CLASS = 'hidden';

/** The player's answer: Cancel, Escape and the backdrop all give 'cancel'. */
export type SharePreviewChoice = 'import' | 'import_play' | 'play' | 'cancel';

/** What the preview shows. */
export interface SharePreviewRequest {
  name: string;
  author?: string;
  description?: string;
  levels: readonly CompiledLevel[];
  /** The library already holds this pack: only Play and Cancel are offered. */
  duplicate: boolean;
}

let pendingResolve: ((choice: SharePreviewChoice) => void) | null = null;
let thumbs: ThumbnailBatch | null = null;
let listenersBound = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function show(el: HTMLElement | null, visible: boolean): void {
  el?.classList.toggle(HIDDEN_CLASS, !visible);
}

function settle(choice: SharePreviewChoice): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(choice);
}

function bindOnce(modal: HTMLElement): void {
  if (listenersBound) return;
  listenersBound = true;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDialog(modal);
  });
  const answers: Array<[string, SharePreviewChoice]> = [
    ['share-preview-cancel-btn', 'cancel'],
    ['share-preview-import-btn', 'import'],
    ['share-preview-import-play-btn', 'import_play'],
    ['share-preview-play-btn', 'play']
  ];
  for (const [id, choice] of answers) {
    byId(id)?.addEventListener('click', () => {
      settle(choice);
      closeDialog(modal);
    });
  }
}

function fillBadges(levels: readonly CompiledLevel[]): void {
  const wrap = byId('share-preview-badges');
  if (!wrap) return;
  wrap.replaceChildren();
  for (const badge of engineBadgesOf(levels)) {
    const el = document.createElement('span');
    el.className = `packs-badge packs-badge-${badge}`;
    el.textContent = t(badgeLabelKey(badge));
    wrap.appendChild(el);
  }
}

function fillThumbnails(levels: readonly CompiledLevel[]): void {
  const row = byId('share-preview-thumbs');
  if (!row) return;
  row.replaceChildren();
  thumbs?.dispose();
  thumbs = new ThumbnailBatch();
  for (const level of levels.slice(0, SHARE_PREVIEW_THUMBNAIL_COUNT)) row.appendChild(thumbs.add(level, THUMBNAIL_LEVEL_BOX));
}

function fillText(request: SharePreviewRequest): void {
  const name = byId('share-preview-name');
  if (name) name.textContent = request.name;
  const author = byId('share-preview-author');
  if (author) author.textContent = request.author ? t('app.packs.share.preview.by.label', { author: request.author }) : '';
  show(author, Boolean(request.author));
  const description = byId('share-preview-description');
  if (description) description.textContent = request.description ?? '';
  show(description, Boolean(request.description));
  const count = byId('share-preview-count');
  if (count) count.textContent = t('app.packs.manager.library.count.label', { count: request.levels.length });
}

/**
 * Shows the pack and waits for the answer. Focus starts on Cancel. A preview still open when
 * another is asked for is abandoned (answers 'cancel').
 */
export function showSharePreview(request: SharePreviewRequest): Promise<SharePreviewChoice> {
  const modal = byId(MODAL_ID);
  const cancel = byId('share-preview-cancel-btn');
  if (!modal || !cancel) return Promise.resolve('cancel');
  bindOnce(modal);
  settle('cancel');
  closeDialog(modal);

  fillText(request);
  fillBadges(request.levels);
  fillThumbnails(request.levels);
  show(byId('share-preview-status'), request.duplicate);
  show(byId('share-preview-import-btn'), !request.duplicate);
  show(byId('share-preview-import-play-btn'), !request.duplicate);
  show(byId('share-preview-play-btn'), request.duplicate);

  return new Promise<SharePreviewChoice>((resolve) => {
    pendingResolve = resolve;
    openDialog(modal, document.activeElement as HTMLElement | null, {
      initialFocus: cancel,
      onClose: () => {
        thumbs?.dispose();
        thumbs = null;
        settle('cancel');
      }
    });
  });
}
