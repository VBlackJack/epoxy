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
 * Pure helpers for the procedural pack dialog: seed parsing, start level
 * clamping and the clipboard copy with a graceful fallback.
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

/** Keeps a requested start level inside 1..levelCount; non numbers fall back to 1. */
export function clampStartLevel(requested: number, levelCount: number): number {
  if (!Number.isFinite(requested)) return MIN_START_LEVEL;
  const max = Math.max(MIN_START_LEVEL, Math.floor(levelCount));
  return Math.min(max, Math.max(MIN_START_LEVEL, Math.floor(requested)));
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
