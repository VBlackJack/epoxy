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
import { mountModals, pressKey, resetWindowListeners, trackWindowListeners, settleAsync, stubLayout } from '../test/domFixture';
import type { PackManagerHost } from './packManager';

/** A level reduced to what the manager reads; the 'targets' win rule skips the DAT size check. */
function level(id: string): CompiledLevel {
  return { id, winRule: 'targets' } as unknown as CompiledLevel;
}

function pack(id: string, name: string, userCreated: boolean, levelIds: string[] = []): LevelPack {
  return { id, name, builtIn: false, userCreated, levels: levelIds.map(level) } as unknown as LevelPack;
}

const OK = { ok: true, persisted: true };

let packs: LevelPack[];
let registry: (typeof import('../config/ConfigRegistry'))['ConfigRegistry'];
let manager: import('./packManager').PackManager;
let host: PackManagerHost;

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('#packs-library-list .packs-row-name')).map((el) => el.textContent ?? '');
}

function levelButton(levelId: string, action: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-focus-key="${levelId}:${action}"]`);
  if (!button) throw new Error(`No ${action} button for ${levelId}`);
  return button;
}

function levelOrder(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#packs-levels-list .packs-level')).map((el) => el.dataset.levelId ?? '');
}

function nameInput(): HTMLInputElement {
  return document.getElementById('packs-name-input') as HTMLInputElement;
}

function selectRow(label: string): void {
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>('#packs-library-list .packs-row')).find(
    (el) => el.querySelector('.packs-row-name')?.textContent === label
  );
  if (!row) throw new Error(`No row ${label}`);
  row.click();
}

// The dialog helpers keep module-level state: load a fresh copy of the whole graph per test.
beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  mountModals('packs-modal', 'choice-modal', 'confirm-modal');
  const { i18n } = await import('../i18n/I18nManager');
  i18n.setLocale('en');
  ({ ConfigRegistry: registry } = await import('../config/ConfigRegistry'));
  const { PackManager } = await import('./packManager');

  // Imported packs come first in the registry on purpose: the library must still list the player's packs first.
  packs = [pack('imp1', 'Imported one', false, ['i1']), pack('u1', 'Mine B', true, ['l1', 'l2', 'l3']), pack('u2', 'Mine A', true)];
  vi.spyOn(registry, 'getEditablePacks').mockImplementation(() => packs);
  vi.spyOn(registry, 'renamePack').mockImplementation(async (id, name) => {
    packs = packs.map((p) => (p.id === id ? ({ ...p, name } as LevelPack) : p));
    return OK;
  });
  vi.spyOn(registry, 'moveLevelInPack').mockImplementation(async (id, from, to) => {
    packs = packs.map((p) => {
      if (p.id !== id) return p;
      const levels = [...p.levels];
      levels.splice(to, 0, ...levels.splice(from, 1));
      return { ...p, levels } as LevelPack;
    });
    return OK;
  });
  vi.spyOn(registry, 'deletePack').mockImplementation(async (id) => {
    packs = packs.filter((p) => p.id !== id);
    return OK;
  });
  vi.spyOn(registry, 'removeLevelFromPack').mockImplementation(async (id, levelId) => {
    packs = packs.map((p) => (p.id === id ? ({ ...p, levels: p.levels.filter((l) => l.id !== levelId) } as LevelPack) : p));
    return OK;
  });

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
    levelTitle: (l) => `Level ${l.id}`
  };
  manager = new PackManager(host);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetWindowListeners();
});

describe('PackManager (DOM)', () => {
  it('lists the packs the player created before the imported ones', () => {
    manager.open();
    expect(rowNames()).toEqual(['Mine B', 'Mine A', 'Imported one']);
  });

  it('selects the first pack on open and shows the pack clicked', () => {
    manager.open();
    expect(nameInput().value).toBe('Mine B');
    expect(levelOrder()).toEqual(['l1', 'l2', 'l3']);
    selectRow('Imported one');
    expect(nameInput().value).toBe('Imported one');
    expect(levelOrder()).toEqual(['i1']);
    expect(document.querySelector('#packs-library-list .packs-row.selected .packs-row-name')?.textContent).toBe('Imported one');
  });

  it('opens on the requested pack', () => {
    manager.open('u2');
    expect(nameInput().value).toBe('Mine A');
  });

  describe('inline rename', () => {
    it('renames on Enter', async () => {
      manager.open('u1');
      nameInput().value = 'Renamed';
      pressKey(nameInput(), 'Enter');
      await settleAsync();
      expect(registry.renamePack).toHaveBeenCalledWith('u1', 'Renamed');
      expect(rowNames()).toContain('Renamed');
    });

    it('cancels on Escape: restores the name, renames nothing and keeps the dialog open', async () => {
      manager.open('u1');
      nameInput().focus();
      nameInput().value = 'Discarded';
      pressKey(nameInput(), 'Escape');
      await settleAsync();
      expect(nameInput().value).toBe('Mine B');
      expect(registry.renamePack).not.toHaveBeenCalled();
      expect(manager.isOpen()).toBe(true);
    });
  });

  describe('moving levels', () => {
    it('keeps focus on the moved row when moving down', async () => {
      manager.open('u1');
      levelButton('l1', 'down').click();
      await settleAsync();
      expect(levelOrder()).toEqual(['l2', 'l1', 'l3']);
      expect(document.activeElement).toBe(levelButton('l1', 'down'));
    });

    it('keeps focus on the moved row when moving up', async () => {
      manager.open('u1');
      levelButton('l3', 'up').click();
      await settleAsync();
      expect(levelOrder()).toEqual(['l1', 'l3', 'l2']);
      expect(document.activeElement).toBe(levelButton('l3', 'up'));
    });

    it('moves focus to a sibling control when the row reaches the end and its arrow is disabled', async () => {
      manager.open('u1');
      levelButton('l2', 'down').click();
      await settleAsync();
      expect(levelOrder()).toEqual(['l1', 'l3', 'l2']);
      // The disabled arrow cannot hold focus: it goes to the first enabled button of the same row.
      expect(levelButton('l2', 'down').disabled).toBe(true);
      expect(document.activeElement).toBe(levelButton('l2', 'edit'));
    });
  });

  describe('deleting', () => {
    it('asks before deleting a pack and does nothing on Cancel', async () => {
      manager.open('u1');
      document.getElementById('packs-delete-btn')?.click();
      await settleAsync();
      expect(document.getElementById('choice-modal')?.classList.contains('hidden')).toBe(false);
      expect(registry.deletePack).not.toHaveBeenCalled();
      pressKey(document.activeElement as Element, 'Escape');
      await settleAsync();
      expect(registry.deletePack).not.toHaveBeenCalled();
      expect(rowNames()).toContain('Mine B');
    });

    it('deletes the pack once the confirmation is accepted', async () => {
      manager.open('u1');
      document.getElementById('packs-delete-btn')?.click();
      await settleAsync();
      const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('#choice-modal-actions button')).find(
        (b) => b.classList.contains('primary')
      );
      confirm?.click();
      await settleAsync();
      expect(registry.deletePack).toHaveBeenCalledWith('u1');
      expect(rowNames()).not.toContain('Mine B');
      expect(host.libraryChanged).toHaveBeenCalledWith({ deletedPackIds: ['u1'] });
    });

    it('asks before deleting a level and does nothing on Cancel', async () => {
      manager.open('u1');
      levelButton('l2', 'delete').click();
      await settleAsync();
      expect(document.getElementById('confirm-modal')?.classList.contains('hidden')).toBe(false);
      document.getElementById('confirm-cancel-btn')?.click();
      await settleAsync();
      expect(registry.removeLevelFromPack).not.toHaveBeenCalled();
      expect(levelOrder()).toEqual(['l1', 'l2', 'l3']);
    });

    it('deletes the level once the confirmation is accepted', async () => {
      manager.open('u1');
      levelButton('l2', 'delete').click();
      await settleAsync();
      document.getElementById('confirm-ok-btn')?.click();
      await settleAsync();
      expect(registry.removeLevelFromPack).toHaveBeenCalledWith('u1', 'l2');
      expect(levelOrder()).toEqual(['l1', 'l3']);
    });
  });
});
