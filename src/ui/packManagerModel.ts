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
import { isUserOwnedPack } from '../editor/saveTarget';

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
  /** Credit line of the pack, when it has one. */
  author?: string;
}

/** The library rows: the packs the player created first, then the imported ones, each group in its own order. */
export function buildLibraryRows(packs: readonly LevelPack[], displayName: (pack: LevelPack) => string): LibraryRow[] {
  const toRow = (pack: LevelPack): LibraryRow => ({
    id: pack.id,
    label: displayName(pack),
    levelCount: pack.levels.length,
    badges: engineBadgesOf(pack.levels),
    imported: !isUserOwnedPack(pack),
    ...(pack.author ? { author: pack.author } : {})
  });
  return [
    ...packs.filter(isUserOwnedPack).map(toRow),
    ...packs.filter((pack) => !isUserOwnedPack(pack)).map(toRow)
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
  /** True for a CC3D level that holds its cell data, which the converter turns into a native Epoxy level. */
  canConvert: boolean;
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
      editBlockedReasonKey: canEdit ? null : EDIT_BLOCKED_REASON_KEY,
      canConvert: level.ruleset === 'cc3d' && level.cc3d !== undefined
    };
  });
}

/** Added to the title of a converted copy, in every language. */
export const CONVERTED_TITLE_SUFFIX = ' (Epoxy)';

/** The longest prefix of `text` that fits `maxUnits` UTF-16 units (the unit the stored limit counts) without splitting a character. */
function fitUnits(text: string, maxUnits: number): string {
  let out = '';
  for (const char of text) {
    if (out.length + char.length > maxUnits) break;
    out += char;
  }
  return out;
}

/**
 * Title of the Epoxy copy of a level: the base name followed by the suffix, the base cut so the whole
 * title fits `maxLength`. A limit too small for the suffix cuts the suffix too.
 */
export function convertedTitle(baseTitle: string, maxLength: number): string {
  const base = fitUnits(baseTitle.trim(), Math.max(0, maxLength - CONVERTED_TITLE_SUFFIX.length)).trimEnd();
  return fitUnits(`${base}${CONVERTED_TITLE_SUFFIX}`, Math.max(0, maxLength));
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

/** Why a pack cannot be shared: it holds no level yet, or it holds levels imported from CC2 (licensed content). */
export type ShareRefusal = 'empty' | 'cc2_content';

/** Translation key of the message that tells why a pack cannot be shared, by refusal. */
export const SHARE_REFUSAL_KEYS: Record<ShareRefusal, string> = {
  empty: 'app.packs.share.empty.label',
  cc2_content: 'app.packs.share.cc2.label'
};

/** The reason a pack cannot be shared, or null when it can: it must hold a level and none imported from CC2. */
export function shareRefusal(levels: readonly Pick<CompiledLevel, 'cc2'>[]): ShareRefusal | null {
  if (levels.length === 0) return 'empty';
  return levels.some((level) => level.cc2 !== undefined) ? 'cc2_content' : null;
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

const FILE_NAME_SEPARATOR = '_';
const PACK_FILE_EXTENSION = '.json';
const NON_FILE_NAME_CHARACTERS = /[^a-z0-9]+/g;
const COMBINING_MARKS = new RegExp('[\u0300-\u036f]', 'g');

/**
 * File name of an exported pack: its name reduced to lower case letters and
 * digits joined by underscores, `fallback` when nothing is left.
 */
export function packFileName(name: string, fallback: string): string {
  const slug = (value: string): string =>
    value
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .toLowerCase()
      .replace(NON_FILE_NAME_CHARACTERS, FILE_NAME_SEPARATOR)
      .replace(/^_+|_+$/g, '');
  return `${slug(name) || slug(fallback) || 'pack'}${PACK_FILE_EXTENSION}`;
}

/**
 * Insertion slot (0..n) a pointer at `pointerY` points at, given the vertical
 * midpoint of each of the n rows, top to bottom: the pointer sits before the
 * first row whose midpoint is below it.
 */
export function dropSlotAt(pointerY: number, rowMidpoints: readonly number[]): number {
  return rowMidpoints.filter((mid) => mid < pointerY).length;
}

/** Index the dragged row ends up at when dropped in `slot`; the row's own removal shifts later slots by one. */
export function dropTargetIndex(fromIndex: number, slot: number): number {
  return slot > fromIndex ? slot - 1 : slot;
}
