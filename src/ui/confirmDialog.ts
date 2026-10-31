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

const CONFIRM_MODAL_ID = 'confirm-modal';
const CONFIRM_TITLE_ID = 'confirm-modal-title';
const CONFIRM_MESSAGE_ID = 'confirm-modal-message';
const CONFIRM_OK_ID = 'confirm-ok-btn';
const CONFIRM_CANCEL_ID = 'confirm-cancel-btn';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

let pendingResolve: ((confirmed: boolean) => void) | null = null;
let listenersBound = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function settle(confirmed: boolean): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(confirmed);
}

function bindListenersOnce(modal: HTMLElement): void {
  if (listenersBound) return;
  listenersBound = true;
  byId(CONFIRM_OK_ID)?.addEventListener('click', () => {
    settle(true);
    closeDialog(modal);
  });
  byId(CONFIRM_CANCEL_ID)?.addEventListener('click', () => {
    closeDialog(modal);
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDialog(modal);
  });
}

/**
 * Asks a yes/no question in the game's own dialog layer. Focus starts on the
 * safe (cancel) button; Escape, the backdrop and Cancel all answer false.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const modal = byId(CONFIRM_MODAL_ID);
  const cancelBtn = byId(CONFIRM_CANCEL_ID);
  if (!modal || !cancelBtn) return Promise.resolve(false);
  bindListenersOnce(modal);
  // A question still open is abandoned, never left hanging.
  settle(false);
  closeDialog(modal);

  const titleEl = byId(CONFIRM_TITLE_ID);
  const messageEl = byId(CONFIRM_MESSAGE_ID);
  const okBtn = byId(CONFIRM_OK_ID);
  if (titleEl) titleEl.textContent = options.title;
  if (messageEl) messageEl.textContent = options.message;
  if (okBtn) okBtn.textContent = options.confirmLabel;
  cancelBtn.textContent = options.cancelLabel;

  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    openDialog(modal, document.activeElement as HTMLElement | null, {
      initialFocus: cancelBtn,
      onClose: () => settle(false)
    });
  });
}
