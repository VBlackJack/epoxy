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
import { pressKey, resetWindowListeners, stubLayout, trackWindowListeners } from '../test/domFixture';
import type { ConvertReportRequest } from './convertReportDialog';

const request: ConvertReportRequest = {
  levelTitle: 'Level <b>one</b>',
  exactCount: 5,
  approx: [{ name: 'Bomb', label: 'Bomb blast rules differ from CC3D.' }],
  lost: [
    { name: 'Trap without a control', label: 'No trap control works this trap.' },
    { name: 'Bomb sharing a cell', label: 'The bomb is dropped.' }
  ],
  errors: ['The level has no exit.']
};

let showConvertReport: typeof import('./convertReportDialog').showConvertReport;

function modal(): HTMLElement {
  return document.getElementById('convert-report-modal') as HTMLElement;
}

function button(id: string): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}

function bodyText(): string {
  return document.getElementById('convert-report-body')?.textContent ?? '';
}

// The dialog keeps module-level state (pending answer, bound listeners): load a fresh copy per test.
beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  document.body.innerHTML = '';
  const { i18n } = await import('../i18n/I18nManager');
  i18n.setLocale('en');
  ({ showConvertReport } = await import('./convertReportDialog'));
});

afterEach(resetWindowListeners);

describe('showConvertReport (DOM)', () => {
  it('is a labelled modal dialog, with focus on Cancel', async () => {
    const answer = showConvertReport(request);
    expect(modal().getAttribute('role')).toBe('dialog');
    expect(modal().getAttribute('aria-modal')).toBe('true');
    const label = document.getElementById(modal().getAttribute('aria-labelledby') ?? '');
    expect(label?.textContent).toBe('Convert to Epoxy');
    expect(document.activeElement).toBe(button('convert-report-cancel-btn'));
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });

  it('shows the counts and the rules warning before the detail, and the title as text only', async () => {
    const answer = showConvertReport(request);
    const text = bodyText();
    expect(text).toContain('5 elements are played as in CC3D.');
    expect(text).toContain('1 element is approximated.');
    expect(text).toContain('2 elements are lost.');
    expect(text).toContain('The rules differ: the converted level may not be solvable.');
    expect(text).toContain('Level <b>one</b>');
    expect(document.querySelector('#convert-report-body b')).toBeNull();
    expect(text.indexOf('The rules differ')).toBeLessThan(text.indexOf('Details of the approximations and losses'));
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });

  it('lists every approximation and loss with its reason in a collapsed, keyboard-reachable detail', async () => {
    const answer = showConvertReport(request);
    const detail = document.getElementById('convert-report-detail') as HTMLDetailsElement;
    expect(detail.tagName).toBe('DETAILS');
    expect(detail.open).toBe(false);
    expect(detail.querySelector('summary')).not.toBeNull();
    const items = Array.from(detail.querySelectorAll('li')).map((li) => li.textContent);
    expect(items).toEqual([
      'Bomb: Bomb blast rules differ from CC3D.',
      'Trap without a control: No trap control works this trap.',
      'Bomb sharing a cell: The bomb is dropped.'
    ]);
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });

  it('lists the validator errors with the note that saving is still allowed', async () => {
    const answer = showConvertReport(request);
    expect(document.querySelector('.convert-report-errors li')?.textContent).toBe('The level has no exit.');
    expect(bodyText()).toContain('You can still save it.');
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });

  it('shows no error section when the converted level has no error', async () => {
    const answer = showConvertReport({ ...request, errors: [] });
    expect(document.querySelector('.convert-report-errors')).toBeNull();
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });

  it('answers true on Continue and closes', async () => {
    const answer = showConvertReport(request);
    button('convert-report-continue-btn').click();
    expect(await answer).toBe(true);
    expect(modal().classList.contains('hidden')).toBe(true);
  });

  it('answers false on Cancel, on Escape and on the backdrop', async () => {
    let answer = showConvertReport(request);
    button('convert-report-cancel-btn').click();
    expect(await answer).toBe(false);

    answer = showConvertReport(request);
    pressKey(document.activeElement as Element, 'Escape');
    expect(await answer).toBe(false);

    answer = showConvertReport(request);
    modal().click();
    expect(await answer).toBe(false);
    expect(modal().classList.contains('hidden')).toBe(true);
  });

  it('says so when nothing was approximated or lost', async () => {
    const answer = showConvertReport({ ...request, approx: [], lost: [], errors: [] });
    expect(document.getElementById('convert-report-detail')?.textContent).toContain('Nothing was approximated or lost.');
    pressKey(document.activeElement as Element, 'Escape');
    await answer;
  });
});
