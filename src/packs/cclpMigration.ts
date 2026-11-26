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

import { CC1_DAT_RULES_PROFILE, CC1_DAT_RULESET } from '../config/constants';
import type { CompiledLevel, EntityPlacement, LevelPack } from '../core/types';

/**
 * Packs a player imported from a .DAT file before community sets played the CCLP engine hold one of two older readings:
 * the classic Epoxy reading (`rulesFlavor 'cc'`, builds 2.29 to 2.43) or the plain Lynx reading (`ruleset 'lynx'` with no
 * profile, builds 2.10 to 2.28). This module decides, pack by pack, whether a stored pack can move, exactly, to the reading a
 * fresh import gives today, and builds the moved pack. A pack moves whole or not at all, so its levels keep one set of rules.
 *
 * Leaf module (types and constants only), so ConfigRegistry can call it without an import cycle: what needs the configs
 * comes in through CclpMoveContext.
 */

/** The block the classic reading faces S when the .DAT code is the plain block; the Lynx reading faces it N. */
const BLOCK_ENTITY_TYPE = 'dirt_block';
const CLASSIC_PLAIN_BLOCK_DIR = 'S';
const LYNX_PLAIN_BLOCK_DIR = 'N';

/** The key a .DAT decoder writes last on a plain Lynx reading (DatCodec sets it after the level record is built). */
const LYNX_LAST_KEY = 'ruleset';

/** The id a .DAT decoder gives a level: `<prefix>_level_<number>`, then the scoping and dedupe suffixes. */
const DAT_LEVEL_ID = /_level_(\d+)(?:_\d+)*$/;
/** The import stamp at the end of a pack id (`pack_<name>_<Date.now()>`). */
const PACK_ID_STAMP = /_(\d+)$/;

/** Every key a .DAT decoder writes on a level. A stored level with any other key was changed by the player. */
const DAT_RECORD_KEYS: ReadonlySet<string> = new Set([
  'id',
  'number',
  'customTitle',
  'customHint',
  'author',
  'password',
  'timeLimitSeconds',
  'chipsRequired',
  'playerStart',
  'missingStart',
  'terrain',
  'items',
  'entities',
  'trapLinks',
  'cloneLinks',
  'underlays',
  'rulesFlavor',
  'ruleset'
]);

/** Keys left out when a stored level is compared with a reference: the identity the import gave, and the reading marker. */
const IDENTITY_KEYS: ReadonlySet<string> = new Set(['id', 'number', 'rulesFlavor', 'ruleset', 'rulesProfile']);

/** A .DAT set the app holds the bytes of (a bundled pack), read both ways. */
export interface CclpReferenceSet {
  /** Password signature of the set. */
  readonly signature: string;
  /** The classic reading of the bytes (what an import made in 2.29 to 2.43). */
  readonly classic: readonly CompiledLevel[];
  /** The reading a fresh import gives today: Lynx, with the CCLP rules. */
  readonly lynx: readonly CompiledLevel[];
}

export interface CclpMoveContext {
  /** True for the clone machine tile. */
  readonly isCloneMachine: (terrainId: string) => boolean;
  /** The .DAT map size: every level a .DAT import gives has it. */
  readonly mapWidth: number;
  readonly mapHeight: number;
  /** Password signature of a level set. */
  readonly passwordSignature: (levels: readonly CompiledLevel[]) => Promise<string>;
  /** The signatures of the official Chip's Challenge 1 sets, which keep their engine. */
  readonly officialSignatures: readonly string[];
  /** The sets the app holds the bytes of; asked for only when a stored pack is a candidate. */
  readonly references: () => Promise<readonly CclpReferenceSet[]>;
  /**
   * Imports stamped at or after this time (ms) were made by a build whose .DAT imports already play the CCLP engine: such a
   * record is not an old import, so the record-only checks never vouch for it.
   */
  readonly oldImportCutoffMs: number;
}

/** Why a stored pack was left as it is; `moved` when it now plays the CCLP engine. */
export type CclpMoveVerdict =
  /** Not a .DAT import (a pack the player made, a shared pack, a pack of another source): nothing to say. */
  | 'not_dat'
  /** Some levels look like .DAT levels and others do not (a CC2 pack with an edited level, a mixed pack): nothing to say. */
  | 'mixed'
  /** An official Chip's Challenge 1 set: it keeps its engine. */
  | 'official'
  /** A .DAT pack the player changed, or whose bundled file changed since: it stays, and the player is told once. */
  | 'changed'
  /** A classic .DAT pack of a set the app does not hold the bytes of: it stays, and the player is told once. */
  | 'unknown'
  | 'moved';

/** True for a verdict the player is told about once (a .DAT pack that keeps its old rules). */
export function isKeptVerdict(verdict: CclpMoveVerdict): boolean {
  return verdict === 'changed' || verdict === 'unknown';
}

export interface CclpPackMove {
  readonly verdict: CclpMoveVerdict;
  /** The moved pack (same id, same level ids); the stored pack itself for every other verdict. */
  readonly pack: LevelPack;
  /** The levels moved: the whole pack or none. */
  readonly moved: number;
}

/** What the load-time move did, and the .DAT packs that keep their old rules. */
export interface CclpMoveReport {
  readonly movedPacks: number;
  readonly keptPackIds: readonly string[];
}

/** What a finished move leaves in storage: the version it ran at and the packs it kept. */
export interface CclpMoveRecord {
  readonly version: number;
  readonly kept: readonly string[];
}

/** The stored move record, or null when there is none or it is malformed. */
export function parseCclpMoveRecord(raw: string | null): CclpMoveRecord | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object') return null;
    const { version, kept } = value as { version?: unknown; kept?: unknown };
    if (typeof version !== 'number' || !Array.isArray(kept)) return null;
    return { version, kept: kept.filter((id): id is string => typeof id === 'string') };
  } catch {
    return null;
  }
}

/** The pack ids a stored notice list holds; anything malformed reads as none. */
export function parseNoticedPackIds(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** A stored level in the classic reading of a .DAT import: classic rules, no CC2 record, no CC3D data, the .DAT map size. */
export function isStoredClassicDatLevel(level: CompiledLevel, ctx: Pick<CclpMoveContext, 'mapWidth' | 'mapHeight'>): boolean {
  if (level.rulesFlavor !== 'cc' || level.cc2 !== undefined || level.cc3d !== undefined || level.cc3dSource !== undefined) return false;
  if (level.ruleset !== undefined && level.ruleset !== 'epoxy') return false;
  return hasMapSize(level, ctx);
}

/** A stored level in the plain Lynx reading of a .DAT import (no rule profile), at the .DAT map size. */
export function isStoredPlainLynxDatLevel(level: CompiledLevel, ctx: Pick<CclpMoveContext, 'mapWidth' | 'mapHeight'>): boolean {
  if (level.ruleset !== CC1_DAT_RULESET || level.rulesProfile !== undefined || level.rulesFlavor !== undefined) return false;
  if (level.cc2 !== undefined || level.cc3d !== undefined || level.cc3dSource !== undefined) return false;
  return hasMapSize(level, ctx);
}

function hasMapSize(level: CompiledLevel, ctx: Pick<CclpMoveContext, 'mapWidth' | 'mapHeight'>): boolean {
  return level.terrain.length === ctx.mapHeight && level.terrain.every((row) => row.length === ctx.mapWidth);
}

/** True when the level holds no key a .DAT decoder never writes (thin walls, hint cells, a theme, a win rule...). */
export function hasOnlyDatKeys(level: CompiledLevel): boolean {
  return Object.keys(level).every((key) => DAT_RECORD_KEYS.has(key));
}

/**
 * True while the level is still the record an old import wrote, judged from the record alone. The decoder writes the
 * reading's marker as the level's last key and the browser store keeps key order, while the editor writes every saved level
 * with that marker before `number` (both unchanged from 2.10 to 2.43). The level's number must also still be the one its id
 * got at import, so no level was removed or moved before it. Used only for a set the app does not hold the bytes of, and
 * only on packs imported before `oldImportCutoffMs`.
 */
export function isUntouchedDatRecord(level: CompiledLevel, lastKey: string): boolean {
  if (!hasOnlyDatKeys(level) || Object.keys(level).at(-1) !== lastKey) return false;
  const match = DAT_LEVEL_ID.exec(level.id);
  return match !== null && Number(match[1]) === level.number;
}

/** True when the pack id carries an import stamp before the cutoff. */
function importedBefore(pack: LevelPack, cutoffMs: number): boolean {
  const match = PACK_ID_STAMP.exec(pack.id);
  return match !== null && Number(match[1]) < cutoffMs;
}

/**
 * The classic reading of a .DAT level turned into the Lynx reading: actors in reading order (the Lynx reading ignores the
 * monster list), a plain block off a clone machine faced N, hidden terrain dropped, and the CCLP rules. Used only to prove a
 * stored level equal to the Lynx reading of bytes the app holds.
 */
export function moveClassicDatLevel(level: CompiledLevel, isCloneMachine: (terrainId: string) => boolean): CompiledLevel {
  const entities = [...level.entities]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((e): EntityPlacement =>
      e.type === BLOCK_ENTITY_TYPE && e.dir === CLASSIC_PLAIN_BLOCK_DIR && !isCloneMachine(level.terrain[e.y]?.[e.x] ?? '') ? { ...e, dir: LYNX_PLAIN_BLOCK_DIR } : e
    );
  const { underlays: _hidden, rulesFlavor: _classic, ...rest } = level;
  return { ...rest, entities, ruleset: CC1_DAT_RULESET, rulesProfile: CC1_DAT_RULES_PROFILE };
}

/** JSON with object keys sorted, so records written by different builds compare by content. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  );
}

/** The whole level record without its identity and reading marker, canonical. */
function contentOf(level: CompiledLevel): string {
  return canonicalJson(Object.fromEntries(Object.entries(level).filter(([key, value]) => !IDENTITY_KEYS.has(key) && value !== undefined)));
}

/** The reference level, under the stored level's id and number, so scores and completion stay attached. */
function adopt(reference: CompiledLevel, stored: CompiledLevel): CompiledLevel {
  return { ...structuredClone(reference), id: stored.id, number: stored.number };
}

/**
 * A stored classic level of a held set is untouched when it holds only .DAT keys and its whole record equals the classic
 * reading of the bytes, or its transformation equals the Lynx reading (a record an older build wrote, whose classic reading
 * changed since, still proves itself).
 */
function isUntouchedClassic(stored: CompiledLevel, ref: { classic: CompiledLevel; lynx: CompiledLevel }, ctx: CclpMoveContext): boolean {
  if (!hasOnlyDatKeys(stored)) return false;
  return contentOf(stored) === contentOf(ref.classic) || contentOf(moveClassicDatLevel(stored, ctx.isCloneMachine)) === contentOf(ref.lynx);
}

/**
 * Decides, for one stored pack, whether it moves to the CCLP engine, and returns the moved pack.
 * - A pack of a set the app holds (the bundled packs) moves when every level is proved untouched against the bytes; it then
 *   takes the Lynx reading of the bytes, so the move is exact.
 * - A plain Lynx pack of another set, added before the cutoff, moves when every level is an untouched record: it only
 *   gains the rule profile. A pack file of such untouched levels, imported before the cutoff, moves too: same content.
 * - A classic pack of another set stays ('unknown').
 * Level ids and numbers are kept, so high scores and completion stay attached. A moved pack is no longer a candidate.
 */
export async function planCclpPackMove(pack: LevelPack, ctx: CclpMoveContext): Promise<CclpPackMove> {
  const stay = (verdict: CclpMoveVerdict): CclpPackMove => ({ verdict, pack, moved: 0 });
  // A pack the player made, a shared pack (it came as a pack file, not a .DAT) and the labelled custom pack are never moved.
  if (pack.builtIn === true || pack.userCreated === true || pack.sourceHash !== undefined || pack.i18nKey !== undefined) return stay('not_dat');
  if (pack.levels.length === 0) return stay('not_dat');
  const classic = pack.levels.filter((l) => isStoredClassicDatLevel(l, ctx)).length;
  const lynx = pack.levels.filter((l) => isStoredPlainLynxDatLevel(l, ctx)).length;
  if (classic === 0 && lynx === 0) return stay('not_dat');
  if (classic !== pack.levels.length && lynx !== pack.levels.length) return stay('mixed');
  const signature = await ctx.passwordSignature(pack.levels);
  if (ctx.officialSignatures.includes(signature)) return stay('official');

  const reference = (await ctx.references()).find((r) => r.signature === signature && r.classic.length === pack.levels.length);
  if (reference) {
    const untouched = pack.levels.every((stored, i) =>
      classic > 0
        ? isUntouchedClassic(stored, { classic: reference.classic[i], lynx: reference.lynx[i] }, ctx)
        : hasOnlyDatKeys(stored) && contentOf(stored) === contentOf(reference.lynx[i])
    );
    if (!untouched) return stay('changed');
    const levels = pack.levels.map((stored, i) => adopt(reference.lynx[i], stored));
    return { verdict: 'moved', pack: { ...pack, levels }, moved: levels.length };
  }

  if (classic > 0) return stay('unknown');
  // A plain Lynx pack added after the cutoff (a pack file of old levels) is not an old .DAT import: it stays, silently.
  if (!importedBefore(pack, ctx.oldImportCutoffMs)) return stay('not_dat');
  if (!pack.levels.every((l) => isUntouchedDatRecord(l, LYNX_LAST_KEY))) return stay('changed');
  const levels = pack.levels.map((l) => ({ ...l, rulesProfile: CC1_DAT_RULES_PROFILE }));
  return { verdict: 'moved', pack: { ...pack, levels }, moved: levels.length };
}
