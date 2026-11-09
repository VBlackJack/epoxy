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
