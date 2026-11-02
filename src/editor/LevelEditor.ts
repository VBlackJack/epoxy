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
import { IMPORTED_PACK_RULESET } from '../config/constants';
import { InvalidLevelError } from '../config/ConfigValidation';
import { t } from '../i18n/I18nManager';
import { parsePackJson } from '../packs/packJson';
import { choiceDialog } from '../ui/choiceDialog';
import { confirmDialog } from '../ui/confirmDialog';
import { askSaveInto } from '../ui/saveIntoDialog';
import { PixelRenderer } from '../render/PixelRenderer';
import { DatCodec } from '../formats/DatCodec';
import { CC3D_XML_EXTENSION } from '../formats/Cc3dXmlCodec';
import { decodeXsbCollection, XSB_EXTENSIONS } from '../formats/XsbCodec';
import { LevelValidator } from '../core/LevelValidator';
import { hasLaserContent } from '../core/RulesetFeatures';
import { ProceduralGenerationError, ProceduralGenerator } from '../core/ProceduralGenerator';
import {
  CloneLink,
  CompiledLevel,
  Direction,
  EntityPlacement,
  LevelBlueprint,
  LevelPack,
  Ruleset,
  TrapLink,
  ValidationIssue,
  WinRule
} from '../core/types';
import { downloadBytes, downloadJson } from '../ui/download';
import { lossyExportNotice } from '../ui/exportNotice';
import { receiversProgress } from '../ui/levelFeedback';
import { DEFAULT_RULESET, DEFAULT_WIN_RULE } from '../core/coreConstants';
import { isEditableRuleset, parseChipsRequired, parseRuleset, parseTimeLimit, parseWinRule, requiresEpoxyRules } from './metadataFields';
import { majorityRuleset } from './paletteAvailability';
import {
  decideSave,
  LoadedTexts,
  mayRebindAfterSave,
  needsImportedConfirmation,
  NO_SOURCE,
  nextEditableIndex,
  pickSaveDestination,
  prepareLevelForSave,
  reconcileSource,
  resolveSavedPassword,
  SaveSource
} from './saveTarget';
import { formatMegabytes, isImportSizeAllowed } from '../ui/importLimits';
import {
  EDITOR_CLONE_LINK_COLOR,
  EDITOR_DEFAULT_CHIPS_REQUIRED,
  EDITOR_DEFAULT_CLONE_TEMPLATE,
  EDITOR_GENERATOR_MAX_LEVEL,
  EDITOR_GENERATOR_MIN_LEVEL,
  EDITOR_DEFAULT_TIME_LIMIT_SECONDS,
  EDITOR_LINK_LINE_WIDTH,
  EDITOR_PASSWORD_LENGTH,
  EDITOR_TILE_CENTER_OFFSET,
  EDITOR_TRAP_LINK_COLOR,
  TIMING_DEFAULTS
} from '../ui/uiConstants';

const EXPORT_FALLBACK_FILE_NAME = 'epoxy_level';
const METADATA_INPUT_IDS = [
  'editor-meta-title',
  'editor-meta-hint',
  'editor-meta-author',
  'editor-meta-password',
  'editor-meta-time',
  'editor-meta-chips',
  'editor-meta-winrule',
  'editor-meta-ruleset'
] as const;
const WIN_RULE_INPUT_ID = 'editor-meta-winrule';
const TITLE_INPUT_ID = 'editor-meta-title';
const LYNX_RULESET: Ruleset = 'lynx';
/** Value of the context pack select while the editor content belongs to no pack. */
const NO_PACK_OPTION_VALUE = '';
/** Answers of the imported-pack and multi-level-file questions. */
const IMPORTED_MODIFY_CHOICE = 'modify';
const IMPORTED_COPY_CHOICE = 'copy';
const IMPORT_AS_PACK_CHOICE = 'pack';
const IMPORT_FIRST_CHOICE = 'first';

/** Where a save puts the level: an existing pack or a pack to create, and whether it is stored as a new level. */
interface SaveDestination {
  packId: string | null;
  newPackName: string | null;
  asCopy: boolean;
}

type BrushKind = 'terrain' | 'item' | 'entity' | 'player_start' | 'eraser' | 'wire_trap' | 'wire_cloner';

interface ActiveBrush {
  kind: BrushKind;
  id: string;
}

interface EditorSnapshot {
  terrain: string[][];
  items: (string | null)[][];
  entities: EntityPlacement[];
  trapLinks: TrapLink[];
  cloneLinks: CloneLink[];
  playerStart: { x: number; y: number; dir: Direction };
}

/** What the application learns when a level was saved. */
export interface SavedLevelInfo {
  packId: string;
  packName: string;
  levelId: string;
  /** Position of the level in its pack, 0-based. */
  index: number;
  persisted: boolean;
  /** The level kept its id but its map changed, so its best record and replay no longer apply. */
  recordsInvalidated: boolean;
}

/** What the editor asks of the application around it. */
export interface EditorHooks {
  onTestPlay: (level: CompiledLevel) => void;
  onLevelSaved: (info: SavedLevelInfo) => void;
  onNotify: (message: string) => void;
  /** Opens the pack manager, on the given pack when set. */
  openManager: (packId: string | null) => void;
  /** Registers a file's levels as an imported pack (the existing import flow). */
  importAsPack: (name: string, levels: CompiledLevel[], skipped: number) => Promise<void>;
}

/** Where a loaded level comes from, and whether it counts as unsaved work. */
export interface LoadOptions {
  source?: SaveSource;
  dirty?: boolean;
}

export class LevelEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: PixelRenderer;
  private hooks: EditorHooks;

  private terrain: string[][] = [];
  private items: (string | null)[][] = [];
  private entities: EntityPlacement[] = [];
  private trapLinks: TrapLink[] = [];
  private cloneLinks: CloneLink[] = [];
  private playerStart: { x: number; y: number; dir: Direction } = { x: 0, y: 0, dir: 'S' };

  /** Id the content carries until it is saved; a saved level keeps the id it is stored under. */
  private currentLevelId: string = '';
  /** Pack and level the content was opened from; both null for a blank map or a file. */
  private source: SaveSource = NO_SOURCE;
  /** The level as it was opened or last saved: what a save keeps from it (theme, keys, solution). */
  private originalLevel: CompiledLevel | null = null;
  /** Title and hint texts shown when `originalLevel` was opened, to tell whether the player changed them. */
  private loadedTexts: LoadedTexts | null = null;
  /** Imported packs the player agreed to modify during this session. */
  private confirmedImportedPackIds = new Set<string>();
  private saving = false;
  /** Bumped each time another level is loaded, so a save that outlives its level cannot rebind the editor. */
  private loadGeneration = 0;
  private customTitle: string = '';
  private customHint: string = '';
  private author: string = '';
  private password: string = '';
  private timeLimitSeconds: number = EDITOR_DEFAULT_TIME_LIMIT_SECONDS;
  private chipsRequired: number = EDITOR_DEFAULT_CHIPS_REQUIRED;
  private winRule: WinRule = DEFAULT_WIN_RULE;
  /** Ruleset of the loaded level, written back on export; absent means the default. */
  private ruleset: Ruleset | undefined;

  private activeCategory: string = 'terrain';
  private activeBrush: ActiveBrush = { kind: 'terrain', id: 'wall' };
  private fillMode: boolean = false;
  private activeDir: Direction = 'S';
  private isPainting: boolean = false;
  private isRightErasing: boolean = false;
  private dirty: boolean = false;
  /** Bumped on every write to isDirty, so an async save can tell whether the editor changed meanwhile. */
  private editRevision: number = 0;
  private get isDirty(): boolean {
    return this.dirty;
  }

  private set isDirty(value: boolean) {
    this.dirty = value;
    this.editRevision++;
    this.updateDirtyBadge();
  }

  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];
  private pendingWireSource: { x: number; y: number } | null = null;

  public constructor(
    canvas: HTMLCanvasElement,
    renderer: PixelRenderer,
    hooks: EditorHooks
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = context;
    this.renderer = renderer;
    this.hooks = hooks;

    this.initBlankMap();
    this.bindCanvasEvents();
    // Bound once: buildUI() runs again on graphics style changes and must
    // not stack toolbar listeners.
    this.bindToolbarEvents();
    this.bindMetadataEvents();
  }

  /** True when the map or its metadata changed since the last load or save. */
  public hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  /** Width of the level being edited, in cells; a level sets its own size. */
  private mapWidth(): number {
    return this.terrain[0]?.length ?? 0;
  }

  /** Height of the level being edited, in cells. */
  private mapHeight(): number {
    return this.terrain.length;
  }

  /** Sizes the canvas to the level being edited. */
  private fitCanvasToLevel(): void {
    const { editorTilePixelSize } = ConfigRegistry.getGame().grid;
    const width = this.mapWidth() * editorTilePixelSize;
    const height = this.mapHeight() * editorTilePixelSize;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  public initBlankMap(options: { packId?: string | null; ruleset?: Ruleset } = {}): void {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;

    this.terrain = Array.from({ length: mapHeight }, (_, y) =>
      Array.from({ length: mapWidth }, (__, x) =>
        x === 0 || y === 0 || x === mapWidth - 1 || y === mapHeight - 1 ? 'wall' : 'floor'
      )
    );
    this.items = Array.from({ length: mapHeight }, () =>
      Array.from({ length: mapWidth }, () => null)
    );
    this.entities = [];
    this.trapLinks = [];
    this.cloneLinks = [];
    this.playerStart = { x: Math.floor(mapWidth / 2), y: Math.floor(mapHeight / 2), dir: 'S' };
    this.fitCanvasToLevel();
    this.loadGeneration++;
    this.currentLevelId = ConfigRegistry.newLevelId();
    this.source = { packId: options.packId ?? null, levelId: null };
    this.originalLevel = null;
    this.loadedTexts = null;
    this.customTitle = t('editor.metadata.default_title.label');
    this.customHint = '';
    this.author = '';
    this.password = '';
    this.timeLimitSeconds = EDITOR_DEFAULT_TIME_LIMIT_SECONDS;
    this.chipsRequired = EDITOR_DEFAULT_CHIPS_REQUIRED;
    this.winRule = DEFAULT_WIN_RULE;
    this.ruleset = options.ruleset === LYNX_RULESET ? LYNX_RULESET : undefined;
    this.isDirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.setStatusText(t('editor.palette.status.ready.label'));
    this.refreshContext();
    this.render();
  }

  /**
   * Opens a level in the editor. A level of a ruleset the editor cannot hold is
   * refused (false) and the editor keeps what it has. `source` says which pack
   * and level a later save updates; a level that comes from a file or a
   * generator has none, and counts as unsaved work.
   */
  public loadCompiledLevel(level: CompiledLevel, options: LoadOptions = {}): boolean {
    if (!isEditableRuleset(level.ruleset)) {
      // The editor keeps what it holds; it only says why the level did not open.
      this.setStatusText(t('editor.palette.status.not_editable.label'));
      return false;
    }
    this.loadGeneration++;
    this.currentLevelId = level.id;
    this.source = options.source ?? NO_SOURCE;
    this.originalLevel = structuredClone(level);
    this.customTitle = this.resolveLevelTitle(level);
    this.customHint = level.customHint || (level.hintKey ? t(level.hintKey) : '');
    this.loadedTexts = { title: this.customTitle, hint: this.customHint };
    this.author = level.author ?? '';
    this.password = level.password;
    this.timeLimitSeconds = level.timeLimitSeconds;
    this.chipsRequired = level.chipsRequired;
    this.winRule = level.winRule ?? DEFAULT_WIN_RULE;
    this.ruleset = level.ruleset;
    this.playerStart = { ...level.playerStart };
    this.terrain = level.terrain.map((r) => [...r]);
    this.items = level.items.map((r) => [...r]);
    this.entities = level.entities.map((e) => ({ ...e }));
    this.trapLinks = level.trapLinks.map((l) => ({ ...l }));
    this.cloneLinks = level.cloneLinks.map((l) => ({ ...l }));
    this.fitCanvasToLevel();
    this.isDirty = options.dirty ?? false;
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.setStatusText(t('editor.palette.status.ready.label'));
    this.refreshContext();
    this.render();
    return true;
  }

  /** Asks before unsaved work is thrown away; true when there is none or the player agrees. */
  public async confirmDiscardIfDirty(): Promise<boolean> {
    if (!this.isDirty) return true;
    return confirmDialog({
      title: t('app.confirm.title.label'),
      message: t('editor.toolbar.confirm_discard.label'),
      confirmLabel: t('editor.pack.discard.action'),
      cancelLabel: t('app.confirm.cancel.action')
    });
  }

  /**
   * Opens a stored level, targeting its pack. A level the editor cannot hold is
   * refused before any question about unsaved work. False when nothing opened.
   */
  public async openLevel(packId: string, levelId: string): Promise<boolean> {
    const level = ConfigRegistry.getAllPacks()
      .find((pack) => pack.id === packId)
      ?.levels.find((lvl) => lvl.id === levelId);
    if (!level) return false;
    if (!isEditableRuleset(level.ruleset)) {
      this.setStatusText(t('editor.palette.status.not_editable.label'));
      return false;
    }
    if (!(await this.confirmDiscardIfDirty())) return false;
    return this.loadCompiledLevel(level, { source: { packId, levelId } });
  }

  /** A blank map aimed at a pack, in the rules most of its levels use. False when the player keeps their work. */
  public async newLevelInPack(packId: string | null): Promise<boolean> {
    if (!(await this.confirmDiscardIfDirty())) return false;
    const pack = packId ? ConfigRegistry.getEditablePacks().find((p) => p.id === packId) : undefined;
    this.initBlankMap({ packId: pack?.id ?? null, ruleset: pack ? majorityRuleset(pack.levels) : undefined });
    return true;
  }

  public buildUI(): void {
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.refreshContext();
    this.syncMetadataInputs();
    this.render();
  }

  private resolveLevelTitle(level: CompiledLevel): string {
    return level.customTitle || (level.titleKey ? t(level.titleKey, { number: level.number }) : level.id);
  }

  /** Localized validator issue; a key id parameter is shown by its tile name. */
  private formatIssue(issue: ValidationIssue): string {
    const params = { ...(issue.params || {}) };
    if (typeof params.key === 'string' && ConfigRegistry.getTiles().tiles[params.key]) {
      params.key = t(ConfigRegistry.getTile(params.key).i18nKey);
    }
    return t(issue.i18nKey, params);
  }

  private formatIssues(issues: ValidationIssue[]): string {
    return issues.map((iss) => this.formatIssue(iss)).join(t('validator.status.issue_separator.label'));
  }

  public refreshTranslations(): void {
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.refreshContext();
  }

  private renderCategoryTabs(): void {
    const container = document.getElementById('editor-category-tabs');
    if (!container) return;
    container.innerHTML = '';

    const categories = ConfigRegistry.getTiles().categories;
    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `editor-tab-btn ${this.activeCategory === cat.id ? 'active' : ''}`;
      btn.textContent = t(cat.i18nKey);
      btn.addEventListener('click', () => {
        this.activeCategory = cat.id;
        this.renderCategoryTabs();
        this.renderPaletteItems();
      });
      container.appendChild(btn);
    }
  }

  private renderPaletteItems(): void {
    const container = document.getElementById('editor-palette-grid');
    if (!container) return;
    container.innerHTML = '';

    const tiles = Object.values(ConfigRegistry.getTiles().tiles).filter(
      (tile) => tile.category === this.activeCategory
    );

    for (const tile of tiles) {
      const kind: BrushKind = tile.layer === 'item' ? 'item' : 'terrain';
      const isSelected = this.activeBrush.kind === kind && this.activeBrush.id === tile.id;
      const btn = this.createPaletteButton(
        t(tile.i18nKey),
        this.renderer.renderIconToDataUrl(tile.layer === 'item' ? 'item' : 'tile', tile.id),
        isSelected,
        () => {
          this.activeBrush = { kind, id: tile.id };
          this.pendingWireSource = null;
          this.renderPaletteItems();
        }
      );
      container.appendChild(btn);
    }

    const entities = Object.values(ConfigRegistry.getMonsters().entities).filter(
      (ent) => ent.category === this.activeCategory
    );

    for (const ent of entities) {
      const isSelected = this.activeBrush.kind === 'entity' && this.activeBrush.id === ent.id;
      const btn = this.createPaletteButton(
        t(ent.i18nKey),
        this.renderer.renderIconToDataUrl('entity', ent.id),
        isSelected,
        () => {
          this.activeBrush = { kind: 'entity', id: ent.id };
          this.fillMode = false;
          this.pendingWireSource = null;
          this.renderPaletteItems();
        }
      );
      container.appendChild(btn);
    }

    if (this.activeCategory === 'entities') {
      const isPlayerSelected = this.activeBrush.kind === 'player_start';
      const playerBtn = this.createPaletteButton(
        t('editor.palette.tools.player_start'),
        '',
        isPlayerSelected,
        () => {
          this.activeBrush = { kind: 'player_start', id: 'player_start' };
          this.fillMode = false;
          this.pendingWireSource = null;
          this.renderPaletteItems();
        }
      );
      container.appendChild(playerBtn);
    }

    if (this.activeCategory === 'mechanisms') {
      const wireTrapBtn = this.createPaletteButton(
        t('editor.palette.tools.wire_trap'),
        '',
        this.activeBrush.kind === 'wire_trap',
        () => {
          this.activeBrush = { kind: 'wire_trap', id: 'wire_trap' };
          this.fillMode = false;
          this.pendingWireSource = null;
          this.setStatusText(t('editor.palette.status.wire_select_source'));
          this.renderPaletteItems();
        }
      );
      container.appendChild(wireTrapBtn);

      const wireClonerBtn = this.createPaletteButton(
        t('editor.palette.tools.wire_cloner'),
        '',
        this.activeBrush.kind === 'wire_cloner',
        () => {
          this.activeBrush = { kind: 'wire_cloner', id: 'wire_cloner' };
          this.fillMode = false;
          this.pendingWireSource = null;
          this.setStatusText(t('editor.palette.status.wire_select_source'));
          this.renderPaletteItems();
        }
      );
      container.appendChild(wireClonerBtn);
    }

    const fillBtn = this.createPaletteButton(
      t('editor.palette.tools.fill'),
      '',
      this.fillMode,
      () => {
        this.fillMode = !this.fillMode;
        this.renderPaletteItems();
      }
    );
    container.appendChild(fillBtn);

    const eraserBtn = this.createPaletteButton(
      t('editor.palette.tools.eraser'),
      this.renderer.renderIconToDataUrl('tile', 'floor'),
      this.activeBrush.kind === 'eraser',
      () => {
        this.activeBrush = { kind: 'eraser', id: 'eraser' };
        this.fillMode = false;
        this.pendingWireSource = null;
        this.renderPaletteItems();
      }
    );
    container.appendChild(eraserBtn);
  }

  private createPaletteButton(
    label: string,
    iconUrl: string,
    active: boolean,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-item-btn ${active ? 'active' : ''}`;
    if (iconUrl) {
      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = label;
      img.className = 'palette-item-icon';
      btn.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', onClick);
    return btn;
  }

  /**
   * Brings the source in line with the library after the pack manager changed
   * it: a moved level is followed to its new pack; a deleted level or pack
   * leaves the content with no pack, as unsaved work, so the next save asks
   * where it goes and stores it under a new id.
   */
  public reconcileSourceWithLibrary(): void {
    const result = reconcileSource(this.source, ConfigRegistry.getAllPacks());
    this.source = result.source;
    if (result.lost) this.isDirty = true;
    this.refreshContext();
  }

  /** Display name of a pack. */
  private packLabel(pack: LevelPack): string {
    return pack.i18nKey ? t(pack.i18nKey) : pack.name;
  }

  private sourcePack(): LevelPack | undefined {
    const packId = this.source.packId;
    return packId ? ConfigRegistry.getAllPacks().find((pack) => pack.id === packId) : undefined;
  }

  /** Redraws the context line above the canvas: pack, position in the pack, title. */
  public refreshContext(): void {
    this.fillContextPackSelect();
    const pack = this.sourcePack();
    const index = pack && this.source.levelId ? pack.levels.findIndex((l) => l.id === this.source.levelId) : -1;
    const position = document.getElementById('editor-context-position');
    if (position) {
      position.textContent =
        index >= 0 && pack
          ? t('editor.pack.context.position.label', { number: index + 1, total: pack.levels.length })
          : t('editor.pack.context.new_level.label');
    }
    this.updateContextTitle();
    this.updateDirtyBadge();
    const prev = document.getElementById('editor-context-prev') as HTMLButtonElement | null;
    const next = document.getElementById('editor-context-next') as HTMLButtonElement | null;
    if (prev) prev.disabled = !pack || index < 0 || nextEditableIndex(pack.levels, index, -1) < 0;
    if (next) next.disabled = !pack || index < 0 || nextEditableIndex(pack.levels, index, 1) < 0;
  }

  private fillContextPackSelect(): void {
    const select = document.getElementById('editor-context-pack') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = '';
    const add = (value: string, text: string): void => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    };
    if (this.source.packId === null) add(NO_PACK_OPTION_VALUE, t('editor.pack.context.no_pack.label'));
    const editable = ConfigRegistry.getEditablePacks();
    for (const pack of editable) add(pack.id, this.packLabel(pack));
    const editableIds = new Set(editable.map((pack) => pack.id));
    for (const pack of ConfigRegistry.getAllPacks()) {
      if (editableIds.has(pack.id) || pack.levels.length === 0) continue;
      add(pack.id, t('editor.pack.context.read_only_option.label', { name: this.packLabel(pack) }));
    }
    select.value = this.source.packId ?? NO_PACK_OPTION_VALUE;
  }

  private updateContextTitle(): void {
    const titleInput = document.getElementById(TITLE_INPUT_ID) as HTMLInputElement | null;
    const title = (titleInput?.value ?? this.customTitle).trim() || t('editor.metadata.default_title.label');
    const el = document.getElementById('editor-context-title');
    if (el) el.textContent = title;
  }

  private updateDirtyBadge(): void {
    document.getElementById('editor-context-dirty')?.classList.toggle('hidden', !this.dirty);
  }

  /** The pack select chose a pack: its first level the editor can open, or a blank map when it is empty. */
  private async openPackFromContext(packId: string): Promise<void> {
    const pack = ConfigRegistry.getAllPacks().find((p) => p.id === packId);
    if (!pack) return;
    if (pack.levels.length === 0) {
      await this.newLevelInPack(pack.id);
      return;
    }
    const first = isEditableRuleset(pack.levels[0].ruleset) ? 0 : nextEditableIndex(pack.levels, 0, 1);
    if (first < 0) {
      this.setStatusText(t('editor.palette.status.not_editable.label'));
      return;
    }
    await this.openLevel(pack.id, pack.levels[first].id);
  }

  private async stepLevel(step: 1 | -1): Promise<void> {
    const pack = this.sourcePack();
    if (!pack || !this.source.levelId) return;
    const from = pack.levels.findIndex((l) => l.id === this.source.levelId);
    const target = nextEditableIndex(pack.levels, from, step);
    if (from >= 0 && target >= 0) await this.openLevel(pack.id, pack.levels[target].id);
  }

  private bindContextEvents(): void {
    const select = document.getElementById('editor-context-pack') as HTMLSelectElement | null;
    select?.addEventListener('change', () => {
      const packId = select.value;
      void (async () => {
        if (packId !== NO_PACK_OPTION_VALUE && packId !== this.source.packId) await this.openPackFromContext(packId);
        // Declined, refused or empty: the select shows what the editor holds again.
        this.fillContextPackSelect();
      })();
    });
    document.getElementById('editor-context-prev')?.addEventListener('click', () => void this.stepLevel(-1));
    document.getElementById('editor-context-next')?.addEventListener('click', () => void this.stepLevel(1));
    document.getElementById('editor-context-open')?.addEventListener('click', () => {
      this.hooks.openManager(this.source.packId);
    });
  }

  private bindToolbarEvents(): void {
    const levelInput = document.getElementById('editor-gen-level') as HTMLInputElement | null;
    if (levelInput) {
      levelInput.min = String(EDITOR_GENERATOR_MIN_LEVEL);
      levelInput.max = String(EDITOR_GENERATOR_MAX_LEVEL);
      levelInput.value = String(EDITOR_GENERATOR_MIN_LEVEL);
    }
    document.getElementById('editor-generate-btn')?.addEventListener('click', () => {
      void this.generateIntoEditor();
    });

    document.getElementById('editor-new-btn')?.addEventListener('click', () => {
      void this.newLevelInPack(this.source.packId);
    });

    document.getElementById('editor-undo-btn')?.addEventListener('click', () => {
      this.undo();
    });

    document.getElementById('editor-redo-btn')?.addEventListener('click', () => {
      this.redo();
    });

    document.getElementById('editor-test-btn')?.addEventListener('click', () => {
      void this.testPlay();
    });

    document.getElementById('editor-validate-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      const report = LevelValidator.validate(compiled);
      if (report.valid) {
        const validText =
          compiled.winRule === 'receivers'
            ? t('validator.status.valid_receivers.label', {
                receivers: receiversProgress(compiled.terrain, []).total
              })
            : compiled.winRule === 'targets'
              ? t('validator.status.valid_targets.label', { targets: report.stats.targetCount })
              : t('validator.status.valid.label', {
                  chips: report.stats.reachableChips,
                  required: report.stats.chipsRequired
                });
        // A valid level may still carry warnings; they follow the verdict.
        this.setStatusText(
          report.issues.length > 0
            ? `${validText}${t('validator.status.issue_separator.label')}${this.formatIssues(report.issues)}`
            : validText
        );
      } else {
        this.setStatusText(this.formatIssues(report.issues));
      }
    });

    document.getElementById('editor-save-btn')?.addEventListener('click', () => {
      void this.save();
    });

    document.getElementById('editor-save-copy-btn')?.addEventListener('click', () => {
      void this.saveCopy();
    });

    document.getElementById('editor-export-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      downloadJson(compiled, `${compiled.id || EXPORT_FALLBACK_FILE_NAME}.json`);
    });

    document.getElementById('editor-export-ccl-btn')?.addEventListener('click', () => {
      this.readMetadataInputs();
      const compiled = this.exportCompiledLevel();
      const encoded = DatCodec.encodeLevelsWithReport([compiled]);
      if (encoded.levelCount > 0) {
        downloadBytes(encoded.bytes, `${compiled.id || EXPORT_FALLBACK_FILE_NAME}.ccl`);
      }
      const notice = lossyExportNotice(encoded);
      if (notice) this.setStatusText(notice);
    });

    const importInput = document.getElementById('editor-import-input') as HTMLInputElement | null;
    document.getElementById('editor-import-btn')?.addEventListener('click', () => {
      importInput?.click();
    });

    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (file) void this.importFileIntoEditor(file);
    });

    this.bindContextEvents();

    document.getElementById('editor-autocount-btn')?.addEventListener('click', () => {
      let count = 0;
      for (const row of this.items) {
        for (const cell of row) {
          if (cell === 'chip') count++;
        }
      }
      if (count !== this.chipsRequired) {
        this.isDirty = true;
      }
      this.chipsRequired = count;
      const chipsInput = document.getElementById('editor-meta-chips') as HTMLInputElement | null;
      if (chipsInput) chipsInput.value = String(count);
    });

    const dirSelect = document.getElementById('editor-meta-dir') as HTMLSelectElement | null;
    dirSelect?.addEventListener('change', () => {
      this.activeDir = (dirSelect.value as Direction) || 'S';
    });
  }

  private bindMetadataEvents(): void {
    for (const id of METADATA_INPUT_IDS) {
      document.getElementById(id)?.addEventListener('input', (event) => {
        this.isDirty = true;
        if (id === TITLE_INPUT_ID) this.updateContextTitle();
        if (id === WIN_RULE_INPUT_ID) {
          this.winRule = parseWinRule((event.target as HTMLSelectElement).value, this.winRule);
          this.syncRulesetInput();
        }
      });
    }
  }

  private syncMetadataInputs(): void {
    const titleEl = document.getElementById('editor-meta-title') as HTMLInputElement | null;
    const hintEl = document.getElementById('editor-meta-hint') as HTMLInputElement | null;
    const authorEl = document.getElementById('editor-meta-author') as HTMLInputElement | null;
    const passEl = document.getElementById('editor-meta-password') as HTMLInputElement | null;
    const timeEl = document.getElementById('editor-meta-time') as HTMLInputElement | null;
    const chipsEl = document.getElementById('editor-meta-chips') as HTMLInputElement | null;
    const winRuleEl = document.getElementById('editor-meta-winrule') as HTMLSelectElement | null;

    if (titleEl) titleEl.value = this.customTitle;
    if (hintEl) hintEl.value = this.customHint;
    if (authorEl) authorEl.value = this.author;
    if (passEl) passEl.value = this.password;
    if (timeEl) timeEl.value = String(this.timeLimitSeconds);
    if (chipsEl) chipsEl.value = String(this.chipsRequired);
    if (winRuleEl) winRuleEl.value = this.winRule;
    this.syncRulesetInput();
  }

  /** Whether the map places laser tiles or mirrors, which only the Epoxy engine plays. */
  private hasLaserContent(): boolean {
    return hasLaserContent({ terrain: this.terrain, items: this.items, entities: this.entities });
  }

  /**
   * A level won with block targets or laser receivers, or holding laser
   * content, is Epoxy only: force it and lock the Lynx option.
   */
  private syncRulesetInput(): void {
    const rulesetEl = document.getElementById('editor-meta-ruleset') as HTMLSelectElement | null;
    if (!rulesetEl) return;
    const lynxLocked = requiresEpoxyRules(this.winRule, this.hasLaserContent());
    if (lynxLocked) this.ruleset = undefined;
    rulesetEl.value = this.ruleset ?? DEFAULT_RULESET;
    for (const option of Array.from(rulesetEl.options)) {
      if (option.value !== LYNX_RULESET) continue;
      option.disabled = lynxLocked;
      option.title = lynxLocked ? t('editor.metadata.ruleset_lynx_unavailable.label') : '';
    }
  }

  private readMetadataInputs(): void {
    const titleEl = document.getElementById('editor-meta-title') as HTMLInputElement | null;
    const hintEl = document.getElementById('editor-meta-hint') as HTMLInputElement | null;
    const authorEl = document.getElementById('editor-meta-author') as HTMLInputElement | null;
    const passEl = document.getElementById('editor-meta-password') as HTMLInputElement | null;
    const timeEl = document.getElementById('editor-meta-time') as HTMLInputElement | null;
    const chipsEl = document.getElementById('editor-meta-chips') as HTMLInputElement | null;
    const winRuleEl = document.getElementById('editor-meta-winrule') as HTMLSelectElement | null;

    // A cleared field stays cleared: an empty title falls back to the default one when the level is stored.
    if (titleEl) this.customTitle = titleEl.value.trim();
    if (hintEl) this.customHint = hintEl.value.trim();
    if (authorEl) this.author = authorEl.value.trim();
    if (passEl) this.password = passEl.value.trim().toUpperCase().slice(0, EDITOR_PASSWORD_LENGTH);
    if (timeEl) this.timeLimitSeconds = parseTimeLimit(timeEl.value, this.timeLimitSeconds);
    if (chipsEl) this.chipsRequired = parseChipsRequired(chipsEl.value, this.chipsRequired);
    if (winRuleEl) this.winRule = parseWinRule(winRuleEl.value, this.winRule);
    const rulesetEl = document.getElementById('editor-meta-ruleset') as HTMLSelectElement | null;
    if (rulesetEl) {
      const parsed = parseRuleset(rulesetEl.value, this.ruleset ?? DEFAULT_RULESET);
      this.ruleset = parsed === DEFAULT_RULESET ? undefined : parsed;
    }
    if (requiresEpoxyRules(this.winRule, this.hasLaserContent())) this.ruleset = undefined;
  }

  private createSnapshot(): EditorSnapshot {
    return {
      terrain: this.terrain.map((r) => [...r]),
      items: this.items.map((r) => [...r]),
      entities: this.entities.map((e) => ({ ...e })),
      trapLinks: this.trapLinks.map((l) => ({ ...l })),
      cloneLinks: this.cloneLinks.map((l) => ({ ...l })),
      playerStart: { ...this.playerStart }
    };
  }

  private restoreSnapshot(snap: EditorSnapshot): void {
    this.terrain = snap.terrain.map((r) => [...r]);
    this.items = snap.items.map((r) => [...r]);
    this.entities = snap.entities.map((e) => ({ ...e }));
    this.trapLinks = snap.trapLinks.map((l) => ({ ...l }));
    this.cloneLinks = snap.cloneLinks.map((l) => ({ ...l }));
    this.playerStart = { ...snap.playerStart };
    this.syncRulesetInput();
    this.render();
  }

  private pushUndoState(): void {
    const maxUndo = ConfigRegistry.getGame().timing.maxUndoSnapshots || TIMING_DEFAULTS.maxUndoSnapshots;
    if (this.undoStack.length >= maxUndo) {
      this.undoStack.shift();
    }
    this.undoStack.push(this.createSnapshot());
    this.redoStack = [];
    this.isDirty = true;
    this.updateUndoRedoButtons();
  }

  public undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.createSnapshot());
    this.restoreSnapshot(prev);
    this.isDirty = true;
    this.updateUndoRedoButtons();
  }

  public redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.createSnapshot());
    this.restoreSnapshot(next);
    this.isDirty = true;
    this.updateUndoRedoButtons();
  }

  private updateUndoRedoButtons(): void {
    const undoBtn = document.getElementById('editor-undo-btn') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('editor-redo-btn') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = this.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
  }

  private pickBrushAt(x: number, y: number): void {
    const ent = this.entities.find((e) => e.x === x && e.y === y);
    if (ent) {
      const def = ConfigRegistry.getEntityDef(ent.type);
      this.activeCategory = def?.category || 'entities';
      this.activeBrush = { kind: 'entity', id: ent.type };
      this.activeDir = ent.dir;
      const dirSelect = document.getElementById('editor-meta-dir') as HTMLSelectElement | null;
      if (dirSelect) dirSelect.value = ent.dir;
      this.renderCategoryTabs();
      this.renderPaletteItems();
      this.setStatusText(
        t('editor.palette.status.picked.label', {
          name: def ? t(def.i18nKey) : ent.type
        })
      );
      return;
    }

    const item = this.items[y]?.[x];
    if (item) {
      const tileDef = ConfigRegistry.getTile(item);
      this.activeCategory = tileDef.category;
      this.activeBrush = { kind: 'item', id: item };
      this.renderCategoryTabs();
      this.renderPaletteItems();
      this.setStatusText(
        t('editor.palette.status.picked.label', { name: t(tileDef.i18nKey) })
      );
      return;
    }

    const terr = this.terrain[y]?.[x] || 'floor';
    const tileDef = ConfigRegistry.getTile(terr);
    this.activeCategory = tileDef.category;
    this.activeBrush = { kind: 'terrain', id: terr };
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.setStatusText(
      t('editor.palette.status.picked.label', { name: t(tileDef.i18nKey) })
    );
  }

  private bindCanvasEvents(): void {
    const getCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const { editorTilePixelSize } = ConfigRegistry.getGame().grid;
      const x = Math.floor(((clientX - rect.left) * scaleX) / editorTilePixelSize);
      const y = Math.floor(((clientY - rect.top) * scaleY) / editorTilePixelSize);
      if (x < 0 || x >= this.mapWidth() || y < 0 || y >= this.mapHeight()) return null;
      return { x, y };
    };

    this.canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
    });

    this.canvas.addEventListener('pointerdown', (ev) => {
      const coords = getCoords(ev.clientX, ev.clientY);
      if (!coords) return;
      ev.preventDefault();
      this.canvas.setPointerCapture(ev.pointerId);

      if (ev.altKey || ev.button === 1) {
        this.pickBrushAt(coords.x, coords.y);
        return;
      }

      this.pushUndoState();
      this.isPainting = true;
      this.isRightErasing = ev.button === 2;
      this.applyBrushAt(coords.x, coords.y, this.isRightErasing);
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      const coords = getCoords(ev.clientX, ev.clientY);
      if (!coords) return;
      this.setCoordsText(t('editor.palette.status.coords', { x: coords.x, y: coords.y }));
      if (
        this.isPainting &&
        !this.fillMode &&
        this.activeBrush.kind !== 'wire_trap' &&
        this.activeBrush.kind !== 'wire_cloner'
      ) {
        this.applyBrushAt(coords.x, coords.y, this.isRightErasing);
      }
    });

    const stopPainting = (): void => {
      this.isPainting = false;
      this.isRightErasing = false;
    };

    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', stopPainting);
  }

  private applyBrushAt(x: number, y: number, forceEraser: boolean = false): void {
    const wasLynx = this.ruleset === LYNX_RULESET;
    this.paintBrushAt(x, y, forceEraser);
    if (wasLynx && this.hasLaserContent()) {
      // Laser content is Epoxy only: the level leaves the Lynx rules and says so.
      this.syncRulesetInput();
      this.setStatusText(t('editor.palette.status.lynx_lasers_switched.label'));
    }
  }

  private paintBrushAt(x: number, y: number, forceEraser: boolean): void {
    const brush: ActiveBrush = forceEraser ? { kind: 'eraser', id: 'eraser' } : this.activeBrush;

    if (!forceEraser && this.fillMode && brush.kind === 'terrain') {
      this.floodFillTerrain(x, y, this.terrain[y][x], brush.id);
      this.render();
      return;
    }

    if (brush.kind === 'wire_trap') {
      if (!this.pendingWireSource) {
        this.terrain[y][x] = 'button_brown';
        this.pendingWireSource = { x, y };
        this.setStatusText(t('editor.palette.status.wire_select_target'));
      } else {
        this.terrain[y][x] = 'trap';
        this.trapLinks.push({
          buttonX: this.pendingWireSource.x,
          buttonY: this.pendingWireSource.y,
          trapX: x,
          trapY: y
        });
        this.pendingWireSource = null;
        this.setStatusText(t('editor.palette.status.wire_linked'));
      }
      this.render();
      return;
    }

    if (brush.kind === 'wire_cloner') {
      if (!this.pendingWireSource) {
        this.terrain[y][x] = 'button_red';
        this.pendingWireSource = { x, y };
        this.setStatusText(t('editor.palette.status.wire_select_target'));
      } else {
        this.terrain[y][x] = 'clone_machine';
        const existingEnt = this.entities.find((e) => e.x === x && e.y === y);
        this.cloneLinks.push({
          buttonX: this.pendingWireSource.x,
          buttonY: this.pendingWireSource.y,
          clonerX: x,
          clonerY: y,
          templateType: existingEnt?.type || EDITOR_DEFAULT_CLONE_TEMPLATE,
          templateDir: existingEnt?.dir || this.activeDir
        });
        this.pendingWireSource = null;
        this.setStatusText(t('editor.palette.status.wire_linked'));
      }
      this.render();
      return;
    }

    if (brush.kind === 'eraser') {
      this.terrain[y][x] = 'floor';
      this.items[y][x] = null;
      this.entities = this.entities.filter((e) => !(e.x === x && e.y === y));
      this.trapLinks = this.trapLinks.filter(
        (l) => !(l.buttonX === x && l.buttonY === y) && !(l.trapX === x && l.trapY === y)
      );
      this.cloneLinks = this.cloneLinks.filter(
        (l) => !(l.buttonX === x && l.buttonY === y) && !(l.clonerX === x && l.clonerY === y)
      );
    } else if (brush.kind === 'terrain') {
      this.terrain[y][x] = brush.id;
    } else if (brush.kind === 'item') {
      this.items[y][x] = brush.id;
    } else if (brush.kind === 'entity') {
      this.entities = this.entities.filter((e) => !(e.x === x && e.y === y));
      this.entities.push({ x, y, type: brush.id, dir: this.activeDir });
    } else if (brush.kind === 'player_start') {
      this.playerStart = { x, y, dir: this.activeDir };
    }

    this.render();
  }

  private floodFillTerrain(startX: number, startY: number, targetId: string, replacementId: string): void {
    if (targetId === replacementId) return;
    const mapWidth = this.mapWidth();
    const mapHeight = this.mapHeight();
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const key = `${curr.x},${curr.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (curr.x < 0 || curr.x >= mapWidth || curr.y < 0 || curr.y >= mapHeight) continue;
      if (this.terrain[curr.y][curr.x] !== targetId) continue;

      this.terrain[curr.y][curr.x] = replacementId;
      queue.push(
        { x: curr.x + 1, y: curr.y },
        { x: curr.x - 1, y: curr.y },
        { x: curr.x, y: curr.y + 1 },
        { x: curr.x, y: curr.y - 1 }
      );
    }
  }

  public render(): void {
    const { editorTilePixelSize } = ConfigRegistry.getGame().grid;
    const mapWidth = this.mapWidth();
    const mapHeight = this.mapHeight();
    const s = editorTilePixelSize;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        this.renderer.drawTile(this.ctx, this.terrain[y][x], x * s, y * s, s, true, true);
        const item = this.items[y][x];
        if (item) {
          this.renderer.drawItem(this.ctx, item, x * s, y * s, s);
        }
      }
    }

    for (const ent of this.entities) {
      this.renderer.drawEntity(this.ctx, ent.type, ent.dir, ent.x * s, ent.y * s, s);
    }

    this.renderer.drawPlayer(
      this.ctx,
      this.playerStart.x * s,
      this.playerStart.y * s,
      s,
      this.playerStart.dir,
      false,
      true
    );

    this.ctx.lineWidth = EDITOR_LINK_LINE_WIDTH;
    for (const link of this.trapLinks) {
      this.drawLinkLine(EDITOR_TRAP_LINK_COLOR, link.buttonX, link.buttonY, link.trapX, link.trapY, s);
    }
    for (const link of this.cloneLinks) {
      this.drawLinkLine(EDITOR_CLONE_LINK_COLOR, link.buttonX, link.buttonY, link.clonerX, link.clonerY, s);
    }
  }

  private drawLinkLine(color: string, fromX: number, fromY: number, toX: number, toY: number, s: number): void {
    const c = EDITOR_TILE_CENTER_OFFSET;
    this.ctx.strokeStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo((fromX + c) * s, (fromY + c) * s);
    this.ctx.lineTo((toX + c) * s, (toY + c) * s);
    this.ctx.stroke();
  }

  /**
   * The level as the editor holds it. A level opened from a pack keeps its id;
   * any other content carries the id it was given when it was opened.
   */
  public exportCompiledLevel(): CompiledLevel {
    const id = this.source.levelId ?? this.currentLevelId;
    const targetLevels = this.sourcePack()?.levels ?? [];
    const existing = targetLevels.find((l) => l.id === id);
    return {
      id,
      ...(this.winRule === DEFAULT_WIN_RULE ? {} : { winRule: this.winRule }),
      ...(this.ruleset ? { ruleset: this.ruleset } : {}),
      number: existing ? existing.number : targetLevels.length + 1,
      customTitle: this.customTitle || t('editor.metadata.default_title.label'),
      customHint: this.customHint,
      ...(this.author ? { author: this.author } : {}),
      password: resolveSavedPassword(this.password, targetLevels),
      timeLimitSeconds: this.timeLimitSeconds,
      chipsRequired: this.chipsRequired,
      playerStart: { ...this.playerStart },
      terrain: this.terrain.map((r) => [...r]),
      items: this.items.map((r) => [...r]),
      entities: this.entities.map((e) => ({ ...e })),
      trapLinks: this.trapLinks.map((l) => ({ ...l })),
      cloneLinks: this.cloneLinks.map((l) => ({ ...l }))
    };
  }

  // ---------------------------------------------------------------------------
  // Test play, save, import
  // ---------------------------------------------------------------------------

  private async testPlay(): Promise<void> {
    this.readMetadataInputs();
    const compiled = this.exportCompiledLevel();
    const report = LevelValidator.validate(compiled);
    let issuesText = '';
    if (!report.valid && report.issues.length > 0) {
      issuesText = this.formatIssues(report.issues);
      this.setStatusText(issuesText);
      const proceed = await confirmDialog({
        title: t('app.confirm.title.label'),
        message: t('editor.toolbar.confirm_test_invalid.label', { issues: issuesText }),
        confirmLabel: t('editor.pack.test_anyway.action'),
        cancelLabel: t('app.confirm.cancel.action')
      });
      if (!proceed) return;
    }
    this.hooks.onTestPlay(compiled);
    if (issuesText) {
      // The editor view is hidden during test play: surface the issues there.
      this.hooks.onNotify(issuesText);
    }
  }

  /** Save: updates the level in its pack when that pack is editable, else asks where it goes. */
  public save(): Promise<void> {
    return this.runSave(false);
  }

  /** "Save a copy": always asks where, and stores the level under a new id. */
  public saveCopy(): Promise<void> {
    return this.runSave(true);
  }

  private async runSave(forceCopy: boolean): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await this.performSave(forceCopy);
    } finally {
      this.saving = false;
    }
  }

  private async performSave(forceCopy: boolean): Promise<void> {
    this.readMetadataInputs();
    const generation = this.loadGeneration;
    const decision = decideSave({
      source: this.source,
      editablePacks: ConfigRegistry.getEditablePacks(),
      confirmedImportedPackIds: this.confirmedImportedPackIds,
      forceCopy
    });

    let destination: SaveDestination | null;
    if (decision.kind === 'in_place') {
      destination = { packId: decision.packId, newPackName: null, asCopy: false };
    } else if (decision.kind === 'confirm_imported') {
      const answer = await this.askModifyImported(decision.packId, true);
      if (answer === null) return;
      if (answer === IMPORTED_MODIFY_CHOICE) this.confirmedImportedPackIds.add(decision.packId);
      destination =
        answer === IMPORTED_MODIFY_CHOICE
          ? { packId: decision.packId, newPackName: null, asCopy: false }
          : await this.chooseDestination();
    } else {
      destination = await this.chooseDestination();
    }
    if (!destination) return;

    const revision = this.editRevision;
    let persisted = true;
    let packId = destination.packId;
    if (destination.newPackName !== null) {
      const created = await ConfigRegistry.createUserPack(destination.newPackName);
      if (!created.ok || !created.pack) {
        this.setStatusText(t('editor.pack.save_failed.label'));
        return;
      }
      persisted = created.persisted;
      packId = created.pack.id;
    }
    const targetPack = ConfigRegistry.getAllPacks().find((p) => p.id === packId);
    if (!packId || !targetPack) {
      this.setStatusText(t('editor.pack.save_failed.label'));
      return;
    }

    const keepsId = !destination.asCopy && this.source.levelId !== null;
    const draft = {
      ...this.exportCompiledLevel(),
      id: keepsId ? (this.source.levelId as string) : ConfigRegistry.newLevelId(),
      password: resolveSavedPassword(this.password, targetPack.levels)
    };
    const { level, mapChanged } = prepareLevelForSave(draft, this.originalLevel, this.loadedTexts);
    const result = await ConfigRegistry.saveLevelToPack(packId, level);
    if (!result.ok) {
      this.setStatusText(t('editor.pack.save_failed.label'));
      return;
    }
    persisted = persisted && result.persisted;

    const stored = ConfigRegistry.getAllPacks().find((p) => p.id === packId);
    const saved = stored?.levels[result.index] ?? level;
    this.rememberDestination(packId);
    // Another level may have been loaded while the save was in flight: its source, texts and
    // original must stay its own, so the saved level is not bound to the editor then.
    const rebind = mayRebindAfterSave(generation, this.loadGeneration);
    if (rebind) {
      this.source = { packId, levelId: saved.id };
      this.currentLevelId = saved.id;
      this.originalLevel = structuredClone(saved);
      this.loadedTexts = {
        title: this.resolveLevelTitle(saved),
        hint: saved.customHint || (saved.hintKey ? t(saved.hintKey) : '')
      };
      // A refused write keeps the level in memory but leaves the editor dirty,
      // so leaving the editor still asks before discarding it. An edit made
      // while the save was in flight is not in the saved level: it stays dirty.
      if (this.editRevision === revision) this.isDirty = !persisted;
    }
    const packName = stored ? this.packLabel(stored) : packId;
    this.setStatusText(
      t(persisted ? 'editor.pack.saved.label' : 'editor.pack.saved_session_only.label', {
        pack: packName,
        number: result.index + 1
      })
    );
    this.refreshContext();
    this.hooks.onLevelSaved({
      packId,
      packName,
      levelId: saved.id,
      index: result.index,
      persisted,
      recordsInvalidated: keepsId && mapChanged
    });
  }

  /**
   * Asks whether to modify an imported pack. Cancel (or Escape) answers null and
   * does nothing. With `offerCopy` the alternative "Save a copy instead" is its
   * own button; without it Cancel reads "Choose another pack".
   */
  private async askModifyImported(packId: string, offerCopy: boolean): Promise<string | null> {
    const pack = ConfigRegistry.getEditablePacks().find((p) => p.id === packId);
    const name = pack ? this.packLabel(pack) : packId;
    return choiceDialog({
      title: t('app.confirm.title.label'),
      message: t('editor.pack.confirm_imported.message.label', { name }),
      cancelLabel: offerCopy ? t('app.confirm.cancel.action') : t('editor.pack.confirm_imported.again.action'),
      options: [
        { id: IMPORTED_MODIFY_CHOICE, label: t('editor.pack.confirm_imported.modify.action', { name }), primary: true },
        ...(offerCopy ? [{ id: IMPORTED_COPY_CHOICE, label: t('editor.pack.confirm_imported.copy.action') }] : [])
      ]
    });
  }

  /** The "Save into" dialog, then the imported-pack question when the pack asks for it; null on cancel. */
  private async chooseDestination(): Promise<SaveDestination | null> {
    for (;;) {
      const editable = ConfigRegistry.getEditablePacks();
      const choice = await askSaveInto({
        packs: editable.map((pack) => ({ id: pack.id, label: this.packLabel(pack), levelCount: pack.levels.length })),
        preselectId: pickSaveDestination(editable, this.readRememberedDestination()),
        defaultNewName: t('editor.pack.save_into.default_name.label')
      });
      if (!choice) return null;
      if (choice.kind === 'new') return { packId: null, newPackName: choice.name, asCopy: true };
      const pack = editable.find((p) => p.id === choice.packId);
      if (needsImportedConfirmation(pack, this.confirmedImportedPackIds)) {
        if ((await this.askModifyImported(choice.packId, false)) !== IMPORTED_MODIFY_CHOICE) continue;
        this.confirmedImportedPackIds.add(choice.packId);
      }
      return { packId: choice.packId, newPackName: null, asCopy: true };
    }
  }

  private destinationStorageKey(): string {
    return ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.lastSaveDestinationKey);
  }

  private readRememberedDestination(): string | null {
    try {
      return localStorage.getItem(this.destinationStorageKey());
    } catch {
      // Storage blocked: no destination is preselected.
      return null;
    }
  }

  private rememberDestination(packId: string): void {
    try {
      localStorage.setItem(this.destinationStorageKey(), packId);
    } catch {
      // Storage blocked: the choice is not remembered.
    }
  }

  /**
   * Opens a file in the editor. A file of several levels can be imported as a
   * pack instead; a cc3d level is refused before anything is asked about
   * unsaved work. The level that opens is unsaved work and belongs to no pack.
   */
  private async importFileIntoEditor(file: File): Promise<void> {
    const maxBytes = ConfigRegistry.getGame().import.maxFileBytes;
    if (!isImportSizeAllowed(file.size, maxBytes)) {
      this.setStatusText(t('editor.palette.status.import_too_large.label', { max: formatMegabytes(maxBytes) }));
      return;
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith(CC3D_XML_EXTENSION)) {
      this.setStatusText(t('editor.palette.status.not_editable.label'));
      return;
    }
    const baseName = file.name.replace(/\.[^.]+$/, '');
    let levels: CompiledLevel[];
    let packName = baseName;
    let skipped = 0;
    try {
      if (lower.endsWith('.dat') || lower.endsWith('.ccl')) {
        levels = DatCodec.decodeBuffer(await file.arrayBuffer(), baseName, IMPORTED_PACK_RULESET);
      } else if (XSB_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        const decoded = decodeXsbCollection(await file.text(), baseName);
        levels = decoded.levels;
        skipped = decoded.skipped.length;
      } else {
        const text = await file.text();
        const pack = parsePackJson(text, ConfigRegistry.getLevelSizeBounds(), new Set());
        if (pack.ok) {
          levels = pack.levels;
          packName = pack.name;
        } else {
          levels = [ConfigRegistry.compileBlueprint(JSON.parse(text) as LevelBlueprint)];
        }
      }
    } catch (err) {
      const message =
        err instanceof InvalidLevelError
          ? t('editor.palette.status.invalid_level.label', { id: err.levelId })
          : t('editor.palette.status.import_error');
      this.setStatusText(message);
      if (err instanceof InvalidLevelError) this.hooks.onNotify(message);
      return;
    }
    if (levels.length === 0) {
      this.setStatusText(t('editor.palette.status.import_error'));
      return;
    }
    if (levels.length > 1) {
      const answer = await choiceDialog({
        title: t('app.confirm.title.label'),
        message: t('editor.pack.import_multi.message.label', { count: levels.length }),
        cancelLabel: t('app.confirm.cancel.action'),
        options: [
          { id: IMPORT_AS_PACK_CHOICE, label: t('editor.pack.import_multi.pack.action'), primary: true },
          { id: IMPORT_FIRST_CHOICE, label: t('editor.pack.import_multi.first.action') }
        ]
      });
      if (answer === null) return;
      if (answer === IMPORT_AS_PACK_CHOICE) {
        await this.hooks.importAsPack(packName, levels, skipped);
        return;
      }
    }
    if (!isEditableRuleset(levels[0].ruleset)) {
      this.setStatusText(t('editor.palette.status.not_editable.label'));
      return;
    }
    if (!(await this.confirmDiscardIfDirty())) return;
    this.loadCompiledLevel(levels[0], { source: NO_SOURCE, dirty: true });
    this.setStatusText(
      skipped > 0
        ? t('editor.palette.status.imported_skipped.label', { skipped })
        : t('editor.palette.status.imported')
    );
  }

  private setCoordsText(msg: string): void {
    const el = document.getElementById('editor-coords-badge');
    if (el) el.textContent = msg;
  }

  /**
   * Fills the editor with a procedural level of the chosen difficulty. A blank
   * seed draws a fresh one, which is written back so the level can be found
   * again. The result is a starting point to retouch and save.
   */
  private async generateIntoEditor(): Promise<void> {
    if (!(await this.confirmDiscardIfDirty())) return;
    const levelInput = document.getElementById('editor-gen-level') as HTMLInputElement | null;
    const seedInput = document.getElementById('editor-gen-seed') as HTMLInputElement | null;
    const typedLevel = Number.parseInt(levelInput?.value ?? '', 10);
    const levelNumber = Math.min(
      EDITOR_GENERATOR_MAX_LEVEL,
      Math.max(EDITOR_GENERATOR_MIN_LEVEL, Number.isFinite(typedLevel) ? typedLevel : EDITOR_GENERATOR_MIN_LEVEL)
    );
    const typedSeed = Number.parseInt(seedInput?.value ?? '', 10);
    const seed = Number.isFinite(typedSeed) ? typedSeed >>> 0 : ProceduralGenerator.createSeed();
    if (levelInput) levelInput.value = String(levelNumber);
    if (seedInput) seedInput.value = String(seed);
    try {
      const generated = ProceduralGenerator.generateDetailed(levelNumber, seed);
      this.loadCompiledLevel(generated.level, { source: NO_SOURCE, dirty: true });
      this.setStatusText(
        t('editor.generator.status.generated.label', {
          number: levelNumber,
          seed,
          moves: generated.solution.length
        })
      );
    } catch (err) {
      if (!(err instanceof ProceduralGenerationError)) throw err;
      this.setStatusText(t('editor.generator.status.failed.label'));
    }
  }

  private setStatusText(msg: string): void {
    const el = document.getElementById('editor-status-bar');
    if (el) el.textContent = msg;
  }
}
