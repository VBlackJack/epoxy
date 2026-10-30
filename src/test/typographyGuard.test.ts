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

/// <reference types="node" />

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Typography guard: tracked text files must use plain ASCII punctuation plus
 * the accents of a French keyboard. Every banned character is written as an
 * escape so this file cannot flag itself.
 */

/** Inclusive code point ranges that are refused anywhere in a tracked text file. */
const BANNED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2010, 0x2015], // hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar
  [0x2212, 0x2212], // minus sign
  [0x2018, 0x2019], // curly single quotes
  [0x201a, 0x201a], // low single quote
  [0x201c, 0x201d], // curly double quotes
  [0x201e, 0x201e], // low double quote
  [0x00ab, 0x00ab], // left guillemet
  [0x00bb, 0x00bb], // right guillemet
  [0x2039, 0x203a], // single guillemets
  [0x2026, 0x2026], // one-character ellipsis
  [0x00a0, 0x00a0], // no-break space
  [0x2000, 0x200d], // typographic spaces and zero-width characters
  [0x202f, 0x202f], // narrow no-break space
  [0x205f, 0x205f], // medium mathematical space
  [0x2060, 0x2060], // word joiner
  [0xfeff, 0xfeff], // byte order mark
  [0x0152, 0x0153], // oe ligatures
  [0x00c6, 0x00c6], // AE ligature
  [0x00e6, 0x00e6] // ae ligature
];

/** Characters that carry meaning no ASCII pair does, or that a French keyboard types: never banned. */
const ALLOWED_SAMPLES: ReadonlyArray<number> = [
  0x2190, // left arrow
  0x2192, // right arrow
  0x21d2, // double right arrow
  0x2500, // box drawing light horizontal
  0x2502, // box drawing light vertical
  0x257f, // last box drawing character
  0x00e9, // e acute
  0x00e8, // e grave
  0x00e0, // a grave
  0x00e7, // c cedilla
  0x00f4 // o circumflex
];

const ARROWS_RANGE: readonly [number, number] = [0x2190, 0x21ff];
const BOX_DRAWING_RANGE: readonly [number, number] = [0x2500, 0x257f];

/** Extensions of the tracked files that are scanned. */
const SCANNED_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.json', '.md', '.html', '.css', '.yml']);
/** Extension-less files that are scanned by name. */
const SCANNED_FILE_NAMES: ReadonlySet<string> = new Set(['.env.example', '.nvmrc']);
/** Tracked files that are never scanned: binary packs and generated lock data. */
const EXCLUDED_EXTENSIONS: ReadonlySet<string> = new Set(['.dat']);
const EXCLUDED_FILE_NAMES: ReadonlySet<string> = new Set(['package-lock.json']);

/** Nested directories a recursive scan must reach, or the guard is not scanning what it claims. */
const REQUIRED_NESTED_PATH_PREFIXES: readonly string[] = ['src/generator/', '.github/workflows/'];

/** Reading every tracked file is slow on a cold file system cache. */
const SCAN_TIMEOUT_MS = 60_000;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function isBanned(codePoint: number): boolean {
  return BANNED_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

function isScanned(path: string): boolean {
  const name = basename(path);
  const extension = extname(path).toLowerCase();
  if (EXCLUDED_FILE_NAMES.has(name) || EXCLUDED_EXTENSIONS.has(extension)) return false;
  return SCANNED_EXTENSIONS.has(extension) || SCANNED_FILE_NAMES.has(name);
}

function listScannedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return output.split('\0').filter((path) => path.length > 0 && isScanned(path));
}

function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Hits as `file:line:codepoint`, one per banned character. */
function findBannedCharacters(path: string): string[] {
  const hits: string[] = [];
  const lines = readFileSync(resolve(REPO_ROOT, path), 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const char of line) {
      const codePoint = char.codePointAt(0) as number;
      if (isBanned(codePoint)) hits.push(`${path}:${index + 1}:${formatCodePoint(codePoint)}`);
    }
  });
  return hits;
}

describe('typography guard', () => {
  it('finds no banned character in the tracked text files', () => {
    const hits = listScannedFiles().flatMap(findBannedCharacters);
    expect(hits).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('scans files in nested directories', () => {
    const files = listScannedFiles();
    for (const prefix of REQUIRED_NESTED_PATH_PREFIXES) {
      expect(files.some((path) => path.startsWith(prefix))).toBe(true);
    }
  });

  it('does not scan binary packs or the lock file', () => {
    const files = listScannedFiles();
    expect(files.some((path) => extname(path).toLowerCase() === '.dat')).toBe(false);
    expect(files).not.toContain('package-lock.json');
  });

  it('allows arrows, box drawing and French accented letters', () => {
    for (const codePoint of ALLOWED_SAMPLES) {
      expect(isBanned(codePoint)).toBe(false);
    }
    for (const [low, high] of [ARROWS_RANGE, BOX_DRAWING_RANGE]) {
      for (let codePoint = low; codePoint <= high; codePoint++) {
        expect(isBanned(codePoint)).toBe(false);
      }
    }
  });

  it('detects the banned characters', () => {
    expect(isBanned(0x2014)).toBe(true);
    expect(isBanned(0x2013)).toBe(true);
    expect(isBanned(0x2019)).toBe(true);
    expect(isBanned(0x201c)).toBe(true);
    expect(isBanned(0x00ab)).toBe(true);
    expect(isBanned(0x2026)).toBe(true);
    expect(isBanned(0x00a0)).toBe(true);
    expect(isBanned(0xfeff)).toBe(true);
    expect(isBanned(0x0153)).toBe(true);
    expect(isBanned(0x00e6)).toBe(true);
    expect(isBanned(0x0041)).toBe(false);
  });
});
