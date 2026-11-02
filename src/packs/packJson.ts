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

import { PACK_JSON_FORMAT, PACK_JSON_VERSION } from '../config/constants';
import {
  ensureUniqueLevelIds,
  isRecord,
  LevelSizeBounds,
  sanitizeStoredLevels
} from '../config/ConfigValidation';
import { CompiledLevel } from '../core/types';
import { Clock, generateLevelId, normalizePackName, renumberLevels } from './userPacks';

/** Why a pack file was refused. */
export type PackJsonError = 'malformed' | 'format' | 'version' | 'name' | 'no_levels';

export type PackJsonResult =
  | { ok: true; name: string; levels: CompiledLevel[] }
  | { ok: false; error: PackJsonError };

/** The pack file: a format marker, a version, the pack name and its levels as stored. */
export interface PackJsonFile {
  format: typeof PACK_JSON_FORMAT;
  version: number;
  name: string;
  levels: CompiledLevel[];
}

/** Serialises a pack to the exchange format. Levels are written whole, whatever their ruleset. */
export function serializePack(name: string, levels: readonly CompiledLevel[]): string {
  const file: PackJsonFile = { format: PACK_JSON_FORMAT, version: PACK_JSON_VERSION, name, levels: [...levels] };
  return JSON.stringify(file, null, 2);
}

/**
 * Reads a pack file. Levels go through the same validation as stored levels
 * (size bounds included); the ones that fail are dropped, and the file is
 * refused when none is left. Level ids are made unique inside the pack, then
 * re-issued for the ones the library already holds (`takenLevelIds`).
 */
export function parsePackJson(
  text: string,
  bounds: LevelSizeBounds,
  takenLevelIds: ReadonlySet<string>,
  now: Clock = Date.now
): PackJsonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (!isRecord(parsed) || parsed.format !== PACK_JSON_FORMAT) return { ok: false, error: 'format' };
  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > PACK_JSON_VERSION) {
    return { ok: false, error: 'version' };
  }
  const name = typeof parsed.name === 'string' ? normalizePackName(parsed.name) : '';
  if (name === '') return { ok: false, error: 'name' };
  if (!Array.isArray(parsed.levels)) return { ok: false, error: 'malformed' };
  const valid = sanitizeStoredLevels(parsed.levels, bounds);
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
  return { ok: true, name, levels: renumberLevels(levels) };
}
