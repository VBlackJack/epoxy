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

import type { PlaytestConfig } from '../core/types';
import type { PlaytestRating } from '../playtest/PlaytestRecorder';
import { closeDialog, openDialog, whenNoDialogOpen } from './dialog';

const MODAL_ID = 'playtest-rating-modal';
const FORM_ID = 'playtest-rating-form';
const SKIP_ID = 'playtest-rating-skip-btn';
const NOTE_ID = 'playtest-rating-note';
const LEVEL_ID = 'playtest-rating-level';
const DIFFICULTY_SCALE_ID = 'playtest-rating-difficulty';
const FUN_SCALE_ID = 'playtest-rating-fun';
const AHA_NAME = 'playtest-rating-aha';
const AHA_YES = 'yes';
const SCALE_OPTION_CLASS = 'playtest-scale-option';

export interface PlaytestRatingRequest {
  limits: Pick<PlaytestConfig, 'ratingMin' | 'ratingMax' | 'noteMaxLength'>;
  /** Already translated line telling which level is rated. */
  levelText: string;
}

let pendingResolve: ((rating: PlaytestRating | null) => void) | null = null;
let listenersBound = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function settle(rating: PlaytestRating | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(rating);
}

/** Replaces the options of a 1..N scale with one radio per value. */
function renderScale(container: HTMLElement, name: string, limits: PlaytestRatingRequest['limits']): void {
  container.innerHTML = '';
  for (let value = limits.ratingMin; value <= limits.ratingMax; value += 1) {
    const label = document.createElement('label');
    label.className = SCALE_OPTION_CLASS;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = name;
    radio.value = String(value);
    const text = document.createElement('span');
    text.textContent = String(value);
    label.append(radio, text);
    container.appendChild(label);
  }
}

function readScale(form: HTMLFormElement, name: string): number | null {
  const checked = form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return checked ? Number(checked.value) : null;
}

function readAha(form: HTMLFormElement): boolean | null {
  const checked = form.querySelector<HTMLInputElement>(`input[name="${AHA_NAME}"]:checked`);
  if (!checked) return null;
  return checked.value === AHA_YES;
}

/** The rating the form holds now. */
export function readRating(form: HTMLFormElement, noteMaxLength: number): PlaytestRating {
  const note = byId<HTMLTextAreaElement>(NOTE_ID)?.value ?? '';
  return {
    difficulty: readScale(form, DIFFICULTY_SCALE_ID),
    fun: readScale(form, FUN_SCALE_ID),
    aha: readAha(form),
    note: note.trim().slice(0, noteMaxLength)
  };
}

function bindListenersOnce(modal: HTMLElement, form: HTMLFormElement, noteMaxLength: number): void {
  if (listenersBound) return;
  listenersBound = true;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    settle(readRating(form, noteMaxLength));
    closeDialog(modal);
  });
  byId(SKIP_ID)?.addEventListener('click', () => closeDialog(modal));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDialog(modal);
  });
}

/**
 * Asks the tester to rate the level just played. Never blocks: Escape, the
 * backdrop and Skip all resolve null, and the form waits for any dialog
 * already open instead of stacking on it.
 */
export function askPlaytestRating(request: PlaytestRatingRequest): Promise<PlaytestRating | null> {
  const modal = byId(MODAL_ID);
  const form = byId<HTMLFormElement>(FORM_ID);
  const difficulty = byId(DIFFICULTY_SCALE_ID);
  const fun = byId(FUN_SCALE_ID);
  const note = byId<HTMLTextAreaElement>(NOTE_ID);
  if (!modal || !form || !difficulty || !fun || !note) return Promise.resolve(null);
  bindListenersOnce(modal, form, request.limits.noteMaxLength);
  // A form still open is abandoned, never left hanging.
  settle(null);
  closeDialog(modal);

  renderScale(difficulty, DIFFICULTY_SCALE_ID, request.limits);
  renderScale(fun, FUN_SCALE_ID, request.limits);
  form.querySelectorAll<HTMLInputElement>(`input[name="${AHA_NAME}"]`).forEach((radio) => {
    radio.checked = false;
  });
  note.value = '';
  note.maxLength = request.limits.noteMaxLength;
  const levelEl = byId(LEVEL_ID);
  if (levelEl) levelEl.textContent = request.levelText;

  return new Promise<PlaytestRating | null>((resolve) => {
    pendingResolve = resolve;
    whenNoDialogOpen(() => {
      // Superseded by a later request while waiting for another dialog to close.
      if (pendingResolve !== resolve) return;
      openDialog(modal, document.activeElement as HTMLElement | null, {
        initialFocus: difficulty.querySelector<HTMLElement>('input'),
        onClose: () => settle(null)
      });
    });
  });
}
