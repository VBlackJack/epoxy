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

import { SIGNAL_GATE_CC2_ID_SUFFIX } from '../core/coreConstants';
import type { TileDefinition } from '../core/types';

/** Names of the variant families, read from the tile configs: a family is a set of tiles that differ by one field. */
export const VARIANT_FAMILY = {
  /** A no sign on the item layer: one tile per forbidden item (forbiddenItem). */
  noSign: 'no_sign',
  /** A counter gate: one tile per starting value (signalCounterStart). */
  signalCounter: 'signal_counter',
  /** A counter gate of the Chip's Challenge 2 set (id suffix _cc2): its own family, apart from the native counters. */
  signalCounterCc2: 'signal_counter_cc2',
  /** A swivel door: one tile per pair of closed sides (swivelTurns). */
  swivel: 'swivel',
  /** A swivel door that follows the Chip's Challenge 2 rule (swivelRule cc2). */
  swivelCc2: 'swivel_cc2',
  /** A toggle switch and its twin (signalToggleTwin): the off and on forms. */
  toggleSwitch: 'toggle_switch'
} as const;

/** The family a tile belongs to, decided from its config fields alone; null when it stands on its own. */
export function variantFamilyOf(tile: TileDefinition): string | null {
  if (tile.layer === 'item' && tile.forbiddenItem !== undefined) return VARIANT_FAMILY.noSign;
  if (tile.signalCounterStart !== undefined) {
    return tile.id.endsWith(SIGNAL_GATE_CC2_ID_SUFFIX) ? VARIANT_FAMILY.signalCounterCc2 : VARIANT_FAMILY.signalCounter;
  }
  if (tile.swivelTurns !== undefined) return tile.swivelRule === 'cc2' ? VARIANT_FAMILY.swivelCc2 : VARIANT_FAMILY.swivel;
  if (tile.signalToggleTwin !== undefined) return VARIANT_FAMILY.toggleSwitch;
  return null;
}

/** The tiles of one family and category, in config order. */
export function familyMembers(tiles: Readonly<Record<string, TileDefinition>>, family: string, category: string): TileDefinition[] {
  return Object.values(tiles).filter((tile) => tile.category === category && tile.litCharge !== true && variantFamilyOf(tile) === family);
}

/** The palette key shared by every variant of a family in a category. */
export function familyKey(category: string, family: string): string {
  return `${category}:${family}`;
}

/**
 * The tiles of a category that get a palette button: one per family (placed where its first member is, and showing
 * the chosen variant, else that first member) and one per standalone tile. The chosen variant of each family is read
 * from the choices map, keyed by familyKey, which the caller keeps up to date.
 */
export function paletteTilesOf(tiles: readonly TileDefinition[], category: string, chosen: ReadonlyMap<string, string>): TileDefinition[] {
  const byFamily = new Map<string, TileDefinition[]>();
  for (const tile of tiles) {
    const family = variantFamilyOf(tile);
    if (family === null) continue;
    const key = familyKey(category, family);
    byFamily.set(key, [...(byFamily.get(key) ?? []), tile]);
  }
  const shown: TileDefinition[] = [];
  const seen = new Set<string>();
  for (const tile of tiles) {
    const family = variantFamilyOf(tile);
    if (family === null) {
      shown.push(tile);
      continue;
    }
    const key = familyKey(category, family);
    if (seen.has(key)) continue;
    seen.add(key);
    const members = byFamily.get(key) ?? [tile];
    shown.push(members.find((member) => member.id === chosen.get(key)) ?? members[0]);
  }
  return shown;
}
