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

import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { lynxLevel } from '../core/lynx/lynxTestMaps';
import type { CompiledLevel, LevelPack } from '../core/types';
import { parseTwsIndex } from '../formats/TwsCodec';
import { mountModals, settleAsync, stubLayout } from '../test/domFixture';
import { FakeKeyedIndexedDb } from '../test/FakeKeyedIndexedDb';
import { twsFileBytes, twsSolutionRecord } from '../test/twsTestBytes';

const fake = new FakeKeyedIndexedDb();

let packs: LevelPack[];
let notify: Mock<(message: string) => void>;
let section: import('./twsPackSection').TwsPackSection;
let files: (typeof import('../storage/TwsFiles'))['TwsFiles'];
let isOpen: boolean;

function cclpLevel(number: number): CompiledLevel {
  return { ...lynxLevel(['###', '#@#', '###'], { number }), rulesProfile: 'cclp' } as CompiledLevel;
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#packs-tws-list .packs-tws-row'));
}

function button(row: HTMLElement, action: 'load' | 'forget'): HTMLButtonElement {
  return row.querySelector(`[data-tws-focus$=":${action}"]`) as HTMLButtonElement;
}

beforeEach(async () => {
  (globalThis as { indexedDB?: unknown }).indexedDB = fake;
  fake.records.clear();
  fake.abortWrites = false;
  vi.resetModules();
  stubLayout();
  mountModals('packs-modal', 'confirm-modal');
  const { i18n } = await import('../i18n/I18nManager');
  i18n.setLocale('en');
  const { ConfigRegistry } = await import('../config/ConfigRegistry');
  const { loadTestConfigs } = await import('../test/loadTestConfigs');
  loadTestConfigs();
  ({ TwsFiles: files } = await import('../storage/TwsFiles'));
  packs = [
    { id: 'epoxy', name: 'Epoxy pack', builtIn: true, levels: [{ ...lynxLevel(['###', '#@#', '###']), ruleset: 'epoxy' } as CompiledLevel] },
    { id: 'cclp_a', name: 'CCLP A', builtIn: true, levels: [cclpLevel(1), cclpLevel(2)] },
    { id: 'imported', name: 'Imported CC1', levels: [cclpLevel(1)] }
  ];
  vi.spyOn(ConfigRegistry, 'getAllPacks').mockImplementation(() => packs);
  notify = vi.fn<(message: string) => void>();
  isOpen = true;
  const { TwsPackSection } = await import('./twsPackSection');
  section = new TwsPackSection({ isOpen: () => isOpen, notify: (m) => notify(m), packDisplayName: (p) => p.name });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('the Tile World solutions section of the pack manager (DOM)', () => {
  it('lists the CCLP engine packs only, built in and imported, each with a Load button and a disabled Forget', async () => {
    section.render();
    expect(document.getElementById('packs-tws')?.classList.contains('hidden')).toBe(false);
    expect(rows().map((row) => row.dataset.packId)).toEqual(['cclp_a', 'imported']);
    await settleAsync();
    for (const row of rows()) {
      expect(row.querySelector('.packs-tws-status')?.textContent).toBe('No file loaded');
      expect(button(row, 'load').textContent).toBe('Load a file');
      expect(button(row, 'load').disabled).toBe(false);
      expect(button(row, 'forget').disabled).toBe(true);
    }
  });

  it('is hidden when no pack can play a Tile World file', () => {
    packs = [packs[0]];
    section.render();
    expect(document.getElementById('packs-tws')?.classList.contains('hidden')).toBe(true);
    expect(rows()).toEqual([]);
  });

  it('shows the file of a pack with Load another file and Forget once one is loaded', async () => {
    const bytes = twsFileBytes(1, [twsSolutionRecord({ number: 1, password: 'TEST', moves: [] })]);
    const limits = { maxFileBytes: 4096, maxSolutionTicks: 1000, maxSetNameChars: 64 };
    await files.adopt('cclp_a', 'mine.tws', bytes, parseTwsIndex(bytes, limits));
    section.render();
    await settleAsync();
    const row = rows().find((r) => r.dataset.packId === 'cclp_a');
    expect(row?.querySelector('.packs-tws-status')?.textContent).toBe('File: mine.tws');
    expect(row && button(row, 'load').textContent).toBe('Load another file');
    expect(row && button(row, 'forget').disabled).toBe(false);
    const other = rows().find((r) => r.dataset.packId === 'imported');
    expect(other && button(other, 'forget').disabled).toBe(true);
  });

  it('forgets the file after a confirmation, and does nothing when the player cancels', async () => {
    const bytes = twsFileBytes(1, [twsSolutionRecord({ number: 1, password: 'TEST', moves: [] })]);
    const limits = { maxFileBytes: 4096, maxSolutionTicks: 1000, maxSetNameChars: 64 };
    await files.adopt('cclp_a', 'mine.tws', bytes, parseTwsIndex(bytes, limits));
    section.render();
    await settleAsync();
    const forget = (): HTMLButtonElement => button(rows()[0], 'forget');

    forget().click();
    await settleAsync();
    expect(document.getElementById('confirm-modal-message')?.textContent).toBe(
      'Forget the solution file of "CCLP A"? You can load it again from your computer.'
    );
    (document.getElementById('confirm-cancel-btn') as HTMLButtonElement).click();
    await settleAsync();
    expect(files.peek('cclp_a')).toMatchObject({ kind: 'ready' });
    expect(notify).not.toHaveBeenCalled();

    forget().click();
    await settleAsync();
    (document.getElementById('confirm-ok-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(files.peek('cclp_a')).toEqual({ kind: 'none' }));
    expect(notify).toHaveBeenCalledWith('Solution file forgotten.');
    // The list drew itself again from the change: the pack has no file now.
    expect(rows()[0].querySelector('.packs-tws-status')?.textContent).toBe('No file loaded');
    expect(button(rows()[0], 'forget').disabled).toBe(true);
  });

  it('draws nothing while the manager is closed, even when a file changes', async () => {
    section.render();
    await settleAsync();
    const before = rows()[0];
    isOpen = false;
    await files.forget('cclp_a');
    expect(rows()[0]).toBe(before);
  });
});
