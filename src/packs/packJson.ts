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

import { PACK_JSON_FORMAT, PACK_JSON_MAX_VERSION, PACK_JSON_VERSION, PACK_JSON_VERSION_CELL_EDGES } from '../config/constants';
import {
  ensureUniqueLevelIds,
  isRecord,
  LevelSizeBounds,
  sanitizeStoredLevels
} from '../config/ConfigValidation';
import { CompiledLevel, LevelTextConfig } from '../core/types';
import { clampPackMetadata, PackMetadata, PackMetadataLimits } from './packMetadata';
import { Clock, generateLevelId, normalizePackName, renumberLevels } from './userPacks';

/** Indent of the pack file written for people; a share link writes it compact. */
const PACK_JSON_INDENT = 2;

/** Why a pack file was refused. */
export type PackJsonError = 'malformed' | 'format' | 'version' | 'name' | 'no_levels';

export type PackJsonResult =
  | ({ ok: true; name: string; levels: CompiledLevel[] } & PackMetadata)
  | { ok: false; error: PackJsonError };

/** The pack file: a format marker, a version, the pack name and its levels as stored. */
export interface PackJsonFile {
  format: typeof PACK_JSON_FORMAT;
  version: number;
  name: string;
  /** Optional credit line; absent in files written before the field existed. */
  author?: string;
  /** Optional description; absent in files written before the field existed. */
  description?: string;
  levels: CompiledLevel[];
}

/** Serialises a pack to the exchange format. Levels are written whole, whatever their ruleset. `compact` drops the indentation. */
export function serializePack(
  name: string,
  levels: readonly CompiledLevel[],
  metadata: PackMetadata = {},
  compact = false
): string {
  const file: PackJsonFile = {
    format: PACK_JSON_FORMAT,
    version: levels.some((level) => level.cellEdges !== undefined) ? PACK_JSON_VERSION_CELL_EDGES : PACK_JSON_VERSION,
    name,
    ...(metadata.author ? { author: metadata.author } : {}),
    ...(metadata.description ? { description: metadata.description } : {}),
    levels: [...levels]
  };
  return compact ? JSON.stringify(file) : JSON.stringify(file, null, PACK_JSON_INDENT);
}

/**
 * Reads a pack file. Levels go through the same validation as stored levels
 * (size bounds included); the ones that fail are dropped, and the file is
 * refused when none is left. Level ids are made unique inside the pack, then
 * re-issued for the ones the library already holds (`takenLevelIds`). The
 * optional author and description are clamped to `limits`; without limits they
 * are not read. With `textLimits`, the text of the levels is cut to them.
 */
export function parsePackJson(
  text: string,
  bounds: LevelSizeBounds,
  takenLevelIds: ReadonlySet<string>,
  now: Clock = Date.now,
  limits?: PackMetadataLimits,
  textLimits?: LevelTextConfig
): PackJsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (!isRecord(parsed) || parsed.format !== PACK_JSON_FORMAT) return { ok: false, error: 'format' };
  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > PACK_JSON_MAX_VERSION) {
    return { ok: false, error: 'version' };
  }
  const name = typeof parsed.name === 'string' ? normalizePackName(parsed.name) : '';
  if (name === '') return { ok: false, error: 'name' };
  if (!Array.isArray(parsed.levels)) return { ok: false, error: 'malformed' };
  const valid = sanitizeStoredLevels(parsed.levels, bounds, textLimits);
  if (valid.length === 0) return { ok: false, error: 'no_levels' };

  const unique = ensureUniqueLevelIds(valid, name);
  // A new id must avoid the library and the other ids of this file.
  const reserved = new Set([...takenLevelIds, ...unique.map((lvl) => lvl.id)]);
  const levels = unique.map((lvl) => {
    if (!takenLevelIds.has(lvl.id)) return lvl;
    const id = generateLevelId(reserved, now);
    reserved.add(id);
    return { ...lvl, id };
  });
  return {
    ok: true,
    name,
    levels: renumberLevels(levels),
    ...(limits ? clampPackMetadata(parsed, limits) : {})
  };
}
