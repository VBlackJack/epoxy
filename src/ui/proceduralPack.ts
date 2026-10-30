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

/**
 * Pure helpers for the endless mode dialog: seed and start level parsing,
 * resume logic and the clipboard copy with a graceful fallback.
 */

/** Seeds are unsigned 32-bit integers written in decimal, as createSeed produces them. */
export const SEED_MAX_VALUE = 0xffffffff;
const SEED_PATTERN = /^\d+$/;
const DECIMAL_RADIX = 10;
const MIN_START_LEVEL = 1;

export type SeedParseResult = { valid: true; seed: number | null } | { valid: false };

/**
 * Parses the seed field. Empty input is valid and means "pick a random seed"
 * (seed is null); anything else must be a decimal integer in the uint32 range.
 */
export function parseSeedInput(raw: string): SeedParseResult {
  const text = raw.trim();
  if (text === '') return { valid: true, seed: null };
  if (!SEED_PATTERN.test(text)) return { valid: false };
  const value = Number.parseInt(text, DECIMAL_RADIX);
  if (!Number.isSafeInteger(value) || value > SEED_MAX_VALUE) return { valid: false };
  return { valid: true, seed: value };
}

export type StartLevelParseResult = { valid: true; level: number } | { valid: false };

/**
 * Parses the start level field of the endless dialog. Empty means level 1;
 * otherwise a whole number from 1 to `maxLevel`.
 */
export function parseStartLevelInput(raw: string, maxLevel: number): StartLevelParseResult {
  const text = raw.trim();
  if (text === '') return { valid: true, level: MIN_START_LEVEL };
  if (!SEED_PATTERN.test(text)) return { valid: false };
  const value = Number.parseInt(text, DECIMAL_RADIX);
  if (!Number.isSafeInteger(value) || value < MIN_START_LEVEL || value > maxLevel) return { valid: false };
  return { valid: true, level: value };
}

/** The last endless run: its seed and the highest level number the player reached. */
export interface EndlessProgress {
  seed: number;
  reachedLevel: number;
}

/** Reads the stored endless progress back; null when absent or malformed. */
export function readStoredEndlessProgress(raw: string | null): EndlessProgress | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EndlessProgress> | null;
    const seed = parsed?.seed;
    const reached = parsed?.reachedLevel;
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > SEED_MAX_VALUE) return null;
    if (typeof reached !== 'number' || !Number.isSafeInteger(reached) || reached < MIN_START_LEVEL) return null;
    return { seed, reachedLevel: reached };
  } catch {
    return null;
  }
}

/** Progress after the player reaches `levelNumber`: a new seed restarts, the same seed keeps its best. */
export function recordReachedLevel(
  previous: EndlessProgress | null,
  seed: number,
  levelNumber: number
): EndlessProgress {
  const best = previous && previous.seed === seed ? previous.reachedLevel : 0;
  return { seed, reachedLevel: Math.max(best, levelNumber, MIN_START_LEVEL) };
}

/**
 * Start level to propose for the seed typed in the dialog: the reached level
 * (never above `maxLevel`) when the seed is the last endless one, level 1 for
 * any other seed or none.
 */
export function suggestStartLevel(progress: EndlessProgress | null, seedRaw: string, maxLevel: number): number {
  if (!progress) return MIN_START_LEVEL;
  const parsed = parseSeedInput(seedRaw);
  return parsed.valid && parsed.seed === progress.seed ? Math.min(progress.reachedLevel, maxLevel) : MIN_START_LEVEL;
}

/** Reads a stored seed back; returns null when absent or not a valid seed. */
export function readStoredSeed(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = parseSeedInput(raw);
  return parsed.valid ? parsed.seed : null;
}

/**
 * Copies text to the clipboard. Uses the async Clipboard API when available,
 * then a hidden textarea with execCommand; resolves false when both fail.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'clipboard-scratch';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
