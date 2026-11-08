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
import { mountModals, resetWindowListeners, stubLayout, trackWindowListeners } from '../test/domFixture';
import type { PackManagerHost } from './packManager';

const SHA = 'd'.repeat(64);

let packs: LevelPack[];
let registry: (typeof import('../config/ConfigRegistry'))['ConfigRegistry'];
let host: PackManagerHost;
let exportSpy: ReturnType<typeof vi.spyOn>;

function withCc2(level: CompiledLevel, verdict: 'exact' | 'approx' | 'lost'): CompiledLevel {
  return {
    ...level,
    cc2: {
      v: 1,
      sha256: SHA,
      file: 'a.c2m',
      order: 1,
      gridHash: 'h',
      coverage: { verdict, lost: verdict === 'lost' ? ['rover'] : [], approx: [] }
    }
  };
}

function checkbox(): HTMLInputElement {
  return document.getElementById('packs-export-cc2-source') as HTMLInputElement;
}

function sourceBoxHidden(): boolean {
  return document.getElementById('packs-export-cc2-source-box')?.classList.contains('hidden') ?? true;
}

async function openManager(packId: string): Promise<void> {
  const { PackManager } = await import('./packManager');
  new PackManager(host).open(packId);
}

beforeEach(async () => {
  trackWindowListeners();
  vi.resetModules();
  stubLayout();
  mountModals('packs-modal', 'choice-modal', 'confirm-modal');
  const { i18n } = await import('../i18n/I18nManager');
  i18n.setLocale('en');
  ({ ConfigRegistry: registry } = await import('../config/ConfigRegistry'));
  const { loadTestConfigs } = await import('../test/loadTestConfigs');
  const { makeLevel } = await import('../test/packFixtures');
  loadTestConfigs();
  vi.doMock('./download', () => ({ downloadBlob: vi.fn(), MIME_JSON: 'application/json' }));

  packs = [
    { id: 'cc2', name: 'CC2 pack', builtIn: false, levels: [withCc2(makeLevel('a'), 'approx'), withCc2(makeLevel('b'), 'lost')] },
    { id: 'plain', name: 'Plain pack', builtIn: false, userCreated: true, levels: [makeLevel('c')] }
  ];
  vi.spyOn(registry, 'getEditablePacks').mockImplementation(() => packs);
  exportSpy = vi.spyOn(registry, 'exportPackJson').mockReturnValue('{}');
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
  vi.doUnmock('./download');
  resetWindowListeners();
});

describe('pack manager and CC2 levels (DOM)', () => {
  it('badges each CC2 level of the list with its coverage', async () => {
    await openManager('cc2');
    const badges = Array.from(
      document.querySelectorAll('#packs-levels-list .packs-badge-cc2-approx, #packs-levels-list .packs-badge-cc2-lost')
    );
    expect(badges.map((el) => el.textContent)).toEqual(['Approximate', 'Not playable']);
    expect(badges[0].getAttribute('title')).toBe('How well Epoxy plays this CC2 level');
  });

  it('shows no CC2 badge and no source option on a pack without CC2 levels', async () => {
    await openManager('plain');
    expect(document.querySelector('#packs-levels-list [class*="packs-badge-cc2"]')).toBeNull();
    expect(sourceBoxHidden()).toBe(true);
  });

  it('offers the source option on a CC2 pack, off by default, and exports without the sources', async () => {
    await openManager('cc2');
    expect(sourceBoxHidden()).toBe(false);
    expect(checkbox().checked).toBe(false);
    (document.getElementById('packs-export-json-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(exportSpy).toHaveBeenCalled());
    expect(exportSpy.mock.calls[0][3]).toBeUndefined();
  });

  it('asks the sidecar for the sources when the box is ticked', async () => {
    const storage = await import('../storage/Cc2SourceStorage');
    vi.spyOn(storage.Cc2SourceStorage, 'getMany').mockResolvedValue([{ sha256: SHA, bytes: Uint8Array.of(1, 2) }]);
    await openManager('cc2');
    checkbox().checked = true;
    (document.getElementById('packs-export-json-btn') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(exportSpy).toHaveBeenCalled());
    expect(exportSpy.mock.calls[0][3]).toEqual({ [SHA]: 'AQI=' });
  });
});
