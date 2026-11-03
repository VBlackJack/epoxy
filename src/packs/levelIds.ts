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

import { LEVEL_ID_SEPARATOR } from '../config/constants';
import { CompiledLevel, LevelPack } from '../core/types';

/**
 * Pure helpers that keep level ids unique across packs. High scores and
 * replays are keyed by level id alone, so two packs sharing an id would share
 * (and overwrite) each other's records.
 */

/** The id of a level scoped to its pack. */
export function scopedLevelId(packId: string, levelId: string): string {
  return `${packId}${LEVEL_ID_SEPARATOR}${levelId}`;
}

/** The levels with every non-empty id prefixed by the pack id. Levels without an id are left for ensureUniqueLevelIds. */
export function scopeLevelIds(levels: readonly CompiledLevel[], packId: string): CompiledLevel[] {
  return levels.map((lvl) =>
    typeof lvl.id === 'string' && lvl.id !== '' ? { ...lvl, id: scopedLevelId(packId, lvl.id) } : lvl
  );
}

export interface LevelIdDedupe {
  /** Every pack, in the input order; unchanged packs are the same objects. */
  readonly packs: LevelPack[];
  /** The packs that got new level ids and must be written again. */
  readonly changed: LevelPack[];
}

/**
 * Gives a level id to its first holder only. "First" is the stored order
 * (IndexedDB getAll sorts by pack id, so the oldest import of a same-named pack wins). Built-in packs keep theirs and
 * are never changed; among the other packs the first in order keeps its ids,
 * and a later pack gets the scoped id for each level whose id is already used.
 * Running it again on its own output changes nothing.
 */
export function dedupeLevelIdsAcrossPacks(
  builtInPacks: readonly LevelPack[],
  storedPacks: readonly LevelPack[]
): LevelIdDedupe {
  const taken = new Set<string>();
  for (const pack of builtInPacks) for (const lvl of pack.levels) taken.add(lvl.id);

  const changed: LevelPack[] = [];
  const packs = storedPacks.map((pack) => {
    const claimed = new Set<string>();
    let touched = false;
    const levels = pack.levels.map((lvl) => {
      let id = lvl.id;
      if (taken.has(id)) {
        let candidate = scopedLevelId(pack.id, id);
        let suffix = 2;
        while (taken.has(candidate) || claimed.has(candidate)) {
          candidate = `${scopedLevelId(pack.id, id)}_${suffix}`;
          suffix += 1;
        }
        id = candidate;
        touched = true;
      }
      claimed.add(id);
      return id === lvl.id ? lvl : { ...lvl, id };
    });
    for (const id of claimed) taken.add(id);
    if (!touched) return pack;
    const renamed = { ...pack, levels };
    changed.push(renamed);
    return renamed;
  });
  return { packs, changed };
}
