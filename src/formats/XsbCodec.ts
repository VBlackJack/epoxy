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
 * Reader for Sokoban collections in the XSB text format (.xsb / .sok): the
 * only XSB parser of the project. A collection is split into levels, run-length
 * rows are expanded, and each level can be decoded into a native level won by
 * covering every block target with a block.
 */

import { ConfigRegistry } from '../config/ConfigRegistry';
import { BLOCK_TARGET_TILE_ID, DEFAULT_CLONE_TEMPLATE_TYPE, FLOOR_TILE_ID, WALL_TILE_ID } from '../core/coreConstants';
import { CompiledLevel, EntityPlacement, LevelBlueprint } from '../core/types';

/** XSB characters; '-' and '_' are floor, like a space. */
const XSB_WALL = '#';
const XSB_BOX = '$';
const XSB_GOAL = '.';
const XSB_BOX_ON_GOAL = '*';
const XSB_PLAYER = '@';
const XSB_PLAYER_ON_GOAL = '+';
const XSB_ROW_SEPARATOR = '|';
const XSB_GROUP_OPEN = '(';
const XSB_GROUP_CLOSE = ')';
const XSB_TITLE_PREFIX = 'title:';
const XSB_COMMENT_PREFIX = ';';
/** A line of a level, before run-length expansion: board characters, counts, groups and row separators. */
const XSB_LEVEL_CHARS = /^[#$.*@+ \-_0-9|()]+$/;
const XSB_COUNT_CHARS = /^[0-9]$/;
/** Longest run a count may expand to; anything above is far beyond any level size. */
const XSB_MAX_RUN_LENGTH = 1000;
/** Longest line a group expansion may produce; a nested group beyond it makes the level unsupported. */
const XSB_MAX_EXPANDED_LENGTH = 10000;

/** File extensions of an XSB collection; .txt is deliberately left out. */
export const XSB_EXTENSIONS: readonly string[] = ['.xsb', '.sok'];

/** Facing of the player when a level starts. */
const START_DIRECTION = 'S';
/** Facing given to the blocks. */
const BLOCK_DIRECTION = 'S';
/** Offsets of the four neighbours of a cell. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
];

export interface XsbLevel {
  title: string;
  lines: string[];
  /** True when a row used syntax that could not be expanded safely (unbalanced or oversized groups). */
  unsupported?: boolean;
}

/** Why a level of a collection was not kept, in the order the checks run. */
export type XsbSkipReason =
  | 'unsupported'
  | 'too_small'
  | 'too_large'
  | 'no_player'
  | 'several_players'
  | 'open_room'
  | 'no_target'
  | 'too_few_blocks';

export interface XsbSkippedLevel {
  /** Position of the level in the collection, from 1. */
  index: number;
  title: string;
  reason: XsbSkipReason;
}

export interface XsbDecodeResult {
  levels: CompiledLevel[];
  skipped: XsbSkippedLevel[];
}

/** Expands the run-length encoding of one line: "4#" is "####", "|" ends a row. */
function expandRuns(line: string): string[] {
  const rows: string[] = [];
  let row = '';
  let count = '';
  for (const ch of line) {
    if (XSB_COUNT_CHARS.test(ch)) {
      count += ch;
    } else if (ch === XSB_ROW_SEPARATOR) {
      rows.push(row);
      row = '';
      count = '';
    } else {
      const run = count ? Math.min(Number(count), XSB_MAX_RUN_LENGTH) : 1;
      row += ch.repeat(run);
      count = '';
    }
  }
  rows.push(row);
  return rows;
}

/**
 * Expands the "n(...)" groups of one line into plain run-length text, nested groups included.
 * Returns null when the groups are unbalanced or the result would exceed the size cap.
 */
function expandGroups(line: string): string | null {
  const frames: Array<{ buf: string; repeat: number }> = [{ buf: '', repeat: 1 }];
  let count = '';
  for (const ch of line) {
    const frame = frames[frames.length - 1];
    if (XSB_COUNT_CHARS.test(ch)) {
      count += ch;
    } else if (ch === XSB_GROUP_OPEN) {
      frames.push({ buf: '', repeat: count ? Math.min(Number(count), XSB_MAX_RUN_LENGTH) : 1 });
      count = '';
    } else if (ch === XSB_GROUP_CLOSE) {
      if (frames.length === 1) return null;
      frames.pop();
      if (frame.buf.length * frame.repeat > XSB_MAX_EXPANDED_LENGTH) return null;
      frames[frames.length - 1].buf += frame.buf.repeat(frame.repeat);
      count = '';
    } else {
      frame.buf += count + ch;
      count = '';
    }
    if (frame.buf.length > XSB_MAX_EXPANDED_LENGTH) return null;
  }
  return frames.length === 1 ? frames[0].buf + count : null;
}

/** The board part of a line when it is a level row (a trailing ';' comment is dropped), else null. */
function boardPart(raw: string): string | null {
  const commentAt = raw.indexOf(XSB_COMMENT_PREFIX);
  const body = (commentAt >= 0 ? raw.slice(0, commentAt) : raw).replace(/\s+$/, '');
  return body.length > 0 && XSB_LEVEL_CHARS.test(body) && body.includes(XSB_WALL) ? body : null;
}

/**
 * Splits a collection into levels, titled by a "Title:" line or a ';' comment. A title normally
 * precedes its board; a title right after a board names that board when the collection has not
 * used leading titles (the .sok convention). Other metadata lines are ignored.
 */
export function parseXsbCollection(text: string): XsbLevel[] {
  const levels: XsbLevel[] = [];
  let lines: string[] = [];
  let unsupported = false;
  let pendingTitle = '';
  let leadingTitles = false;
  let lastAutoTitled = false;
  // A title names the board above it only on the line right below it, before any blank line.
  let afterBoard = false;
  const flush = () => {
    if (lines.length === 0 && !unsupported) return;
    const level: XsbLevel = { title: pendingTitle || `#${levels.length + 1}`, lines };
    if (unsupported) level.unsupported = true;
    levels.push(level);
    if (pendingTitle) leadingTitles = true;
    lastAutoTitled = !pendingTitle;
    pendingTitle = '';
    lines = [];
    unsupported = false;
  };
  const offerTitle = (value: string) => {
    if (!value) return;
    if (afterBoard && !leadingTitles && lastAutoTitled && levels.length > 0) {
      levels[levels.length - 1].title = value;
      lastAutoTitled = false;
    } else {
      pendingTitle = value;
    }
  };
  for (const raw of text.split(/\r?\n/)) {
    const board = boardPart(raw);
    if (board !== null) {
      const expanded = expandGroups(board);
      if (expanded === null) unsupported = true;
      else lines.push(...expandRuns(expanded).map((row) => row.replace(/\s+$/, '')));
      afterBoard = true;
      continue;
    }
    flush();
    const line = raw.replace(/\s+$/, '');
    if (line.toLowerCase().startsWith(XSB_TITLE_PREFIX)) offerTitle(line.slice(XSB_TITLE_PREFIX.length).trim());
    else if (line.startsWith(XSB_COMMENT_PREFIX)) offerTitle(line.slice(XSB_COMMENT_PREFIX.length).trim());
    if (line.length === 0 || !line.includes(':')) afterBoard = false;
  }
  flush();
  return levels;
}

/** Decodes a whole collection; levels that cannot be played are skipped with their reason. */
export function decodeXsbCollection(text: string, idPrefix: string): XsbDecodeResult {
  const levels: CompiledLevel[] = [];
  const skipped: XsbSkippedLevel[] = [];
  parseXsbCollection(text).forEach((source, i) => {
    const decoded = decodeXsbLevel(source, idPrefix, levels.length + 1);
    if (typeof decoded === 'string') skipped.push({ index: i + 1, title: source.title, reason: decoded });
    else levels.push(decoded);
  });
  return { levels, skipped };
}

/** Decodes one level, or says why it is not playable. */
export function decodeXsbLevel(source: XsbLevel, idPrefix: string, number: number): CompiledLevel | XsbSkipReason {
  if (source.unsupported || source.lines.length === 0) return 'unsupported';
  const height = source.lines.length;
  const width = Math.max(...source.lines.map((l) => l.length));
  const { minLevelSize, maxLevelSize } = ConfigRegistry.getGame().grid;
  if (width > maxLevelSize || height > maxLevelSize) return 'too_large';
  if (width < minLevelSize || height < minLevelSize) return 'too_small';
  const at = (x: number, y: number) => source.lines[y]?.[x] ?? ' ';

  let start: { x: number; y: number } | null = null;
  let players = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = at(x, y);
      if (ch === XSB_PLAYER || ch === XSB_PLAYER_ON_GOAL) {
        players++;
        start = { x, y };
      }
    }
  }
  if (!start) return 'no_player';
  if (players > 1) return 'several_players';

  // The room is what the player reaches, ignoring blocks; everything else is wall.
  const inside = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
  inside[start.y][start.x] = true;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return 'open_room';
      if (at(nx, ny) === XSB_WALL || inside[ny][nx]) continue;
      inside[ny][nx] = true;
      queue.push({ x: nx, y: ny });
    }
  }

  const terrain: string[][] = [];
  const entities: EntityPlacement[] = [];
  let targets = 0;
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const ch = at(x, y);
      if (!inside[y][x]) {
        row.push(WALL_TILE_ID);
        continue;
      }
      const onTarget = ch === XSB_GOAL || ch === XSB_BOX_ON_GOAL || ch === XSB_PLAYER_ON_GOAL;
      if (onTarget) targets++;
      if (ch === XSB_BOX || ch === XSB_BOX_ON_GOAL) {
        entities.push({ type: DEFAULT_CLONE_TEMPLATE_TYPE, x, y, dir: BLOCK_DIRECTION });
      }
      row.push(onTarget ? BLOCK_TARGET_TILE_ID : FLOOR_TILE_ID);
    }
    terrain.push(row);
  }
  if (targets === 0) return 'no_target';
  if (entities.length < targets) return 'too_few_blocks';

  const blueprint: LevelBlueprint = {
    id: `${idPrefix}_${number}`,
    winRule: 'targets',
    number,
    customTitle: source.title,
    password: '',
    timeLimitSeconds: 0,
    chipsRequired: 0,
    playerStart: { x: start.x, y: start.y, dir: START_DIRECTION },
    terrain,
    entities,
    trapLinks: [],
    cloneLinks: []
  };
  return ConfigRegistry.compileBlueprint(blueprint);
}
