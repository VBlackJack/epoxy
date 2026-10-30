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
import { CompiledLevel, Direction, GameConfig, GridConfig } from '../core/types';

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

/** Smallest value of the endless dialog's start level bound: level 1 must stay reachable. */
const MIN_START_LEVEL_BOUND = 1;
const MIN_FALLBACK_CANDIDATES = 0;

/**
 * Checks the endless and procedural tunables that code relies on as whole
 * numbers. Empty when all is well; each entry names the offending key.
 */
export function findGameTunableErrors(game: GameConfig): string[] {
  const errors: string[] = [];
  if (!isIntegerAtLeast(game.endlessUi?.maxStartLevel, MIN_START_LEVEL_BOUND)) {
    errors.push(`endlessUi.maxStartLevel: expected a whole number of at least ${MIN_START_LEVEL_BOUND}`);
  }
  if (game.procedural && !isIntegerAtLeast(game.procedural.scoring?.fallbackCandidates, MIN_FALLBACK_CANDIDATES)) {
    errors.push(`procedural.scoring.fallbackCandidates: expected a whole number of at least ${MIN_FALLBACK_CANDIDATES}`);
  }
  return errors;
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
    Array.isArray(value.cloneLinks)
  );
}

/** Optional text fields of a level; each one is kept only when it is a string. */
const LEVEL_TEXT_FIELDS = ['titleKey', 'customTitle', 'hintKey', 'customHint'] as const;

/**
 * Returns the level without any optional text field that is not a string, so
 * a stale or hand-edited record cannot hand a number to the text pipeline.
 * The input is never mutated.
 */
export function stripInvalidTextFields(level: CompiledLevel): CompiledLevel {
  const record = level as unknown as Record<string, unknown>;
  const bad = LEVEL_TEXT_FIELDS.filter((key) => key in record && typeof record[key] !== 'string');
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

/** Problems of the game.json block puzzle section: both search budgets must be positive integers. */
export function findBlockPuzzleConfigErrors(value: unknown): string[] {
  if (!isRecord(value)) return ['blockPuzzle: not an object'];
  return ['watchSearchBudget', 'hintSearchBudget']
    .filter((key) => !Number.isInteger(value[key]) || (value[key] as number) <= 0)
    .map((key) => `blockPuzzle.${key}: not a positive integer`);
}
