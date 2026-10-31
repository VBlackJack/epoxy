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

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/AudioManager', () => import('../test/silentAudio'));

import { ConfigRegistry } from '../config/ConfigRegistry';
import { GameEngine } from '../core/GameEngine';
import { Direction } from '../core/types';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { decodeXsbCollection, parseXsbCollection, XSB_EXTENSIONS } from './XsbCodec';

const PREFIX = 'pack';
/** Ticks run before each move so the player move cooldown has elapsed. */
const COOLDOWN_TICKS = 8;

function move(engine: GameEngine, dir: Direction): boolean {
  for (let i = 0; i < COOLDOWN_TICKS; i++) engine.tick();
  return engine.attemptPlayerMove(dir);
}

beforeEach(() => {
  loadTestConfigs();
});

describe('parseXsbCollection', () => {
  it('reads titles from Title: lines and ; comments and skips other metadata', () => {
    const text = [
      'Author: someone',
      '::',
      'Title: First',
      '#####',
      '#@$.#',
      '#####',
      '',
      '; Second',
      '#####',
      '#@$.#',
      '#####'
    ].join('\n');
    const levels = parseXsbCollection(text);
    expect(levels.map((l) => l.title)).toEqual(['First', 'Second']);
    expect(levels[0].lines).toEqual(['#####', '#@$.#', '#####']);
  });

  it('numbers untitled levels', () => {
    expect(parseXsbCollection('###\n#@#\n###')[0].title).toBe('#1');
  });

  it('expands run-length rows and row separators', () => {
    const levels = parseXsbCollection('5#|#@$.#|5#');
    expect(levels).toHaveLength(1);
    expect(levels[0].lines).toEqual(['#####', '#@$.#', '#####']);
  });

  it('expands counts inside a row, with - and _ as floor', () => {
    const [level] = parseXsbCollection('7#\n#@$3-.#\n#2_#\n7#');
    expect(level.lines[1]).toBe('#@$---.#');
    expect(level.lines[2]).toBe('#__#');
  });

  it('names a board with a Title: line written after it', () => {
    const room = ['#####', '#@$.#', '#####'];
    const text = [...room, 'Title: One', '', ...room, 'Title: Two', ...room].join('\n');
    expect(parseXsbCollection(text).map((l) => l.title)).toEqual(['One', 'Two', '#3']);
  });

  it('keeps a title across a blank line before the board', () => {
    const text = ['Title: Spaced', '', '#####', '#@$.#', '#####'].join('\n');
    expect(parseXsbCollection(text)[0].title).toBe('Spaced');
  });

  it('gives a title after a blank line to the next board, not to an untitled one above', () => {
    const room = ['#####', '#@$.#', '#####'];
    const text = [...room, '', 'Title: Second', ...room].join('\n');
    expect(parseXsbCollection(text).map((l) => l.title)).toEqual(['#1', 'Second']);
  });

  it('keeps leading titles aligned with their boards', () => {
    const room = ['#####', '#@$.#', '#####'];
    const text = ['Title: A', ...room, 'Author: x', '', 'Title: B', ...room, 'Comment: y', 'Title: C', ...room].join('\n');
    expect(parseXsbCollection(text).map((l) => l.title)).toEqual(['A', 'B', 'C']);
  });

  it('never takes an Author line for a title', () => {
    const text = ['#####', '#@$.#', '#####', 'Author: someone'].join('\n');
    expect(parseXsbCollection(text)[0].title).toBe('#1');
  });

  it('drops a trailing comment from a board row', () => {
    const [level] = parseXsbCollection(['#####', '#@$.#  ; note', '#####'].join('\n'));
    expect(level.lines).toEqual(['#####', '#@$.#', '#####']);
  });

  it('expands run-length groups, nested ones included', () => {
    expect(parseXsbCollection('2(#-)#')[0].lines).toEqual(['#-#-#']);
    expect(parseXsbCollection('7#|#@$.2(-2(_))#|7#')[0].lines[1]).toBe('#@$.-__-__#');
  });

  it('marks a level with unbalanced groups as unsupported instead of splitting it', () => {
    const text = ['#####', '#@$.(#', '#####'].join('\n');
    expect(parseXsbCollection(text)).toHaveLength(1);
    expect(decodeXsbCollection(text, PREFIX).skipped[0].reason).toBe('unsupported');
  });

  it('only accepts the xsb and sok extensions', () => {
    expect(XSB_EXTENSIONS).toEqual(['.xsb', '.sok']);
  });
});

describe('decodeXsbCollection', () => {
  it('maps each character to its terrain and entity', () => {
    const text = 'Title: Mapping\n######\n#@$.-#\n#*  $#\n#.####\n#.  $#\n######\n';
    const { levels, skipped } = decodeXsbCollection(text, PREFIX);
    expect(skipped).toEqual([]);
    const level = levels[0];
    expect(level.id).toBe('pack_1');
    expect(level.number).toBe(1);
    expect(level.customTitle).toBe('Mapping');
    expect(level.winRule).toBe('targets');
    expect(level.timeLimitSeconds).toBe(0);
    expect(level.chipsRequired).toBe(0);
    expect(level.trapLinks).toEqual([]);
    expect(level.cloneLinks).toEqual([]);
    expect(level.playerStart).toMatchObject({ x: 1, y: 1 });
    expect(level.terrain[0][0]).toBe('wall');
    expect(level.terrain[1][1]).toBe('floor');
    expect(level.terrain[1][3]).toBe('block_target');
    expect(level.terrain[1][4]).toBe('floor');
    expect(level.terrain[2][1]).toBe('block_target');
    expect(level.terrain[3][1]).toBe('block_target');
    const blocks = level.entities.map((e) => `${e.x},${e.y}`).sort();
    expect(blocks).toEqual(['1,2', '2,1', '4,2', '4,4']);
    expect(level.entities.every((e) => e.type === 'dirt_block')).toBe(true);
  });

  it('puts the player on a target with +', () => {
    const { levels } = decodeXsbCollection('######\n#+$$.#\n######', PREFIX);
    expect(levels[0].terrain[1][1]).toBe('block_target');
    expect(levels[0].playerStart).toMatchObject({ x: 1, y: 1 });
  });

  it('turns everything the player cannot reach into wall', () => {
    const text = [' ####  ', ' #@$.#  ', ' ##### ', '#.  $ '].join('\n');
    const { levels } = decodeXsbCollection(text, PREFIX);
    const level = levels[0];
    expect(level.terrain[0][0]).toBe('wall');
    expect(level.terrain[3].every((id) => id === 'wall')).toBe(true);
    expect(level.entities).toHaveLength(1);
    expect(level.terrain.every((row) => row.length === level.terrain[0].length)).toBe(true);
  });

  it('decodes several levels and numbers the kept ones in order', () => {
    const text = ['#####', '#@$.#', '#####', '', '#####', '# $.#', '#####', '', '#####', '#@$.#', '#####'].join('\n');
    const { levels, skipped } = decodeXsbCollection(text, PREFIX);
    expect(levels.map((l) => l.id)).toEqual(['pack_1', 'pack_2']);
    expect(skipped).toEqual([{ index: 2, title: '#2', reason: 'no_player' }]);
  });

  describe('skip reasons', () => {
    const reasonOf = (text: string) => decodeXsbCollection(text, PREFIX).skipped[0]?.reason;

    it('skips a level without a player', () => {
      expect(reasonOf('#####\n# $.#\n#####')).toBe('no_player');
    });

    it('skips a level with several players', () => {
      expect(reasonOf('######\n#@$.@#\n######')).toBe('several_players');
    });

    it('skips a room open to the edge of the board', () => {
      expect(reasonOf('#####\n#@$. \n#####')).toBe('open_room');
    });

    it('skips a level without a target', () => {
      expect(reasonOf('#####\n#@$ #\n#####')).toBe('no_target');
    });

    it('skips a level with fewer blocks than targets', () => {
      expect(reasonOf('######\n#@$..#\n######')).toBe('too_few_blocks');
    });

    it('skips a level above the maximum size', () => {
      const { maxLevelSize } = ConfigRegistry.getGame().grid;
      const wall = '#'.repeat(maxLevelSize + 1);
      expect(reasonOf([wall, `#@$.${'-'.repeat(maxLevelSize - 3)}#`, wall].join('\n'))).toBe('too_large');
    });

    it('reports the count and keeps the playable levels', () => {
      const result = decodeXsbCollection('#####\n# $.#\n#####\n\n#####\n#@$.#\n#####', PREFIX);
      expect(result.levels).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
    });
  });

  it('plays a decoded level to its win', () => {
    const { levels } = decodeXsbCollection('Title: Two\n######\n#@$. #\n# $. #\n######', PREFIX);
    const engine = new GameEngine();
    engine.loadLevel(levels[0]);
    expect(engine.isLevelCompleted()).toBe(false);
    expect(move(engine, 'E')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(false);
    expect(move(engine, 'W')).toBe(true);
    expect(move(engine, 'S')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(false);
    expect(move(engine, 'E')).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });
});
