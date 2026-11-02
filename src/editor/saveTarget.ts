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

import { DEFAULT_LEVEL_PASSWORD } from '../config/constants';
import { DEFAULT_RULESET, DEFAULT_WIN_RULE } from '../core/coreConstants';
import { CompiledLevel } from '../core/types';
import { packUsesPasswords } from '../ui/packPasswords';
import { KeyChord } from '../ui/inputGuards';
import { EDITOR_DEFAULT_PASSWORD } from '../ui/uiConstants';

/**
 * Pure decisions behind the editor's save flow: where a level goes, what it
 * keeps from the level it was opened from, and whether it invalidates records.
 * Nothing here touches the registry, the DOM or storage.
 */

/** Where the editor content comes from; both null for a blank map or a file. */
export interface SaveSource {
  packId: string | null;
  levelId: string | null;
}

export const NO_SOURCE: SaveSource = { packId: null, levelId: null };

/** The pack fields the save decision reads. */
export interface PackRef {
  id: string;
  /** True for a pack the player created; absent on an imported one. */
  userCreated?: boolean;
}

export type SaveDecision =
  /** The source pack is editable: update the level there. */
  | { kind: 'in_place'; packId: string }
  /** The source pack is an imported one not yet confirmed this session. */
  | { kind: 'confirm_imported'; packId: string }
  /** No editable source (or a copy was asked): the player picks the destination. */
  | { kind: 'choose_pack' };

export interface SaveDecisionInput {
  source: SaveSource;
  editablePacks: readonly PackRef[];
  /** Imported packs the player already agreed to modify this session. */
  confirmedImportedPackIds: ReadonlySet<string>;
  /** "Save a copy": always choose a destination. */
  forceCopy: boolean;
}

/** True when saving into this pack first needs the "modify an imported pack" confirmation. */
export function needsImportedConfirmation(
  pack: PackRef | undefined,
  confirmedImportedPackIds: ReadonlySet<string>
): boolean {
  return pack !== undefined && pack.userCreated !== true && !confirmedImportedPackIds.has(pack.id);
}

/** Decides how a save proceeds. */
export function decideSave(input: SaveDecisionInput): SaveDecision {
  if (input.forceCopy) return { kind: 'choose_pack' };
  const pack = input.editablePacks.find((p) => p.id === input.source.packId);
  if (!pack) return { kind: 'choose_pack' };
  return needsImportedConfirmation(pack, input.confirmedImportedPackIds)
    ? { kind: 'confirm_imported', packId: pack.id }
    : { kind: 'in_place', packId: pack.id };
}

/**
 * Pack preselected in the "Save into" dialog: the last destination while it
 * still exists, else the first pack the player created, else none (the dialog
 * then proposes a new pack).
 */
export function pickSaveDestination(packs: readonly PackRef[], lastDestinationId: string | null): string | null {
  if (lastDestinationId !== null && packs.some((p) => p.id === lastDestinationId)) return lastDestinationId;
  return packs.find((p) => p.userCreated === true)?.id ?? null;
}

/** Texts shown in the title and hint fields when a level was opened. */
export interface LoadedTexts {
  title: string;
  hint: string;
}

/** Stable text for a value: object keys sorted, so key order never makes two equal values differ. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A list compared as a set: the order of entities and links carries no meaning. */
function unordered(values: readonly unknown[]): string {
  return values.map(canonical).sort().join('|');
}

/** What makes two levels play differently: the board, the start, the objective and the rules. */
function playfieldSignature(level: CompiledLevel): string {
  return [
    canonical(level.terrain),
    canonical(level.items),
    unordered(level.entities),
    unordered(level.trapLinks),
    unordered(level.cloneLinks),
    canonical(level.playerStart),
    level.winRule ?? DEFAULT_WIN_RULE,
    level.ruleset ?? DEFAULT_RULESET,
    String(level.chipsRequired)
  ].join('#');
}

/** True when the board, start, objective or rules differ; titles, hints and the time limit do not count. */
export function levelMapChanged(before: CompiledLevel, after: CompiledLevel): boolean {
  return playfieldSignature(before) !== playfieldSignature(after);
}

/** A level ready to store, and whether its map differs from the level it was opened from. */
export interface PreparedLevel {
  level: CompiledLevel;
  mapChanged: boolean;
}

/**
 * Completes what the editor produced with what it must not lose from the level
 * it was opened from: the theme always, the title and hint keys while their
 * text is untouched (so they keep following the language), the solution while
 * the map is untouched.
 */
export function prepareLevelForSave(
  draft: CompiledLevel,
  original: CompiledLevel | null,
  loadedTexts: LoadedTexts | null
): PreparedLevel {
  if (!original) return { level: draft, mapChanged: false };
  const mapChanged = levelMapChanged(original, draft);
  const level: CompiledLevel = { ...draft };
  if (original.theme !== undefined) level.theme = original.theme;
  if (original.solution !== undefined && !mapChanged) level.solution = original.solution;
  if (loadedTexts && original.titleKey !== undefined && draft.customTitle === loadedTexts.title) {
    level.titleKey = original.titleKey;
    delete level.customTitle;
  }
  if (loadedTexts && original.hintKey !== undefined && (draft.customHint ?? '') === loadedTexts.hint) {
    level.hintKey = original.hintKey;
    delete level.customHint;
  }
  return { level, mapChanged };
}

/**
 * Password stored with a level. A typed one wins; an empty field gives the
 * shared default, except in a pack that uses codes, where it gives a code the
 * player can edit afterwards.
 */
export function resolveSavedPassword(typed: string, targetLevels: ReadonlyArray<{ password: string }>): string {
  const clean = typed.trim();
  if (clean !== '') return clean;
  return packUsesPasswords(targetLevels) ? EDITOR_DEFAULT_PASSWORD : DEFAULT_LEVEL_PASSWORD;
}

/** Index of the nearest level the editor can open, stepping by `step` from `from`; -1 when none. */
export function nextEditableIndex(
  levels: ReadonlyArray<{ ruleset?: string }>,
  from: number,
  step: 1 | -1
): number {
  for (let i = from + step; i >= 0 && i < levels.length; i += step) {
    if (levels[i].ruleset !== 'cc3d') return i;
  }
  return -1;
}

/** Key letter of the save chord. */
const SAVE_KEY = 's';
const SAVE_CODE = 'KeyS';
const SINGLE_ASCII_LETTER = /^[a-z]$/i;

/**
 * Ctrl or Meta with S, without Alt. It follows the produced character (AZERTY
 * included), and the physical key on a layout whose key is not a Latin letter.
 */
export function isSaveChord(chord: KeyChord): boolean {
  if (!(chord.ctrlKey || chord.metaKey) || chord.altKey) return false;
  if (chord.key.toLowerCase() === SAVE_KEY) return true;
  return !SINGLE_ASCII_LETTER.test(chord.key) && chord.code === SAVE_CODE;
}
