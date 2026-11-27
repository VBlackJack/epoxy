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

import { ConfigRegistry } from '../config/ConfigRegistry';
import { isTwsLevel } from '../core/cclp/twsReplay';
import type { LevelPack } from '../core/types';
import { t } from '../i18n/I18nManager';
import { TwsFiles, TwsFileState } from '../storage/TwsFiles';
import { confirmDialog } from './confirmDialog';
import { loadTwsFileForPack, pickTwsFile, twsLoadMessage } from './twsLoadFlow';

const SECTION_ID = 'packs-tws';
const LIST_ID = 'packs-tws-list';
const HIDDEN_CLASS = 'hidden';
const FOCUS_ATTRIBUTE = 'data-tws-focus';

/** The packs a Tile World solution file can serve: those with levels played by the CCLP engine (built in or imported). */
export function twsEligiblePacks(packs: readonly LevelPack[]): LevelPack[] {
  return packs.filter((pack) => pack.levels.some((level) => isTwsLevel(level)));
}

/** What the pack manager needs from the application around it. */
export interface TwsPackSectionHost {
  isOpen(): boolean;
  notify(message: string): void;
  packDisplayName(pack: LevelPack): string;
}

/** The "Tile World solutions" list of the pack manager: per CCLP engine pack, its file, and Load / Forget. */
export class TwsPackSection {
  public constructor(private readonly host: TwsPackSectionHost) {
    TwsFiles.subscribe(() => {
      if (this.host.isOpen()) this.render();
    });
  }

  /** Draws the list again; the section is hidden when no pack can play a Tile World file. */
  public render(): void {
    const section = document.getElementById(SECTION_ID);
    const list = document.getElementById(LIST_ID);
    if (!section || !list) return;
    const packs = twsEligiblePacks(ConfigRegistry.getAllPacks());
    section.classList.toggle(HIDDEN_CLASS, packs.length === 0);
    const focused = (document.activeElement as HTMLElement | null)?.getAttribute(FOCUS_ATTRIBUTE) ?? null;
    list.innerHTML = '';
    for (const pack of packs) list.appendChild(this.row(pack));
    if (focused !== null) list.querySelector<HTMLElement>(`[${FOCUS_ATTRIBUTE}="${focused}"]`)?.focus();
  }

  private row(pack: LevelPack): HTMLLIElement {
    // The first sight of a pack starts its one read; the result comes back through the subscription.
    const state = TwsFiles.peek(pack.id) ?? this.startRead(pack.id);
    const name = this.host.packDisplayName(pack);
    const item = document.createElement('li');
    item.className = 'packs-tws-row';
    item.dataset.packId = pack.id;

    const label = document.createElement('span');
    label.className = 'packs-tws-name';
    label.textContent = name;
    const status = document.createElement('span');
    status.className = 'hint-text packs-tws-status';
    status.textContent = this.statusText(state);

    const hasFile = state.kind === 'ready' || state.kind === 'error';
    const load = this.button(pack.id, 'load', t(hasFile ? 'app.packs.manager.tws_load_other.action' : 'app.packs.manager.tws_load.action'));
    load.disabled = state.kind === 'loading';
    load.addEventListener('click', () => void this.load(pack));
    const forget = this.button(pack.id, 'forget', t('app.packs.manager.tws_forget.action'));
    forget.disabled = !hasFile;
    forget.addEventListener('click', () => void this.forget(pack, name));

    const actions = document.createElement('div');
    actions.className = 'packs-tws-actions';
    actions.append(load, forget);
    item.append(label, status, actions);
    return item;
  }

  private button(packId: string, action: string, text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn small';
    btn.textContent = text;
    btn.setAttribute(FOCUS_ATTRIBUTE, `${packId}:${action}`);
    return btn;
  }

  /** Starts the read of a pack's stored file; until it ends the row says it is reading. */
  private startRead(packId: string): TwsFileState {
    void TwsFiles.ensure(packId, ConfigRegistry.getGame().twsReplay);
    return TwsFiles.peek(packId) ?? { kind: 'loading' };
  }

  private statusText(state: TwsFileState): string {
    switch (state.kind) {
      case 'ready':
        return t('app.packs.manager.tws_section.file.label', { name: state.fileName });
      case 'error':
        return t('app.packs.manager.tws_section.error.label');
      case 'loading':
        return t('app.packs.manager.tws_section.loading.label');
      case 'none':
        return t('app.packs.manager.tws_section.none.label');
    }
  }

  /** Picks a file for the pack. The picker opens straight from the click, with nothing awaited before it. */
  private async load(pack: LevelPack): Promise<void> {
    const file = await pickTwsFile();
    if (file === null) return;
    const result = await loadTwsFileForPack(pack.id, pack.levels, file);
    this.host.notify(twsLoadMessage(result));
  }

  private async forget(pack: LevelPack, name: string): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('app.confirm.title.label'),
      message: t('app.packs.manager.tws_forget.confirm.label', { name }),
      confirmLabel: t('app.packs.manager.tws_forget.action'),
      cancelLabel: t('app.confirm.cancel.action')
    });
    if (!confirmed) return;
    await TwsFiles.forget(pack.id);
    this.host.notify(t('app.packs.manager.toast.tws_forgotten.label'));
  }
}
