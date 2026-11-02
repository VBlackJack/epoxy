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

import { CompiledLevel, LevelPack } from '../core/types';
import { isEditableRuleset } from '../editor/metadataFields';

/**
 * View model of the "My packs" manager: what each row shows and which of its
 * actions are available. Pure, so the rules are tested without a DOM.
 */

/** Engine families a level can belong to; Sokoban is the Epoxy "targets" win rule. */
export type EngineBadge = 'epoxy' | 'lynx' | 'cc3d' | 'sokoban';

/** Order the badges are listed in. */
const BADGE_ORDER: readonly EngineBadge[] = ['epoxy', 'lynx', 'cc3d', 'sokoban'];

/** Translation key of the badge text. */
export function badgeLabelKey(badge: EngineBadge): string {
  return `app.packs.manager.badge.${badge}.label`;
}

/** Badges of a set of levels, each at most once, in a fixed order. */
export function engineBadgesOf(levels: ReadonlyArray<Pick<CompiledLevel, 'ruleset' | 'winRule'>>): EngineBadge[] {
  const found = new Set<EngineBadge>();
  for (const level of levels) {
    found.add(level.ruleset === 'lynx' ? 'lynx' : level.ruleset === 'cc3d' ? 'cc3d' : 'epoxy');
    if (level.winRule === 'targets') found.add('sokoban');
  }
  return BADGE_ORDER.filter((badge) => found.has(badge));
}

/** One pack of the library list. */
export interface LibraryRow {
  id: string;
  label: string;
  levelCount: number;
  badges: EngineBadge[];
  /** True for a pack that was imported rather than created by the player. */
  imported: boolean;
}

/** The library rows: the packs the player created first, then the imported ones, each group in its own order. */
export function buildLibraryRows(packs: readonly LevelPack[], displayName: (pack: LevelPack) => string): LibraryRow[] {
  const toRow = (pack: LevelPack): LibraryRow => ({
    id: pack.id,
    label: displayName(pack),
    levelCount: pack.levels.length,
    badges: engineBadgesOf(pack.levels),
    imported: pack.userCreated !== true
  });
  return [
    ...packs.filter((pack) => pack.userCreated === true).map(toRow),
    ...packs.filter((pack) => pack.userCreated !== true).map(toRow)
  ];
}

/** Which screen the detail column shows. */
export type ManagerState = 'no_packs' | 'empty_pack' | 'pack';

export function managerState(rows: readonly LibraryRow[], selected: LibraryRow | undefined): ManagerState {
  if (rows.length === 0) return 'no_packs';
  return selected && selected.levelCount === 0 ? 'empty_pack' : 'pack';
}

/** The pack to select: the wanted one when it exists, else the first of the list. */
export function resolveSelection(rows: readonly LibraryRow[], wantedId: string | null): string | null {
  if (wantedId !== null && rows.some((row) => row.id === wantedId)) return wantedId;
  return rows[0]?.id ?? null;
}

/** Why a level cannot be opened in the editor; null when it can. */
export const EDIT_BLOCKED_REASON_KEY = 'app.packs.manager.level.edit_blocked.label';

/** One level of the selected pack. */
export interface LevelRow {
  levelId: string;
  number: number;
  title: string;
  badges: EngineBadge[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  canEdit: boolean;
  editBlockedReasonKey: string | null;
}

export function buildLevelRows(
  levels: readonly CompiledLevel[],
  titleOf: (level: CompiledLevel) => string
): LevelRow[] {
  return levels.map((level, index) => {
    const canEdit = isEditableRuleset(level.ruleset);
    return {
      levelId: level.id,
      number: index + 1,
      title: titleOf(level),
      badges: engineBadgesOf([level]),
      canMoveUp: index > 0,
      canMoveDown: index < levels.length - 1,
      canEdit,
      editBlockedReasonKey: canEdit ? null : EDIT_BLOCKED_REASON_KEY
    };
  });
}

/** Buttons of the pack header. */
export interface PackActions {
  canPlay: boolean;
  canExportJson: boolean;
  canExportCcl: boolean;
}

export function buildPackActions(
  levels: readonly CompiledLevel[],
  isCclExportable: (level: CompiledLevel) => boolean
): PackActions {
  return {
    canPlay: levels.length > 0,
    canExportJson: levels.length > 0,
    canExportCcl: levels.some(isCclExportable)
  };
}

/** A pack a level can be copied or moved to. */
export interface TransferTarget {
  id: string;
  label: string;
}

/** Every pack of the library but the one the level is in. */
export function transferTargets(rows: readonly LibraryRow[], currentPackId: string): TransferTarget[] {
  return rows.filter((row) => row.id !== currentPackId).map((row) => ({ id: row.id, label: row.label }));
}

/** The pack to select once `removedId` is gone: the one that took its place, else the one before. */
export function selectionAfterRemoval(rows: readonly LibraryRow[], removedId: string): string | null {
  const index = rows.findIndex((row) => row.id === removedId);
  if (index < 0) return rows[0]?.id ?? null;
  const rest = rows.filter((row) => row.id !== removedId);
  return rest[Math.min(index, rest.length - 1)]?.id ?? null;
}

/** Level to focus after a move, so focus follows the row the player moved. */
export function movedLevelIndex(index: number, direction: 'up' | 'down'): number {
  return direction === 'up' ? index - 1 : index + 1;
}
