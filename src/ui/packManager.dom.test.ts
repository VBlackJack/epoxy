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
  vi.spyOn(registry, 'moveLevelToIndex').mockImplementation(async (id, levelId, to) => {
    packs = packs.map((p) => {
      if (p.id !== id) return p;
      const levels = [...p.levels];
      const [moved] = levels.splice(levels.findIndex((l) => l.id === levelId), 1);
      levels.splice(to, 0, moved);
      return { ...p, levels } as LevelPack;
    });
    return OK;
  });
  vi.spyOn(registry, 'setPackMetadata').mockImplementation(async (id, patch) => {
    packs = packs.map((p) => (p.id === id ? ({ ...p, ...patch } as LevelPack) : p));
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

  describe('dragging levels', () => {
    const ROW_HEIGHT = 100;

    /** happy-dom does no layout: give each level row a box so the pointer can be placed between rows. */
    function layoutRows(): void {
      document.querySelectorAll<HTMLElement>('#packs-levels-list > .packs-level').forEach((el, i) => {
        el.getBoundingClientRect = () =>
          ({ top: i * ROW_HEIGHT, bottom: (i + 1) * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0, width: 0 }) as DOMRect;
      });
    }

    function handle(levelId: string): HTMLButtonElement {
      const el = document.querySelector<HTMLButtonElement>(`[data-drag-handle="${levelId}"]`);
      if (!el) throw new Error(`No handle for ${levelId}`);
      return el;
    }

    function pointer(target: Element, type: string, clientY: number): void {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, pointerType: 'mouse', button: 0, clientY });
      target.dispatchEvent(event);
    }

    it('drops a level at the slot under the pointer, keeps focus on its handle and announces the position', async () => {
      manager.open('u1');
      layoutRows();
      pointer(handle('l1'), 'pointerdown', 50);
      pointer(handle('l1'), 'pointermove', 160);
      expect(document.querySelector('.packs-level-dragging')?.getAttribute('data-level-id')).toBe('l1');
      expect(document.querySelectorAll('.packs-drop-before')).toHaveLength(1);
      pointer(handle('l1'), 'pointermove', 260);
      expect(document.querySelectorAll('.packs-drop-after, .packs-drop-before')).toHaveLength(1);
      pointer(handle('l1'), 'pointerup', 260);
      await settleAsync();
      expect(registry.moveLevelToIndex).toHaveBeenCalledWith('u1', 'l1', 2);
      expect(levelOrder()).toEqual(['l2', 'l3', 'l1']);
      expect(document.activeElement).toBe(handle('l1'));
      expect(document.getElementById('packs-live')?.textContent).toBe('Level "Level l1" moved to position 3 of 3.');
      expect(document.querySelector('.packs-drop-before, .packs-drop-after, .packs-level-dragging')).toBeNull();
    });

    it('does nothing when dropped where it started or after a tiny move', async () => {
      manager.open('u1');
      layoutRows();
      pointer(handle('l2'), 'pointerdown', 150);
      pointer(handle('l2'), 'pointermove', 152);
      pointer(handle('l2'), 'pointerup', 152);
      pointer(handle('l2'), 'pointerdown', 150);
      pointer(handle('l2'), 'pointermove', 170);
      pointer(handle('l2'), 'pointerup', 170);
      await settleAsync();
      expect(registry.moveLevelToIndex).not.toHaveBeenCalled();
    });

    it('cancels on Escape without closing the dialog', async () => {
      manager.open('u1');
      layoutRows();
      pointer(handle('l1'), 'pointerdown', 50);
      pointer(handle('l1'), 'pointermove', 260);
      const event = pressKey(handle('l1'), 'Escape');
      expect(event.defaultPrevented).toBe(true);
      pointer(handle('l1'), 'pointerup', 260);
      await settleAsync();
      expect(registry.moveLevelToIndex).not.toHaveBeenCalled();
      expect(manager.isOpen()).toBe(true);
      expect(document.querySelector('.packs-drop-before, .packs-drop-after, .packs-level-dragging')).toBeNull();
      expect(levelOrder()).toEqual(['l1', 'l2', 'l3']);
    });

    it('offers no handle on a pack with a single level', () => {
      manager.open('imp1');
      expect(document.querySelector('[data-drag-handle]')).toBeNull();
      expect(document.querySelector('.packs-drag-spacer')).not.toBeNull();
    });

    it('does not start while a rename is being stored', async () => {
      let finish: (value: typeof OK) => void = () => undefined;
      vi.mocked(registry.renamePack).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
      manager.open('u1');
      layoutRows();
      nameInput().value = 'Slow';
      pressKey(nameInput(), 'Enter');
      pointer(handle('l1'), 'pointerdown', 50);
      pointer(handle('l1'), 'pointermove', 260);
      pointer(handle('l1'), 'pointerup', 260);
      await settleAsync();
      expect(registry.moveLevelToIndex).not.toHaveBeenCalled();
      finish(OK);
      await settleAsync();
    });

    it('moves a level with the arrow keys on its handle and keeps focus there', async () => {
      manager.open('u1');
      pressKey(handle('l1'), 'ArrowDown');
      await settleAsync();
      expect(registry.moveLevelInPack).toHaveBeenCalledWith('u1', 0, 1);
      expect(levelOrder()).toEqual(['l2', 'l1', 'l3']);
      expect(document.activeElement).toBe(handle('l1'));
    });
  });

  describe('thumbnails', () => {
    const putImageData = vi.fn();

    beforeEach(() => {
      putImageData.mockClear();
      vi.stubGlobal('ImageData', class FakeImageData {
        public constructor(
          public data: Uint8ClampedArray,
          public width: number,
          public height: number
        ) {}
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        (() => ({ putImageData })) as unknown as HTMLCanvasElement['getContext']
      );
      const drawable = (id: string) =>
        ({ id, winRule: 'targets', terrain: [['floor', 'wall']], items: [[null, null]], entities: [], playerStart: { x: 0, y: 0 } }) as unknown as CompiledLevel;
      packs = [{ ...pack('u1', 'Mine B', true), levels: [drawable('l1'), drawable('l2')] } as LevelPack, pack('u2', 'Mine A', true)];
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('puts a decorative canvas on each level row and the first level on the library row', () => {
      manager.open('u1');
      const canvases = document.querySelectorAll<HTMLCanvasElement>('#packs-levels-list canvas');
      expect(canvases).toHaveLength(2);
      canvases.forEach((c) => expect(c.getAttribute('aria-hidden')).toBe('true'));
      expect(document.querySelectorAll('#packs-library-list canvas')).toHaveLength(1);
      expect(document.querySelectorAll('#packs-library-list .packs-thumb-empty')).toHaveLength(1);
      expect(document.querySelector('.packs-level-title')?.textContent).toBe('Level l1');
    });

    it('draws each canvas with one putImageData, at once without IntersectionObserver', () => {
      vi.stubGlobal('IntersectionObserver', undefined);
      manager.open('u1');
      expect(putImageData).toHaveBeenCalledTimes(3);
    });

    it('waits for a canvas to scroll into view when IntersectionObserver exists', () => {
      let notify: IntersectionObserverCallback = () => undefined;
      vi.stubGlobal('IntersectionObserver', class {
        public constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        public observe(): void {}
        public unobserve(): void {}
        public disconnect(): void {}
      });
      manager.open('u1');
      expect(putImageData).not.toHaveBeenCalled();
      const first = document.querySelector('#packs-levels-list canvas') as HTMLCanvasElement;
      notify([{ isIntersecting: true, target: first } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      expect(putImageData).toHaveBeenCalledTimes(1);
    });
  });

  describe('pack metadata', () => {
    function authorInput(): HTMLInputElement {
      return document.getElementById('packs-author-input') as HTMLInputElement;
    }
    function descriptionInput(): HTMLTextAreaElement {
      return document.getElementById('packs-description-input') as HTMLTextAreaElement;
    }

    it('shows the stored author and description in the header', () => {
      packs = [{ ...pack('u1', 'Mine', true, ['l1']), author: 'Ann', description: 'Line 1\nLine 2' } as LevelPack];
      manager.open('u1');
      expect(authorInput().value).toBe('Ann');
      expect(descriptionInput().value).toBe('Line 1\nLine 2');
    });

    it('shows the author, muted, on the library row only when there is one', () => {
      packs = [{ ...pack('u1', 'Mine', true, ['l1']), author: 'Ann' } as LevelPack, pack('u2', 'Other', true)];
      manager.open('u1');
      const authors = Array.from(document.querySelectorAll('#packs-library-list .packs-row-author')).map((el) => el.textContent);
      expect(authors).toEqual(['by Ann']);
    });

    it('commits the author on Enter and on blur', async () => {
      manager.open('u1');
      authorInput().value = ' Ann ';
      pressKey(authorInput(), 'Enter');
      await settleAsync();
      expect(registry.setPackMetadata).toHaveBeenCalledWith('u1', { author: 'Ann' });
      expect(document.querySelector('#packs-library-list .packs-row-author')?.textContent).toBe('by Ann');
      authorInput().value = 'Bob';
      authorInput().dispatchEvent(new Event('blur'));
      await settleAsync();
      expect(registry.setPackMetadata).toHaveBeenLastCalledWith('u1', { author: 'Bob' });
    });

    it('does not store an unchanged field', async () => {
      manager.open('u1');
      authorInput().value = '   ';
      pressKey(authorInput(), 'Enter');
      await settleAsync();
      expect(registry.setPackMetadata).not.toHaveBeenCalled();
    });

    it('lets Enter add a line in the description and commits on Ctrl+Enter', async () => {
      manager.open('u1');
      descriptionInput().value = 'A\nB';
      const plain = pressKey(descriptionInput(), 'Enter');
      expect(plain.defaultPrevented).toBe(false);
      expect(registry.setPackMetadata).not.toHaveBeenCalled();
      const ctrl = pressKey(descriptionInput(), 'Enter', { ctrlKey: true });
      expect(ctrl.defaultPrevented).toBe(true);
      await settleAsync();
      expect(registry.setPackMetadata).toHaveBeenCalledWith('u1', { description: 'A\nB' });
    });

    it('cancels on Escape: restores the field, stores nothing and keeps the dialog open', async () => {
      packs = [{ ...pack('u1', 'Mine', true, ['l1']), author: 'Ann' } as LevelPack];
      manager.open('u1');
      authorInput().focus();
      authorInput().value = 'Discarded';
      pressKey(authorInput(), 'Escape');
      await settleAsync();
      expect(authorInput().value).toBe('Ann');
      expect(registry.setPackMetadata).not.toHaveBeenCalled();
      expect(manager.isOpen()).toBe(true);
    });

    it('reports a change that could not be stored', async () => {
      vi.mocked(registry.setPackMetadata).mockResolvedValue({ ok: false, persisted: false });
      manager.open('u1');
      authorInput().value = 'Ann';
      pressKey(authorInput(), 'Enter');
      await settleAsync();
      expect(host.notify).toHaveBeenCalled();
      expect(authorInput().value).toBe('');
    });
  });
});
