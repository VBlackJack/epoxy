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
import type { CompiledLevel, LevelPack } from '../core/types';
import type { LevelPackStorage as LevelPackStorageType } from '../storage/LevelPackStorage';
import { FakeIndexedDb } from '../test/FakeIndexedDb';
import { mountModals, pressKey, resetWindowListeners, settleAsync, stubLayout, trackWindowListeners } from '../test/domFixture';
import type { PackManagerHost } from './packManager';

const CC3D_ROWS = ['#####', '#@..#', '#####'];
const LONG_TITLE_LENGTH = 400;

const fake = new FakeIndexedDb();
let registry: (typeof import('../config/ConfigRegistry'))['ConfigRegistry'];
let storage: typeof LevelPackStorageType;
let manager: import('./packManager').PackManager;
let host: PackManagerHost;
let makeCc3dLevel: (rows: string[], options?: { id?: string }) => CompiledLevel;
let convertedTitle: (base: string, max: number) => string;
let importedId: string;
let sourceId: string;
let userPackId: string;

function packOf(id: string): LevelPack {
  return registry.getAllPacks().find((p) => p.id === id) as LevelPack;
}

function element(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function isHidden(id: string): boolean {
  return element(id).classList.contains('hidden');
}

function convertButton(levelId: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-focus-key="${levelId}:convert"]`);
}

async function click(target: HTMLElement | null): Promise<void> {
  target?.click();
  await settleAsync();
}

/** Starts the conversion of the CC3D level and answers Continue in the report. */
async function convertUntilSaveInto(): Promise<void> {
  await click(convertButton(sourceId));
  await click(element('convert-report-continue-btn'));
}

async function submitSaveInto(): Promise<void> {
  (element('save-into-form') as HTMLFormElement).requestSubmit();
  await settleAsync();
}

async function chooseNewPack(name: string): Promise<void> {
  const input = element('save-into-new-name') as HTMLInputElement;
  input.value = name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await submitSaveInto();
}

beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  document.body.innerHTML = '';
  mountModals('packs-modal', 'choice-modal', 'confirm-modal', 'save-into-modal');
  fake.records.clear();
  vi.stubGlobal('indexedDB', fake);
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  });
  const { i18n } = await import('../i18n/I18nManager');
  i18n.setLocale('en');
  ({ ConfigRegistry: registry } = await import('../config/ConfigRegistry'));
  ({ LevelPackStorage: storage } = await import('../storage/LevelPackStorage'));
  const { loadTestConfigs } = await import('../test/loadTestConfigs');
  loadTestConfigs();
  ({ cc3dLevel: makeCc3dLevel } = await import('../core/cc3d/cc3dTestMaps'));
  ({ convertedTitle } = await import('./packManagerModel'));
  const { PackManager } = await import('./packManager');

  const imported = await registry.registerImportedPack('CC3D set', [makeCc3dLevel(CC3D_ROWS, { id: 'cc3d_one' })]);
  importedId = imported.pack.id;
  sourceId = imported.pack.levels[0].id;
  const created = await registry.createUserPack('Mine');
  userPackId = (created.pack as LevelPack).id;

  host = {
    playPack: vi.fn(),
    editLevel: vi.fn(async () => true),
    newLevelInPack: vi.fn(async () => true),
    importFile: vi.fn(),
    deleteImportedPacks: vi.fn(async () => undefined),
    exportCcl: vi.fn(),
    notify: vi.fn(),
    libraryChanged: vi.fn(),
    packDisplayName: (p) => p.name,
    levelTitle: (l) => l.customTitle ?? l.id
  };
  manager = new PackManager(host);
  manager.open(importedId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetWindowListeners();
  await storage.closeConnection();
});

describe('Convert to Epoxy (DOM)', () => {
  it('offers the button on CC3D level rows only', async () => {
    expect(convertButton(sourceId)).not.toBeNull();
    expect(convertButton(sourceId)?.textContent).toBe('Convert to Epoxy');
    const epoxy = (await import('../test/packFixtures')).makeLevel('epoxy_one');
    await registry.saveLevelToPack(userPackId, epoxy);
    manager.refresh(userPackId);
    expect(convertButton('epoxy_one')).toBeNull();
    expect(document.querySelector('[data-focus-key="epoxy_one:duplicate"]')).not.toBeNull();
  });

  it('shows the report first and changes nothing when the player cancels it', async () => {
    const before = structuredClone(registry.getAllPacks());
    await click(convertButton(sourceId));
    expect(isHidden('convert-report-modal')).toBe(false);
    expect(element('convert-report-body').textContent).toContain('The rules differ: the converted level may not be solvable.');
    await click(element('convert-report-cancel-btn'));
    expect(isHidden('convert-report-modal')).toBe(true);
    expect(isHidden('save-into-modal')).toBe(true);
    expect(registry.getAllPacks()).toEqual(before);
  });

  it('changes nothing when the player cancels the pack choice', async () => {
    const before = structuredClone(registry.getAllPacks());
    await convertUntilSaveInto();
    expect(isHidden('save-into-modal')).toBe(false);
    await click(element('save-into-cancel-btn'));
    expect(isHidden('save-into-modal')).toBe(true);
    expect(registry.getAllPacks()).toEqual(before);
    expect(isHidden('choice-modal')).toBe(true);
  });

  it('offers every editable pack, imported ones included, with the first owned pack preselected', async () => {
    await convertUntilSaveInto();
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('#save-into-list input[type="radio"]'));
    expect(radios.map((r) => r.value)).toEqual(registry.getEditablePacks().map((p) => p.id));
    expect(radios.map((r) => r.value)).toContain(importedId);
    expect(radios.find((r) => r.checked)?.value).toBe(userPackId);
    pressKey(document.activeElement as Element, 'Escape');
    await settleAsync();
  });

  it('preselects the remembered destination', async () => {
    const key = registry.getStorageKey(registry.getGame().storage.lastSaveDestinationKey);
    localStorage.setItem(key, importedId);
    await convertUntilSaveInto();
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('#save-into-list input[type="radio"]'));
    expect(radios.find((r) => r.checked)?.value).toBe(importedId);
    pressKey(document.activeElement as Element, 'Escape');
    await settleAsync();
  });

  it('asks before saving into an imported pack, and saves nothing when declined', async () => {
    const key = registry.getStorageKey(registry.getGame().storage.lastSaveDestinationKey);
    localStorage.setItem(key, importedId);
    await convertUntilSaveInto();
    await submitSaveInto();
    expect(isHidden('choice-modal')).toBe(false);
    const cancel = document.querySelector<HTMLButtonElement>('#choice-modal-actions button');
    await click(cancel);
    expect(packOf(importedId).levels).toHaveLength(1);
    expect(isHidden('save-into-modal')).toBe(false);
    pressKey(document.activeElement as Element, 'Escape');
    await settleAsync();
  });

  it('saves into the imported pack once the player confirms', async () => {
    const key = registry.getStorageKey(registry.getGame().storage.lastSaveDestinationKey);
    localStorage.setItem(key, importedId);
    await convertUntilSaveInto();
    await submitSaveInto();
    const modify = Array.from(document.querySelectorAll<HTMLButtonElement>('#choice-modal-actions button')).find((b) =>
      b.classList.contains('primary')
    );
    await click(modify ?? null);
    expect(packOf(importedId).levels).toHaveLength(2);
    expect(localStorage.getItem(key)).toBe(importedId);
  });

  it('deletes the new pack when the level could not be saved into it', async () => {
    vi.spyOn(registry, 'saveLevelToPack').mockResolvedValue({ ok: false, persisted: false } as never);
    const before = registry.getEditablePacks().length;
    await convertUntilSaveInto();
    await chooseNewPack('Doomed');
    expect(registry.getEditablePacks().find((p) => p.name === 'Doomed')).toBeUndefined();
    expect(registry.getEditablePacks()).toHaveLength(before);
    expect(host.notify).toHaveBeenCalled();
  });

  it('saves the Epoxy copy as a new level of the chosen pack and never touches the original', async () => {
    const originalPack = structuredClone(packOf(importedId));
    await convertUntilSaveInto();
    await submitSaveInto();

    const mine = packOf(userPackId);
    expect(mine.levels).toHaveLength(1);
    const copy = mine.levels[0];
    expect(copy.ruleset).toBe('epoxy');
    expect(copy.cc3d).toBeUndefined();
    expect(copy.id).not.toBe(sourceId);
    expect(copy.customTitle).toBe(`${sourceId} (Epoxy)`);
    expect(packOf(importedId)).toEqual(originalPack);
    expect(host.libraryChanged).toHaveBeenCalled();
  });

  it('clamps the base name so the whole copy title fits the title limit', async () => {
    const limit = registry.getLevelTextLimits().titleMaxLength;
    const long = 'T'.repeat(LONG_TITLE_LENGTH);
    host.levelTitle = () => long;
    await convertUntilSaveInto();
    await submitSaveInto();
    const title = packOf(userPackId).levels[0].customTitle as string;
    expect(title).toBe(convertedTitle(long, limit));
    expect(title.length).toBe(limit);
    expect(title.endsWith(' (Epoxy)')).toBe(true);
  });

  it('can save into a new pack', async () => {
    await convertUntilSaveInto();
    await chooseNewPack('Converted');
    const created = registry.getEditablePacks().find((p) => p.name === 'Converted');
    expect(created?.levels).toHaveLength(1);
    expect(created?.levels[0].ruleset).toBe('epoxy');
    expect(packOf(importedId).levels).toHaveLength(1);
    expect(packOf(importedId).levels[0].ruleset).toBe('cc3d');
  });

  it('offers Open in editor after the save, and does not open it by itself', async () => {
    await convertUntilSaveInto();
    await submitSaveInto();
    expect(host.editLevel).not.toHaveBeenCalled();
    expect(isHidden('choice-modal')).toBe(false);
    const labels = Array.from(document.querySelectorAll('#choice-modal-actions button')).map((b) => b.textContent);
    expect(labels).toEqual(['Close', 'Open in editor']);
    expect(element('choice-modal-message').textContent).toContain('Mine');
  });

  it('opens the copy through the editor host hook when asked, and closes the manager', async () => {
    await convertUntilSaveInto();
    await submitSaveInto();
    const copyId = packOf(userPackId).levels[0].id;
    const open = Array.from(document.querySelectorAll<HTMLButtonElement>('#choice-modal-actions button')).find(
      (b) => b.textContent === 'Open in editor'
    );
    await click(open ?? null);
    expect(host.editLevel).toHaveBeenCalledWith(userPackId, copyId);
    expect(manager.isOpen()).toBe(false);
  });

  it('keeps the manager open when the player closes the offer', async () => {
    await convertUntilSaveInto();
    await submitSaveInto();
    await click(document.querySelector<HTMLButtonElement>('#choice-modal-actions button'));
    expect(host.editLevel).not.toHaveBeenCalled();
    expect(manager.isOpen()).toBe(true);
    expect(packOf(userPackId).levels).toHaveLength(1);
  });
});
