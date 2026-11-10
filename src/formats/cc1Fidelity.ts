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

import type { Cc2Divergence } from './cc2ReplayCheck';

/** Pure helpers of the CC1 fidelity report: grouping and ranking of divergence causes. */

const KEY_SEPARATOR = ' / ';
const NO_CAUSE = 'no divergence';
const MONSTER_LABEL = 'monster';
const TILE_LABEL = 'tile';
const UNKNOWN = '?';

/** A level the Lynx engine wins and the Epoxy engine loses. */
export interface FidelityGap {
  path: string;
  divergence: Cc2Divergence | null;
}

export interface BucketCount {
  bucket: string;
  levels: number;
  /** Level paths of the bucket, in input order. */
  paths: string[];
}

/**
 * The bucket of a divergence: its kind, the death reason, and what was involved: the monster that was on or next to
 * the player (nearest first) for a monster death, the terrain under the player for any other death.
 */
export function divergenceBucket(d: Cc2Divergence | null | undefined): string {
  if (!d) return NO_CAUSE;
  const parts: string[] = [d.kind];
  if (d.reasonKey) parts.push(d.reasonKey);
  if (d.kind === 'death') {
    const monster = d.monsters?.[0];
    if (monster) parts.push(`${MONSTER_LABEL} ${monster}`);
    else parts.push(`${TILE_LABEL} ${d.tile ?? UNKNOWN}`);
  }
  return parts.join(KEY_SEPARATOR);
}

/** Groups the gaps by bucket, biggest bucket first (ties by name). */
export function rankBuckets(gaps: readonly FidelityGap[]): BucketCount[] {
  const byBucket = new Map<string, string[]>();
  for (const gap of gaps) {
    const key = divergenceBucket(gap.divergence);
    byBucket.set(key, [...(byBucket.get(key) ?? []), gap.path]);
  }
  return [...byBucket.entries()]
    .map(([bucket, paths]) => ({ bucket, levels: paths.length, paths }))
    .sort((a, b) => b.levels - a.levels || a.bucket.localeCompare(b.bucket));
}

/** Whether Epoxy wins at least as many levels as Lynx. */
export function gatePasses(epoxyWins: number, lynxWins: number): boolean {
  return epoxyWins >= lynxWins;
}

/** How the map of a Steam level compares with the map of the same-numbered .DAT level. */
export type MapClass = 'exact' | 'terrain' | 'differs';

/** The classes in report order. */
export const MAP_CLASSES: readonly MapClass[] = ['exact', 'terrain', 'differs'];

/** The parts of a level the map comparison reads (structural, so a test needs no full level). */
export interface MapLike {
  terrain: unknown;
  items: unknown;
  entities: ReadonlyArray<{ x: number; y: number; type: string; dir?: string }>;
  playerStart: unknown;
  missingStart?: boolean;
}

const SIGNATURE_SEPARATOR = ';';
const FIELD_SEPARATOR = ',';
const DIRT_BLOCK = 'dirt_block';

/** A string that is equal for two levels exactly when their terrain, items, entities and start are equal. */
export function mapSignature(level: MapLike): string {
  const entities = level.entities
    .map((e) => [e.x, e.y, e.type, e.type === DIRT_BLOCK ? '' : (e.dir ?? '')].join(FIELD_SEPARATOR))
    .sort()
    .join(SIGNATURE_SEPARATOR);
  return JSON.stringify([level.terrain, level.items, entities, level.missingStart ? null : level.playerStart]);
}

/** 'exact' when the whole map is equal, 'terrain' when only the terrain is, 'differs' otherwise. */
export function classifyMapPair(a: MapLike, b: MapLike): MapClass {
  if (mapSignature(a) === mapSignature(b)) return 'exact';
  return JSON.stringify(a.terrain) === JSON.stringify(b.terrain) ? 'terrain' : 'differs';
}

const LEVEL_NUMBER_PATTERN = /map(\d+)/i;
const DECIMAL_RADIX = 10;

/** The level number written in a Steam file name ("map012.c2m" gives 12), or null when it has none. */
export function levelNumberOfFile(fileName: string): number | null {
  const match = LEVEL_NUMBER_PATTERN.exec(fileName);
  return match ? Number.parseInt(match[1], DECIMAL_RADIX) : null;
}

/** Whether two level titles are the same once trimmed and compared without case. */
export function titlesMatch(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/** One paired level: whether each source/engine run won. */
export interface PairedOutcome {
  mapClass: MapClass;
  c2mEpoxy: boolean;
  c2mLynx: boolean;
  datEpoxy: boolean;
  datLynx: boolean;
}

/** Win counts per source/engine over a set of paired levels. */
export interface PairedWins {
  levels: number;
  c2mEpoxy: number;
  c2mLynx: number;
  datEpoxy: number;
  datLynx: number;
}

/** Sums the wins of the paired outcomes, optionally only for one map class. */
export function pairedWins(outcomes: readonly PairedOutcome[], mapClass?: MapClass): PairedWins {
  const kept = mapClass ? outcomes.filter((o) => o.mapClass === mapClass) : outcomes;
  return {
    levels: kept.length,
    c2mEpoxy: kept.filter((o) => o.c2mEpoxy).length,
    c2mLynx: kept.filter((o) => o.c2mLynx).length,
    datEpoxy: kept.filter((o) => o.datEpoxy).length,
    datLynx: kept.filter((o) => o.datLynx).length
  };
}
