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

import { ORDERED_DIRECTIONS } from './constants';
import { isMusicMode, MUSIC_MODES } from '../audio/musicSelection';
import {
  AudioConfig,
  CompiledLevel,
  DatFormatConfig,
  Direction,
  GameConfig,
  GridConfig,
  Ruleset,
  ThemePalette,
  TileDefinition,
  WinRule
} from '../core/types';

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
export function isCc3dLevelShape(value: unknown, bounds: LevelSizeBounds): boolean {
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
      (cell.item === null || isRecord(cell.item))
  );
  const w = width as number;
  const h = height as number;
  return (
    cellsOk &&
    Array.isArray(mobs) &&
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

/**
 * Structural check for a level read back from localStorage, IndexedDB or a
 * JSON import, where the data may be stale or hand-edited. The level sets
 * its own size: the terrain must be a rectangular grid within the bounds,
 * the items grid must match it and the player start must lie inside it.
 */
export function isCompiledLevelShape(value: unknown, bounds: LevelSizeBounds): value is CompiledLevel {
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
    Array.isArray(value.entities) &&
    Array.isArray(value.trapLinks) &&
    Array.isArray(value.cloneLinks) &&
    // A cc3d level carries its data, and no other level does: the cc3d engine reads nothing else.
    (value.ruleset === 'cc3d' ? isCc3dLevelShape(value.cc3d, bounds) : value.cc3d === undefined)
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

/** Rulesets a level may declare; anything else in a stored level is dropped. */
export const RULESETS: readonly Ruleset[] = ['epoxy', 'lynx', 'cc3d'];

/** True for a value that names a known ruleset. */
export function isRuleset(value: unknown): value is Ruleset {
  return typeof value === 'string' && (RULESETS as readonly string[]).includes(value);
}

/**
 * Returns the level without any optional text field that is not a string, and
 * without a win rule or ruleset that is not a known one, so a stale or hand-edited record
 * cannot hand a number to the text pipeline or an unknown rule to the engine.
 * The input is never mutated.
 */
export function stripInvalidTextFields(level: CompiledLevel): CompiledLevel {
  const record = level as unknown as Record<string, unknown>;
  const bad: string[] = LEVEL_TEXT_FIELDS.filter((key) => key in record && typeof record[key] !== 'string');
  if ('winRule' in record && !isWinRule(record.winRule)) bad.push('winRule');
  if ('ruleset' in record && !isRuleset(record.ruleset)) bad.push('ruleset');
  if (bad.length === 0) return level;
  const copy: Record<string, unknown> = { ...record };
  for (const key of bad) delete copy[key];
  return copy as unknown as CompiledLevel;
}

/**
 * Keeps the well-formed levels of a persisted list. A level with a non-string
 * text field stays and loses only that field.
 */
export function sanitizeStoredLevels(values: readonly unknown[], bounds: LevelSizeBounds): CompiledLevel[] {
  return values
    .filter((lvl): lvl is CompiledLevel => isCompiledLevelShape(lvl, bounds))
    .map(stripInvalidTextFields);
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
