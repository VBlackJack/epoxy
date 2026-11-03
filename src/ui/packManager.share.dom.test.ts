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
import type { LevelPack } from '../core/types';
import { mountModals, resetWindowListeners, settleAsync, stubLayout, trackWindowListeners } from '../test/domFixture';
import type { PackManagerHost } from './packManager';

const SHARE_LIMIT_TOO_SMALL = 10;

let packs: LevelPack[];
let registry: (typeof import('../config/ConfigRegistry'))['ConfigRegistry'];
let host: PackManagerHost;
let writeText: ReturnType<typeof vi.fn>;
let nativeShare: ReturnType<typeof vi.fn>;

function button(id: string): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement;
}

function isHidden(id: string): boolean {
  return button(id).classList.contains('hidden');
}

async function openManager(packId: string): Promise<void> {
  const { PackManager } = await import('./packManager');
  new PackManager(host).open(packId);
}

beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  mountModals('packs-modal', 'choice-modal', 'confirm-modal', 'share-link-modal');
  const { i18n } = await import('../i18n/I18nManager');
  i18n.setLocale('en');
  ({ ConfigRegistry: registry } = await import('../config/ConfigRegistry'));
  const { loadTestConfigs } = await import('../test/loadTestConfigs');
  const { makeLevel } = await import('../test/packFixtures');
  const { serializePack } = await import('../packs/packJson');
  loadTestConfigs();

  const level = makeLevel('a');
  packs = [
    { id: 'full', name: 'Full pack', builtIn: false, userCreated: true, levels: [level] },
    { id: 'empty', name: 'Empty pack', builtIn: false, userCreated: true, levels: [] }
  ];
  vi.spyOn(registry, 'getEditablePacks').mockImplementation(() => packs);
  vi.spyOn(registry, 'exportPackJson').mockImplementation((id, name, compact) => {
    const pack = packs.find((p) => p.id === id);
    return pack && pack.levels.length > 0 ? serializePack(name ?? pack.name, pack.levels, {}, compact) : null;
  });

  writeText = vi.fn(async () => undefined);
  nativeShare = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetWindowListeners();
});

describe('pack manager share controls (DOM)', () => {
  it('shows the copy button and the help line where links can be made', async () => {
    await openManager('full');
    expect(isHidden('packs-share-copy-btn')).toBe(false);
    expect(button('packs-share-copy-btn').disabled).toBe(false);
    expect(document.getElementById('packs-share-hint')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('packs-share-hint')?.textContent).toContain('Long links');
  });

  it('hides the share controls and the help line where the browser cannot compress', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    await openManager('full');
    expect(isHidden('packs-share-copy-btn')).toBe(true);
    expect(isHidden('packs-share-more-btn')).toBe(true);
    expect(document.getElementById('packs-share-hint')?.classList.contains('hidden')).toBe(true);
  });

  it('disables the buttons with the reason while the pack is empty', async () => {
    await openManager('empty');
    expect(button('packs-share-copy-btn').disabled).toBe(true);
    expect(button('packs-share-copy-btn').title).toBe('Add a level before sharing this pack.');
  });

  it('copies the link of the selected pack and tells so', async () => {
    await openManager('full');
    button('packs-share-copy-btn').click();
    await settleAsync();
    expect(writeText).toHaveBeenCalledTimes(1);
    const url = writeText.mock.calls[0][0] as string;
    expect(url).toMatch(/#pack=1\.[A-Za-z0-9_-]+$/);
    expect(host.notify).toHaveBeenCalledWith('Share link copied.');
  });

  it('shows a selected, read-only field when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    await openManager('full');
    button('packs-share-copy-btn').click();
    await settleAsync();
    const field = document.getElementById('share-link-field') as HTMLInputElement;
    expect(document.getElementById('share-link-modal')?.classList.contains('hidden')).toBe(false);
    expect(field.readOnly).toBe(true);
    expect(field.value).toMatch(/#pack=1\./);
    expect((field.selectionEnd ?? 0) - (field.selectionStart ?? 0)).toBe(field.value.length);
    expect(host.notify).not.toHaveBeenCalled();
  });

  it('explains that a pack is too big for a link and copies nothing', async () => {
    registry.getGame().share.maxLinkChars = SHARE_LIMIT_TOO_SMALL;
    await openManager('full');
    button('packs-share-copy-btn').click();
    await settleAsync();
    expect(writeText).not.toHaveBeenCalled();
    expect(host.notify).toHaveBeenCalledWith(expect.stringContaining('too big for a share link'));
  });

  it('keeps the system share button hidden where the sheet does not exist', async () => {
    await openManager('full');
    expect(isHidden('packs-share-more-btn')).toBe(true);
  });

  it('hands the link to the system share sheet where it exists', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText }, share: nativeShare });
    await openManager('full');
    expect(isHidden('packs-share-more-btn')).toBe(false);
    button('packs-share-more-btn').click();
    await settleAsync();
    expect(nativeShare).toHaveBeenCalledTimes(1);
    const data = nativeShare.mock.calls[0][0] as { title: string; url: string };
    expect(data.title).toBe('Full pack');
    expect(data.url).toMatch(/#pack=1\./);
  });
});
