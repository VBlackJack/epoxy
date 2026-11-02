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

import { PACK_NAME_MAX_LENGTH } from '../config/constants';
import { t } from '../i18n/I18nManager';
import { normalizePackName } from '../packs/userPacks';
import { closeDialog, openDialog } from './dialog';

const MODAL_ID = 'save-into-modal';
const FORM_ID = 'save-into-form';
const LIST_ID = 'save-into-list';
const NEW_RADIO_ID = 'save-into-new-radio';
const NEW_NAME_ID = 'save-into-new-name';
const CANCEL_ID = 'save-into-cancel-btn';
const RADIO_ID_PREFIX = 'save-into-pack-';

/** A pack the level can be saved into. */
export interface SaveIntoPack {
  id: string;
  label: string;
  levelCount: number;
}

export interface SaveIntoRequest {
  packs: readonly SaveIntoPack[];
  /** Pack checked on open; none checks "New pack". */
  preselectId: string | null;
  /** Name proposed for a new pack, already translated. */
  defaultNewName: string;
}

export type SaveIntoChoice = { kind: 'existing'; packId: string } | { kind: 'new'; name: string };

let pendingResolve: ((choice: SaveIntoChoice | null) => void) | null = null;
let listenersBound = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function settle(choice: SaveIntoChoice | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(choice);
}

/** The choice the form currently holds; null when "New pack" is checked with a blank name. */
function readChoice(form: HTMLFormElement): SaveIntoChoice | null {
  const newRadio = byId<HTMLInputElement>(NEW_RADIO_ID);
  const newName = byId<HTMLInputElement>(NEW_NAME_ID);
  if (newRadio?.checked) {
    const name = normalizePackName(newName?.value ?? '');
    return name === '' ? null : { kind: 'new', name };
  }
  const checked = form.querySelector<HTMLInputElement>(`#${LIST_ID} input[type="radio"]:checked`);
  return checked ? { kind: 'existing', packId: checked.value } : null;
}

function bindListenersOnce(modal: HTMLElement, form: HTMLFormElement): void {
  if (listenersBound) return;
  listenersBound = true;
  const newRadio = byId<HTMLInputElement>(NEW_RADIO_ID);
  const newName = byId<HTMLInputElement>(NEW_NAME_ID);
  if (newName) newName.maxLength = PACK_NAME_MAX_LENGTH;

  // Only typing selects "New pack": tabbing through the field must not change the destination.
  newName?.addEventListener('input', () => {
    if (newRadio) newRadio.checked = true;
    newName.removeAttribute('aria-invalid');
  });
  // Enter in the name field creates the pack and saves in one step, whatever was checked.
  newName?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newRadio) newRadio.checked = true;
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const choice = readChoice(form);
    if (!choice) {
      newName?.setAttribute('aria-invalid', 'true');
      newName?.focus();
      return;
    }
    settle(choice);
    closeDialog(modal);
  });
  byId(CANCEL_ID)?.addEventListener('click', () => closeDialog(modal));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDialog(modal);
  });
}

function renderOptions(request: SaveIntoRequest): HTMLInputElement | null {
  const list = byId(LIST_ID);
  if (!list) return null;
  list.innerHTML = '';
  let preselected: HTMLInputElement | null = null;
  request.packs.forEach((pack, index) => {
    const row = document.createElement('div');
    row.className = 'save-into-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'save-into-choice';
    radio.id = `${RADIO_ID_PREFIX}${index}`;
    radio.value = pack.id;
    const label = document.createElement('label');
    label.htmlFor = radio.id;
    label.textContent = `${pack.label} (${t('app.packs.manager.library.count.label', { count: pack.levelCount })})`;
    row.append(radio, label);
    list.appendChild(row);
    if (pack.id === request.preselectId) preselected = radio;
  });
  return preselected;
}

/**
 * Asks which pack receives the level: one of the editable packs, or a new one
 * (Enter in the name field creates it and saves in one step). Resolves null
 * when the player cancels.
 */
export function askSaveInto(request: SaveIntoRequest): Promise<SaveIntoChoice | null> {
  const modal = byId(MODAL_ID);
  const form = byId<HTMLFormElement>(FORM_ID);
  const newRadio = byId<HTMLInputElement>(NEW_RADIO_ID);
  const newName = byId<HTMLInputElement>(NEW_NAME_ID);
  if (!modal || !form || !newRadio || !newName) return Promise.resolve(null);
  bindListenersOnce(modal, form);
  // A question still open is abandoned, never left hanging.
  settle(null);
  closeDialog(modal);

  const preselected = renderOptions(request);
  newName.value = request.defaultNewName;
  newName.removeAttribute('aria-invalid');
  const initial = preselected ?? newRadio;
  initial.checked = true;

  return new Promise<SaveIntoChoice | null>((resolve) => {
    pendingResolve = resolve;
    openDialog(modal, document.activeElement as HTMLElement | null, {
      initialFocus: initial,
      onClose: () => settle(null)
    });
  });
}
