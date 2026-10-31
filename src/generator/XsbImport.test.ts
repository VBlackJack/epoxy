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

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { compilePiece } from './PieceCompiler';
import { PieceDefinition } from './PieceTypes';
import { importXsbLevel, parseXsbCollection, XSB_MAX_PIECE_HEIGHT, XSB_MAX_PIECE_WIDTH, XsbLevel } from './XsbImport';
import { loadTestConfigs } from '../test/loadTestConfigs';

/** The engine check explores every state of each kept piece. */
const IMPORT_TIMEOUT_MS = 60000;
const CREDIT = 'Test rooms';
const TRAP = 'X';
const WALL = '#';
const BUTTON = 'm';
const BLOCK = '&';
const EXIT = '$';

/** Whether the exit port reaches the block's room without crossing the button. */
function exitReachesBlock(rows: string[]): boolean {
  const find = (ch: string) => {
    const y = rows.findIndex((r) => r.includes(ch));
    return { x: rows[y].indexOf(ch), y };
  };
  const start = find(EXIT);
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    if (rows[y][x] === BLOCK) return true;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const ch = rows[y + dy]?.[x + dx];
      const key = `${x + dx},${y + dy}`;
      if (ch === undefined || ch === WALL || ch === BUTTON || seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  return false;
}

const level = (lines: string[], title = 'test'): XsbLevel => ({ title, lines });

/**
 * The box can only be pushed onto the doorway goal from the right room, so
 * the last push seals the player in there, away from the start.
 */
const SEALED_POCKET = [
  '########',
  '##@#   #',
  '## . $ #',
  '## #   #',
  '########'
];

/** Three boxes in a room 6 cells tall, which a stack of one trap row per box could not fit. */
const THREE_BOX_ROOM = [
  '#######',
  '#@  ###',
  '# $ ###',
  '##  . #',
  '# $.# #',
  '#  $  #',
  '##.  ##',
  '#######'
];

function expectFits(def: PieceDefinition): void {
  const fits = (w: number, h: number) => w <= XSB_MAX_PIECE_WIDTH && h <= XSB_MAX_PIECE_HEIGHT;
  expect(fits(def.rows[0].length, def.rows.length)).toBe(true);
}

describe('XsbImport', () => {
  beforeAll(() => loadTestConfigs());

  it('splits a collection into titled levels', () => {
    const text = ['Title: First', ...SEALED_POCKET, '', '; Second', ...THREE_BOX_ROOM, '', ...SEALED_POCKET].join('\n');
    const levels = parseXsbCollection(text);
    expect(levels.map((l) => l.title)).toEqual(['First', 'Second', '#3']);
    expect(levels[1].lines).toEqual(THREE_BOX_ROOM);
  });

  it(
    'opens the exit into the pocket the last push leaves the player in',
    () => {
      const result = importXsbLevel(level(SEALED_POCKET), CREDIT, 1);
      expect(result.rejection).toBeUndefined();
      const def = result.piece as PieceDefinition;
      expectFits(def);
      expect(def.credit).toBe(`${CREDIT}, test`);
      expect(def.trapLinks).toHaveLength(1);
      expect(exitReachesBlock(def.rows)).toBe(true);
      expect(() => compilePiece(def, ConfigRegistry.getPieceLegend())).not.toThrow();
    },
    IMPORT_TIMEOUT_MS
  );

  it(
    'runs the traps along the tunnel instead of one row per box',
    () => {
      const result = importXsbLevel(level(THREE_BOX_ROOM), CREDIT, 2);
      expect(result.rejection).toBeUndefined();
      const def = result.piece as PieceDefinition;
      expectFits(def);
      expect(def.rows.join('').split(TRAP)).toHaveLength(4);
      expect(def.trapLinks).toHaveLength(3);
    },
    IMPORT_TIMEOUT_MS
  );

  it(
    'transposes a layout that only fits the other way round',
    () => {
      const result = importXsbLevel(level(['############', '#@$       .#', '############']), CREDIT, 3);
      expect(result.rejection).toBeUndefined();
      const def = result.piece as PieceDefinition;
      expectFits(def);
      expect(def.rows.length).toBeGreaterThan(def.rows[0].length);
    },
    IMPORT_TIMEOUT_MS
  );

  it('says why a level is rejected', () => {
    expect(importXsbLevel(level(['#####', '# $.#', '#####']), CREDIT, 1).rejection).toBe('no_player');
    expect(importXsbLevel(level(['#####', '#@$. ', '#####']), CREDIT, 1).rejection).toBe('open_room');
    expect(importXsbLevel(level(['######', '#@$$.#', '######']), CREDIT, 1).rejection).toBe('box_goal_mismatch');
    expect(importXsbLevel(level(['#####', '#$ .#', '#@  #', '#####']), CREDIT, 1).rejection).toBe('unsolved');
    const wide = ['################', `#@$${' '.repeat(11)}.#`, '################'];
    const tall = Array.from({ length: 12 }, () => '#              #');
    expect(importXsbLevel(level([...wide.slice(0, 2), ...tall, wide[2]]), CREDIT, 1).rejection).toBe('too_large');
  });
});
