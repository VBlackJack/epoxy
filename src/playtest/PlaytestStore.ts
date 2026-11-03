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

import { PLAYTEST_FILE_BASE, PLAYTEST_FORMAT_ID, PLAYTEST_FORMAT_VERSION } from '../config/constants';
import { isFiniteNumber, isRecord } from '../config/ConfigValidation';
import type { PlaytestConfig } from '../core/types';
import type {
  PlaytestDeath,
  PlaytestLeaveReason,
  PlaytestOutcome,
  PlaytestRating,
  PlaytestSession
} from './PlaytestRecorder';

/** The part of Storage the playtest data needs. */
export type PlaytestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Values stored under the enabled flag. */
const FLAG_ON = '1';
const FLAG_OFF = '0';

const LEAVE_REASONS: readonly PlaytestLeaveReason[] = ['level_change', 'pack_change', 'tab_close'];

/** Shape of the downloaded file. */
export interface PlaytestExport {
  format: string;
  version: number;
  exportedAt: string;
  appVersion: string;
  sessionCount: number;
  sessions: readonly PlaytestSession[];
}

export interface PlaytestStoreKeys {
  enabledKey: string;
  sessionsKey: string;
}

function asCount(value: unknown): number | null {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function sanitizeDeath(value: unknown): PlaytestDeath | null {
  if (!isRecord(value)) return null;
  const attempt = asCount(value.attempt);
  const atActiveMs = asCount(value.atActiveMs);
  if (attempt === null || atActiveMs === null || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { attempt, cause: asText(value.cause), x: value.x, y: value.y, atActiveMs };
}

function sanitizeOutcome(value: unknown): PlaytestOutcome | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'win') {
    const attempt = asCount(value.attempt);
    const moves = asCount(value.moves);
    const activeMs = asCount(value.activeMs);
    return attempt === null || moves === null || activeMs === null ? null : { kind: 'win', attempt, moves, activeMs };
  }
  if (value.kind === 'leave' && LEAVE_REASONS.includes(value.reason as PlaytestLeaveReason)) {
    return { kind: 'leave', reason: value.reason as PlaytestLeaveReason };
  }
  return null;
}

function sanitizeRating(value: unknown, limits: PlaytestConfig): PlaytestRating | null {
  if (!isRecord(value)) return null;
  const scale = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= limits.ratingMin && v <= limits.ratingMax ? v : null;
  return {
    difficulty: scale(value.difficulty),
    fun: scale(value.fun),
    aha: typeof value.aha === 'boolean' ? value.aha : null,
    note: typeof value.note === 'string' ? value.note.slice(0, limits.noteMaxLength) : ''
  };
}

function sanitizeTrace(value: unknown, limits: PlaytestConfig): string | null {
  return typeof value === 'string' ? value.slice(0, limits.maxTraceLength) : null;
}

/** Validates one stored session; null when it cannot be trusted. */
export function sanitizeSession(value: unknown, limits: PlaytestConfig): PlaytestSession | null {
  if (!isRecord(value) || !isRecord(value.assists)) return null;
  const id = asText(value.id);
  const packId = asText(value.packId);
  const levelId = asText(value.levelId);
  const ruleset = asText(value.ruleset);
  const appVersion = asText(value.appVersion);
  const outcome = sanitizeOutcome(value.outcome);
  const counts = {
    levelNumber: asCount(value.levelNumber),
    startedAt: asCount(value.startedAt),
    endedAt: asCount(value.endedAt),
    activeMs: asCount(value.activeMs),
    attempts: asCount(value.attempts),
    restarts: asCount(value.restarts),
    undos: asCount(value.undos),
    hintUses: asCount(value.hintUses),
    solutionViews: asCount(value.solutionViews),
    deadEndTriggers: asCount(value.deadEndTriggers),
    totalMoves: asCount(value.totalMoves),
    deathCount: asCount(value.deathCount)
  };
  if (!id || !packId || !levelId || ruleset === null || appVersion === null || !outcome) return null;
  if (Object.values(counts).some((count) => count === null)) return null;
  const deaths = (Array.isArray(value.deaths) ? value.deaths : [])
    .map(sanitizeDeath)
    .filter((death): death is PlaytestDeath => death !== null)
    .slice(0, limits.maxDeathsPerSession);
  return {
    id,
    packId,
    levelId,
    ruleset,
    appVersion,
    ...(counts as { [K in keyof typeof counts]: number }),
    assists: {
      hintAvailable: value.assists.hintAvailable === true,
      solutionAvailable: value.assists.solutionAvailable === true,
      deadEndWatch: value.assists.deadEndWatch === true
    },
    deaths,
    outcome,
    winTrace: sanitizeTrace(value.winTrace, limits),
    lastTrace: sanitizeTrace(value.lastTrace, limits),
    tracesTruncated: value.tracesTruncated === true,
    rating: sanitizeRating(value.rating, limits)
  };
}

/** Validates the stored list, drops what is unreadable and keeps the newest sessions within the bound. */
export function sanitizeSessions(value: unknown, limits: PlaytestConfig): PlaytestSession[] {
  if (!Array.isArray(value)) return [];
  const sessions = value
    .map((entry) => sanitizeSession(entry, limits))
    .filter((session): session is PlaytestSession => session !== null);
  return sessions.slice(-limits.maxSessions);
}

/** Builds the content of the file the tester downloads. */
export function buildPlaytestExport(
  sessions: readonly PlaytestSession[],
  appVersion: string,
  exportedAtMs: number
): PlaytestExport {
  return {
    format: PLAYTEST_FORMAT_ID,
    version: PLAYTEST_FORMAT_VERSION,
    exportedAt: new Date(exportedAtMs).toISOString(),
    appVersion,
    sessionCount: sessions.length,
    sessions
  };
}

/** `epoxy-playtest-YYYYMMDD-HHMMSS.json`, in UTC. */
export function playtestFileName(exportedAtMs: number): string {
  const stamp = new Date(exportedAtMs).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${PLAYTEST_FILE_BASE}-${stamp}.json`;
}

/** Keeps the enabled flag and the sessions in the browser's storage; every failure is swallowed. */
export class PlaytestStore {
  public constructor(
    private readonly storage: PlaytestStorage,
    private readonly keys: PlaytestStoreKeys,
    private readonly limits: PlaytestConfig
  ) {}

  public isEnabled(): boolean {
    try {
      return this.storage.getItem(this.keys.enabledKey) === FLAG_ON;
    } catch {
      return false;
    }
  }

  public setEnabled(enabled: boolean): void {
    try {
      this.storage.setItem(this.keys.enabledKey, enabled ? FLAG_ON : FLAG_OFF);
    } catch {
      // Storage blocked: the choice only lasts for this page.
    }
  }

  public loadSessions(): PlaytestSession[] {
    try {
      const raw = this.storage.getItem(this.keys.sessionsKey);
      return raw ? sanitizeSessions(JSON.parse(raw) as unknown, this.limits) : [];
    } catch {
      return [];
    }
  }

  /** Returns false when the browser refused the write (full or blocked storage). */
  public saveSessions(sessions: readonly PlaytestSession[]): boolean {
    try {
      this.storage.setItem(this.keys.sessionsKey, JSON.stringify(sessions));
      return true;
    } catch {
      return false;
    }
  }

  public clearSessions(): void {
    try {
      this.storage.removeItem(this.keys.sessionsKey);
    } catch {
      // Nothing to remove when storage is blocked.
    }
  }
}
