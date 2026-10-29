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

/**
 * Modal dialog helper shared by every modal and the options drawer: shows the
 * element, moves focus inside, traps Tab, closes on Escape and gives focus
 * back to the element that opened it. Dialogs stack; only the top one reacts.
 */

const HIDDEN_CLASS = 'hidden';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');
const NOT_FOCUSABLE_TABINDEX = '-1';

export interface DialogOptions {
  /** Element focused on open; defaults to the first focusable element. */
  initialFocus?: HTMLElement | null;
  /** Called after the dialog is hidden, whatever closed it. */
  onClose?: () => void;
}

interface OpenDialogEntry {
  el: HTMLElement;
  opener: HTMLElement | null;
  onClose?: () => void;
}

const openStack: OpenDialogEntry[] = [];
let keyListenerBound = false;

/**
 * Index of the element that receives focus when Tab is pressed inside a
 * trap of `count` elements. `currentIndex` is -1 when focus is outside.
 */
export function computeTrapFocusIndex(currentIndex: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= count) {
    return backwards ? count - 1 : 0;
  }
  return backwards ? (currentIndex - 1 + count) % count : (currentIndex + 1) % count;
}

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && !el.closest(`.${HIDDEN_CLASS}`);
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

function topDialog(): OpenDialogEntry | undefined {
  return openStack[openStack.length - 1];
}

function handleKeydown(e: KeyboardEvent): void {
  const top = topDialog();
  if (!top) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeDialog(top.el);
    return;
  }

  if (e.key === 'Tab') {
    const focusables = getFocusableElements(top.el);
    e.preventDefault();
    e.stopPropagation();
    if (focusables.length === 0) {
      top.el.focus();
      return;
    }
    const current = focusables.indexOf(document.activeElement as HTMLElement);
    const next = computeTrapFocusIndex(current, focusables.length, e.shiftKey);
    focusables[next]?.focus();
  }
}

function ensureKeyListener(): void {
  if (keyListenerBound) return;
  // Capture phase on window runs before the game's own keyboard handler.
  window.addEventListener('keydown', handleKeydown, true);
  keyListenerBound = true;
}

export function isDialogOpen(el?: HTMLElement | null): boolean {
  if (!el) return openStack.length > 0;
  return openStack.some((entry) => entry.el === el);
}

export function openDialog(
  el: HTMLElement,
  opener: HTMLElement | null = (document.activeElement as HTMLElement | null),
  options: DialogOptions = {}
): void {
  if (isDialogOpen(el)) return;
  ensureKeyListener();
  el.classList.remove(HIDDEN_CLASS);
  openStack.push({ el, opener, onClose: options.onClose });

  const target = options.initialFocus ?? getFocusableElements(el)[0] ?? el;
  if (target === el && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', NOT_FOCUSABLE_TABINDEX);
  }
  target.focus();
}

/** Closes the given dialog, or the top one when called without argument. */
export function closeDialog(el?: HTMLElement | null): void {
  const idx = el ? openStack.findIndex((entry) => entry.el === el) : openStack.length - 1;
  if (idx < 0) {
    el?.classList.add(HIDDEN_CLASS);
    return;
  }
  const [entry] = openStack.splice(idx, 1);
  entry.el.classList.add(HIDDEN_CLASS);
  entry.onClose?.();
  if (entry.opener && entry.opener.isConnected) {
    entry.opener.focus();
  }
}
