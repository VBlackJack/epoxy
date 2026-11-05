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
 * Palette search, as pure functions: an entry matches when every word of the query is found in its
 * name or its description, ignoring case and accents. Ids never match: the player searches by what
 * the palette shows.
 */

/** What the search reads of a palette entry. The editor adds whatever it needs to build the button. */
export interface SearchableEntry {
  kind: string;
  id: string;
  /** The translated name shown on the button. */
  name: string;
  /** The translated description, when the entry has one. */
  description?: string;
  /** The category the entry belongs to, so a result can open its tab. */
  category: string;
}

/** Rank of a match, best first. */
export const RANK_NAME_STARTS = 0;
export const RANK_NAME_WORD_STARTS = 1;
export const RANK_IN_NAME = 2;
export const RANK_DESCRIPTION_ONLY = 3;

/** The Unicode combining diacritical marks block, written as code points so the source stays ASCII. */
const COMBINING_MARKS_FIRST = 0x300;
const COMBINING_MARKS_LAST = 0x36f;
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(COMBINING_MARKS_FIRST)}-${String.fromCharCode(COMBINING_MARKS_LAST)}]`, 'g');
const WHITESPACE_RUNS = /\s+/g;
const WORD_SEPARATOR = ' ';

/** Lower case, accents removed, runs of spaces collapsed to one and the ends trimmed. */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(WHITESPACE_RUNS, WORD_SEPARATOR).trim();
}

/** The folded words of a query; empty when the query holds none. */
export function parseQuery(query: string): string[] {
  const folded = foldForSearch(query);
  return folded === '' ? [] : folded.split(WORD_SEPARATOR);
}

/**
 * How well an entry matches the words, or null when it does not match. Every word must appear in the
 * name or the description. 0: the name starts with the first word; 1: a word of the name starts with
 * one of the words; 2: a word is inside the name; 3: the name holds none of them, the description does.
 */
export function matchRank(entry: SearchableEntry, tokens: readonly string[]): number | null {
  if (tokens.length === 0) return null;
  const name = foldForSearch(entry.name);
  const description = foldForSearch(entry.description ?? '');
  const everyWordFound = tokens.every((token) => name.includes(token) || description.includes(token));
  if (!everyWordFound) return null;
  if (name.startsWith(tokens[0])) return RANK_NAME_STARTS;
  const nameWords = name.split(WORD_SEPARATOR);
  if (tokens.some((token) => nameWords.some((word) => word.startsWith(token)))) return RANK_NAME_WORD_STARTS;
  if (tokens.some((token) => name.includes(token))) return RANK_IN_NAME;
  return RANK_DESCRIPTION_ONLY;
}

/**
 * The entries that match the query, best rank first. Entries of the same rank keep the order they were
 * given in (category order, then config order). An empty query matches everything, unranked.
 */
export function searchPalette<T extends SearchableEntry>(entries: readonly T[], query: string): T[] {
  const tokens = parseQuery(query);
  if (tokens.length === 0) return [...entries];
  const ranked: Array<{ entry: T; rank: number; index: number }> = [];
  entries.forEach((entry, index) => {
    const rank = matchRank(entry, tokens);
    if (rank !== null) ranked.push({ entry, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map((item) => item.entry);
}
