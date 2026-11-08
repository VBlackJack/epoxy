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
  CC2_SOURCES_FIELD,
  PACK_JSON_FORMAT,
  PACK_JSON_MAX_VERSION,
  PACK_JSON_VERSION,
  PACK_JSON_VERSION_CELL_EDGES,
  PACK_JSON_VERSION_LAUNCHERS,
  PACK_JSON_VERSION_PULSE_SINKS,
  PACK_JSON_VERSION_SIGNALS,
  PACK_JSON_VERSION_UNDERLAYS,
  PACK_JSON_VERSION_V11,
  PACK_JSON_VERSION_V13
} from '../config/constants';
import {
  ensureUniqueLevelIds,
  isRecord,
  LevelSizeBounds,
  sanitizeStoredLevels
} from '../config/ConfigValidation';
import { DEFAULT_PLAYER_CHARACTER } from '../core/coreConstants';
import { cellEdgeMask } from '../core/EdgeRules';
import { idSetVersionOf, usesFlipSinkFormat, usesPulseSinkFormat } from '../core/signalLinks';
import { CompiledLevel, LevelTextConfig } from '../core/types';
import { underlayMap } from '../core/Underlays';
import { clampPackMetadata, PackMetadata, PackMetadataLimits } from './packMetadata';
import { isSha256Hex } from '../storage/cc2Sources';
import { Clock, generateLevelId, normalizePackName, renumberLevels } from './userPacks';

/** Indent of the pack file written for people; a share link writes it compact. */
const PACK_JSON_INDENT = 2;

/** Why a pack file was refused. */
export type PackJsonError = 'malformed' | 'format' | 'version' | 'name' | 'no_levels';

export type PackJsonResult =
  | ({ ok: true; name: string; levels: CompiledLevel[]; cc2Sources?: Record<string, string> } & PackMetadata)
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
  /** Optional raw CC2 source files, base64 by SHA-256, written only when the player opts in to include them. */
  cc2Sources?: Record<string, string>;
  levels: CompiledLevel[];
}

/** The lowest version that carries what the levels hold: the highest feature present decides. */
function packFileVersion(levels: readonly CompiledLevel[]): number {
  // A signal link that flips a tile is read by format 11 builds only, whatever ids the level holds.
  const flipVersion = levels.some((level) => usesFlipSinkFormat(level)) ? PACK_JSON_VERSION_V11 : 0;
  // A level played by Melinda is read as Chip's by a build that does not know the field, so it needs format 13.
  const characterVersion = levels.some((level) => level.character !== undefined && level.character !== DEFAULT_PLAYER_CHARACTER)
    ? PACK_JSON_VERSION_V13
    : flipVersion;
  const idSetVersion = levels.reduce((highest, level) => Math.max(highest, idSetVersionOf(level)), characterVersion);
  if (idSetVersion > 0) return idSetVersion;
  if (levels.some((level) => usesPulseSinkFormat(level))) return PACK_JSON_VERSION_PULSE_SINKS;
  if (levels.some((level) => (level.signalLinks?.length ?? 0) > 0)) return PACK_JSON_VERSION_SIGNALS;
  if (levels.some((level) => (level.launcherLinks?.length ?? 0) > 0)) return PACK_JSON_VERSION_LAUNCHERS;
  if (levels.some((level) => underlayMap(level) !== null)) return PACK_JSON_VERSION_UNDERLAYS;
  if (levels.some((level) => cellEdgeMask(level) !== null)) return PACK_JSON_VERSION_CELL_EDGES;
  return PACK_JSON_VERSION;
}

/** Serialises a pack to the exchange format. Levels are written whole, whatever their ruleset. `compact` drops the indentation. */
export function serializePack(
  name: string,
  levels: readonly CompiledLevel[],
  metadata: PackMetadata = {},
  compact = false,
  cc2Sources?: Readonly<Record<string, string>>
): string {
  const file: PackJsonFile = {
    format: PACK_JSON_FORMAT,
    version: packFileVersion(levels),
    name,
    ...(metadata.author ? { author: metadata.author } : {}),
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(cc2Sources && Object.keys(cc2Sources).length > 0 ? { [CC2_SOURCES_FIELD]: { ...cc2Sources } } : {}),
    levels: [...levels]
  };
  return compact ? JSON.stringify(file) : JSON.stringify(file, null, PACK_JSON_INDENT);
}

/** The raw CC2 sources of a pack file, kept only for the hashes some level names; undefined when none is usable. */
function readCc2Sources(value: unknown, levels: readonly CompiledLevel[]): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const wanted = new Set(levels.flatMap((level) => (level.cc2 ? [level.cc2.sha256] : [])));
  const kept: Record<string, string> = {};
  for (const [hash, text] of Object.entries(value)) {
    if (wanted.has(hash) && isSha256Hex(hash) && typeof text === 'string') kept[hash] = text;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
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
  const cc2Sources = readCc2Sources(parsed[CC2_SOURCES_FIELD], levels);
  return {
    ok: true,
    name,
    levels: renumberLevels(levels),
    ...(cc2Sources ? { cc2Sources } : {}),
    ...(limits ? clampPackMetadata(parsed, limits) : {})
  };
}
