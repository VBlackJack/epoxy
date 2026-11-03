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
import { mountModals, pressKey, resetWindowListeners, stubLayout } from './domFixture';

const request = {
  packs: [
    { id: 'a', label: 'Alpha', levelCount: 2 },
    { id: 'b', label: 'Beta', levelCount: 0 }
  ],
  preselectId: 'a',
  defaultNewName: 'My new pack'
};

let askSaveInto: typeof import('./saveIntoDialog').askSaveInto;

// The dialog keeps module-level state (pending answer, bound listeners): load a fresh copy per test.
beforeEach(async () => {
  vi.resetModules();
  stubLayout();
  mountModals('save-into-modal');
  ({ askSaveInto } = await import('./saveIntoDialog'));
});

afterEach(resetWindowListeners);

function newName(): HTMLInputElement {
  return document.getElementById('save-into-new-name') as HTMLInputElement;
}

function form(): HTMLFormElement {
  return document.getElementById('save-into-form') as HTMLFormElement;
}

function checkedValue(): string | undefined {
  return document.querySelector<HTMLInputElement>('input[name="save-into-choice"]:checked')?.id;
}

describe('askSaveInto (DOM)', () => {
  it('checks the preselected pack and lists every pack', async () => {
    const answer = askSaveInto(request);
    expect(document.querySelectorAll('#save-into-list input[type="radio"]')).toHaveLength(2);
    expect(document.querySelector<HTMLInputElement>('#save-into-list input:checked')?.value).toBe('a');
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });

  it('keeps the selected target when Tab moves focus through the name field', async () => {
    const answer = askSaveInto(request);
    const before = checkedValue();
    for (let i = 0; i < 6; i++) {
      pressKey(document.activeElement as Element, 'Tab');
      expect(checkedValue()).toBe(before);
    }
    newName().focus();
    expect(document.activeElement).toBe(newName());
    expect(checkedValue()).toBe(before);
    form().requestSubmit();
    expect(await answer).toEqual({ kind: 'existing', packId: 'a' });
  });

  it('selects "New pack" only when the player types in the name field', async () => {
    const answer = askSaveInto(request);
    newName().value = 'Typed';
    newName().dispatchEvent(new Event('input', { bubbles: true }));
    expect((document.getElementById('save-into-new-radio') as HTMLInputElement).checked).toBe(true);
    form().requestSubmit();
    expect(await answer).toEqual({ kind: 'new', name: 'Typed' });
  });

  it('creates and saves in one step on Enter in the name field, whatever was checked', async () => {
    const answer = askSaveInto(request);
    newName().focus();
    pressKey(newName(), 'Enter');
    expect((document.getElementById('save-into-new-radio') as HTMLInputElement).checked).toBe(true);
    form().requestSubmit();
    expect(await answer).toEqual({ kind: 'new', name: 'My new pack' });
    expect(document.getElementById('save-into-modal')?.classList.contains('hidden')).toBe(true);
  });

  it('does not close on a blank new name and flags the field', async () => {
    const answer = askSaveInto({ ...request, preselectId: null, defaultNewName: '' });
    form().requestSubmit();
    expect(newName().getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('save-into-modal')?.classList.contains('hidden')).toBe(false);
    pressKey(newName(), 'Escape');
    expect(await answer).toBeNull();
  });

  it('resolves to null on Escape', async () => {
    const answer = askSaveInto(request);
    pressKey(document.activeElement as Element, 'Escape');
    expect(await answer).toBeNull();
    expect(document.getElementById('save-into-modal')?.classList.contains('hidden')).toBe(true);
  });

  it('resolves to null on the Cancel button', async () => {
    const answer = askSaveInto(request);
    document.getElementById('save-into-cancel-btn')?.click();
    expect(await answer).toBeNull();
  });
});
