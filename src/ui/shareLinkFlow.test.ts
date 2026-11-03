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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LevelPack } from '../core/types';
import { i18n } from '../i18n/I18nManager';
import { SharedPack, SharedPackResult } from '../packs/shareLink';
import { ShareLinkFlow, ShareLinkFlowDeps, ShareLinkFlowHost } from './shareLinkFlow';
import { SharePreviewChoice } from './sharePreviewDialog';

const HASH = '#pack=1.abc';
const SOURCE_HASH = 'a'.repeat(64);

const shared: SharedPack = {
  name: 'Shared',
  levels: [],
  author: 'Ada',
  text: '{"pack":true}',
  sourceHash: SOURCE_HASH
};

const stored: LevelPack = { id: 'pack_shared_1', name: 'Shared', levels: [] };

let events: string[];
let host: ShareLinkFlowHost;
let deps: ShareLinkFlowDeps;
let choice: SharePreviewChoice;
let readResult: SharedPackResult;
let existing: LevelPack | null;

function makeFlow(): ShareLinkFlow {
  return new ShareLinkFlow(host, deps);
}

beforeEach(() => {
  i18n.setLocale('en');
  events = [];
  choice = 'import_play';
  readResult = { ok: true, pack: shared };
  existing = null;
  host = {
    showStatus: vi.fn((message: string) => void events.push(`status:${message}`)),
    announceImported: vi.fn((_pack, persisted: boolean, play: boolean) => void events.push(`announce:${persisted}:${play}`)),
    playPack: vi.fn((id: string) => void events.push(`play:${id}`))
  };
  deps = {
    read: vi.fn(async () => readResult),
    findExisting: vi.fn(() => existing),
    preview: vi.fn(async (request) => {
      events.push(`preview:${request.name}:${request.duplicate}`);
      return choice;
    }),
    importText: vi.fn(async () => {
      events.push('import');
      return { ok: true as const, pack: stored, persisted: true };
    }),
    whenNoDialogOpen: vi.fn((callback: () => void) => callback()),
    clearFragment: vi.fn(() => void events.push('clear'))
  };
});

describe('ShareLinkFlow', () => {
  it('ignores a hash that is not a pack link', async () => {
    await makeFlow().handle('#other');
    await makeFlow().handle('');
    expect(deps.read).not.toHaveBeenCalled();
  });

  it('stores nothing before a button is pressed and clears the fragment after the dialog closes', async () => {
    choice = 'cancel';
    await makeFlow().handle(HASH);
    expect(events).toEqual(['preview:Shared:false', 'clear']);
    expect(deps.importText).not.toHaveBeenCalled();
  });

  it('imports and plays on "Import and play"', async () => {
    await makeFlow().handle(HASH);
    expect(events).toEqual(['preview:Shared:false', 'clear', 'import', 'announce:true:true']);
    expect(deps.importText).toHaveBeenCalledWith(shared.text, SOURCE_HASH);
  });

  it('imports without playing on "Import"', async () => {
    choice = 'import';
    await makeFlow().handle(HASH);
    expect(events).toEqual(['preview:Shared:false', 'clear', 'import', 'announce:true:false']);
  });

  it('passes the session-only state of the import on', async () => {
    deps.importText = vi.fn(async () => ({ ok: true as const, pack: stored, persisted: false }));
    await makeFlow().handle(HASH);
    expect(host.announceImported).toHaveBeenCalledWith(stored, false, true);
  });

  it('tells a pack already in the library and plays it on "Play" without importing again', async () => {
    existing = { id: 'mine', name: 'Shared', levels: [] };
    choice = 'play';
    await makeFlow().handle(HASH);
    expect(events).toEqual(['preview:Shared:true', 'clear', 'play:mine']);
    expect(deps.findExisting).toHaveBeenCalledWith(SOURCE_HASH);
    expect(deps.importText).not.toHaveBeenCalled();
  });

  it('imports when the pack vanished from the library while the preview was open', async () => {
    existing = { id: 'mine', name: 'Shared', levels: [] };
    choice = 'play';
    deps.findExisting = vi.fn().mockReturnValueOnce(existing).mockReturnValueOnce(null);
    await makeFlow().handle(HASH);
    expect(events).toEqual(['preview:Shared:true', 'clear', 'import', 'announce:true:true']);
  });

  it('does not look for a duplicate without a digest', async () => {
    readResult = { ok: true, pack: { ...shared, sourceHash: undefined } };
    await makeFlow().handle(HASH);
    expect(deps.findExisting).not.toHaveBeenCalled();
    expect(deps.importText).toHaveBeenCalledWith(shared.text, undefined);
  });

  it('shows a distinct message for each way a link fails', async () => {
    const messages: string[] = [];
    for (const error of ['unsupported', 'newer', 'damaged'] as const) {
      readResult = { ok: false, error };
      await makeFlow().handle(HASH);
      messages.push((host.showStatus as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string);
    }
    expect(messages).toEqual([
      'Open this link in a newer browser.',
      'This link was made with a newer version of Epoxy.',
      'This link is damaged.'
    ]);
    expect(new Set(messages).size).toBe(3);
    expect(deps.preview).not.toHaveBeenCalled();
  });

  it('drops a damaged link from the address bar and keeps the others', async () => {
    readResult = { ok: false, error: 'damaged' };
    await makeFlow().handle(HASH);
    expect(deps.clearFragment).toHaveBeenCalledTimes(1);
    readResult = { ok: false, error: 'newer' };
    await makeFlow().handle(HASH);
    readResult = { ok: false, error: 'unsupported' };
    await makeFlow().handle(HASH);
    expect(deps.clearFragment).toHaveBeenCalledTimes(1);
  });

  it('says the link is damaged when the import is refused', async () => {
    deps.importText = vi.fn(async () => ({ ok: false as const, error: 'malformed' as const }));
    await makeFlow().handle(HASH);
    expect(host.announceImported).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith('This link is damaged.');
  });

  it('waits for an open dialog to close before reading the link', async () => {
    let close: () => void = () => undefined;
    deps.whenNoDialogOpen = vi.fn((callback: () => void) => {
      close = callback;
    });
    const done = makeFlow().handle(HASH);
    await Promise.resolve();
    expect(deps.read).not.toHaveBeenCalled();
    close();
    await done;
    expect(deps.read).toHaveBeenCalledTimes(1);
    expect(deps.preview).toHaveBeenCalledTimes(1);
  });

  it('handles a link received during a preview once the first is done', async () => {
    let release: (value: SharePreviewChoice) => void = () => undefined;
    deps.preview = vi.fn(
      () =>
        new Promise<SharePreviewChoice>((resolve) => {
          release = resolve;
        })
    );
    const flow = makeFlow();
    const first = flow.handle(HASH);
    await vi.waitFor(() => expect(deps.preview).toHaveBeenCalledTimes(1));
    await flow.handle('#pack=1.def');
    expect(deps.read).toHaveBeenCalledTimes(1);
    release('cancel');
    await vi.waitFor(() => expect(deps.preview).toHaveBeenCalledTimes(2));
    release('cancel');
    await first;
    expect(deps.read).toHaveBeenNthCalledWith(2, '#pack=1.def');
  });
});
