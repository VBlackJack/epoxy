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

import { ConfigRegistry, ImportPackJsonResult } from '../config/ConfigRegistry';
import { LevelPack } from '../core/types';
import { t } from '../i18n/I18nManager';
import { isShareHash, ShareDecodeError, SharedPackResult } from '../packs/shareLink';
import { SharePreviewChoice, SharePreviewRequest, showSharePreview } from './sharePreviewDialog';

/**
 * Opening a pack share link: read the fragment, show what it holds and, on the player's word,
 * add it to the library. Nothing is stored before a button is pressed.
 */

const ERROR_KEYS: Record<ShareDecodeError, string> = {
  unsupported: 'app.packs.share.error.unsupported.label',
  newer: 'app.packs.share.error.newer.label',
  damaged: 'app.packs.share.error.damaged.label'
};

/** What the flow needs from the application around it. */
export interface ShareLinkFlowHost {
  showStatus: (message: string) => void;
  /** A pack was added from a link; `play` starts it, otherwise it only joins the library. */
  announceImported: (pack: LevelPack, persisted: boolean, play: boolean) => void;
  /** Starts a pack the library already holds, at its first level. */
  playPack: (packId: string) => void;
}

/** The parts of the outside world the flow touches; the defaults are the real ones. */
export interface ShareLinkFlowDeps {
  read: (hash: string) => Promise<SharedPackResult>;
  findExisting: (sourceHash: string) => LevelPack | null;
  preview: (request: SharePreviewRequest) => Promise<SharePreviewChoice>;
  importText: (text: string, sourceHash: string | undefined) => Promise<ImportPackJsonResult>;
  /** Drops the fragment from the address bar without adding a history entry. */
  clearFragment: () => void;
}

function defaultDeps(): ShareLinkFlowDeps {
  return {
    read: (hash) => ConfigRegistry.readSharedPack(hash),
    findExisting: (sourceHash) => ConfigRegistry.findPackBySourceHash(sourceHash),
    preview: showSharePreview,
    importText: (text, sourceHash) => ConfigRegistry.importPackJson(text, { sourceHash }),
    clearFragment: () => window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  };
}

export class ShareLinkFlow {
  private busy = false;
  /** The latest link received while another was being handled. */
  private queued: string | null = null;

  public constructor(
    private readonly host: ShareLinkFlowHost,
    private readonly deps: ShareLinkFlowDeps = defaultDeps()
  ) {}

  /** Handles a location hash; anything but a pack link is ignored. */
  public async handle(hash: string): Promise<void> {
    if (!isShareHash(hash)) return;
    if (this.busy) {
      this.queued = hash;
      return;
    }
    this.busy = true;
    try {
      await this.process(hash);
    } finally {
      this.busy = false;
    }
    const next = this.queued;
    this.queued = null;
    if (next !== null) await this.handle(next);
  }

  private async process(hash: string): Promise<void> {
    const read = await this.deps.read(hash);
    if (!read.ok) {
      // A damaged link is useless as it is; the other two may work elsewhere, so they stay in the address bar.
      if (read.error === 'damaged') this.deps.clearFragment();
      this.host.showStatus(t(ERROR_KEYS[read.error]));
      return;
    }
    const { pack } = read;
    const existing = pack.sourceHash ? this.deps.findExisting(pack.sourceHash) : null;
    const choice = await this.deps.preview({
      name: pack.name,
      author: pack.author,
      description: pack.description,
      levels: pack.levels,
      duplicate: existing !== null
    });
    this.deps.clearFragment();
    if (choice === 'cancel') return;
    if (choice === 'play') {
      // The pack may have been deleted while the preview was open.
      const still = pack.sourceHash ? this.deps.findExisting(pack.sourceHash) : null;
      if (still) {
        this.host.playPack(still.id);
        return;
      }
    }
    const result = await this.deps.importText(pack.text, pack.sourceHash);
    if (!result.ok) {
      this.host.showStatus(t(ERROR_KEYS.damaged));
      return;
    }
    this.host.announceImported(result.pack, result.persisted, choice !== 'import');
  }
}
