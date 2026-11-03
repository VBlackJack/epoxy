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
import { mountModals, pressKey, resetWindowListeners, trackWindowListeners, stubLayout } from '../test/domFixture';

const request = {
  title: 'Delete?',
  message: 'Really?',
  cancelLabel: 'Cancel',
  options: [
    { id: 'export', label: 'Export first', keepOpen: true },
    { id: 'delete', label: 'Delete', primary: true }
  ]
};

function buttons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('#choice-modal-actions button'));
}

let choiceDialog: typeof import('./choiceDialog').choiceDialog;
let confirmDialog: typeof import('./confirmDialog').confirmDialog;

// The dialogs keep module-level state (open stack, bound listeners): load a fresh copy per test.
beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  mountModals('choice-modal', 'confirm-modal');
  ({ choiceDialog } = await import('./choiceDialog'));
  ({ confirmDialog } = await import('./confirmDialog'));
});

afterEach(resetWindowListeners);

describe('choiceDialog (DOM)', () => {
  it('resolves to null on Escape, never to an option', async () => {
    const answer = choiceDialog(request);
    pressKey(document.activeElement as Element, 'Escape');
    expect(await answer).toBeNull();
    expect(document.getElementById('choice-modal')?.classList.contains('hidden')).toBe(true);
  });

  it('starts on Cancel, not on the destructive option', async () => {
    const answer = choiceDialog(request);
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons()[0].textContent).toBe('Cancel');
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });

  it('resolves to the id of the clicked option', async () => {
    const answer = choiceDialog(request);
    buttons().find((b) => b.textContent === 'Delete')?.click();
    expect(await answer).toBe('delete');
  });

  it('keeps the dialog open after a keep-open option and then still answers null on Escape', async () => {
    const answer = choiceDialog(request);
    buttons().find((b) => b.textContent === 'Export first')?.click();
    expect(document.getElementById('choice-modal')?.classList.contains('hidden')).toBe(false);
    pressKey(document.activeElement as Element, 'Escape');
    expect(await answer).toBeNull();
  });

  it('wraps Tab from the last button to the first and Shift+Tab back', async () => {
    const answer = choiceDialog(request);
    const all = buttons();
    all[all.length - 1].focus();
    pressKey(document.activeElement as Element, 'Tab');
    expect(document.activeElement).toBe(all[0]);
    pressKey(document.activeElement as Element, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(all[all.length - 1]);
    pressKey(document.activeElement as Element, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(all[all.length - 2]);
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });
});

describe('confirmDialog (DOM)', () => {
  const options = { title: 'T', message: 'M', confirmLabel: 'Yes', cancelLabel: 'No' };

  it('resolves to false on Escape', async () => {
    const answer = confirmDialog(options);
    pressKey(document.activeElement as Element, 'Escape');
    expect(await answer).toBe(false);
  });

  it('resolves to true only on the confirm button', async () => {
    const answer = confirmDialog(options);
    document.getElementById('confirm-ok-btn')?.click();
    expect(await answer).toBe(true);
  });

  it('starts on Cancel and wraps Tab between its two buttons', async () => {
    const answer = confirmDialog(options);
    const cancel = document.getElementById('confirm-cancel-btn') as HTMLElement;
    const ok = document.getElementById('confirm-ok-btn') as HTMLElement;
    expect(document.activeElement).toBe(cancel);
    pressKey(cancel, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(ok);
    pressKey(ok, 'Tab');
    expect(document.activeElement).toBe(cancel);
    pressKey(cancel, 'Escape');
    expect(await answer).toBe(false);
  });
});
