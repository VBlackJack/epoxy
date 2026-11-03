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
  CompiledLevel,
  Direction,
  LevelBlueprint,
  LevelPack,
  Ruleset,
  ValidationIssue,
  WinRule
} from '../core/types';
import { downloadBytes, downloadJson } from '../ui/download';
import { lossyExportNotice } from '../ui/exportNotice';
import { receiversProgress } from '../ui/levelFeedback';
import { DEFAULT_RULESET, DEFAULT_WIN_RULE, FLOOR_TILE_ID } from '../core/coreConstants';
import { CanvasFit, fitCanvas, zoomIn, zoomOut } from './canvasFit';
import { checkBlocks, describeBlockVerdict } from './blockCheck';
import { CheckSummary, summarizeValidation } from './checkSummary';
import { cloneDocument, cloneMap, EditorDocument, EditorMetadata, sameDocument } from './editorDocument';
import { EditorHistory } from './editorHistory';
import { EditorKeyAction, getCanvasKeyAction, moveCursor, rotateClockwise } from './editorKeyboard';
import { layoutModeForWidth } from './editorLayout';
import {
  applyTool,
  Brush,
  continuesOnDrag,
  EDITOR_TOOLS,
  EditorTool,
  leavesLooseButton,
  MESSAGE_WIRE_CANCELLED,
  MESSAGE_WIRE_CANCELLED_BUTTON_LEFT,
  pickFromCell,
  PendingWire,
  ToolMessage
} from './editorTools';
import {
  INSPECTOR_SECTIONS,
  InspectorSection,
  parseSectionState,
  SectionState,
  serializeSectionState
} from './inspectorSections';
import { mapHeightOf, mapWidthOf, resizeMap } from './mapEdits';
import { MetadataEditCoalescer } from './metadataCoalescer';
import { isEditableRuleset, parseChipsRequired, parseRuleset, parseTimeLimit, parseWinRule, requiresEpoxyRules } from './metadataFields';
import {
  Availability,
  EditableRuleset,
  entityAvailability,
  majorityRuleset,
  tileAvailability,
  winRuleAvailability
} from './paletteAvailability';
import { describeResize } from './resizeReport';
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
  EDITOR_CHECK_DEBOUNCE_MS,
  EDITOR_CLONE_LINK_COLOR,
  EDITOR_CURSOR_OUTLINE_COLOR,
  EDITOR_DEFAULT_CHIPS_REQUIRED,
  EDITOR_DEFAULT_TIME_LIMIT_SECONDS,
  EDITOR_GENERATOR_MAX_LEVEL,
  EDITOR_GENERATOR_MIN_LEVEL,
  EDITOR_HOVER_OUTLINE_COLOR,
  EDITOR_LINK_LINE_WIDTH,
  EDITOR_MAX_TILE_SIZE,
  EDITOR_ZOOM_TILE_STEP,
  POINTER_ERASER_BUTTON,
  EDITOR_OVERLAY_LINE_WIDTH,
  EDITOR_PASSWORD_LENGTH,
  EDITOR_TILE_CENTER_OFFSET,
  EDITOR_TRAP_BUTTON_TILE,
  EDITOR_TRAP_LINK_COLOR,
  EDITOR_CLONE_BUTTON_TILE,
  EDITOR_WIRE_SOURCE_COLOR,
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
/** Fields that change in one gesture: each change is its own history step. */
const GESTURE_FIELD_IDS: readonly string[] = ['editor-meta-winrule', 'editor-meta-ruleset'];
const WIN_RULE_INPUT_ID = 'editor-meta-winrule';
const RULESET_INPUT_ID = 'editor-meta-ruleset';
const TITLE_INPUT_ID = 'editor-meta-title';
const LYNX_RULESET = 'lynx' as const;
/** Value of the context pack select while the editor content belongs to no pack. */
const NO_PACK_OPTION_VALUE = '';
/** Answers of the imported-pack and multi-level-file questions. */
const IMPORTED_MODIFY_CHOICE = 'modify';
const IMPORTED_COPY_CHOICE = 'copy';
const IMPORT_AS_PACK_CHOICE = 'pack';
const IMPORT_FIRST_CHOICE = 'first';
const SEPARATOR_BETWEEN_MESSAGES = ' ';
const NO_COORDS_TEXT = '--';
const EDITOR_PLAYER_BRUSH_ID = 'player_start';
const WIRE_TRAP_BRUSH_ID = 'wire_trap';
const WIRE_CLONER_BRUSH_ID = 'wire_cloner';
/** Win rules offered by the select, to mark the ones the engine cannot play. */
const WIN_RULE_VALUES: readonly WinRule[] = ['exit', 'targets', 'receivers'];
const ENTITIES_CATEGORY = 'entities';
const MECHANISMS_CATEGORY = 'mechanisms';

const TOOL_LABEL_KEYS: Record<EditorTool, string> = {
  brush: 'editor.layout.tool.brush.label',
  fill: 'editor.layout.tool.fill.label',
  eraser: 'editor.layout.tool.eraser.label',
  picker: 'editor.layout.tool.picker.label'
};
const CHECK_TEXT_KEYS: Record<CheckSummary['state'], string> = {
  valid: 'editor.layout.check.valid',
  warnings: 'editor.layout.check.warnings',
  errors: 'editor.layout.check.errors'
};

/** Where a save puts the level: an existing pack or a pack to create, and whether it is stored as a new level. */
interface SaveDestination {
  packId: string | null;
  newPackName: string | null;
  asCopy: boolean;
}

/** One pointer stroke or key press: the document it started from, and whether it changed anything. */
interface Stroke {
  base: EditorDocument;
  changed: boolean;
  forceErase: boolean;
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

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function editableRulesetOf(ruleset: Ruleset | undefined): EditableRuleset {
  return ruleset === LYNX_RULESET ? LYNX_RULESET : 'epoxy';
}

export class LevelEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: PixelRenderer;
  private hooks: EditorHooks;

  /** The level being edited: its map and its metadata. */
  private doc: EditorDocument = LevelEditor.emptyDocument();
  private history: EditorHistory;
  private readonly coalescer = new MetadataEditCoalescer();

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

  private activeCategory: string = 'terrain';
  private tool: EditorTool = 'brush';
  private brush: Brush = { kind: 'terrain', id: 'wall' };
  private activeDir: Direction = 'S';
  private stroke: Stroke | null = null;
  private pendingWire: PendingWire | null = null;
  private hoverCell: { x: number; y: number } | null = null;
  private cursorCell: { x: number; y: number } | null = null;
  /** Zoom steps away from the fit size; 0 fits the level to the stage. */
  private zoomOffset: number = 0;
  /** Tile size, in pixels, the canvas buffer is drawn at. */
  private tilePx: number = 0;
  /** The level as it was loaded or last saved; null when the content was never stored. */
  private cleanDoc: EditorDocument | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private playerIconUrl: string = '';
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
    this.history = new EditorHistory(
      ConfigRegistry.getGame().timing.maxUndoSnapshots || TIMING_DEFAULTS.maxUndoSnapshots
    );

    this.initBlankMap();
    this.bindCanvasEvents();
    // Bound once: buildUI() runs again on graphics style changes and must
    // not stack toolbar listeners.
    this.bindToolbarEvents();
    this.bindMetadataEvents();
    this.bindPaletteChrome();
    this.bindInspectorSections();
    this.bindLayoutEvents();
  }

  private static emptyDocument(): EditorDocument {
    return {
      terrain: [],
      items: [],
      entities: [],
      trapLinks: [],
      cloneLinks: [],
      playerStart: { x: 0, y: 0, dir: 'S' },
      title: '',
      hint: '',
      author: '',
      password: '',
      timeLimitSeconds: EDITOR_DEFAULT_TIME_LIMIT_SECONDS,
      chipsRequired: EDITOR_DEFAULT_CHIPS_REQUIRED,
      winRule: DEFAULT_WIN_RULE,
      ruleset: undefined
    };
  }

  /** True when the map or its metadata changed since the last load or save. */
  public hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  /** Width of the level being edited, in cells; a level sets its own size. */
  private mapWidth(): number {
    return mapWidthOf(this.doc);
  }

  /** Height of the level being edited, in cells. */
  private mapHeight(): number {
    return mapHeightOf(this.doc);
  }

  /**
   * Sizes the canvas to the level and the stage: the tile is the largest whole
   * number of CSS pixels that fits (moved by the zoom), the buffer is drawn at
   * that tile times the device pixel ratio, and the canvas is redrawn.
   */
  private applyFit(): CanvasFit | null {
    const stage = byId('editor-stage');
    const { editorTilePixelSize } = ConfigRegistry.getGame().grid;
    // A hidden editor has no size to fit: it keeps the base tile until it is shown.
    const fit = fitCanvas({
      levelWidth: this.mapWidth(),
      levelHeight: this.mapHeight(),
      baseTileSize: editorTilePixelSize,
      maxTileSize: EDITOR_MAX_TILE_SIZE,
      zoomTileStep: EDITOR_ZOOM_TILE_STEP,
      containerWidth: stage?.offsetWidth ?? 0,
      containerHeight: stage?.offsetHeight ?? 0,
      devicePixelRatio: window.devicePixelRatio,
      zoomOffset: this.zoomOffset
    });
    this.zoomOffset = fit.zoomOffset;
    const resized = this.canvas.width !== fit.backingWidth || this.canvas.height !== fit.backingHeight;
    if (resized) {
      this.canvas.width = fit.backingWidth;
      this.canvas.height = fit.backingHeight;
    }
    this.tilePx = fit.bufferTileSize;
    this.canvas.style.width = `${fit.cssWidth}px`;
    this.canvas.style.height = `${fit.cssHeight}px`;
    this.updateZoomControls(fit);
    if (resized || this.tilePx !== this.lastDrawnTilePx) this.render();
    return fit;
  }

  private lastDrawnTilePx = 0;

  private updateZoomControls(fit: CanvasFit): void {
    const out = byId<HTMLButtonElement>('editor-zoom-out-btn');
    const inn = byId<HTMLButtonElement>('editor-zoom-in-btn');
    if (out) out.disabled = !fit.canZoomOut;
    if (inn) inn.disabled = !fit.canZoomIn;
    const label = byId('editor-zoom-level');
    if (label) label.textContent = t('editor.layout.zoom.level.label', { percent: fit.percent });
  }

  private setZoomOffset(offset: number): void {
    this.zoomOffset = offset;
    this.applyFit();
  }

  /** A blank level in the grid the game configures. */
  private blankDocument(ruleset: Ruleset | undefined): EditorDocument {
    const { mapWidth, mapHeight } = ConfigRegistry.getGame().grid;
    return {
      ...LevelEditor.emptyDocument(),
      terrain: Array.from({ length: mapHeight }, (_, y) =>
        Array.from({ length: mapWidth }, (__, x) =>
          x === 0 || y === 0 || x === mapWidth - 1 || y === mapHeight - 1 ? 'wall' : FLOOR_TILE_ID
        )
      ),
      items: Array.from({ length: mapHeight }, () => Array.from({ length: mapWidth }, () => null)),
      playerStart: { x: Math.floor(mapWidth / 2), y: Math.floor(mapHeight / 2), dir: 'S' },
      title: t('editor.metadata.default_title.label'),
      ruleset: ruleset === LYNX_RULESET ? LYNX_RULESET : undefined
    };
  }

  public initBlankMap(options: { packId?: string | null; ruleset?: Ruleset } = {}): void {
    this.doc = this.blankDocument(options.ruleset);
    this.currentLevelId = ConfigRegistry.newLevelId();
    this.source = { packId: options.packId ?? null, levelId: null };
    this.originalLevel = null;
    this.loadedTexts = null;
    this.afterDocumentReplaced(false);
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
    this.currentLevelId = level.id;
    this.source = options.source ?? NO_SOURCE;
    this.originalLevel = structuredClone(level);
    const title = this.resolveLevelTitle(level);
    const hint = level.customHint || (level.hintKey ? t(level.hintKey) : '');
    this.loadedTexts = { title, hint };
    this.doc = {
      ...cloneMap(level),
      title,
      hint,
      author: level.author ?? '',
      password: level.password,
      timeLimitSeconds: level.timeLimitSeconds,
      chipsRequired: level.chipsRequired,
      winRule: level.winRule ?? DEFAULT_WIN_RULE,
      ruleset: level.ruleset
    };
    this.afterDocumentReplaced(options.dirty ?? false);
    return true;
  }

  /** Resets everything that belongs to the previous level once another one is in `doc`. */
  private afterDocumentReplaced(dirty: boolean): void {
    this.loadGeneration++;
    this.history.clear();
    this.coalescer.reset();
    this.stroke = null;
    this.pendingWire = null;
    this.hoverCell = null;
    this.cursorCell = null;
    this.zoomOffset = 0;
    this.cleanDoc = dirty ? null : cloneDocument(this.doc);
    this.isDirty = dirty;
    this.applyFit();
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.renderPaletteItems();
    this.setStatusText(t('editor.palette.status.ready.label'));
    this.refreshContext();
    this.updateCanvasLabel();
    this.scheduleCheck();
    this.render();
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
    this.playerIconUrl = this.renderer.renderIconToDataUrl('player', EDITOR_PLAYER_BRUSH_ID);
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.refreshContext();
    this.syncMetadataInputs();
    this.updateToolButtons();
    this.updateDirButtons();
    this.updateCanvasLabel();
    this.applyFit();
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
    this.syncMetadataInputs();
    this.updateCanvasLabel();
    this.updateCheckBadge(this.lastCheck);
    this.applyFit();
  }

  // ---------------------------------------------------------------------------
  // Palette
  // ---------------------------------------------------------------------------

  private renderCategoryTabs(): void {
    const container = byId('editor-category-tabs');
    if (!container) return;
    container.innerHTML = '';

    const categories = ConfigRegistry.getTiles().categories;
    const active = categories.find((cat) => cat.id === this.activeCategory);
    byId('editor-palette-grid')?.setAttribute('aria-label', active ? t(active.i18nKey) : '');
    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(this.activeCategory === cat.id));
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

  /** Whether the brush can be used in the level's engine. */
  private brushAvailability(brush: Brush): Availability {
    const ruleset = editableRulesetOf(this.doc.ruleset);
    if (brush.kind === 'terrain' || brush.kind === 'item') return tileAvailability(ruleset, brush.id);
    if (brush.kind === 'entity') return entityAvailability(ruleset, brush.id);
    return { available: true };
  }

  /** True when any tile or creature of the palette is unavailable in the level's engine. */
  private hasUnavailableItems(): boolean {
    const ruleset = editableRulesetOf(this.doc.ruleset);
    if (ruleset !== LYNX_RULESET) return false;
    const tiles = Object.keys(ConfigRegistry.getTiles().tiles);
    const entities = Object.keys(ConfigRegistry.getMonsters().entities);
    return (
      tiles.some((id) => !tileAvailability(ruleset, id).available) ||
      entities.some((id) => !entityAvailability(ruleset, id).available)
    );
  }

  private isBrushSelected(brush: Brush): boolean {
    return this.brush.kind === brush.kind && this.brush.id === brush.id;
  }

  private renderPaletteItems(): void {
    const container = byId('editor-palette-grid');
    if (!container) return;
    container.innerHTML = '';
    const entry = (brush: Brush, label: string, iconUrl: string): void => {
      container.appendChild(
        this.createPaletteButton(label, iconUrl, this.isBrushSelected(brush), this.brushAvailability(brush), () =>
          this.selectBrush(brush)
        )
      );
    };

    const tiles = Object.values(ConfigRegistry.getTiles().tiles).filter(
      (tile) => tile.category === this.activeCategory
    );
    for (const tile of tiles) {
      const kind = tile.layer === 'item' ? 'item' : 'terrain';
      entry(
        { kind, id: tile.id },
        t(tile.i18nKey),
        this.renderer.renderIconToDataUrl(tile.layer === 'item' ? 'item' : 'tile', tile.id)
      );
    }

    const entities = Object.values(ConfigRegistry.getMonsters().entities).filter(
      (ent) => ent.category === this.activeCategory
    );
    for (const ent of entities) {
      entry({ kind: 'entity', id: ent.id }, t(ent.i18nKey), this.renderer.renderIconToDataUrl('entity', ent.id));
    }

    if (this.activeCategory === ENTITIES_CATEGORY) {
      entry({ kind: 'player_start', id: EDITOR_PLAYER_BRUSH_ID }, t('editor.palette.tools.player_start'), this.playerIconUrl);
    }

    if (this.activeCategory === MECHANISMS_CATEGORY) {
      entry(
        { kind: 'wire_trap', id: WIRE_TRAP_BRUSH_ID },
        t('editor.palette.tools.wire_trap'),
        this.renderer.renderIconToDataUrl('tile', EDITOR_TRAP_BUTTON_TILE)
      );
      entry(
        { kind: 'wire_cloner', id: WIRE_CLONER_BRUSH_ID },
        t('editor.palette.tools.wire_cloner'),
        this.renderer.renderIconToDataUrl('tile', EDITOR_CLONE_BUTTON_TILE)
      );
    }

    this.updateSwitchEngineButton();
  }

  private createPaletteButton(
    label: string,
    iconUrl: string,
    selected: boolean,
    availability: Availability,
    onClick: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-item-btn ${selected ? 'active' : ''}`;
    btn.setAttribute('aria-pressed', String(selected));
    btn.title = label;
    if (iconUrl) {
      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = '';
      img.className = 'palette-item-icon';
      btn.appendChild(img);
    }
    const span = document.createElement('span');
    span.className = 'palette-item-label';
    span.textContent = label;
    btn.appendChild(span);
    if (availability.available) {
      btn.addEventListener('click', onClick);
    } else {
      const reason = t(availability.reasonKey);
      btn.classList.add('is-unavailable');
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-description', reason);
      btn.title = `${label}: ${reason}`;
      btn.addEventListener('click', () => this.setStatusText(reason));
    }
    return btn;
  }

  /** Choosing a palette item puts the brush back in hand, except for a terrain tile while filling. */
  private selectBrush(brush: Brush): void {
    this.cancelPendingWire(false);
    this.brush = brush;
    if (this.tool === 'eraser' || this.tool === 'picker' || (this.tool === 'fill' && brush.kind !== 'terrain')) {
      this.tool = 'brush';
      this.updateToolButtons();
    }
    this.updateCanvasLabel();
    this.renderPaletteItems();
    if (brush.kind === 'wire_trap' || brush.kind === 'wire_cloner') {
      this.setStatusText(t('editor.palette.status.wire_select_source'));
    }
  }

  private updateSwitchEngineButton(): void {
    byId('editor-switch-epoxy-btn')?.classList.toggle('hidden', !this.hasUnavailableItems());
  }

  private bindPaletteChrome(): void {
    byId('editor-switch-epoxy-btn')?.addEventListener('click', () => {
      if (this.doc.ruleset === undefined) return;
      this.recordMetadataStep();
      this.doc = { ...this.doc, ruleset: undefined };
      this.afterMetadataChange();
      this.setStatusText(t('editor.layout.palette.switched'));
    });
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-dir-group [data-dir]'))) {
      btn.addEventListener('click', () => {
        this.activeDir = (btn.dataset.dir as Direction) || 'S';
        this.updateDirButtons();
      });
    }
    byId('editor-dir-rotate-btn')?.addEventListener('click', () => this.rotateDirection());
    byId('editor-zoom-out-btn')?.addEventListener('click', () => this.setZoomOffset(zoomOut(this.zoomOffset)));
    byId('editor-zoom-in-btn')?.addEventListener('click', () => this.setZoomOffset(zoomIn(this.zoomOffset)));
    byId('editor-zoom-fit-btn')?.addEventListener('click', () => this.setZoomOffset(0));
  }

  private updateDirButtons(): void {
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('#editor-dir-group [data-dir]'))) {
      btn.setAttribute('aria-pressed', String(btn.dataset.dir === this.activeDir));
    }
  }

  private rotateDirection(): void {
    this.activeDir = rotateClockwise(this.activeDir);
    this.updateDirButtons();
  }

  // ---------------------------------------------------------------------------
  // Tools and keyboard actions
  // ---------------------------------------------------------------------------

  private toolLabel(tool: EditorTool): string {
    return t(TOOL_LABEL_KEYS[tool]);
  }

  private updateToolButtons(): void {
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'))) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tool === this.tool));
    }
  }

  public setTool(tool: EditorTool): void {
    if (tool === this.tool) return;
    this.cancelPendingWire(false);
    this.tool = tool;
    this.updateToolButtons();
    this.updateCanvasLabel();
    this.setStatusText(t('editor.layout.status.tool_changed', { tool: this.toolLabel(tool) }));
  }

  /** Runs an editor shortcut from the keyboard; the application routes the key. */
  public handleKeyAction(action: EditorKeyAction): void {
    switch (action.kind) {
      case 'tool':
        this.setTool(action.tool);
        break;
      case 'rotate':
        this.rotateDirection();
        break;
      case 'zoom_in':
        this.setZoomOffset(zoomIn(this.zoomOffset));
        break;
      case 'zoom_out':
        this.setZoomOffset(zoomOut(this.zoomOffset));
        break;
      case 'zoom_fit':
        this.setZoomOffset(0);
        break;
      case 'cancel':
        this.cancelPendingWire(true);
        break;
    }
  }

  /**
   * Drops the wire that waits for its target. A button already placed stays on
   * the map without a link, and the status line says so. With `announce` the
   * cancellation is announced even when nothing stays behind.
   */
  private cancelPendingWire(announce: boolean): void {
    const pending = this.pendingWire;
    if (!pending) return;
    this.pendingWire = null;
    const buttonTile = pending.kind === 'trap' ? EDITOR_TRAP_BUTTON_TILE : EDITOR_CLONE_BUTTON_TILE;
    if (leavesLooseButton(this.doc, pending, buttonTile)) {
      this.setStatusText(t(MESSAGE_WIRE_CANCELLED_BUTTON_LEFT));
    } else if (announce) {
      this.setStatusText(t(MESSAGE_WIRE_CANCELLED));
    }
    this.render();
  }

  private updateCanvasLabel(): void {
    const level = this.doc.title.trim() || t('editor.metadata.default_title.label');
    this.canvas.setAttribute('aria-label', t('editor.layout.canvas.aria', { level, tool: this.toolLabel(this.tool) }));
  }

  // ---------------------------------------------------------------------------
  // Pack context line
  // ---------------------------------------------------------------------------

  /**
   * Brings the source in line with the library after the pack manager changed
   * it: a moved level is followed to its new pack; a deleted level or pack
   * leaves the content with no pack, as unsaved work, so the next save asks
   * where it goes and stores it under a new id.
   */
  public reconcileSourceWithLibrary(): void {
    const result = reconcileSource(this.source, ConfigRegistry.getAllPacks());
    this.source = result.source;
    if (result.lost) {
      this.cleanDoc = null;
      this.isDirty = true;
    }
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
    const position = byId('editor-context-position');
    if (position) {
      position.textContent =
        index >= 0 && pack
          ? t('editor.pack.context.position.label', { number: index + 1, total: pack.levels.length })
          : t('editor.pack.context.new_level.label');
    }
    this.updateContextTitle();
    this.updateDirtyBadge();
    const prev = byId<HTMLButtonElement>('editor-context-prev');
    const next = byId<HTMLButtonElement>('editor-context-next');
    if (prev) prev.disabled = !pack || index < 0 || nextEditableIndex(pack.levels, index, -1) < 0;
    if (next) next.disabled = !pack || index < 0 || nextEditableIndex(pack.levels, index, 1) < 0;
  }

  private fillContextPackSelect(): void {
    const select = byId<HTMLSelectElement>('editor-context-pack');
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
    const title = this.doc.title.trim() || t('editor.metadata.default_title.label');
    const el = byId('editor-context-title');
    if (el) el.textContent = title;
  }

  private updateDirtyBadge(): void {
    byId('editor-context-dirty')?.classList.toggle('hidden', !this.dirty);
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
    const select = byId<HTMLSelectElement>('editor-context-pack');
    select?.addEventListener('change', () => {
      const packId = select.value;
      void (async () => {
        if (packId !== NO_PACK_OPTION_VALUE && packId !== this.source.packId) await this.openPackFromContext(packId);
        // Declined, refused or empty: the select shows what the editor holds again.
        this.fillContextPackSelect();
      })();
    });
    byId('editor-context-prev')?.addEventListener('click', () => void this.stepLevel(-1));
    byId('editor-context-next')?.addEventListener('click', () => void this.stepLevel(1));
    byId('editor-context-open')?.addEventListener('click', () => {
      this.hooks.openManager(this.source.packId);
    });
  }

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------

  private bindToolbarEvents(): void {
    const levelInput = byId<HTMLInputElement>('editor-gen-level');
    if (levelInput) {
      levelInput.min = String(EDITOR_GENERATOR_MIN_LEVEL);
      levelInput.max = String(EDITOR_GENERATOR_MAX_LEVEL);
      levelInput.value = String(EDITOR_GENERATOR_MIN_LEVEL);
    }
    byId('editor-generate-btn')?.addEventListener('click', () => {
      void this.generateIntoEditor();
    });

    byId('editor-new-btn')?.addEventListener('click', () => {
      void this.newLevelInPack(this.source.packId);
    });

    byId('editor-undo-btn')?.addEventListener('click', () => {
      this.undo();
    });

    byId('editor-redo-btn')?.addEventListener('click', () => {
      this.redo();
    });

    byId('editor-test-btn')?.addEventListener('click', () => {
      void this.testPlay();
    });

    for (const tool of EDITOR_TOOLS) {
      document.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)?.addEventListener('click', () => {
        this.setTool(tool);
      });
    }

    byId('editor-validate-btn')?.addEventListener('click', () => {
      const compiled = this.exportCompiledLevel();
      const report = LevelValidator.validate(compiled);
      this.setCheck(summarizeValidation(report));
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
      this.appendBlocksLine(compiled);
    });

    byId('editor-save-btn')?.addEventListener('click', () => {
      void this.save();
    });

    byId('editor-save-copy-btn')?.addEventListener('click', () => {
      void this.saveCopy();
    });

    byId('editor-export-btn')?.addEventListener('click', () => {
      const compiled = this.exportCompiledLevel();
      downloadJson(compiled, `${compiled.id || EXPORT_FALLBACK_FILE_NAME}.json`);
    });

    byId('editor-export-ccl-btn')?.addEventListener('click', () => {
      const compiled = this.exportCompiledLevel();
      const encoded = DatCodec.encodeLevelsWithReport([compiled]);
      if (encoded.levelCount > 0) {
        downloadBytes(encoded.bytes, `${compiled.id || EXPORT_FALLBACK_FILE_NAME}.ccl`);
      }
      const notice = lossyExportNotice(encoded);
      if (notice) this.setStatusText(notice);
    });

    const importInput = byId<HTMLInputElement>('editor-import-input');
    byId('editor-import-btn')?.addEventListener('click', () => {
      importInput?.click();
    });

    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (file) void this.importFileIntoEditor(file);
    });

    this.bindContextEvents();

    byId('editor-autocount-btn')?.addEventListener('click', () => {
      let count = 0;
      for (const row of this.doc.items) {
        for (const cell of row) {
          if (cell === 'chip') count++;
        }
      }
      if (count === this.doc.chipsRequired) return;
      this.recordMetadataStep();
      this.doc = { ...this.doc, chipsRequired: count };
      const chipsInput = byId<HTMLInputElement>('editor-meta-chips');
      if (chipsInput) chipsInput.value = String(count);
      this.afterMetadataChange();
    });

    byId('editor-size-apply-btn')?.addEventListener('click', () => this.applySize());
    for (const id of ['editor-size-width', 'editor-size-height']) {
      byId(id)?.addEventListener('keydown', (ev) => {
        if ((ev as KeyboardEvent).key !== 'Enter') return;
        ev.preventDefault();
        this.applySize();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Check badge
  // ---------------------------------------------------------------------------

  private lastCheck: CheckSummary | null = null;

  /** Recomputes the badge once the player stops editing for a moment. */
  private scheduleCheck(): void {
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      this.setCheck(summarizeValidation(LevelValidator.validate(this.exportCompiledLevel())));
    }, EDITOR_CHECK_DEBOUNCE_MS);
  }

  /**
   * Adds the block puzzle verdict to the status line after an explicit Check.
   * It only runs on request (the search can be slow) and is hidden for the
   * Lynx rules.
   */
  private appendBlocksLine(compiled: CompiledLevel): void {
    const verdict = checkBlocks(compiled);
    if (!verdict) return;
    const line = describeBlockVerdict(verdict);
    const el = document.getElementById('editor-status-bar');
    const current = el?.textContent ?? '';
    this.setStatusText(`${current}${t('validator.status.issue_separator.label')}${t(line.key, line.params)}`);
  }

  private setCheck(summary: CheckSummary): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.lastCheck = summary;
    this.updateCheckBadge(summary);
  }

  private updateCheckBadge(summary: CheckSummary | null): void {
    const badge = byId('editor-check-badge');
    if (!badge) return;
    badge.dataset.state = summary?.state ?? 'idle';
    badge.textContent = summary
      ? t(CHECK_TEXT_KEYS[summary.state], { count: summary.count })
      : t('editor.layout.check.idle');
  }

  // ---------------------------------------------------------------------------
  // Metadata inspector
  // ---------------------------------------------------------------------------

  private bindMetadataEvents(): void {
    for (const id of METADATA_INPUT_IDS) {
      byId(id)?.addEventListener('input', () => this.onMetadataInput(id));
    }
    // A new focus starts a new undo step for the field's next edit.
    byId('editor-inspector')?.addEventListener('focusin', () => this.coalescer.reset());
  }

  /** The metadata the inputs show, over the document's own for a field that has no input. */
  private readMetadataInputs(): EditorMetadata {
    const doc = this.doc;
    const value = (id: string): string | null => byId<HTMLInputElement>(id)?.value ?? null;
    const title = value('editor-meta-title');
    const hint = value('editor-meta-hint');
    const author = value('editor-meta-author');
    const password = value('editor-meta-password');
    const time = value('editor-meta-time');
    const chips = value('editor-meta-chips');
    const winRule = value(WIN_RULE_INPUT_ID);
    const ruleset = value(RULESET_INPUT_ID);
    const next: EditorMetadata = {
      // A cleared field stays cleared: an empty title falls back to the default one when the level is stored.
      title: title === null ? doc.title : title.trim(),
      hint: hint === null ? doc.hint : hint.trim(),
      author: author === null ? doc.author : author.trim(),
      password: password === null ? doc.password : password.trim().toUpperCase().slice(0, EDITOR_PASSWORD_LENGTH),
      timeLimitSeconds: time === null ? doc.timeLimitSeconds : parseTimeLimit(time, doc.timeLimitSeconds),
      chipsRequired: chips === null ? doc.chipsRequired : parseChipsRequired(chips, doc.chipsRequired),
      winRule: winRule === null ? doc.winRule : parseWinRule(winRule, doc.winRule),
      ruleset: doc.ruleset
    };
    if (ruleset !== null) {
      const parsed = parseRuleset(ruleset, doc.ruleset ?? DEFAULT_RULESET);
      next.ruleset = parsed === DEFAULT_RULESET ? undefined : parsed;
    }
    if (requiresEpoxyRules(next.winRule, hasLaserContent(doc))) next.ruleset = undefined;
    return next;
  }

  private sameMetadata(a: EditorMetadata, b: EditorMetadata): boolean {
    return (
      a.title === b.title &&
      a.hint === b.hint &&
      a.author === b.author &&
      a.password === b.password &&
      a.timeLimitSeconds === b.timeLimitSeconds &&
      a.chipsRequired === b.chipsRequired &&
      a.winRule === b.winRule &&
      a.ruleset === b.ruleset
    );
  }

  private onMetadataInput(id: string): void {
    const next = this.readMetadataInputs();
    if (this.sameMetadata(next, this.doc)) return;
    if (this.coalescer.shouldRecord(id, !GESTURE_FIELD_IDS.includes(id))) this.history.push(this.doc);
    this.doc = { ...this.doc, ...next };
    this.afterMetadataChange();
    if (id === TITLE_INPUT_ID) {
      this.updateContextTitle();
      this.updateCanvasLabel();
    }
  }

  /** Records the document as it is, before a metadata change made outside a text field. */
  private recordMetadataStep(): void {
    this.history.push(this.doc);
    this.coalescer.reset();
  }

  private afterMetadataChange(): void {
    this.isDirty = true;
    this.updateUndoRedoButtons();
    this.syncRulesetInput();
    this.renderPaletteItems();
    this.scheduleCheck();
  }

  private syncMetadataInputs(): void {
    const set = (id: string, value: string): void => {
      const el = byId<HTMLInputElement | HTMLSelectElement>(id);
      if (el) el.value = value;
    };
    const doc = this.doc;
    set('editor-meta-title', doc.title);
    set('editor-meta-hint', doc.hint);
    set('editor-meta-author', doc.author);
    set('editor-meta-password', doc.password);
    set('editor-meta-time', String(doc.timeLimitSeconds));
    set('editor-meta-chips', String(doc.chipsRequired));
    set(WIN_RULE_INPUT_ID, doc.winRule);
    this.syncRulesetInput();
    this.syncSizeInputs();
  }

  /**
   * A level won with block targets or laser receivers, or holding laser
   * content, is Epoxy only: force it and lock the Lynx option. Under Lynx the
   * Epoxy-only win rules are marked unavailable with the reason.
   */
  private syncRulesetInput(): void {
    const rulesetEl = byId<HTMLSelectElement>(RULESET_INPUT_ID);
    if (!rulesetEl) return;
    const lynxLocked = requiresEpoxyRules(this.doc.winRule, hasLaserContent(this.doc));
    if (lynxLocked) this.doc = { ...this.doc, ruleset: undefined };
    rulesetEl.value = this.doc.ruleset ?? DEFAULT_RULESET;
    for (const option of Array.from(rulesetEl.options)) {
      if (option.value !== LYNX_RULESET) continue;
      option.disabled = lynxLocked;
      option.title = lynxLocked ? t('editor.metadata.ruleset_lynx_unavailable.label') : '';
    }
    const description = byId('editor-ruleset-description');
    if (description) {
      description.textContent = t(
        editableRulesetOf(this.doc.ruleset) === LYNX_RULESET
          ? 'editor.layout.rules.description.lynx'
          : 'editor.layout.rules.description.epoxy'
      );
    }
    const winRuleEl = byId<HTMLSelectElement>(WIN_RULE_INPUT_ID);
    if (winRuleEl) {
      const ruleset = editableRulesetOf(this.doc.ruleset);
      for (const option of Array.from(winRuleEl.options)) {
        const rule = WIN_RULE_VALUES.find((value) => value === option.value);
        const availability = rule ? winRuleAvailability(ruleset, rule) : { available: true as const };
        option.disabled = !availability.available;
        option.title = availability.available ? '' : t(availability.reasonKey);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Size
  // ---------------------------------------------------------------------------

  private syncSizeInputs(): void {
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const width = byId<HTMLInputElement>('editor-size-width');
    const height = byId<HTMLInputElement>('editor-size-height');
    for (const input of [width, height]) {
      if (!input) continue;
      input.min = String(bounds.minSize);
      input.max = String(bounds.maxSize);
    }
    if (width) width.value = String(this.mapWidth());
    if (height) height.value = String(this.mapHeight());
    const range = byId('editor-size-range');
    if (range) range.textContent = t('editor.layout.size.range', { min: bounds.minSize, max: bounds.maxSize });
  }

  /** Resizes the map to the typed size as one undoable step and says what it dropped. */
  private applySize(): void {
    const widthInput = byId<HTMLInputElement>('editor-size-width');
    const heightInput = byId<HTMLInputElement>('editor-size-height');
    const typedWidth = Number.parseInt(widthInput?.value ?? '', 10);
    const typedHeight = Number.parseInt(heightInput?.value ?? '', 10);
    const result = resizeMap(
      this.doc,
      Number.isFinite(typedWidth) ? typedWidth : this.mapWidth(),
      Number.isFinite(typedHeight) ? typedHeight : this.mapHeight(),
      ConfigRegistry.getLevelSizeBounds()
    );
    if (result.changed) {
      this.history.push(this.doc);
      this.coalescer.reset();
      this.cancelPendingWire(false);
      this.doc = { ...this.doc, ...result.map };
      this.cursorCell = null;
      this.hoverCell = null;
      this.isDirty = true;
      this.applyFit();
      this.updateUndoRedoButtons();
      this.syncRulesetInput();
      this.scheduleCheck();
      this.render();
    }
    this.syncSizeInputs();
    this.setStatusText(
      describeResize(result)
        .map((note) => t(note.key, note.params))
        .join(SEPARATOR_BETWEEN_MESSAGES)
    );
  }

  // ---------------------------------------------------------------------------
  // Inspector sections and layout
  // ---------------------------------------------------------------------------

  private sectionsStorageKey(): string {
    return ConfigRegistry.getStorageKey(ConfigRegistry.getGame().storage.editorSectionsKey);
  }

  private readSectionState(): SectionState {
    try {
      return parseSectionState(localStorage.getItem(this.sectionsStorageKey()));
    } catch {
      // Storage blocked: the sections start in their default state.
      return parseSectionState(null);
    }
  }

  private bindInspectorSections(): void {
    const state = this.readSectionState();
    for (const section of INSPECTOR_SECTIONS) {
      const details = document.querySelector<HTMLDetailsElement>(`details[data-section="${section}"]`);
      if (!details) continue;
      details.open = state[section];
      details.addEventListener('toggle', () => this.rememberSection(section, details.open));
    }
  }

  private rememberSection(section: InspectorSection, open: boolean): void {
    const state = this.readSectionState();
    state[section] = open;
    try {
      localStorage.setItem(this.sectionsStorageKey(), serializeSectionState(state));
    } catch {
      // Storage blocked: the choice is not remembered.
    }
  }

  /** Follows the editor's size: the column layout, and the canvas fit. */
  private bindLayoutEvents(): void {
    const view = byId('editor-view');
    const stage = byId('editor-stage');
    if (!view || typeof ResizeObserver === 'undefined') return;
    const update = (): void => {
      // A hidden view measures 0 wide: it keeps the layout it had.
      if (view.offsetWidth > 0) view.dataset.layout = layoutModeForWidth(view.offsetWidth);
      this.applyFit();
    };
    const observer = new ResizeObserver(update);
    observer.observe(view);
    if (stage) observer.observe(stage);
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /** Puts a document from the history in place of the current one. */
  private restoreDocument(doc: EditorDocument): void {
    this.doc = doc;
    this.coalescer.reset();
    this.isDirty = !(this.cleanDoc !== null && sameDocument(doc, this.cleanDoc));
    this.pendingWire = null;
    this.cursorCell = null;
    this.applyFit();
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.updateContextTitle();
    this.updateCanvasLabel();
    this.renderPaletteItems();
    this.scheduleCheck();
    this.render();
  }

  public undo(): void {
    if (this.stroke) return;
    const wire = this.pendingWire;
    const previous = this.history.undo(this.doc);
    if (!previous) return;
    this.restoreDocument(previous);
    this.announceDroppedWire(wire);
  }

  public redo(): void {
    if (this.stroke) return;
    const wire = this.pendingWire;
    const next = this.history.redo(this.doc);
    if (!next) return;
    this.restoreDocument(next);
    this.announceDroppedWire(wire);
  }

  /** A wire dropped by undo or redo leaves a message when its button stays on the map. */
  private announceDroppedWire(wire: PendingWire | null): void {
    if (!wire) return;
    const buttonTile = wire.kind === 'trap' ? EDITOR_TRAP_BUTTON_TILE : EDITOR_CLONE_BUTTON_TILE;
    if (leavesLooseButton(this.doc, wire, buttonTile)) this.setStatusText(t(MESSAGE_WIRE_CANCELLED_BUTTON_LEFT));
  }

  private updateUndoRedoButtons(): void {
    const undoBtn = byId<HTMLButtonElement>('editor-undo-btn');
    const redoBtn = byId<HTMLButtonElement>('editor-redo-btn');
    if (undoBtn) undoBtn.disabled = !this.history.canUndo();
    if (redoBtn) redoBtn.disabled = !this.history.canRedo();
  }

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------

  private pickAt(x: number, y: number): void {
    const picked = pickFromCell(this.doc, x, y, FLOOR_TILE_ID);
    this.cancelPendingWire(false);
    this.brush = picked.brush;
    if (picked.dir) {
      this.activeDir = picked.dir;
      this.updateDirButtons();
    }
    const definition =
      picked.brush.kind === 'entity'
        ? ConfigRegistry.getEntityDef(picked.brush.id)
        : ConfigRegistry.getTile(picked.brush.id);
    this.activeCategory = definition?.category || ENTITIES_CATEGORY;
    // The picker hands the brush back once it has taken a tile.
    if (this.tool === 'picker') {
      this.tool = 'brush';
      this.updateToolButtons();
      this.updateCanvasLabel();
    }
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.setStatusText(t('editor.palette.status.picked.label', { name: definition ? t(definition.i18nKey) : picked.brush.id }));
  }

  /** The grid cell under a screen position, or null outside the grid. */
  private cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = Math.floor(((clientX - rect.left) / rect.width) * this.mapWidth());
    const y = Math.floor(((clientY - rect.top) / rect.height) * this.mapHeight());
    if (x < 0 || x >= this.mapWidth() || y < 0 || y >= this.mapHeight()) return null;
    return { x, y };
  }

  private setHover(cell: { x: number; y: number } | null): void {
    const same = this.hoverCell?.x === cell?.x && this.hoverCell?.y === cell?.y;
    this.hoverCell = cell;
    this.setCoordsText(cell ? t('editor.palette.status.coords', { x: cell.x, y: cell.y }) : NO_COORDS_TEXT);
    if (!same) this.render();
  }

  private bindCanvasEvents(): void {
    this.canvas.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
    });

    this.canvas.addEventListener('pointerdown', (ev) => {
      const cell = this.cellAt(ev.clientX, ev.clientY);
      if (!cell) return;
      ev.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.canvas.setPointerCapture(ev.pointerId);
      this.cursorCell = cell;

      if (ev.altKey || ev.button === 1 || this.tool === 'picker') {
        this.pickAt(cell.x, cell.y);
        return;
      }

      this.beginStroke(ev.button === 2 || ev.button === POINTER_ERASER_BUTTON);
      this.applyAt(cell.x, cell.y);
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      const cell = this.cellAt(ev.clientX, ev.clientY);
      this.setHover(cell);
      if (cell && this.stroke && continuesOnDrag(this.tool, this.brush, this.stroke.forceErase)) {
        this.applyAt(cell.x, cell.y);
      }
    });

    this.canvas.addEventListener('pointerleave', () => {
      if (!this.stroke) this.setHover(null);
    });

    const stopPainting = (): void => this.endStroke();
    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', stopPainting);

    this.canvas.addEventListener('keydown', (ev) => {
      const action = getCanvasKeyAction(ev);
      if (!action) return;
      ev.preventDefault();
      if (action.kind === 'move') {
        const from = this.cursorCell ?? { x: this.doc.playerStart.x, y: this.doc.playerStart.y };
        this.cursorCell = moveCursor(from, action.dx, action.dy, this.mapWidth(), this.mapHeight());
        this.setCoordsText(t('editor.palette.status.coords', { x: this.cursorCell.x, y: this.cursorCell.y }));
        this.render();
        return;
      }
      // A pointer stroke is running: its own history step must not be split by a key press.
      if (this.stroke) return;
      const cell = this.cursorCell ?? { x: this.doc.playerStart.x, y: this.doc.playerStart.y };
      this.cursorCell = cell;
      if (this.tool === 'picker') {
        this.pickAt(cell.x, cell.y);
        return;
      }
      this.beginStroke(false);
      this.applyAt(cell.x, cell.y);
      this.endStroke();
    });
    this.canvas.addEventListener('focus', () => this.render());
    this.canvas.addEventListener('blur', () => this.render());
  }

  private beginStroke(forceErase: boolean): void {
    this.stroke = { base: cloneDocument(this.doc), changed: false, forceErase };
  }

  /** A stroke that changed the level is one history step; one that changed nothing leaves no trace. */
  private endStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    if (!stroke.changed) return;
    this.history.push(stroke.base);
    this.coalescer.reset();
    this.isDirty = true;
    this.updateUndoRedoButtons();
    this.syncRulesetInput();
    this.updateSwitchEngineButton();
    this.scheduleCheck();
  }

  /** Applies the active tool to a cell as part of the running stroke. */
  private applyAt(x: number, y: number): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const availability = stroke.forceErase || this.tool === 'eraser' ? { available: true as const } : this.brushAvailability(this.brush);
    if (!availability.available) {
      this.setStatusText(t(availability.reasonKey));
      return;
    }
    const outcome = applyTool({
      map: this.doc,
      tool: this.tool,
      brush: this.brush,
      dir: this.activeDir,
      x,
      y,
      pendingWire: this.pendingWire,
      forceErase: stroke.forceErase
    });
    this.pendingWire = outcome.pendingWire;
    if (outcome.changed) {
      this.doc = { ...this.doc, ...outcome.map };
      stroke.changed = true;
    }
    this.announce(outcome.messages);
    this.render();
  }

  private announce(messages: ToolMessage[]): void {
    if (messages.length === 0) return;
    this.setStatusText(messages.map((message) => t(message.key, message.params)).join(SEPARATOR_BETWEEN_MESSAGES));
  }

  public render(): void {
    const doc = this.doc;
    const mapWidth = this.mapWidth();
    const mapHeight = this.mapHeight();
    const s = this.tilePx;
    this.lastDrawnTilePx = s;
    // Resizing the canvas resets the context: keep the pixel art sharp at any tile size.
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        this.renderer.drawTile(this.ctx, doc.terrain[y][x], x * s, y * s, s, true, true);
        const item = doc.items[y][x];
        if (item) {
          this.renderer.drawItem(this.ctx, item, x * s, y * s, s);
        }
      }
    }

    for (const ent of doc.entities) {
      this.renderer.drawEntity(this.ctx, ent.type, ent.dir, ent.x * s, ent.y * s, s);
    }

    this.renderer.drawPlayer(
      this.ctx,
      doc.playerStart.x * s,
      doc.playerStart.y * s,
      s,
      doc.playerStart.dir,
      false,
      true
    );

    this.ctx.lineWidth = EDITOR_LINK_LINE_WIDTH;
    for (const link of doc.trapLinks) {
      this.drawLinkLine(EDITOR_TRAP_LINK_COLOR, link.buttonX, link.buttonY, link.trapX, link.trapY, s);
    }
    for (const link of doc.cloneLinks) {
      this.drawLinkLine(EDITOR_CLONE_LINK_COLOR, link.buttonX, link.buttonY, link.clonerX, link.clonerY, s);
    }

    if (this.pendingWire) this.outlineCell(this.pendingWire.x, this.pendingWire.y, EDITOR_WIRE_SOURCE_COLOR, s);
    if (this.hoverCell) this.outlineCell(this.hoverCell.x, this.hoverCell.y, EDITOR_HOVER_OUTLINE_COLOR, s);
    if (this.cursorCell && document.activeElement === this.canvas) {
      this.outlineCell(this.cursorCell.x, this.cursorCell.y, EDITOR_CURSOR_OUTLINE_COLOR, s);
    }
  }

  private outlineCell(x: number, y: number, color: string, s: number): void {
    const inset = EDITOR_OVERLAY_LINE_WIDTH / 2;
    this.ctx.lineWidth = EDITOR_OVERLAY_LINE_WIDTH;
    this.ctx.strokeStyle = color;
    this.ctx.strokeRect(x * s + inset, y * s + inset, s - EDITOR_OVERLAY_LINE_WIDTH, s - EDITOR_OVERLAY_LINE_WIDTH);
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
    const doc = this.doc;
    return {
      id,
      ...(doc.winRule === DEFAULT_WIN_RULE ? {} : { winRule: doc.winRule }),
      ...(doc.ruleset ? { ruleset: doc.ruleset } : {}),
      number: existing ? existing.number : targetLevels.length + 1,
      customTitle: doc.title || t('editor.metadata.default_title.label'),
      customHint: doc.hint,
      ...(doc.author ? { author: doc.author } : {}),
      password: resolveSavedPassword(doc.password, targetLevels),
      timeLimitSeconds: doc.timeLimitSeconds,
      chipsRequired: doc.chipsRequired,
      ...cloneMap(doc)
    };
  }

  // ---------------------------------------------------------------------------
  // Test play, save, import
  // ---------------------------------------------------------------------------

  private async testPlay(): Promise<void> {
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
      password: resolveSavedPassword(this.doc.password, targetPack.levels)
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
      if (this.editRevision === revision) {
        this.cleanDoc = persisted ? cloneDocument(this.doc) : null;
        this.isDirty = !persisted;
      }
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
    if (!el) return;
    el.textContent = msg;
    // One line with an ellipsis: a long message must not resize the stage and refit the canvas.
    el.title = msg;
  }
}
