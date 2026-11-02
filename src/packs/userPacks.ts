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

import { CUSTOM_PACK_FALLBACK_NAME, PACK_NAME_MAX_LENGTH, USER_PACK_ID_PREFIX } from '../config/constants';
import { ensureUniqueLevelIds } from '../config/ConfigValidation';
import { CompiledLevel, LevelPack } from '../core/types';
import { CUSTOM_LEVEL_ID_PREFIX } from '../ui/uiConstants';

/**
 * Pure, immutable operations on the packs a player creates. Nothing here
 * touches storage or the registry: every function returns new packs, and
 * renumbers their levels 1..n so the order on screen is the order stored.
 */

/** Source of the current time; injected so ids are reproducible in tests. */
export type Clock = () => number;

/** Trimmed pack name cut to the longest length kept; empty when nothing usable is left. */
export function normalizePackName(name: string): string {
  return name.trim().slice(0, PACK_NAME_MAX_LENGTH).trim();
}

/** The levels with `number` set to their 1-based position. Unchanged levels are reused. */
export function renumberLevels(levels: readonly CompiledLevel[]): CompiledLevel[] {
  return levels.map((lvl, index) => (lvl.number === index + 1 ? lvl : { ...lvl, number: index + 1 }));
}

function withLevels(pack: LevelPack, levels: readonly CompiledLevel[]): LevelPack {
  return { ...pack, levels: renumberLevels(levels) };
}

/** First `<prefix><timestamp>` id that is not in `taken`. */
function freshId(prefix: string, taken: ReadonlySet<string>, now: Clock): string {
  let stamp = now();
  while (taken.has(`${prefix}${stamp}`)) stamp += 1;
  return `${prefix}${stamp}`;
}

/** A new pack id that is not in `takenPackIds`. */
export function generatePackId(takenPackIds: ReadonlySet<string>, now: Clock = Date.now): string {
  return freshId(USER_PACK_ID_PREFIX, takenPackIds, now);
}

/** A new level id (`custom_<timestamp>`) that is not in `takenLevelIds`, the ids of every pack. */
export function generateLevelId(takenLevelIds: ReadonlySet<string>, now: Clock = Date.now): string {
  return freshId(CUSTOM_LEVEL_ID_PREFIX, takenLevelIds, now);
}

/** An empty pack the player owns. Returns null when the name is blank. */
export function createUserPack(
  name: string,
  takenPackIds: ReadonlySet<string>,
  now: Clock = Date.now
): LevelPack | null {
  const clean = normalizePackName(name);
  if (clean === '') return null;
  return { id: generatePackId(takenPackIds, now), name: clean, builtIn: false, userCreated: true, levels: [] };
}

/** An empty pack under a fixed id, labelled by its i18n key until renamed. */
export function createLabelledPack(id: string, i18nKey: string): LevelPack {
  return { id, name: CUSTOM_PACK_FALLBACK_NAME, i18nKey, builtIn: false, userCreated: true, levels: [] };
}

/** The pack under a new name; the i18n label no longer applies. Null when the name is blank. */
export function renamePack(pack: LevelPack, name: string): LevelPack | null {
  const clean = normalizePackName(name);
  if (clean === '') return null;
  const { i18nKey: _label, ...rest } = pack;
  return { ...rest, name: clean };
}

/** Appends a level. */
export function addLevel(pack: LevelPack, level: CompiledLevel): LevelPack {
  return withLevels(pack, [...pack.levels, level]);
}

/** Replaces the level holding the same id, in place. The pack is returned as is when none does. */
export function updateLevel(pack: LevelPack, level: CompiledLevel): LevelPack {
  const index = pack.levels.findIndex((l) => l.id === level.id);
  if (index < 0) return pack;
  const levels = pack.levels.slice();
  levels[index] = level;
  return withLevels(pack, levels);
}

/** Updates the level when the pack holds its id, appends it otherwise. */
export function upsertLevel(pack: LevelPack, level: CompiledLevel): LevelPack {
  return pack.levels.some((l) => l.id === level.id) ? updateLevel(pack, level) : addLevel(pack, level);
}

/** Removes the level with this id. */
export function removeLevel(pack: LevelPack, levelId: string): LevelPack {
  return withLevels(
    pack,
    pack.levels.filter((l) => l.id !== levelId)
  );
}

/** Moves the level at `from` so it ends up at `to`; out-of-range indexes leave the pack as is. */
export function moveLevel(pack: LevelPack, from: number, to: number): LevelPack {
  const last = pack.levels.length - 1;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > last || to < 0 || to > last) {
    return pack;
  }
  if (from === to) return pack;
  const levels = pack.levels.slice();
  const [moved] = levels.splice(from, 1);
  levels.splice(to, 0, moved);
  return withLevels(pack, levels);
}

/** Moves a level one place earlier. */
export function moveLevelUp(pack: LevelPack, levelId: string): LevelPack {
  const index = pack.levels.findIndex((l) => l.id === levelId);
  return index < 0 ? pack : moveLevel(pack, index, index - 1);
}

/** Moves a level one place later. */
export function moveLevelDown(pack: LevelPack, levelId: string): LevelPack {
  const index = pack.levels.findIndex((l) => l.id === levelId);
  return index < 0 ? pack : moveLevel(pack, index, index + 1);
}

/** Inserts a copy of the level right after it, under `newId`. Null when the level is missing. */
export function duplicateLevel(pack: LevelPack, levelId: string, newId: string): LevelPack | null {
  const index = pack.levels.findIndex((l) => l.id === levelId);
  if (index < 0) return null;
  const levels = pack.levels.slice();
  levels.splice(index + 1, 0, { ...structuredClone(pack.levels[index]), id: newId });
  return withLevels(pack, levels);
}

/** Appends a copy of a level of `source` to `destination`, under `newId`. Null when the level is missing. */
export function copyLevelToPack(
  source: LevelPack,
  levelId: string,
  destination: LevelPack,
  newId: string
): LevelPack | null {
  const original = source.levels.find((l) => l.id === levelId);
  if (!original) return null;
  return addLevel(destination, { ...structuredClone(original), id: newId });
}

/**
 * Moves a level from one pack to another. It keeps its id unless the
 * destination already holds it; then it takes the suffix `ensureUniqueLevelIds`
 * gives a repeated id. Null when the level is missing.
 */
export function moveLevelToPack(
  source: LevelPack,
  levelId: string,
  destination: LevelPack
): { source: LevelPack; destination: LevelPack } | null {
  const moved = source.levels.find((l) => l.id === levelId);
  if (!moved) return null;
  const merged = ensureUniqueLevelIds([...destination.levels, moved], destination.id);
  return {
    source: removeLevel(source, levelId),
    destination: withLevels(destination, merged)
  };
}
