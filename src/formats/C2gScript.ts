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

import { decodeWindows1252 } from './cc2Text';

/**
 * Reader for the line-based game script (.c2g) of Chip's Challenge 2.
 *
 * Only three things are read: `game "name"`, and the lines that place a level,
 * `music "+Track" map "dir\file.c2m"`, where the music part is optional. Story
 * text blocks, conditions and comments are skipped.
 */

/** Keywords the reader acts on. */
const KEYWORD_GAME = 'game';
const KEYWORD_MUSIC = 'music';
const KEYWORD_MAP = 'map';
/** Starts a comment outside quotes. */
const COMMENT_CHAR = ';';
const QUOTE_CHAR = '"';
/** UTF-8 byte order mark some editors prepend. */
const UTF8_BOM: readonly number[] = [0xef, 0xbb, 0xbf];

export interface C2gMapEntry {
  /** Path as written in the script, backslashes included. */
  path: string;
  /** Lowercase path with forward slashes, the key used to match files. */
  key: string;
  /** Music track given on the same line, if any. */
  music?: string;
}

export interface C2gScript {
  gameName: string | null;
  /** Levels in the order the script lists them. */
  maps: C2gMapEntry[];
}

/** One token of a script line: a bare word or the content of a quoted string. */
interface Token {
  text: string;
  quoted: boolean;
}

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < line.length) {
    const char = line[at];
    if (char === COMMENT_CHAR) break;
    if (/\s/.test(char)) {
      at++;
    } else if (char === QUOTE_CHAR) {
      const end = line.indexOf(QUOTE_CHAR, at + 1);
      const stop = end < 0 ? line.length : end;
      tokens.push({ text: line.slice(at + 1, stop), quoted: true });
      at = stop + 1;
    } else {
      let stop = at;
      while (stop < line.length && !/\s/.test(line[stop]) && line[stop] !== COMMENT_CHAR && line[stop] !== QUOTE_CHAR) stop++;
      tokens.push({ text: line.slice(at, stop), quoted: false });
      at = stop;
    }
  }
  return tokens;
}

/** Normalizes a script path to the key used for matching: lowercase, forward slashes. */
export function c2gPathKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Parses the text of a .c2g file. */
export function parseC2gScript(text: string): C2gScript {
  const script: C2gScript = { gameName: null, maps: [] };
  for (const line of text.split(/\r\n|\r|\n/)) {
    const tokens = tokenize(line);
    if (tokens.length === 0 || tokens[0].quoted) continue;
    const keyword = tokens[0].text.toLowerCase();
    if (keyword === KEYWORD_GAME) {
      if (script.gameName === null && tokens[1]?.quoted) script.gameName = tokens[1].text;
      continue;
    }
    let music: string | undefined;
    let mapPath: string | undefined;
    for (let i = 0; i < tokens.length - 1; i++) {
      const word = tokens[i];
      const value = tokens[i + 1];
      if (word.quoted || !value.quoted) continue;
      const name = word.text.toLowerCase();
      if (name === KEYWORD_MUSIC) music = value.text;
      else if (name === KEYWORD_MAP) mapPath = value.text;
    }
    if (mapPath === undefined) continue;
    const entry: C2gMapEntry = { path: mapPath, key: c2gPathKey(mapPath) };
    if (music !== undefined) entry.music = music;
    script.maps.push(entry);
  }
  return script;
}

/** Parses the bytes of a .c2g file (Windows-1252, with or without a byte order mark). */
export function parseC2gBytes(bytes: Uint8Array): C2gScript {
  const hasMark = UTF8_BOM.every((value, index) => bytes[index] === value);
  return parseC2gScript(decodeWindows1252(hasMark ? bytes.subarray(UTF8_BOM.length) : bytes));
}

/**
 * Builds a resolver from script paths to the available file paths. Matching is
 * case-insensitive, ignores the folder separator style, and falls back from the
 * full path to a suffix match and then to a unique base name.
 */
export function createC2gResolver(available: readonly string[]): (entry: C2gMapEntry) => string | null {
  const keys = available.map((path) => ({ path, key: c2gPathKey(path) }));
  const exact = new Map<string, string>();
  for (const { path, key } of keys) if (!exact.has(key)) exact.set(key, path);
  const baseName = (key: string): string => key.slice(key.lastIndexOf('/') + 1);
  return (entry) => {
    const direct = exact.get(entry.key);
    if (direct !== undefined) return direct;
    const suffix = '/' + entry.key;
    const suffixMatches = keys.filter(({ key }) => key.endsWith(suffix));
    if (suffixMatches.length === 1) return suffixMatches[0].path;
    const base = baseName(entry.key);
    const baseMatches = keys.filter(({ key }) => baseName(key) === base);
    return baseMatches.length === 1 ? baseMatches[0].path : null;
  };
}
