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

import type { CompiledLevel } from '../core/types';
import { canonicalJson } from './canonicalJson';
import { displayLayersOf } from './editorDocument';

/**
 * The editor's autosaved draft: what is written to storage while the level has unsaved changes, and the
 * decision about what to do with it when a page finds one. Pure: no storage, no DOM, no clock.
 * Levels carry no timestamp, so the draft is compared with its source by fingerprint, never by time.
 */

/** Version of the stored format; a draft of another version is dropped. */
export const DRAFT_VERSION = 1;

/** Hex digits of a fingerprint's two halves. */
const FINGERPRINT_RADIX = 16;
/** Seeds and multipliers of the 53-bit string hash. */
const HASH_SEED_A = 0xdeadbeef;
const HASH_SEED_B = 0x41c6ce57;
const HASH_MULTIPLIER_A = 2654435761;
const HASH_MULTIPLIER_B = 1597334677;
const HASH_MIX_A = 2246822507;
const HASH_MIX_B = 3266489909;
const HASH_SHIFT_HIGH = 16;
const HASH_SHIFT_LOW = 13;
const HASH_HIGH_BITS_FACTOR = 4294967296;
const HASH_HIGH_BITS_MASK = 2097151;

/** Pack and level an editor session was opened from; both null for a blank map or a file. */
export interface DraftSource {
  packId: string | null;
  levelId: string | null;
}

export interface EditorDraft {
  v: typeof DRAFT_VERSION;
  /** Random id of the page that wrote it, to tell its own draft from another tab's. */
  tabId: string;
  /** Epoch milliseconds of the write; informational, never used to compare. */
  writtenAt: number;
  source: DraftSource;
  currentLevelId: string;
  /** Fingerprint of the source level as it was loaded or last saved ('' when it was never stored). */
  baseHash: string;
  level: CompiledLevel;
}

export type DraftParseResult =
  | { ok: true; draft: EditorDraft }
  | { ok: false; reason: 'too_large' | 'malformed' | 'version' | 'shape' };

export type DraftSerializeResult = { ok: true; text: string } | { ok: false; reason: 'too_large' };

/** What a page does with the draft it found. */
export type DraftOffer =
  /** There is no draft. */
  | 'none'
  /** The draft holds exactly the source level: nothing to recover. */
  | 'identical'
  /** The source is unchanged since the draft started from it: restore on top of it. */
  | 'restore'
  /** The source changed since the draft started from it: restore with a warning. */
  | 'conflict'
  /** The source level no longer exists (or the draft never had one): restore as a new unsaved level. */
  | 'orphan';

/** A short, stable fingerprint of a text (53-bit string hash, hex). Not a security hash. */
export function fingerprint(text: string): string {
  let h1 = HASH_SEED_A;
  let h2 = HASH_SEED_B;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, HASH_MULTIPLIER_A);
    h2 = Math.imul(h2 ^ code, HASH_MULTIPLIER_B);
  }
  h1 = Math.imul(h1 ^ (h1 >>> HASH_SHIFT_HIGH), HASH_MIX_A) ^ Math.imul(h2 ^ (h2 >>> HASH_SHIFT_LOW), HASH_MIX_B);
  h2 = Math.imul(h2 ^ (h2 >>> HASH_SHIFT_HIGH), HASH_MIX_A) ^ Math.imul(h1 ^ (h1 >>> HASH_SHIFT_LOW), HASH_MIX_B);
  const value = HASH_HIGH_BITS_FACTOR * (HASH_HIGH_BITS_MASK & h2) + (h1 >>> 0);
  return value.toString(FINGERPRINT_RADIX);
}

/** Fingerprint of a level, independent of key order. */
export function levelFingerprint(level: CompiledLevel): string {
  return fingerprint(canonicalJson(level));
}

/**
 * The level as a draft stores it. A CC3D level keeps its cc3d data and drops the display layers derived from
 * it, which are a large share of its size and are rebuilt by `hydrateDraftLevel`.
 */
export function draftLevelOf(level: CompiledLevel): CompiledLevel {
  return level.cc3d ? { ...level, terrain: [], items: [], entities: [] } : level;
}

/** The inverse of `draftLevelOf`: a CC3D level gets its display layers back. */
export function hydrateDraftLevel(level: CompiledLevel): CompiledLevel {
  return level.cc3d ? { ...level, ...displayLayersOf(level.cc3d) } : level;
}

/** The text to store, or why it must not be stored: past `maxChars` the draft is skipped. */
export function serializeDraft(draft: EditorDraft, maxChars: number): DraftSerializeResult {
  const text = JSON.stringify(draft);
  return text.length > maxChars ? { ok: false, reason: 'too_large' } : { ok: true, text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Reads a stored draft; anything that is not a well-formed draft of this version is refused with the reason. */
export function parseDraft(text: string, maxChars: number): DraftParseResult {
  if (text.length > maxChars) return { ok: false, reason: 'too_large' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isRecord(value)) return { ok: false, reason: 'malformed' };
  if (value.v !== DRAFT_VERSION) return { ok: false, reason: 'version' };
  const source = value.source;
  const wellFormed =
    typeof value.tabId === 'string' &&
    typeof value.writtenAt === 'number' &&
    Number.isFinite(value.writtenAt) &&
    isRecord(source) &&
    isNullableString(source.packId) &&
    isNullableString(source.levelId) &&
    typeof value.currentLevelId === 'string' &&
    typeof value.baseHash === 'string' &&
    isRecord(value.level);
  return wellFormed ? { ok: true, draft: value as unknown as EditorDraft } : { ok: false, reason: 'shape' };
}

/** Decides what to do with a draft given the level it started from, as the library holds it now. */
export function draftOffer(draft: EditorDraft | null, sourceLevel: CompiledLevel | undefined): DraftOffer {
  if (!draft) return 'none';
  if (!sourceLevel) return 'orphan';
  if (canonicalJson(draft.level) === canonicalJson(draftLevelOf(sourceLevel))) return 'identical';
  return levelFingerprint(sourceLevel) === draft.baseHash ? 'restore' : 'conflict';
}
