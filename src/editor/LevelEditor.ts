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

import { storedSolutionWins } from '../generator/SolutionReplay';
import { ConfigBundle, ConfigRegistry } from '../config/ConfigRegistry';
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
import { cc3dLinks, type Cc3dLinks } from '../core/cc3d/cc3dLinks';
import { displayItemId, displayMobId, displayShowsPanels, displayTerrainId } from '../core/cc3d/display';
import { type Cc3dLevel, type Cc3dTerrain, cellAt as cc3dCellAt } from '../core/cc3d/model';
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
import { blockCheckApplies, describeBlockVerdict } from './blockCheck';
import { BlockCheckRunner, BlockCheckWorkerLike } from './blockCheckRunner';
import { EMPTY_TEMPLATE_ID, LevelTemplate, loadLevelTemplates, templateContent } from './levelTemplates';
import {
  GridCell,
  levelStartingAt,
  pickTestCell,
  startCellProblem,
  TEST_FROM_HERE_REASON_KEYS,
  TestFromHereBlock
} from './testFromHere';
import { CheckSummary, summarizeValidation } from './checkSummary';
import { cloneDocument, displayLayersOf, EditorDocument, EditorMetadata, sameDocument, withCc3d } from './editorDocument';
import { CC3D_RULESET, documentFromLevel, levelFromDocument, metadataForDocument } from './editorLevelIo';
import { removeLayerAt, removeMob, setItem, setPanelSide } from './cc3dEdits';
import { describeLinkChanges, diffCc3dLinks, linkOverlayFor, type LinkOverlay, type OverlayArrowKind } from './cc3dLinkOverlay';
import {
  CC3D_CATEGORIES,
  CC3D_CORNERS,
  CC3D_MIRRORS,
  type Cc3dAttribute,
  type Cc3dBrushAttributes,
  type Cc3dCategoryId,
  type Cc3dPaletteEntry,
  cc3dEntriesOf,
  DEFAULT_CC3D_ATTRIBUTES,
  entryDisplay,
  findCc3dEntry,
  needsAttribute
} from './cc3dPalette';
import { dirtyCc3dCells } from './cc3dLayerDiff';
import { CC3D_ROOM_CHOICE_ID, emptyCc3dRoom } from './cc3dRoom';
import {
  applyCc3dTool,
  CC3D_RESIZE_UNAVAILABLE_KEY,
  cc3dContinuesOnDrag,
  cc3dToolBlock,
  nearestSide,
  pickCc3dCell
} from './cc3dTools';
import { EditorHistory } from './editorHistory';
import { EditorKeyAction, getCanvasKeyAction, moveCursor, rotateClockwise, SelectionKeyAction } from './editorKeyboard';
import { layoutModeForWidth } from './editorLayout';
import {
  applyTool,
  Brush,
  continuesOnDrag,
  EDITOR_TOOLS,
  EditorTool,
  leavesLooseButton,
  MESSAGE_START_KEPT,
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
import {
  CellRect,
  clampMoveStep,
  clearRect,
  Clip,
  extractClip,
  moveRect,
  MoveStep,
  pasteClip,
  rectContains,
  rectFromCells,
  SelectionEditResult,
  shiftRect
} from './selectionEdits';
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
  levelMapChanged,
  prepareLevelForSave,
  reconcileSource,
  resolveSavedPassword,
  SaveSource
} from './saveTarget';
import { formatMegabytes, isImportSizeAllowed } from '../ui/importLimits';
import {
  EDITOR_BLOCK_CHECK_TIMEOUT_MS,
  EDITOR_CHECK_DEBOUNCE_MS,
  EDITOR_CC3D_ARROW_HEAD_SPREAD,
  EDITOR_CC3D_ARROW_HEAD_TILE,
  EDITOR_CC3D_BADGE_RADIUS_TILE,
  EDITOR_CC3D_LINK_COLORS,
  EDITOR_CC3D_OVERLAY_ALPHA,
  EDITOR_CC3D_ROOM_HEIGHT,
  EDITOR_CC3D_SIDE_HINT_LINE_WIDTH,
  EDITOR_CC3D_ROOM_WIDTH,
  EDITOR_CC3D_SWATCH_COLORS,
  EDITOR_STATIC_LAYER_MAX_PIXELS,
  EDITOR_STATIC_LAYER_REDRAW_SHARE,
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
  EDITOR_PASTE_PREVIEW_ALPHA,
  EDITOR_SELECTION_DASH,
  EDITOR_SELECTION_DIM_COLOR,
  EDITOR_SELECTION_OUTLINE_COLOR,
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
const CC3D_ATTRS_ID = 'editor-cc3d-attrs';
const LAYERS_SECTION_ID = 'editor-layers-section';
const LAYERS_LIST_ID = 'editor-layers-list';
const CC3D_COLOR_LABEL_KEYS: Record<Cc3dBrushAttributes['color'], string> = {
  red: 'editor.cc3d.color.red',
  green: 'editor.cc3d.color.green',
  blue: 'editor.cc3d.color.blue',
  yellow: 'editor.cc3d.color.yellow'
};
const SIDE_LABEL_KEYS: Record<Direction, string> = {
  N: 'editor.metadata.dir_north.label',
  E: 'editor.metadata.dir_east.label',
  S: 'editor.metadata.dir_south.label',
  W: 'editor.metadata.dir_west.label'
};
const CC3D_ATTRIBUTE_LABEL_KEYS: Record<Exclude<Cc3dAttribute, 'dir'>, string> = {
  color: 'editor.cc3d.attr.color',
  corner: 'editor.cc3d.attr.corner',
  mirror: 'editor.cc3d.attr.mirror'
};

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
  picker: 'editor.layout.tool.picker.label',
  select: 'editor.selection.tool.label'
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
  /** CC3D: Shift was held when the eraser stroke began, so it takes the whole cell. */
  wholeCell: boolean;
}

/** A pointer gesture of the Select tool: drawing a rectangle, or dragging the selected cells. */
type SelectionGesture =
  | { kind: 'select'; anchor: { x: number; y: number } }
  | { kind: 'move'; origin: { x: number; y: number }; step: MoveStep };

/** Cut and copied cells, shared by every level of the session; not the system clipboard. */
let selectionClipboard: Clip | null = null;

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
  /** The configs the page loaded, for the block check worker. */
  getConfigBundle: () => ConfigBundle;
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
  /** True while the New button is asking its questions, so a second click does not open a second dialog. */
  private newLevelPending = false;
  private blockRunner: BlockCheckRunner | null = null;
  /** The status texts around a block check in progress, to restore the line if it is abandoned. */
  private runningBlockCheck: { running: string; base: string } | null = null;
  /** Bumped each time another level is loaded, so a save that outlives its level cannot rebind the editor. */
  private loadGeneration = 0;

  private activeCategory: string = 'terrain';
  private tool: EditorTool = 'brush';
  private brush: Brush = { kind: 'terrain', id: 'wall' };
  private activeDir: Direction = 'S';
  private stroke: Stroke | null = null;
  private pendingWire: PendingWire | null = null;
  /** CC3D palette state: the selected entry, its category and the attributes the choosers hold. */
  private cc3dEntryId: string = 'layer:wall';
  private cc3dCategory: Cc3dCategoryId = 'blockers';
  private cc3dAttrs: Cc3dBrushAttributes = { ...DEFAULT_CC3D_ATTRIBUTES };
  /** Palette icons by display id, so a direction change does not draw them all again. */
  private iconCache = new Map<string, string>();
  /** The animation frame a redraw is waiting for, so pointer moves redraw at most once per frame. */
  private frameRequest: number | null = null;
  /** The links of a CC3D level version, derived once for the overlay. */
  private linksCache: { level: Cc3dLevel; links: Cc3dLinks } | null = null;
  /** The side of the hovered cell nearest the pointer, for the thin wall mode. */
  private hoverSide: Direction = 'N';
  /** The CC3D map drawn off-screen, kept while the document and the tile size stay the same. */
  private staticLayer: { level: Cc3dLevel; tile: number; canvas: HTMLCanvasElement } | null = null;
  /** The cells selected with the Select tool. */
  private selection: CellRect | null = null;
  /** The corner the keyboard selection grows from; null once the cursor moved without Shift. */
  private selectionAnchor: { x: number; y: number } | null = null;
  private selectionGesture: SelectionGesture | null = null;
  /** True while a pasted clip floats at `pasteAnchor`, waiting to be placed. */
  private pasting = false;
  /** Top-left cell of the floating paste: follows the pointer and the keyboard cursor. */
  private pasteAnchor: { x: number; y: number } = { x: 0, y: 0 };
  private hoverCell: { x: number; y: number } | null = null;
  private cursorCell: { x: number; y: number } | null = null;
  /** The last cell the pointer was over, kept after it leaves the canvas so a toolbar button can use it. */
  private lastHoverCell: GridCell | null = null;
  /** What the Test from here button state was computed for, to skip recomputing it on every redraw. */
  private testFromStateKey = '';
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
    // Any edit or load makes a running block check stale.
    this.abortBlockCheck();
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

  /** True when the level being edited is a CC3D one: its cells, not the Epoxy layers, are the map. */
  private isCc3d(): boolean {
    return this.doc.cc3d !== undefined;
  }

  /** The selected CC3D palette entry, or null when the id names none. */
  private cc3dEntry(): Cc3dPaletteEntry | null {
    return findCc3dEntry(this.cc3dEntryId) ?? null;
  }

  /** A new CC3D room: walls around, floor inside, the player start and an exit. */
  private cc3dRoomDocument(): EditorDocument {
    const cc3d = emptyCc3dRoom(EDITOR_CC3D_ROOM_WIDTH, EDITOR_CC3D_ROOM_HEIGHT);
    return {
      ...LevelEditor.emptyDocument(),
      ...displayLayersOf(cc3d),
      cc3d,
      title: t('editor.metadata.default_title.label'),
      timeLimitSeconds: 0,
      chipsRequired: 0,
      ruleset: CC3D_RULESET
    };
  }

  /** A blank level in the grid the game configures. */
  private blankDocument(ruleset: Ruleset | undefined): EditorDocument {
    if (ruleset === CC3D_RULESET) return this.cc3dRoomDocument();
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

  /** A new level that starts from a template: its map and rules, in the editor's default metadata. */
  private templateDocument(template: LevelTemplate): EditorDocument {
    const content = templateContent(template);
    return {
      ...this.blankDocument(undefined),
      ...content.map,
      title: t(template.labelKey),
      winRule: content.winRule,
      ruleset: content.ruleset,
      timeLimitSeconds: content.timeLimitSeconds,
      chipsRequired: content.chipsRequired
    };
  }

  public initBlankMap(options: { packId?: string | null; ruleset?: Ruleset; template?: LevelTemplate } = {}): void {
    this.doc = options.template ? this.templateDocument(options.template) : this.blankDocument(options.ruleset);
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
    this.doc = documentFromLevel(level, this.loadedTexts);
    this.afterDocumentReplaced(options.dirty ?? false);
    return true;
  }

  /** Resets everything that belongs to the previous level once another one is in `doc`. */
  private afterDocumentReplaced(dirty: boolean): void {
    this.loadGeneration++;
    this.blockRunner?.dispose();
    this.history.clear();
    this.coalescer.reset();
    this.stroke = null;
    this.pendingWire = null;
    this.resetSelectionState();
    this.hoverCell = null;
    this.cursorCell = null;
    this.lastHoverCell = null;
    this.zoomOffset = 0;
    this.cleanDoc = dirty ? null : cloneDocument(this.doc);
    this.isDirty = dirty;
    this.syncCc3dChrome();
    this.applyFit();
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.renderCategoryTabs();
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

  /**
   * A new map aimed at a pack. Blank, it takes the rules most of the pack's
   * levels use; from a template, it takes the template's rules. False when the
   * player keeps their work.
   */
  public async newLevelInPack(packId: string | null, template?: LevelTemplate): Promise<boolean> {
    if (!(await this.confirmDiscardIfDirty())) return false;
    this.openNewLevel(packId, template);
    return true;
  }

  /** Opens the new map without asking about unsaved work; the caller has already asked. */
  private openNewLevel(packId: string | null, template?: LevelTemplate, ruleset?: Ruleset): void {
    const pack = packId ? ConfigRegistry.getEditablePacks().find((p) => p.id === packId) : undefined;
    this.initBlankMap({
      packId: pack?.id ?? null,
      ruleset: ruleset ?? (pack ? majorityRuleset(pack.levels) : undefined),
      template
    });
  }

  /**
   * The New button. It first asks about unsaved work, then offers the empty
   * room and the templates. Templates are Epoxy levels: in a pack that is
   * mostly Lynx only the empty room is offered, and the dialog says why. If
   * the templates cannot be loaded the empty room opens, and the status line
   * says so once it is open.
   */
  private async startNewLevel(): Promise<void> {
    if (this.newLevelPending) return;
    this.newLevelPending = true;
    try {
      if (!(await this.confirmDiscardIfDirty())) return;
      const packId = this.source.packId;
      const pack = packId ? ConfigRegistry.getEditablePacks().find((p) => p.id === packId) : undefined;
      const lynxPack = pack !== undefined && majorityRuleset(pack.levels) === LYNX_RULESET;
      const templates = lynxPack ? [] : await loadLevelTemplates();
      if (!templates) {
        this.openNewLevel(packId);
        this.setStatusText(t('editor.template.load_failed'));
        return;
      }
      const choice = await choiceDialog({
        title: t('editor.template.title'),
        message: t(lynxPack ? 'editor.template.lynx_only' : 'editor.template.message'),
        options: [
          { id: EMPTY_TEMPLATE_ID, label: t('editor.template.empty.label'), primary: true },
          { id: CC3D_ROOM_CHOICE_ID, label: t('editor.template.cc3d_room.label') },
          ...templates.map((template) => ({ id: template.id, label: t(template.labelKey) }))
        ],
        cancelLabel: t('app.confirm.cancel.action')
      });
      if (choice === null) return;
      if (choice === CC3D_ROOM_CHOICE_ID) {
        this.openNewLevel(packId, undefined, CC3D_RULESET);
        return;
      }
      this.openNewLevel(packId, templates.find((candidate) => candidate.id === choice));
    } finally {
      this.newLevelPending = false;
    }
  }

  public buildUI(): void {
    this.iconCache.clear();
    this.staticLayer = null;
    this.playerIconUrl = this.renderer.renderIconToDataUrl('player', EDITOR_PLAYER_BRUSH_ID);
    this.syncCc3dChrome();
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
    this.syncCc3dChrome();
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.refreshContext();
    this.syncMetadataInputs();
    this.updateCanvasLabel();
    this.updateCheckBadge(this.lastCheck);
    this.testFromStateKey = '';
    this.updateTestFromState();
    this.applyFit();
  }

  // ---------------------------------------------------------------------------
  // Palette
  // ---------------------------------------------------------------------------

  private renderCategoryTabs(): void {
    const container = byId('editor-category-tabs');
    if (!container) return;
    container.innerHTML = '';
    if (this.isCc3d()) {
      this.renderCc3dCategoryTabs(container);
      return;
    }

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

  private renderCc3dCategoryTabs(container: HTMLElement): void {
    const active = CC3D_CATEGORIES.find((cat) => cat.id === this.cc3dCategory);
    byId('editor-palette-grid')?.setAttribute('aria-label', active ? t(active.labelKey) : '');
    for (const cat of CC3D_CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(this.cc3dCategory === cat.id));
      btn.className = `editor-tab-btn ${this.cc3dCategory === cat.id ? 'active' : ''}`;
      btn.textContent = t(cat.labelKey);
      btn.addEventListener('click', () => {
        this.cc3dCategory = cat.id;
        this.renderCategoryTabs();
        this.renderPaletteItems();
      });
      container.appendChild(btn);
    }
  }

  /** A palette icon, drawn once per display id until the graphics style changes. */
  private cachedIcon(kind: 'tile' | 'item' | 'entity' | 'player', id: string): string {
    const key = `${kind}|${id}`;
    let url = this.iconCache.get(key);
    if (url === undefined) {
      url = this.renderer.renderIconToDataUrl(kind, id);
      this.iconCache.set(key, url);
    }
    return url;
  }

  /** The definition behind a display id: creatures of the shared rules first, else the tile configs (CC3D creatures live there). */
  private cc3dDefinition(kind: string, id: string): { i18nKey: string } | undefined {
    if (kind === 'entity') return ConfigRegistry.getEntityDef(id) ?? ConfigRegistry.getTile(id);
    return ConfigRegistry.getTile(id);
  }

  /** The name of a CC3D palette entry: its own key when it has one, else the name of the id it is drawn with. */
  private cc3dEntryLabel(entry: Cc3dPaletteEntry, display: { kind: string; id: string }): string {
    if (entry.labelKey) return t(entry.labelKey);
    const definition = this.cc3dDefinition(display.kind, display.id);
    return definition ? t(definition.i18nKey) : display.id;
  }

  private renderCc3dPaletteItems(container: HTMLElement): void {
    for (const entry of cc3dEntriesOf(this.cc3dCategory)) {
      const display = entryDisplay(entry, this.cc3dAttrs, this.activeDir);
      container.appendChild(
        this.createPaletteButton(
          this.cc3dEntryLabel(entry, display),
          this.cachedIcon(display.kind, display.id),
          entry.id === this.cc3dEntryId,
          { available: true },
          () => this.selectCc3dEntry(entry)
        )
      );
    }
    this.renderCc3dAttributes();
  }

  /** Choosing a CC3D entry puts the brush back in hand (fill and select do not exist for CC3D levels). */
  private selectCc3dEntry(entry: Cc3dPaletteEntry): void {
    this.cc3dEntryId = entry.id;
    this.cc3dCategory = entry.category;
    if (this.tool !== 'brush') {
      this.tool = 'brush';
      this.resetSelectionState();
      this.updateToolButtons();
    }
    this.updateCanvasLabel();
    this.renderCategoryTabs();
    this.renderPaletteItems();
    if (entry.action === 'panel') this.setStatusText(t('editor.cc3d.status.panel_mode'));
    this.render();
  }

  /** A small button of the attribute choosers: an icon, a swatch or a word, pressed when it is the choice. */
  private attributeButton(label: string, title: string, pressed: boolean, onClick: () => void, iconUrl = '', swatch = ''): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn small editor-cc3d-choice';
    btn.setAttribute('aria-pressed', String(pressed));
    btn.title = title;
    btn.setAttribute('aria-label', title);
    if (swatch) {
      const dot = document.createElement('span');
      dot.className = 'editor-cc3d-swatch';
      dot.style.backgroundColor = swatch;
      btn.appendChild(dot);
    }
    if (iconUrl) {
      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = '';
      img.className = 'palette-item-icon';
      btn.appendChild(img);
    }
    if (label) btn.appendChild(document.createTextNode(label));
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** The choosers of the attributes the selected entry needs: colour, ice corner, reflector mirror. */
  private renderCc3dAttributes(): void {
    const host = byId(CC3D_ATTRS_ID);
    if (!host) return;
    host.innerHTML = '';
    const entry = this.cc3dEntry();
    const needed = (['color', 'corner', 'mirror'] as const).filter((attribute) => entry !== null && needsAttribute(entry, attribute));
    host.classList.toggle('hidden', !this.isCc3d() || entry === null || needed.length === 0);
    if (!entry) return;
    for (const attribute of needed) {
      const group = document.createElement('div');
      group.className = 'editor-cc3d-attr-group';
      group.setAttribute('role', 'group');
      const caption = t(CC3D_ATTRIBUTE_LABEL_KEYS[attribute]);
      group.setAttribute('aria-label', caption);
      const title = document.createElement('span');
      title.className = 'editor-dir-label';
      title.textContent = caption;
      group.appendChild(title);
      if (attribute === 'color') {
        for (const color of Object.keys(CC3D_COLOR_LABEL_KEYS) as Array<Cc3dBrushAttributes['color']>) {
          const name = t(CC3D_COLOR_LABEL_KEYS[color]);
          group.appendChild(
            this.attributeButton(name, name, this.cc3dAttrs.color === color, () => this.setCc3dAttribute({ color }), '', EDITOR_CC3D_SWATCH_COLORS[color])
          );
        }
      } else if (attribute === 'corner') {
        for (const corner of CC3D_CORNERS) {
          const display = entryDisplay(entry, { ...this.cc3dAttrs, corner }, this.activeDir);
          const name = this.cc3dEntryLabel(entry, display);
          const pressed = this.cc3dAttrs.corner[0] === corner[0] && this.cc3dAttrs.corner[1] === corner[1];
          group.appendChild(this.attributeButton('', name, pressed, () => this.setCc3dAttribute({ corner }), this.cachedIcon(display.kind, display.id)));
        }
      } else {
        for (const mirror of CC3D_MIRRORS) {
          const display = entryDisplay(entry, { ...this.cc3dAttrs, mirror }, this.activeDir);
          const name = this.cc3dEntryLabel(entry, display);
          group.appendChild(
            this.attributeButton('', name, this.cc3dAttrs.mirror === mirror, () => this.setCc3dAttribute({ mirror }), this.cachedIcon(display.kind, display.id))
          );
        }
      }
      host.appendChild(group);
    }
  }

  private setCc3dAttribute(patch: Partial<Cc3dBrushAttributes>): void {
    this.cc3dAttrs = { ...this.cc3dAttrs, ...patch };
    this.renderPaletteItems();
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
    if (this.isCc3d()) {
      this.renderCc3dPaletteItems(container);
      this.updateSwitchEngineButton();
      return;
    }
    byId(CC3D_ATTRS_ID)?.classList.add('hidden');
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
    if (this.tool === 'eraser' || this.tool === 'picker' || this.tool === 'select' || (this.tool === 'fill' && brush.kind !== 'terrain')) {
      this.tool = 'brush';
      this.resetSelectionState();
      this.render();
      this.updateToolButtons();
    }
    this.updateCanvasLabel();
    this.renderPaletteItems();
    if (brush.kind === 'wire_trap' || brush.kind === 'wire_cloner') {
      this.setStatusText(t('editor.palette.status.wire_select_source'));
    }
  }

  private updateSwitchEngineButton(): void {
    byId('editor-switch-epoxy-btn')?.classList.toggle('hidden', this.isCc3d() || !this.hasUnavailableItems());
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
        this.afterDirectionChange();
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
    this.afterDirectionChange();
  }

  /** The direction control changed: the buttons follow it, and the CC3D icons that show a direction are redrawn. */
  private afterDirectionChange(): void {
    this.updateDirButtons();
    if (!this.isCc3d()) return;
    this.renderPaletteItems();
    this.render();
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

  /**
   * Brings the chrome that depends on the kind of level in line with the document: on a CC3D level the
   * fill and select tools and the resize controls say why they do nothing, the eraser describes its two
   * modes, and the fields that do not apply (win rule, chips) give way to the layers of the cursor cell.
   */
  private syncCc3dChrome(): void {
    const cc3d = this.isCc3d();
    if (cc3d && cc3dToolBlock(this.tool)) {
      this.tool = 'brush';
      this.resetSelectionState();
    }
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'))) {
      const tool = btn.dataset.tool as EditorTool;
      const blocked = cc3d ? cc3dToolBlock(tool) : null;
      const defaultTitleKey = btn.dataset.i18nTitle ?? '';
      btn.classList.toggle('is-unavailable', blocked !== null);
      if (blocked) {
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('aria-description', t(blocked));
        btn.title = t(blocked);
        continue;
      }
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('aria-description');
      if (cc3d && tool === 'eraser') btn.title = t('editor.cc3d.eraser.title');
      else if (defaultTitleKey) btn.title = t(defaultTitleKey);
    }
    const reason = t(CC3D_RESIZE_UNAVAILABLE_KEY);
    for (const id of ['editor-size-width', 'editor-size-height', 'editor-size-apply-btn']) {
      const el = byId<HTMLButtonElement | HTMLInputElement>(id);
      if (!el) continue;
      if (el instanceof HTMLInputElement) el.readOnly = cc3d;
      el.classList.toggle('is-unavailable', cc3d);
      if (cc3d) {
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('aria-description', reason);
        el.title = reason;
      } else {
        el.removeAttribute('aria-disabled');
        el.removeAttribute('aria-description');
        el.removeAttribute('title');
      }
    }
    for (const id of ['editor-field-winrule', 'editor-field-chips']) byId(id)?.classList.toggle('hidden', cc3d);
    byId(LAYERS_SECTION_ID)?.classList.toggle('hidden', !cc3d);
    this.updateToolButtons();
    this.refreshLayersList();
  }

  public setTool(tool: EditorTool): void {
    if (tool === this.tool) return;
    const block = this.isCc3d() ? cc3dToolBlock(tool) : null;
    if (block) {
      this.setStatusText(t(block));
      return;
    }
    this.cancelPendingWire(false);
    this.tool = tool;
    // A selection or a floating paste belongs to the Select tool.
    this.resetSelectionState();
    this.updateToolButtons();
    this.updateCanvasLabel();
    this.setStatusText(t('editor.layout.status.tool_changed', { tool: this.toolLabel(tool) }));
    this.render();
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
      case 'test_from_here':
        void this.testFromHere();
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
        if (this.cancelPaste() || this.dropSelection(true)) break;
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
      void this.startNewLevel();
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

    byId('editor-test-from-btn')?.addEventListener('click', () => {
      void this.testFromHere();
    });

    for (const tool of EDITOR_TOOLS) {
      document.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)?.addEventListener('click', () => {
        this.setTool(tool);
      });
    }

    byId('editor-validate-btn')?.addEventListener('click', () => {
      const compiled = this.exportCompiledLevel();
      const report = LevelValidator.validate(compiled, storedSolutionWins);
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
      void this.appendBlocksLine(compiled);
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
      this.setCheck(summarizeValidation(LevelValidator.validate(this.exportCompiledLevel(), storedSolutionWins)));
    }, EDITOR_CHECK_DEBOUNCE_MS);
  }

  /**
   * Adds the block puzzle verdict to the status line after an explicit Check.
   * The exhaustive search runs in a worker, only on request, and never for the
   * Lynx rules. A line that nothing judges (`none`) leaves the status as it was,
   * and a result that arrives after the level or the status changed is dropped.
   */
  private async appendBlocksLine(compiled: CompiledLevel): Promise<void> {
    if (!blockCheckApplies(compiled)) return;
    const el = document.getElementById('editor-status-bar');
    if (!el) return;
    const separator = t('validator.status.issue_separator.label');
    const base = el.textContent ?? '';
    const running = `${base}${separator}${t('editor.check.blocks.running')}`;
    this.runningBlockCheck = { running, base };
    const generation = this.loadGeneration;
    const revision = this.editRevision;
    this.setStatusText(running);
    const verdict = await this.blockCheckRunner().check(compiled);
    if (this.runningBlockCheck?.running === running) this.runningBlockCheck = null;
    if (verdict === null || generation !== this.loadGeneration || revision !== this.editRevision) return;
    if (el.textContent !== running) return;
    const line = describeBlockVerdict(verdict);
    this.setStatusText(line ? `${base}${separator}${t(line.key, line.params)}` : base);
  }

  /** Cancels the block check in progress and puts the status line back as it was before "checking". */
  private abortBlockCheck(): void {
    const running = this.runningBlockCheck;
    if (!running) return;
    this.runningBlockCheck = null;
    this.blockRunner?.cancel();
    const el = document.getElementById('editor-status-bar');
    if (el && el.textContent === running.running) this.setStatusText(running.base);
  }

  /** The editor view is left: stops the check and releases the idle worker. */
  public onLeave(): void {
    this.abortBlockCheck();
    this.blockRunner?.dispose();
  }

  private blockCheckRunner(): BlockCheckRunner {
    this.blockRunner ??= new BlockCheckRunner({
      createWorker:
        typeof Worker === 'undefined'
          ? null
          : () =>
              new Worker(new URL('../workers/blockCheck.worker.ts', import.meta.url), {
                type: 'module'
              }) as unknown as BlockCheckWorkerLike,
      getBundle: () => this.hooks.getConfigBundle(),
      timeoutMs: EDITOR_BLOCK_CHECK_TIMEOUT_MS
    });
    return this.blockRunner;
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
    return metadataForDocument(doc, next);
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
    const cc3d = this.isCc3d();
    // A CC3D level keeps its engine: the laser tiles its display layers hold and its win rule do not make it Epoxy.
    const lynxLocked = !cc3d && requiresEpoxyRules(this.doc.winRule, hasLaserContent(this.doc));
    if (lynxLocked) this.doc = { ...this.doc, ruleset: undefined };
    rulesetEl.value = this.doc.ruleset ?? DEFAULT_RULESET;
    // The engine of a level never changes into another one here: a CC3D level shows its own engine
    // read-only, and the other levels cannot take the CC3D option.
    rulesetEl.disabled = cc3d;
    for (const option of Array.from(rulesetEl.options)) {
      if (option.value === CC3D_RULESET) {
        option.disabled = !cc3d;
        option.title = cc3d ? '' : t('editor.metadata.ruleset_cc3d_unavailable.label');
        continue;
      }
      option.disabled = cc3d || (option.value === LYNX_RULESET && lynxLocked);
      option.title = cc3d
        ? t('editor.metadata.ruleset_cc3d_locked.label')
        : option.value === LYNX_RULESET && lynxLocked
          ? t('editor.metadata.ruleset_lynx_unavailable.label')
          : '';
    }
    if (cc3d) rulesetEl.setAttribute('aria-description', t('editor.metadata.ruleset_cc3d_locked.label'));
    else rulesetEl.removeAttribute('aria-description');
    const description = byId('editor-ruleset-description');
    if (description) {
      description.textContent = t(
        cc3d
          ? 'editor.layout.rules.description.cc3d'
          : editableRulesetOf(this.doc.ruleset) === LYNX_RULESET
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
    if (this.isCc3d()) {
      this.setStatusText(t(CC3D_RESIZE_UNAVAILABLE_KEY));
      this.syncSizeInputs();
      return;
    }
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
      this.resetSelectionState();
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
    this.resetSelectionState();
    this.cursorCell = null;
    this.syncCc3dChrome();
    this.applyFit();
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.updateContextTitle();
    this.updateCanvasLabel();
    this.renderCategoryTabs();
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

  /** The picker on a CC3D level: the creature or block, else the item, else the top layer, with its attributes and facing. */
  private pickAtCc3d(cc3d: Cc3dLevel, x: number, y: number): void {
    const picked = pickCc3dCell(cc3d, x, y);
    const entry = picked ? findCc3dEntry(picked.entryId) : undefined;
    if (!picked || !entry) return;
    this.cc3dEntryId = entry.id;
    this.cc3dCategory = entry.category;
    this.cc3dAttrs = { ...this.cc3dAttrs, ...picked.attrs };
    if (picked.dir) {
      this.activeDir = picked.dir;
      this.updateDirButtons();
    }
    // The picker hands the brush back once it has taken something.
    if (this.tool === 'picker') {
      this.tool = 'brush';
      this.updateToolButtons();
      this.updateCanvasLabel();
    }
    this.renderCategoryTabs();
    this.renderPaletteItems();
    const display = entryDisplay(entry, this.cc3dAttrs, this.activeDir);
    this.setStatusText(t('editor.palette.status.picked.label', { name: this.cc3dEntryLabel(entry, display) }));
    this.render();
  }

  private pickAt(x: number, y: number): void {
    if (this.doc.cc3d) {
      this.pickAtCc3d(this.doc.cc3d, x, y);
      return;
    }
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

  /**
   * The side of a cell a pointer is nearest to, for the thin wall mode of a CC3D level.
   * The pointer position is read inside the cell, from 0 (west, north) to 1 (east, south).
   */
  private pointerSide(clientX: number, clientY: number, cell: { x: number; y: number }): Direction {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return this.activeDir;
    const fx = ((clientX - rect.left) / rect.width) * this.mapWidth() - cell.x;
    const fy = ((clientY - rect.top) / rect.height) * this.mapHeight() - cell.y;
    return nearestSide(fx, fy);
  }

  /** Redraws on the next animation frame; pointer moves that arrive before it share that one redraw. */
  private requestRender(): void {
    if (typeof requestAnimationFrame !== 'function') {
      this.render();
      return;
    }
    if (this.frameRequest !== null) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = null;
      this.render();
    });
  }

  private setHover(cell: { x: number; y: number } | null): void {
    const same = this.hoverCell?.x === cell?.x && this.hoverCell?.y === cell?.y;
    this.hoverCell = cell;
    if (cell) this.lastHoverCell = cell;
    this.setCoordsText(cell ? t('editor.palette.status.coords', { x: cell.x, y: cell.y }) : NO_COORDS_TEXT);
    if (!same) this.requestRender();
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

      if (this.pasting) {
        // Any button other than the primary one cancels a floating paste.
        if (ev.button === 0) this.placePaste(cell);
        else this.cancelPaste();
        return;
      }
      if (this.tool === 'select' && (ev.button === 2 || ev.button === POINTER_ERASER_BUTTON)) {
        // The Select tool has no eraser: the secondary button only drops the selection.
        this.dropSelection(true);
        return;
      }
      if (ev.altKey || ev.button === 1 || this.tool === 'picker') {
        this.pickAt(cell.x, cell.y);
        return;
      }
      if (this.tool === 'select' && ev.button === 0) {
        this.beginSelectionGesture(cell);
        return;
      }

      this.hoverSide = this.pointerSide(ev.clientX, ev.clientY, cell);
      this.beginStroke(ev.button === 2 || ev.button === POINTER_ERASER_BUTTON, ev.shiftKey);
      this.applyAt(cell.x, cell.y, this.hoverSide);
      this.refreshLayersList();
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      const cell = this.cellAt(ev.clientX, ev.clientY);
      if (cell && this.pasting) this.pasteAnchor = cell;
      if (cell) {
        const side = this.pointerSide(ev.clientX, ev.clientY, cell);
        if (side !== this.hoverSide) {
          this.hoverSide = side;
          // The thin wall mode shows which side a click would toggle.
          if (this.isCc3d() && this.cc3dEntry()?.action === 'panel') this.requestRender();
        }
      }
      this.setHover(cell);
      if (cell && this.selectionGesture) this.updateSelectionGesture(cell);
      if (cell && this.stroke && this.continuesOnDrag(this.stroke.forceErase)) {
        this.applyAt(cell.x, cell.y, this.hoverSide, true);
      }
    });

    this.canvas.addEventListener('pointerleave', () => {
      if (!this.stroke) this.setHover(null);
    });

    const stopPainting = (): void => {
      this.endStroke();
      this.endSelectionGesture(true);
    };
    window.addEventListener('pointerup', stopPainting);
    window.addEventListener('pointercancel', () => {
      this.endStroke();
      this.endSelectionGesture(false);
    });

    this.canvas.addEventListener('keydown', (ev) => {
      const action = getCanvasKeyAction(ev);
      if (!action) return;
      ev.preventDefault();
      if (action.kind === 'move') {
        const from = this.cursorCell ?? { x: this.doc.playerStart.x, y: this.doc.playerStart.y };
        this.cursorCell = moveCursor(from, action.dx, action.dy, this.mapWidth(), this.mapHeight());
        if (this.pasting) this.pasteAnchor = this.cursorCell;
        if (this.tool === 'select' && !this.pasting) this.moveSelectionCursor(from, this.cursorCell, ev.shiftKey);
        this.setCoordsText(t('editor.palette.status.coords', { x: this.cursorCell.x, y: this.cursorCell.y }));
        this.refreshLayersList();
        this.render();
        return;
      }
      // A pointer stroke is running: its own history step must not be split by a key press.
      if (this.stroke) return;
      const cell = this.cursorCell ?? { x: this.doc.playerStart.x, y: this.doc.playerStart.y };
      this.cursorCell = cell;
      if (this.pasting) {
        this.placePaste(cell);
        return;
      }
      if (this.tool === 'select') {
        this.selectCell(cell);
        return;
      }
      if (this.tool === 'picker') {
        this.pickAt(cell.x, cell.y);
        return;
      }
      // The keyboard has no pointer: the thin wall side is the direction control, and Shift on the eraser takes the whole cell.
      this.beginStroke(false, ev.shiftKey);
      this.applyAt(cell.x, cell.y, this.activeDir);
      this.endStroke();
    });
    this.canvas.addEventListener('focus', () => this.render());
    this.canvas.addEventListener('blur', () => this.render());
  }

  private beginStroke(forceErase: boolean, wholeCell = false): void {
    this.stroke = { base: cloneDocument(this.doc), changed: false, forceErase, wholeCell };
  }

  /** True when holding the pointer down and moving keeps acting, for the level being edited. */
  private continuesOnDrag(forceErase: boolean): boolean {
    return this.isCc3d()
      ? cc3dContinuesOnDrag(this.tool, this.cc3dEntry(), forceErase)
      : continuesOnDrag(this.tool, this.brush, forceErase);
  }

  /** A stroke that changed the level is one history step; one that changed nothing leaves no trace. */
  private endStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    if (!stroke.changed) return;
    this.recordChange(stroke.base);
    this.announceLinkChanges(stroke.base);
  }

  /** After an edit of a CC3D level: says in the status line when a link that existed now points elsewhere. */
  private announceLinkChanges(base: EditorDocument): void {
    const before = base.cc3d;
    const after = this.doc.cc3d;
    if (!before || !after) return;
    this.announce(describeLinkChanges(diffCc3dLinks(before, after)));
  }

  /** The name of a layer, item or creature of a CC3D cell, from the display id it is drawn with. */
  private cc3dPartName(kind: 'tile' | 'entity', draw: () => string): string {
    let id = '';
    try {
      id = draw();
    } catch {
      // A stored level that lacks an attribute its kind needs has no display id: the list shows the raw kind.
      return '';
    }
    const definition = this.cc3dDefinition(kind, id);
    return definition ? t(definition.i18nKey) : id;
  }

  /** One row of the layers list: a name and its remove button. */
  private layerRow(name: string, onRemove: (() => void) | null): HTMLLIElement {
    const row = document.createElement('li');
    row.className = 'editor-layer-row';
    const label = document.createElement('span');
    label.className = 'editor-layer-name';
    label.textContent = name;
    row.appendChild(label);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn small';
    btn.textContent = t('editor.cc3d.layers.remove.action');
    btn.setAttribute('aria-label', t('editor.cc3d.layers.remove.aria', { name }));
    if (onRemove) btn.addEventListener('click', onRemove);
    else btn.disabled = true;
    row.appendChild(btn);
    return row;
  }

  /**
   * The read-only list of what the cursor cell holds, bottom layer first: terrain layers, thin walls, the
   * item and the creature. Each has a button that removes just that thing, as one undoable edit.
   */
  private refreshLayersList(): void {
    const list = byId(LAYERS_LIST_ID);
    if (!list) return;
    list.innerHTML = '';
    const level = this.doc.cc3d;
    const at = this.cursorCell;
    const cell = level && at ? cc3dCellAt(level, at.x, at.y) : undefined;
    const caption = byId('editor-layers-cell');
    if (caption) caption.textContent = at && cell ? t('editor.cc3d.layers.cell', { x: at.x, y: at.y }) : t('editor.cc3d.layers.none');
    if (!level || !at || !cell) return;
    cell.terrain.forEach((layer: Cc3dTerrain, index) => {
      const name =
        this.cc3dPartName('tile', () => displayTerrainId({ terrain: [layer], panels: [], item: null })) || layer.kind;
      const plainBase = index === 0 && layer.kind === 'floor';
      list.appendChild(this.layerRow(name, plainBase ? null : () => this.commitCc3dEdit(removeLayerAt(level, at.x, at.y, index))));
    });
    for (const side of cell.panels) {
      const name = t('editor.cc3d.layers.panel', { side: t(SIDE_LABEL_KEYS[side]) });
      list.appendChild(this.layerRow(name, () => this.commitCc3dEdit(setPanelSide(level, at.x, at.y, side, false))));
    }
    if (cell.item) {
      const item = cell.item;
      const name = this.cc3dPartName('tile', () => displayItemId(item) ?? '') || item.kind;
      list.appendChild(this.layerRow(name, () => this.commitCc3dEdit(setItem(level, at.x, at.y, null))));
    }
    const mob = level.mobs.find((candidate) => candidate.x === at.x && candidate.y === at.y);
    if (mob) {
      const name = this.cc3dPartName('entity', () => displayMobId(mob)) || mob.kind;
      list.appendChild(this.layerRow(name, () => this.commitCc3dEdit(removeMob(level, at.x, at.y))));
    }
  }

  /** An edit of the CC3D level made outside a stroke (the layers list): one history step. */
  private commitCc3dEdit(next: Cc3dLevel): void {
    const before = this.doc.cc3d;
    if (!before || next === before || this.stroke) return;
    const base = cloneDocument(this.doc);
    this.doc = withCc3d(this.doc, next);
    this.recordChange(base);
    this.announceLinkChanges(base);
    this.render();
  }

  /** Makes a change that already sits in `doc` one history step, with `base` as the document before it. */
  private recordChange(base: EditorDocument): void {
    this.history.push(base);
    this.coalescer.reset();
    this.isDirty = true;
    this.updateUndoRedoButtons();
    this.syncRulesetInput();
    this.updateSwitchEngineButton();
    this.refreshLayersList();
    this.scheduleCheck();
  }

  /** Applies the active tool to a CC3D cell as part of the running stroke. */
  private applyCc3dAt(stroke: Stroke, cc3d: Cc3dLevel, x: number, y: number, side: Direction, deferRender: boolean): void {
    const outcome = applyCc3dTool({
      level: cc3d,
      tool: this.tool,
      entry: this.cc3dEntry(),
      attrs: this.cc3dAttrs,
      dir: this.activeDir,
      x,
      y,
      side,
      forceErase: stroke.forceErase,
      wholeCell: stroke.wholeCell
    });
    if (outcome.changed) {
      this.doc = withCc3d(this.doc, outcome.level);
      stroke.changed = true;
    }
    this.announce(outcome.messages);
    if (deferRender) this.requestRender();
    else this.render();
  }

  /**
   * Applies the active tool to a cell as part of the running stroke. `side` is the side of the cell a
   * CC3D thin wall acts on; `deferRender` redraws on the next frame (pointer moves) rather than at once.
   */
  private applyAt(x: number, y: number, side: Direction = this.activeDir, deferRender = false): void {
    const stroke = this.stroke;
    if (!stroke) return;
    if (this.doc.cc3d) {
      this.applyCc3dAt(stroke, this.doc.cc3d, x, y, side, deferRender);
      return;
    }
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
    if (deferRender) this.requestRender();
    else this.render();
  }

  private announce(messages: ToolMessage[]): void {
    if (messages.length === 0) return;
    this.setStatusText(messages.map((message) => t(message.key, message.params)).join(SEPARATOR_BETWEEN_MESSAGES));
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /** Forgets the selection, the gesture and the floating paste; the clipboard stays. */
  private resetSelectionState(): void {
    this.selection = null;
    this.selectionAnchor = null;
    this.selectionGesture = null;
    this.pasting = false;
  }

  /** Drops the selection; says so when asked. Returns whether there was one. */
  private dropSelection(announce: boolean): boolean {
    if (!this.selection) return false;
    this.selection = null;
    this.selectionAnchor = null;
    this.selectionGesture = null;
    if (announce) this.setStatusText(t('editor.selection.status.dropped'));
    this.render();
    return true;
  }

  /** Cancels a floating paste. Returns whether there was one. */
  private cancelPaste(): boolean {
    if (!this.pasting) return false;
    this.pasting = false;
    this.setStatusText(t('editor.selection.status.paste_cancelled'));
    this.render();
    return true;
  }

  private announceSelectionSize(): void {
    if (!this.selection) return;
    this.setStatusText(t('editor.selection.status.size', { width: this.selection.width, height: this.selection.height }));
  }

  /** Selects the single cell under the keyboard cursor. */
  private selectCell(cell: { x: number; y: number }): void {
    this.selection = rectFromCells(cell, cell, this.mapWidth(), this.mapHeight());
    this.selectionAnchor = cell;
    this.announceSelectionSize();
    this.render();
  }

  /** The keyboard cursor moved while the Select tool is active: with Shift the selection grows from its anchor. */
  private moveSelectionCursor(from: { x: number; y: number }, to: { x: number; y: number }, extend: boolean): void {
    if (!extend) {
      this.selectionAnchor = null;
      return;
    }
    const anchor = this.selection && this.selectionAnchor ? this.selectionAnchor : from;
    this.selectionAnchor = anchor;
    this.selection = rectFromCells(anchor, to, this.mapWidth(), this.mapHeight());
    this.announceSelectionSize();
  }

  private beginSelectionGesture(cell: { x: number; y: number }): void {
    if (this.selection && rectContains(this.selection, cell.x, cell.y)) {
      this.selectionGesture = { kind: 'move', origin: cell, step: { dx: 0, dy: 0 } };
    } else {
      this.selectionGesture = { kind: 'select', anchor: cell };
      this.selection = rectFromCells(cell, cell, this.mapWidth(), this.mapHeight());
      this.selectionAnchor = cell;
    }
    this.render();
  }

  private updateSelectionGesture(cell: { x: number; y: number }): void {
    const gesture = this.selectionGesture;
    if (!gesture) return;
    if (gesture.kind === 'select') {
      this.cursorCell = cell;
      this.selection = rectFromCells(gesture.anchor, cell, this.mapWidth(), this.mapHeight());
    } else if (this.selection) {
      gesture.step = clampMoveStep(
        this.selection,
        cell.x - gesture.origin.x,
        cell.y - gesture.origin.y,
        this.mapWidth(),
        this.mapHeight()
      );
    }
    this.render();
  }

  /** Ends a pointer gesture: a drawn rectangle stays selected, a dragged one is moved when `apply` is set. */
  private endSelectionGesture(apply: boolean): void {
    const gesture = this.selectionGesture;
    if (!gesture) return;
    this.selectionGesture = null;
    if (gesture.kind === 'select') {
      this.announceSelectionSize();
    } else if (apply && this.selection && (gesture.step.dx !== 0 || gesture.step.dy !== 0)) {
      this.moveSelectionBy(gesture.step.dx, gesture.step.dy);
    }
    this.render();
  }

  /** Puts a selection edit in the document as one history step. Returns whether anything changed. */
  private commitSelectionEdit(result: SelectionEditResult): boolean {
    if (!result.changed) return false;
    const before = this.doc;
    this.doc = { ...this.doc, ...result.map };
    this.recordChange(before);
    this.render();
    return true;
  }

  /** The status messages that follow a selection edit: the links it dropped and the entries it skipped. */
  private selectionAftermath(result: SelectionEditResult): ToolMessage[] {
    const messages: ToolMessage[] = [];
    if (result.droppedLinks > 0) messages.push({ key: 'editor.selection.status.links_dropped', params: { count: result.droppedLinks } });
    if (result.skipped > 0) messages.push({ key: 'editor.selection.status.paste_skipped', params: { count: result.skipped } });
    if (result.borderSkipped > 0) messages.push({ key: 'editor.selection.status.border_skipped', params: { count: result.borderSkipped } });
    return messages;
  }

  /**
   * Runs a selection key chord. Returns whether the chord was taken, so the
   * application leaves the browser's own handling alone only then.
   */
  public handleSelectionAction(action: SelectionKeyAction): boolean {
    // Selections and pastes are Epoxy and Lynx edits: a CC3D level has none, and the browser keeps the chord.
    if (this.isCc3d() || this.stroke || this.selectionGesture) return false;
    if (action.kind === 'paste') return this.beginPaste();
    // While a paste floats, only the paste itself acts: Delete and Alt+Arrow are ignored.
    if (this.pasting && (action.kind === 'clear' || action.kind === 'move')) return true;
    if (!this.selection) {
      if (this.tool === 'select') this.announce([{ key: 'editor.selection.status.none' }]);
      return false;
    }
    switch (action.kind) {
      case 'copy':
        this.copySelection(false);
        break;
      case 'cut':
        this.copySelection(true);
        break;
      case 'clear':
        this.clearSelectedCells();
        break;
      case 'move':
        this.moveSelectionBy(action.dx, action.dy);
        break;
    }
    return true;
  }

  private copySelection(cut: boolean): void {
    const rect = this.selection;
    if (!rect) return;
    selectionClipboard = extractClip(this.doc, rect, cut);
    const size = { width: rect.width, height: rect.height };
    if (!cut) {
      const withStart = rectContains(rect, this.doc.playerStart.x, this.doc.playerStart.y);
      this.announce([{ key: withStart ? 'editor.selection.status.copied_no_start' : 'editor.selection.status.copied', params: size }]);
      return;
    }
    const result = clearRect(this.doc, rect);
    this.commitSelectionEdit(result);
    this.announce([
      { key: result.playerStartKept ? 'editor.selection.status.cut_start_kept' : 'editor.selection.status.cut', params: size },
      ...this.selectionAftermath(result)
    ]);
  }

  private clearSelectedCells(): void {
    const rect = this.selection;
    if (!rect) return;
    const result = clearRect(this.doc, rect);
    if (!this.commitSelectionEdit(result)) {
      this.announce([{ key: result.playerStartKept ? MESSAGE_START_KEPT : 'editor.selection.status.unchanged' }]);
      return;
    }
    this.announce([
      { key: 'editor.selection.status.cleared', params: { width: rect.width, height: rect.height } },
      ...this.selectionAftermath(result),
      ...(result.playerStartKept ? [{ key: MESSAGE_START_KEPT }] : [])
    ]);
  }

  private moveSelectionBy(dx: number, dy: number): void {
    const rect = this.selection;
    if (!rect) return;
    const result = moveRect(this.doc, rect, dx, dy);
    if (!this.commitSelectionEdit(result)) {
      // Nothing to move but the outline: it still follows the key, with no history step.
      if (result.rect && (result.rect.x !== rect.x || result.rect.y !== rect.y)) {
        this.selection = result.rect;
        this.selectionAnchor = null;
        this.render();
      }
      return;
    }
    this.selection = result.rect;
    this.selectionAnchor = null;
    this.announce([{ key: 'editor.selection.status.moved' }, ...this.selectionAftermath(result)]);
    this.render();
  }

  /** Starts a floating paste of the clipboard at the cursor or the last hovered cell. */
  private beginPaste(): boolean {
    if (!selectionClipboard) {
      this.announce([{ key: 'editor.selection.status.nothing_to_paste' }]);
      return false;
    }
    // A paste is a selection action: the placed cells live under the Select tool.
    this.setTool('select');
    this.cancelPendingWire(false);
    this.pasting = true;
    this.pasteAnchor = this.cursorCell ?? this.lastHoverCell ?? { x: 0, y: 0 };
    this.announce([{ key: 'editor.selection.status.paste_ready' }]);
    this.render();
    return true;
  }

  /** Places the floating paste with its top-left cell on the given cell. */
  private placePaste(cell: { x: number; y: number }): void {
    const clip = selectionClipboard;
    if (!clip) return;
    this.pasteAnchor = cell;
    const result = pasteClip(this.doc, clip, cell.x, cell.y, editableRulesetOf(this.doc.ruleset));
    if (!result.rect) {
      this.announce([{ key: 'editor.selection.status.unchanged' }]);
      return;
    }
    this.pasting = false;
    this.commitSelectionEdit(result);
    this.selection = result.rect;
    this.selectionAnchor = null;
    this.announce([
      result.changed
        ? { key: 'editor.selection.status.pasted', params: { width: result.rect.width, height: result.rect.height } }
        : { key: 'editor.selection.status.unchanged' },
      ...this.selectionAftermath(result)
    ]);
    this.render();
  }

  /** Draws the selection (dim outside, dashed outline), the drag ghost and the floating paste. */
  private renderSelectionOverlay(s: number): void {
    const selection = this.selection;
    if (selection) {
      const width = this.canvas.width;
      const height = this.canvas.height;
      const x0 = selection.x * s;
      const y0 = selection.y * s;
      const x1 = (selection.x + selection.width) * s;
      const y1 = (selection.y + selection.height) * s;
      this.ctx.fillStyle = EDITOR_SELECTION_DIM_COLOR;
      this.ctx.fillRect(0, 0, width, y0);
      this.ctx.fillRect(0, y1, width, height - y1);
      this.ctx.fillRect(0, y0, x0, y1 - y0);
      this.ctx.fillRect(x1, y0, width - x1, y1 - y0);
      this.outlineRect(selection, s, 1);
      const gesture = this.selectionGesture;
      if (gesture?.kind === 'move' && (gesture.step.dx !== 0 || gesture.step.dy !== 0)) {
        this.outlineRect(shiftRect(selection, gesture.step.dx, gesture.step.dy), s, EDITOR_PASTE_PREVIEW_ALPHA);
      }
    }
    const clip = selectionClipboard;
    if (this.pasting && clip) this.drawPastePreview(clip, s);
  }

  private outlineRect(rect: CellRect, s: number, alpha: number): void {
    const inset = EDITOR_OVERLAY_LINE_WIDTH / 2;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.lineWidth = EDITOR_OVERLAY_LINE_WIDTH;
    this.ctx.strokeStyle = EDITOR_SELECTION_OUTLINE_COLOR;
    this.ctx.setLineDash([...EDITOR_SELECTION_DASH]);
    this.ctx.strokeRect(
      rect.x * s + inset,
      rect.y * s + inset,
      rect.width * s - EDITOR_OVERLAY_LINE_WIDTH,
      rect.height * s - EDITOR_OVERLAY_LINE_WIDTH
    );
    this.ctx.restore();
  }

  private drawPastePreview(clip: Clip, s: number): void {
    const { x: ox, y: oy } = this.pasteAnchor;
    this.ctx.save();
    this.ctx.globalAlpha = EDITOR_PASTE_PREVIEW_ALPHA;
    for (let cy = 0; cy < clip.height; cy++) {
      for (let cx = 0; cx < clip.width; cx++) {
        const px = (ox + cx) * s;
        const py = (oy + cy) * s;
        this.renderer.drawTile(this.ctx, clip.terrain[cy][cx], px, py, s, true, true);
        const item = clip.items[cy][cx];
        if (item) this.renderer.drawItem(this.ctx, item, px, py, s);
      }
    }
    for (const e of clip.entities) {
      this.renderer.drawEntity(this.ctx, e.type, e.dir, (ox + e.dx) * s, (oy + e.dy) * s, s);
    }
    if (clip.playerStart) {
      this.renderer.drawPlayer(this.ctx, (ox + clip.playerStart.dx) * s, (oy + clip.playerStart.dy) * s, s, clip.playerStart.dir, false, true);
    }
    this.ctx.restore();
    this.outlineRect({ x: ox, y: oy, width: clip.width, height: clip.height }, s, 1);
  }

  /** One cell: its terrain, the panels and the stacked-layer marker of a CC3D cell over it, then its item. */
  private drawCellLayers(ctx: CanvasRenderingContext2D, doc: EditorDocument, x: number, y: number, s: number): void {
    this.renderer.drawTile(ctx, doc.terrain[y][x], x * s, y * s, s, true, true);
    const cc3d = doc.cc3d;
    if (cc3d) {
      const cell = cc3d.cells[y * cc3d.width + x];
      const edges = cell.panels.length > 0 && !displayShowsPanels(cell) ? cell.panels : undefined;
      this.renderer.drawCellOverlay(ctx, edges, cell.terrain.length > 1, x * s, y * s, s);
    }
    const item = doc.items[y][x];
    if (item) this.renderer.drawItem(ctx, item, x * s, y * s, s);
  }

  /** Draws some cells of a CC3D document again, each with the creature or the player start standing on it. */
  private redrawCc3dCells(ctx: CanvasRenderingContext2D, doc: EditorDocument, indices: readonly number[], s: number): void {
    const width = mapWidthOf(doc);
    this.renderer.setHiddenLayerMarkers(true);
    try {
      for (const index of indices) {
        const x = index % width;
        const y = Math.floor(index / width);
        ctx.clearRect(x * s, y * s, s, s);
        this.drawCellLayers(ctx, doc, x, y, s);
        const creature = doc.entities.find((entity) => entity.x === x && entity.y === y);
        if (creature) this.renderer.drawEntity(ctx, creature.type, creature.dir, x * s, y * s, s);
        if (doc.playerStart.x === x && doc.playerStart.y === y) {
          this.renderer.drawPlayer(ctx, x * s, y * s, s, doc.playerStart.dir, false, true);
        }
      }
    } finally {
      this.renderer.setHiddenLayerMarkers(false);
    }
  }

  /** Draws the cells, items, creatures and the player start of a document at tile size `s`. */
  private drawMapLayers(ctx: CanvasRenderingContext2D, doc: EditorDocument, s: number): void {
    const mapWidth = mapWidthOf(doc);
    const mapHeight = mapHeightOf(doc);
    // The stacked-layer marker belongs to this canvas only: the renderer is shared with play.
    if (doc.cc3d) this.renderer.setHiddenLayerMarkers(true);
    try {
      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) this.drawCellLayers(ctx, doc, x, y, s);
      }
    } finally {
      if (doc.cc3d) this.renderer.setHiddenLayerMarkers(false);
    }

    for (const ent of doc.entities) {
      this.renderer.drawEntity(ctx, ent.type, ent.dir, ent.x * s, ent.y * s, s);
    }

    this.renderer.drawPlayer(ctx, doc.playerStart.x * s, doc.playerStart.y * s, s, doc.playerStart.dir, false, true);
  }

  /**
   * The map of a CC3D document drawn into an off-screen canvas, rebuilt only when its level (not its
   * title or hint), the tile size or the canvas size changed. Null (draw directly) when the layer would be too large or no
   * off-screen context exists.
   */
  private cc3dStaticLayer(doc: EditorDocument, s: number): HTMLCanvasElement | null {
    const { width, height } = this.canvas;
    const level = doc.cc3d;
    if (!level || width * height > EDITOR_STATIC_LAYER_MAX_PIXELS) return null;
    const cached = this.staticLayer;
    if (cached && cached.tile === s && cached.canvas.width === width && cached.canvas.height === height) {
      if (cached.level === level) return cached.canvas;
      // A stroke touches a few cells: only those are drawn again, not the thousands that did not change.
      const dirty = dirtyCc3dCells(cached.level, level);
      const ctx = dirty && dirty.length <= level.cells.length * EDITOR_STATIC_LAYER_REDRAW_SHARE ? cached.canvas.getContext('2d') : null;
      if (dirty && ctx) {
        ctx.imageSmoothingEnabled = false;
        this.redrawCc3dCells(ctx, doc, dirty, s);
        this.staticLayer = { level, tile: s, canvas: cached.canvas };
        return cached.canvas;
      }
    }
    const canvas = cached?.canvas ?? document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    this.drawMapLayers(ctx, doc, s);
    this.staticLayer = { level, tile: s, canvas };
    return canvas;
  }

  public render(): void {
    if (this.frameRequest !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    const doc = this.doc;
    this.updateTestFromState();
    const s = this.tilePx;
    this.lastDrawnTilePx = s;
    // Resizing the canvas resets the context: keep the pixel art sharp at any tile size.
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // A CC3D level can be huge (100 x 114 cells): its map is drawn once into a layer that a pointer move
    // only copies, then the overlays go on top.
    const layer = doc.cc3d ? this.cc3dStaticLayer(doc, s) : null;
    if (layer) this.ctx.drawImage(layer, 0, 0);
    else this.drawMapLayers(this.ctx, doc, s);

    this.ctx.lineWidth = EDITOR_LINK_LINE_WIDTH;
    for (const link of doc.trapLinks) {
      this.drawLinkLine(EDITOR_TRAP_LINK_COLOR, link.buttonX, link.buttonY, link.trapX, link.trapY, s);
    }
    for (const link of doc.cloneLinks) {
      this.drawLinkLine(EDITOR_CLONE_LINK_COLOR, link.buttonX, link.buttonY, link.clonerX, link.clonerY, s);
    }

    this.renderCc3dOverlay(s);
    this.renderSelectionOverlay(s);
    if (this.pendingWire) this.outlineCell(this.pendingWire.x, this.pendingWire.y, EDITOR_WIRE_SOURCE_COLOR, s);
    if (this.hoverCell) this.outlineCell(this.hoverCell.x, this.hoverCell.y, EDITOR_HOVER_OUTLINE_COLOR, s);
    if (this.cursorCell && document.activeElement === this.canvas) {
      this.outlineCell(this.cursorCell.x, this.cursorCell.y, EDITOR_CURSOR_OUTLINE_COLOR, s);
    }
  }

  /** The links derived from the level, once per version of it. */
  private cc3dLinksOf(level: Cc3dLevel): Cc3dLinks {
    if (this.linksCache?.level !== level) this.linksCache = { level, links: cc3dLinks(level) };
    return this.linksCache.links;
  }

  /** An arrow from the centre of one cell to the centre of another, head at the target. */
  private drawArrow(color: string, from: { x: number; y: number }, to: { x: number; y: number }, s: number): void {
    const c = EDITOR_TILE_CENTER_OFFSET;
    const x0 = (from.x + c) * s;
    const y0 = (from.y + c) * s;
    const x1 = (to.x + c) * s;
    const y1 = (to.y + c) * s;
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = EDITOR_CC3D_ARROW_HEAD_TILE * s;
    const spread = head * EDITOR_CC3D_ARROW_HEAD_SPREAD;
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(x0, y0);
    this.ctx.lineTo(x1, y1);
    this.ctx.stroke();
    const baseX = x1 - Math.cos(angle) * head;
    const baseY = y1 - Math.sin(angle) * head;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(baseX - Math.sin(angle) * spread, baseY + Math.cos(angle) * spread);
    this.ctx.lineTo(baseX + Math.sin(angle) * spread, baseY - Math.cos(angle) * spread);
    this.ctx.closePath();
    this.ctx.fill();
  }

  /** A disc in the top right corner of a cell: the template mob of a clone machine. */
  private drawBadge(color: string, cell: { x: number; y: number }, s: number): void {
    const radius = EDITOR_CC3D_BADGE_RADIUS_TILE * s;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc((cell.x + 1) * s - radius, cell.y * s + radius, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  /** A bar on one side of a cell: the side a click in the thin wall mode would toggle. */
  private drawSideHint(cell: { x: number; y: number }, side: Direction, s: number): void {
    const x0 = cell.x * s;
    const y0 = cell.y * s;
    this.ctx.lineWidth = EDITOR_CC3D_SIDE_HINT_LINE_WIDTH;
    this.ctx.strokeStyle = EDITOR_HOVER_OUTLINE_COLOR;
    this.ctx.beginPath();
    if (side === 'N' || side === 'S') {
      const y = side === 'N' ? y0 : y0 + s;
      this.ctx.moveTo(x0, y);
      this.ctx.lineTo(x0 + s, y);
    } else {
      const x = side === 'W' ? x0 : x0 + s;
      this.ctx.moveTo(x, y0);
      this.ctx.lineTo(x, y0 + s);
    }
    this.ctx.stroke();
  }

  /**
   * The link overlay of a CC3D level: for the hovered cell and the keyboard cursor cell, arrows to what
   * a device works (and from what works it), the cells of its colour group, and the template badge.
   */
  private renderCc3dOverlay(s: number): void {
    const level = this.doc.cc3d;
    if (!level) return;
    const cells = [this.cursorCell, this.hoverCell].filter((cell): cell is { x: number; y: number } => cell !== null);
    if (cells.length === 0) return;
    const links = this.cc3dLinksOf(level);
    const colors: Record<OverlayArrowKind, string> = EDITOR_CC3D_LINK_COLORS;
    this.ctx.save();
    this.ctx.globalAlpha = EDITOR_CC3D_OVERLAY_ALPHA;
    this.ctx.lineWidth = EDITOR_LINK_LINE_WIDTH;
    const drawn = new Set<string>();
    for (const cell of cells) {
      const key = `${cell.x},${cell.y}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const overlay: LinkOverlay = linkOverlayFor(level, cell, links);
      for (const target of overlay.highlights) this.outlineCell(target.x, target.y, EDITOR_CC3D_LINK_COLORS.group, s);
      for (const arrow of overlay.arrows) this.drawArrow(colors[arrow.kind], arrow.from, arrow.to, s);
      for (const badge of overlay.badges) this.drawBadge(EDITOR_CC3D_LINK_COLORS.template, badge, s);
    }
    if (this.cc3dEntry()?.action === 'panel') {
      if (this.hoverCell) this.drawSideHint(this.hoverCell, this.hoverSide, s);
      else if (this.cursorCell) this.drawSideHint(this.cursorCell, this.activeDir, s);
    }
    this.ctx.restore();
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
    const level = levelFromDocument(doc, {
      id,
      number: existing ? existing.number : targetLevels.length + 1,
      password: resolveSavedPassword(doc.password, targetLevels),
      fallbackTitle: t('editor.metadata.default_title.label')
    });
    // The stored solution stays attached while the map is untouched, as on save, so the checks can trust it.
    const original = this.originalLevel;
    if (original?.solution !== undefined && !levelMapChanged(original, level)) level.solution = original.solution;
    return level;
  }

  // ---------------------------------------------------------------------------
  // Test play, save, import
  // ---------------------------------------------------------------------------

  /** Why "Test from here" cannot run now, or null when it can; the cell it would start on comes with it. */
  private testFromHereTarget(): { cell: GridCell | null; block: TestFromHereBlock | null } {
    const cell = pickTestCell(this.cursorCell, this.lastHoverCell);
    return { cell, block: startCellProblem(this.doc, cell) };
  }

  /** Disables the Test from here button, with the reason as its tooltip, when the target cell cannot hold the start. */
  private updateTestFromState(): void {
    const button = byId<HTMLButtonElement>('editor-test-from-btn');
    if (!button) return;
    // Only the target cell and the level decide the state: skip the work when neither changed.
    const cell = pickTestCell(this.cursorCell, this.lastHoverCell);
    const key = `${this.loadGeneration}:${this.editRevision}:${cell?.x ?? ''},${cell?.y ?? ''}`;
    if (key === this.testFromStateKey) return;
    this.testFromStateKey = key;
    const { block } = this.testFromHereTarget();
    button.disabled = block !== null;
    button.title = t(block ? TEST_FROM_HERE_REASON_KEYS[block] : 'editor.test_from.title');
  }

  /**
   * Plays a copy of the level whose start is the keyboard cursor cell, or the
   * last hovered one. The editor's own level, and the start it saves, stay as
   * they are: only the copy handed to the game moves.
   */
  private async testFromHere(): Promise<void> {
    const { cell, block } = this.testFromHereTarget();
    if (block !== null || cell === null) {
      this.setStatusText(t(TEST_FROM_HERE_REASON_KEYS[block ?? 'no_cell']));
      return;
    }
    this.setStatusText(t('editor.test_from.status', { x: cell.x, y: cell.y }));
    await this.testPlay(cell);
  }

  private async testPlay(startCell?: GridCell): Promise<void> {
    const exported = this.exportCompiledLevel();
    const compiled = startCell ? levelStartingAt(exported, startCell) : exported;
    const report = LevelValidator.validate(compiled, storedSolutionWins);
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

  /**
   * A CC3D level with validator errors is saved only when the player confirms, as a level that
   * fails the check is tested: the errors are listed, and cancelling keeps the editor as it is.
   */
  private async confirmSaveDespiteErrors(): Promise<boolean> {
    if (!this.isCc3d()) return true;
    const report = LevelValidator.validate(this.exportCompiledLevel(), storedSolutionWins);
    if (report.valid) return true;
    const issuesText = this.formatIssues(report.issues.filter((issue) => issue.severity === 'error'));
    this.setStatusText(issuesText);
    return confirmDialog({
      title: t('app.confirm.title.label'),
      message: t('editor.toolbar.confirm_save_invalid.label', { issues: issuesText }),
      confirmLabel: t('editor.pack.save_anyway.action'),
      cancelLabel: t('app.confirm.cancel.action')
    });
  }

  private async performSave(forceCopy: boolean): Promise<void> {
    if (!(await this.confirmSaveDespiteErrors())) return;
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
        const pack = parsePackJson(
          text,
          ConfigRegistry.getLevelSizeBounds(),
          ConfigRegistry.getTakenLevelIds(),
          Date.now,
          ConfigRegistry.getPackMetadataLimits(),
          ConfigRegistry.getLevelTextLimits()
        );
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
