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

import { ConfigRegistry, PackOperationResult } from '../config/ConfigRegistry';
import { PACK_NAME_MAX_LENGTH } from '../config/constants';
import { CompiledLevel, LevelPack } from '../core/types';
import { datRefusalReason } from '../formats/DatCodec';
import { t } from '../i18n/I18nManager';
import { normalizePackName } from '../packs/userPacks';
import { confirmDialog } from './confirmDialog';
import { closeDialog, openDialog } from './dialog';
import { downloadBlob, MIME_JSON } from './download';
import {
  badgeLabelKey,
  buildLevelRows,
  buildLibraryRows,
  buildPackActions,
  EngineBadge,
  LevelRow,
  LibraryRow,
  managerState,
  packFileName,
  resolveSelection,
  selectionAfterRemoval,
  transferTargets
} from './packManagerModel';
import { PACK_MANAGER_FOCUS_ATTRIBUTE } from './uiConstants';

const MODAL_ID = 'packs-modal';
const DELETE_MODAL_ID = 'pack-delete-modal';
const HIDDEN_CLASS = 'hidden';
const TRANSFER_COPY = 'copy';
const TRANSFER_MOVE = 'move';

type TransferMode = typeof TRANSFER_COPY | typeof TRANSFER_MOVE;
type RowAction = 'up' | 'down' | 'edit' | 'play' | 'duplicate' | 'transfer' | 'delete';

/** What the manager needs from the application around it. */
export interface PackManagerHost {
  /** Starts a pack at a level (the pack becomes the active one); the manager closes. */
  playPack(packId: string, levelIndex: number): void;
  /** Opens a level in the editor, targeting its pack; true once it is open (the player may decline to discard work). */
  editLevel(packId: string, levelId: string): Promise<boolean>;
  /** Opens the editor on a blank map aimed at the pack; true once it is open. */
  newLevelInPack(packId: string): Promise<boolean>;
  /** Opens the file picker of the existing import flow. */
  importFile(): void;
  /** The existing "delete imported packs" flow, with its own confirmation. */
  deleteImportedPacks(): Promise<void>;
  exportCcl(pack: LevelPack): void;
  notify(message: string): void;
  /** Called after any change to the library, so selectors, tables and the editor catch up. */
  libraryChanged(change: { deletedPackIds: readonly string[] }): void;
  packDisplayName(pack: LevelPack): string;
  levelTitle(level: CompiledLevel): string;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function countText(count: number): string {
  return t('app.packs.manager.library.count.label', { count });
}

/** Controller of the "My packs" modal: the library, the selected pack and its levels. */
export class PackManager {
  private selectedId: string | null = null;
  /** Level whose "Copy or move" panel is open. */
  private transferLevelId: string | null = null;
  private renaming = false;

  public constructor(private readonly host: PackManagerHost) {
    this.bindEscapeGuard();
    this.bindStaticControls();
  }

  public isOpen(): boolean {
    const modal = byId(MODAL_ID);
    return modal !== null && !modal.classList.contains(HIDDEN_CLASS);
  }

  /** Opens the manager, on the given pack when it is in the library. */
  public open(packId: string | null = null): void {
    const modal = byId(MODAL_ID);
    if (!modal) return;
    this.transferLevelId = null;
    this.hideNewPackForm();
    this.selectedId = resolveSelection(this.libraryRows(), packId);
    this.render();
    if (this.isOpen()) return;
    openDialog(modal, document.activeElement as HTMLElement | null, {
      initialFocus: this.initialFocus()
    });
  }

  public close(): void {
    closeDialog(byId(MODAL_ID));
  }

  /** Redraws after a change made elsewhere (an import); selects the given pack when set. */
  public refresh(selectPackId: string | null = null): void {
    if (!this.isOpen()) return;
    this.selectedId = resolveSelection(this.libraryRows(), selectPackId ?? this.selectedId);
    this.render();
  }

  // -- Data ---------------------------------------------------------------------

  private libraryRows(): LibraryRow[] {
    return buildLibraryRows(ConfigRegistry.getEditablePacks(), (pack) => this.host.packDisplayName(pack));
  }

  private selectedPack(): LevelPack | undefined {
    return ConfigRegistry.getEditablePacks().find((pack) => pack.id === this.selectedId);
  }

  private initialFocus(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#packs-library-list .packs-row.selected') ??
      byId('packs-first-pack-btn') ??
      byId('packs-new-btn')
    );
  }

  /** Reports the outcome of a change: failure, session-only storage, or the success message. */
  private report(result: PackOperationResult, successMessage: string): boolean {
    if (!result.ok) {
      this.host.notify(t('app.packs.manager.toast.failed.label'));
      return false;
    }
    this.host.notify(result.persisted ? successMessage : t('app.packs.manager.toast.session_only.label'));
    return true;
  }

  // -- Static controls -------------------------------------------------------------

  /**
   * Escape in the two name fields cancels the edit instead of closing the
   * dialog. The dialog helper listens on window in the capture phase and binds
   * on its first use, after this constructor: this listener runs first and
   * stops the event.
   */
  private bindEscapeGuard(): void {
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        const target = e.target as HTMLElement | null;
        if (target?.id === 'packs-name-input') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.syncDetail();
        } else if (target?.id === 'packs-new-input') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.hideNewPackForm();
          byId('packs-new-btn')?.focus();
        }
      },
      true
    );
  }

  private bindStaticControls(): void {
    byId('packs-close-btn')?.addEventListener('click', () => this.close());
    byId(MODAL_ID)?.addEventListener('click', (e) => {
      if (e.target === byId(MODAL_ID)) this.close();
    });

    byId('packs-new-btn')?.addEventListener('click', () => this.toggleNewPackForm());
    byId('packs-first-pack-btn')?.addEventListener('click', () => this.showNewPackForm());
    const newInput = byId<HTMLInputElement>('packs-new-input');
    if (newInput) newInput.maxLength = PACK_NAME_MAX_LENGTH;
    newInput?.addEventListener('input', () => newInput.removeAttribute('aria-invalid'));
    byId<HTMLFormElement>('packs-new-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.createPack();
    });

    byId('packs-import-btn')?.addEventListener('click', () => this.host.importFile());
    byId('packs-delete-imported-btn')?.addEventListener('click', () => {
      void this.host.deleteImportedPacks().then(() => this.refresh());
    });

    const nameInput = byId<HTMLInputElement>('packs-name-input');
    if (nameInput) nameInput.maxLength = PACK_NAME_MAX_LENGTH;
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.commitRename();
      }
    });
    nameInput?.addEventListener('blur', () => void this.commitRename());

    byId('packs-play-btn')?.addEventListener('click', () => {
      const pack = this.selectedPack();
      if (pack && pack.levels.length > 0) this.playFrom(pack.id, 0);
    });
    byId('packs-export-json-btn')?.addEventListener('click', () => {
      const pack = this.selectedPack();
      if (pack) this.exportJson(pack);
    });
    byId('packs-export-ccl-btn')?.addEventListener('click', () => {
      const pack = this.selectedPack();
      if (pack) this.host.exportCcl(pack);
    });
    byId('packs-delete-btn')?.addEventListener('click', () => void this.deleteSelectedPack());
    byId('packs-new-level-btn')?.addEventListener('click', () => {
      const pack = this.selectedPack();
      if (pack) void this.host.newLevelInPack(pack.id).then((opened) => opened && this.close());
    });
  }

  // -- Rendering -------------------------------------------------------------------

  private render(focusKey: string | null = null): void {
    const rows = this.libraryRows();
    this.selectedId = resolveSelection(rows, this.selectedId);
    this.renderLibrary(rows);
    this.syncDetail();
    this.renderLevels();
    byId('packs-delete-imported-btn')?.classList.toggle(
      HIDDEN_CLASS,
      !rows.some((row) => row.imported)
    );
    if (focusKey) this.restoreFocus(focusKey);
  }

  private renderLibrary(rows: readonly LibraryRow[]): void {
    const list = byId('packs-library-list');
    if (!list) return;
    list.innerHTML = '';
    for (const row of rows) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `packs-row${row.id === this.selectedId ? ' selected' : ''}`;
      button.dataset.packId = row.id;
      if (row.id === this.selectedId) button.setAttribute('aria-current', 'true');
      const name = document.createElement('span');
      name.className = 'packs-row-name';
      name.textContent = row.label;
      const meta = document.createElement('span');
      meta.className = 'packs-row-meta';
      meta.textContent = countText(row.levelCount);
      button.append(name, meta, this.badgesElement(row.badges));
      if (row.imported) {
        const tag = document.createElement('span');
        tag.className = 'packs-badge packs-badge-imported';
        tag.textContent = t('app.packs.manager.library.imported_tag.label');
        button.appendChild(tag);
      }
      button.addEventListener('click', () => {
        this.selectedId = row.id;
        this.transferLevelId = null;
        this.render();
      });
      item.appendChild(button);
      list.appendChild(item);
    }
  }

  private badgesElement(badges: readonly EngineBadge[]): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'packs-badges';
    for (const badge of badges) {
      const el = document.createElement('span');
      el.className = `packs-badge packs-badge-${badge}`;
      el.textContent = t(badgeLabelKey(badge));
      wrap.appendChild(el);
    }
    return wrap;
  }

  /** Header of the selected pack: name, badges, action states; or the empty library call to action. */
  private syncDetail(): void {
    const rows = this.libraryRows();
    const selectedRow = rows.find((row) => row.id === this.selectedId);
    const pack = this.selectedPack();
    const state = managerState(rows, selectedRow);
    byId('packs-empty-library')?.classList.toggle(HIDDEN_CLASS, state !== 'no_packs');
    byId('packs-selected')?.classList.toggle(HIDDEN_CLASS, state === 'no_packs' || !pack);
    byId('packs-empty-pack')?.classList.toggle(HIDDEN_CLASS, state !== 'empty_pack');
    if (!pack || !selectedRow) return;

    const nameInput = byId<HTMLInputElement>('packs-name-input');
    if (nameInput) nameInput.value = selectedRow.label;
    const badges = byId('packs-detail-badges');
    if (badges) {
      badges.innerHTML = '';
      badges.appendChild(this.badgesElement(selectedRow.badges));
    }

    const actions = buildPackActions(pack.levels, (level) => datRefusalReason(level) === null);
    const play = byId<HTMLButtonElement>('packs-play-btn');
    if (play) {
      play.disabled = !actions.canPlay;
      this.setDisabledReason(play, !actions.canPlay, 'app.packs.manager.detail.play_empty.label');
    }
    const exportJson = byId<HTMLButtonElement>('packs-export-json-btn');
    if (exportJson) {
      exportJson.disabled = !actions.canExportJson;
      this.setDisabledReason(exportJson, !actions.canExportJson, 'app.packs.manager.detail.play_empty.label');
    }
    const exportCcl = byId<HTMLButtonElement>('packs-export-ccl-btn');
    if (exportCcl) {
      exportCcl.disabled = !actions.canExportCcl;
      this.setDisabledReason(exportCcl, !actions.canExportCcl, 'app.export.none_exportable.label');
    }
  }

  private setDisabledReason(button: HTMLElement, disabled: boolean, reasonKey: string): void {
    if (disabled) button.title = t(reasonKey);
    else button.removeAttribute('title');
  }

  private renderLevels(): void {
    const list = byId('packs-levels-list');
    if (!list) return;
    list.innerHTML = '';
    const pack = this.selectedPack();
    if (!pack) return;
    for (const row of buildLevelRows(pack.levels, (level) => this.host.levelTitle(level))) {
      list.appendChild(this.levelItem(pack, row));
    }
  }

  private levelItem(pack: LevelPack, row: LevelRow): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'packs-level';
    item.dataset.levelId = row.levelId;

    const number = document.createElement('span');
    number.className = 'packs-level-number';
    number.textContent = String(row.number);
    const title = document.createElement('span');
    title.className = 'packs-level-title';
    title.textContent = row.title;
    const actions = document.createElement('div');
    actions.className = 'packs-level-actions';
    const params = { number: row.number, title: row.title };

    const button = (
      action: RowAction,
      labelKey: string,
      ariaKey: string | null,
      disabled: boolean,
      onClick: () => void
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn small';
      btn.textContent = t(labelKey);
      btn.setAttribute('aria-label', ariaKey ? t(ariaKey, params) : t(labelKey));
      btn.setAttribute(PACK_MANAGER_FOCUS_ATTRIBUTE, `${row.levelId}:${action}`);
      btn.disabled = disabled;
      btn.addEventListener('click', onClick);
      return btn;
    };
    const index = row.number - 1;

    const up = button('up', 'app.packs.manager.level.move_up.action', null, !row.canMoveUp, () =>
      void this.moveLevel(pack.id, index, index - 1, row.levelId, 'up')
    );
    up.setAttribute('aria-label', t('app.packs.manager.level.move_up.aria', params));
    const down = button('down', 'app.packs.manager.level.move_down.action', null, !row.canMoveDown, () =>
      void this.moveLevel(pack.id, index, index + 1, row.levelId, 'down')
    );
    down.setAttribute('aria-label', t('app.packs.manager.level.move_down.aria', params));
    const edit = button('edit', 'app.packs.manager.level.edit.action', 'app.packs.manager.level.aria.edit.label', !row.canEdit, () =>
      void this.host.editLevel(pack.id, row.levelId).then((opened) => opened && this.close())
    );
    const play = button('play', 'app.packs.manager.level.play.action', 'app.packs.manager.level.aria.play.label', false, () =>
      this.playFrom(pack.id, index)
    );
    const duplicate = button(
      'duplicate',
      'app.packs.manager.level.duplicate.action',
      'app.packs.manager.level.aria.duplicate.label',
      false,
      () => void this.duplicateLevel(pack.id, row.levelId)
    );
    const transfer = button(
      'transfer',
      'app.packs.manager.level.transfer.action',
      'app.packs.manager.level.aria.transfer.label',
      false,
      () => this.toggleTransfer(row.levelId)
    );
    transfer.setAttribute('aria-expanded', String(this.transferLevelId === row.levelId));
    const remove = button(
      'delete',
      'app.packs.manager.level.delete.action',
      'app.packs.manager.level.aria.delete.label',
      false,
      () => void this.deleteLevel(pack, row)
    );
    actions.append(up, down, edit, play, duplicate, transfer, remove);

    item.append(number, title, this.badgesElement(row.badges), actions);
    if (!row.canEdit && row.editBlockedReasonKey) {
      const reason = document.createElement('p');
      reason.className = 'hint-text packs-level-reason';
      reason.textContent = t(row.editBlockedReasonKey);
      item.appendChild(reason);
    }
    if (this.transferLevelId === row.levelId) item.appendChild(this.transferPanel(pack, row));
    return item;
  }

  private transferPanel(pack: LevelPack, row: LevelRow): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'packs-transfer';
    const targets = transferTargets(this.libraryRows(), pack.id);
    if (targets.length === 0) {
      const none = document.createElement('p');
      none.className = 'hint-text';
      none.textContent = t('app.packs.manager.transfer.none.label');
      panel.appendChild(none);
      return panel;
    }
    const field = (labelKey: string, control: HTMLSelectElement): HTMLElement => {
      const wrap = document.createElement('label');
      wrap.className = 'packs-transfer-field';
      const text = document.createElement('span');
      text.textContent = t(labelKey);
      wrap.append(text, control);
      return wrap;
    };
    const destination = document.createElement('select');
    destination.className = 'editor-input';
    for (const target of targets) {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = target.label;
      destination.appendChild(option);
    }
    const mode = document.createElement('select');
    mode.className = 'editor-input';
    for (const value of [TRANSFER_COPY, TRANSFER_MOVE] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(`app.packs.manager.transfer.${value}.label`);
      mode.appendChild(option);
    }
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'hud-btn small primary';
    apply.textContent = t('app.packs.manager.transfer.apply.action');
    apply.addEventListener('click', () =>
      void this.transferLevel(pack.id, row.levelId, destination.value, mode.value as TransferMode)
    );
    panel.append(
      field('app.packs.manager.transfer.destination.label', destination),
      field('app.packs.manager.transfer.mode.label', mode),
      apply
    );
    return panel;
  }

  /** Puts focus back on the button a redraw replaced, or on the nearest one still enabled. */
  private restoreFocus(focusKey: string): void {
    if (!focusKey.includes(':')) {
      byId(focusKey)?.focus();
      return;
    }
    const find = (key: string): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>(`[${PACK_MANAGER_FOCUS_ATTRIBUTE}="${CSS.escape(key)}"]`);
    const direct = find(focusKey);
    if (direct && !direct.disabled) {
      direct.focus();
      return;
    }
    const levelId = focusKey.slice(0, focusKey.lastIndexOf(':'));
    const sibling = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`#packs-levels-list [${PACK_MANAGER_FOCUS_ATTRIBUTE}^="${CSS.escape(levelId)}:"]`)
    ).find((btn) => !btn.disabled);
    (sibling ?? byId('packs-new-level-btn'))?.focus();
  }

  // -- Actions: packs --------------------------------------------------------------

  private showNewPackForm(): void {
    const form = byId('packs-new-form');
    const input = byId<HTMLInputElement>('packs-new-input');
    form?.classList.remove(HIDDEN_CLASS);
    byId('packs-new-btn')?.setAttribute('aria-expanded', 'true');
    if (input) {
      input.value = '';
      input.removeAttribute('aria-invalid');
      input.focus();
    }
  }

  private hideNewPackForm(): void {
    byId('packs-new-form')?.classList.add(HIDDEN_CLASS);
    byId('packs-new-btn')?.setAttribute('aria-expanded', 'false');
  }

  private toggleNewPackForm(): void {
    if (byId('packs-new-form')?.classList.contains(HIDDEN_CLASS)) this.showNewPackForm();
    else this.hideNewPackForm();
  }

  private async createPack(): Promise<void> {
    const input = byId<HTMLInputElement>('packs-new-input');
    const name = normalizePackName(input?.value ?? '');
    if (name === '') {
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
      return;
    }
    const result = await ConfigRegistry.createUserPack(name);
    if (!result.ok || !result.pack) {
      this.host.notify(t('app.packs.manager.toast.failed.label'));
      return;
    }
    this.hideNewPackForm();
    this.selectedId = result.pack.id;
    this.transferLevelId = null;
    this.render();
    this.host.libraryChanged({ deletedPackIds: [] });
    this.report(result, t('app.packs.manager.toast.created.label', { name: result.pack.name }));
    byId('packs-new-level-btn')?.focus();
  }

  private async commitRename(): Promise<void> {
    const pack = this.selectedPack();
    const input = byId<HTMLInputElement>('packs-name-input');
    if (!pack || !input || this.renaming) return;
    const name = normalizePackName(input.value);
    if (name === '' || name === normalizePackName(this.host.packDisplayName(pack))) {
      input.value = this.host.packDisplayName(pack);
      return;
    }
    this.renaming = true;
    try {
      const result = await ConfigRegistry.renamePack(pack.id, name);
      if (!result.ok) input.value = this.host.packDisplayName(pack);
      else if (!result.persisted) this.host.notify(t('app.packs.manager.toast.session_only.label'));
    } finally {
      this.renaming = false;
    }
    this.render();
    this.host.libraryChanged({ deletedPackIds: [] });
  }

  private playFrom(packId: string, levelIndex: number): void {
    this.close();
    this.host.playPack(packId, levelIndex);
  }

  private exportJson(pack: LevelPack): void {
    const name = this.host.packDisplayName(pack);
    const text = ConfigRegistry.exportPackJson(pack.id, name);
    if (text === null) return;
    downloadBlob(new Blob([text], { type: MIME_JSON }), packFileName(name, pack.id));
    this.host.notify(t('app.packs.manager.toast.exported.label', { name }));
  }

  private async deleteSelectedPack(): Promise<void> {
    const pack = this.selectedPack();
    if (!pack) return;
    const name = this.host.packDisplayName(pack);
    const confirmed = await this.askDeletePack(
      t('app.packs.manager.delete_dialog.message.label', { name, count: pack.levels.length }),
      pack.levels.length > 0 ? () => this.exportJson(pack) : null
    );
    if (!confirmed) return;
    const rows = this.libraryRows();
    const nextId = selectionAfterRemoval(rows, pack.id);
    const result = await ConfigRegistry.deletePack(pack.id);
    this.selectedId = nextId;
    this.transferLevelId = null;
    this.render();
    this.host.libraryChanged({ deletedPackIds: [pack.id] });
    this.report(result, t('app.packs.manager.toast.deleted.label', { name }));
    this.initialFocus()?.focus();
  }

  // -- Actions: levels -------------------------------------------------------------

  private async moveLevel(
    packId: string,
    from: number,
    to: number,
    levelId: string,
    direction: 'up' | 'down'
  ): Promise<void> {
    const result = await ConfigRegistry.moveLevelInPack(packId, from, to);
    if (!result.ok) {
      this.host.notify(t('app.packs.manager.toast.failed.label'));
      return;
    }
    if (!result.persisted) this.host.notify(t('app.packs.manager.toast.session_only.label'));
    this.render(`${levelId}:${direction}`);
    this.host.libraryChanged({ deletedPackIds: [] });
  }

  private async duplicateLevel(packId: string, levelId: string): Promise<void> {
    const result = await ConfigRegistry.duplicateLevelInPack(packId, levelId);
    if (!this.report(result, t('app.packs.manager.toast.duplicated.label'))) return;
    this.render(`${result.level?.id ?? levelId}:duplicate`);
    this.host.libraryChanged({ deletedPackIds: [] });
  }

  private toggleTransfer(levelId: string): void {
    this.transferLevelId = this.transferLevelId === levelId ? null : levelId;
    this.render(`${levelId}:transfer`);
  }

  private async transferLevel(
    fromPackId: string,
    levelId: string,
    toPackId: string,
    mode: TransferMode
  ): Promise<void> {
    const destination = ConfigRegistry.getEditablePacks().find((pack) => pack.id === toPackId);
    if (!destination) return;
    const name = this.host.packDisplayName(destination);
    const result =
      mode === TRANSFER_MOVE
        ? await ConfigRegistry.moveLevelToPack(fromPackId, levelId, toPackId)
        : await ConfigRegistry.copyLevelToPack(fromPackId, levelId, toPackId);
    const key = mode === TRANSFER_MOVE ? 'app.packs.manager.toast.moved.label' : 'app.packs.manager.toast.copied.label';
    if (!this.report(result, t(key, { name }))) return;
    this.transferLevelId = null;
    this.render(`${levelId}:transfer`);
    this.host.libraryChanged({ deletedPackIds: [] });
  }

  private async deleteLevel(pack: LevelPack, row: LevelRow): Promise<void> {
    const confirmed = await confirmDialog({
      title: t('app.confirm.title.label'),
      message: t('app.packs.manager.delete_level.confirm.label', {
        number: row.number,
        title: row.title,
        name: this.host.packDisplayName(pack)
      }),
      confirmLabel: t('app.confirm.delete.action'),
      cancelLabel: t('app.confirm.cancel.action')
    });
    if (!confirmed) return;
    const neighbour = pack.levels[row.number] ?? pack.levels[row.number - 2];
    const result = await ConfigRegistry.removeLevelFromPack(pack.id, row.levelId);
    if (!this.report(result, t('app.packs.manager.toast.level_deleted.label'))) return;
    this.transferLevelId = null;
    this.render(neighbour ? `${neighbour.id}:delete` : 'packs-new-level-btn');
    this.host.libraryChanged({ deletedPackIds: [] });
  }

  // -- Delete pack dialog ------------------------------------------------------------

  /**
   * Three-way confirmation: Delete, Cancel (focused first), and "Export first",
   * which exports a copy and leaves the dialog open so the player can then delete.
   */
  private askDeletePack(message: string, exportFirst: (() => void) | null): Promise<boolean> {
    const modal = byId(DELETE_MODAL_ID);
    const cancel = byId<HTMLButtonElement>('pack-delete-cancel-btn');
    const ok = byId<HTMLButtonElement>('pack-delete-ok-btn');
    const exportBtn = byId<HTMLButtonElement>('pack-delete-export-btn');
    if (!modal || !cancel || !ok || !exportBtn) return Promise.resolve(false);
    const messageEl = byId('pack-delete-message');
    const noteEl = byId('pack-delete-note');
    if (messageEl) messageEl.textContent = message;
    if (noteEl) noteEl.textContent = '';
    exportBtn.classList.toggle(HIDDEN_CLASS, exportFirst === null);

    return new Promise<boolean>((resolve) => {
      let answered = false;
      const answer = (value: boolean): void => {
        if (answered) return;
        answered = true;
        cancel.removeEventListener('click', onCancel);
        ok.removeEventListener('click', onOk);
        exportBtn.removeEventListener('click', onExport);
        resolve(value);
      };
      const onCancel = (): void => closeDialog(modal);
      const onOk = (): void => {
        answer(true);
        closeDialog(modal);
      };
      const onExport = (): void => {
        exportFirst?.();
        if (noteEl) noteEl.textContent = t('app.packs.manager.delete_dialog.exported.label');
      };
      cancel.addEventListener('click', onCancel);
      ok.addEventListener('click', onOk);
      exportBtn.addEventListener('click', onExport);
      openDialog(modal, document.activeElement as HTMLElement | null, {
        initialFocus: cancel,
        onClose: () => answer(false)
      });
    });
  }
}
