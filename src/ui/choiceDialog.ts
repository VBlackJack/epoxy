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

import { closeDialog, openDialog } from './dialog';

const MODAL_ID = 'choice-modal';
const TITLE_ID = 'choice-modal-title';
const MESSAGE_ID = 'choice-modal-message';
const NOTE_ID = 'choice-modal-note';
const ACTIONS_ID = 'choice-modal-actions';

/** One answer other than "cancel". */
export interface ChoiceOption {
  id: string;
  label: string;
  primary?: boolean;
  /** The dialog stays open after this option, e.g. an export done before a deletion. */
  keepOpen?: boolean;
  /** Runs when the option is chosen; a returned text is announced in the dialog. */
  onSelect?: () => string | void;
}

export interface ChoiceRequest {
  title: string;
  message: string;
  options: readonly ChoiceOption[];
  /** Label of the Cancel button; Cancel, Escape and the backdrop all answer null and do nothing else. */
  cancelLabel: string;
}

/** The option with this id, or null. */
export function findOption(options: readonly ChoiceOption[], id: string): ChoiceOption | null {
  return options.find((option) => option.id === id) ?? null;
}

/** True when choosing the option ends the dialog. */
export function closesDialog(option: ChoiceOption): boolean {
  return option.keepOpen !== true;
}

let pendingResolve: ((id: string | null) => void) | null = null;
let listenersBound = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function settle(id: string | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(id);
}

function bindOnce(modal: HTMLElement): void {
  if (listenersBound) return;
  listenersBound = true;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDialog(modal);
  });
}

/**
 * Asks a question with several answers. Focus starts on Cancel; Cancel, Escape
 * and the backdrop resolve null and never trigger one of the options.
 */
export function choiceDialog(request: ChoiceRequest): Promise<string | null> {
  const modal = byId(MODAL_ID);
  const actions = byId(ACTIONS_ID);
  if (!modal || !actions) return Promise.resolve(null);
  bindOnce(modal);
  // A question still open is abandoned, never left hanging.
  settle(null);
  closeDialog(modal);

  const titleEl = byId(TITLE_ID);
  const messageEl = byId(MESSAGE_ID);
  const noteEl = byId(NOTE_ID);
  if (titleEl) titleEl.textContent = request.title;
  if (messageEl) messageEl.textContent = request.message;
  if (noteEl) noteEl.textContent = '';

  actions.innerHTML = '';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'action-btn';
  cancel.textContent = request.cancelLabel;
  cancel.addEventListener('click', () => closeDialog(modal));
  actions.appendChild(cancel);
  for (const option of request.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `action-btn${option.primary ? ' primary' : ''}`;
    button.textContent = option.label;
    button.addEventListener('click', () => {
      const note = option.onSelect?.();
      if (noteEl && typeof note === 'string') noteEl.textContent = note;
      if (!closesDialog(option)) return;
      settle(option.id);
      closeDialog(modal);
    });
    actions.appendChild(button);
  }

  return new Promise<string | null>((resolve) => {
    pendingResolve = resolve;
    openDialog(modal, document.activeElement as HTMLElement | null, {
      initialFocus: cancel,
      onClose: () => settle(null)
    });
  });
}
