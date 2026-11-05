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
import { InvalidLevelError, isRuleset, isWinRule, sanitizeStoredLevels } from '../config/ConfigValidation';
import { i18n, t } from '../i18n/I18nManager';
import { nameWithDescription, paletteDescription } from './paletteDescriptions';
import { parsePackJson } from '../packs/packJson';
import { choiceDialog } from '../ui/choiceDialog';
import { confirmDialog } from '../ui/confirmDialog';
import { askSaveInto } from '../ui/saveIntoDialog';
import { PixelRenderer } from '../render/PixelRenderer';
import { DatCodec } from '../formats/DatCodec';
import { CC3D_XML_EXTENSION, decodeCc3dFiles } from '../formats/Cc3dXmlCodec';
import { encodeCc3dLevel } from '../formats/Cc3dXmlEncoder';
import { decodeXsbCollection, XSB_EXTENSIONS } from '../formats/XsbCodec';
import { LevelValidator, type ValidateOptions } from '../core/LevelValidator';
import { hasEpoxyOnlyContent } from '../core/RulesetFeatures';
import { cc3dLinks, type Cc3dLinks } from '../core/cc3d/cc3dLinks';
import { deriveDisplayLayers } from '../core/cc3d/cc3dLayers';
import { displayItemId, displayMobId, displayShowsPanels, displayTerrainId } from '../core/cc3d/display';
import { type Cc3dCell, type Cc3dLevel, type Cc3dTerrain, cellAt as cc3dCellAt } from '../core/cc3d/model';
import { ProceduralGenerationError, ProceduralGenerator } from '../core/ProceduralGenerator';
import {
  CloneLink,
  CompiledLevel,
  Direction,
  LevelBlueprint,
  LevelPack,
  Ruleset,
  LevelValidationReport,
  ValidationIssue,
  WinRule
} from '../core/types';
import { downloadBytes, downloadJson, downloadText, MIME_XML } from '../ui/download';
import { lossyExportNotice } from '../ui/exportNotice';
import { formatValidationIssue } from '../ui/validatorIssueText';
import { receiversProgress } from '../ui/levelFeedback';
import { BeamPreview, computeBeamPreview, EMPTY_BEAM_PREVIEW } from './beamPreview';
import { buildIssueMarkers, IssueMarker, markerFreshness } from './issueMarkers';
import { DEFAULT_RULESET, DEFAULT_WIN_RULE, FLOOR_TILE_ID } from '../core/coreConstants';
import { anchoredZoomScroll, CanvasFit, fitCanvas, revealScroll, ScrollPosition, StageView, zoomIn, zoomOut } from './canvasFit';
import { historyDiff, HistoryDiff } from './historyDiff';
import { blockCheckApplies, describeBlockVerdict } from './blockCheck';
import { clonerTemplateMessage, clonersTemplateMessage, describeEditorCell, entityDisplayName, sideDisplayName } from './cellDescription';
import { entityHasFacing } from './entityFacing';
import { BlockCheckRunner, BlockCheckWorkerLike } from './blockCheckRunner';
import { LevelCheckResult, LevelCheckRunner, LevelCheckWorkerLike } from './levelCheckRunner';
import { EMPTY_TEMPLATE_ID, LevelTemplate, loadLevelTemplates, templateContent } from './levelTemplates';
import {
  GridCell,
  levelStartingAt,
  pickTestCell,
  startCellProblem,
  TEST_FROM_HERE_REASON_KEYS,
  TestFromHereBlock
} from './testFromHere';
import { CheckState, CheckSummary, summarizeValidation } from './checkSummary';
import { issueCell, issueRows, issuesAtCell } from './issueList';
import { cloneDocument, displayLayersOf, EditorDocument, EditorMetadata, sameDocument, withCc3d, withEditedMap } from './editorDocument';
import {
  DRAFT_VERSION,
  type DraftOffer,
  type EditorDraft,
  draftLevelOf,
  draftOffer,
  hydrateDraftLevel,
  levelFingerprint
} from './editorDraft';
import { type DraftWrite, EditorDraftStore } from './editorDraftStore';
import { CC3D_RULESET, documentFromLevel, levelFromDocument, metadataForDocument } from './editorLevelIo';
import { removeLayerAt, removeMob, setItem, setPanelSide } from './cc3dEdits';
import {
  type Cc3dAreaResult,
  type Cc3dClip,
  type Cc3dFillContent,
  clearCc3dRect,
  extractCc3dClip,
  fillCc3dRect,
  MESSAGE_CC3D_AREA_MOBS_REMOVED,
  MESSAGE_CC3D_AREA_MOBS_SKIPPED,
  MESSAGE_CC3D_AREA_PLAYER_KEPT,
  MESSAGE_CC3D_AREA_PLAYER_MOVED,
  MESSAGE_CC3D_RESIZE_MOBS_DROPPED,
  MESSAGE_CC3D_RESIZE_PLAYER_MOVED,
  moveCc3dRect,
  pasteCc3dClip,
  resizeCc3d,
  type Cc3dResizeResult
} from './cc3dAreaEdits';
import {
  type Cc3dLinkTranslation,
  describeLinkChanges,
  diffCc3dLinks,
  diffCc3dLinksByPosition,
  linkOverlayFor,
  type LinkOverlay,
  type OverlayArrowKind
} from './cc3dLinkOverlay';
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
  itemOf,
  layerOf,
  mobOf,
  needsAttribute
} from './cc3dPalette';
import { dirtyCc3dCells, hasHiddenLayers } from './cc3dLayerDiff';
import { CC3D_ROOM_CHOICE_ID, emptyCc3dRoom } from './cc3dRoom';
import { applyCc3dTool, cc3dContinuesOnDrag, nearestSide, pickCc3dCell } from './cc3dTools';
import { EditorHistory } from './editorHistory';
import { EditorKeyAction, getCanvasKeyAction, moveCursor, rotateClockwise, SelectionKeyAction } from './editorKeyboard';
import { layoutModeForWidth } from './editorLayout';
import {
  applyTool,
  Brush,
  CELL_EDGE_BRUSH_ID,
  continuesOnDrag,
  EDITOR_TOOLS,
  EditorTool,
  MESSAGE_LINKS_REMOVED,
  MESSAGE_START_KEPT,
  MESSAGE_UNDERLAYS_REMOVED,
  pickFromCell,
  ToolMessage
} from './editorTools';
import {
  INSPECTOR_SECTIONS,
  InspectorSection,
  parseSectionState,
  SectionState,
  serializeSectionState
} from './inspectorSections';
import { hasCellEdges } from './editorCellEdges';
import { hasUnderlays, hiddenTerrainClosed, setUnderlayAt, underlayAt } from './editorUnderlays';
import { pruneLauncherLinks } from './editorLauncherLinks';
import { isRemovableTop } from '../core/Underlays';
import { normalizeUnderlays } from '../config/ConfigValidation';
import { holdsLinkEnd, mapHeightOf, mapWidthOf, paintEntity, removeCloneLink, removeLauncherLink, removeTrapLink, resizeMap } from './mapEdits';
import {
  type LinkSession,
  type PartnerCandidates,
  nudgeMessages,
  partnerCandidates,
  sessionClick,
  sessionSourceHolds,
  soleChangedCell,
  startLinkSession
} from './linkSession';
import { CC3D_CONNECTION_KEYS, cc3dConnectionRows } from './cc3dConnectionRows';
import {
  CHANNEL_NAME_KEYS,
  type ConnectionList,
  type ConnectionRow,
  type ConnectionUnlink,
  type ConnectionView,
  type ConnectionLink,
  KIND_NAME_KEYS,
  connectionCellName,
  connectionNoteText,
  connectionRows,
  systemNameKey
} from './connectionRows';
import { deviceOverlayFor } from './deviceOverlay';
import { datLinkCapNotice } from './datLinkCap';
import {
  CC3D_MECHANISM_HELP_ROWS,
  MECHANISM_HELP_ROWS,
  MECHANISMS_HELP_CC3D_TOP_LAYER_KEY,
  MECHANISMS_HELP_KEYS_KEY,
  MECHANISMS_HELP_LYNX_KEY
} from './mechanismsHelp';
import {
  mechanismStampClip,
  mechanismStampsFor,
  STAMP_DEFAULT_LAYOUT,
  turnedStampLayout,
  type MechanismStamp,
  type StampLayout
} from './mechanismStamps';
import { deviceRelations } from '../core/DeviceRelations';
import { ANCHOR_STEPS, ResizeAnchor, ResizeAnchorStep, TOP_LEFT_ANCHOR } from './resizeAnchor';
import {
  CellRect,
  clampMoveStep,
  clearRect,
  Clip,
  clipLinkCount,
  extractClip,
  fillBrushRefusal,
  FillRefusal,
  fillRect,
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
  cellEdgeAvailability,
  EditableRuleset,
  entityAvailability,
  linkAvailability,
  majorityRuleset,
  tileAvailability,
  winRuleAvailability
} from './paletteAvailability';
import { arrangeMechanismSections, entityMechanismGroup, tileMechanismGroup, type MechanismGroupId } from './paletteGroups';
import { searchPalette, type SearchableEntry } from './paletteSearch';
import { describeResize, RESIZE_DONE_KEY, RESIZE_UNCHANGED_KEY } from './resizeReport';
import {
  decideSave,
  LoadedTexts,
  mayRebindAfterSave,
  needsImportedConfirmation,
  NO_SOURCE,
  IMPORTED_MODIFY_CHOICE,
  nextEditableIndex,
  pickSaveDestination,
  levelMapChanged,
  prepareLevelForSave,
  reconcileSource,
  resolveSavedPassword,
  SaveSource
} from './saveTarget';
import { packNameFromFile } from '../ui/cc3dImport';
import { formatMegabytes, isImportSizeAllowed } from '../ui/importLimits';
import {
  EDITOR_AUTO_CHECK_TIMEOUT_MS,
  EDITOR_BLOCK_CHECK_TIMEOUT_MS,
  EDITOR_CELL_ANNOUNCE_DELAY_MS,
  EDITOR_PALETTE_SEARCH_COUNT_DELAY_MS,
  EDITOR_BEAM_DIM_ALPHA,
  EDITOR_BEAM_GATE_COLOR,
  EDITOR_BEAM_GATE_INSET_TILE,
  EDITOR_BEAM_STALE_ALPHA,
  BIOME_ACCENT_CSS_VAR,
  EDITOR_ISSUE_MARKER_BANG_Y,
  EDITOR_ISSUE_MARKER_BORDER_WIDTH,
  EDITOR_ISSUE_MARKER_COUNT_MIN_TILE_PX,
  EDITOR_ISSUE_MARKER_ERROR_CSS_VAR,
  EDITOR_ISSUE_MARKER_FALLBACK_ERROR,
  EDITOR_ISSUE_MARKER_FALLBACK_INFO,
  EDITOR_ISSUE_MARKER_FALLBACK_WARNING,
  EDITOR_ISSUE_MARKER_FONT_FAMILY,
  EDITOR_ISSUE_MARKER_GLYPH_COLOR,
  EDITOR_ISSUE_MARKER_GLYPH_FONT,
  EDITOR_ISSUE_MARKER_GLYPH_INSET,
  EDITOR_ISSUE_MARKER_INFO_SCALE,
  EDITOR_ISSUE_MARKER_INSET_PX,
  EDITOR_ISSUE_MARKER_MIN_PX,
  EDITOR_ISSUE_MARKER_OUTLINE_COLOR,
  EDITOR_ISSUE_MARKER_OUTLINE_WIDTH,
  EDITOR_ISSUE_MARKER_STALE_ALPHA,
  EDITOR_ISSUE_MARKER_STROKE_WIDTH,
  EDITOR_ISSUE_MARKER_TILE,
  EDITOR_ISSUE_MARKER_WARNING_CSS_VAR,
  EDITOR_ISSUE_MARKER_ZOOM_THRESHOLD_PX,
  EDITOR_CHECK_DEBOUNCE_MS,
  EDITOR_TEST_CHECK_TIMEOUT_MS,
  EDITOR_CC3D_ARROW_HEAD_SPREAD,
  EDITOR_CC3D_ARROW_HEAD_TILE,
  EDITOR_CONNECTIONS_ROW_OUTLINE_WIDTH,
  EDITOR_RELATION_COLORS,
  EDITOR_CC3D_BADGE_RADIUS_TILE,
  EDITOR_CLONER_BADGE_BACKING,
  EDITOR_CLONER_BADGE_TILE,
  EDITOR_CC3D_LINK_COLORS,
  EDITOR_CC3D_OVERLAY_ALPHA,
  EDITOR_CC3D_ROOM_HEIGHT,
  EDITOR_CC3D_SIDE_HINT_LINE_WIDTH,
  EDITOR_CC3D_ROOM_WIDTH,
  EDITOR_CC3D_SWATCH_COLORS,
  EDITOR_STATIC_LAYER_MAX_PIXELS,
  EDITOR_STATIC_LAYER_REDRAW_SHARE,
  EDITOR_CLONE_LINK_COLOR,
  EDITOR_LAUNCHER_LINK_COLOR,
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
  EDITOR_TRAP_LINK_COLOR,
  EDITOR_CONNECTIONS_HOVER_DWELL_MS,
  EDITOR_WHEEL_ZOOM_STEP_PX,
  EDITOR_DRAFT_MAX_CHARS,
  EDITOR_DRAFT_STORAGE_PREFIX,
  EDITOR_DRAFT_WRITE_DELAY_MS,
  EDITOR_WIRE_SOURCE_COLOR,
  TIMING_DEFAULTS
} from '../ui/uiConstants';

const EXPORT_FALLBACK_FILE_NAME = 'epoxy_level';

/** Dialog answers of the draft offer. */
const DRAFT_RESTORE_CHOICE = 'restore';
const DRAFT_DISCARD_CHOICE = 'discard';
/** Base and skipped characters of the fallback tab id, for a browser without crypto.randomUUID. */
const DRAFT_TAB_ID_RADIX = 36;
const DRAFT_TAB_ID_SKIP = 2;
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
/** The explicit Check and the Test pre-check search door orders more thoroughly than the automatic check. */
const DEEP_CHECK_OPTIONS: ValidateOptions = { doorOrderSearch: 'deep' };
/** Value of the context pack select while the editor content belongs to no pack. */
const NO_PACK_OPTION_VALUE = '';
/** Answers of the imported-pack and multi-level-file questions. */
const IMPORTED_COPY_CHOICE = 'copy';
const IMPORT_AS_PACK_CHOICE = 'pack';
const IMPORT_FIRST_CHOICE = 'first';
const SEPARATOR_BETWEEN_MESSAGES = ' ';
const SEPARATOR_BETWEEN_PARTS = ', ';
/** Status keys of a selection fill that cannot go ahead (their texts live in the locale files). */
const MESSAGE_FILL_REFUSED_CELL_EDGE = 'editor.selection.status.fill_refused_cell_edge';
const MESSAGE_FILL_REFUSED_ENTRY = 'editor.selection.status.fill_refused_entry';
const MESSAGE_FILL_REFUSED_ATTRIBUTES = 'editor.selection.status.fill_refused_attributes';
const NO_COORDS_TEXT = '--';
const COORDS_DESCRIPTION_SEPARATOR = ': ';
/** WheelEvent.deltaMode values for a delta counted in lines and in pages. */
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const STAGE_CENTRE_DIVISOR = 2;
const CELL_CENTRE = 0.5;
const EDITOR_PLAYER_BRUSH_ID = 'player_start';
const CC3D_ATTRS_ID = 'editor-cc3d-attrs';
const LAYERS_SECTION_ID = 'editor-layers-section';
const LAYERS_LIST_ID = 'editor-layers-list';
const LAYERS_CELL_ID = 'editor-layers-cell';
const CONNECTIONS_SECTION_ID = 'editor-connections-section';
const CONNECTIONS_CELL_ID = 'editor-connections-cell';
const CONNECTIONS_LISTS_ID = 'editor-connections-lists';
const CONNECTIONS_CONTROLS_ID = 'editor-connections-controls';
const CONNECTIONS_CONTROLLED_ID = 'editor-connections-controlled';
const CONNECTIONS_NOTE_ID = 'editor-connections-note';
const CONNECTIONS_DERIVED_ID = 'editor-connections-derived';
const MECHANISMS_HELP_SECTION_ID = 'editor-mechanisms-help-section';
const MECHANISMS_HELP_LIST_ID = 'editor-mechanisms-help-list';
const MECHANISMS_HELP_KEYS_ID = 'editor-mechanisms-help-keys';
const MECHANISMS_HELP_LYNX_ID = 'editor-mechanisms-help-lynx';
const MECHANISMS_HELP_NAME_CLASS = 'editor-mechanism-help-name';
const CONNECTIONS_ISSUES_BLOCK_ID = 'editor-connections-issues-block';
const CONNECTIONS_ISSUES_ID = 'editor-connections-issues';
const CONNECTIONS_LINK_HINT_KEY = 'editor.connections.link.hint.label';
const CONNECTIONS_LINK_BTN_ID = 'editor-connections-link-btn';
const CONNECTIONS_NO_CELL_KEY = 'editor.connections.no_cell';
const CONNECTIONS_MORE_KEY = 'editor.connections.more';
const CONNECTIONS_ROW_KEY = 'editor.connections.row';
const CONNECTIONS_LINK_ACTION_KEY = 'editor.connections.link.action';
const CONNECTIONS_LINK_DONE_KEY = 'editor.connections.link.done';
const CONNECTIONS_LINK_BLOCKED_KEY = 'editor.connections.link.blocked';
const LINK_UNAVAILABLE_KEY = 'editor.link.unavailable.label';
const LINK_NOTHING_KEY = 'editor.link.nothing.label';
const LINK_BUSY_KEY = 'editor.link.busy.label';
const CONNECTIONS_UNLINK_ACTION_KEY = 'editor.connections.unlink.action';
const CONNECTIONS_UNLINK_ARIA_KEY = 'editor.connections.unlink.aria';
const CONNECTIONS_UNLINK_DONE_KEY = 'editor.connections.unlink.done';
const CONNECTIONS_UNLINK_SUFFIX_TRAP_KEY = 'editor.connections.unlink.suffix_trap';
const CONNECTIONS_UNLINK_SUFFIX_CLONE_KEY = 'editor.connections.unlink.suffix_clone';
const CONNECTIONS_UNLINK_SUFFIX_CLONE_NONE_KEY = 'editor.connections.unlink.suffix_clone_none';
const ISSUE_JUMP_TITLE_KEY = 'editor.issues.jump.title';
const LIST_SEPARATOR_KEY = 'editor.cell_speech.list_separator.label';
const CONNECTION_ROW_CLASS = 'editor-connection-row';
const CONNECTION_GOTO_CLASS = 'editor-connection-goto';
const HIDDEN_TERRAIN_FIELD_ID = 'editor-hidden-terrain-field';
const HIDDEN_TERRAIN_INPUT_ID = 'editor-hidden-terrain';
const HIDDEN_TERRAIN_HINT_ID = 'editor-hidden-terrain-hint';
const HIDDEN_TERRAIN_UNAVAILABLE_ID = 'editor-hidden-terrain-unavailable';
/** Value of the "None" option of the hidden terrain select: no terrain is hidden under the cell. */
const HIDDEN_TERRAIN_NONE = '';
const CELL_LIVE_ID = 'editor-cell-live';
const PALETTE_GRID_ID = 'editor-palette-grid';
const PALETTE_SEARCH_INPUT_ID = 'editor-palette-search';
const PALETTE_SEARCH_COUNT_ID = 'editor-palette-search-count';
const PALETTE_SEARCH_EMPTY_CLASS = 'palette-search-empty';
const PALETTE_TAB_DIMMED_CLASS = 'is-dimmed';
/** Class of a palette entry the level's engine cannot use. */
const PALETTE_UNAVAILABLE_CLASS = 'is-unavailable';
/** keyCode some browsers report for a key press that belongs to an input method composition. */
const IME_COMPOSITION_KEY_CODE = 229;
const PALETTE_SEARCH_RESULTS_KEY = 'editor.palette.search.results.label';
const PALETTE_SEARCH_NO_MATCH_KEY = 'editor.palette.search.no_match.label';
const PALETTE_SEARCH_COUNT_KEY = 'editor.palette.search.count.label';
/** Data attribute value of the CC3D entries, whose id is the palette entry id. */
const CC3D_BRUSH_KIND = 'cc3d';

/** An Epoxy or Lynx palette entry before its button exists: what the search reads, and what building the button needs. */
interface EpoxyPaletteItem extends SearchableEntry {
  brush: Brush;
  group: MechanismGroupId | null;
  icon: () => string;
}
const ISSUES_LIST_ID = 'editor-issues-list';
const ISSUES_NOTE_ID = 'editor-issues-note';
const ISSUES_SECTION_ID = 'editor-issues-section';
const SEVERITY_GLYPHS: Record<ValidationIssue['severity'], string> = { error: '✖', warning: '⚠', info: 'i' };
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

/** Win rules offered by the select, to mark the ones the engine cannot play. */
const WIN_RULE_VALUES: readonly WinRule[] = ['exit', 'targets', 'receivers'];
const ENTITIES_CATEGORY = 'entities';
const MECHANISMS_CATEGORY = 'mechanisms';
const TERRAIN_CATEGORY = 'terrain';
/** Tile whose icon stands for the thin wall entry: a floor with a wall on its north side. */
const CELL_EDGE_ICON_TILE = 'thin_wall_n';

const TOOL_LABEL_KEYS: Record<EditorTool, string> = {
  brush: 'editor.layout.tool.brush.label',
  fill: 'editor.layout.tool.fill.label',
  eraser: 'editor.layout.tool.eraser.label',
  picker: 'editor.layout.tool.picker.label',
  select: 'editor.selection.tool.label'
};
/** Why Test went ahead without a check report: the notice that says so. */
type TestCheckSkip = 'timeout' | 'cancelled' | 'error';
const TEST_CHECK_SKIP_KEYS: Record<TestCheckSkip, string> = {
  timeout: 'editor.check.test_skipped.label',
  cancelled: 'editor.check.test_cancelled.label',
  error: 'editor.check.test_error.label'
};

const CHECK_TEXT_KEYS: Record<CheckState, string> = {
  valid: 'editor.layout.check.valid',
  warnings: 'editor.layout.check.warnings',
  errors: 'editor.layout.check.errors',
  checking: 'editor.layout.check.checking.label',
  skipped: 'editor.layout.check.skipped.label',
  interrupted: 'editor.layout.check.interrupted.label',
  error: 'editor.layout.check.error.label'
};

/** Where a save puts the level: an existing pack or a pack to create, and whether it is stored as a new level. */
interface SaveDestination {
  packId: string | null;
  newPackName: string | null;
  asCopy: boolean;
}

/** One piece of the off-screen CC3D map: a block of cells drawn into its own canvas. */
interface StaticChunk {
  canvas: HTMLCanvasElement;
  /** First cell, and size in cells. */
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

/** The CC3D map kept as chunks, for the level version, tile size and look it was drawn for. */
interface StaticLayer {
  level: Cc3dLevel;
  tile: number;
  look: string;
  width: number;
  height: number;
  /** Size of the editor canvas the chunks were drawn for: a resized canvas means a new fit, so new chunks. */
  backingWidth: number;
  backingHeight: number;
  /** Chunk side in cells, and chunks per row. */
  side: number;
  perRow: number;
  chunks: StaticChunk[];
}

/** One pointer stroke or key press: the document it started from, and whether it changed anything. */
interface Stroke {
  base: EditorDocument;
  changed: boolean;
  forceErase: boolean;
  /** CC3D: Shift was held when the eraser stroke began, so it takes the whole cell. */
  wholeCell: boolean;
  /** The status line writes counted when the stroke began: a stroke that wrote a status itself is not talked over. */
  statusWritesAtBegin: number;
}

/** Optional seams of the editor. */
export interface EditorOptions {
  /** Keys whose owner page is still alive; defaults to the Web Locks held on this origin (none without the API). */
  liveKeys?: () => Promise<Set<string>>;
}

/** A stored draft of an earlier visit, read from its key. */
interface DraftCandidate {
  key: string;
  draft: EditorDraft;
  raw: string;
}

/** What reading a draft key for the offer found. */
type CandidateRead = ({ kind: 'draft' } & DraftCandidate) | { kind: 'invalid'; raw: string } | { kind: 'skip' };

/** The level a draft started from, with the pack and level it is stored as now. */
interface DraftSourceMatch {
  level: CompiledLevel;
  source: SaveSource;
}

/** A pointer gesture of the Select tool: drawing a rectangle, or dragging the selected cells. */
type SelectionGesture =
  | { kind: 'select'; anchor: { x: number; y: number } }
  | { kind: 'move'; origin: { x: number; y: number }; step: MoveStep };

/** What the clipboard holds: the cells of an Epoxy or Lynx level, or of a CC3D one. The two never mix. */
type SelectionClipboard = { kind: 'epoxy'; clip: Clip } | { kind: 'cc3d'; clip: Cc3dClip };

/** The key that closes the Stamps menu. */
const STAMPS_MENU_CLOSE_KEY = 'Escape';

/** Locale key of how each layout of a stamp is named (literal keys, so the locale checks see them). */
const STAMP_LAYOUT_KEYS: Readonly<Record<StampLayout, string>> = {
  horizontal: 'editor.stamps.layout.horizontal.label',
  vertical: 'editor.stamps.layout.vertical.label'
};

/** Cut and copied cells, shared by every level of the session; not the system clipboard. */
let selectionClipboard: SelectionClipboard | null = null;

/** The preview of a CC3D clip in the shape the Epoxy preview draws, derived once per clip. */
const cc3dPreviewClips = new WeakMap<Cc3dClip, Clip>();

/** The thin walls of a document by cell index, built once per list of edges (a document edit makes a new list). */
const cellEdgeSidesMemo = new WeakMap<object, ReadonlyMap<number, readonly Direction[]>>();

/** The cells of a document that hide terrain, by cell index, built once per list of underlays. */
const hiddenTerrainCellsMemo = new WeakMap<object, ReadonlyMap<number, boolean | undefined>>();

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
  private levelRunner: LevelCheckRunner | null = null;
  /** The last finished report with the load and content it is for (`currentBeamPreviewKey`). */
  private reportCache: { key: string; contentKey: string; report: LevelValidationReport; deep: boolean } | null = null;
  /** What the badge shows instead of the last verdict: a check in progress, or one abandoned (too slow, failed, interrupted). */
  private checkOverlay: 'checking' | 'skipped' | 'interrupted' | 'error' | null = null;
  /** True while Test waits for its check, so a repeated click does not start a second one. */
  private testCheckPending = false;
  /** Bumped when the editor view is left or disposed, so a Test that waits for its check does not play after it. */
  private checkAbortEpoch = 0;
  /** The content key of the check running in the worker, so a save (same content) does not abandon it. */
  private runningCheckKey: string | null = null;
  /** False while the check in the worker is of a moved-start copy: it is not the content, so nobody joins it or caches it. */
  private runningCheckCacheable = true;
  /** Whether the running check uses the deep door-order search (the Check button, Test); a deep run serves default callers too. */
  private runningCheckDeep = false;
  /** Source of the status tokens: each check run that writes "checking" on the status line takes the next one. */
  private statusTokenSeq = 0;
  /** The status line before a check wrote "checking", the status write count right after it did, and the token of the run that owns the line. */
  private runningStatus: { previous: string; writes: number; token: number } | null = null;
  /** The status texts around a block check in progress, to restore the line if it is abandoned. */
  private runningBlockCheck: { running: string; base: string } | null = null;
  /** Bumped each time another level is loaded, so a save that outlives its level cannot rebind the editor. */
  private loadGeneration = 0;

  private activeCategory: string = 'terrain';
  /** The palette search text: while it is not empty the palette shows the matches of every tab. Session only. */
  private paletteQuery = '';
  /** How many entries the last search matched, and the count a screen reader was last told. */
  private searchMatchCount = 0;
  private searchCountAnnounced: number | null = null;
  private searchCountTimer: ReturnType<typeof setTimeout> | null = null;
  private tool: EditorTool = 'brush';
  private brush: Brush = { kind: 'terrain', id: 'wall' };
  private activeDir: Direction = 'S';
  private stroke: Stroke | null = null;
  /** The open link session: the device being linked from; null when none. The tool and the brush are never touched by it. */
  private linkSession: LinkSession | null = null;
  /** The partners the session offers, keyed on the document revision, the session and the ruleset it was computed for. */
  private linkCandidatesCache: { key: string; value: PartnerCandidates } | null = null;
  /** What the Connections section shows now: the key it was drawn for and the cell it is about. */
  private connectionsKey = '';
  /** The locale and ruleset the "How mechanisms work" card was written for. */
  private mechanismsHelpLocale = '';
  private connectionsShown: { x: number; y: number } | null = null;
  /** The relation lookup of the last cell asked for: valid while the document, the cell and the locale stay. */
  private connectionsCache: { doc: EditorDocument; x: number; y: number; view: ConnectionView } | null = null;
  /** The cell of the connections row the pointer or the focus is on: it gets a thicker outline on the map. */
  private connectionsRowCell: { x: number; y: number } | null = null;
  /** What the Link button of the section starts for the cell shown. */
  private connectionsLink: ConnectionLink = null;
  /** True while the section is being rebuilt: a focus change caused by the rebuild itself must not start another. */
  private connectionsDrawing = false;
  /** The cell the pointer rested on long enough for the section to follow it; stays after the pointer leaves the map. */
  private connectionsPointerCell: { x: number; y: number } | null = null;
  private connectionsDwellTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while the pointer is over the section: its list must not change under it. */
  private connectionsPointerInside = false;
  /** CC3D palette state: the selected entry, its category and the attributes the choosers hold. */
  private cc3dEntryId: string = 'layer:wall';
  private cc3dCategory: Cc3dCategoryId = 'blockers';
  private cc3dAttrs: Cc3dBrushAttributes = { ...DEFAULT_CC3D_ATTRIBUTES };
  /** Palette icons by display id, so a direction change does not draw them all again. */
  private iconCache = new Map<string, string>();
  /** The animation frame a redraw is waiting for, so pointer moves redraw at most once per frame. */
  private frameRequest: number | null = null;
  /** True while render() is fitting the canvas itself, so the fit's own redraw does not fit again. */
  private refitting = false;
  /** The links of a CC3D level version, derived once for the overlay. */
  private linksCache = new WeakMap<Cc3dLevel, Cc3dLinks>();
  /** The side of the hovered cell nearest the pointer, for the thin wall mode. */
  private hoverSide: Direction = 'N';
  /** The last way the map was addressed: the thin wall bar follows the pointer or the keyboard cursor accordingly. */
  private lastInput: 'pointer' | 'keyboard' = 'pointer';
  /** The CC3D map drawn off-screen, kept while the document and the tile size stay the same. */
  private staticLayer: StaticLayer | null = null;
  /** The cells selected with the Select tool. */
  private selection: CellRect | null = null;
  /** The corner the keyboard selection grows from; null once the cursor moved without Shift. */
  private selectionAnchor: { x: number; y: number } | null = null;
  private selectionGesture: SelectionGesture | null = null;
  /** True while a pasted clip floats at `pasteAnchor`, waiting to be placed. */
  private pasting = false;
  /** Top-left cell of the floating paste: follows the pointer and the keyboard cursor. */
  private pasteAnchor: { x: number; y: number } = { x: 0, y: 0 };
  /**
   * The mechanism stamp that floats instead of the clipboard while `pasting`; null for an ordinary paste. The clipboard
   * itself is never touched by a stamp.
   */
  private floatingStamp: { stamp: MechanismStamp; layout: StampLayout } | null = null;
  private hoverCell: { x: number; y: number } | null = null;
  private cursorCell: { x: number; y: number } | null = null;
  private collatorCache: { locale: string; collator: Intl.Collator } | null = null;
  /** The last cell the pointer was over, kept after it leaves the canvas so a toolbar button can use it. */
  private lastHoverCell: GridCell | null = null;
  /** What the Test from here button state was computed for, to skip recomputing it on every redraw. */
  private testFromStateKey = '';
  /** Zoom steps away from the fit size; 0 fits the level to the stage. */
  private zoomOffset: number = 0;
  /** The fit the canvas has now: the size a zoom starts from and a reveal measures with. */
  private lastFit: CanvasFit | null = null;
  /** Last pointer position over the canvas, null once it left: where a zoom pivots. */
  private lastPointer: { clientX: number; clientY: number } | null = null;
  /** Wheel travel in pixels not yet turned into a zoom step. */
  private wheelTravel = 0;
  /** What the coordinates badge was last built for; empty when it holds something else. */
  private hoverTextKey = '';
  /** Tile size, in pixels, the canvas buffer is drawn at. */
  private tilePx: number = 0;
  /** The level as it was loaded or last saved; null when the content was never stored. */
  private cleanDoc: EditorDocument | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private playerIconUrl: string = '';
  private dirty: boolean = false;
  /** Bumped on every write to isDirty, so an async save can tell whether the editor changed meanwhile. */
  private editRevision: number = 0;
  /** Bumped whenever the document content changes, never by a save: the beam preview is keyed on it. */
  private docRevision: number = 0;
  private get isDirty(): boolean {
    return this.dirty;
  }

  private set isDirty(value: boolean) {
    this.dirty = value;
    this.editRevision++;
    // Any edit or load makes a running block check stale.
    this.abortBlockCheck();
    this.cancelRunningCheck();
    this.updateDirtyBadge();
    this.syncDraft();
  }

  /** The autosaved draft of unsaved work. Every page writes and deletes only its own key. */
  private readonly draftStore = new EditorDraftStore(EDITOR_DRAFT_MAX_CHARS);
  /** Random id of this page; it names the page's draft key and its Web Lock. */
  private readonly draftTabId: string = LevelEditor.newTabId();
  /** Keys whose Web Lock is held by a living page: those drafts are not abandoned, so they are not offered. */
  private readonly liveKeys: () => Promise<Set<string>>;
  /** Aborts the page-level draft listeners when the editor is disposed. */
  private readonly draftListeners = new AbortController();
  private disposed = false;
  private draftOffered = false;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pending spoken description of the keyboard cursor cell. */
  private cellSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  /** Counts status bar writes, so a move or an edit can tell whether it already said something. */
  private statusWrites = 0;
  /** True after a failed or oversized write was reported, until a write succeeds. */
  private draftProblemReported = false;
  /** Drafts of earlier visits found at startup and not yet answered or removed. */
  private readonly waitingDraftKeys = new Set<string>();
  /** A restored draft whose own copy could not be written yet: removed once a write succeeds. */
  private adoptedDraft: { key: string; raw: string } | null = null;
  /** Releases this page's Web Lock; null when the browser has no Web Locks or the lock is not held yet. */
  private releaseDraftLock: (() => void) | null = null;
  /** The fingerprint of `originalLevel`, computed once per level it is for. */
  private baseHashCache: { level: CompiledLevel | null; hash: string } | null = null;

  public constructor(
    canvas: HTMLCanvasElement,
    renderer: PixelRenderer,
    hooks: EditorHooks,
    options: EditorOptions = {}
  ) {
    this.canvas = canvas;
    this.liveKeys = options.liveKeys ?? (() => LevelEditor.heldLockNames());
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
    this.bindConnectionsEvents();
    this.renderIssues();
    this.bindLayoutEvents();
    this.bindDraftEvents();
    this.holdDraftLock();
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
    this.lastFit = fit;
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

  /** Changes the zoom and keeps the pointed cell (else the cursor cell, else the middle of the stage) where it was on screen. */
  private setZoomOffset(offset: number): void {
    const stage = byId('editor-stage');
    const before = this.lastFit;
    const view = stage && before ? this.stageView(stage, before) : null;
    const anchor = stage && view && before ? this.zoomAnchor(stage, view, before) : null;
    this.zoomOffset = offset;
    const fit = this.applyFit();
    if (!stage || !view || !before || !anchor || !fit) return;
    this.scrollStage(stage, anchoredZoomScroll(anchor, before, fit, view, { clientWidth: stage.clientWidth, clientHeight: stage.clientHeight }));
  }

  /** The stage as it is scrolled and sized now, with the canvas size of `fit`. */
  private stageView(stage: HTMLElement, fit: CanvasFit): StageView {
    return {
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      clientWidth: stage.clientWidth,
      clientHeight: stage.clientHeight,
      canvasCssWidth: fit.cssWidth,
      canvasCssHeight: fit.cssHeight
    };
  }

  /** Where a zoom pivots, in CSS pixels from the top left of the visible stage. */
  private zoomAnchor(stage: HTMLElement, view: StageView, fit: CanvasFit): { x: number; y: number } {
    if (this.lastPointer) {
      const rect = stage.getBoundingClientRect();
      return { x: this.lastPointer.clientX - rect.left - stage.clientLeft, y: this.lastPointer.clientY - rect.top - stage.clientTop };
    }
    const cursor = this.cursorCell;
    if (cursor) {
      const x = this.cellCentreOnScreen(cursor.x, view.scrollLeft, view.clientWidth, view.canvasCssWidth, fit.cssTileSize);
      const y = this.cellCentreOnScreen(cursor.y, view.scrollTop, view.clientHeight, view.canvasCssHeight, fit.cssTileSize);
      if (x >= 0 && x <= view.clientWidth && y >= 0 && y <= view.clientHeight) return { x, y };
    }
    return { x: view.clientWidth / STAGE_CENTRE_DIVISOR, y: view.clientHeight / STAGE_CENTRE_DIVISOR };
  }

  /** Where the middle of a cell is on one axis of the visible stage, in CSS pixels from its start. */
  private cellCentreOnScreen(index: number, scroll: number, client: number, canvasCss: number, cssTile: number): number {
    const offset = Math.max(0, (client - canvasCss) / STAGE_CENTRE_DIVISOR);
    return offset + (index + CELL_CENTRE) * cssTile - scroll;
  }

  private scrollStage(stage: HTMLElement, to: ScrollPosition): void {
    stage.scrollLeft = to.left;
    stage.scrollTop = to.top;
  }

  /** Scrolls the stage the least that shows a cell with a cell of context around it. */
  private revealCell(cell: { x: number; y: number }): void {
    const stage = byId('editor-stage');
    const fit = this.lastFit;
    if (!stage || !fit) return;
    this.scrollStage(stage, revealScroll(cell, fit.cssTileSize, this.stageView(stage, fit)));
  }

  /** True when the level being edited is a CC3D one: its cells, not the Epoxy layers, are the map. */
  private isCc3d(): boolean {
    return this.doc.cc3d !== undefined;
  }

  /**
   * True when a click acts on the side of a cell nearest the pointer: the CC3D thin wall entry, or the Epoxy
   * thin wall entry with the brush tool.
   */
  private sideToolActive(): boolean {
    if (this.isCc3d()) return this.tool === 'brush' && this.cc3dEntry()?.action === 'panel';
    return this.tool === 'brush' && this.brush.kind === 'cell_edge';
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
    this.docRevision++;
    this.levelRunner?.cancel();
    this.checkOverlay = null;
    this.reportCache = null;
    this.resetBeamPreview();
    this.cancelCellSpeech();
    const live = byId(CELL_LIVE_ID);
    if (live) live.textContent = '';
    this.blockRunner?.dispose();
    this.history.clear();
    this.coalescer.reset();
    this.stroke = null;
    this.endLinkSession(false);
    this.resetSelectionState();
    this.hoverCell = null;
    this.cursorCell = null;
    this.resetConnectionsPointer();
    this.lastHoverCell = null;
    this.zoomOffset = 0;
    this.cleanDoc = dirty ? null : cloneDocument(this.doc);
    this.isDirty = dirty;
    this.syncCc3dChrome();
    this.applyFit();
    this.updateUndoRedoButtons();
    this.syncMetadataInputs();
    this.clearPaletteSearch();
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.setStatusText(t('editor.palette.status.ready.label'));
    this.refreshContext();
    this.updateCanvasLabel();
    // The previous level's verdict says nothing about this one: back to the idle badge and note until the next check.
    this.lastCheck = null;
    this.lastIssues = null;
    this.lastIssuesContentKey = null;
    this.issuesRevision++;
    this.updateCheckBadge(null);
    this.renderIssues();
    if (this.beamPreviewOn) this.refreshBeamPreview(this.exportCompiledLevel(), false, false);
    this.scheduleCheck();
    this.render();
    // The stage may not have its final size yet (a view just shown, a dialog just closed): fit once more after layout.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => this.applyFit());
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
    return formatValidationIssue(issue);
  }

  private formatIssues(issues: ValidationIssue[]): string {
    return issues.map((iss) => this.formatIssue(iss)).join(t('validator.status.issue_separator.label'));
  }

  public refreshTranslations(): void {
    this.syncCc3dChrome();
    this.renderCategoryTabs();
    this.renderPaletteItems();
    // The count a screen reader was told is in the old language: say it again in the new one.
    const countRegion = byId(PALETTE_SEARCH_COUNT_ID);
    if (countRegion && this.paletteQuery !== '' && this.searchCountAnnounced !== null) {
      countRegion.textContent = t(PALETTE_SEARCH_COUNT_KEY, { count: this.searchMatchCount });
      this.searchCountAnnounced = this.searchMatchCount;
    }
    this.refreshContext();
    this.syncMetadataInputs();
    this.updateCanvasLabel();
    this.updateCheckBadge(this.lastCheck);
    this.renderIssues();
    this.testFromStateKey = '';
    this.updateTestFromState();
    this.refreshConnections();
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
    const searching = this.paletteQuery !== '';
    byId(PALETTE_GRID_ID)?.setAttribute('aria-label', searching ? t(PALETTE_SEARCH_RESULTS_KEY) : active ? t(active.i18nKey) : '');
    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.type = 'button';
      // While a search is on, the results come from every tab: no tab is the one showing.
      const shown = !searching && this.activeCategory === cat.id;
      btn.setAttribute('aria-pressed', String(shown));
      btn.className = `editor-tab-btn ${shown ? 'active' : ''}`;
      if (searching) btn.classList.add(PALETTE_TAB_DIMMED_CLASS);
      btn.textContent = t(cat.i18nKey);
      btn.addEventListener('click', () => {
        this.clearPaletteSearch();
        this.activeCategory = cat.id;
        this.renderCategoryTabs();
        this.renderPaletteItems();
      });
      container.appendChild(btn);
    }
  }

  private renderCc3dCategoryTabs(container: HTMLElement): void {
    const active = CC3D_CATEGORIES.find((cat) => cat.id === this.cc3dCategory);
    const searching = this.paletteQuery !== '';
    byId(PALETTE_GRID_ID)?.setAttribute('aria-label', searching ? t(PALETTE_SEARCH_RESULTS_KEY) : active ? t(active.labelKey) : '');
    for (const cat of CC3D_CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const shown = !searching && this.cc3dCategory === cat.id;
      btn.setAttribute('aria-pressed', String(shown));
      btn.className = `editor-tab-btn ${shown ? 'active' : ''}`;
      if (searching) btn.classList.add(PALETTE_TAB_DIMMED_CLASS);
      btn.textContent = t(cat.labelKey);
      btn.addEventListener('click', () => {
        this.clearPaletteSearch();
        this.cc3dCategory = cat.id;
        this.renderCategoryTabs();
        this.renderPaletteItems();
      });
      container.appendChild(btn);
    }
  }

  /** A palette icon, drawn once per display id until the graphics style changes. */
  private cachedIcon(kind: 'tile' | 'item' | 'entity' | 'player', id: string, dir?: Direction): string {
    const key = `${kind}|${id}|${dir ?? ''}`;
    let url = this.iconCache.get(key);
    if (url === undefined) {
      url = dir === undefined ? this.renderer.renderIconToDataUrl(kind, id) : this.renderer.renderIconToDataUrl(kind, id, dir);
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
    const build = (entry: Cc3dPaletteEntry): HTMLButtonElement => {
      const display = entryDisplay(entry, this.cc3dAttrs, this.activeDir);
      const button = this.createPaletteButton(
        this.cc3dEntryLabel(entry, display),
        this.cachedIcon(display.kind, display.id),
        entry.id === this.cc3dEntryId,
        { available: true },
        () => this.selectCc3dEntry(entry)
      );
      button.dataset.brushKind = CC3D_BRUSH_KIND;
      button.dataset.brushId = entry.id;
      return button;
    };
    if (this.paletteQuery === '') {
      for (const entry of cc3dEntriesOf(this.cc3dCategory)) container.appendChild(build(entry));
    } else {
      // A search covers every tab. CC3D entries have no description: only the name is searched.
      const all = CC3D_CATEGORIES.flatMap((cat) => cc3dEntriesOf(cat.id)).map((entry) => ({
        kind: CC3D_BRUSH_KIND,
        id: entry.id,
        name: this.cc3dEntryLabel(entry, entryDisplay(entry, this.cc3dAttrs, this.activeDir)),
        category: entry.category,
        entry
      }));
      this.appendSearchResults(container, searchPalette(all, this.paletteQuery), (match) => build(match.entry));
    }
    this.renderCc3dAttributes();
  }

  /** Puts the matches in the grid, or the line that says nothing matched. The count is kept for the screen reader region. */
  private appendSearchResults<T extends SearchableEntry>(
    container: HTMLElement,
    matches: readonly T[],
    build: (match: T) => HTMLButtonElement
  ): void {
    this.searchMatchCount = matches.length;
    if (matches.length === 0) {
      const none = document.createElement('p');
      none.className = PALETTE_SEARCH_EMPTY_CLASS;
      none.textContent = t(PALETTE_SEARCH_NO_MATCH_KEY, { query: this.paletteQuery.trim() });
      container.appendChild(none);
      return;
    }
    for (const match of matches) container.appendChild(build(match));
  }

  /** Gives the focus back to the entry that held it before the grid was rebuilt. */
  private restoreGridFocus(container: HTMLElement, kind: string | undefined, id: string | undefined): void {
    if (kind === undefined || id === undefined) return;
    const again = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (btn) => btn.dataset.brushKind === kind && btn.dataset.brushId === id
    );
    again?.focus();
  }

  /**
   * Choosing a CC3D entry puts the brush back in hand, except for a layer entry while filling and on the Select
   * tool while a selection is there: the entry then waits for Shift+F to fill the selection with it.
   */
  private selectCc3dEntry(entry: Cc3dPaletteEntry): void {
    const keepSelection = this.keepsSelectionOnChoice();
    this.cc3dEntryId = entry.id;
    this.cc3dCategory = entry.category;
    if (!keepSelection && this.tool !== 'brush' && !(this.tool === 'fill' && entry.action === 'layer')) {
      this.tool = 'brush';
      this.resetSelectionState();
      this.updateToolButtons();
    }
    this.updateCanvasLabel();
    this.renderCategoryTabs();
    this.renderPaletteItems();
    if (keepSelection) {
      const refusal: ToolMessage | null = this.cc3dEntryFillable(entry) ? null : { key: MESSAGE_FILL_REFUSED_ENTRY };
      this.announceFillChoice(refusal, this.cc3dEntryLabel(entry, entryDisplay(entry, this.cc3dAttrs, this.activeDir)));
    } else if (entry.action === 'panel') {
      this.setStatusText(t('editor.cc3d.status.panel_mode'));
    }
    this.render();
  }

  /** True when a CC3D entry stands for something a rectangle can be filled with: the thin wall mode and the player start are not. */
  private cc3dEntryFillable(entry: Cc3dPaletteEntry): boolean {
    return entry.action !== 'panel' && entry.action !== 'player';
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
    if (brush.kind === 'cell_edge') return cellEdgeAvailability(ruleset);
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
    const container = byId(PALETTE_GRID_ID);
    if (!container) return;
    // A click re-renders the palette: remember which entry held focus so it can get it back.
    const focused = document.activeElement;
    const focusedKind = focused instanceof HTMLElement && container.contains(focused) ? focused.dataset.brushKind : undefined;
    const focusedId = focused instanceof HTMLElement && container.contains(focused) ? focused.dataset.brushId : undefined;
    container.innerHTML = '';
    if (this.isCc3d()) {
      this.renderCc3dPaletteItems(container);
      this.restoreGridFocus(container, focusedKind, focusedId);
      this.updateSwitchEngineButton();
      return;
    }
    byId(CC3D_ATTRS_ID)?.classList.add('hidden');

    if (this.paletteQuery !== '') {
      // A search covers every tab, in tab order then config order. The buttons are the ordinary ones: no duplicates, same gating.
      const everything = ConfigRegistry.getTiles().categories.flatMap((cat) => this.epoxyItemsOf(cat.id));
      this.appendSearchResults(container, searchPalette(everything, this.paletteQuery), (item) => this.epoxyPaletteButton(item));
    } else if (this.activeCategory === MECHANISMS_CATEGORY) {
      // Sub-headings only label the entries that follow them: they are not focusable and the tab order stays the button order.
      // An entry no rule places is still offered, under an Other heading shown only when there is one.
      const grouped = this.epoxyItemsOf(this.activeCategory).map((item) => ({ group: item.group, item: this.epoxyPaletteButton(item) }));
      for (const section of arrangeMechanismSections(grouped)) {
        const heading = document.createElement('h4');
        heading.className = 'palette-group-heading';
        heading.textContent = t(section.group.labelKey);
        container.appendChild(heading);
        for (const button of section.items) container.appendChild(button);
      }
    } else {
      for (const item of this.epoxyItemsOf(this.activeCategory)) container.appendChild(this.epoxyPaletteButton(item));
    }

    this.restoreGridFocus(container, focusedKind, focusedId);
    this.updateSwitchEngineButton();
  }

  /**
   * The Epoxy and Lynx entries of one tab, in display order: tiles, creatures, then the thin wall (Terrain) and
   * the player start (Entities). Icons are drawn only for the buttons that get built.
   */
  private epoxyItemsOf(category: string): EpoxyPaletteItem[] {
    const mechanisms = category === MECHANISMS_CATEGORY;
    const items: EpoxyPaletteItem[] = [];
    const add = (brush: Brush, name: string, icon: () => string, group: MechanismGroupId | null = null): void => {
      items.push({
        kind: brush.kind,
        id: brush.id,
        name,
        description: paletteDescription(brush.kind, brush.id, t),
        category,
        brush,
        group,
        icon
      });
    };

    for (const tile of Object.values(ConfigRegistry.getTiles().tiles).filter((candidate) => candidate.category === category)) {
      add(
        { kind: tile.layer === 'item' ? 'item' : 'terrain', id: tile.id },
        t(tile.i18nKey),
        () => this.renderer.renderIconToDataUrl(tile.layer === 'item' ? 'item' : 'tile', tile.id),
        mechanisms ? tileMechanismGroup(tile) : null
      );
    }

    for (const ent of Object.values(ConfigRegistry.getMonsters().entities).filter((candidate) => candidate.category === category)) {
      // A creature or turret is drawn facing the direction control, so the palette shows what a click will place.
      add(
        { kind: 'entity', id: ent.id },
        t(ent.i18nKey),
        () => (entityHasFacing(ent.id) ? this.cachedIcon('entity', ent.id, this.activeDir) : this.cachedIcon('entity', ent.id)),
        mechanisms ? entityMechanismGroup(ent) : null
      );
    }

    if (category === TERRAIN_CATEGORY) {
      add({ kind: 'cell_edge', id: CELL_EDGE_BRUSH_ID }, t('editor.palette.tools.cell_edge'), () =>
        this.renderer.renderIconToDataUrl('tile', CELL_EDGE_ICON_TILE)
      );
    }

    if (category === ENTITIES_CATEGORY) {
      add({ kind: 'player_start', id: EDITOR_PLAYER_BRUSH_ID }, t('editor.palette.tools.player_start'), () => this.playerIconUrl);
    }
    return items;
  }

  /** The button of an Epoxy or Lynx entry. Choosing it also opens the tab it belongs to, which a search result needs. */
  private epoxyPaletteButton(item: EpoxyPaletteItem): HTMLButtonElement {
    const button = this.createPaletteButton(
      item.name,
      item.icon(),
      this.isBrushSelected(item.brush),
      this.brushAvailability(item.brush),
      () => {
        this.activeCategory = item.category;
        this.selectBrush(item.brush);
      },
      item.description
    );
    button.dataset.brushKind = item.brush.kind;
    button.dataset.brushId = item.brush.id;
    return button;
  }

  private createPaletteButton(
    label: string,
    iconUrl: string,
    selected: boolean,
    availability: Availability,
    onClick: () => void,
    description?: string
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `palette-item-btn ${selected ? 'active' : ''}`;
    btn.setAttribute('aria-pressed', String(selected));
    btn.title = nameWithDescription(label, description);
    if (description !== undefined) btn.setAttribute('aria-description', description);
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
      btn.addEventListener('click', (ev) => {
        // A click with no pointer detail comes from the keyboard (Enter or Space on the button).
        this.lastInput = ev.detail === 0 ? 'keyboard' : 'pointer';
        onClick();
      });
    } else {
      const reason = t(availability.reasonKey);
      btn.classList.add(PALETTE_UNAVAILABLE_CLASS);
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-description', reason);
      // The reason is what the player needs to know first; the description follows it on hover.
      btn.title = description === undefined ? `${label}: ${reason}` : `${label}: ${reason} ${description}`;
      btn.addEventListener('click', () => this.setStatusText(reason));
    }
    return btn;
  }

  /**
   * Choosing a palette item puts the brush back in hand, except for a terrain tile while filling and on the Select
   * tool while a selection is there: the entry then waits for Shift+F to fill the selection with it.
   */
  private selectBrush(brush: Brush): void {
    this.endLinkSession(false);
    const hintBefore = this.sideToolActive();
    const keepSelection = this.keepsSelectionOnChoice();
    this.brush = brush;
    if (
      !keepSelection &&
      (this.tool === 'eraser' || this.tool === 'picker' || this.tool === 'select' || (this.tool === 'fill' && brush.kind !== 'terrain'))
    ) {
      this.tool = 'brush';
      this.resetSelectionState();
      this.render();
      this.updateToolButtons();
    }
    this.updateCanvasLabel();
    this.renderPaletteItems();
    if (keepSelection) {
      const refusal = fillBrushRefusal(brush, editableRulesetOf(this.doc.ruleset));
      this.announceFillChoice(refusal ? this.fillRefusalMessage(refusal) : null, this.brushLabel(brush));
    } else {
      // The thin wall keeps its own status, which already says how to use it; every other entry says what it does and needs.
      if (brush.kind === 'cell_edge') this.setStatusText(t('editor.palette.status.cell_edge_mode'));
      else {
        const description = paletteDescription(brush.kind, brush.id, t);
        if (description !== undefined) this.setStatusText(nameWithDescription(this.brushLabel(brush), description));
      }
    }
    // The side bar of the thin wall tool appears and goes away with its entry.
    if (hintBefore || this.sideToolActive()) this.render();
  }

  private updateSwitchEngineButton(): void {
    byId('editor-switch-epoxy-btn')?.classList.toggle('hidden', this.isCc3d() || !this.hasUnavailableItems());
  }

  /** Puts the keyboard focus in the palette search field, its text selected (the "/" key). */
  public focusPaletteSearch(): void {
    const input = byId<HTMLInputElement>(PALETTE_SEARCH_INPUT_ID);
    if (!input) return;
    input.focus();
    input.select();
  }

  /** Ends the search: the field and the count region are emptied. The caller redraws the tabs and the grid. */
  private clearPaletteSearch(): void {
    this.paletteQuery = '';
    this.searchMatchCount = 0;
    this.searchCountAnnounced = null;
    this.cancelSearchCount();
    const input = byId<HTMLInputElement>(PALETTE_SEARCH_INPUT_ID);
    if (input) input.value = '';
    const region = byId(PALETTE_SEARCH_COUNT_ID);
    if (region) region.textContent = '';
  }

  private cancelSearchCount(): void {
    if (this.searchCountTimer === null) return;
    clearTimeout(this.searchCountTimer);
    this.searchCountTimer = null;
  }

  /** Redraws the palette for a new query. The focus stays in the field: typing never moves it. */
  private applyPaletteQuery(value: string): void {
    this.paletteQuery = value.trim();
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.scheduleSearchCount();
  }

  /** Tells a screen reader how many entries match once the typing has paused, and only when the number changed. */
  private scheduleSearchCount(): void {
    this.cancelSearchCount();
    const region = byId(PALETTE_SEARCH_COUNT_ID);
    if (!region) return;
    if (this.paletteQuery === '') {
      region.textContent = '';
      this.searchCountAnnounced = null;
      return;
    }
    this.searchCountTimer = setTimeout(() => {
      this.searchCountTimer = null;
      if (this.disposed || this.paletteQuery === '') return;
      const count = this.searchMatchCount;
      if (count === this.searchCountAnnounced) return;
      this.searchCountAnnounced = count;
      region.textContent = t(PALETTE_SEARCH_COUNT_KEY, { count });
    }, EDITOR_PALETTE_SEARCH_COUNT_DELAY_MS);
  }

  /** Clicks the first match the level's engine allows, as a click on it would, then hands the keyboard back to the map. */
  private pickFirstSearchResult(): void {
    if (this.paletteQuery === '') return;
    const grid = byId(PALETTE_GRID_ID);
    const first = grid?.querySelector<HTMLButtonElement>(`button:not(.${PALETTE_UNAVAILABLE_CLASS})`);
    if (!first) return;
    first.click();
    this.clearPaletteSearch();
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.canvas.focus({ preventScroll: true });
  }

  private bindPaletteSearch(): void {
    const input = byId<HTMLInputElement>(PALETTE_SEARCH_INPUT_ID);
    if (!input) return;
    input.addEventListener('input', () => this.applyPaletteQuery(input.value));
    input.addEventListener('keydown', (ev) => {
      if (ev.isComposing || ev.keyCode === IME_COMPOSITION_KEY_CODE) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        if (input.value === '') {
          this.canvas.focus({ preventScroll: true });
          return;
        }
        this.clearPaletteSearch();
        this.renderCategoryTabs();
        this.renderPaletteItems();
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        this.pickFirstSearchResult();
      } else if (ev.key === 'ArrowDown') {
        const firstResult = byId(PALETTE_GRID_ID)?.querySelector<HTMLButtonElement>('button');
        if (!firstResult) return;
        ev.preventDefault();
        ev.stopPropagation();
        firstResult.focus();
      }
    });
  }

  private bindPaletteChrome(): void {
    this.bindPaletteSearch();
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
    // Not passive: the Control wheel is the browser's page zoom, which this takes over on the map only.
    byId('editor-stage')?.addEventListener('wheel', (ev) => this.onStageWheel(ev as WheelEvent), {
      passive: false,
      signal: this.draftListeners.signal
    });
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

  /**
   * Turns the creature or turret on the keyboard cursor cell (else the last hovered one) a quarter turn clockwise, as
   * one history step. A clone machine under it copies the new facing.
   */
  private rotateEntityInPlace(): void {
    const cell = pickTestCell(this.cursorCell, this.lastHoverCell);
    const entity = cell && !this.doc.cc3d ? this.doc.entities.find((e) => e.x === cell.x && e.y === cell.y) : undefined;
    if (!cell || !entity || !entityHasFacing(entity.type)) {
      this.announce([{ key: 'editor.layout.status.rotate_nothing.label' }]);
      return;
    }
    const dir = rotateClockwise(entity.dir);
    const before = this.doc;
    const result = paintEntity(before, cell.x, cell.y, entity.type, dir);
    if (!result.changed) return;
    this.doc = withEditedMap(before, result.map);
    this.recordChange(before);
    this.render();
    this.announce([
      {
        key: 'editor.layout.status.rotated.label',
        params: { name: entityDisplayName(entity.type), x: cell.x, y: cell.y, side: sideDisplayName(dir) }
      },
      ...(result.clonerTemplates ?? []).map(clonerTemplateMessage)
    ]);
  }

  /** The direction control changed: the buttons follow it, and the CC3D icons that show a direction are redrawn. */
  private afterDirectionChange(): void {
    this.updateDirButtons();
    if (!this.isCc3d()) {
      // The icons of the creatures and turrets show the facing a click will place.
      const showsFacing = Object.values(ConfigRegistry.getMonsters().entities).some(
        (ent) => ent.category === this.activeCategory && entityHasFacing(ent.id)
      );
      if (showsFacing) this.renderPaletteItems();
      // The keyboard side of the thin wall tool is the direction control: its bar follows it.
      if (this.sideToolActive()) this.render();
      return;
    }
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
   * eraser describes its two modes, the export buttons follow the formats the level can take, and the
   * fields that do not apply (win rule, chips) give way to the layers of the cursor cell.
   */
  private syncCc3dChrome(): void {
    const cc3d = this.isCc3d();
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tool]'))) {
      const tool = btn.dataset.tool as EditorTool;
      const defaultTitleKey = btn.dataset.i18nTitle ?? '';
      if (cc3d && tool === 'eraser') btn.title = t('editor.cc3d.eraser.title');
      else if (defaultTitleKey) btn.title = t(defaultTitleKey);
    }
    // A CC3D level is written to its XML file; the .CCL format cannot hold it.
    const ccl = byId<HTMLButtonElement>('editor-export-ccl-btn');
    if (ccl) {
      const reason = t('editor.toolbar.export_ccl.reason');
      ccl.disabled = cc3d;
      ccl.classList.toggle('is-unavailable', cc3d);
      if (cc3d) {
        ccl.setAttribute('aria-disabled', 'true');
        ccl.setAttribute('aria-description', reason);
        ccl.title = reason;
      } else {
        ccl.removeAttribute('aria-disabled');
        ccl.removeAttribute('aria-description');
        ccl.removeAttribute('title');
      }
    }
    byId('editor-export-xml-btn')?.classList.toggle('hidden', !cc3d);
    for (const id of ['editor-field-winrule', 'editor-field-chips']) byId(id)?.classList.toggle('hidden', cc3d);
    this.updateToolButtons();
    this.refreshLayersList();
    this.updateBeamPreviewButton();
    this.updateStampsButton();
  }

  public setTool(tool: EditorTool): void {
    this.endLinkSession(false);
    if (tool === this.tool) return;
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
      case 'rotate_in_place':
        // A floating stamp turns between its two layouts; an ordinary paste leaves the key to the creature under the cursor.
        if (this.pasting && this.floatingStamp) this.turnStamp();
        else this.rotateEntityInPlace();
        break;
      case 'test_from_here':
        void this.testFromHere();
        break;
      case 'toggle_beam_preview':
        this.toggleBeamPreview();
        break;
      case 'toggle_issue_markers':
        this.toggleIssueMarkers();
        break;
      case 'link':
        this.linkFromKeyboard();
        break;
      case 'zoom_in':
        if (this.lastFit?.canZoomIn !== false) this.setZoomOffset(zoomIn(this.zoomOffset));
        break;
      case 'zoom_out':
        if (this.lastFit?.canZoomOut !== false) this.setZoomOffset(zoomOut(this.zoomOffset));
        break;
      case 'zoom_fit':
        this.setZoomOffset(0);
        break;
      case 'cancel':
        if (this.cancelPaste() || this.dropSelection(true)) break;
        this.endLinkSession(true);
        break;
    }
  }

  /**
   * The K key: starts a link session on the device at the cell the keyboard cursor or the pointer is on. On the
   * session's own device it ends the session; on another device it moves the session there; on a cell with no device
   * it says there is nothing to link. A CC3D level starts nothing.
   */
  private linkFromKeyboard(): void {
    if (this.stroke) {
      this.announce([{ key: LINK_BUSY_KEY }]);
      return;
    }
    if (this.isCc3d()) {
      this.announce([{ key: LINK_UNAVAILABLE_KEY }]);
      return;
    }
    const cell = pickTestCell(this.cursorCell, this.lastHoverCell);
    if (!cell) {
      this.announce([{ key: LINK_NOTHING_KEY }]);
      return;
    }
    const session = this.linkSession;
    if (session && session.x === cell.x && session.y === cell.y) {
      this.endLinkSession(true);
      return;
    }
    this.startLinkAt(cell);
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
    await this.openLevel(pack.id, pack.levels[0].id);
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

    byId('editor-fill-selection-btn')?.addEventListener('click', () => {
      this.fillSelectionFromButton();
    });

    this.bindStampsMenu();

    byId('editor-test-btn')?.addEventListener('click', () => {
      void this.testPlay();
    });

    byId('editor-test-from-btn')?.addEventListener('click', () => {
      void this.testFromHere();
    });

    byId('editor-beam-preview-btn')?.addEventListener('click', () => {
      this.toggleBeamPreview();
    });

    byId('editor-issue-markers-btn')?.addEventListener('click', () => {
      this.toggleIssueMarkers();
    });
    this.updateIssueMarkersButton();

    for (const tool of EDITOR_TOOLS) {
      document.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)?.addEventListener('click', () => {
        this.setTool(tool);
      });
    }

    byId('editor-validate-btn')?.addEventListener('click', () => {
      this.runExplicitCheck();
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
      const notices = [lossyExportNotice(encoded), encoded.levelCount > 0 ? datLinkCapNotice(compiled) : null].filter(
        (notice): notice is string => notice !== null
      );
      if (notices.length > 0) this.setStatusText(notices.join(SEPARATOR_BETWEEN_MESSAGES));
    });

    byId('editor-export-xml-btn')?.addEventListener('click', () => this.exportCc3dXml());

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

    byId<HTMLSelectElement>(HIDDEN_TERRAIN_INPUT_ID)?.addEventListener('change', (ev) =>
      this.setHiddenTerrain((ev.target as HTMLSelectElement).value)
    );

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

  /**
   * Recomputes the badge once the player stops editing for a moment. A check still running for the
   * previous content is abandoned at once; the new one starts when the timer fires.
   */
  private scheduleCheck(): void {
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.levelRunner?.cancel();
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      this.runScheduledCheck();
    }, EDITOR_CHECK_DEBOUNCE_MS);
  }

  /** The check the timer fires: off the UI thread, except for CC3D and for content already checked. */
  private runScheduledCheck(): void {
    const compiled = this.exportCompiledLevel();
    const key = this.currentCheckKey();
    const report = this.syncReport(key, compiled);
    if (report) {
      this.applyReport(key, report);
    } else {
      this.showChecking();
      this.runningCheckKey = key;
      this.runningCheckCacheable = true;
      this.runningCheckDeep = false;
      this.levelCheckRunner().run(compiled, EDITOR_AUTO_CHECK_TIMEOUT_MS, (result) => this.onScheduledCheckDone(key, result));
    }
    if (this.beamPreviewOn) this.refreshBeamPreview(compiled, false);
  }

  private onScheduledCheckDone(key: string, result: LevelCheckResult): void {
    if (result.kind === 'cancelled' || this.disposed) return;
    // The content changed without a check being scheduled (a stroke in progress): the next edit step checks again.
    if (key !== this.currentCheckKey()) {
      this.scheduleCheck();
      return;
    }
    if (result.kind === 'report') this.applyReport(key, result.report);
    else this.showAbandoned(result.kind === 'error' ? 'error' : 'skipped');
  }

  /** The report available without waiting: the one cached for this content, or a CC3D validation (always inline). */
  private syncReport(key: string, compiled: CompiledLevel, deep = false): LevelValidationReport | null {
    // A default report is not the answer to a deep check; a deep one answers both.
    if (this.reportCache?.key === key && (this.reportCache.deep || !deep)) return this.reportCache.report;
    return this.isCc3d() ? LevelValidator.validate(compiled, storedSolutionWins, deep ? DEEP_CHECK_OPTIONS : undefined) : null;
  }

  /** Keeps a finished report for its content and shows it on the badge and in the issues list. */
  private applyReport(key: string, report: LevelValidationReport, deep = false): void {
    // A default report never replaces a deep one of the same content.
    // Every caller passes the check key of the content as it is now, so the content key of the report is the current one.
    if (deep || this.reportCache?.key !== key || !this.reportCache.deep) {
      this.reportCache = { key, contentKey: this.currentBeamPreviewKey(), report, deep };
    }
    const cached = this.reportCache;
    const shown = cached?.report ?? report;
    this.checkOverlay = null;
    this.setCheck(summarizeValidation(shown), shown.issues, cached?.contentKey ?? this.currentBeamPreviewKey());
  }

  /** The badge says a check is running; the issues of the last one stay, dimmed. */
  private showChecking(): void {
    this.checkOverlay = 'checking';
    this.updateCheckBadge(this.lastCheck);
    this.renderIssues();
    this.refreshConnections();
  }

  /** Puts the cached verdict of this content back on the badge, over a "checking" overlay; false when none is cached. */
  private restoreCachedVerdict(key: string): boolean {
    const cached = this.reportCache;
    if (cached?.key !== key) return false;
    this.applyReport(key, cached.report, cached.deep);
    return true;
  }

  /** The badge says the check was abandoned (too slow, failed, or cut short); the issues of the last one stay, dimmed. */
  private showAbandoned(overlay: 'skipped' | 'interrupted' | 'error'): void {
    this.checkOverlay = overlay;
    this.updateCheckBadge(this.lastCheck);
    this.renderIssues();
    this.refreshConnections();
  }

  /** Abandons a check running for content that just changed, and checks again once the edits settle. */
  private cancelRunningCheck(): void {
    const runner = this.levelRunner;
    if (!runner?.isRunning()) return;
    // A save changes no content: the check of the content as it is goes on.
    if (this.runningCheckKey === this.currentCheckKey()) return;
    runner.cancel();
    if (!this.disposed) this.scheduleCheck();
  }

  /** The Check button: the verdict now when it is known without waiting, else off the UI thread. */
  private runExplicitCheck(): void {
    if (this.testCheckPending) {
      // Test is already checking this level: show that, instead of starting a second check.
      this.refreshRunningStatus();
      return;
    }
    const compiled = this.exportCompiledLevel();
    const key = this.currentCheckKey();
    const report = this.syncReport(key, compiled, true);
    if (report) {
      this.applyReport(key, report, true);
      this.showCheckOutcome(compiled, report);
      return;
    }
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.showChecking();
    const token = this.beginRunningStatus();
    const onDone = (result: LevelCheckResult): void => this.onExplicitCheckDone(key, compiled, token, result);
    // A deep check already running on this content is waited for; a default automatic one is replaced by this deep run.
    if (this.joinRunningCheck(key, EDITOR_AUTO_CHECK_TIMEOUT_MS, onDone, true)) return;
    this.runningCheckKey = key;
    this.runningCheckCacheable = true;
    this.runningCheckDeep = true;
    this.levelCheckRunner().run(compiled, EDITOR_AUTO_CHECK_TIMEOUT_MS, onDone, DEEP_CHECK_OPTIONS);
  }

  /** The Check button's check ended: the badge, and the status line unless a later run owns it now. */
  private onExplicitCheckDone(key: string, compiled: CompiledLevel, token: number, result: LevelCheckResult): void {
    if (result.kind === 'cancelled' || this.disposed) {
      this.endRunningStatus(token, true);
      return;
    }
    if (key !== this.currentCheckKey()) {
      this.endRunningStatus(token, true);
      this.scheduleCheck();
      return;
    }
    // Whether this run still owns the status line: a Test that joined it shows its own wait there.
    const owned = this.runningStatus?.token === token;
    if (result.kind === 'report') {
      this.endRunningStatus(token, false);
      this.applyReport(key, result.report, true);
      if (owned) this.showCheckOutcome(compiled, result.report);
      return;
    }
    const failed = result.kind === 'error';
    // A cached default verdict stays on the badge; the notice goes to the status line only.
    if (!this.restoreCachedVerdict(key)) this.showAbandoned(failed ? 'error' : 'skipped');
    const untouched = owned && this.runningStatus?.writes === this.statusWrites;
    this.endRunningStatus(token, false);
    if (untouched) this.setStatusText(t(failed ? 'editor.check.error.label' : 'editor.check.skipped.label'));
  }

  /** Attaches to the check running in the worker when it is of this very content; false when there is none to join. */
  private joinRunningCheck(
    key: string,
    timeoutMs: number,
    onDone: (result: LevelCheckResult) => void,
    deep: boolean
  ): boolean {
    const runner = this.levelRunner;
    if (!runner?.isRunning() || !this.runningCheckCacheable || this.runningCheckKey !== key) return false;
    if (deep && !this.runningCheckDeep) return false;
    return runner.join(timeoutMs, onDone);
  }

  /**
   * Starts a run that writes "checking" on the status line, remembering what it said before (a run that
   * takes over from another one keeps that older text). Returns the token that run ends the line with.
   */
  private beginRunningStatus(): number {
    const statusBar = document.getElementById('editor-status-bar');
    const previous = this.runningStatus?.previous ?? statusBar?.textContent ?? '';
    const token = ++this.statusTokenSeq;
    this.setStatusText(t('editor.check.running.label'));
    this.runningStatus = { previous, writes: this.statusWrites, token };
    return token;
  }

  /** Writes "checking" on the status line again for the run that owns it, without taking its token. */
  private refreshRunningStatus(): void {
    const running = this.runningStatus;
    if (!running) return;
    this.setStatusText(t('editor.check.running.label'));
    this.runningStatus = { ...running, writes: this.statusWrites };
  }

  /**
   * Ends the "checking" line of the run `token`, only when that run still owns it. The line is put back as
   * it was only when nothing else wrote to the status line since. True when the run owned the line.
   */
  private endRunningStatus(token: number, restore: boolean): boolean {
    const running = this.runningStatus;
    if (!running || running.token !== token) return false;
    this.runningStatus = null;
    if (restore && running.writes === this.statusWrites) this.setStatusText(running.previous);
    return true;
  }

  /** What an explicit Check reports besides the badge: the issues section opens and the status line gives the verdict. */
  private showCheckOutcome(compiled: CompiledLevel, report: LevelValidationReport): void {
    const issuesSection = byId<HTMLDetailsElement>(ISSUES_SECTION_ID);
    if (issuesSection) issuesSection.open = true;
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
  }

  // ---------------------------------------------------------------------------
  // Beam preview
  // ---------------------------------------------------------------------------

  /** Whether the beam preview is shown; a session choice, never saved. */
  private beamPreviewOn = false;
  private beamPreview: BeamPreview = EMPTY_BEAM_PREVIEW;
  /** The beams painted once, to be copied on every frame while nothing about them changes. */
  private beamLayer: { key: string; canvas: HTMLCanvasElement } | null = null;
  /** The load and document content the preview was computed for. */
  private beamPreviewKey = '';
  /** The summary announced last, so a recompute that changes nothing stays silent. */
  private beamSummaryAnnounced = '';

  /** The content key: the load and the document revision, whatever the language. */
  private currentBeamPreviewKey(): string {
    return `${this.loadGeneration}:${this.docRevision}`;
  }

  /** The key a check report is cached under: the content, and the language its issues are worded in. */
  private currentCheckKey(): string {
    return `${i18n.getLocale()}:${this.currentBeamPreviewKey()}`;
  }

  // ---------------------------------------------------------------------------
  // Issue markers
  // ---------------------------------------------------------------------------

  /** Whether the validator issues are marked on the map; a session choice, never saved. */
  private issueMarkersOn = true;
  /** The content key (load and document revision) of the report lastIssues come from, or null before any. */
  private lastIssuesContentKey: string | null = null;
  /** The markers built for one issues array and grid size, so a pointer move does not rebuild them. */
  private markerMemo: { issues: ValidationIssue[]; width: number; height: number; markers: IssueMarker[] } | null = null;
  /** The severity colours read from the theme tokens, for the biome accent they were read under. */
  private markerColors: { accent: string; error: string; warning: string; info: string } | null = null;

  private issueMarkersFor(issues: ValidationIssue[]): IssueMarker[] {
    const width = this.mapWidth();
    const height = this.mapHeight();
    const memo = this.markerMemo;
    if (memo && memo.issues === issues && memo.width === width && memo.height === height) return memo.markers;
    const markers = buildIssueMarkers(issues, width, height);
    this.markerMemo = { issues, width, height, markers };
    return markers;
  }

  /** The severity colours from the theme tokens (info follows the biome accent), read again only when the accent changes. */
  private issueMarkerColors(): { error: string; warning: string; info: string } {
    const accent = document.documentElement.style.getPropertyValue(BIOME_ACCENT_CSS_VAR);
    if (this.markerColors?.accent === accent) return this.markerColors;
    const computed = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string): string => computed.getPropertyValue(name).trim() || fallback;
    this.markerColors = {
      accent,
      error: read(EDITOR_ISSUE_MARKER_ERROR_CSS_VAR, EDITOR_ISSUE_MARKER_FALLBACK_ERROR),
      warning: read(EDITOR_ISSUE_MARKER_WARNING_CSS_VAR, EDITOR_ISSUE_MARKER_FALLBACK_WARNING),
      info: read(BIOME_ACCENT_CSS_VAR, EDITOR_ISSUE_MARKER_FALLBACK_INFO)
    };
    return this.markerColors;
  }

  private updateIssueMarkersButton(): void {
    byId('editor-issue-markers-btn')?.setAttribute('aria-pressed', String(this.issueMarkersOn));
  }

  /** Shows or hides the issue markers (button and M key). */
  private toggleIssueMarkers(): void {
    this.issueMarkersOn = !this.issueMarkersOn;
    this.updateIssueMarkersButton();
    this.setStatusText(t(this.issueMarkersOn ? 'editor.issue_markers.on.label' : 'editor.issue_markers.off.label'));
    this.render();
  }

  /**
   * Marks the cells the last report names, in the top left corner: a filled square with an x for errors, a filled
   * triangle with ! for warnings, a small hollow circle for hints, with the count written on a large tile. On a
   * small tile a border in the severity colour replaces the mark (errors and warnings only). Markers whose report
   * lags the last edit are dimmed and only outlined. Nothing is drawn before a report or after another level loads.
   */
  private drawIssueMarkers(s: number): void {
    const issues = this.lastIssues;
    if (!this.issueMarkersOn || issues === null || this.lastIssuesContentKey === null) return;
    const markers = this.issueMarkersFor(issues);
    if (markers.length === 0) return;
    const stale = markerFreshness(this.lastIssuesContentKey, this.currentBeamPreviewKey()) === 'stale';
    const colors = this.issueMarkerColors();
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = stale ? EDITOR_ISSUE_MARKER_STALE_ALPHA : 1;
    for (const marker of markers) {
      const color = colors[marker.severity];
      if (s < EDITOR_ISSUE_MARKER_ZOOM_THRESHOLD_PX) {
        if (marker.severity !== 'info') this.drawIssueCellBorder(marker, color, s);
      } else if (marker.severity === 'error') {
        this.drawErrorMarker(marker, color, s, stale);
      } else if (marker.severity === 'warning') {
        this.drawWarningMarker(marker, color, s, stale);
      } else {
        this.drawInfoMarker(marker, color, s);
      }
    }
    ctx.restore();
  }

  private drawIssueCellBorder(marker: IssueMarker, color: string, s: number): void {
    const half = EDITOR_ISSUE_MARKER_BORDER_WIDTH / 2;
    this.ctx.lineWidth = EDITOR_ISSUE_MARKER_BORDER_WIDTH;
    this.ctx.strokeStyle = color;
    this.ctx.strokeRect(marker.x * s + half, marker.y * s + half, s - EDITOR_ISSUE_MARKER_BORDER_WIDTH, s - EDITOR_ISSUE_MARKER_BORDER_WIDTH);
  }

  private issueMarkerSize(s: number): number {
    return Math.max(EDITOR_ISSUE_MARKER_MIN_PX, EDITOR_ISSUE_MARKER_TILE * s);
  }

  /** Fills (fresh) or strokes (stale) the path in the severity colour, with the thin dark outline around a fresh one. */
  private paintIssueShape(color: string, stale: boolean): void {
    const ctx = this.ctx;
    if (stale) {
      ctx.lineWidth = EDITOR_ISSUE_MARKER_STROKE_WIDTH;
      ctx.strokeStyle = color;
      ctx.stroke();
      return;
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = EDITOR_ISSUE_MARKER_OUTLINE_WIDTH;
    ctx.strokeStyle = EDITOR_ISSUE_MARKER_OUTLINE_COLOR;
    ctx.stroke();
  }

  private drawErrorMarker(marker: IssueMarker, color: string, s: number, stale: boolean): void {
    const ctx = this.ctx;
    const size = this.issueMarkerSize(s);
    const x0 = marker.x * s + EDITOR_ISSUE_MARKER_INSET_PX;
    const y0 = marker.y * s + EDITOR_ISSUE_MARKER_INSET_PX;
    ctx.beginPath();
    ctx.rect(x0, y0, size, size);
    this.paintIssueShape(color, stale);
    const g = size * EDITOR_ISSUE_MARKER_GLYPH_INSET;
    ctx.beginPath();
    ctx.moveTo(x0 + g, y0 + g);
    ctx.lineTo(x0 + size - g, y0 + size - g);
    ctx.moveTo(x0 + size - g, y0 + g);
    ctx.lineTo(x0 + g, y0 + size - g);
    ctx.lineWidth = EDITOR_ISSUE_MARKER_OUTLINE_WIDTH;
    ctx.strokeStyle = stale ? color : EDITOR_ISSUE_MARKER_GLYPH_COLOR;
    ctx.stroke();
    this.drawIssueCount(marker, x0, y0, size, s);
  }

  private drawWarningMarker(marker: IssueMarker, color: string, s: number, stale: boolean): void {
    const ctx = this.ctx;
    const size = this.issueMarkerSize(s);
    const x0 = marker.x * s + EDITOR_ISSUE_MARKER_INSET_PX;
    const y0 = marker.y * s + EDITOR_ISSUE_MARKER_INSET_PX;
    ctx.beginPath();
    ctx.moveTo(x0 + size / 2, y0);
    ctx.lineTo(x0 + size, y0 + size);
    ctx.lineTo(x0, y0 + size);
    ctx.closePath();
    this.paintIssueShape(color, stale);
    ctx.fillStyle = stale ? color : EDITOR_ISSUE_MARKER_GLYPH_COLOR;
    ctx.font = `bold ${size * EDITOR_ISSUE_MARKER_GLYPH_FONT}px ${EDITOR_ISSUE_MARKER_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', x0 + size / 2, y0 + size * EDITOR_ISSUE_MARKER_BANG_Y);
    this.drawIssueCount(marker, x0, y0, size, s);
  }

  private drawInfoMarker(marker: IssueMarker, color: string, s: number): void {
    const ctx = this.ctx;
    const size = this.issueMarkerSize(s) * EDITOR_ISSUE_MARKER_INFO_SCALE;
    const x0 = marker.x * s + EDITOR_ISSUE_MARKER_INSET_PX;
    const y0 = marker.y * s + EDITOR_ISSUE_MARKER_INSET_PX;
    ctx.beginPath();
    ctx.arc(x0 + size / 2, y0 + size / 2, size / 2, 0, Math.PI * 2);
    ctx.lineWidth = EDITOR_ISSUE_MARKER_STROKE_WIDTH + 2 * EDITOR_ISSUE_MARKER_OUTLINE_WIDTH;
    ctx.strokeStyle = EDITOR_ISSUE_MARKER_OUTLINE_COLOR;
    ctx.stroke();
    ctx.lineWidth = EDITOR_ISSUE_MARKER_STROKE_WIDTH;
    ctx.strokeStyle = color;
    ctx.stroke();
    this.drawIssueCount(marker, x0, y0, size, s);
  }

  /** The number of issues on a cell, written beside its marker when more than one names it and the tile is large. */
  private drawIssueCount(marker: IssueMarker, x0: number, y0: number, size: number, s: number): void {
    if (marker.count <= 1 || s < EDITOR_ISSUE_MARKER_COUNT_MIN_TILE_PX) return;
    const ctx = this.ctx;
    const text = String(marker.count);
    const x = x0 + size + EDITOR_ISSUE_MARKER_INSET_PX;
    ctx.font = `bold ${size * EDITOR_ISSUE_MARKER_GLYPH_FONT}px ${EDITOR_ISSUE_MARKER_FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = EDITOR_ISSUE_MARKER_STROKE_WIDTH;
    ctx.strokeStyle = EDITOR_ISSUE_MARKER_OUTLINE_COLOR;
    ctx.strokeText(text, x, y0);
    ctx.fillStyle = EDITOR_ISSUE_MARKER_GLYPH_COLOR;
    ctx.fillText(text, x, y0);
  }

  /** Forgets the preview of the previous level, so its beams are never drawn on the next one. */
  private resetBeamPreview(): void {
    this.beamPreview = EMPTY_BEAM_PREVIEW;
    this.beamPreviewKey = '';
    this.beamLayer = null;
    this.beamSummaryAnnounced = '';
  }

  /** Why the beam preview cannot run on this level, as a locale key, or null when it can. */
  private beamPreviewUnavailableKey(): string | null {
    if (this.isCc3d()) return 'editor.beam_preview.unavailable_cc3d.label';
    if (editableRulesetOf(this.doc.ruleset) === LYNX_RULESET) return 'editor.beam_preview.unavailable_lynx.label';
    return null;
  }

  private beamPreviewSummary(): string {
    const { beamCells, litReceivers, totalReceivers, gatesOpening } = this.beamPreview;
    return t('editor.beam_preview.summary.label', {
      cells: beamCells.length,
      lit: litReceivers.length,
      total: totalReceivers,
      gates: gatesOpening.length
    });
  }

  /** The Beams button: pressed state, and unavailable with the reason on a level the preview does not cover. */
  private updateBeamPreviewButton(): void {
    const reasonKey = this.beamPreviewUnavailableKey();
    const wasOn = this.beamPreviewOn;
    if (reasonKey !== null) this.beamPreviewOn = false;
    if (wasOn && !this.beamPreviewOn) {
      this.beamSummaryAnnounced = '';
      this.render();
    }
    const button = byId<HTMLButtonElement>('editor-beam-preview-btn');
    if (!button) return;
    button.classList.toggle('is-unavailable', reasonKey !== null);
    if (reasonKey !== null) {
      button.setAttribute('aria-disabled', 'true');
      button.setAttribute('aria-description', t(reasonKey));
    } else {
      button.removeAttribute('aria-disabled');
      button.removeAttribute('aria-description');
    }
    button.setAttribute('aria-pressed', String(this.beamPreviewOn));
    button.title =
      reasonKey !== null
        ? t(reasonKey)
        : this.beamPreviewOn && this.beamPreview.hasLasers
          ? this.beamPreviewSummary()
          : t('editor.beam_preview.title.label');
  }

  /** Computes the preview of a compiled level; announces the summary on request or when it changed. */
  private refreshBeamPreview(compiled: CompiledLevel, announce: boolean, redraw = true): void {
    this.beamPreview = computeBeamPreview(compiled);
    this.beamLayer = null;
    this.beamPreviewKey = this.currentBeamPreviewKey();
    const text = this.beamPreview.hasLasers ? this.beamPreviewSummary() : t('editor.beam_preview.none.label');
    if (announce || text !== this.beamSummaryAnnounced) this.setStatusText(text);
    this.beamSummaryAnnounced = text;
    this.updateBeamPreviewButton();
    if (redraw) this.render();
  }

  /** Shows or hides the beam preview (button and L key). */
  private toggleBeamPreview(): void {
    const reasonKey = this.beamPreviewUnavailableKey();
    if (reasonKey !== null) {
      this.setStatusText(t(reasonKey));
      return;
    }
    this.beamPreviewOn = !this.beamPreviewOn;
    if (this.beamPreviewOn) {
      this.refreshBeamPreview(this.exportCompiledLevel(), true);
      return;
    }
    this.beamSummaryAnnounced = '';
    this.setStatusText(t('editor.beam_preview.off.label'));
    this.updateBeamPreviewButton();
    this.render();
  }

  /**
   * Paints the beams of the preview over the map: tick 0 at full strength, the later facings of a turning
   * turret dimmed, and a marker on each gate about to open. A preview that lags the last edit is dimmed
   * until the check timer catches up.
   */
  private drawBeamPreview(s: number): void {
    const preview = this.beamPreview;
    if (!this.beamPreviewOn || !preview.hasLasers) return;
    const alpha = this.beamPreviewKey === this.currentBeamPreviewKey() ? 1 : EDITOR_BEAM_STALE_ALPHA;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    const layer = this.beamPreviewLayer(preview, s);
    if (layer) ctx.drawImage(layer, 0, 0);
    else this.paintBeamPreview(ctx, preview, s);
    ctx.restore();
  }

  /**
   * The beams painted once into an off-screen canvas, keyed on the preview, the tile size, the look and the
   * canvas size, so a pointer move only copies them. Null (paint directly) when no canvas can be created.
   */
  private beamPreviewLayer(preview: BeamPreview, s: number): HTMLCanvasElement | null {
    const { width, height } = this.canvas;
    const key = `${this.beamPreviewKey}|${s}|${this.renderer.getAppearanceKey()}|${width}x${height}`;
    if (this.beamLayer?.key === key) return this.beamLayer.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const layerCtx = canvas.getContext('2d');
    if (!layerCtx) return null;
    layerCtx.imageSmoothingEnabled = false;
    this.paintBeamPreview(layerCtx, preview, s);
    this.beamLayer = { key, canvas };
    return canvas;
  }

  /** Paints the beams at tick 0, the dimmed later facings of the turning turrets and the gate markers. */
  private paintBeamPreview(ctx: CanvasRenderingContext2D, preview: BeamPreview, s: number): void {
    const board = {
      entities: this.doc.entities.map((entity) => ({ ...entity, kind: ConfigRegistry.getEntityDef(entity.type)?.kind ?? '' })),
      terrain: this.doc.terrain,
      originX: 0,
      originY: 0,
      region: { x0: 0, y0: 0 },
      unit: s,
      round: true
    };
    ctx.save();
    ctx.globalAlpha = 1;
    this.renderer.drawBeamCells(ctx, {
      ...board,
      cells: preview.beamCells,
      emitterCells: preview.emitterCells,
      litReceivers: preview.litReceivers
    });
    ctx.globalAlpha = EDITOR_BEAM_DIM_ALPHA;
    this.renderer.drawBeamCells(ctx, { ...board, cells: preview.dimTurretCells, emitterCells: [], litReceivers: [] });
    ctx.globalAlpha = 1;
    ctx.lineWidth = EDITOR_OVERLAY_LINE_WIDTH;
    ctx.strokeStyle = EDITOR_BEAM_GATE_COLOR;
    const inset = s * EDITOR_BEAM_GATE_INSET_TILE;
    for (const gate of preview.gatesOpening) ctx.strokeRect(gate.x * s + inset, gate.y * s + inset, s - inset * 2, s - inset * 2);
    ctx.restore();
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

  /** The editor view is shown again: content that was not checked before the view was left is checked now. */
  public onEnter(): void {
    if (this.disposed) return;
    if (this.reportCache?.key !== this.currentCheckKey()) this.scheduleCheck();
  }

  /** Gives the keyboard back to the canvas, without scrolling the page. */
  public focusCanvas(): void {
    this.canvas.focus({ preventScroll: true });
  }

  /** Puts the outcome of a test run on the status line; the level itself is not touched. */
  public showTestRunResult(text: string): void {
    if (this.disposed) return;
    this.setStatusText(text);
  }

  /** The editor view is left: stops the check and releases the idle worker. */
  public onLeave(): void {
    this.cancelCellSpeech();
    this.flushDraft();
    this.abortBlockCheck();
    this.blockRunner?.dispose();
    const cutShort =
      this.checkOverlay === 'checking' ||
      this.checkTimer !== null ||
      this.testCheckPending ||
      (this.levelRunner?.isRunning() ?? false);
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.checkAbortEpoch++;
    this.levelRunner?.dispose();
    // A check cut short leaves the badge saying so, never an old verdict as if it were current: coming back checks again.
    if (cutShort && this.reportCache?.key !== this.currentCheckKey()) this.showAbandoned('interrupted');
    else if (this.checkOverlay === 'checking') {
      this.checkOverlay = null;
      this.updateCheckBadge(this.lastCheck);
      this.renderIssues();
      this.refreshConnections();
    }
  }

  private levelCheckRunner(): LevelCheckRunner {
    this.levelRunner ??= new LevelCheckRunner({
      createWorker:
        typeof Worker === 'undefined'
          ? null
          : () =>
              new Worker(new URL('../workers/levelCheck.worker.ts', import.meta.url), {
                type: 'module'
              }) as unknown as LevelCheckWorkerLike,
      getBundle: () => this.hooks.getConfigBundle(),
      getLocale: () => i18n.getLocale(),
      validate: (level, options) => LevelValidator.validate(level, storedSolutionWins, options)
    });
    return this.levelRunner;
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

  private setCheck(summary: CheckSummary, issues: ValidationIssue[], contentKey: string | null = null): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.lastCheck = summary;
    this.lastIssues = issues;
    this.lastIssuesContentKey = contentKey;
    // The Connections section is rebuilt only when the problems it shows at its cell changed (a repeated check is quiet).
    if (this.issuesSignature(this.issuesAt(issues, this.connectionIssuesSubject)) !== this.connectionIssuesSignature) this.issuesRevision++;
    this.updateCheckBadge(summary);
    this.renderIssues();
    this.refreshConnections();
    // The markers on the map follow the issues (and turn from dimmed to full strength): redraw once the state is complete.
    if (this.issueMarkersOn) this.render();
  }

  /** The issues of the last check, or null before any check. */
  private lastIssues: ValidationIssue[] | null = null;
  /** Counts the changes of lastIssues, so the Connections section redraws when the problems at its cell change. */
  private issuesRevision = 0;
  /** The cell the Connections section last listed problems for, and the words it listed. */
  private connectionIssuesSubject: { x: number; y: number } | null = null;
  private connectionIssuesSignature = '[]';

  /** Fills the issues section from the last check: a jump button for an issue that names a cell, plain text otherwise. */
  private renderIssues(): void {
    const list = byId(ISSUES_LIST_ID);
    const note = byId(ISSUES_NOTE_ID);
    if (!list || !note) return;
    // Rebuilding drops the focused row: remember its position to give the focus back to the same one.
    const rowsBefore = Array.from(list.querySelectorAll<HTMLElement>('.editor-issue-row'));
    const focusedIndex = rowsBefore.findIndex((row) => row === document.activeElement);
    list.innerHTML = '';
    // The issues of the previous check stay while a new one runs or after it was abandoned: dimmed, as out of date.
    const stale = this.checkOverlay !== null;
    list.dataset.stale = String(stale);
    if (stale) list.setAttribute('aria-description', t('editor.issues.stale.label'));
    else list.removeAttribute('aria-description');
    const issues = this.lastIssues;
    note.textContent = issues === null ? t('editor.issues.idle') : issues.length === 0 ? t('editor.issues.none') : '';
    if (!issues) return;
    const { rows, hidden } = issueRows(issues, this.mapWidth(), this.mapHeight());
    for (const { issue, cell } of rows) {
      const item = document.createElement('li');
      const row = document.createElement(cell ? 'button' : 'div');
      row.className = 'editor-issue-row';
      row.dataset.severity = issue.severity;
      const glyph = document.createElement('span');
      glyph.className = 'editor-issue-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = SEVERITY_GLYPHS[issue.severity];
      const text = document.createElement('span');
      text.textContent = this.formatIssue(issue);
      const severity = document.createElement('span');
      severity.className = 'sr-only';
      severity.textContent = t(`editor.issues.severity.${issue.severity}.label`);
      row.append(glyph, severity, text);
      if (cell && row instanceof HTMLButtonElement) {
        row.type = 'button';
        row.title = t('editor.issues.jump.title', { x: cell.x, y: cell.y });
        row.addEventListener('click', () => this.jumpToIssue(issue));
      }
      item.appendChild(row);
      list.appendChild(item);
    }
    if (hidden > 0) {
      const more = document.createElement('li');
      more.className = 'hint-text';
      more.textContent = t('editor.issues.more', { count: hidden });
      list.appendChild(more);
    }
    if (focusedIndex >= 0) list.querySelectorAll<HTMLElement>('.editor-issue-row')[focusedIndex]?.focus({ preventScroll: true });
  }

  /** Puts the cursor on the cell an issue names, scrolls it into view and gives the canvas the focus. */
  private jumpToIssue(issue: ValidationIssue): void {
    // The level may have been resized since the check: only a cell that still exists is a target.
    const cell = issueCell(issue, this.mapWidth(), this.mapHeight());
    if (!cell) return;
    this.moveCursorTo(cell, false);
    this.canvas.focus({ preventScroll: true });
    const stage = byId('editor-stage');
    if (byId('editor-view')?.dataset.layout === 'one' && typeof stage?.scrollIntoView === 'function') {
      stage.scrollIntoView({ block: 'nearest' });
    }
  }

  private updateCheckBadge(summary: CheckSummary | null): void {
    const badge = byId('editor-check-badge');
    if (!badge) return;
    const overlay = this.checkOverlay;
    badge.dataset.state = overlay ?? summary?.state ?? 'idle';
    badge.textContent = overlay
      ? t(CHECK_TEXT_KEYS[overlay])
      : summary
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
    if (requiresEpoxyRules(next.winRule, hasEpoxyOnlyContent(doc) || hasCellEdges(doc) || hasUnderlays(doc))) next.ruleset = undefined;
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
    this.docRevision++;
    this.isDirty = true;
    // A ruleset change can take away the devices a link session works.
    this.revalidateLinkSession();
    this.updateUndoRedoButtons();
    this.syncRulesetInput();
    this.renderPaletteItems();
    this.refreshLayersList();
    this.scheduleCheck();
    // The ruleset decides what the Connections section lists.
    this.refreshConnections();
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
    // A CC3D level keeps its engine: the Epoxy-only tiles (lasers, colour channels) its display layers hold and its win rule do not make it Epoxy.
    const lynxLocked =
      !cc3d && requiresEpoxyRules(this.doc.winRule, hasEpoxyOnlyContent(this.doc) || hasCellEdges(this.doc) || hasUnderlays(this.doc));
    if (lynxLocked) this.doc = { ...this.doc, ruleset: undefined };
    this.updateBeamPreviewButton();
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

  /** The anchor picked in the size section (session only); the top-left cell when none is checked. */
  private readSizeAnchor(): ResizeAnchor {
    const checked = document.querySelector<HTMLInputElement>('input[name="editor-size-anchor"]:checked');
    const [col, row] = (checked?.value ?? '').split(',').map((part) => Number.parseInt(part, 10));
    const valid = (step: number): step is ResizeAnchorStep => Number.isInteger(step) && step >= 0 && step < ANCHOR_STEPS;
    return valid(col) && valid(row) ? { col, row } : TOP_LEFT_ANCHOR;
  }

  /** Resizes the map to the typed size around the picked anchor as one undoable step and says what it dropped. */
  private applySize(): void {
    const widthInput = byId<HTMLInputElement>('editor-size-width');
    const heightInput = byId<HTMLInputElement>('editor-size-height');
    const typedWidth = Number.parseInt(widthInput?.value ?? '', 10);
    const typedHeight = Number.parseInt(heightInput?.value ?? '', 10);
    const width = Number.isFinite(typedWidth) ? typedWidth : this.mapWidth();
    const height = Number.isFinite(typedHeight) ? typedHeight : this.mapHeight();
    const bounds = ConfigRegistry.getLevelSizeBounds();
    const anchor = this.readSizeAnchor();
    const before = this.doc;
    const cc3d = before.cc3d;
    let changed: boolean;
    let notes: ToolMessage[];
    if (cc3d) {
      const result = resizeCc3d(cc3d, width, height, bounds, anchor);
      changed = result.changed;
      if (changed) this.doc = withCc3d(before, result.level);
      notes = this.describeCc3dResize(cc3d, result);
    } else {
      const result = resizeMap(before, width, height, bounds, anchor);
      changed = result.changed;
      if (changed) this.doc = withEditedMap(before, result.map);
      notes = describeResize(result);
    }
    if (changed) {
      this.history.push(before);
      this.coalescer.reset();
      this.endLinkSession(false);
      this.resetSelectionState();
      this.cursorCell = null;
      this.hoverCell = null;
      this.resetConnectionsPointer();
      this.docRevision++;
      this.isDirty = true;
      this.applyFit();
      this.updateUndoRedoButtons();
      this.syncRulesetInput();
      this.scheduleCheck();
      this.refreshLayersList();
      this.render();
    }
    this.syncSizeInputs();
    this.announce(notes);
  }

  /** What a CC3D resize did, as the notes to announce: the new size first, then what was dropped or re-routed. */
  private describeCc3dResize(before: Cc3dLevel, result: Cc3dResizeResult): ToolMessage[] {
    if (!result.changed) return [{ key: RESIZE_UNCHANGED_KEY, params: { width: result.width, height: result.height } }];
    return [
      { key: RESIZE_DONE_KEY, params: { width: result.width, height: result.height } },
      ...(result.droppedMobs > 0 ? [{ key: MESSAGE_CC3D_RESIZE_MOBS_DROPPED, params: { count: result.droppedMobs } }] : []),
      ...(result.playerMoved ? [{ key: MESSAGE_CC3D_RESIZE_PLAYER_MOVED }] : []),
      ...this.cc3dLinkMessages(before, result.level)
    ];
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
  // Draft autosave and recovery
  // ---------------------------------------------------------------------------

  private static newTabId(): string {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(DRAFT_TAB_ID_RADIX)}${Math.random().toString(DRAFT_TAB_ID_RADIX).slice(DRAFT_TAB_ID_SKIP)}`;
  }

  /** The names of the Web Locks held on this origin; empty when the browser has no Web Locks. */
  private static async heldLockNames(): Promise<Set<string>> {
    const names = new Set<string>();
    try {
      if (typeof navigator === 'undefined' || !navigator.locks || typeof navigator.locks.query !== 'function') return names;
      const snapshot = await navigator.locks.query();
      for (const info of [...(snapshot.held ?? []), ...(snapshot.pending ?? [])]) if (info.name) names.add(info.name);
    } catch {
      // No answer: every draft is offered.
    }
    return names;
  }

  private draftKeyPrefix(): string {
    return ConfigRegistry.getStorageKey(EDITOR_DRAFT_STORAGE_PREFIX);
  }

  /** The only key this page writes or deletes. */
  private ownDraftKey(): string {
    return ConfigRegistry.getStorageKey(`${EDITOR_DRAFT_STORAGE_PREFIX}${this.draftTabId}`);
  }

  /**
   * Holds a Web Lock named after the own key for the life of the page, so other pages see the draft as live.
   * A held Web Lock may make the page ineligible for the back-forward cache (performance only; the pageshow
   * rewrite keeps correctness).
   */
  private holdDraftLock(): void {
    try {
      if (typeof navigator === 'undefined' || !navigator.locks) return;
      const held = new Promise<void>((resolve) => {
        this.releaseDraftLock = resolve;
      });
      void navigator.locks.request(this.ownDraftKey(), () => held).catch(() => undefined);
    } catch {
      // Without the lock every other page offers this page's draft: nothing is lost.
    }
  }

  /** Dirty work is written after a pause in the edits; a clean level removes this page's draft, and only that. */
  private syncDraft(): void {
    if (this.disposed) return;
    if (this.dirty) {
      this.scheduleDraftWrite();
      return;
    }
    this.cancelDraftTimer();
    this.draftStore.remove(this.ownDraftKey());
    if (this.adoptedDraft) {
      const adopted = this.adoptedDraft;
      this.draftStore.removeIfRaw(adopted.key, adopted.raw);
      this.waitingDraftKeys.delete(adopted.key);
      this.adoptedDraft = null;
    }
  }

  private cancelDraftTimer(): void {
    if (this.draftTimer === null) return;
    clearTimeout(this.draftTimer);
    this.draftTimer = null;
  }

  private scheduleDraftWrite(): void {
    this.cancelDraftTimer();
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      // Never in the middle of a stroke: wait for the next pause.
      if (this.stroke) this.scheduleDraftWrite();
      else this.writeDraft();
    }, EDITOR_DRAFT_WRITE_DELAY_MS);
  }

  /** Writes a pending draft now, when the page is hidden or the editor is left. */
  private flushDraft(): void {
    if (this.draftTimer === null) return;
    this.writeDraftNow();
  }

  private writeDraftNow(): DraftWrite | 'skipped' {
    this.cancelDraftTimer();
    return this.writeDraft();
  }

  /** The page is back (or restored from the back-forward cache) while dirty: a draft cleared meanwhile is rewritten. */
  private rewriteMissingDraft(): void {
    if (this.disposed || !this.dirty) return;
    if (this.draftStore.read(this.ownDraftKey()).kind === 'none') this.writeDraftNow();
  }

  private baseHash(): string {
    const original = this.originalLevel;
    if (original === null) return '';
    if (this.baseHashCache?.level !== original) this.baseHashCache = { level: original, hash: levelFingerprint(original) };
    return this.baseHashCache.hash;
  }

  private writeDraft(): DraftWrite | 'skipped' {
    if (!this.dirty || this.disposed) return 'skipped';
    let level: CompiledLevel;
    try {
      // Mid-stroke (the page is hidden while a stroke runs) the draft holds the document the stroke started from.
      level = draftLevelOf(this.compileDocument(this.stroke ? this.stroke.base : this.doc));
    } catch {
      this.reportDraftProblem('editor.draft.status.export_failed.label');
      return 'failed';
    }
    const outcome = this.draftStore.write(this.ownDraftKey(), {
      v: DRAFT_VERSION,
      tabId: this.draftTabId,
      writtenAt: Date.now(),
      source: { ...this.source },
      currentLevelId: this.currentLevelId,
      baseHash: this.baseHash(),
      level
    });
    if (outcome === 'written') {
      this.draftProblemReported = false;
      if (this.adoptedDraft) {
        this.draftStore.removeIfRaw(this.adoptedDraft.key, this.adoptedDraft.raw);
        this.waitingDraftKeys.delete(this.adoptedDraft.key);
        this.adoptedDraft = null;
      }
      return outcome;
    }
    this.reportDraftProblem(outcome === 'too_large' ? 'editor.draft.status.too_large.label' : 'editor.draft.status.write_failed.label');
    return outcome;
  }

  /** One message per run of failures; editing goes on without a draft, and no other draft is touched. */
  private reportDraftProblem(key: string): void {
    if (this.draftProblemReported) return;
    this.draftProblemReported = true;
    const others = this.waitingDraftKeys.size > 0 ? ` ${t('editor.draft.status.others_waiting.label')}` : '';
    this.setStatusText(`${t(key)}${others}`);
  }

  private bindDraftEvents(): void {
    const { signal } = this.draftListeners;
    window.addEventListener('pagehide', () => this.flushDraft(), { signal });
    window.addEventListener('pageshow', () => this.rewriteMissingDraft(), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') this.flushDraft();
        else this.rewriteMissingDraft();
      },
      { signal }
    );
    window.addEventListener('storage', (event) => this.onDraftStorage(event), { signal });
  }

  /** Stops the page-level draft listeners, the pending write and the Web Lock: the editor is no longer in use. */
  public dispose(): void {
    this.disposed = true;
    this.resetConnectionsPointer();
    this.cancelCellSpeech();
    this.cancelSearchCount();
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = null;
    this.checkAbortEpoch++;
    this.levelRunner?.dispose();
    this.draftListeners.abort();
    this.cancelDraftTimer();
    this.releaseDraftLock?.();
    this.releaseDraftLock = null;
  }

  /**
   * Another tab (or the player) removed this page's draft key, or cleared the whole storage, while this page
   * has unsaved work: the draft is rewritten at once. Other pages' keys are none of this page's business.
   */
  private onDraftStorage(event: StorageEvent): void {
    if (this.disposed || !this.dirty) return;
    const cleared = event.key === null;
    if (!cleared && (event.key !== this.ownDraftKey() || event.newValue !== null)) return;
    this.writeDraftNow();
  }

  /**
   * Offers the work earlier visits left, once per page: called the first time the editor view is shown, after
   * it took the engine's level. Each draft is Restored, Discarded, or left for later (which stops the queue).
   */
  public async offerDraftOnce(): Promise<void> {
    if (this.draftOffered) return;
    this.draftOffered = true;
    const keys = this.draftStore.listKeys(this.draftKeyPrefix()).filter((key) => key !== this.ownDraftKey());
    if (keys.length === 0) return;
    let live: Set<string>;
    try {
      live = await this.liveKeys();
    } catch {
      live = new Set();
    }
    // Everything is read before anything is removed.
    const candidates: DraftCandidate[] = [];
    let invalid = false;
    for (const key of keys) {
      if (live.has(key)) continue;
      const read = this.readCandidate(key);
      if (read.kind === 'draft') candidates.push(read);
      else if (read.kind === 'invalid') {
        this.draftStore.removeIfRaw(key, read.raw);
        invalid = true;
      }
    }
    candidates.sort((a, b) => b.draft.writtenAt - a.draft.writtenAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    this.waitingDraftKeys.clear();
    for (const candidate of candidates) this.waitingDraftKeys.add(candidate.key);
    const result = await this.walkDraftQueue(candidates);
    if ((invalid || result.invalid) && !result.restored) this.setStatusText(t('editor.draft.status.invalid.label'));
  }

  /** Reads a draft key for the offer: a text that is not a draft of this key's page is unreadable; other versions are left alone. */
  private readCandidate(key: string): CandidateRead {
    const found = this.draftStore.read(key);
    if (found.kind === 'invalid') return { kind: 'invalid', raw: found.raw };
    if (found.kind !== 'draft') return { kind: 'skip' };
    if (found.draft.tabId !== key.slice(this.draftKeyPrefix().length)) return { kind: 'invalid', raw: found.raw };
    return { kind: 'draft', key, draft: found.draft, raw: found.raw };
  }

  /** Removes a draft the player is done with, only while its key still holds the text that was read. */
  private dropDraft(key: string, raw: string): void {
    this.draftStore.removeIfRaw(key, raw);
    this.waitingDraftKeys.delete(key);
  }

  /** Walks the drafts newest first. "Later" and a restore stop the walk. */
  private async walkDraftQueue(candidates: readonly DraftCandidate[]): Promise<{ restored: boolean; invalid: boolean }> {
    let invalid = false;
    for (const candidate of candidates) {
      // The key may have gone, or changed, since it was listed (another page answered it).
      const read = this.readCandidate(candidate.key);
      if (read.kind === 'invalid') {
        this.dropDraft(candidate.key, read.raw);
        invalid = true;
        continue;
      }
      if (read.kind !== 'draft') {
        this.waitingDraftKeys.delete(candidate.key);
        continue;
      }
      const { key, draft, raw } = read;
      const level = this.validatedDraftLevel(draft);
      if (!level) {
        this.dropDraft(key, raw);
        invalid = true;
        continue;
      }
      const found = this.findDraftSource(draft);
      let offer = draftOffer(draft, found?.level);
      if (offer !== 'identical' && found && this.sameAsSource(level, found.level)) offer = 'identical';
      if (offer === 'identical') {
        this.dropDraft(key, raw);
        continue;
      }
      const choice = await this.askAboutDraft(level, offer);
      if (choice === DRAFT_DISCARD_CHOICE) {
        this.dropDraft(key, raw);
        continue;
      }
      if (choice !== DRAFT_RESTORE_CHOICE) return { restored: false, invalid };
      // Work the player started before answering is not thrown away without asking; refusing is "later".
      if (!(await this.confirmDiscardIfDirty())) return { restored: false, invalid };
      if (!this.applyDraft(draft, level, found)) {
        this.dropDraft(key, raw);
        invalid = true;
        continue;
      }
      this.setStatusText(t('editor.draft.status.restored.label'));
      // Written under this page's own key at once, so a crash right after still finds it.
      const outcome = this.writeDraftNow();
      if (outcome === 'written' || outcome === 'skipped') this.dropDraft(key, raw);
      else this.adoptedDraft = { key, raw };
      return { restored: true, invalid };
    }
    return { restored: false, invalid };
  }

  /**
   * The level a draft started from. The pack it names first; when that pack no longer holds the level,
   * the level is looked up by id in every pack (ids are unique), since it may have been moved.
   */
  private findDraftSource(draft: EditorDraft): DraftSourceMatch | undefined {
    const { packId, levelId } = draft.source;
    if (levelId === null) return undefined;
    const packs = ConfigRegistry.getAllPacks();
    const named = packId === null ? undefined : packs.find((pack) => pack.id === packId)?.levels.find((lvl) => lvl.id === levelId);
    if (named) return { level: named, source: { packId, levelId } };
    for (const pack of packs) {
      const level = pack.levels.find((lvl) => lvl.id === levelId);
      if (level) return { level, source: { packId: pack.id, levelId } };
    }
    return undefined;
  }

  /** True when both levels make the same editor document (the stored form of a level can differ in layout only). */
  private sameAsSource(level: CompiledLevel, sourceLevel: CompiledLevel): boolean {
    return sameDocument(documentFromLevel(level, this.draftTexts(level)), documentFromLevel(sourceLevel, this.draftTexts(sourceLevel)));
  }

  /** The draft's level when it passes the checks a stored level passes and the editor can hold it. */
  private validatedDraftLevel(draft: EditorDraft): CompiledLevel | null {
    // An unknown rule is refused here: the sanitizer below would drop it and restore the level as Epoxy.
    const raw = draft.level as unknown as Record<string, unknown>;
    if (raw.ruleset !== undefined && !isRuleset(raw.ruleset)) return null;
    if (raw.winRule !== undefined && !isWinRule(raw.winRule)) return null;
    try {
      const [valid] = sanitizeStoredLevels(
        [hydrateDraftLevel(draft.level)],
        ConfigRegistry.getLevelSizeBounds(),
        ConfigRegistry.getLevelTextLimits()
      );
      return valid && isEditableRuleset(valid.ruleset) ? valid : null;
    } catch {
      return null;
    }
  }

  private draftOfferMessage(offer: DraftOffer, title: string): string {
    if (offer === 'conflict') return t('editor.draft.offer.conflict.label', { title });
    if (offer === 'orphan') return t('editor.draft.offer.orphan.label', { title });
    return t('editor.draft.offer.restore.label', { title });
  }

  private askAboutDraft(level: CompiledLevel, offer: DraftOffer): Promise<string | null> {
    return choiceDialog({
      title: t('editor.draft.offer.title.label'),
      message: this.draftOfferMessage(offer, level.customTitle || level.id),
      cancelLabel: t('editor.draft.offer.later.action'),
      options: [
        { id: DRAFT_RESTORE_CHOICE, label: t('editor.draft.offer.restore.action'), primary: true },
        { id: DRAFT_DISCARD_CHOICE, label: t('editor.draft.offer.discard.action') }
      ]
    });
  }

  /**
   * Puts the draft in the editor. On top of its source, the clean source is the first undo step, so undo
   * returns to the stored version; a level with no source opens as unsaved work in the pack it came from.
   */
  private applyDraft(draft: EditorDraft, level: CompiledLevel, found: DraftSourceMatch | undefined): boolean {
    if (found && this.loadCompiledLevel(found.level, { source: found.source })) {
      this.history.push(this.doc);
      // Dirty only when the draft differs from the source: restoreDocument decides.
      this.restoreDocument(documentFromLevel(level, this.draftTexts(level)));
      return true;
    }
    // No source, or the source cannot be edited: the draft opens as new unsaved work.
    const packExists = ConfigRegistry.getAllPacks().some((pack) => pack.id === draft.source.packId);
    const source: SaveSource = packExists ? { packId: draft.source.packId, levelId: null } : NO_SOURCE;
    return this.loadCompiledLevel(level, { source, dirty: true });
  }

  private draftTexts(level: CompiledLevel): LoadedTexts {
    return { title: this.resolveLevelTitle(level), hint: level.customHint || (level.hintKey ? t(level.hintKey) : '') };
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  /** Puts a document from the history in place of the current one. */
  private restoreDocument(doc: EditorDocument, keepCursor = false): void {
    const cursor = this.cursorCell;
    this.doc = doc;
    this.docRevision++;
    this.coalescer.reset();
    this.isDirty = !(this.cleanDoc !== null && sameDocument(doc, this.cleanDoc));
    // An undo or redo keeps the link session open; it ends, saying so, only when its device is gone.
    this.revalidateLinkSession();
    this.resetSelectionState();
    // An undo keeps the keyboard cursor where it was while that cell still exists.
    this.cursorCell = keepCursor && cursor && cursor.x < this.mapWidth() && cursor.y < this.mapHeight() ? cursor : null;
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
    const session = this.linkSession;
    const from = this.doc;
    const previous = this.history.undo(this.doc);
    if (!previous) return;
    this.restoreDocument(previous, true);
    this.afterHistoryStep(from, session !== null && this.linkSession === null, 'undone');
  }

  public redo(): void {
    if (this.stroke) return;
    const session = this.linkSession;
    const from = this.doc;
    const next = this.history.redo(this.doc);
    if (!next) return;
    this.restoreDocument(next, true);
    this.afterHistoryStep(from, session !== null && this.linkSession === null, 'redone');
  }

  /** Brings the change an undo or redo made into view and says what it was; the message of a link session it ended comes first and stands alone. */
  private afterHistoryStep(from: EditorDocument, sessionEnded: boolean, verb: 'undone' | 'redone'): void {
    const diff = historyDiff(from, this.doc);
    const near = this.revealChange(diff);
    if (sessionEnded) return;
    if (diff.sizeChanged) {
      this.setStatusText(t(`editor.layout.status.${verb}_size.label`, { width: this.mapWidth(), height: this.mapHeight() }));
    } else if (diff.metadataOnly) {
      this.setStatusText(t(`editor.layout.status.${verb}_settings.label`));
    } else if (diff.cells && near) {
      this.setStatusText(t(`editor.layout.status.${verb}_cells.label`, { count: diff.cells.length, x: near.x, y: near.y }));
    }
  }

  /**
   * Scrolls to the changed cell nearest the middle of the stage when none of the changed cells is in view.
   * Returns that cell, or null when nothing changed on the map.
   */
  private revealChange(diff: HistoryDiff): { x: number; y: number } | null {
    const cells = diff.cells;
    if (!cells || cells.length === 0) return null;
    const stage = byId('editor-stage');
    const fit = this.lastFit;
    if (!stage || !fit) return cells[0];
    const view = this.stageView(stage, fit);
    const centreX = this.centreInCells(view.scrollLeft, view.clientWidth, view.canvasCssWidth, fit.cssTileSize);
    const centreY = this.centreInCells(view.scrollTop, view.clientHeight, view.canvasCssHeight, fit.cssTileSize);
    let nearest = cells[0];
    let best = Infinity;
    let anyVisible = false;
    for (const cell of cells) {
      const distance = (cell.x + CELL_CENTRE - centreX) ** 2 + (cell.y + CELL_CENTRE - centreY) ** 2;
      if (distance < best) {
        best = distance;
        nearest = cell;
      }
      if (!anyVisible && this.cellInView(cell, view, fit.cssTileSize)) anyVisible = true;
    }
    if (!anyVisible) this.revealCell(nearest);
    return nearest;
  }

  /** The middle of the visible stage on one axis, in cells from the canvas start. */
  private centreInCells(scroll: number, client: number, canvasCss: number, cssTile: number): number {
    const offset = Math.max(0, (client - canvasCss) / STAGE_CENTRE_DIVISOR);
    return (scroll + client / STAGE_CENTRE_DIVISOR - offset) / cssTile;
  }

  /** Whether any part of a cell is in the visible stage. */
  private cellInView(cell: { x: number; y: number }, view: StageView, cssTile: number): boolean {
    const left = Math.max(0, (view.clientWidth - view.canvasCssWidth) / STAGE_CENTRE_DIVISOR) + cell.x * cssTile - view.scrollLeft;
    const top = Math.max(0, (view.clientHeight - view.canvasCssHeight) / STAGE_CENTRE_DIVISOR) + cell.y * cssTile - view.scrollTop;
    return left < view.clientWidth && left + cssTile > 0 && top < view.clientHeight && top + cssTile > 0;
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
    this.clearPaletteSearch();
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
    this.endLinkSession(false);
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
    this.clearPaletteSearch();
    this.renderCategoryTabs();
    this.renderPaletteItems();
    this.setStatusText(t('editor.palette.status.picked.label', { name: definition ? t(definition.i18nKey) : picked.brush.id }));
    this.render();
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
   * The side of a cell a pointer is nearest to, for the thin wall mode.
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
    // The Connections section follows the pointer after a short pause; leaving the map keeps the last cell it settled on.
    if (cell) {
      if (!same) this.startConnectionsDwell(cell);
    } else {
      this.clearConnectionsDwell();
    }
    this.refreshHoverText();
    if (!same) this.requestRender();
  }

  /**
   * Writes what the pointed cell holds into the coordinates badge (and its tooltip), or the empty marker when no cell
   * is pointed. Rebuilt only when the cell, the level, a change of it or the language differs from the last build.
   */
  private refreshHoverText(): void {
    const cell = this.hoverCell;
    if (!cell) {
      this.setCoordsText(NO_COORDS_TEXT);
      return;
    }
    const key = [this.loadGeneration, this.docRevision, i18n.getLocale(), cell.x, cell.y].join(':');
    if (key === this.hoverTextKey) return;
    const level = this.doc.cc3d;
    const cc3dNames = level ? this.cc3dCellParts(level, cell.x, cell.y).map((part) => part.name) : undefined;
    const [coords, ...rest] = describeEditorCell({ map: this.doc, x: cell.x, y: cell.y, cc3dNames }).map((part) => t(part.key, part.params));
    this.setCoordsText(rest.length > 0 ? `${coords}${COORDS_DESCRIPTION_SEPARATOR}${rest.join(SEPARATOR_BETWEEN_PARTS)}` : coords);
    this.hoverTextKey = key;
  }

  /** Control or Command with the wheel over the map zooms around the pointer; a plain wheel keeps scrolling. */
  private onStageWheel(ev: WheelEvent): void {
    if (this.disposed || !(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    let steps: number;
    if (ev.deltaMode === WHEEL_DELTA_LINE || ev.deltaMode === WHEEL_DELTA_PAGE) {
      // A notched wheel reports lines or pages: one event is one step, whatever its size.
      this.wheelTravel = 0;
      steps = Math.sign(ev.deltaY);
    } else {
      // A change of direction drops the travel stored the other way.
      if (Math.sign(ev.deltaY) !== Math.sign(this.wheelTravel)) this.wheelTravel = 0;
      this.wheelTravel += ev.deltaY;
      steps = Math.trunc(this.wheelTravel / EDITOR_WHEEL_ZOOM_STEP_PX);
      this.wheelTravel -= steps * EDITOR_WHEEL_ZOOM_STEP_PX;
    }
    if (steps === 0) return;
    // The zoom pivots on the wheel position. The pointer position the canvas last reported is put back after, so the
    // hover text stays that of the old pointer cell until the next pointer move.
    const previous = this.lastPointer;
    this.lastPointer = { clientX: ev.clientX, clientY: ev.clientY };
    // Wheel up (negative delta) zooms in. A step that cannot change the tile size ends the zoom and the travel.
    for (let i = 0; i < Math.abs(steps); i++) {
      const fit = this.lastFit;
      if (fit && !(steps < 0 ? fit.canZoomIn : fit.canZoomOut)) {
        this.wheelTravel = 0;
        break;
      }
      this.setZoomOffset(steps < 0 ? zoomIn(this.zoomOffset) : zoomOut(this.zoomOffset));
    }
    this.lastPointer = previous;
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
      this.resetConnectionsPointer();
      this.lastInput = 'pointer';
      // Every path below (picker, Alt or middle click, a stroke) starts from this cell: the layers list follows it.
      this.refreshLayersList();

      if (this.linkSession) {
        // A link session takes the primary click before any tool does; another button, or Alt, ends it.
        if (ev.button === 0 && !ev.altKey) this.sessionAct(cell);
        else this.endLinkSession(true);
        return;
      }
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

      if (this.isCc3d() || this.sideToolActive()) this.hoverSide = this.pointerSide(ev.clientX, ev.clientY, cell);
      this.beginStroke(ev.button === 2 || ev.button === POINTER_ERASER_BUTTON, ev.shiftKey);
      this.applyAt(cell.x, cell.y, this.hoverSide);
      this.refreshLayersList();
    });

    this.canvas.addEventListener('pointermove', (ev) => {
      this.lastPointer = { clientX: ev.clientX, clientY: ev.clientY };
      this.lastInput = 'pointer';
      const cell = this.cellAt(ev.clientX, ev.clientY);
      if (cell && this.pasting) this.pasteAnchor = cell;
      if (cell && (this.isCc3d() || this.sideToolActive())) {
        const side = this.pointerSide(ev.clientX, ev.clientY, cell);
        if (side !== this.hoverSide) {
          this.hoverSide = side;
          // The thin wall mode shows which side a click would toggle.
          if (this.sideToolActive()) this.requestRender();
        }
      }
      this.setHover(cell);
      if (cell && this.selectionGesture) this.updateSelectionGesture(cell);
      if (cell && this.stroke && this.continuesOnDrag(this.stroke.forceErase)) {
        this.applyAt(cell.x, cell.y, this.hoverSide, true);
      }
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.lastPointer = null;
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
      this.lastInput = 'keyboard';
      if (action.kind === 'move') {
        const from = this.cursorCell ?? { x: this.doc.playerStart.x, y: this.doc.playerStart.y };
        this.moveCursorTo(moveCursor(from, action.dx, action.dy, this.mapWidth(), this.mapHeight()), ev.shiftKey);
        return;
      }
      // A held key must not paint over and over: only the first press acts.
      if (ev.repeat) return;
      // A pointer stroke is running: its own history step must not be split by a key press.
      if (this.stroke) return;
      const cell = this.cursorCell ?? { x: this.doc.playerStart.x, y: this.doc.playerStart.y };
      this.cursorCell = cell;
      if (this.linkSession) {
        this.sessionAct(cell);
        return;
      }
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
      const writesBefore = this.statusWrites;
      this.beginStroke(false, ev.shiftKey);
      this.applyAt(cell.x, cell.y, this.activeDir);
      this.endStroke();
      // A paint that said nothing in the status bar re-reads the cell it changed.
      if (this.statusWrites === writesBefore) this.scheduleCellSpeech();
    });
    this.canvas.addEventListener('focus', () => this.render());
    this.canvas.addEventListener('blur', () => {
      this.cancelCellSpeech();
      this.render();
    });
  }

  /** Puts the keyboard cursor on a cell: follows a paste, extends or starts the selection, shows the cell and scrolls it into view. */
  private moveCursorTo(to: { x: number; y: number }, extendSelection: boolean): void {
    const from = this.cursorCell ?? { x: this.doc.playerStart.x, y: this.doc.playerStart.y };
    const writesBefore = this.statusWrites;
    this.cursorCell = to;
    this.resetConnectionsPointer();
    if (this.pasting) this.pasteAnchor = to;
    if (this.tool === 'select' && !this.pasting && !this.linkSession) this.moveSelectionCursor(from, to, extendSelection);
    this.setCoordsText(t('editor.palette.status.coords', { x: to.x, y: to.y }));
    this.revealCell(to);
    this.refreshLayersList();
    this.render();
    // The status bar already says something about this move (a selection size), or a paste preview floats: the cell stays quiet.
    if (this.statusWrites !== writesBefore || this.pasting) this.cancelCellSpeech();
    else this.scheduleCellSpeech();
  }

  /** Speaks what the keyboard cursor cell holds once the cursor has stopped, so a held arrow says only the last cell. */
  private scheduleCellSpeech(): void {
    this.cancelCellSpeech();
    this.cellSpeechTimer = setTimeout(() => {
      this.cellSpeechTimer = null;
      this.speakCursorCell();
    }, EDITOR_CELL_ANNOUNCE_DELAY_MS);
  }

  private cancelCellSpeech(): void {
    if (this.cellSpeechTimer === null) return;
    clearTimeout(this.cellSpeechTimer);
    this.cellSpeechTimer = null;
  }

  /** "1 error, 2 warnings here" for the issues of a report that describes the level as it is; empty when none, or when the report lags an edit. */
  private issueSpeechAt(x: number, y: number): string {
    const issues = this.lastIssues;
    if (issues === null || markerFreshness(this.lastIssuesContentKey, this.currentBeamPreviewKey()) !== 'fresh') return '';
    const here = issuesAtCell(issues, x, y, this.mapWidth(), this.mapHeight());
    const groups = [
      { severity: 'error', key: 'editor.issue_markers.cell_speech.errors.label' },
      { severity: 'warning', key: 'editor.issue_markers.cell_speech.warnings.label' },
      { severity: 'info', key: 'editor.issue_markers.cell_speech.infos.label' }
    ] as const;
    const list = groups
      .map((group) => ({ key: group.key, count: here.filter((issue) => issue.severity === group.severity).length }))
      .filter((group) => group.count > 0)
      .map((group) => t(group.key, { count: group.count }))
      .join(SEPARATOR_BETWEEN_PARTS);
    return list ? t('editor.issue_markers.cell_speech.label', { list }) : '';
  }

  private speakCursorCell(): void {
    const at = this.cursorCell;
    const live = byId(CELL_LIVE_ID);
    if (this.disposed || !at || !live) return;
    // Only the focused canvas speaks: a cursor left behind after the focus moved elsewhere stays silent.
    if (document.activeElement !== this.canvas) return;
    const level = this.doc.cc3d;
    const cc3dNames = level ? this.cc3dCellParts(level, at.x, at.y).map((part) => part.name) : undefined;
    const parts = describeEditorCell({ map: this.doc, x: at.x, y: at.y, cc3dNames });
    const issueText = this.issueSpeechAt(at.x, at.y);
    const text = [...parts.map((part) => t(part.key, part.params)), ...(issueText ? [issueText] : [])].join(SEPARATOR_BETWEEN_MESSAGES);
    if (live.textContent !== text) {
      live.textContent = text;
      return;
    }
    // The same words again are not announced: empty the region and write them on the next tick.
    live.textContent = '';
    this.cellSpeechTimer = setTimeout(() => {
      this.cellSpeechTimer = null;
      live.textContent = text;
    }, 0);
  }

  private beginStroke(forceErase: boolean, wholeCell = false): void {
    this.stroke = { base: cloneDocument(this.doc), changed: false, forceErase, wholeCell, statusWritesAtBegin: this.statusWrites };
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
    if (!stroke.changed) {
      this.refreshConnections();
      return;
    }
    this.recordChange(stroke.base);
    this.refreshConnections();
    this.announceLinkChanges(stroke.base);
    this.nudgeToLink(stroke);
  }

  /**
   * After a brush stroke that placed exactly one linkable device and nothing else changed its tiles, and said nothing in
   * the status line itself: tells the author the device can be linked (K or Link...) and what it does unlinked. Quiet for
   * a fill, an erase, a paste, a move, a stroke over several cells and a device that is linked already.
   */
  private nudgeToLink(stroke: Stroke): void {
    if (this.isCc3d() || this.tool !== 'brush' || stroke.forceErase || this.statusWrites !== stroke.statusWritesAtBegin) return;
    const cell = soleChangedCell(stroke.base, this.doc);
    if (!cell) return;
    const messages = nudgeMessages(this.doc, cell.x, cell.y, this.linkRuleset());
    const role = JSON.stringify(messages[0]?.params ?? null);
    // The same role again with nothing else said since: the nudge is already on the status line, not repeated.
    if (messages.length > 0 && this.lastNudge?.writes === this.statusWrites && this.lastNudge.role === role) return;
    this.announce(messages);
    if (messages.length > 0) this.lastNudge = { role, writes: this.statusWrites };
  }

  /** The role of the last nudge and the status write count right after it, to tell a repeat from a new session of strokes. */
  private lastNudge: { role: string; writes: number } | null = null;

  /** After an edit of a CC3D level: says in the status line when a link that existed now points elsewhere. */
  private announceLinkChanges(base: EditorDocument): void {
    const before = base.cc3d;
    const after = this.doc.cc3d;
    if (!before || !after) return;
    this.announce(describeLinkChanges(diffCc3dLinks(before, after, this.cc3dLinksOf(before), this.cc3dLinksOf(after))));
  }

  /**
   * The status messages for the links an area edit re-routed, matched by coordinates so a size change or a
   * move of a rectangle (`move`) is understood.
   */
  private cc3dLinkMessages(before: Cc3dLevel, after: Cc3dLevel, move?: Cc3dLinkTranslation): ToolMessage[] {
    return describeLinkChanges(diffCc3dLinksByPosition(before, after, move, this.cc3dLinksOf(before), this.cc3dLinksOf(after)));
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
    const hiddenTerrain = !level && this.refreshHiddenTerrainField();
    // Outside CC3D the section follows the cursor, so the inspector does not jump from cell to cell: it holds
    // the hidden terrain select, or the hint that says which tops can hide a terrain.
    byId(LAYERS_SECTION_ID)?.classList.toggle('hidden', !level && !hiddenTerrain);
    // A level of the other engines has no list of layers: its section holds the hidden terrain field alone.
    const cc3dOnly = Boolean(level);
    byId(LAYERS_CELL_ID)?.classList.toggle('hidden', !cc3dOnly);
    list.classList.toggle('hidden', !cc3dOnly);
    const cell = level && at ? cc3dCellAt(level, at.x, at.y) : undefined;
    const caption = byId(LAYERS_CELL_ID);
    if (caption) caption.textContent = at && cell ? t('editor.cc3d.layers.cell', { x: at.x, y: at.y }) : t('editor.cc3d.layers.none');
    if (!level || !at || !cell) return;
    for (const part of this.cc3dCellParts(level, at.x, at.y)) list.appendChild(this.layerRow(part.name, part.remove));
  }

  // ---------------------------------------------------------------------------
  // Connections section
  // ---------------------------------------------------------------------------

  /** The cell the Connections section is about: the device the pointer rested on, else the keyboard cursor's. */
  private connectionsSubject(): { x: number; y: number } | null {
    return this.connectionsPointerCell ?? this.cursorCell;
  }

  /** Restarts the pause after which the section follows the pointer to `cell`. */
  private startConnectionsDwell(cell: { x: number; y: number }): void {
    this.clearConnectionsDwell();
    this.connectionsDwellTimer = setTimeout(() => {
      this.connectionsDwellTimer = null;
      if (this.disposed) return;
      this.connectionsPointerCell = { x: cell.x, y: cell.y };
      this.requestRender();
    }, EDITOR_CONNECTIONS_HOVER_DWELL_MS);
  }

  private clearConnectionsDwell(): void {
    if (this.connectionsDwellTimer !== null) clearTimeout(this.connectionsDwellTimer);
    this.connectionsDwellTimer = null;
  }

  /** Hands the section back to the keyboard cursor: drops the pause and the cell it settled on. */
  private resetConnectionsPointer(): void {
    this.clearConnectionsDwell();
    this.connectionsPointerCell = null;
  }

  /** The view of a cell of the current document, kept for the last cell asked for. */
  private connectionViewAt(x: number, y: number): ConnectionView {
    const cached = this.connectionsCache;
    if (cached && cached.doc === this.doc && cached.x === x && cached.y === y) return cached.view;
    // A CC3D level derives its links from where things stand: the cached derivation of this version of it is passed on.
    const cc3d = this.doc.cc3d;
    const view = cc3d ? cc3dConnectionRows(cc3d, x, y, this.cc3dLinksOf(cc3d)) : connectionRows(this.doc, x, y);
    this.connectionsCache = { doc: this.doc, x, y, view };
    return view;
  }

  private bindConnectionsEvents(): void {
    byId(CONNECTIONS_LINK_BTN_ID)?.addEventListener('click', () => this.onConnectionsLinkClick());
    // Leaving the section for the map hands the section back to the cell the map shows.
    const section = byId(CONNECTIONS_SECTION_ID);
    section?.addEventListener('focusout', (ev) => {
      // A rebuild of the list drops and gives back the focus itself: that is not the focus leaving.
      if (this.connectionsDrawing) return;
      const next = ev.relatedTarget;
      if (!this.disposed && !(next instanceof Node && section.contains(next))) this.render();
    });
    // The list stays as it is while the pointer is over it, so a row does not move under the click.
    section?.addEventListener('pointerenter', () => {
      this.connectionsPointerInside = true;
    });
    section?.addEventListener('pointerleave', () => {
      this.connectionsPointerInside = false;
      if (!this.disposed) this.render();
    });
  }

  /** Writes the "How mechanisms work" card: one row per mechanism, rewritten when the locale or the ruleset changes. */
  private refreshMechanismsHelp(cc3d: boolean): void {
    const section = byId(MECHANISMS_HELP_SECTION_ID);
    const list = byId(MECHANISMS_HELP_LIST_ID);
    if (!section || !list) return;
    section.classList.remove('hidden');
    const lynx = this.doc.ruleset === LYNX_RULESET;
    const drawnFor = `${i18n.getLocale()}:${cc3d ? 'cc3d' : lynx ? LYNX_RULESET : 'epoxy'}`;
    if (drawnFor === this.mechanismsHelpLocale && list.childElementCount > 0) return;
    this.mechanismsHelpLocale = drawnFor;
    list.innerHTML = '';
    const keys = byId(MECHANISMS_HELP_KEYS_ID);
    const lynxLine = byId(MECHANISMS_HELP_LYNX_ID);
    if (cc3d) {
      // A CC3D level has no links to make: one row per mechanism says how its parts find each other, then the top layer rule.
      for (const row of CC3D_MECHANISM_HELP_ROWS) {
        const item = document.createElement('li');
        item.dataset.system = row.system;
        const name = document.createElement('strong');
        name.className = MECHANISMS_HELP_NAME_CLASS;
        name.textContent = t(row.nameKey);
        const how = document.createElement('span');
        how.textContent = ` ${t(row.howKey)}`;
        item.append(name, how);
        list.appendChild(item);
      }
      // The editor keys line does not apply to CC3D (K links nothing there), so its element carries the top layer footer.
      if (keys) keys.textContent = t(MECHANISMS_HELP_CC3D_TOP_LAYER_KEY);
      if (lynxLine) lynxLine.textContent = '';
      return;
    }
    for (const row of MECHANISM_HELP_ROWS) {
      const item = document.createElement('li');
      item.dataset.system = row.system;
      const name = document.createElement('strong');
      name.className = MECHANISMS_HELP_NAME_CLASS;
      name.textContent = `${t(row.nameKey)} (${t(KIND_NAME_KEYS[row.kind])})`;
      const how = document.createElement('span');
      // Under Lynx rules the Lynx line says what an unlinked trap or clone button does.
      const unlinked = lynx && row.lynxCoversUnlinked ? '' : ` ${t(row.unlinkedKey, row.params)}`;
      how.textContent = ` ${t(row.howKey, row.params)}${unlinked}`;
      item.append(name, how);
      list.appendChild(item);
    }
    if (keys) keys.textContent = t(MECHANISMS_HELP_KEYS_KEY);
    if (lynxLine) lynxLine.textContent = t(MECHANISMS_HELP_LYNX_KEY);
  }

  /**
   * Brings the Connections section in line with the cell it is about. Skipped during a stroke (the document changes
   * at every cell and the section is redrawn once when the stroke ends) and keyed so that only a new level, edit,
   * cell or language redraws it. While the focus is inside the section its cell stays the one shown, so a list
   * never changes under the keyboard.
   */
  private refreshConnections(): void {
    const section = byId(CONNECTIONS_SECTION_ID);
    if (!section || this.stroke || this.connectionsDrawing) return;
    const cc3d = this.isCc3d();
    this.refreshMechanismsHelp(cc3d);
    section.classList.remove('hidden');
    // A CC3D level stores no link: its rows come from where things stand, and the section says so.
    const derived = byId(CONNECTIONS_DERIVED_ID);
    if (derived) {
      derived.classList.toggle('hidden', !cc3d);
      derived.textContent = cc3d ? t(CC3D_CONNECTION_KEYS.derived) : '';
    }
    const inside = section.contains(document.activeElement) || this.connectionsPointerInside;
    // A link session pins the section to the device being linked: the pointer and the cursor move freely over the map.
    const session = this.linkSession;
    const subject = session ? { x: session.x, y: session.y } : inside ? this.connectionsShown : this.connectionsSubject();
    const key = [
      this.loadGeneration,
      this.docRevision,
      subject?.x ?? '',
      subject?.y ?? '',
      i18n.getLocale(),
      this.doc.ruleset ?? '',
      session ? 'linking' : '',
      this.issuesRevision,
      this.checkOverlay ?? ''
    ].join(':');
    if (key === this.connectionsKey) return;
    this.connectionsKey = key;
    this.connectionsShown = subject;
    this.connectionsDrawing = true;
    try {
      this.drawConnections(section, subject);
    } finally {
      this.connectionsDrawing = false;
    }
  }

  private drawConnections(section: HTMLElement, subject: { x: number; y: number } | null): void {
    const caption = byId(CONNECTIONS_CELL_ID);
    const controls = byId(CONNECTIONS_CONTROLS_ID);
    const controlled = byId(CONNECTIONS_CONTROLLED_ID);
    if (!caption || !controls || !controlled) return;
    // Rebuilding drops the focused row: remember its position (and which of its two buttons) to give the focus back.
    const focused = document.activeElement;
    const rowsBefore = Array.from(section.querySelectorAll<HTMLElement>(`.${CONNECTION_ROW_CLASS}`));
    const focusedRow = rowsBefore.findIndex((row) => focused !== null && row.contains(focused));
    const focusedUnlink = focusedRow >= 0 && focused instanceof HTMLElement && !focused.classList.contains(CONNECTION_GOTO_CLASS);
    controls.innerHTML = '';
    controlled.innerHTML = '';
    this.connectionsRowCell = null;
    const view = subject ? this.connectionViewAt(subject.x, subject.y) : null;
    const message = view?.caption;
    caption.textContent = view
      ? message
        ? t(message.key, { x: message.x, y: message.y, name: message.name ? t(message.name.key, message.name.params) : '' })
        : ''
      : t(CONNECTIONS_NO_CELL_KEY);
    byId(CONNECTIONS_LISTS_ID)?.classList.toggle('hidden', !view?.controls);
    if (view?.controls) this.fillConnectionList(controls, view.controls);
    if (view?.controlledBy) this.fillConnectionList(controlled, view.controlledBy);
    const note = byId(CONNECTIONS_NOTE_ID);
    if (note) note.textContent = view?.note ? connectionNoteText(view.note, t) : '';
    this.drawConnectionIssues(view && subject ? subject : null);
    this.connectionsLink = view?.link ?? null;
    this.syncConnectionsLinkButton();
    if (focusedRow < 0) return;
    const rowsAfter = Array.from(section.querySelectorAll<HTMLElement>(`.${CONNECTION_ROW_CLASS}`));
    const target = rowsAfter[focusedRow] ?? rowsAfter[focusedRow - 1];
    const unlinkButton = focusedUnlink ? target?.querySelector<HTMLElement>(`button:not(.${CONNECTION_GOTO_CLASS})`) : null;
    const gotoButton = target?.querySelector<HTMLElement>(`.${CONNECTION_GOTO_CLASS}`);
    (unlinkButton ?? gotoButton ?? caption).focus({ preventScroll: true });
  }

  /** The issues of a check that point at a cell, errors first; none without a check or a cell. */
  private issuesAt(issues: ValidationIssue[] | null, cell: { x: number; y: number } | null): ValidationIssue[] {
    return cell && issues ? issuesAtCell(issues, cell.x, cell.y, this.mapWidth(), this.mapHeight()) : [];
  }

  /** What the Connections section would show for these issues: their severities and words, in order. */
  private issuesSignature(issues: ValidationIssue[]): string {
    return JSON.stringify(issues.map((issue) => [issue.severity, this.formatIssue(issue)]));
  }

  /** The problems of the last check that point at the shown cell: a glyph and the text, no jump (it is this cell). */
  private drawConnectionIssues(subject: { x: number; y: number } | null): void {
    const block = byId(CONNECTIONS_ISSUES_BLOCK_ID);
    const list = byId(CONNECTIONS_ISSUES_ID);
    if (!block || !list) return;
    list.innerHTML = '';
    this.connectionIssuesSubject = subject;
    const issues = this.issuesAt(this.lastIssues, subject);
    this.connectionIssuesSignature = this.issuesSignature(issues);
    // As in the main list: the issues of a check that is running or was abandoned stay, dimmed, as out of date.
    const stale = this.checkOverlay !== null;
    list.dataset.stale = String(stale);
    if (stale) list.setAttribute('aria-description', t('editor.issues.stale.label'));
    else list.removeAttribute('aria-description');
    block.classList.toggle('hidden', issues.length === 0);
    for (const issue of issues) {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'editor-issue-row';
      row.dataset.severity = issue.severity;
      const glyph = document.createElement('span');
      glyph.className = 'editor-issue-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = SEVERITY_GLYPHS[issue.severity];
      const severity = document.createElement('span');
      severity.className = 'sr-only';
      severity.textContent = t(`editor.issues.severity.${issue.severity}.label`);
      const text = document.createElement('span');
      text.textContent = this.formatIssue(issue);
      row.append(glyph, severity, text);
      item.appendChild(row);
      list.appendChild(item);
    }
  }

  private fillConnectionList(list: HTMLElement, data: ConnectionList): void {
    for (const row of data.rows) list.appendChild(this.connectionRowItem(row));
    if (data.more > 0) {
      const more = document.createElement('li');
      more.className = 'hint-text editor-connections-more';
      more.textContent = t(CONNECTIONS_MORE_KEY, { count: data.more });
      list.appendChild(more);
    }
    if (data.empty) {
      const none = document.createElement('li');
      none.className = 'hint-text';
      none.textContent = t(data.empty.key);
      list.appendChild(none);
    }
  }

  /** The words of a row: the other cell's name and place, how they are wired, which mechanism, which colour. */
  private connectionRowText(row: ConnectionRow): string {
    const channel = row.channel === undefined ? [] : [CHANNEL_NAME_KEYS[row.channel] ? t(CHANNEL_NAME_KEYS[row.channel]) : row.channel];
    const detail = [t(KIND_NAME_KEYS[row.fallback ? 'fallback' : row.kind]), t(row.systemNameKey ?? systemNameKey(row.system)), ...channel].join(
      t(LIST_SEPARATOR_KEY)
    );
    return t(CONNECTIONS_ROW_KEY, { name: t(row.name.key, row.name.params), x: row.x, y: row.y, detail });
  }

  private connectionRowItem(row: ConnectionRow): HTMLLIElement {
    const item = document.createElement('li');
    item.className = CONNECTION_ROW_CLASS;
    const go = document.createElement('button');
    go.type = 'button';
    go.className = CONNECTION_GOTO_CLASS;
    go.dataset.kind = row.kind;
    go.textContent = this.connectionRowText(row);
    go.title = t(ISSUE_JUMP_TITLE_KEY, { x: row.x, y: row.y });
    go.addEventListener('click', () => this.jumpToConnection(row));
    // The cell of the row the pointer or the focus is on is outlined thicker on the map.
    for (const [enter, leave] of [
      ['pointerenter', 'pointerleave'],
      ['focus', 'blur']
    ] as const) {
      go.addEventListener(enter, () => this.markConnectionRow({ x: row.x, y: row.y }));
      go.addEventListener(leave, () => this.markConnectionRow(null));
    }
    item.appendChild(go);
    const unlink = row.unlink;
    if (unlink) {
      const name = t(row.name.key, row.name.params);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hud-btn small';
      btn.textContent = t(CONNECTIONS_UNLINK_ACTION_KEY);
      btn.setAttribute('aria-label', t(CONNECTIONS_UNLINK_ARIA_KEY, { name, x: row.x, y: row.y }));
      btn.addEventListener('click', () => {
        // A click focuses its button in most browsers; do it where it does not, so the redraw knows where the focus was.
        btn.focus({ preventScroll: true });
        this.unlinkRelation(unlink);
      });
      item.appendChild(btn);
    }
    return item;
  }

  private markConnectionRow(cell: { x: number; y: number } | null): void {
    const same = this.connectionsRowCell?.x === cell?.x && this.connectionsRowCell?.y === cell?.y;
    this.connectionsRowCell = cell;
    if (!same) this.requestRender();
  }

  /** Puts the cursor on the cell of a row, scrolls it into view and gives the canvas the focus. */
  private jumpToConnection(row: ConnectionRow): void {
    this.moveCursorTo({ x: row.x, y: row.y }, false);
    this.canvas.focus({ preventScroll: true });
  }

  /**
   * The Link button: shown on a device that takes part in a link (disabled with the reason when it cannot start one),
   * and reading Done while a session is open on the cell shown.
   */
  private syncConnectionsLinkButton(): void {
    const button = byId<HTMLButtonElement>(CONNECTIONS_LINK_BTN_ID);
    if (!button) return;
    const link = this.connectionsLink;
    button.classList.toggle('hidden', link?.type !== 'start');
    button.removeAttribute('aria-disabled');
    button.removeAttribute('aria-description');
    button.removeAttribute('title');
    if (link?.type !== 'start') return;
    const session = this.linkSession;
    const shown = this.connectionsShown;
    if (session && shown && session.x === shown.x && session.y === shown.y) {
      button.textContent = t(CONNECTIONS_LINK_DONE_KEY);
      return;
    }
    button.textContent = t(CONNECTIONS_LINK_ACTION_KEY);
    const refusal = linkAvailability(editableRulesetOf(this.doc.ruleset), link.system);
    const reason = link.blocked ? t(CONNECTIONS_LINK_BLOCKED_KEY) : refusal.available ? null : t(refusal.reasonKey);
    if (reason === null) {
      button.title = t(CONNECTIONS_LINK_HINT_KEY);
      return;
    }
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-description', reason);
    button.title = reason;
  }

  private onConnectionsLinkClick(): void {
    const button = byId<HTMLButtonElement>(CONNECTIONS_LINK_BTN_ID);
    const subject = this.connectionsShown;
    const link = this.connectionsLink;
    if (!button || !subject || link?.type !== 'start' || this.stroke || this.isCc3d()) return;
    const session = this.linkSession;
    if (session && session.x === subject.x && session.y === subject.y) {
      this.endLinkSession(true);
      this.canvas.focus({ preventScroll: true });
      return;
    }
    if (button.getAttribute('aria-disabled') === 'true') {
      this.setStatusText(button.getAttribute('aria-description') ?? '');
      return;
    }
    this.startLinkAt(subject);
  }

  // ---------------------------------------------------------------------------
  // Link sessions
  // ---------------------------------------------------------------------------

  /** The ruleset the link logic reads: the one the level plays under. */
  private linkRuleset(): Ruleset {
    return editableRulesetOf(this.doc.ruleset);
  }

  /**
   * Opens a link session on the device at `cell` (the K key, the Link button), or says why it cannot. The tool and the
   * brush stay as they are; a floating paste and the selection gesture end, the cursor moves to the device and the
   * canvas takes the focus.
   */
  private startLinkAt(cell: { x: number; y: number }): void {
    if (this.stroke || this.isCc3d()) return;
    const ruleset = this.linkRuleset();
    // A Lynx level has no shot devices: say why instead of saying there is nothing to link.
    const shotRefusal = linkAvailability(ruleset, 'shot');
    if (!shotRefusal.available && (holdsLinkEnd(this.doc, 'shot', 'button', cell.x, cell.y) || holdsLinkEnd(this.doc, 'shot', 'target', cell.x, cell.y))) {
      this.setStatusText(t(shotRefusal.reasonKey));
      return;
    }
    const started = startLinkSession(this.doc, cell.x, cell.y, ruleset);
    if (!started.session) {
      this.announce(started.messages);
      return;
    }
    this.cancelPaste();
    this.selectionGesture = null;
    this.linkSession = started.session;
    this.linkCandidatesCache = null;
    this.moveCursorTo(cell, false);
    this.canvas.focus({ preventScroll: true });
    this.announce(started.messages);
    this.connectionsKey = '';
    this.render();
  }

  /**
   * Ends the open link session. With `announce` the status line says what the device is linked to; without, nothing
   * is said (the caller is about to say something else). Returns whether a session was open.
   */
  private endLinkSession(announce: boolean): boolean {
    const session = this.linkSession;
    if (!session) return false;
    this.linkSession = null;
    this.linkCandidatesCache = null;
    if (announce) {
      const done = sessionClick(this.doc, session, { x: session.x, y: session.y }, this.activeDir, this.linkRuleset());
      this.announce(done.messages);
    }
    this.connectionsKey = '';
    // An announced end (Escape, Done, a click on the source) redraws at once; a silent one lets the caller's own redraw follow.
    if (announce) this.render();
    else this.requestRender();
    return true;
  }

  /** Ends the session when its source no longer holds its role (after an edit, an undo or a redo), saying so. */
  private revalidateLinkSession(): void {
    const session = this.linkSession;
    if (!session || sessionSourceHolds(this.doc, session, this.linkRuleset())) return;
    const ruleset = this.linkRuleset();
    // The source still holds its end but the ruleset no longer carries the system (a switch to Lynx): say why.
    const refusal = linkAvailability(ruleset, session.system);
    const stillThere = holdsLinkEnd(this.doc, session.system, session.end, session.x, session.y);
    const messages = stillThere && !refusal.available
      ? [{ key: refusal.reasonKey }]
      : sessionClick(this.doc, session, { x: session.x, y: session.y }, this.activeDir, ruleset).messages;
    this.linkSession = null;
    this.linkCandidatesCache = null;
    this.announce(messages);
    this.connectionsKey = '';
  }

  /**
   * A primary click, Space or Enter on a cell while a session is open: links, unlinks, switches, places or refuses.
   * An edit is one history step of its own and keeps the session open.
   */
  private sessionAct(cell: { x: number; y: number }): void {
    const session = this.linkSession;
    if (!session) return;
    const base = this.doc;
    const outcome = sessionClick(base, session, cell, this.activeDir, this.linkRuleset());
    this.linkSession = outcome.session;
    this.linkCandidatesCache = null;
    if (outcome.map) {
      this.doc = withEditedMap(base, outcome.map);
      this.recordChange(base);
    }
    if (outcome.session && (outcome.session.x !== session.x || outcome.session.y !== session.y)) this.moveCursorTo(outcome.session, false);
    this.announce(outcome.messages);
    this.connectionsKey = '';
    this.render();
  }

  /** The partners the open session offers, kept for the current document. */
  private sessionPartners(): PartnerCandidates | null {
    const session = this.linkSession;
    if (!session) return null;
    const key = [this.loadGeneration, this.docRevision, session.system, session.end, session.x, session.y, this.doc.ruleset ?? ''].join(':');
    if (this.linkCandidatesCache?.key === key) return this.linkCandidatesCache.value;
    const value = partnerCandidates(this.doc, session, this.linkRuleset());
    this.linkCandidatesCache = { key, value };
    return value;
  }

  /** Removes one explicit link from its row, as one undoable edit, and says what that changed. */
  private unlinkRelation(unlink: ConnectionUnlink): void {
    if (this.stroke || this.isCc3d()) return;
    // The removers copy the map they change, so the document before the edit is the history base as it stands.
    const base = this.doc;
    const result =
      unlink.system === 'trap'
        ? removeTrapLink(base, unlink.button, unlink.target)
        : unlink.system === 'clone'
          ? removeCloneLink(base, unlink.button, unlink.target)
          : removeLauncherLink(base, unlink.button, unlink.target);
    if (!result.changed) {
      // The row was out of date: draw the list again.
      this.connectionsKey = '';
      this.render();
      return;
    }
    this.doc = withEditedMap(base, result.map);
    this.recordChange(base);
    const nameOf = (cell: { x: number; y: number }): string => {
      const name = connectionCellName(base, cell.x, cell.y);
      return t(name.key, name.params);
    };
    const messages = [
      t(CONNECTIONS_UNLINK_DONE_KEY, {
        button: nameOf(unlink.button),
        buttonX: unlink.button.x,
        buttonY: unlink.button.y,
        target: nameOf(unlink.target),
        targetX: unlink.target.x,
        targetY: unlink.target.y
      })
    ];
    if (unlink.system === 'trap' && !this.doc.trapLinks.some((l) => l.trapX === unlink.target.x && l.trapY === unlink.target.y)) {
      messages.push(t(CONNECTIONS_UNLINK_SUFFIX_TRAP_KEY));
    }
    if (unlink.system === 'clone' && !this.doc.cloneLinks.some((l) => l.buttonX === unlink.button.x && l.buttonY === unlink.button.y)) {
      // The red button now fires every machine with a creature, or nothing when no machine holds one.
      const firesAny = deviceRelations(this.doc, unlink.button.x, unlink.button.y).controls.some((r) => r.system === 'clone' && r.fallback === true);
      messages.push(t(firesAny ? CONNECTIONS_UNLINK_SUFFIX_CLONE_KEY : CONNECTIONS_UNLINK_SUFFIX_CLONE_NONE_KEY));
    }
    this.setStatusText(messages.join(SEPARATOR_BETWEEN_MESSAGES));
    // The redraw gives the focus to the row that took the place of the unlinked one, else the one above, else the caption.
    this.render();
  }

  /** The terrain tiles a cell of the Epoxy level can hide under its top, named and sorted by name. */
  private hiddenTerrainChoices(x: number, y: number): Array<{ id: string; name: string }> {
    const choices: Array<{ id: string; name: string }> = [];
    for (const tile of Object.values(ConfigRegistry.getTiles().tiles)) {
      if (tile.layer !== 'terrain') continue;
      if (normalizeUnderlays([{ x, y, terrain: tile.id }], this.doc.terrain, 'epoxy') === null) continue;
      choices.push({ id: tile.id, name: t(tile.i18nKey) });
    }
    const collator = this.nameCollator();
    return choices.sort((a, b) => collator.compare(a.name, b.name));
  }

  /** The collator of the current locale, built once and rebuilt when the locale changes. */
  private nameCollator(): Intl.Collator {
    const locale = i18n.getLocale();
    if (this.collatorCache?.locale !== locale) this.collatorCache = { locale, collator: new Intl.Collator(locale) };
    return this.collatorCache.collator;
  }

  /**
   * Fills the hidden terrain select for the cursor cell. Returns whether the section shows: there is a cursor
   * cell. The select is there when the cell's top is one the player removes, a short hint otherwise. The select
   * is disabled, with the reason, under Lynx rules.
   */
  private refreshHiddenTerrainField(): boolean {
    const field = byId(HIDDEN_TERRAIN_FIELD_ID);
    const select = byId<HTMLSelectElement>(HIDDEN_TERRAIN_INPUT_ID);
    const hint = byId(HIDDEN_TERRAIN_HINT_ID);
    const at = this.cursorCell;
    const topId = at ? this.doc.terrain[at.y]?.[at.x] : undefined;
    const top = topId !== undefined && ConfigRegistry.isTerrainTile(topId) ? ConfigRegistry.getTile(topId) : undefined;
    const applies = Boolean(at && top && isRemovableTop(top));
    field?.classList.toggle('hidden', !applies);
    const unavailable = byId(HIDDEN_TERRAIN_UNAVAILABLE_ID);
    unavailable?.classList.toggle('hidden', applies || !at);
    if (unavailable) unavailable.textContent = t('editor.layout.layers.hidden_terrain.unavailable.label');
    if (!applies || !at || !select) return Boolean(at);
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = HIDDEN_TERRAIN_NONE;
    none.textContent = t('editor.layout.layers.hidden_terrain.none.label');
    select.appendChild(none);
    for (const choice of this.hiddenTerrainChoices(at.x, at.y)) {
      const option = document.createElement('option');
      option.value = choice.id;
      option.textContent = choice.name;
      select.appendChild(option);
    }
    select.value = underlayAt(this.doc, at.x, at.y) ?? HIDDEN_TERRAIN_NONE;
    const lynx = editableRulesetOf(this.doc.ruleset) === LYNX_RULESET;
    select.disabled = lynx;
    if (hint) hint.textContent = t(lynx ? 'editor.layout.layers.hidden_terrain.lynx.label' : 'editor.layout.layers.hidden_terrain.hint.label');
    return true;
  }

  /** Sets or clears the terrain hidden under the cursor cell, as one undoable edit. */
  private setHiddenTerrain(value: string): void {
    const at = this.cursorCell;
    if (!at || this.stroke || this.isCc3d()) return;
    if (editableRulesetOf(this.doc.ruleset) === LYNX_RULESET) {
      this.refreshLayersList();
      return;
    }
    const terrain = value === HIDDEN_TERRAIN_NONE ? null : value;
    if ((underlayAt(this.doc, at.x, at.y) ?? null) === terrain) return;
    const base = cloneDocument(this.doc);
    const next = cloneDocument(this.doc);
    setUnderlayAt(next, at.x, at.y, terrain);
    // A shot trigger may have been hidden here: a link whose end no longer holds one is dropped.
    const droppedLinks = pruneLauncherLinks(next);
    if (sameDocument(base, next)) {
      this.refreshLayersList();
      return;
    }
    this.doc = next;
    this.recordChange(base);
    const messages: ToolMessage[] = [
      terrain === null
        ? { key: 'editor.layout.layers.hidden_terrain.cleared', params: { x: at.x, y: at.y } }
        : { key: 'editor.layout.layers.hidden_terrain.set', params: { x: at.x, y: at.y, name: t(ConfigRegistry.getTile(terrain).i18nKey) } }
    ];
    if (droppedLinks > 0) messages.push({ key: MESSAGE_LINKS_REMOVED, params: { count: droppedLinks } });
    this.setStatusText(messages.map((message) => t(message.key, message.params)).join(SEPARATOR_BETWEEN_MESSAGES));
    this.render();
  }

  /**
   * What a CC3D cell holds, bottom first: terrain layers, thin walls, the item and the creature. Each part has
   * its name (shared by the layers list and the spoken description) and the edit that removes it, or null when
   * it cannot be removed.
   */
  private cc3dCellParts(level: Cc3dLevel, x: number, y: number): Array<{ name: string; remove: (() => void) | null }> {
    const cell = cc3dCellAt(level, x, y);
    if (!cell) return [];
    const parts: Array<{ name: string; remove: (() => void) | null }> = [];
    cell.terrain.forEach((layer: Cc3dTerrain, index) => {
      const name =
        this.cc3dPartName('tile', () => displayTerrainId({ terrain: [layer], panels: [], item: null })) || layer.kind;
      const plainBase = index === 0 && layer.kind === 'floor';
      parts.push({ name, remove: plainBase ? null : () => this.commitCc3dEdit((current) => removeLayerAt(current, x, y, index)) });
    });
    for (const side of cell.panels) {
      const name = t('editor.cc3d.layers.panel', { side: t(SIDE_LABEL_KEYS[side]) });
      parts.push({ name, remove: () => this.commitCc3dEdit((current) => setPanelSide(current, x, y, side, false)) });
    }
    if (cell.item) {
      const item = cell.item;
      const name = this.cc3dPartName('tile', () => displayItemId(item) ?? '') || item.kind;
      parts.push({ name, remove: () => this.commitCc3dEdit((current) => setItem(current, x, y, null)) });
    }
    const mob = level.mobs.find((candidate) => candidate.x === x && candidate.y === y);
    if (mob) {
      const name = this.cc3dPartName('entity', () => displayMobId(mob)) || mob.kind;
      parts.push({ name, remove: () => this.commitCc3dEdit((current) => removeMob(current, x, y)) });
    }
    return parts;
  }

  /** An edit of the CC3D level made outside a stroke (the layers list): one history step. */
  private commitCc3dEdit(edit: (level: Cc3dLevel) => Cc3dLevel): void {
    const before = this.doc.cc3d;
    if (!before || this.stroke) return;
    // The level is read now, at the click, not when the list was drawn.
    const next = edit(before);
    if (next === before) return;
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
    this.docRevision++;
    this.isDirty = true;
    this.revalidateLinkSession();
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
      this.docRevision++;
      stroke.changed = true;
    }
    this.announce(outcome.messages);
    if (deferRender) this.requestRender();
    else this.render();
  }

  /**
   * Applies the active tool to a cell as part of the running stroke. `side` is the side of the cell a
   * thin wall acts on; `deferRender` redraws on the next frame (pointer moves) rather than at once.
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
      side,
      x,
      y,
      forceErase: stroke.forceErase
    });
    if (outcome.changed) {
      this.doc = withEditedMap(this.doc, outcome.map);
      this.docRevision++;
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
    this.floatingStamp = null;
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
    this.floatingStamp = null;
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
    this.doc = withEditedMap(this.doc, result.map);
    this.recordChange(before);
    this.render();
    return true;
  }

  /**
   * Puts an edit of the CC3D level made by a selection action in the document as one history step. Returns the
   * messages about the links it re-routed, or null when the level did not change.
   */
  private commitCc3dAreaEdit(level: Cc3dLevel, move?: Cc3dLinkTranslation): ToolMessage[] | null {
    const before = this.doc;
    const previous = before.cc3d;
    if (!previous || level === previous) return null;
    this.doc = withCc3d(before, level);
    this.recordChange(before);
    this.render();
    return this.cc3dLinkMessages(previous, level, move);
  }

  /** The status messages that follow a CC3D paste or move: the creatures it replaced and the ones it left out. */
  private cc3dAreaAftermath(result: Cc3dAreaResult): ToolMessage[] {
    const messages: ToolMessage[] = [];
    if (result.removedMobs > 0) messages.push({ key: MESSAGE_CC3D_AREA_MOBS_REMOVED, params: { count: result.removedMobs } });
    if (result.skippedMobs > 0) messages.push({ key: MESSAGE_CC3D_AREA_MOBS_SKIPPED, params: { count: result.skippedMobs } });
    return messages;
  }

  /** The status messages that follow a selection edit: the links it dropped and the entries it skipped. */
  private selectionAftermath(result: SelectionEditResult): ToolMessage[] {
    const messages: ToolMessage[] = [];
    if (result.droppedLinks > 0) messages.push({ key: 'editor.selection.status.links_dropped', params: { count: result.droppedLinks } });
    if (result.pastedLinks) messages.push({ key: 'editor.selection.status.links_pasted.label', params: { count: result.pastedLinks } });
    if (result.linksNotPasted) messages.push({ key: 'editor.selection.status.links_not_pasted.label', params: { count: result.linksNotPasted } });
    if (result.skipped > 0) messages.push({ key: 'editor.selection.status.paste_skipped', params: { count: result.skipped } });
    if (result.droppedUnderlays) messages.push({ key: MESSAGE_UNDERLAYS_REMOVED, params: { count: result.droppedUnderlays } });
    if (result.borderSkipped > 0) messages.push({ key: 'editor.selection.status.border_skipped', params: { count: result.borderSkipped } });
    return messages;
  }

  /**
   * Runs a selection key chord. Returns whether the chord was taken, so the
   * application leaves the browser's own handling alone only then.
   */
  public handleSelectionAction(action: SelectionKeyAction): boolean {
    // A fill is taken even then: Shift+F must not turn into a tool change in the middle of a gesture.
    if (this.stroke || this.selectionGesture) return action.kind === 'fill';
    if (action.kind === 'paste') return this.beginPaste();
    // While a paste floats, only the paste itself acts: Delete, Alt+Arrow and the fill are ignored.
    if (this.pasting && (action.kind === 'clear' || action.kind === 'move' || action.kind === 'fill')) return true;
    if (!this.selection) {
      if (this.tool !== 'select') return false;
      this.announce([{ key: 'editor.selection.status.none' }]);
      // With nothing selected, Shift+F on another tool still picks the fill tool; on Select it only says so.
      return action.kind === 'fill';
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
      case 'fill':
        this.fillSelection();
        break;
      case 'move':
        this.moveSelectionBy(action.dx, action.dy);
        break;
    }
    return true;
  }

  /** True when choosing a palette entry leaves the Select tool and its selection as they are. */
  private keepsSelectionOnChoice(): boolean {
    return this.tool === 'select' && this.selection !== null && !this.pasting;
  }

  /** The name of the Epoxy palette entry a brush stands for. */
  private brushLabel(brush: Brush): string {
    switch (brush.kind) {
      case 'terrain':
      case 'item': {
        const tile = ConfigRegistry.getTile(brush.id);
        return tile ? t(tile.i18nKey) : brush.id;
      }
      case 'entity': {
        const entity = ConfigRegistry.getEntityDef(brush.id);
        return entity ? t(entity.i18nKey) : brush.id;
      }
      default:
        return brush.id;
    }
  }

  /** The status message that explains why an entry cannot fill a selection. */
  private fillRefusalMessage(refusal: FillRefusal): ToolMessage {
    switch (refusal.reason) {
      case 'unavailable':
        return { key: refusal.reasonKey };
      case 'cell_edge':
        return { key: MESSAGE_FILL_REFUSED_CELL_EDGE };
      case 'unsupported':
        return { key: MESSAGE_FILL_REFUSED_ENTRY };
    }
  }

  /** Says what Shift+F does with the entry just chosen, or why it cannot fill. */
  private announceFillChoice(refusal: ToolMessage | null, name: string): void {
    this.announce([refusal ?? { key: 'editor.selection.status.fill_hint', params: { name } }]);
  }

  /** Fills the selected cells with the chosen palette entry, as one history step. The selection stays. */
  private fillSelection(): void {
    const rect = this.selection;
    if (!rect) return;
    const cc3d = this.doc.cc3d;
    if (cc3d) {
      this.fillCc3dSelection(cc3d, rect);
      return;
    }
    const brush = this.brush;
    const result = fillRect(this.doc, rect, brush, this.activeDir, editableRulesetOf(this.doc.ruleset));
    if (result.refusal) {
      this.announce([this.fillRefusalMessage(result.refusal)]);
      return;
    }
    const messages: ToolMessage[] = [];
    if (result.droppedLinks > 0) messages.push({ key: 'editor.selection.status.links_dropped', params: { count: result.droppedLinks } });
    if (result.droppedUnderlays) messages.push({ key: MESSAGE_UNDERLAYS_REMOVED, params: { count: result.droppedUnderlays } });
    if (result.borderSkipped > 0) messages.push({ key: 'editor.selection.status.border_skipped', params: { count: result.borderSkipped } });
    if (result.playerStartKept) messages.push({ key: 'editor.selection.status.fill_start_kept' });
    const cloners = result.clonerTemplates ?? [];
    if (cloners.length === 1) messages.push(clonerTemplateMessage(cloners[0]));
    else if (cloners.length > 1) messages.push(clonersTemplateMessage(cloners.length, cloners[0].type, cloners[0].dir));
    if (!this.commitSelectionEdit(result)) {
      this.announce([{ key: 'editor.selection.status.unchanged' }, ...messages]);
      return;
    }
    this.announce([
      { key: 'editor.selection.status.filled', params: { width: rect.width, height: rect.height, name: this.brushLabel(brush) } },
      ...messages
    ]);
  }

  private fillCc3dSelection(cc3d: Cc3dLevel, rect: CellRect): void {
    const entry = this.cc3dEntry();
    if (!entry || !this.cc3dEntryFillable(entry)) {
      this.announce([{ key: MESSAGE_FILL_REFUSED_ENTRY }]);
      return;
    }
    const attrs = this.cc3dAttrs;
    const dir = this.activeDir;
    let content: Cc3dFillContent;
    if (entry.action === 'layer') content = { action: 'layer', layer: layerOf(entry, attrs, dir) };
    else if (entry.action === 'item') content = { action: 'item', item: itemOf(entry, attrs) };
    else content = { action: 'mob', mob: mobOf(entry, attrs, dir, 0, 0) };
    const result = fillCc3dRect(cc3d, rect, content);
    if (result.refused) {
      this.announce([{ key: MESSAGE_FILL_REFUSED_ATTRIBUTES }]);
      return;
    }
    const links = this.commitCc3dAreaEdit(result.level);
    if (links === null) {
      this.announce([{ key: 'editor.selection.status.unchanged' }, ...this.cc3dAreaAftermath(result)]);
      return;
    }
    const name = this.cc3dEntryLabel(entry, entryDisplay(entry, attrs, dir));
    this.announce([
      { key: 'editor.selection.status.filled', params: { width: rect.width, height: rect.height, name } },
      ...this.cc3dAreaAftermath(result),
      ...links
    ]);
  }

  /** The fill button follows the selection: it works only with one, and not while a paste floats. */
  private updateFillSelectionButton(): void {
    const button = byId('editor-fill-selection-btn');
    const disabled = !this.selection || this.pasting;
    button?.setAttribute('aria-disabled', String(disabled));
    button?.classList.toggle('is-unavailable', disabled);
  }

  /** A click on the fill button. Unlike the keys, it answers when there is nothing to fill. */
  private fillSelectionFromButton(): void {
    if (this.pasting) {
      this.announce([{ key: 'editor.selection.status.paste_ready' }]);
      return;
    }
    if (!this.selection) {
      this.announce([{ key: 'editor.selection.status.none' }]);
      return;
    }
    this.handleSelectionAction({ kind: 'fill' });
  }

  private copySelection(cut: boolean): void {
    const rect = this.selection;
    if (!rect) return;
    const cc3d = this.doc.cc3d;
    selectionClipboard = cc3d
      ? { kind: 'cc3d', clip: extractCc3dClip(cc3d, rect, cut) }
      : { kind: 'epoxy', clip: extractClip(this.doc, rect, cut) };
    const size = { width: rect.width, height: rect.height };
    if (!cut) {
      const withStart = rectContains(rect, this.doc.playerStart.x, this.doc.playerStart.y);
      const leftOut = selectionClipboard.kind === 'epoxy' ? (selectionClipboard.clip.linksLeftOut ?? 0) : 0;
      this.announce([
        { key: withStart ? 'editor.selection.status.copied_no_start' : 'editor.selection.status.copied', params: size },
        ...(leftOut > 0 ? [{ key: 'editor.selection.status.links_left_out.label', params: { count: leftOut } }] : [])
      ]);
      return;
    }
    if (cc3d) {
      const cleared = clearCc3dRect(cc3d, rect);
      const links = this.commitCc3dAreaEdit(cleared.level) ?? [];
      this.announce([{ key: cleared.playerKept ? 'editor.selection.status.cut_start_kept' : 'editor.selection.status.cut', params: size }, ...links]);
      return;
    }
    const result = clearRect(this.doc, rect);
    this.commitSelectionEdit(result);
    // The links the clip carries are not lost: they come back with a paste. Only the others are reported as dropped.
    const carried = selectionClipboard.kind === 'epoxy' ? clipLinkCount(selectionClipboard.clip) : 0;
    this.announce([
      { key: result.playerStartKept ? 'editor.selection.status.cut_start_kept' : 'editor.selection.status.cut', params: size },
      ...this.selectionAftermath({ ...result, droppedLinks: Math.max(0, result.droppedLinks - carried) })
    ]);
  }

  private clearSelectedCells(): void {
    const rect = this.selection;
    if (!rect) return;
    const cc3d = this.doc.cc3d;
    if (cc3d) {
      const cleared = clearCc3dRect(cc3d, rect);
      const links = this.commitCc3dAreaEdit(cleared.level);
      if (links === null) {
        this.announce([{ key: cleared.playerKept ? MESSAGE_CC3D_AREA_PLAYER_KEPT : 'editor.selection.status.unchanged' }]);
        return;
      }
      this.announce([
        { key: 'editor.selection.status.cleared', params: { width: rect.width, height: rect.height } },
        ...(cleared.playerKept ? [{ key: MESSAGE_CC3D_AREA_PLAYER_KEPT }] : []),
        ...links
      ]);
      return;
    }
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
    const cc3d = this.doc.cc3d;
    let committed: boolean;
    let resultRect: CellRect | null;
    let messages: ToolMessage[] = [];
    if (cc3d) {
      const result = moveCc3dRect(cc3d, rect, dx, dy);
      resultRect = result.rect;
      const move = result.rect ? { rect, dx: result.rect.x - rect.x, dy: result.rect.y - rect.y } : undefined;
      const links = this.commitCc3dAreaEdit(result.level, move);
      committed = links !== null;
      if (links) messages = [...this.cc3dAreaAftermath(result), ...(result.playerKept ? [{ key: MESSAGE_CC3D_AREA_PLAYER_KEPT }] : []), ...links];
    } else {
      const result = moveRect(this.doc, rect, dx, dy);
      resultRect = result.rect;
      committed = this.commitSelectionEdit(result);
      messages = this.selectionAftermath(result);
    }
    if (!committed) {
      // Nothing to move but the outline: it still follows the key, with no history step.
      if (resultRect && (resultRect.x !== rect.x || resultRect.y !== rect.y)) {
        this.selection = resultRect;
        this.selectionAnchor = null;
        this.render();
      }
      return;
    }
    this.selection = resultRect;
    this.selectionAnchor = null;
    this.announce([{ key: 'editor.selection.status.moved' }, ...messages]);
    this.render();
  }

  /** Starts a floating paste of the clipboard at the cursor or the last hovered cell. */
  private beginPaste(): boolean {
    if (!selectionClipboard) {
      this.announce([{ key: 'editor.selection.status.nothing_to_paste' }]);
      return false;
    }
    const refusal = this.clipboardRefusal(selectionClipboard);
    if (refusal) {
      this.announce([refusal]);
      return false;
    }
    // A paste is a selection action: the placed cells live under the Select tool.
    this.floatingStamp = null;
    this.setTool('select');
    this.endLinkSession(false);
    this.pasting = true;
    this.pasteAnchor = this.cursorCell ?? this.lastHoverCell ?? { x: 0, y: 0 };
    this.announce([{ key: 'editor.selection.status.paste_ready' }]);
    this.render();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Mechanism stamps
  // ---------------------------------------------------------------------------

  /** What floats while a paste is pending: the stamp when there is one, else the clipboard. */
  private floatingClipboard(): SelectionClipboard | null {
    if (this.pasting && this.floatingStamp) {
      return { kind: 'epoxy', clip: mechanismStampClip(this.floatingStamp.stamp, this.floatingStamp.layout) };
    }
    return selectionClipboard;
  }

  /** The stamps the open level can place: none on a CC3D level. */
  private availableStamps(): MechanismStamp[] {
    return this.isCc3d() ? [] : mechanismStampsFor(editableRulesetOf(this.doc.ruleset));
  }

  /** The Stamps button is for Epoxy and Lynx levels only. */
  private updateStampsButton(): void {
    const cc3d = this.isCc3d();
    byId('editor-stamps-btn')?.classList.toggle('hidden', cc3d);
    if (cc3d) this.closeStampsMenu(false);
  }

  private bindStampsMenu(): void {
    const button = byId('editor-stamps-btn');
    const menu = byId('editor-stamps-menu');
    if (!button || !menu) return;
    button.addEventListener('click', () => {
      if (menu.classList.contains('hidden')) this.openStampsMenu();
      else this.closeStampsMenu(true);
    });
    const wrapper = byId('editor-stamps') ?? menu;
    // Escape closes an open menu from the button or from an item; a closed menu leaves the key to the editor.
    wrapper.addEventListener('keydown', (ev) => {
      if (ev.key !== STAMPS_MENU_CLOSE_KEY || menu.classList.contains('hidden')) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.closeStampsMenu(true);
    });
    // Tabbing out of the menu closes it.
    wrapper.addEventListener('focusout', (ev) => {
      if (menu.classList.contains('hidden')) return;
      if (ev.relatedTarget instanceof Node && wrapper.contains(ev.relatedTarget)) return;
      this.closeStampsMenu(false);
    });
    // A click anywhere else closes the menu. Page-level, so it goes when the editor is disposed.
    document.addEventListener(
      'click',
      (ev) => {
        if (menu.classList.contains('hidden')) return;
        if (ev.target instanceof Node && (menu.contains(ev.target) || button.contains(ev.target))) return;
        this.closeStampsMenu(false);
      },
      { signal: this.draftListeners.signal }
    );
  }

  /** Lists the stamps of the level's ruleset, with a one-line description each, and moves the focus to the first. */
  private openStampsMenu(): void {
    const menu = byId('editor-stamps-menu');
    const button = byId('editor-stamps-btn');
    if (!menu || !button) return;
    const stamps = this.availableStamps();
    if (stamps.length === 0) {
      this.announce([{ key: 'editor.stamps.status.unavailable.label' }]);
      return;
    }
    menu.replaceChildren(
      ...stamps.map((stamp) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'editor-stamp-item';
        item.dataset.stamp = stamp.id;
        const name = document.createElement('span');
        name.className = 'editor-stamp-name';
        name.textContent = t(stamp.i18nKey);
        const desc = document.createElement('span');
        desc.className = 'editor-stamp-desc';
        desc.textContent = t(stamp.descI18nKey);
        item.append(name, desc);
        item.addEventListener('click', () => {
          this.closeStampsMenu(false);
          this.beginStamp(stamp.id);
        });
        return item;
      })
    );
    menu.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector<HTMLButtonElement>('.editor-stamp-item')?.focus();
  }

  private closeStampsMenu(returnFocus: boolean): void {
    const menu = byId('editor-stamps-menu');
    const button = byId('editor-stamps-btn');
    if (!menu || menu.classList.contains('hidden')) return;
    menu.classList.add('hidden');
    button?.setAttribute('aria-expanded', 'false');
    if (returnFocus) button?.focus();
  }

  /**
   * Floats a stamp in place of a paste. The copied clipboard is left as it is, so a stamp never costs the author a
   * copy; the stamp is placed, turned and cancelled like a paste, and is one undo step.
   */
  private beginStamp(id: string): boolean {
    const stamp = this.availableStamps().find((candidate) => candidate.id === id);
    if (!stamp) {
      this.announce([{ key: 'editor.stamps.status.unavailable.label' }]);
      return false;
    }
    this.setTool('select');
    this.endLinkSession(false);
    this.floatingStamp = { stamp, layout: STAMP_DEFAULT_LAYOUT };
    this.pasting = true;
    this.pasteAnchor = this.cursorCell ?? this.lastHoverCell ?? { x: 0, y: 0 };
    this.announce([{ key: 'editor.stamps.status.ready.label', params: { name: t(stamp.i18nKey) } }]);
    // Back to the canvas, where the stamp is placed with a click or Enter.
    this.canvas.focus({ preventScroll: true });
    this.render();
    return true;
  }

  /** Shift+R on a floating stamp: swaps its horizontal and vertical layouts. */
  private turnStamp(): void {
    const floating = this.floatingStamp;
    if (!floating) return;
    floating.layout = turnedStampLayout(floating.layout);
    this.announce([
      {
        key: 'editor.stamps.status.turned.label',
        params: { name: t(floating.stamp.i18nKey), layout: t(STAMP_LAYOUT_KEYS[floating.layout]) }
      }
    ]);
    this.render();
  }

  /** The message that refuses a paste of cells from the other kind of level, or null when the clipboard fits this one. */
  private clipboardRefusal(clipboard: SelectionClipboard): ToolMessage | null {
    const cc3d = this.isCc3d();
    if (clipboard.kind === (cc3d ? 'cc3d' : 'epoxy')) return null;
    return { key: cc3d ? 'editor.selection.status.paste_refused_epoxy' : 'editor.selection.status.paste_refused_cc3d' };
  }

  /** Places a floating paste of CC3D cells with its top-left cell on the given cell. */
  private placeCc3dPaste(clip: Cc3dClip, cell: { x: number; y: number }): void {
    const cc3d = this.doc.cc3d;
    if (!cc3d) return;
    const result = pasteCc3dClip(cc3d, clip, cell.x, cell.y);
    if (!result.rect) {
      this.announce([{ key: 'editor.selection.status.unchanged' }]);
      return;
    }
    this.pasting = false;
    this.floatingStamp = null;
    const links = this.commitCc3dAreaEdit(result.level) ?? [];
    this.selection = result.rect;
    this.selectionAnchor = null;
    this.announce([
      result.changed
        ? { key: 'editor.selection.status.pasted', params: { width: result.rect.width, height: result.rect.height } }
        : { key: 'editor.selection.status.unchanged' },
      ...this.cc3dAreaAftermath(result),
      ...(result.playerKept ? [{ key: MESSAGE_CC3D_AREA_PLAYER_KEPT }] : []),
      ...(result.playerMoved ? [{ key: MESSAGE_CC3D_AREA_PLAYER_MOVED }] : []),
      ...links
    ]);
    this.render();
  }

  /** Places the floating paste with its top-left cell on the given cell. */
  private placePaste(cell: { x: number; y: number }): void {
    const clipboard = this.floatingClipboard();
    if (!clipboard) return;
    const refusal = this.clipboardRefusal(clipboard);
    if (refusal) {
      this.pasting = false;
      this.floatingStamp = null;
      this.announce([refusal]);
      this.render();
      return;
    }
    this.pasteAnchor = cell;
    if (clipboard.kind === 'cc3d') {
      this.placeCc3dPaste(clipboard.clip, cell);
      return;
    }
    const clip = clipboard.clip;
    const result = pasteClip(this.doc, clip, cell.x, cell.y, editableRulesetOf(this.doc.ruleset));
    if (!result.rect) {
      this.announce([{ key: 'editor.selection.status.unchanged' }]);
      return;
    }
    this.pasting = false;
    this.floatingStamp = null;
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
    const clipboard = this.floatingClipboard();
    if (this.pasting && clipboard?.kind === 'epoxy') this.drawPastePreview(clipboard.clip, s);
    else if (this.pasting && clipboard?.kind === 'cc3d') this.drawPastePreview(this.cc3dPreviewOf(clipboard.clip), s, clipboard.clip.cells);
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

  /** A CC3D clip as the layers the preview draws: its mobs are already relative to the clip. */
  private cc3dPreviewOf(clip: Cc3dClip): Clip {
    const cached = cc3dPreviewClips.get(clip);
    if (cached) return cached;
    const { terrain, items, entities } = deriveDisplayLayers(clip);
    const preview: Clip = {
      width: clip.width,
      height: clip.height,
      terrain,
      items,
      entities: entities.map((entity) => ({ dx: entity.x, dy: entity.y, type: entity.type, dir: entity.dir })),
      playerStart: clip.player
    };
    cc3dPreviewClips.set(clip, preview);
    return preview;
  }

  /** `cells` are the CC3D cells behind the clip, whose thin walls are drawn over the tiles. */
  private drawPastePreview(clip: Clip, s: number, cells?: readonly Cc3dCell[]): void {
    const { x: ox, y: oy } = this.pasteAnchor;
    this.ctx.save();
    this.ctx.globalAlpha = EDITOR_PASTE_PREVIEW_ALPHA;
    for (let cy = 0; cy < clip.height; cy++) {
      for (let cx = 0; cx < clip.width; cx++) {
        const px = (ox + cx) * s;
        const py = (oy + cy) * s;
        this.renderer.drawTile(this.ctx, clip.terrain[cy][cx], px, py, s, true, true);
        const cc3dCell = cells?.[cy * clip.width + cx];
        if (cc3dCell && cc3dCell.panels.length > 0 && !displayShowsPanels(cc3dCell)) {
          this.renderer.drawCellOverlay(this.ctx, cc3dCell.panels, false, px, py, s);
        }
        const item = clip.items[cy][cx];
        if (item) this.renderer.drawItem(this.ctx, item, px, py, s);
      }
    }
    // Thin walls and hidden terrain are Epoxy features: a Lynx level neither draws nor receives them.
    const clipEdges = this.doc.ruleset === LYNX_RULESET ? [] : (clip.edges ?? []);
    for (const edge of clipEdges) {
      this.renderer.drawCellOverlay(this.ctx, edge.sides, false, (ox + edge.dx) * s, (oy + edge.dy) * s, s);
    }
    const clipUnderlays = this.doc.ruleset === LYNX_RULESET ? [] : (clip.underlays ?? []);
    if (clipUnderlays.length > 0) {
      this.renderer.setHiddenLayerMarkers(true);
      try {
        for (const hidden of clipUnderlays) {
          this.renderer.drawCellOverlay(this.ctx, undefined, true, (ox + hidden.dx) * s, (oy + hidden.dy) * s, s, hiddenTerrainClosed(hidden.terrain));
        }
      } finally {
        this.renderer.setHiddenLayerMarkers(false);
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
  private drawCellLayers(
    ctx: CanvasRenderingContext2D,
    doc: EditorDocument,
    x: number,
    y: number,
    s: number,
    edgeSides: ReadonlyMap<number, readonly Direction[]> | null,
    hiddenCells: ReadonlyMap<number, boolean | undefined> | null,
    width: number
  ): void {
    this.renderer.drawTile(ctx, doc.terrain[y][x], x * s, y * s, s, true, true);
    const cc3d = doc.cc3d;
    if (cc3d) {
      const cell = cc3d.cells[y * cc3d.width + x];
      const edges = cell.panels.length > 0 && !displayShowsPanels(cell) ? cell.panels : undefined;
      this.renderer.drawCellOverlay(ctx, edges, hasHiddenLayers(cell), x * s, y * s, s);
    } else {
      const index = y * width + x;
      const sides = edgeSides?.get(index);
      const marked = hiddenCells?.has(index) ?? false;
      if (sides || marked) this.renderer.drawCellOverlay(ctx, sides, marked, x * s, y * s, s, hiddenCells?.get(index));
    }
    const item = doc.items[y][x];
    if (item) this.renderer.drawItem(ctx, item, x * s, y * s, s);
  }

  /**
   * The cells of an Epoxy document that hide terrain, by cell index, kept per list so a redraw does not rebuild
   * them. The value is the stored state of a hidden toggle wall or hold door (true closed), undefined otherwise.
   */
  private hiddenTerrainCells(doc: EditorDocument): ReadonlyMap<number, boolean | undefined> | null {
    const underlays = doc.underlays;
    if (!underlays || underlays.length === 0) return null;
    const width = mapWidthOf(doc);
    let cells = hiddenTerrainCellsMemo.get(underlays);
    if (!cells) {
      cells = new Map(underlays.map((u) => [u.y * width + u.x, hiddenTerrainClosed(u.terrain)]));
      hiddenTerrainCellsMemo.set(underlays, cells);
    }
    return cells;
  }

  /** The thin walls of an Epoxy document by cell index, kept per list so a redraw does not rebuild them. */
  private cellEdgeSides(doc: EditorDocument): ReadonlyMap<number, readonly Direction[]> | null {
    const edges = doc.cellEdges;
    if (!edges || edges.length === 0) return null;
    const width = mapWidthOf(doc);
    let sidesByCell = cellEdgeSidesMemo.get(edges);
    if (!sidesByCell) {
      sidesByCell = new Map(edges.map((e) => [e.y * width + e.x, e.sides]));
      cellEdgeSidesMemo.set(edges, sidesByCell);
    }
    return sidesByCell;
  }

  /**
   * Draws some cells of a CC3D document again into one chunk (`origin` is the chunk's first cell). Each is
   * clipped to its own square and redrawn with its eight neighbours under that clip, so the glow a
   * neighbour spills into it is drawn once, not stacked on the old one. The player start is not part of
   * the layer.
   */
  private redrawCc3dCells(ctx: CanvasRenderingContext2D, doc: EditorDocument, indices: readonly number[], s: number, origin: { x: number; y: number }): void {
    const width = mapWidthOf(doc);
    const height = mapHeightOf(doc);
    this.renderer.setHiddenLayerMarkers(true);
    try {
      ctx.save();
      ctx.translate(-origin.x * s, -origin.y * s);
      for (const index of indices) {
        const x = index % width;
        const y = Math.floor(index / width);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x * s, y * s, s, s);
        ctx.clip();
        ctx.clearRect(x * s, y * s, s, s);
        this.drawMapRegion(ctx, doc, s, Math.max(0, x - 1), Math.max(0, y - 1), Math.min(width, x + 2), Math.min(height, y + 2));
        ctx.restore();
      }
      ctx.restore();
    } finally {
      this.renderer.setHiddenLayerMarkers(false);
    }
  }

  /** Draws the cells of a rectangle of cells (end excluded), then the creatures standing in it. */
  private drawMapRegion(ctx: CanvasRenderingContext2D, doc: EditorDocument, s: number, x0: number, y0: number, x1: number, y1: number): void {
    const edgeSides = doc.cc3d ? null : this.cellEdgeSides(doc);
    const hiddenCells = doc.cc3d ? null : this.hiddenTerrainCells(doc);
    const width = mapWidthOf(doc);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) this.drawCellLayers(ctx, doc, x, y, s, edgeSides, hiddenCells, width);
    }
    for (const ent of doc.entities) {
      if (ent.x >= x0 && ent.x < x1 && ent.y >= y0 && ent.y < y1) this.renderer.drawEntity(ctx, ent.type, ent.dir, ent.x * s, ent.y * s, s);
    }
  }

  /** Draws the cells, items, creatures and the player start of a document at tile size `s`. */
  private drawMapLayers(ctx: CanvasRenderingContext2D, doc: EditorDocument, s: number): void {
    // The hidden-layer marker (stacked CC3D layers, terrain hidden under an Epoxy top) belongs to this canvas only: the renderer is shared with play.
    const markers = Boolean(doc.cc3d) || hasUnderlays(doc);
    if (markers) this.renderer.setHiddenLayerMarkers(true);
    try {
      this.drawMapRegion(ctx, doc, s, 0, 0, mapWidthOf(doc), mapHeightOf(doc));
    } finally {
      if (markers) this.renderer.setHiddenLayerMarkers(false);
    }
    // A CC3D map is kept as a picture without the player start, which is drawn over it on every redraw.
    if (!doc.cc3d) this.drawPlayerStart(ctx, doc, s);
  }

  private drawPlayerStart(ctx: CanvasRenderingContext2D, doc: EditorDocument, s: number): void {
    this.renderer.drawPlayer(ctx, doc.playerStart.x * s, doc.playerStart.y * s, s, doc.playerStart.dir, false, true);
  }

  /** Draws one chunk of the CC3D map from scratch (a margin of one cell around it lets neighbours' glow in). */
  private buildChunk(doc: EditorDocument, s: number, chunk: StaticChunk): boolean {
    const ctx = chunk.canvas.getContext('2d');
    if (!ctx) return false;
    const width = mapWidthOf(doc);
    const height = mapHeightOf(doc);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, chunk.canvas.width, chunk.canvas.height);
    ctx.save();
    ctx.translate(-chunk.x0 * s, -chunk.y0 * s);
    this.renderer.setHiddenLayerMarkers(true);
    try {
      this.drawMapRegion(
        ctx,
        doc,
        s,
        Math.max(0, chunk.x0 - 1),
        Math.max(0, chunk.y0 - 1),
        Math.min(width, chunk.x0 + chunk.cols + 1),
        Math.min(height, chunk.y0 + chunk.rows + 1)
      );
    } finally {
      this.renderer.setHiddenLayerMarkers(false);
      ctx.restore();
    }
    return true;
  }

  /**
   * The map of a CC3D document as off-screen chunks, each at most EDITOR_STATIC_LAYER_MAX_PIXELS big, so
   * even the largest level is drawn whole only once. They are rebuilt when the level size, the tile size or
   * the look changed, and otherwise patched: an edit redraws just the cells it changed, in the chunk that
   * holds each. Null (draw directly) only when a chunk cannot be created.
   */
  private cc3dStaticLayer(doc: EditorDocument, s: number): StaticLayer | null {
    const level = doc.cc3d;
    if (!level) return null;
    // A change of style, theme, player skin or quality changes how every cell looks: the picture is stale.
    const look = this.renderer.getAppearanceKey();
    const cached = this.staticLayer;
    const { width: backingWidth, height: backingHeight } = this.canvas;
    if (
      cached &&
      cached.tile === s &&
      cached.look === look &&
      cached.width === level.width &&
      cached.height === level.height &&
      cached.backingWidth === backingWidth &&
      cached.backingHeight === backingHeight
    ) {
      if (cached.level === level) return cached;
      // A stroke touches a few cells: only those are drawn again, not the thousands that did not change.
      const dirty = dirtyCc3dCells(cached.level, level);
      if (dirty && dirty.length <= level.cells.length * EDITOR_STATIC_LAYER_REDRAW_SHARE) {
        const byChunk = new Map<StaticChunk, number[]>();
        for (const index of dirty) {
          const x = index % level.width;
          const y = Math.floor(index / level.width);
          const chunk = cached.chunks[Math.floor(y / cached.side) * cached.perRow + Math.floor(x / cached.side)];
          byChunk.set(chunk, [...(byChunk.get(chunk) ?? []), index]);
        }
        let patched = true;
        for (const [chunk, indices] of byChunk) {
          const ctx = chunk.canvas.getContext('2d');
          if (!ctx) {
            patched = false;
            break;
          }
          ctx.imageSmoothingEnabled = false;
          this.redrawCc3dCells(ctx, doc, indices, s, { x: chunk.x0, y: chunk.y0 });
        }
        if (patched) {
          cached.level = level;
          return cached;
        }
      }
    }
    // Chunks of side x side cells whose canvas stays within the pixel cap.
    const side = Math.max(1, Math.floor(Math.sqrt(EDITOR_STATIC_LAYER_MAX_PIXELS) / s));
    const perRow = Math.ceil(level.width / side);
    const chunks: StaticChunk[] = [];
    for (let y0 = 0; y0 < level.height; y0 += side) {
      for (let x0 = 0; x0 < level.width; x0 += side) {
        const cols = Math.min(side, level.width - x0);
        const rows = Math.min(side, level.height - y0);
        const canvas = document.createElement('canvas');
        canvas.width = cols * s;
        canvas.height = rows * s;
        const chunk: StaticChunk = { canvas, x0, y0, cols, rows };
        if (!this.buildChunk(doc, s, chunk)) return null;
        chunks.push(chunk);
      }
    }
    this.staticLayer = { level, tile: s, look, width: level.width, height: level.height, backingWidth, backingHeight, side, perRow, chunks };
    return this.staticLayer;
  }

  public render(): void {
    this.updateFillSelectionButton();
    if (this.frameRequest !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }
    const doc = this.doc;
    // The canvas must be exactly the map at the tile size: after a new level or a late layout it may not be yet.
    if (!this.refitting && (this.canvas.width !== this.mapWidth() * this.tilePx || this.canvas.height !== this.mapHeight() * this.tilePx)) {
      this.refitting = true;
      try {
        this.applyFit();
      } finally {
        this.refitting = false;
      }
      return;
    }
    this.updateTestFromState();
    this.refreshConnections();
    // A change under a still pointer rewrites the description; coordinates the keyboard cursor wrote stay.
    if (this.hoverCell && this.hoverTextKey !== '') this.refreshHoverText();
    const s = this.tilePx;
    this.lastDrawnTilePx = s;
    // Resizing the canvas resets the context: keep the pixel art sharp at any tile size.
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // A CC3D level can be huge (100 x 114 cells): its map is drawn once into a layer that a pointer move
    // only copies, then the overlays go on top.
    const layer = doc.cc3d ? this.cc3dStaticLayer(doc, s) : null;
    if (layer) for (const chunk of layer.chunks) this.ctx.drawImage(chunk.canvas, chunk.x0 * s, chunk.y0 * s);
    else this.drawMapLayers(this.ctx, doc, s);
    if (doc.cc3d) this.drawPlayerStart(this.ctx, doc, s);
    this.drawBeamPreview(s);

    this.ctx.lineWidth = EDITOR_LINK_LINE_WIDTH;
    for (const link of doc.trapLinks) {
      this.drawLinkLine(EDITOR_TRAP_LINK_COLOR, link.buttonX, link.buttonY, link.trapX, link.trapY, s);
    }
    for (const link of doc.cloneLinks) {
      this.drawLinkLine(EDITOR_CLONE_LINK_COLOR, link.buttonX, link.buttonY, link.clonerX, link.clonerY, s);
    }
    for (const link of doc.cloneLinks) this.drawClonerTemplateBadge(link, s);
    for (const link of doc.launcherLinks ?? []) {
      this.drawLinkLine(EDITOR_LAUNCHER_LINK_COLOR, link.buttonX, link.buttonY, link.launcherX, link.launcherY, s);
    }

    this.drawIssueMarkers(s);
    this.renderDeviceOverlay(s);
    this.renderCc3dOverlay(s);
    this.renderSideHint(s);
    this.renderSelectionOverlay(s);
    if (this.linkSession) this.outlineCell(this.linkSession.x, this.linkSession.y, EDITOR_WIRE_SOURCE_COLOR, s);
    if (this.hoverCell) this.outlineCell(this.hoverCell.x, this.hoverCell.y, EDITOR_HOVER_OUTLINE_COLOR, s);
    if (this.cursorCell && document.activeElement === this.canvas) {
      this.outlineCell(this.cursorCell.x, this.cursorCell.y, EDITOR_CURSOR_OUTLINE_COLOR, s);
    }
  }

  /** The links derived from the level, once per version of it. */
  private cc3dLinksOf(level: Cc3dLevel): Cc3dLinks {
    let links = this.linksCache.get(level);
    if (!links) {
      links = cc3dLinks(level);
      this.linksCache.set(level, links);
    }
    return links;
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

  /** The template of an Epoxy clone link, drawn with its facing in the top right corner of its clone machine. */
  private drawClonerTemplateBadge(link: CloneLink, s: number): void {
    const size = EDITOR_CLONER_BADGE_TILE * s;
    const x = (link.clonerX + 1) * s - size;
    const y = link.clonerY * s;
    this.ctx.fillStyle = EDITOR_CLONER_BADGE_BACKING;
    this.ctx.fillRect(x, y, size, size);
    this.renderer.drawEntity(this.ctx, link.templateType, link.templateDir, x, y, size);
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
    this.ctx.restore();
  }

  /** While a thin wall tool is active, the bar on the side a click would toggle: the hovered cell's, or the keyboard cursor's after a keyboard input. */
  private renderSideHint(s: number): void {
    if (!this.sideToolActive()) return;
    this.ctx.save();
    this.ctx.globalAlpha = EDITOR_CC3D_OVERLAY_ALPHA;
    const byKeyboard = this.lastInput === 'keyboard' && this.cursorCell !== null;
    if (this.hoverCell && !byKeyboard) this.drawSideHint(this.hoverCell, this.hoverSide, s);
    else if (this.cursorCell) this.drawSideHint(this.cursorCell, this.activeDir, s);
    this.ctx.restore();
  }

  private outlineCell(x: number, y: number, color: string, s: number, width: number = EDITOR_OVERLAY_LINE_WIDTH): void {
    const inset = width / 2;
    this.ctx.lineWidth = width;
    this.ctx.strokeStyle = color;
    this.ctx.strokeRect(x * s + inset, y * s + inset, s - width, s - width);
  }

  /**
   * The connections of an Epoxy level for the hovered cell and the keyboard cursor cell: arrows to what a device
   * works (and from what works it), outlines for its colour or teleport group, and a thicker outline on the cell of
   * the connections row under the pointer or the focus. Skipped during a stroke: the relations are not asked for
   * a document that changes at every cell. During a link session it draws the session instead: the partners the
   * device can link to are outlined and the links it holds are arrows, button to target.
   */
  private renderDeviceOverlay(s: number): void {
    if (this.doc.cc3d || this.stroke) return;
    const session = this.linkSession;
    const partners = this.sessionPartners();
    const cells = session ? [] : [this.cursorCell, this.hoverCell].filter((cell): cell is { x: number; y: number } => cell !== null);
    const rowCell = this.connectionsRowCell;
    if (cells.length === 0 && !rowCell && !partners) return;
    this.ctx.save();
    this.ctx.globalAlpha = EDITOR_CC3D_OVERLAY_ALPHA;
    this.ctx.lineWidth = EDITOR_LINK_LINE_WIDTH;
    if (session && partners) {
      const color = EDITOR_RELATION_COLORS[session.system];
      for (const candidate of partners.candidates) this.outlineCell(candidate.x, candidate.y, color, s);
      for (const linked of partners.linked) {
        if (session.end === 'button') this.drawArrow(color, session, linked, s);
        else this.drawArrow(color, linked, session, s);
      }
    }
    const drawn = new Set<string>();
    for (const cell of cells) {
      const key = `${cell.x},${cell.y}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const overlay = deviceOverlayFor(deviceRelations(this.doc, cell.x, cell.y), cell);
      for (const target of overlay.highlights) this.outlineCell(target.x, target.y, EDITOR_RELATION_COLORS[target.system], s);
      for (const arrow of overlay.arrows) this.drawArrow(EDITOR_RELATION_COLORS[arrow.system], arrow.from, arrow.to, s);
    }
    if (rowCell) this.outlineCell(rowCell.x, rowCell.y, EDITOR_HOVER_OUTLINE_COLOR, s, EDITOR_CONNECTIONS_ROW_OUTLINE_WIDTH);
    this.ctx.restore();
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
   * Downloads the CC3D level as the XML file the community editor writes. The title is the form's own, never
   * the translated fallback; the hint, the password and the time limit have no place in that file, and the
   * status says so.
   */
  private exportCc3dXml(): void {
    const cc3d = this.doc.cc3d;
    if (!cc3d) return;
    try {
      const xml = encodeCc3dLevel(cc3d, { name: this.doc.title, author: this.doc.author });
      downloadText(xml, `${cc3d.mapId || this.exportCompiledLevel().id || EXPORT_FALLBACK_FILE_NAME}${CC3D_XML_EXTENSION}`, MIME_XML);
    } catch (err) {
      console.error('CC3D XML export failed:', err);
      this.setStatusText(t('editor.cc3d.status.export_xml_failed'));
      return;
    }
    this.setStatusText(t('editor.cc3d.status.export_xml_notice'));
  }

  /**
   * The level as the editor holds it. A level opened from a pack keeps its id;
   * any other content carries the id it was given when it was opened.
   */
  public exportCompiledLevel(): CompiledLevel {
    return this.compileDocument(this.doc);
  }

  /** A document compiled the way the editor exports its own: the draft uses it for the pre-stroke document too. */
  private compileDocument(doc: EditorDocument): CompiledLevel {
    const id = this.source.levelId ?? this.currentLevelId;
    const targetLevels = this.sourcePack()?.levels ?? [];
    const existing = targetLevels.find((l) => l.id === id);
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
    // A Test is already waiting for its check: leave its status line alone.
    if (this.testCheckPending) return;
    const { cell, block } = this.testFromHereTarget();
    if (block !== null || cell === null) {
      this.setStatusText(t(TEST_FROM_HERE_REASON_KEYS[block ?? 'no_cell']));
      return;
    }
    this.setStatusText(t('editor.test_from.status', { x: cell.x, y: cell.y }));
    await this.testPlay(cell);
  }

  private async testPlay(startCell?: GridCell): Promise<void> {
    if (this.testCheckPending) return;
    const exported = this.exportCompiledLevel();
    const compiled = startCell ? levelStartingAt(exported, startCell) : exported;
    const key = this.currentCheckKey();
    const generation = this.loadGeneration;
    const epoch = this.checkAbortEpoch;
    // A moved-start copy is another level than the one the cache holds: it is always validated (deep).
    // Any cached report of this content (default or deep) answers a normal Test; only a cold Test checks.
    let report: LevelValidationReport | null =
      !startCell && this.reportCache?.key === key
        ? this.reportCache.report
        : this.isCc3d()
          ? LevelValidator.validate(compiled, storedSolutionWins, DEEP_CHECK_OPTIONS)
          : null;
    let skipReason: TestCheckSkip | null = null;
    if (report === null) {
      const waited = await this.checkBeforeTest(compiled, key, !startCell);
      if (generation !== this.loadGeneration || epoch !== this.checkAbortEpoch) return;
      report = waited.report;
      skipReason = waited.reason;
    }
    let issuesText = '';
    if (report && !report.valid && report.issues.length > 0) {
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
    } else if (skipReason) {
      this.hooks.onNotify(t(TEST_CHECK_SKIP_KEYS[skipReason]));
    }
  }

  /**
   * Validates the level to test off the UI thread, for at most the test timeout. The report, or no report and
   * the reason: too slow, abandoned because the level changed during the wait (the version from before the edit
   * is then tested), or failed. `key` is the content key; `cacheable` tells whether the report may be cached
   * under it and an already running check joined (false for a moved-start copy, another level than the content).
   */
  private async checkBeforeTest(
    compiled: CompiledLevel,
    key: string,
    cacheable: boolean
  ): Promise<{ report: LevelValidationReport | null; reason: TestCheckSkip | null }> {
    const epoch = this.checkAbortEpoch;
    // The Test check replaces the pending scheduled one; a check that is still due is scheduled again below.
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.testCheckPending = true;
    const token = this.beginRunningStatus();
    let result: LevelCheckResult;
    let joinedDeep = true;
    try {
      result = await new Promise<LevelCheckResult>((resolve) => {
        // The check of this very content may be running already (automatic, or the Check button): wait for it
        // for at most the test timeout from now, whatever its depth. A moved-start copy is another level: it is checked on its own.
        const runningDeep = this.runningCheckDeep;
        if (cacheable && this.joinRunningCheck(key, EDITOR_TEST_CHECK_TIMEOUT_MS, resolve, false)) {
          joinedDeep = runningDeep;
          return;
        }
        // The running key is the content either way, so a save (same content) never cancels it.
        // Test from here (not cacheable) cancels the automatic check: its moved-start copy is a different level; the automatic check is rescheduled after the wait.
        if (cacheable) this.showChecking();
        this.runningCheckKey = key;
        this.runningCheckCacheable = cacheable;
        this.runningCheckDeep = true;
        this.levelCheckRunner().run(compiled, EDITOR_TEST_CHECK_TIMEOUT_MS, resolve, DEEP_CHECK_OPTIONS);
      });
    } finally {
      this.testCheckPending = false;
    }
    this.endRunningStatus(token, true);
    if (cacheable && result.kind === 'report' && key === this.currentCheckKey()) {
      this.applyReport(key, result.report, joinedDeep);
    } else if (cacheable && result.kind !== 'report' && result.kind !== 'cancelled' && key === this.currentCheckKey()) {
      // No report came (too slow, failed): the cached verdict of this content goes back on the badge, else the badge says so.
      if (!this.restoreCachedVerdict(key)) this.showAbandoned(result.kind === 'error' ? 'error' : 'skipped');
    }
    // After the view was left, the next visit checks (onEnter). A check this wait only joined goes on by itself.
    const stillRunning = (this.levelRunner?.isRunning() ?? false) && this.runningCheckKey === this.currentCheckKey();
    if (!this.disposed && epoch === this.checkAbortEpoch && !stillRunning && this.reportCache?.key !== this.currentCheckKey()) {
      this.scheduleCheck();
    }
    return result.kind === 'report' ? { report: result.report, reason: null } : { report: null, reason: result.kind };
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
    // An edit made while the save was in flight, or a write the browser refused, keeps the draft: it
    // is rewritten against the level that was just saved.
    if (rebind && this.isDirty) this.syncDraft();
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
   * pack instead; a cc3d .xml file holds one level and opens directly. The
   * level that opens is unsaved work and belongs to no pack.
   */
  private async importFileIntoEditor(file: File): Promise<void> {
    const maxBytes = ConfigRegistry.getGame().import.maxFileBytes;
    if (!isImportSizeAllowed(file.size, maxBytes)) {
      this.setStatusText(t('editor.palette.status.import_too_large.label', { max: formatMegabytes(maxBytes) }));
      return;
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith(CC3D_XML_EXTENSION)) {
      await this.importCc3dFileIntoEditor(file);
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

  /** Opens one cc3d .xml level; a file that does not decode is reported and the document stays as it was. */
  private async importCc3dFileIntoEditor(file: File): Promise<void> {
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      this.setStatusText(t('editor.palette.status.import_error'));
      return;
    }
    // A file named only by its extension has no stem: the map id and the pack name fall back.
    const stem = packNameFromFile(file.name) || EXPORT_FALLBACK_FILE_NAME;
    const decoded = decodeCc3dFiles([{ name: `${stem}${CC3D_XML_EXTENSION}`, bytes }], stem);
    const failure = decoded.failures[0];
    if (failure) {
      this.setStatusText(t(failure.error.key, { ...failure.error.params }));
      return;
    }
    if (!(await this.confirmDiscardIfDirty())) return;
    if (!this.loadCompiledLevel(decoded.levels[0], { source: NO_SOURCE, dirty: true })) return;
    this.setStatusText(t('editor.palette.status.imported'));
  }

  private setCoordsText(msg: string): void {
    this.hoverTextKey = '';
    const el = document.getElementById('editor-coords-badge');
    if (!el) return;
    el.textContent = msg;
    // The empty marker needs no tooltip.
    if (msg === NO_COORDS_TEXT) el.removeAttribute('title');
    else el.title = msg;
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
    // A status line always wins over a cell description still waiting to be spoken.
    this.cancelCellSpeech();
    this.statusWrites++;
    el.textContent = msg;
    // One line with an ellipsis: a long message must not resize the stage and refit the canvas.
    el.title = msg;
  }
}
