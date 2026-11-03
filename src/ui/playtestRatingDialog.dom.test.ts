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
import { mountModals, pressKey, resetWindowListeners, stubLayout, trackWindowListeners } from '../test/domFixture';

const LIMITS = { ratingMin: 1, ratingMax: 5, noteMaxLength: 12 };
const REQUEST = { limits: LIMITS, levelText: 'Level 7 solved.' };

let askPlaytestRating: typeof import('./playtestRatingDialog').askPlaytestRating;
let openDialog: typeof import('./dialog').openDialog;
let closeDialog: typeof import('./dialog').closeDialog;

function modal(): HTMLElement {
  return document.getElementById('playtest-rating-modal') as HTMLElement;
}

function pick(name: string, value: string): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (!radio) throw new Error(`No radio ${name}=${value}`);
  radio.checked = true;
}

function submit(): void {
  const form = document.getElementById('playtest-rating-form') as HTMLFormElement;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

// The dialogs keep module-level state (open stack, bound listeners): load a fresh copy per test.
beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  mountModals('playtest-rating-modal', 'confirm-modal');
  ({ askPlaytestRating } = await import('./playtestRatingDialog'));
  ({ openDialog, closeDialog } = await import('./dialog'));
});

afterEach(resetWindowListeners);

describe('playtest rating dialog (DOM)', () => {
  it('opens with one radio per rating value on both scales', () => {
    void askPlaytestRating(REQUEST);
    expect(modal().classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#playtest-rating-difficulty input')).toHaveLength(5);
    expect(document.querySelectorAll('#playtest-rating-fun input')).toHaveLength(5);
    expect(document.getElementById('playtest-rating-level')?.textContent).toBe('Level 7 solved.');
    expect(document.getElementById('playtest-rating-note')?.getAttribute('maxlength')).toBe('12');
  });

  it('resolves with the ratings, the aha answer and the trimmed note', async () => {
    const answer = askPlaytestRating(REQUEST);
    pick('playtest-rating-difficulty', '4');
    pick('playtest-rating-fun', '2');
    pick('playtest-rating-aha', 'yes');
    (document.getElementById('playtest-rating-note') as HTMLTextAreaElement).value = '  stuck at the door  ';
    submit();
    expect(await answer).toEqual({ difficulty: 4, fun: 2, aha: true, note: 'stuck at the' });
    expect(modal().classList.contains('hidden')).toBe(true);
  });

  it('accepts a partial answer and reports the rest as unanswered', async () => {
    const answer = askPlaytestRating(REQUEST);
    pick('playtest-rating-aha', 'no');
    submit();
    expect(await answer).toEqual({ difficulty: null, fun: null, aha: false, note: '' });
  });

  it('resolves null on Escape and never blocks play', async () => {
    const answer = askPlaytestRating(REQUEST);
    pressKey(document.activeElement as Element, 'Escape');
    expect(await answer).toBeNull();
    expect(modal().classList.contains('hidden')).toBe(true);
  });

  it('resolves null on Skip and on the backdrop', async () => {
    const skipped = askPlaytestRating(REQUEST);
    (document.getElementById('playtest-rating-skip-btn') as HTMLButtonElement).click();
    expect(await skipped).toBeNull();

    const dismissed = askPlaytestRating(REQUEST);
    modal().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await dismissed).toBeNull();
  });

  it('starts with nothing checked and an empty note after an earlier answer', async () => {
    const first = askPlaytestRating(REQUEST);
    pick('playtest-rating-difficulty', '3');
    pick('playtest-rating-aha', 'yes');
    (document.getElementById('playtest-rating-note') as HTMLTextAreaElement).value = 'old';
    submit();
    await first;

    void askPlaytestRating(REQUEST);
    expect(document.querySelectorAll('input:checked')).toHaveLength(0);
    expect((document.getElementById('playtest-rating-note') as HTMLTextAreaElement).value).toBe('');
  });

  it('waits for a dialog already open instead of stacking on it', async () => {
    const confirm = document.getElementById('confirm-modal') as HTMLElement;
    openDialog(confirm, null);
    const answer = askPlaytestRating(REQUEST);
    expect(modal().classList.contains('hidden')).toBe(true);
    closeDialog(confirm);
    expect(modal().classList.contains('hidden')).toBe(false);
    pressKey(document.activeElement as Element, 'Escape');
    expect(await answer).toBeNull();
  });

  it('resolves a request replaced before it showed as skipped', async () => {
    const confirm = document.getElementById('confirm-modal') as HTMLElement;
    openDialog(confirm, null);
    const first = askPlaytestRating(REQUEST);
    const second = askPlaytestRating(REQUEST);
    expect(await first).toBeNull();
    closeDialog(confirm);
    expect(modal().classList.contains('hidden')).toBe(false);
    (document.getElementById('playtest-rating-skip-btn') as HTMLButtonElement).click();
    expect(await second).toBeNull();
  });
});
