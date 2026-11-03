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
import { PackMetadataLimits } from '../packs/packMetadata';
import { normalizePackName } from '../packs/userPacks';
import { choiceDialog } from './choiceDialog';
import { confirmDialog } from './confirmDialog';
import { closeDialog, openDialog } from './dialog';
import { downloadBlob, MIME_JSON } from './download';
import { ThumbnailBatch } from './levelThumbnailView';
import {
  badgeLabelKey,
  buildLevelRows,
  buildLibraryRows,
  buildPackActions,
  dropSlotAt,
  dropTargetIndex,
  EngineBadge,
  LevelRow,
  LibraryRow,
  managerState,
  packFileName,
  resolveSelection,
  selectionAfterRemoval,
  transferTargets
} from './packManagerModel';
import {
  PACK_DRAG_HANDLE_GLYPH,
  PACK_DRAG_SCROLL_EDGE_PX,
  PACK_DRAG_SCROLL_STEP_PX,
  PACK_DRAG_START_DISTANCE_PX,
  PACK_MANAGER_FOCUS_ATTRIBUTE,
  PACK_MOVE_DOWN_GLYPH,
  PACK_MOVE_UP_GLYPH,
  THUMBNAIL_LEVEL_BOX,
  THUMBNAIL_LIBRARY_BOX
} from './uiConstants';

const MODAL_ID = 'packs-modal';
const DELETE_CHOICE_ID = 'delete';
const EXPORT_CHOICE_ID = 'export';
const HIDDEN_CLASS = 'hidden';
const TRANSFER_COPY = 'copy';
const TRANSFER_MOVE = 'move';
const DRAG_FOCUS_ACTION = 'drag';
const DRAG_HANDLE_ATTRIBUTE = 'data-drag-handle';
const DRAGGING_CLASS = 'packs-level-dragging';
const DROP_BEFORE_CLASS = 'packs-drop-before';
const DROP_AFTER_CLASS = 'packs-drop-after';
const LIST_DRAGGING_CLASS = 'is-dragging';
const PRIMARY_BUTTON = 0;

type TransferMode = typeof TRANSFER_COPY | typeof TRANSFER_MOVE;
type RowAction = 'up' | 'down' | 'edit' | 'play' | 'duplicate' | 'transfer' | 'delete';
type MoveFocus = 'up' | 'down' | typeof DRAG_FOCUS_ACTION;
type MetadataField = 'author' | 'description';

/** A level row being dragged by its handle. It becomes `active` once the pointer has travelled far enough. */
interface DragState {
  pointerId: number;
  packId: string;
  levelId: string;
  fromIndex: number;
  startY: number;
  active: boolean;
  targetIndex: number;
  item: HTMLElement;
  handle: HTMLElement;
}

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
  /** True while an author or description change is being stored. */
  private metaCommitting = false;
  private drag: DragState | null = null;
  private libraryThumbs: ThumbnailBatch | null = null;
  private levelThumbs: ThumbnailBatch | null = null;
  /** Packs with a change in flight: their row actions stay disabled until it resolves. */
  private readonly busyPackIds = new Set<string>();
  /** Button to focus when the redraw that ends an operation is done. */
  private pendingFocus: string | null = null;

  public constructor(private readonly host: PackManagerHost) {
    this.bindEscapeGuard();
    this.bindStaticControls();
  }

  public isOpen(): boolean {
    const modal = byId(MODAL_ID);
    return modal !== null && !modal.classList.contains(HIDDEN_CLASS);
  }

  /** Opens the manager, on the given pack when it is in the library. */
  public open(packId: string | null = null, opener: HTMLElement | null = null): void {
    const modal = byId(MODAL_ID);
    if (!modal) return;
    this.transferLevelId = null;
    this.hideNewPackForm();
    this.selectedId = resolveSelection(this.libraryRows(), packId);
    this.render();
    if (this.isOpen()) return;
    openDialog(modal, opener ?? (document.activeElement as HTMLElement | null), {
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
   * Escape in the pack fields (name, author, description) cancels the edit, and
   * Escape during a drag cancels the drag, instead of closing the
   * dialog. The dialog helper listens on window in the capture phase and binds
   * on its first use, after this constructor: this listener runs first and
   * stops the event.
   */
  private bindEscapeGuard(): void {
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        if (this.drag) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.endDrag();
          return;
        }
        const target = e.target as HTMLElement | null;
        if (target?.id === 'packs-name-input' || target?.id === 'packs-author-input' || target?.id === 'packs-description-input') {
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

    const authorInput = byId<HTMLInputElement>('packs-author-input');
    authorInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.commitMetadata('author');
      }
    });
    authorInput?.addEventListener('blur', () => void this.commitMetadata('author'));
    const descriptionInput = byId<HTMLTextAreaElement>('packs-description-input');
    descriptionInput?.addEventListener('keydown', (e) => {
      // Enter adds a line; Ctrl+Enter (Cmd+Enter) commits.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.commitMetadata('description');
      }
    });
    descriptionInput?.addEventListener('blur', () => void this.commitMetadata('description'));

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
    // The rows are rebuilt: a drag in flight would point at a row that is gone.
    this.endDrag();
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
    this.libraryThumbs?.dispose();
    const thumbs = new ThumbnailBatch();
    this.libraryThumbs = thumbs;
    const packs = ConfigRegistry.getEditablePacks();
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
      const body = document.createElement('span');
      body.className = 'packs-row-body';
      body.append(name);
      if (row.author) {
        const author = document.createElement('span');
        author.className = 'packs-row-author';
        author.textContent = t('app.packs.manager.library.author.label', { author: row.author });
        body.appendChild(author);
      }
      body.append(meta, this.badgesElement(row.badges));
      if (row.imported) {
        const tag = document.createElement('span');
        tag.className = 'packs-badge packs-badge-imported';
        tag.textContent = t('app.packs.manager.library.imported_tag.label');
        body.appendChild(tag);
      }
      const firstLevel = packs.find((p) => p.id === row.id)?.levels[0];
      button.append(firstLevel ? thumbs.add(firstLevel, THUMBNAIL_LIBRARY_BOX) : this.emptyThumbnail(THUMBNAIL_LIBRARY_BOX), body);
      button.addEventListener('click', () => {
        this.selectedId = row.id;
        this.transferLevelId = null;
        this.render();
      });
      item.appendChild(button);
      list.appendChild(item);
    }
  }

  /** Same-size blank in place of the thumbnail of a pack with no level, so the rows stay aligned. */
  private emptyThumbnail(box: number): HTMLElement {
    const blank = document.createElement('span');
    blank.className = 'packs-thumb packs-thumb-empty';
    blank.setAttribute('aria-hidden', 'true');
    blank.style.width = `${box}px`;
    blank.style.height = `${box}px`;
    return blank;
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
    const limits = this.metadataLimits();
    const authorInput = byId<HTMLInputElement>('packs-author-input');
    if (authorInput) {
      authorInput.value = pack.author ?? '';
      if (limits) authorInput.maxLength = limits.authorMaxLength;
    }
    const descriptionInput = byId<HTMLTextAreaElement>('packs-description-input');
    if (descriptionInput) {
      descriptionInput.value = pack.description ?? '';
      if (limits) descriptionInput.maxLength = limits.descriptionMaxLength;
    }
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
    this.levelThumbs?.dispose();
    this.levelThumbs = new ThumbnailBatch();
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
    const busy = this.busyPackIds.has(pack.id);

    const up = button('up', 'app.packs.manager.level.move_up.action', null, !row.canMoveUp || busy, () =>
      void this.moveLevel(pack.id, row.levelId, index - 1, 'up', () => ConfigRegistry.moveLevelInPack(pack.id, index, index - 1))
    );
    up.setAttribute('aria-label', t('app.packs.manager.level.move_up.aria', params));
    up.title = t('app.packs.manager.level.move_up.action');
    up.textContent = PACK_MOVE_UP_GLYPH;
    up.classList.add('packs-arrow-btn');
    const down = button('down', 'app.packs.manager.level.move_down.action', null, !row.canMoveDown || busy, () =>
      void this.moveLevel(pack.id, row.levelId, index + 1, 'down', () => ConfigRegistry.moveLevelInPack(pack.id, index, index + 1))
    );
    down.setAttribute('aria-label', t('app.packs.manager.level.move_down.aria', params));
    down.title = t('app.packs.manager.level.move_down.action');
    down.textContent = PACK_MOVE_DOWN_GLYPH;
    down.classList.add('packs-arrow-btn');
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
      busy,
      () => void this.duplicateLevel(pack.id, row.levelId)
    );
    const transfer = button(
      'transfer',
      'app.packs.manager.level.transfer.action',
      'app.packs.manager.level.aria.transfer.label',
      busy,
      () => this.toggleTransfer(row.levelId)
    );
    transfer.setAttribute('aria-expanded', String(this.transferLevelId === row.levelId));
    const remove = button(
      'delete',
      'app.packs.manager.level.delete.action',
      'app.packs.manager.level.aria.delete.label',
      busy,
      () => void this.deleteLevel(pack, row)
    );
    edit.classList.add('primary');
    const group = (className: string, ...buttons: HTMLButtonElement[]): HTMLElement => {
      const el = document.createElement('div');
      el.className = `packs-level-group ${className}`;
      el.append(...buttons);
      return el;
    };
    actions.append(
      group('packs-level-primary', edit, play),
      group('packs-level-order', up, down),
      group('packs-level-more', duplicate, transfer, remove)
    );

    const level = pack.levels[index];
    const thumbnail = level && this.levelThumbs ? this.levelThumbs.add(level, THUMBNAIL_LEVEL_BOX) : this.emptyThumbnail(THUMBNAIL_LEVEL_BOX);
    item.append(
      this.dragHandle(pack, row, item, busy),
      thumbnail,
      number,
      title,
      this.badgesElement(row.badges),
      actions
    );
    if (!row.canEdit && row.editBlockedReasonKey) {
      const reason = document.createElement('p');
      reason.className = 'hint-text packs-level-reason';
      reason.textContent = t(row.editBlockedReasonKey);
      item.appendChild(reason);
    }
    if (this.transferLevelId === row.levelId) item.appendChild(this.transferPanel(pack, row));
    return item;
  }

  /**
   * The handle a level row is dragged by, and that also moves it with the
   * Up and Down keys. A pack with a single level has nothing to reorder: a
   * blank keeps the columns aligned.
   */
  private dragHandle(pack: LevelPack, row: LevelRow, item: HTMLElement, busy: boolean): HTMLElement {
    if (pack.levels.length < 2) {
      const spacer = document.createElement('span');
      spacer.className = 'packs-drag-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      return spacer;
    }
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'hud-btn small packs-drag-handle';
    handle.textContent = PACK_DRAG_HANDLE_GLYPH;
    handle.title = t('app.packs.manager.level.drag.action');
    handle.setAttribute('aria-label', t('app.packs.manager.level.drag.aria', { number: row.number, title: row.title }));
    handle.setAttribute(DRAG_HANDLE_ATTRIBUTE, row.levelId);
    handle.disabled = busy;
    handle.addEventListener('pointerdown', (e) => this.beginDrag(e, pack, row, item, handle));
    handle.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const index = row.number - 1;
      const to = e.key === 'ArrowUp' ? index - 1 : index + 1;
      if (to < 0 || to >= pack.levels.length) return;
      void this.moveLevel(pack.id, row.levelId, to, DRAG_FOCUS_ACTION, () =>
        ConfigRegistry.moveLevelInPack(pack.id, index, to)
      );
    });
    return handle;
  }

  // -- Drag and drop -----------------------------------------------------------------

  private beginDrag(e: PointerEvent, pack: LevelPack, row: LevelRow, item: HTMLElement, handle: HTMLElement): void {
    if (e.pointerType === 'mouse' && e.button !== PRIMARY_BUTTON) return;
    // A rename or metadata change in flight redraws the list when it ends.
    if (this.drag || this.renaming || this.metaCommitting || this.busyPackIds.has(pack.id)) return;
    this.drag = {
      pointerId: e.pointerId,
      packId: pack.id,
      levelId: row.levelId,
      fromIndex: row.number - 1,
      startY: e.clientY,
      active: false,
      targetIndex: row.number - 1,
      item,
      handle
    };
    handle.setPointerCapture?.(e.pointerId);
    handle.addEventListener('pointermove', this.onDragMove);
    handle.addEventListener('pointerup', this.onDragEnd);
    handle.addEventListener('pointercancel', this.onDragCancel);
  }

  private readonly onDragMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < PACK_DRAG_START_DISTANCE_PX) return;
      drag.active = true;
      drag.item.classList.add(DRAGGING_CLASS);
      byId('packs-levels-list')?.classList.add(LIST_DRAGGING_CLASS);
    }
    e.preventDefault();
    this.scrollWhileDragging(e.clientY);
    const rows = this.levelRowElements();
    const slot = dropSlotAt(
      e.clientY,
      rows.map((el) => {
        const box = el.getBoundingClientRect();
        return box.top + box.height / 2;
      })
    );
    drag.targetIndex = dropTargetIndex(drag.fromIndex, slot);
    this.showDropIndicator(rows, slot, drag.targetIndex !== drag.fromIndex);
  };

  private readonly onDragEnd = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.endDrag();
    if (drag.active && drag.targetIndex !== drag.fromIndex) {
      const to = drag.targetIndex;
      void this.moveLevel(drag.packId, drag.levelId, to, DRAG_FOCUS_ACTION, () =>
        ConfigRegistry.moveLevelToIndex(drag.packId, drag.levelId, to)
      );
    }
  };

  private readonly onDragCancel = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag();
  };

  /** Ends the drag in flight, if any, without moving anything. */
  private endDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.handle.removeEventListener('pointermove', this.onDragMove);
    drag.handle.removeEventListener('pointerup', this.onDragEnd);
    drag.handle.removeEventListener('pointercancel', this.onDragCancel);
    if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    drag.item.classList.remove(DRAGGING_CLASS);
    byId('packs-levels-list')?.classList.remove(LIST_DRAGGING_CLASS);
    this.showDropIndicator(this.levelRowElements(), 0, false);
  }

  private levelRowElements(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('#packs-levels-list > .packs-level'));
  }

  /** Draws the drop line before the row at `slot`, or after the last row when the slot is past it. */
  private showDropIndicator(rows: readonly HTMLElement[], slot: number, visible: boolean): void {
    for (const row of rows) row.classList.remove(DROP_BEFORE_CLASS, DROP_AFTER_CLASS);
    if (!visible || rows.length === 0) return;
    if (slot < rows.length) rows[slot].classList.add(DROP_BEFORE_CLASS);
    else rows[rows.length - 1].classList.add(DROP_AFTER_CLASS);
  }

  /** Scrolls the detail column when the pointer nears its top or bottom edge. */
  private scrollWhileDragging(pointerY: number): void {
    const column = byId('packs-detail');
    if (!column) return;
    const box = column.getBoundingClientRect();
    if (pointerY < box.top + PACK_DRAG_SCROLL_EDGE_PX) column.scrollTop -= PACK_DRAG_SCROLL_STEP_PX;
    else if (pointerY > box.bottom - PACK_DRAG_SCROLL_EDGE_PX) column.scrollTop += PACK_DRAG_SCROLL_STEP_PX;
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
    apply.disabled = this.busyPackIds.has(pack.id);
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
    if (focusKey.endsWith(`:${DRAG_FOCUS_ACTION}`)) {
      const levelId = focusKey.slice(0, focusKey.lastIndexOf(':'));
      const handle = document.querySelector<HTMLButtonElement>(`[${DRAG_HANDLE_ATTRIBUTE}="${CSS.escape(levelId)}"]`);
      if (handle && !handle.disabled) {
        handle.focus();
        return;
      }
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
    const renamedId = pack.id;
    try {
      const result = await ConfigRegistry.renamePack(renamedId, name);
      if (!result.ok) {
        // Restore the name of the pack that was renamed, not of whichever pack is selected now.
        const renamed = ConfigRegistry.getEditablePacks().find((p) => p.id === renamedId);
        if (renamed && this.selectedId === renamedId) input.value = this.host.packDisplayName(renamed);
        this.host.notify(t('app.packs.manager.toast.failed.label'));
      } else if (!result.persisted) {
        this.host.notify(t('app.packs.manager.toast.session_only.label'));
      }
    } finally {
      this.renaming = false;
    }
    this.render();
    this.host.libraryChanged({ deletedPackIds: [] });
  }

  /** Limits of the author and description fields; null while the game config is not loaded. */
  private metadataLimits(): PackMetadataLimits | null {
    return (ConfigRegistry.getGame() as { packMetadata?: PackMetadataLimits } | undefined)?.packMetadata ?? null;
  }

  /** Stores the author or description field of the selected pack when its text changed. */
  private async commitMetadata(field: MetadataField): Promise<void> {
    const pack = this.selectedPack();
    const input = byId<HTMLInputElement | HTMLTextAreaElement>(
      field === 'author' ? 'packs-author-input' : 'packs-description-input'
    );
    if (!pack || !input || this.metaCommitting) return;
    const text = input.value.replace(/\r\n?/g, '\n').trim();
    if (text === (pack[field] ?? '')) {
      input.value = pack[field] ?? '';
      return;
    }
    this.metaCommitting = true;
    const packId = pack.id;
    try {
      const result = await ConfigRegistry.setPackMetadata(packId, { [field]: text });
      if (!result.ok) {
        const current = ConfigRegistry.getEditablePacks().find((p) => p.id === packId);
        if (current && this.selectedId === packId) input.value = current[field] ?? '';
        this.host.notify(t('app.packs.manager.toast.failed.label'));
      } else if (!result.persisted) {
        this.host.notify(t('app.packs.manager.toast.session_only.label'));
      }
    } finally {
      this.metaCommitting = false;
    }
    this.render();
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
    if (!pack || this.busyPackIds.has(pack.id)) return;
    const name = this.host.packDisplayName(pack);
    const answer = await choiceDialog({
      title: t('app.confirm.title.label'),
      message: t('app.packs.manager.delete_dialog.message.label', { name, count: pack.levels.length }),
      cancelLabel: t('app.confirm.cancel.action'),
      options: [
        ...(pack.levels.length > 0
          ? [
              {
                id: EXPORT_CHOICE_ID,
                label: t('app.packs.manager.delete_dialog.export.action'),
                keepOpen: true,
                onSelect: (): string => {
                  this.exportJson(pack);
                  return t('app.packs.manager.delete_dialog.exported.label');
                }
              }
            ]
          : []),
        { id: DELETE_CHOICE_ID, label: t('app.confirm.delete.action'), primary: true }
      ]
    });
    if (answer !== DELETE_CHOICE_ID) return;
    const nextId = selectionAfterRemoval(this.libraryRows(), pack.id);
    const result = await ConfigRegistry.deletePack(pack.id);
    if (!result.ok) {
      // Nothing was deleted: no follow-up for a pack that is still there.
      this.host.notify(t('app.packs.manager.toast.failed.label'));
      return;
    }
    this.selectedId = nextId;
    this.transferLevelId = null;
    this.render();
    this.host.libraryChanged({ deletedPackIds: [pack.id] });
    this.report(result, t('app.packs.manager.toast.deleted.label', { name }));
    this.initialFocus()?.focus();
  }

  // -- Actions: levels -------------------------------------------------------------

  /**
   * Runs a change to a pack's levels with its row actions disabled, so a second
   * click cannot start a second change on stale data. The redraw that ends it
   * puts focus on `pendingFocus`.
   */
  private async runOp(packId: string, op: () => Promise<void>): Promise<void> {
    if (this.busyPackIds.has(packId)) return;
    this.busyPackIds.add(packId);
    this.pendingFocus = null;
    this.render();
    try {
      await op();
    } finally {
      this.busyPackIds.delete(packId);
      const focus = this.pendingFocus;
      this.pendingFocus = null;
      this.render(focus);
    }
  }

  /**
   * Moves a level to `to` through `change`, then puts focus on the control that
   * started the move (`focus`) and announces the new position.
   */
  private async moveLevel(
    packId: string,
    levelId: string,
    to: number,
    focus: MoveFocus,
    change: () => Promise<PackOperationResult>
  ): Promise<void> {
    const moved = this.selectedPack()?.levels.find((l) => l.id === levelId);
    const title = moved ? this.host.levelTitle(moved) : levelId;
    const count = this.selectedPack()?.levels.length ?? 0;
    await this.runOp(packId, async () => {
      const result = await change();
      if (!result.ok) {
        this.host.notify(t('app.packs.manager.toast.failed.label'));
        return;
      }
      if (!result.persisted) this.host.notify(t('app.packs.manager.toast.session_only.label'));
      this.pendingFocus = `${levelId}:${focus}`;
      this.announce(t('app.packs.manager.level.moved.label', { title, position: to + 1, count }));
      this.host.libraryChanged({ deletedPackIds: [] });
    });
  }

  /** Says something to assistive technology through the manager's live region. */
  private announce(message: string): void {
    const live = byId('packs-live');
    if (!live) return;
    live.textContent = '';
    live.textContent = message;
  }

  private async duplicateLevel(packId: string, levelId: string): Promise<void> {
    await this.runOp(packId, async () => {
      const result = await ConfigRegistry.duplicateLevelInPack(packId, levelId);
      if (!this.report(result, t('app.packs.manager.toast.duplicated.label'))) return;
      this.pendingFocus = `${result.level?.id ?? levelId}:duplicate`;
      this.host.libraryChanged({ deletedPackIds: [] });
    });
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
    await this.runOp(fromPackId, async () => {
      const result =
        mode === TRANSFER_MOVE
          ? await ConfigRegistry.moveLevelToPack(fromPackId, levelId, toPackId)
          : await ConfigRegistry.copyLevelToPack(fromPackId, levelId, toPackId);
      const key = mode === TRANSFER_MOVE ? 'app.packs.manager.toast.moved.label' : 'app.packs.manager.toast.copied.label';
      if (!this.report(result, t(key, { name }))) return;
      this.transferLevelId = null;
      this.pendingFocus = `${levelId}:transfer`;
      this.host.libraryChanged({ deletedPackIds: [] });
    });
  }

  private async deleteLevel(pack: LevelPack, row: LevelRow): Promise<void> {
    if (this.busyPackIds.has(pack.id)) return;
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
    await this.runOp(pack.id, async () => {
      const result = await ConfigRegistry.removeLevelFromPack(pack.id, row.levelId);
      if (!this.report(result, t('app.packs.manager.toast.level_deleted.label'))) return;
      this.transferLevelId = null;
      this.pendingFocus = neighbour ? `${neighbour.id}:delete` : 'packs-new-level-btn';
      this.host.libraryChanged({ deletedPackIds: [] });
    });
  }
}
