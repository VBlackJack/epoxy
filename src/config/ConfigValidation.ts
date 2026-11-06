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

import {
  CELL_EDGE_BITS,
  CELL_EDGE_SIDE_ORDER,
  CHASE_PLAYER_PATTERN,
  FIRE_LAUNCHERS_ACTION,
  FLEE_PLAYER_PATTERN,
  MIRROR_FRONT_AXIS,
  SIGNAL_LINKS_PER_CELL_MAX,
  STATIONARY_PATTERN,
  STEER_MONSTERS_ACTION,
  SUNK_BLOCK_TILE_ID
} from '../core/coreConstants';
import { isRemovableTop } from '../core/Underlays';
import { normalizeSignalLinks } from '../core/signalLinks';
import { ORDERED_DIRECTIONS } from './constants';
import { CHANNEL_BUTTON_ACTIONS, CHANNEL_COLORS } from '../core/coreConstants';
import { isMusicMode, MUSIC_MODES } from '../audio/musicSelection';
import {
  AudioConfig,
  BlockBudget,
  CampaignConfig,
  CellEdge,
  CellUnderlay,
  CompiledLevel,
  DatFormatConfig,
  Direction,
  EntityDefinition,
  GameConfig,
  GridConfig,
  LauncherLink,
  LevelTextConfig,
  PlaytestConfig,
  Ruleset,
  SignalLink,
  ThemePalette,
  TileDefinition,
  WinRule
} from '../core/types';

/**
 * Problems in the campaign chapter list: every chapter needs a unique id, title
 * and subtitle keys, and at least one level; a level may sit in one chapter
 * only, and must exist among the campaign levels.
 */
export function findCampaignConfigErrors(campaign: CampaignConfig, levelIds: readonly string[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(campaign.chapters)) return ['chapters: expected a list'];
  const known = new Set(levelIds);
  const chapterIds = new Set<string>();
  const placedIn = new Map<string, string>();
  campaign.chapters.forEach((chapter, index) => {
    const label = `chapters[${index}]`;
    if (typeof chapter.id !== 'string' || chapter.id === '') errors.push(`${label}: id must be a non-empty string`);
    else if (chapterIds.has(chapter.id)) errors.push(`${label}: duplicate id ${chapter.id}`);
    else chapterIds.add(chapter.id);
    for (const field of ['titleKey', 'subtitleKey'] as const) {
      if (typeof chapter[field] !== 'string' || chapter[field] === '') errors.push(`${label}: ${field} must be a non-empty string`);
    }
    if (!Array.isArray(chapter.levels) || chapter.levels.length === 0) {
      errors.push(`${label}: levels must be a non-empty list`);
      return;
    }
    for (const id of chapter.levels) {
      if (!known.has(id)) errors.push(`${label}: unknown level ${String(id)}`);
      const first = placedIn.get(id);
      if (first !== undefined) errors.push(`${label}: level ${id} is already in ${first}`);
      else placedIn.set(id, String(chapter.id));
    }
  });
  return errors;
}

/**
 * Problems in the pilot pack: every level id carries the pilot prefix, is
 * unique, and is not a campaign level id; the chapters follow the campaign
 * chapter rules over the pilot level ids.
 */
export function findPilotConfigErrors(
  levels: ReadonlyArray<{ id: string }>,
  chapters: CampaignConfig,
  campaignLevelIds: readonly string[],
  idPrefix: string
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(levels)) return ['levels: expected a list'];
  const campaignIds = new Set(campaignLevelIds);
  const seen = new Set<string>();
  levels.forEach((level, index) => {
    const label = `levels[${index}]`;
    if (typeof level.id !== 'string' || !level.id.startsWith(idPrefix)) errors.push(`${label}: id must start with ${idPrefix}`);
    else if (campaignIds.has(level.id)) errors.push(`${label}: id ${level.id} is a campaign level`);
    if (seen.has(level.id)) errors.push(`${label}: duplicate id ${level.id}`);
    seen.add(level.id);
  });
  errors.push(...findCampaignConfigErrors(chapters, levels.map((level) => level.id)));
  return errors;
}

/**
 * Raised when a fetched configuration file is missing or does not match the
 * shape the engine relies on. The message carries the file name only, the UI
 * maps it to a localized error screen.
 */
export class ConfigLoadError extends Error {
  constructor(public readonly source: string, detail: string) {
    super(`${source}: ${detail}`);
    this.name = 'ConfigLoadError';
  }
}

/**
 * Raised when a level blueprint (built-in, imported or stored) cannot be
 * compiled into a playable level.
 */
export class InvalidLevelError extends Error {
  constructor(public readonly levelId: string, detail: string) {
    super(`${levelId}: ${detail}`);
    this.name = 'InvalidLevelError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (ORDERED_DIRECTIONS as readonly string[]).includes(value);
}

export function isInBounds(x: unknown, y: unknown, width: number, height: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    (x as number) >= 0 &&
    (y as number) >= 0 &&
    (x as number) < width &&
    (y as number) < height
  );
}

/**
 * Checks that every listed top-level key exists on a parsed config object.
 * Only presence is checked: the goal is a clear failure at load time instead
 * of an undefined access deep inside the game loop.
 */
export function assertConfigShape(
  source: string,
  value: unknown,
  requiredKeys: readonly string[]
): void {
  if (!isRecord(value)) {
    throw new ConfigLoadError(source, 'not an object');
  }
  const missing = requiredKeys.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new ConfigLoadError(source, `missing keys ${missing.join(', ')}`);
  }
}

/** Whether `value` is a whole number of at least `min`. */
function isIntegerAtLeast(value: unknown, min: number): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}

/** Whether `value` is a finite number in [0, 1]. */
function isUnitShare(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

/** Smallest value of the endless dialog's start level bound: level 1 must stay reachable. */
const MIN_START_LEVEL_BOUND = 1;
const MIN_FALLBACK_CANDIDATES = 0;
/** Zero turns the endless piece cooldown off. */
const MIN_COOLDOWN_ATTEMPTS = 0;
const MIN_POSITIVE_STEP = 1;

/** Keys of the level text limits, each one a whole number of at least one. */
const LEVEL_TEXT_LIMIT_KEYS: ReadonlyArray<keyof LevelTextConfig> = [
  'titleMaxLength',
  'hintMaxLength',
  'authorMaxLength',
  'passwordMaxLength',
  'solutionMaxLength',
  'themeMaxLength',
  'keyMaxLength',
  'idMaxLength'
];

const PLAYTEST_COUNT_KEYS: ReadonlyArray<keyof PlaytestConfig> = [
  'maxSessions',
  'maxTraceLength',
  'maxDeathsPerSession',
  'maxStoredBytes',
  'noteMaxLength',
  'ratingMin'
];

/**
 * Checks the endless and procedural tunables that code relies on as whole
 * numbers or unit shares. Empty when all is well; each entry names the offending key.
 */
export function findGameTunableErrors(game: GameConfig): string[] {
  const errors: string[] = [];
  if (!isIntegerAtLeast(game.endlessUi?.maxStartLevel, MIN_START_LEVEL_BOUND)) {
    errors.push(`endlessUi.maxStartLevel: expected a whole number of at least ${MIN_START_LEVEL_BOUND}`);
  }
  if (typeof game.storage?.onboardingSeenKey !== 'string' || game.storage.onboardingSeenKey.length === 0) {
    errors.push('storage.onboardingSeenKey: expected a non-empty string');
  }
  if (typeof game.storage?.lastSaveDestinationKey !== 'string' || game.storage.lastSaveDestinationKey.length === 0) {
    errors.push('storage.lastSaveDestinationKey: expected a non-empty string');
  }
  if (typeof game.storage?.editorSectionsKey !== 'string' || game.storage.editorSectionsKey.length === 0) {
    errors.push('storage.editorSectionsKey: expected a non-empty string');
  }
  for (const key of ['authorMaxLength', 'descriptionMaxLength'] as const) {
    if (!isIntegerAtLeast(game.packMetadata?.[key], MIN_POSITIVE_STEP)) {
      errors.push(`packMetadata.${key}: expected a whole number of at least ${MIN_POSITIVE_STEP}`);
    }
  }
  for (const key of ['playtestEnabledKey', 'playtestSessionsKey'] as const) {
    if (typeof game.storage?.[key] !== 'string' || game.storage[key].length === 0) {
      errors.push(`storage.${key}: expected a non-empty string`);
    }
  }
  for (const key of PLAYTEST_COUNT_KEYS) {
    if (!isIntegerAtLeast(game.playtest?.[key], MIN_POSITIVE_STEP)) {
      errors.push(`playtest.${key}: expected a whole number of at least ${MIN_POSITIVE_STEP}`);
    }
  }
  if (
    isIntegerAtLeast(game.playtest?.ratingMin, MIN_POSITIVE_STEP) &&
    (!isIntegerAtLeast(game.playtest?.ratingMax, MIN_POSITIVE_STEP) || game.playtest.ratingMax <= game.playtest.ratingMin)
  ) {
    errors.push('playtest.ratingMax: expected a whole number above ratingMin');
  }
  for (const key of LEVEL_TEXT_LIMIT_KEYS) {
    if (!isIntegerAtLeast(game.levelText?.[key], MIN_POSITIVE_STEP)) {
      errors.push(`levelText.${key}: expected a whole number of at least ${MIN_POSITIVE_STEP}`);
    }
  }
  for (const key of ['maxLinkChars', 'maxDecodedBytes'] as const) {
    if (!isIntegerAtLeast(game.share?.[key], MIN_POSITIVE_STEP)) {
      errors.push(`share.${key}: expected a whole number of at least ${MIN_POSITIVE_STEP}`);
    }
  }
  if (game.procedural) {
    const proc = game.procedural;
    if (!isIntegerAtLeast(proc.scoring?.fallbackCandidates, MIN_FALLBACK_CANDIDATES)) {
      errors.push(`procedural.scoring.fallbackCandidates: expected a whole number of at least ${MIN_FALLBACK_CANDIDATES}`);
    }
    if (!isIntegerAtLeast(proc.endless?.cooldownAttemptsPerTier, MIN_COOLDOWN_ATTEMPTS)) {
      errors.push(`procedural.endless.cooldownAttemptsPerTier: expected a whole number of at least ${MIN_COOLDOWN_ATTEMPTS}`);
    }
    const positiveSteps: Array<[string, unknown]> = [
      ['procedural.levelsPerExtraPiece', proc.levelsPerExtraPiece],
      ['procedural.endless.levelsPerExtraPiece', proc.endless?.levelsPerExtraPiece],
      ['procedural.endless.levelsPerExtraMotif', proc.endless?.levelsPerExtraMotif],
      ['procedural.endless.levelsPerExtraTier', proc.endless?.levelsPerExtraTier],
      ['procedural.endless.attemptsPerDroppedPiece', proc.endless?.attemptsPerDroppedPiece],
      ['procedural.hub.attemptsPerDroppedPiece', proc.hub?.attemptsPerDroppedPiece]
    ];
    for (const [name, value] of positiveSteps) {
      if (!isIntegerAtLeast(value, MIN_POSITIVE_STEP)) {
        errors.push(`${name}: expected a whole number of at least ${MIN_POSITIVE_STEP}`);
      }
    }
    const unitShares: Array<[string, unknown]> = [
      ['procedural.hub.outlineGrowth.freeAreaShare', proc.hub?.outlineGrowth?.freeAreaShare],
      ['procedural.hub.openChips.nearLaneShare', proc.hub?.openChips?.nearLaneShare]
    ];
    if (isRecord(proc.endless?.motifShares)) {
      for (const [motif, share] of Object.entries(proc.endless.motifShares)) {
        unitShares.push([`procedural.endless.motifShares.${motif}`, share]);
      }
    } else {
      errors.push('procedural.endless.motifShares: expected an object');
    }
    for (const [name, value] of unitShares) {
      if (!isUnitShare(value)) {
        errors.push(`${name}: expected a number in [0, 1]`);
      }
    }
  }
  return errors;
}

/**
 * Checks that a pack layer is large enough for its declared dimensions (the
 * game grid when none are set). Empty when all is well.
 */
export function findDatFormatErrors(datFormat: DatFormatConfig, grid: { mapWidth: number; mapHeight: number }): string[] {
  const width = datFormat.layerWidth ?? grid.mapWidth;
  const height = datFormat.layerHeight ?? grid.mapHeight;
  if (width * height > datFormat.layerByteLength) {
    return [`layerWidth * layerHeight (${width} * ${height}): expected at most layerByteLength (${datFormat.layerByteLength})`];
  }
  return [];
}

/** Smallest and largest width or height a level may have. */
export interface LevelSizeBounds {
  minSize: number;
  maxSize: number;
}

/** Width and height of a level, in cells. */
export interface GridSize {
  width: number;
  height: number;
}

/** Reads the level size bounds from the grid configuration. */
export function levelSizeBoundsOf(
  grid: Pick<GridConfig, 'minLevelSize' | 'maxLevelSize'>
): LevelSizeBounds {
  return { minSize: grid.minLevelSize, maxSize: grid.maxLevelSize };
}

export function isSizeWithinBounds(size: GridSize, bounds: LevelSizeBounds): boolean {
  return (
    Number.isInteger(size.width) &&
    Number.isInteger(size.height) &&
    size.width >= bounds.minSize &&
    size.width <= bounds.maxSize &&
    size.height >= bounds.minSize &&
    size.height <= bounds.maxSize
  );
}

function isGrid(value: unknown, width: number, height: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === height &&
    value.every((row) => Array.isArray(row) && row.length === width)
  );
}

/**
 * Measures a rectangular grid: every row is an array of the same length and
 * both dimensions lie within the bounds. Returns null for anything else.
 */
export function measureGrid(value: unknown, bounds: LevelSizeBounds): GridSize | null {
  if (!Array.isArray(value) || value.length === 0 || !Array.isArray(value[0])) return null;
  const size = { width: value[0].length, height: value.length };
  if (!isSizeWithinBounds(size, bounds)) return null;
  return isGrid(value, size.width, size.height) ? size : null;
}

/** Cheap structural check of the cc3d field of a level: sizes, cell shapes, mobs and player inside the grid. */
export function isCc3dLevelShape(value: unknown, bounds: LevelSizeBounds, strict = false): boolean {
  if (!isRecord(value)) return false;
  const { width, height, cells, mobs, player } = value;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (!isSizeWithinBounds({ width: width as number, height: height as number }, bounds)) return false;
  if (!Array.isArray(cells) || cells.length !== (width as number) * (height as number)) return false;
  const cellsOk = cells.every(
    (cell) =>
      isRecord(cell) &&
      Array.isArray(cell.terrain) &&
      cell.terrain.length > 0 &&
      Array.isArray(cell.panels) &&
      (!strict || cell.panels.length <= ORDERED_DIRECTIONS.length) &&
      (cell.item === null || isRecord(cell.item))
  );
  const w = width as number;
  const h = height as number;
  return (
    cellsOk &&
    Array.isArray(mobs) &&
    (!strict || mobs.length <= cells.length) &&
    mobs.every((mob) => isRecord(mob) && isInBounds(mob.x, mob.y, w, h)) &&
    isRecord(player) &&
    isInBounds(player.x, player.y, w, h) &&
    (player.dir === undefined || isDirection(player.dir))
  );
}

/**
 * Problems of the cc3d tile definitions: an entry whose id differs from its key, one without a
 * name key, one that shadows a tile of tiles.json (the Lynx engine reads that file alone).
 */
export function findCc3dTileErrors(
  cc3dTiles: { tiles?: Record<string, TileDefinition> } | undefined,
  baseTiles: Record<string, TileDefinition>
): string[] {
  const tiles = cc3dTiles?.tiles;
  if (!isRecord(tiles)) return ['tiles: expected an object'];
  const errors: string[] = [];
  for (const [key, def] of Object.entries(tiles)) {
    if (!isRecord(def) || def.id !== key) errors.push(`${key}.id: expected the key of the entry`);
    else if (typeof def.i18nKey !== 'string' || def.i18nKey.length === 0) errors.push(`${key}.i18nKey: expected a key`);
    if (key in baseTiles) errors.push(`${key}: already defined in tiles.json`);
  }
  errors.push(...findLaserConfigErrors(tiles));
  return errors;
}

/** A list of records no longer than the map has cells, each one accepted by `accept`. */
function isRecordList(
  value: unknown,
  size: GridSize,
  strict: boolean,
  accept: (entry: Record<string, unknown>) => boolean = () => true
): boolean {
  if (!Array.isArray(value)) return false;
  if (!strict) return true;
  return value.length <= size.width * size.height && value.every((entry) => isRecord(entry) && accept(entry));
}

/**
 * Structural check for a level read back from localStorage, IndexedDB or a
 * JSON import, where the data may be stale or hand-edited. The level sets
 * its own size: the terrain must be a rectangular grid within the bounds,
 * the items grid must match it and the player start must lie inside it.
 */
export function isCompiledLevelShape(value: unknown, bounds: LevelSizeBounds, strict = false): value is CompiledLevel {
  if (!isRecord(value)) return false;
  const size = measureGrid(value.terrain, bounds);
  if (!size) return false;
  const start = value.playerStart;
  return (
    typeof value.id === 'string' &&
    isFiniteNumber(value.number) &&
    isFiniteNumber(value.timeLimitSeconds) &&
    isFiniteNumber(value.chipsRequired) &&
    isRecord(start) &&
    isInBounds(start.x, start.y, size.width, size.height) &&
    isGrid(value.items, size.width, size.height) &&
    isRecordList(value.entities, size, strict, (entity) => typeof entity.type === 'string') &&
    isRecordList(value.trapLinks, size, strict) &&
    isRecordList(value.cloneLinks, size, strict) &&
    // Cell edges hold one entry per cell at most; a longer list is not a level, whatever the entries hold.
    (!strict || !Array.isArray(value.cellEdges) || value.cellEdges.length <= size.width * size.height) &&
    // Underlays hold one entry per cell at most, by the same rule.
    (!strict || !Array.isArray(value.underlays) || value.underlays.length <= size.width * size.height) &&
    // Launcher links hold one entry per cell at most, by the same rule.
    (!strict || !Array.isArray(value.launcherLinks) || value.launcherLinks.length <= size.width * size.height) &&
    // Signal links hold a few entries per cell at most, by the same rule.
    (!strict || !Array.isArray(value.signalLinks) || value.signalLinks.length <= size.width * size.height * SIGNAL_LINKS_PER_CELL_MAX) &&
    // A cc3d level carries its data, and no other level does: the cc3d engine reads nothing else.
    (value.ruleset === 'cc3d' ? isCc3dLevelShape(value.cc3d, bounds, strict) : value.cc3d === undefined)
  );
}

/** Optional text fields of a level; each one is kept only when it is a string. */
const LEVEL_TEXT_FIELDS = ['titleKey', 'customTitle', 'hintKey', 'customHint', 'author'] as const;

/** Win rules a level may declare; anything else in a stored level is dropped. */
export const WIN_RULES: readonly WinRule[] = ['exit', 'targets', 'receivers'];

/** True for a value that names a known win rule. */
export function isWinRule(value: unknown): value is WinRule {
  return typeof value === 'string' && (WIN_RULES as readonly string[]).includes(value);
}

/** True for a block budget made of two non-negative integers; anything else in a stored level is dropped. */
export function isBlockBudget(value: unknown): value is BlockBudget {
  if (typeof value !== 'object' || value === null) return false;
  const { waters, targets } = value as Record<string, unknown>;
  return Number.isInteger(waters) && (waters as number) >= 0 && Number.isInteger(targets) && (targets as number) >= 0;
}

/** Rulesets a level may declare; anything else in a stored level is dropped. */
export const RULESETS: readonly Ruleset[] = ['epoxy', 'lynx', 'cc3d'];

/** True for a value that names a known ruleset. */
export function isRuleset(value: unknown): value is Ruleset {
  return typeof value === 'string' && (RULESETS as readonly string[]).includes(value);
}

/**
 * The cell edges of a level in canonical form: only the Epoxy ruleset carries them; entries that
 * are not records, lie outside the grid or hold no valid side are dropped, the sides of a cell
 * are merged into one entry, and the entries are sorted by row, then column, with the sides in
 * N, E, S, W order. Returns null when no edge is left.
 */
export function normalizeCellEdges(
  edges: unknown,
  terrain: readonly (readonly string[])[],
  ruleset: unknown
): CellEdge[] | null {
  if ((isRuleset(ruleset) ? ruleset : 'epoxy') !== 'epoxy' || !Array.isArray(edges)) return null;
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;
  const bitsByCell = new Map<number, number>();
  for (const entry of edges as unknown[]) {
    if (!isRecord(entry) || !isInBounds(entry.x, entry.y, width, height) || !Array.isArray(entry.sides)) continue;
    let bits = 0;
    for (const side of entry.sides as unknown[]) {
      if (typeof side === 'string' && Object.prototype.hasOwnProperty.call(CELL_EDGE_BITS, side)) {
        bits |= CELL_EDGE_BITS[side as Direction];
      }
    }
    if (bits === 0) continue;
    const index = (entry.y as number) * width + (entry.x as number);
    bitsByCell.set(index, (bitsByCell.get(index) ?? 0) | bits);
  }
  if (bitsByCell.size === 0) return null;
  return [...bitsByCell.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({
      x: index % width,
      y: Math.floor(index / width),
      sides: CELL_EDGE_SIDE_ORDER.filter((side) => ((bitsByCell.get(index) ?? 0) & CELL_EDGE_BITS[side]) !== 0)
    }));
}

/** Looks a tile of the Epoxy terrain layer up by id; undefined for an item, an unknown id or a foreign tile set. */
export type TerrainTileLookup = (id: string) => TileDefinition | undefined;

let registeredTerrainLookup: TerrainTileLookup | null = null;

/**
 * Registers the tile lookup the underlay checks use when none is passed. The registry calls it once at
 * load, so this module never imports the registry (which imports this one). Without a lookup the
 * underlays are only checked for shape.
 */
export function registerTerrainTileLookup(lookup: TerrainTileLookup | null): void {
  registeredTerrainLookup = lookup;
}

/** The tile lookup registered by the registry, or null before it loaded; for the checks that default to it. */
export function getRegisteredTerrainLookup(): TerrainTileLookup | null {
  return registeredTerrainLookup;
}

/** True for a top only the opening of a key door or a socket removes: nothing turns back into it. */
function isOpeningTop(tile: TileDefinition): boolean {
  return Boolean(tile.requiredKey || tile.requiresAllChips);
}

/**
 * True for a tile whose state a live device (plate, hold door, toggle wall) changes at run time. The engine
 * plays these hidden under a door or a socket only (it keeps a toggle parity and settles hold doors on the
 * reveal); under any other top they stay refused. Flame jets and laser gates are not listed: they are kept
 * under any removable top and show their current form when revealed (the flame parity, the lit receivers).
 */
function isLiveDevice(tile: TileDefinition): boolean {
  return Boolean(
    tile.plateColor ||
      tile.holdDoorColor ||
      tile.holdDoorTogglesTo ||
      tile.toggleChannel ||
      tile.channelTogglesTo ||
      tile.togglesTo
  );
}

/** Whether a removable top may be hidden under a door or a socket: a socket, dirt or a blue fake wall, never a key door. */
function isRemovableUnderlay(tile: TileDefinition): boolean {
  return !tile.requiredKey && isRemovableTop(tile);
}

/** Every terrain id a cell holding the tile can turn into by a block, a step off, an unlock or a toggle. */
function terrainsReachableFrom(tile: TileDefinition, lookup: TerrainTileLookup): Set<string> {
  const reached = new Set<string>();
  const pending: TileDefinition[] = [tile];
  while (pending.length > 0) {
    const current = pending.pop() as TileDefinition;
    const next = [
      current.blockTransformsTo ?? (current.hazard === 'water' ? SUNK_BLOCK_TILE_ID : undefined),
      current.transformsToOnLeave,
      current.transformsToOnUnlock,
      current.togglesTo,
      current.flameTogglesTo,
      current.swivelTurns?.cw,
      current.swivelTurns?.ccw
    ];
    for (const id of next) {
      if (id === undefined || reached.has(id)) continue;
      reached.add(id);
      const tileOfId = lookup(id);
      if (tileOfId) pending.push(tileOfId);
    }
  }
  return reached;
}

/**
 * The underlays of a level in canonical form: only the Epoxy ruleset carries them. Entries that are
 * not records, lie outside the grid or name no terrain of the terrain layer are dropped. With a tile
 * lookup, an entry is also dropped when the cell's top is not a removable top (a door, a socket, a fake
 * wall, dirt), when the underlay is itself a removable top, a plate, a hold door or a toggle wall (except
 * under a key door or a socket, which nothing turns back into: there a socket, dirt, a blue fake wall, a
 * plate, a hold door and a green or colour toggle wall are kept, never a key door and never the top's own
 * id), or when the underlay can turn back into the cell's top (dirt over water: a block sunk there makes
 * dirt again; the engine reveals a cell at most once anyway, this keeps the level model simple). The first
 * entry of a cell wins, and the entries are sorted by row, then column.
 * Returns null when none is left.
 */
export function normalizeUnderlays(
  underlays: unknown,
  terrain: readonly (readonly string[])[],
  ruleset: unknown,
  lookup: TerrainTileLookup | null = registeredTerrainLookup
): CellUnderlay[] | null {
  if ((isRuleset(ruleset) ? ruleset : 'epoxy') !== 'epoxy' || !Array.isArray(underlays)) return null;
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;
  const byCell = new Map<number, string>();
  for (const entry of underlays as unknown[]) {
    if (!isRecord(entry) || !isInBounds(entry.x, entry.y, width, height)) continue;
    const id = entry.terrain;
    if (typeof id !== 'string') continue;
    if (lookup !== null) {
      const tile = lookup(id);
      const topId = terrain[entry.y as number][entry.x as number];
      const top = lookup(topId);
      if (!tile || !top || !isRemovableTop(top)) continue;
      // Under a door or a socket (which nothing turns back into) the engine also plays a socket, dirt, a blue
      // fake wall and the live devices; under any other top an underlay stays a plain, static terrain.
      const widened = isOpeningTop(top) && id !== topId && isRemovableUnderlay(tile);
      if (isRemovableTop(tile) ? !widened : isLiveDevice(tile) && !(isOpeningTop(top) && id !== topId)) continue;
      if (terrainsReachableFrom(tile, lookup).has(topId)) continue;
    }
    const index = (entry.y as number) * width + (entry.x as number);
    if (!byCell.has(index)) byCell.set(index, id);
  }
  if (byCell.size === 0) return null;
  return [...byCell.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({ x: index % width, y: Math.floor(index / width), terrain: byCell.get(index) as string }));
}

/** Whether a cell can serve as one end of a launcher link: its top or the terrain hidden under it passes `test`. */
function cellHasDevice(
  terrain: readonly (readonly string[])[],
  hidden: ReadonlyMap<number, string>,
  x: number,
  y: number,
  lookup: TerrainTileLookup,
  test: (tile: TileDefinition) => boolean
): boolean {
  const width = terrain[0]?.length ?? 0;
  const ids = [terrain[y][x], hidden.get(y * width + x)];
  return ids.some((id) => {
    const tile = id === undefined ? undefined : lookup(id);
    return tile !== undefined && test(tile);
  });
}

/**
 * The launcher links of a level in canonical form: only the Epoxy ruleset carries them. Entries that are
 * not records, lie outside the grid or hold a non-integer coordinate are dropped. With a tile lookup, an
 * entry is also dropped unless its button cell holds a shot trigger and its launcher cell a shot launcher
 * (a device hidden under a removable top counts: it works once the top is gone). A link is kept once, and
 * the links are sorted by trigger row, trigger column, launcher row, then launcher column. Returns null
 * when none is left.
 */
export function normalizeLauncherLinks(
  links: unknown,
  terrain: readonly (readonly string[])[],
  ruleset: unknown,
  underlays: readonly CellUnderlay[] | null = null,
  lookup: TerrainTileLookup | null = registeredTerrainLookup
): LauncherLink[] | null {
  if ((isRuleset(ruleset) ? ruleset : 'epoxy') !== 'epoxy' || !Array.isArray(links)) return null;
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;
  const hidden = new Map<number, string>();
  for (const under of underlays ?? []) hidden.set(under.y * width + under.x, under.terrain);
  const kept = new Map<string, LauncherLink>();
  for (const entry of links as unknown[]) {
    if (!isRecord(entry)) continue;
    const { buttonX, buttonY, launcherX, launcherY } = entry;
    if (!isInBounds(buttonX, buttonY, width, height) || !isInBounds(launcherX, launcherY, width, height)) continue;
    const link: LauncherLink = {
      buttonX: buttonX as number,
      buttonY: buttonY as number,
      launcherX: launcherX as number,
      launcherY: launcherY as number
    };
    if (lookup !== null) {
      const isTrigger = (tile: TileDefinition): boolean => tile.buttonAction === FIRE_LAUNCHERS_ACTION;
      const isLauncher = (tile: TileDefinition): boolean => tile.shotLauncher !== undefined;
      if (!cellHasDevice(terrain, hidden, link.buttonX, link.buttonY, lookup, isTrigger)) continue;
      if (!cellHasDevice(terrain, hidden, link.launcherX, link.launcherY, lookup, isLauncher)) continue;
    }
    kept.set(`${link.buttonY},${link.buttonX},${link.launcherY},${link.launcherX}`, link);
  }
  if (kept.size === 0) return null;
  return [...kept.values()].sort(
    (a, b) => a.buttonY - b.buttonY || a.buttonX - b.buttonX || a.launcherY - b.launcherY || a.launcherX - b.launcherX
  );
}

/**
 * Returns the level without any optional text field that is not a string, and
 * without a win rule or ruleset that is not a known one, with its cell edges in canonical form (see
 * normalizeCellEdges), with its underlays, launcher links and signal links in canonical form (see normalizeUnderlays, normalizeLauncherLinks, normalizeSignalLinks), and with an empty password in place
 * of one that is not a string, so a stale or hand-edited record cannot hand a number to the
 * text pipeline or an unknown rule to the engine.
 * The input is never mutated.
 */
export function stripInvalidTextFields(level: CompiledLevel): CompiledLevel {
  const record = level as unknown as Record<string, unknown>;
  const bad: string[] = LEVEL_TEXT_FIELDS.filter((key) => key in record && typeof record[key] !== 'string');
  if ('winRule' in record && !isWinRule(record.winRule)) bad.push('winRule');
  if ('ruleset' in record && !isRuleset(record.ruleset)) bad.push('ruleset');
  if ('blockBudget' in record && !isBlockBudget(record.blockBudget)) bad.push('blockBudget');
  const badPassword = typeof record.password !== 'string';
  let edges: CellEdge[] | null = null;
  if ('cellEdges' in record) {
    edges = normalizeCellEdges(record.cellEdges, level.terrain, record.ruleset);
    if (edges === null || JSON.stringify(edges) !== JSON.stringify(record.cellEdges)) bad.push('cellEdges');
  }
  let hidden: CellUnderlay[] | null = null;
  if ('underlays' in record) {
    hidden = normalizeUnderlays(record.underlays, level.terrain, record.ruleset);
    if (hidden === null || JSON.stringify(hidden) !== JSON.stringify(record.underlays)) bad.push('underlays');
  }
  let links: LauncherLink[] | null = null;
  if ('launcherLinks' in record) {
    links = normalizeLauncherLinks(
      record.launcherLinks,
      level.terrain,
      record.ruleset,
      normalizeUnderlays(record.underlays, level.terrain, record.ruleset)
    );
    if (links === null || JSON.stringify(links) !== JSON.stringify(record.launcherLinks)) bad.push('launcherLinks');
  }
  let wires: SignalLink[] | null = null;
  if ('signalLinks' in record) {
    wires = normalizeSignalLinks(
      record.signalLinks,
      level.terrain,
      record.ruleset,
      normalizeUnderlays(record.underlays, level.terrain, record.ruleset)
    );
    if (wires === null || JSON.stringify(wires) !== JSON.stringify(record.signalLinks)) bad.push('signalLinks');
  }
  if (bad.length === 0 && !badPassword) return level;
  const copy: Record<string, unknown> = { ...record };
  for (const key of bad) delete copy[key];
  if (edges !== null && bad.includes('cellEdges')) copy.cellEdges = edges;
  if (hidden !== null && bad.includes('underlays')) copy.underlays = hidden;
  if (links !== null && bad.includes('launcherLinks')) copy.launcherLinks = links;
  if (wires !== null && bad.includes('signalLinks')) copy.signalLinks = wires;
  // The game upper-cases passwords, so a level always carries a string one.
  if (badPassword) copy.password = '';
  return copy as unknown as CompiledLevel;
}

function cutText(value: unknown, max: number): unknown {
  return typeof value === 'string' && value.length > max ? value.slice(0, max) : value;
}

/** Cuts every id of a grid to `max` characters; the grid is returned as is when none is longer. */
function cutIds<T extends string | null>(grid: readonly (readonly T[])[], max: number): T[][] | null {
  const tooLong = grid.some((row) => row.some((id) => typeof id === 'string' && id.length > max));
  return tooLong ? grid.map((row) => row.map((id) => (typeof id === 'string' ? (id.slice(0, max) as T) : id))) : null;
}

/**
 * Returns the level with its text fields cut to `limits`: the optional text fields, the password,
 * the tile and item ids and the entity types. A solution longer than its limit is dropped, since a
 * cut one would replay a wrong game. The input is never mutated, and the level is returned as is
 * when nothing is over a limit.
 */
export function clampLevelText(level: CompiledLevel, limits: LevelTextConfig): CompiledLevel {
  const copy: Record<string, unknown> = { ...(level as unknown as Record<string, unknown>) };
  const cutFields: Array<[string, number]> = [
    ['customTitle', limits.titleMaxLength],
    ['customHint', limits.hintMaxLength],
    ['author', limits.authorMaxLength],
    ['password', limits.passwordMaxLength],
    ['theme', limits.themeMaxLength],
    ['titleKey', limits.keyMaxLength],
    ['hintKey', limits.keyMaxLength]
  ];
  let changed = false;
  for (const [key, max] of cutFields) {
    const cut = cutText(copy[key], max);
    if (cut !== copy[key]) {
      copy[key] = cut;
      changed = true;
    }
  }
  if (typeof copy.solution === 'string' && copy.solution.length > limits.solutionMaxLength) {
    delete copy.solution;
    changed = true;
  }
  const terrain = cutIds(level.terrain, limits.idMaxLength);
  if (terrain) {
    copy.terrain = terrain;
    changed = true;
  }
  const items = cutIds(level.items, limits.idMaxLength);
  if (items) {
    copy.items = items;
    changed = true;
  }
  if (level.entities.some((entity) => entity.type.length > limits.idMaxLength)) {
    copy.entities = level.entities.map((entity) => ({ ...entity, type: entity.type.slice(0, limits.idMaxLength) }));
    changed = true;
  }
  return changed ? (copy as unknown as CompiledLevel) : level;
}

/**
 * Keeps the well-formed levels of a persisted list. A level with a non-string
 * text field stays and loses only that field. With `textLimits` the call is at a trust
 * boundary (a file or a link): entities and links must be well formed and bounded, and
 * the text of the levels that stay is cut to the limits (see clampLevelText). Stored data
 * is read without them, so a record written by an older version loads unchanged.
 */
export function sanitizeStoredLevels(
  values: readonly unknown[],
  bounds: LevelSizeBounds,
  textLimits?: LevelTextConfig
): CompiledLevel[] {
  const levels = values
    .filter((lvl): lvl is CompiledLevel => isCompiledLevelShape(lvl, bounds, textLimits !== undefined))
    .map(stripInvalidTextFields);
  return textLimits ? levels.map((lvl) => clampLevelText(lvl, textLimits)) : levels;
}

/**
 * Gives every level a unique, non-empty id. A level without an id (or with a
 * non-string one) gets `<prefix>_<position>`; a repeated id gets a numeric
 * suffix. Levels keep their order and the first holder of an id keeps it.
 * New level objects are returned only where an id changed.
 */
export function ensureUniqueLevelIds(levels: readonly CompiledLevel[], fallbackPrefix: string): CompiledLevel[] {
  const reserved = new Set<string>();
  for (const lvl of levels) {
    if (typeof lvl.id === 'string' && lvl.id !== '') reserved.add(lvl.id);
  }
  const taken = new Set<string>();
  return levels.map((lvl, index) => {
    const original = typeof lvl.id === 'string' ? lvl.id : '';
    if (original !== '' && !taken.has(original)) {
      taken.add(original);
      return lvl;
    }
    const base = original !== '' ? original : `${fallbackPrefix}_${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (taken.has(candidate) || (candidate !== original && reserved.has(candidate))) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    taken.add(candidate);
    return { ...lvl, id: candidate };
  });
}

/** Problems of the game.json block puzzle section: the search budgets and the watch size limit must be positive integers. */
export function findBlockPuzzleConfigErrors(value: unknown): string[] {
  if (!isRecord(value)) return ['blockPuzzle: not an object'];
  return ['watchSearchBudget', 'hintSearchBudget', 'watchMaxCells']
    .filter((key) => !Number.isInteger(value[key]) || (value[key] as number) <= 0)
    .map((key) => `blockPuzzle.${key}: not a positive integer`);
}

/** campaignGuard fields that must be whole numbers of at least 1. */
const CAMPAIGN_GUARD_SIZE_KEYS = ['windowSize', 'largeWindowSize'];
/** campaignGuard fields that are shares or similarities, in (0, 1]. */
const CAMPAIGN_GUARD_RATIO_KEYS = ['maxJaccard', 'largeWindowMaxShare', 'maxRoomSimilarity', 'maxSokobanSimilarity'];

/** Problems of the game.json campaignGuard section; a missing threshold is an error, not a silent default. */
export function findCampaignGuardConfigErrors(value: unknown): string[] {
  if (!isRecord(value)) return ['campaignGuard: not an object'];
  const errors: string[] = [];
  for (const key of CAMPAIGN_GUARD_SIZE_KEYS) {
    if (!Number.isInteger(value[key]) || (value[key] as number) < 1) errors.push(`campaignGuard.${key}: not a positive integer`);
  }
  const content = value.largeWindowMinContent;
  if (!Number.isInteger(content) || (content as number) < 0) errors.push('campaignGuard.largeWindowMinContent: not a non-negative integer');
  for (const key of CAMPAIGN_GUARD_RATIO_KEYS) {
    const v = value[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1) errors.push(`campaignGuard.${key}: not a number in (0, 1]`);
  }
  if (
    Number.isInteger(value.windowSize) &&
    Number.isInteger(value.largeWindowSize) &&
    (value.largeWindowSize as number) < (value.windowSize as number)
  ) {
    errors.push('campaignGuard.largeWindowSize: smaller than windowSize');
  }
  return errors;
}

/** The side clockwise of each side around a cell. */
const CLOCKWISE_SIDE: Readonly<Record<Direction, Direction>> = { N: 'E', E: 'S', S: 'W', W: 'N' };

/** The edges of a cell turned a quarter turn clockwise, as a sorted string. */
function rotatedEdgesKey(edges: readonly Direction[], clockwise: boolean): string {
  const turn = (side: Direction): Direction =>
    clockwise ? CLOCKWISE_SIDE[side] : (ORDERED_DIRECTIONS.find((d) => CLOCKWISE_SIDE[d] === side) as Direction);
  return edges.map(turn).sort().join('');
}

/**
 * Problems of the swivel door fields of tiles.json: both turn targets must exist, be swivel doors
 * themselves, and carry the edges of the door turned a quarter turn clockwise and counter-clockwise.
 */
export function findSwivelConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    const turns = tile.swivelTurns;
    if (turns === undefined) continue;
    const { id } = tile;
    if (!isRecord(turns) || typeof turns.cw !== 'string' || typeof turns.ccw !== 'string') {
      errors.push(`${id}.swivelTurns: expected { cw, ccw } tile ids`);
      continue;
    }
    const closed = tile.blockedEdges ?? [];
    const adjacent =
      closed.length === 2 &&
      closed.filter((side) => side === 'N' || side === 'S').length === 1 &&
      closed.filter((side) => side === 'E' || side === 'W').length === 1;
    if (!adjacent) errors.push(`${id}.blockedEdges: a swivel door closes exactly two adjacent sides`);
    for (const [field, clockwise] of [['cw', true], ['ccw', false]] as const) {
      const target = tiles[turns[field]];
      if (!target) {
        errors.push(`${id}.swivelTurns.${field}: unknown tile ${turns[field]}`);
        continue;
      }
      if (target.swivelTurns === undefined) errors.push(`${id}.swivelTurns.${field}: ${target.id} is not a swivel door`);
      const expected = rotatedEdgesKey(tile.blockedEdges ?? [], clockwise);
      if ([...(target.blockedEdges ?? [])].sort().join('') !== expected) {
        errors.push(`${id}.swivelTurns.${field}: ${target.id} must close the sides ${id} closes turned a quarter turn`);
      }
    }
  }
  return errors;
}

/**
 * Problems of the laser fields of tiles.json: an emitter needs a direction, a
 * receiver and a gate need a group, a gate needs the other form of its pair
 * (same group, opposite state), and the group of a gate has to be a group some
 * receiver drives. Empty when all is well; each entry names the offending tile.
 */
export function findLaserConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  const receiverGroups = new Set<string>();
  for (const tile of Object.values(tiles)) {
    if (typeof tile.laserReceiverGroup === 'string' && tile.laserReceiverGroup.length > 0) {
      receiverGroups.add(tile.laserReceiverGroup);
    }
  }
  for (const tile of Object.values(tiles)) {
    const { id } = tile;
    if (tile.laserTransparent !== undefined && typeof tile.laserTransparent !== 'boolean') {
      errors.push(`${id}.laserTransparent: expected a boolean`);
    }
    if (tile.laserEmitter !== undefined && !isDirection(tile.laserEmitter)) {
      errors.push(`${id}.laserEmitter: expected a direction`);
    }
    if (tile.laserReceiverGroup !== undefined && !(typeof tile.laserReceiverGroup === 'string' && tile.laserReceiverGroup.length > 0)) {
      errors.push(`${id}.laserReceiverGroup: expected a non-empty group id`);
    }
    const isGate = tile.laserGateGroup !== undefined || tile.laserGateOpen !== undefined || tile.laserGateTogglesTo !== undefined;
    if (!isGate) continue;
    if (typeof tile.laserGateGroup !== 'string' || tile.laserGateGroup.length === 0) {
      errors.push(`${id}.laserGateGroup: expected a non-empty group id`);
      continue;
    }
    if (typeof tile.laserGateOpen !== 'boolean') {
      errors.push(`${id}.laserGateOpen: expected a boolean`);
      continue;
    }
    const pair = typeof tile.laserGateTogglesTo === 'string' ? tiles[tile.laserGateTogglesTo] : undefined;
    if (!pair) {
      errors.push(`${id}.laserGateTogglesTo: expected the id of an existing tile`);
    } else if (pair.laserGateGroup !== tile.laserGateGroup || pair.laserGateOpen !== !tile.laserGateOpen) {
      errors.push(`${id}.laserGateTogglesTo: expected the ${tile.laserGateOpen ? 'closed' : 'open'} form of group ${tile.laserGateGroup}`);
    } else if (pair.laserGateTogglesTo !== id) {
      errors.push(`${id}.laserGateTogglesTo: ${pair.id} does not point back`);
    }
    if (!receiverGroups.has(tile.laserGateGroup)) {
      errors.push(`${id}.laserGateGroup: no receiver drives the group ${tile.laserGateGroup}`);
    }
  }
  return errors;
}

/**
 * Problems of the colour channel fields: a plate colour is a channel colour, a hold door needs a colour,
 * an open or closed flag and the other form of its pair (same colour, opposite state, pointing back), a
 * colour toggle wall needs the other form of its pair in the same channel (never green: green walls are
 * the plain toggle walls), a colour toggle button names its channel, and a colour block names a colour.
 * Empty when all is well; each entry names the offending tile or entity.
 */
export function findColorChannelConfigErrors(
  tiles: Record<string, TileDefinition>,
  entities: Record<string, EntityDefinition> = {}
): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    const { id } = tile;
    if (tile.plateColor !== undefined && !CHANNEL_COLORS.includes(tile.plateColor)) {
      errors.push(`${id}.plateColor: expected a channel colour`);
    }
    if (tile.floatingBlockColor !== undefined && !CHANNEL_COLORS.includes(tile.floatingBlockColor)) {
      errors.push(`${id}.floatingBlockColor: expected a channel colour`);
    }
    if (tile.holdDoorClosesOnOccupant !== undefined && typeof tile.holdDoorClosesOnOccupant !== 'boolean') {
      errors.push(`${id}.holdDoorClosesOnOccupant: expected a boolean`);
    }
    const isHoldDoor =
      tile.holdDoorColor !== undefined || tile.holdDoorOpen !== undefined || tile.holdDoorTogglesTo !== undefined;
    if (isHoldDoor) {
      if (typeof tile.holdDoorColor !== 'string' || !CHANNEL_COLORS.includes(tile.holdDoorColor)) {
        errors.push(`${id}.holdDoorColor: expected a channel colour`);
      } else if (typeof tile.holdDoorOpen !== 'boolean') {
        errors.push(`${id}.holdDoorOpen: expected a boolean`);
      } else {
        const pair = typeof tile.holdDoorTogglesTo === 'string' ? tiles[tile.holdDoorTogglesTo] : undefined;
        if (!pair) {
          errors.push(`${id}.holdDoorTogglesTo: expected the id of an existing tile`);
        } else if (pair.holdDoorColor !== tile.holdDoorColor || pair.holdDoorOpen !== !tile.holdDoorOpen) {
          errors.push(
            `${id}.holdDoorTogglesTo: expected the ${tile.holdDoorOpen ? 'closed' : 'open'} form of colour ${tile.holdDoorColor}`
          );
        } else if (pair.holdDoorTogglesTo !== id) {
          errors.push(`${id}.holdDoorTogglesTo: ${pair.id} does not point back`);
        }
      }
    }
    if (tile.toggleChannel !== undefined || tile.channelTogglesTo !== undefined) {
      if (typeof tile.toggleChannel !== 'string' || !CHANNEL_COLORS.includes(tile.toggleChannel) || tile.toggleChannel === 'green') {
        errors.push(`${id}.toggleChannel: expected red, blue or yellow`);
      } else {
        const pair = typeof tile.channelTogglesTo === 'string' ? tiles[tile.channelTogglesTo] : undefined;
        if (!pair) {
          errors.push(`${id}.channelTogglesTo: expected the id of an existing tile`);
        } else if (pair.toggleChannel !== tile.toggleChannel) {
          errors.push(`${id}.channelTogglesTo: expected a tile of channel ${tile.toggleChannel}`);
        } else if (pair.channelTogglesTo !== id) {
          errors.push(`${id}.channelTogglesTo: ${pair.id} does not point back`);
        }
        if (tile.togglesTo !== undefined) {
          errors.push(`${id}.togglesTo: a colour wall uses channelTogglesTo, togglesTo is the green channel`);
        }
      }
    }
    const channelOfButton = Object.entries(CHANNEL_BUTTON_ACTIONS).find(([, action]) => action === tile.buttonAction);
    if (channelOfButton) {
      const hasWalls = Object.values(tiles).some((t) => t.toggleChannel === channelOfButton[0]);
      if (!hasWalls) errors.push(`${id}.buttonAction: no wall of channel ${channelOfButton[0]}`);
    }
  }
  for (const entity of Object.values(entities)) {
    if (entity.plateColor !== undefined && !CHANNEL_COLORS.includes(entity.plateColor)) {
      errors.push(`${entity.id}.plateColor: expected a channel colour`);
    }
    if (entity.pressesPlates !== undefined && typeof entity.pressesPlates !== 'boolean') {
      errors.push(`${entity.id}.pressesPlates: expected a boolean`);
    }
    if (entity.flying !== undefined && typeof entity.flying !== 'boolean') {
      errors.push(`${entity.id}.flying: expected a boolean`);
    }
  }
  return errors;
}

/** Bounds of a turret beam, in cells. */
const MIN_TURRET_BEAM_LENGTH = 1;
const MAX_TURRET_BEAM_LENGTH = 8;
/** Quarter turns a turret may make each period: fixed, clockwise or counter-clockwise. */
const TURRET_TURNS: readonly number[] = [-1, 0, 1];
/** Opacity modes of a turret beam. */
const TURRET_OPACITIES: readonly string[] = ['block', 'laser'];

/**
 * Problems of the turretBeam field of an entity: a block (never a monster) with a beam length of 1 to 8
 * cells, a turn of -1, 0 or 1, a turn period of at least one tick, boolean flags and a known opacity,
 * and no mirror axis (a turret is not a mirror). Each entry names the entity.
 */
export function findTurretConfigErrors(entities: Record<string, EntityDefinition>): string[] {
  const errors: string[] = [];
  for (const entity of Object.values(entities)) {
    const beam = entity.turretBeam;
    if (beam === undefined) continue;
    const { id } = entity;
    if (entity.kind !== 'block') errors.push(`${id}.turretBeam: only a block may be a turret`);
    if (entity.mirrorAxis !== undefined) errors.push(`${id}.turretBeam: a turret cannot also be a mirror`);
    const lengthValid =
      Number.isInteger(beam.length) && beam.length >= MIN_TURRET_BEAM_LENGTH && beam.length <= MAX_TURRET_BEAM_LENGTH;
    if (!lengthValid) {
      errors.push(`${id}.turretBeam.length: expected an integer from ${MIN_TURRET_BEAM_LENGTH} to ${MAX_TURRET_BEAM_LENGTH}`);
    }
    if (!TURRET_TURNS.includes(beam.turn)) errors.push(`${id}.turretBeam.turn: expected -1, 0 or 1`);
    if (!Number.isInteger(beam.turnPeriodTicks) || beam.turnPeriodTicks < 1) {
      errors.push(`${id}.turretBeam.turnPeriodTicks: expected an integer of at least 1`);
    }
    for (const flag of ['allSides', 'faceOnPush', 'firesAfterFirstStep'] as const) {
      if (beam[flag] !== undefined && typeof beam[flag] !== 'boolean') errors.push(`${id}.turretBeam.${flag}: expected a boolean`);
    }
    if (beam.opacity !== undefined && !TURRET_OPACITIES.includes(beam.opacity)) {
      errors.push(`${id}.turretBeam.opacity: expected "block" or "laser"`);
    }
  }
  return errors;
}

/** Quarter turns a turn plate may apply: clockwise or counter-clockwise. */
const FACING_TURN_VALUES: readonly unknown[] = [1, -1];

/** Problems of the facingTurn field of tiles.json: a terrain tile turns by exactly 1 or -1 quarter turns. */
export function findFacingTurnConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    if (tile.facingTurn === undefined) continue;
    if (!FACING_TURN_VALUES.includes(tile.facingTurn)) errors.push(`${tile.id}.facingTurn: expected 1 or -1`);
    if (tile.layer !== 'terrain') errors.push(`${tile.id}.facingTurn: only a terrain tile may turn blocks`);
  }
  return errors;
}

/** The gate logics a signal gate tile may declare. */
const SIGNAL_GATE_VALUES: readonly unknown[] = ['and', 'or', 'not', 'xor', 'latch'];

/**
 * Problems of the signal fields of tiles.json: a source is 'held' or 'pulse'; a gate is one of the five logics; the
 * latch start flag is true and sits on a latch; all of them belong to a terrain tile, a tile has one signal
 * role only (never mixed with a plate colour, a hold door or a laser receiver), and a gate is impassable.
 */
export function findSignalConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    const { id } = tile;
    const hasSource = tile.signalSource !== undefined;
    const hasGate = tile.signalGate !== undefined;
    if (tile.signalLatchStartsOn !== undefined && tile.signalLatchStartsOn !== true) {
      errors.push(`${id}.signalLatchStartsOn: expected true`);
    }
    if (tile.signalLatchStartsOn !== undefined && tile.signalGate !== 'latch') {
      errors.push(`${id}.signalLatchStartsOn: only a latch gate may start on`);
    }
    if (!hasSource && !hasGate) continue;
    if (hasSource && tile.signalSource !== 'held' && tile.signalSource !== 'pulse') {
      errors.push(`${id}.signalSource: expected "held" or "pulse"`);
    }
    if (hasGate && !SIGNAL_GATE_VALUES.includes(tile.signalGate)) {
      errors.push(`${id}.signalGate: expected "and", "or", "not", "xor" or "latch"`);
    }
    if (tile.layer !== 'terrain') errors.push(`${id}: a signal source or gate must be a terrain tile`);
    if (hasSource && hasGate) errors.push(`${id}: a tile cannot be both a signal source and a signal gate`);
    if (tile.plateColor !== undefined || tile.holdDoorColor !== undefined || tile.laserReceiverGroup !== undefined) {
      errors.push(`${id}: a signal tile cannot also be a plate, a hold door or a laser receiver`);
    }
    if (hasGate && (tile.passableByPlayer || tile.passableByMonster || tile.passableByBlock)) {
      errors.push(`${id}: a signal gate must be impassable`);
    }
  }
  return errors;
}

/** Relative sides an arrow block may show an arrow on. */
const PUSH_ARROW_TURNS: readonly string[] = ['FORWARD', 'RIGHT', 'BACK', 'LEFT'];

/**
 * Problems of the pushArrows field of an entity: a block (never a monster) with a non-empty list of
 * unique relative sides (FORWARD, RIGHT, BACK or LEFT). Each entry names the entity.
 */
export function findPushArrowConfigErrors(entities: Record<string, EntityDefinition>): string[] {
  const errors: string[] = [];
  for (const entity of Object.values(entities)) {
    const arrows = entity.pushArrows;
    if (arrows === undefined) continue;
    const { id } = entity;
    if (entity.kind !== 'block') errors.push(`${id}.pushArrows: only a block may show push arrows`);
    if (!Array.isArray(arrows) || arrows.length === 0) {
      errors.push(`${id}.pushArrows: expected a non-empty array`);
      continue;
    }
    for (const turn of arrows) {
      if (!PUSH_ARROW_TURNS.includes(turn)) errors.push(`${id}.pushArrows: "${String(turn)}" is not FORWARD, RIGHT, BACK or LEFT`);
    }
    if (new Set(arrows).size !== arrows.length) errors.push(`${id}.pushArrows: sides must be unique`);
  }
  return errors;
}

/** Corners a one-sided mirror may face; the axis must be the one that cuts the corner off. */
const MIRROR_CORNERS: readonly string[] = Object.keys(MIRROR_FRONT_AXIS);
/** What a flying shot may do to an entity it meets. */
const SHOT_EFFECTS: readonly string[] = ['stop', 'destroy', 'reflect', 'melt'];

/**
 * Problems of the shot fields. A tile: a launcher has a direction, a whole number of ticks per cell (at
 * least 1, the same on every launcher, since the level steps its shots together) and is neither passable
 * nor laser transparent. An entity: mirrorFrontCorner is on a mirror block, names a corner and agrees with
 * the mirror axis; shotEffect is a known effect, a melt needs a meltsInFireTo terrain and a reflect needs
 * a mirror axis. Each entry names the tile or entity.
 */
export function findShotConfigErrors(
  tiles: Record<string, TileDefinition>,
  entities: Record<string, EntityDefinition>
): string[] {
  const errors: string[] = [];
  const stepTicksSeen = new Set<number>();
  for (const tile of Object.values(tiles)) {
    const launcher = tile.shotLauncher;
    if (launcher === undefined) continue;
    const { id } = tile;
    if (!isRecord(launcher) || !isDirection(launcher.dir)) {
      errors.push(`${id}.shotLauncher.dir: expected a direction`);
      continue;
    }
    if (!Number.isInteger(launcher.stepTicks) || launcher.stepTicks < 1) {
      errors.push(`${id}.shotLauncher.stepTicks: expected an integer of at least 1`);
    } else {
      stepTicksSeen.add(launcher.stepTicks);
    }
    if (tile.passableByPlayer || tile.passableByMonster || tile.passableByBlock) {
      errors.push(`${id}.shotLauncher: a launcher cannot be passable`);
    }
    if (tile.laserTransparent === true) errors.push(`${id}.shotLauncher: a launcher cannot be laser transparent`);
  }
  if (stepTicksSeen.size > 1) errors.push('shotLauncher.stepTicks: every launcher must declare the same count');
  for (const entity of Object.values(entities)) {
    const { id } = entity;
    if (entity.mirrorFrontCorner !== undefined) {
      if (entity.kind !== 'block') errors.push(`${id}.mirrorFrontCorner: only a block may be a mirror`);
      if (!MIRROR_CORNERS.includes(entity.mirrorFrontCorner)) {
        errors.push(`${id}.mirrorFrontCorner: expected NE, NW, SE or SW`);
      } else if (entity.mirrorAxis !== MIRROR_FRONT_AXIS[entity.mirrorFrontCorner]) {
        errors.push(
          `${id}.mirrorFrontCorner: the corner ${entity.mirrorFrontCorner} needs the ${MIRROR_FRONT_AXIS[entity.mirrorFrontCorner]} axis`
        );
      }
    }
    if (entity.shotEffect !== undefined) {
      if (!SHOT_EFFECTS.includes(entity.shotEffect)) {
        errors.push(`${id}.shotEffect: expected stop, destroy, reflect or melt`);
      } else if (entity.shotEffect === 'reflect' && entity.mirrorAxis === undefined) {
        errors.push(`${id}.shotEffect: only a mirror reflects a shot`);
      } else if (entity.shotEffect === 'melt' && typeof entity.meltsInFireTo !== 'string') {
        errors.push(`${id}.shotEffect: a melt needs meltsInFireTo`);
      }
    }
  }
  return errors;
}

/** Movement patterns the monster engine knows; an entity that names another one would walk by its turn order. */
const KNOWN_MOVEMENT_PATTERNS: readonly string[] = [
  'left_wall',
  'right_wall',
  'bounce',
  'forward_else_random',
  CHASE_PLAYER_PATTERN,
  FLEE_PLAYER_PATTERN,
  STATIONARY_PATTERN,
  'left_skew',
  'right_skew',
  'tank_march',
  'pure_random'
];
/** Who may work a button, as a tile declares it. */
const BUTTON_WORKERS: readonly string[] = ['player'];

/**
 * Problems of the steering fields. A tile: buttonWorkedBy is a known worker and sits on a button. An
 * entity: movementPattern is one the engine knows; steeredBy is only on a monster and names a button
 * action some tile carries; pushesBlocks is a boolean on a monster; passesTiles is a list of ids of
 * existing tiles on a monster. Each entry names the tile or the entity.
 */
export function findSteeringConfigErrors(
  tiles: Record<string, TileDefinition>,
  entities: Record<string, EntityDefinition>
): string[] {
  const errors: string[] = [];
  const usedActions = new Set(Object.values(tiles).map((tile) => tile.buttonAction));
  for (const tile of Object.values(tiles)) {
    if (tile.buttonWorkedBy === undefined) continue;
    if (!BUTTON_WORKERS.includes(tile.buttonWorkedBy)) errors.push(`${tile.id}.buttonWorkedBy: expected "player"`);
    if (tile.buttonAction === undefined) errors.push(`${tile.id}.buttonWorkedBy: only a button has a worker`);
  }
  for (const entity of Object.values(entities)) {
    const { id } = entity;
    if (entity.movementPattern !== undefined && !KNOWN_MOVEMENT_PATTERNS.includes(entity.movementPattern)) {
      errors.push(`${id}.movementPattern: unknown pattern "${entity.movementPattern}"`);
    }
    if (entity.steeredBy !== undefined) {
      if (entity.kind !== 'monster') errors.push(`${id}.steeredBy: only a monster may be steered`);
      if (entity.steeredBy !== STEER_MONSTERS_ACTION) {
        errors.push(`${id}.steeredBy: expected "${STEER_MONSTERS_ACTION}"`);
      } else if (!usedActions.has(entity.steeredBy)) {
        errors.push(`${id}.steeredBy: no tile carries the button action "${entity.steeredBy}"`);
      }
    }
    if (entity.pushesBlocks !== undefined) {
      if (typeof entity.pushesBlocks !== 'boolean') errors.push(`${id}.pushesBlocks: expected a boolean`);
      if (entity.kind !== 'monster') errors.push(`${id}.pushesBlocks: only a monster pushes blocks`);
    }
    if (entity.passesTiles !== undefined) {
      if (entity.kind !== 'monster') errors.push(`${id}.passesTiles: only a monster passes tiles`);
      if (!Array.isArray(entity.passesTiles)) {
        errors.push(`${id}.passesTiles: expected a list of tile ids`);
      } else {
        for (const tileId of entity.passesTiles) {
          if (typeof tileId !== 'string' || tiles[tileId] === undefined) {
            errors.push(`${id}.passesTiles: "${String(tileId)}" is not the id of an existing tile`);
          }
        }
      }
    }
  }
  return errors;
}

/** Bounds of the slowsMonsters factor: at least twice as slow, at most four times. */
const MIN_MONSTER_SLOWDOWN = 2;
const MAX_MONSTER_SLOWDOWN = 4;

/** Problems of the slowsMonsters field: an integer from 2 to 4, carried by boots only. Each entry names the tile. */
export function findSlowTimeConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    if (tile.slowsMonsters === undefined) continue;
    const { slowsMonsters } = tile;
    const valid = Number.isInteger(slowsMonsters) && slowsMonsters >= MIN_MONSTER_SLOWDOWN && slowsMonsters <= MAX_MONSTER_SLOWDOWN;
    if (!valid) errors.push(`${tile.id}.slowsMonsters: expected an integer from ${MIN_MONSTER_SLOWDOWN} to ${MAX_MONSTER_SLOWDOWN}`);
    if (tile.collectible !== 'boot') errors.push(`${tile.id}.slowsMonsters: only boots (collectible "boot") may slow monsters`);
  }
  return errors;
}

/** The only hastesPlayer factor accepted until the move tween and the hold-to-move repeat are checked at other values. */
const SUPPORTED_PLAYER_HASTE = 2;

/** Problems of the hastesPlayer field: exactly 2 for now, carried by boots only. Each entry names the tile. */
export function findSpeedBootsConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    if (tile.hastesPlayer === undefined) continue;
    if (tile.hastesPlayer !== SUPPORTED_PLAYER_HASTE) {
      errors.push(`${tile.id}.hastesPlayer: expected exactly ${SUPPORTED_PLAYER_HASTE}`);
    }
    if (tile.collectible !== 'boot') errors.push(`${tile.id}.hastesPlayer: only boots (collectible "boot") may haste the player`);
  }
  return errors;
}

/** Fields of a paired monster that would change how it is steered, what it moves or which plates it presses. */
const TRANSMOGRIFIER_FORBIDDEN_FIELDS = ['steeredBy', 'pushesBlocks', 'passesTiles', 'pressesPlates'] as const;

/** Transmogrifier config problems, split by the config file they belong to. */
export interface TransmogrifierConfigErrors {
  tiles: string[];
  monsters: string[];
}

/**
 * Problems of the transmogrifier fields: `transmogrifies` is true when present, and every `transmogrifiesTo`
 * names another existing monster that points back, moves at the same interval, flies or not alike, and
 * carries no override of steering, pushing, tile passing or plate pressing. Each entry names the entity or tile.
 */
export function findTransmogrifierConfigErrors(
  tiles: Record<string, TileDefinition>,
  entities: Record<string, EntityDefinition>
): TransmogrifierConfigErrors {
  const tileErrors: string[] = [];
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    if (tile.transmogrifies !== undefined && tile.transmogrifies !== true) tileErrors.push(`${tile.id}.transmogrifies: expected true`);
  }
  for (const entity of Object.values(entities)) {
    const target = entity.transmogrifiesTo;
    if (target === undefined) continue;
    const { id } = entity;
    if (entity.kind !== 'monster') errors.push(`${id}.transmogrifiesTo: only a monster may transmogrify`);
    if (typeof target !== 'string') {
      errors.push(`${id}.transmogrifiesTo: expected a monster id`);
      continue;
    }
    if (target === id) errors.push(`${id}.transmogrifiesTo: a monster cannot transmogrify into itself`);
    const other = entities[target];
    if (other === undefined) {
      errors.push(`${id}.transmogrifiesTo: unknown entity ${target}`);
      continue;
    }
    if (other.kind !== 'monster') errors.push(`${id}.transmogrifiesTo: ${target} is not a monster`);
    if (other.transmogrifiesTo !== id) errors.push(`${id}.transmogrifiesTo: ${target} must transmogrify back into ${id}`);
    if (entity.moveIntervalTicks !== other.moveIntervalTicks) {
      errors.push(`${id}.transmogrifiesTo: ${id} and ${target} must have the same moveIntervalTicks`);
    }
    if ((entity.flying === true) !== (other.flying === true)) {
      errors.push(`${id}.transmogrifiesTo: ${id} and ${target} must both fly or both walk`);
    }
    for (const side of [entity, other]) {
      for (const field of TRANSMOGRIFIER_FORBIDDEN_FIELDS) {
        if (side[field] !== undefined) errors.push(`${side.id}.${field}: a transmogrified monster must not override it`);
      }
    }
  }
  return { tiles: tileErrors, monsters: errors };
}

/** Problems of the pullsBlocks field: true when present, carried by boots only. Each entry names the tile. */
export function findPullBootsConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    if (tile.pullsBlocks === undefined) continue;
    if (tile.pullsBlocks !== true) errors.push(`${tile.id}.pullsBlocks: expected true`);
    if (tile.collectible !== 'boot') errors.push(`${tile.id}.pullsBlocks: only boots (collectible "boot") may pull blocks`);
  }
  return errors;
}

/**
 * Problems of the blast charge fields: a charge (collectible "charge") names the lit form it turns into when
 * dropped, which must be a tile flagged litCharge; a lit charge is no collectible. Each entry names the tile.
 */
export function findChargeConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    if (tile.collectible === 'charge') {
      if (typeof tile.dropsAs !== 'string' || tiles[tile.dropsAs]?.litCharge !== true) {
        errors.push(`${tile.id}.dropsAs: expected the id of a tile flagged litCharge`);
      }
    } else if (tile.dropsAs !== undefined) {
      errors.push(`${tile.id}.dropsAs: only a charge (collectible "charge") may name the item it drops as`);
    }
    if (tile.litCharge === undefined) continue;
    if (tile.litCharge !== true) errors.push(`${tile.id}.litCharge: expected true`);
    if (tile.collectible !== undefined) errors.push(`${tile.id}.litCharge: a lit charge cannot be collected`);
  }
  return errors;
}

/** Problems of the revealsHiddenWalls field: true when present, carried by boots only. Each entry names the tile. */
export function findEyeBootsConfigErrors(tiles: Record<string, TileDefinition>): string[] {
  const errors: string[] = [];
  for (const tile of Object.values(tiles)) {
    if (tile.revealsHiddenWalls === undefined) continue;
    if (tile.revealsHiddenWalls !== true) errors.push(`${tile.id}.revealsHiddenWalls: expected true`);
    if (tile.collectible !== 'boot') errors.push(`${tile.id}.revealsHiddenWalls: only boots (collectible "boot") may reveal hidden walls`);
  }
  return errors;
}

/** Problems of the optional sampled-file fields of the sound effects. */
function findSfxEffectErrors(effects: AudioConfig['effects'] | undefined): string[] {
  const errors: string[] = [];
  for (const [id, effect] of Object.entries(effects ?? {})) {
    const { files, maxDurationMs, fadeOutMs, gain, minIntervalMs } = effect;
    if (files !== undefined) {
      const valid = Array.isArray(files) && files.length > 0 && files.every((f) => typeof f === 'string' && f.length > 0);
      if (!valid) errors.push(`effects.${id}.files: expected a non-empty list of file names`);
    }
    const capValid = maxDurationMs !== undefined && isFiniteNumber(maxDurationMs) && maxDurationMs > 0;
    if (maxDurationMs !== undefined && !capValid) {
      errors.push(`effects.${id}.maxDurationMs: expected a finite number above 0`);
    }
    if (fadeOutMs !== undefined) {
      if (!(isFiniteNumber(fadeOutMs) && fadeOutMs >= 0)) {
        errors.push(`effects.${id}.fadeOutMs: expected a finite number of at least 0`);
      } else if (maxDurationMs === undefined) {
        errors.push(`effects.${id}.fadeOutMs: needs maxDurationMs`);
      } else if (capValid && fadeOutMs > maxDurationMs) {
        errors.push(`effects.${id}.fadeOutMs: expected at most maxDurationMs`);
      }
    }
    if (gain !== undefined && !(isFiniteNumber(gain) && gain >= 0)) {
      errors.push(`effects.${id}.gain: expected a finite number of at least 0`);
    }
    if (minIntervalMs !== undefined && !(isFiniteNumber(minIntervalMs) && minIntervalMs >= 0)) {
      errors.push(`effects.${id}.minIntervalMs: expected a finite number of at least 0`);
    }
    (Array.isArray(effect.notes) ? effect.notes : []).forEach((note, index) => {
      const at = `effects.${id}.notes[${index}]`;
      if (note.slideToFreq !== undefined && !(isFiniteNumber(note.slideToFreq) && note.slideToFreq > 0)) {
        errors.push(`${at}.slideToFreq: expected a finite number above 0`);
      }
      if (note.attackMs !== undefined) {
        const valid = isFiniteNumber(note.attackMs) && note.attackMs >= 0 && note.attackMs < note.durationMs;
        if (!valid) errors.push(`${at}.attackMs: expected a finite number of at least 0 and below durationMs`);
      }
    });
  }
  return errors;
}

/**
 * Problems of audio.json that would only show once a track is picked: track
 * ids must be unique, every track must be a file track with files, every
 * biome must point to a real track, and the default music mode must exist.
 */
export function findAudioConfigErrors(
  audio: AudioConfig,
  themes: Record<string, ThemePalette> | undefined,
  endlessTrackIds?: readonly unknown[]
): string[] {
  const errors: string[] = [];
  if (audio.defaultMusicMode !== undefined && !isMusicMode(audio.defaultMusicMode)) {
    errors.push(`defaultMusicMode: expected one of ${MUSIC_MODES.join(', ')}`);
  }
  const fadeIn: unknown = audio.musicMix?.fileFadeInMs;
  if (fadeIn !== undefined && !(isFiniteNumber(fadeIn) && fadeIn >= 0)) {
    errors.push('musicMix.fileFadeInMs: expected a finite number of at least 0');
  }
  errors.push(...findSfxEffectErrors(audio.effects));
  for (const [terrain, effectId] of Object.entries(audio.terrainStepEffects ?? {})) {
    if (typeof effectId !== 'string' || !Object.hasOwn(audio.effects, effectId)) {
      errors.push(`terrainStepEffects.${terrain}: expected the id of an existing effect`);
    }
  }
  const tracks = audio.tracks ?? [];
  const seen = new Set<string>();
  for (const track of tracks) {
    if (typeof track.id !== 'string' || track.id.length === 0) {
      errors.push('tracks: every track needs a non-empty id');
      continue;
    }
    if (seen.has(track.id)) errors.push(`tracks.${track.id}: duplicate id`);
    seen.add(track.id);
    // The JSON is untrusted: a leftover synth track must be refused, whatever the type says.
    const source: unknown = track.source;
    if (source !== 'file') {
      errors.push(`tracks.${track.id}.source: expected "file", synthesized music tracks are not supported`);
    }
    const validFiles =
      Array.isArray(track.files) && track.files.length > 0 && track.files.every((f) => typeof f === 'string' && f.length > 0);
    if (!validFiles) errors.push(`tracks.${track.id}.files: expected a non-empty list of file names`);
    if (track.gain !== undefined && !(isFiniteNumber(track.gain) && track.gain >= 0)) {
      errors.push(`tracks.${track.id}.gain: expected a finite number of at least 0`);
    }
  }
  for (const theme of Object.values(themes ?? {})) {
    if (theme.musicTrackId !== undefined && !seen.has(theme.musicTrackId)) {
      errors.push(`themes.${theme.id}.musicTrackId: no track with this id`);
    }
  }
  for (const id of endlessTrackIds ?? []) {
    if (typeof id !== 'string' || !seen.has(id)) {
      errors.push(`endlessUi.musicTrackIds: no track with the id ${JSON.stringify(id)}`);
    }
  }
  return errors;
}
