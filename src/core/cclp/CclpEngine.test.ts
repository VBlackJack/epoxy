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

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { playSfx: vi.fn() }
}));

import { loadTestConfigs } from '../../test/loadTestConfigs';
import { applyTimedMove } from '../../ui/replaySchedule';
import { EngineSelector } from '../EngineSelector';
import { LynxEngine } from '../lynx/LynxEngine';
import { lynxLevel } from '../lynx/lynxTestMaps';
import { Direction } from '../types';
import { CclpEngine, CCLP_RULE_MODULES } from './CclpEngine';

beforeAll(() => {
  loadTestConfigs();
});

const SILENT = { effect: () => undefined, step: () => undefined };
/** Enough ticks for one walking step and the block's push to end. */
const STEP_TICKS = 8;

/** Chip at (2,2), facing south (the Lynx start), a block east of him at (3,2), open floor around. */
const SLAP_ROOM = ['#######', '#.....#', '#.@B..#', '#.....#', '#######'];
/** Chip at (2,2) with a wall south of him and nothing east. */
const WALL_SOUTH = ['#######', '#.....#', '#.@...#', '#.#...#', '#######'];
/** Chip at (2,2) boxed in east and south. */
const BOXED = ['#######', '#.....#', '#.@#..#', '#.#...#', '#######'];
/** Chip at (2,2) facing south; south of him a block stands on an appearing wall (a wall that yields to a push), floor beyond. */
const YIELD_ROOM = ['#######', '#.....#', '#.@...#', '#.A...#', '#.....#', '#######'];
const YIELD_GLYPHS = { A: { terrain: 'appearing_wall', entity: { type: 'dirt_block', dir: 'N' as Direction } } };
/** East of Chip a block against a wall; south of him a block with floor beyond. */
const UNMOVABLE_EAST = ['#######', '#.....#', '#.@B#.#', '#.B...#', '#.....#', '#######'];
/** East of Chip a block against a wall; a wall south of him. */
const FAILS_BESIDE_BLOCK = ['#######', '#.....#', '#.@B#.#', '#.#...#', '#.....#', '#######'];
/** Chip at (1,2) west of two east force floors. */
const FORCE_ROOM = ['########', '#......#', '#@ff...#', '#......#', '########'];
const FORCE_TICKS = 16;
/** The tick from which the pair N+E is held (Chip is on the floors by then). */
const FORCE_PAIR_FROM = 4;

function play(engine: LynxEngine, rows: string[], keys: Direction[]): { chip: [number, number, Direction]; blocks: string[] } {
  engine.loadLevel(lynxLevel(rows));
  for (let i = 0; i < STEP_TICKS; i++) {
    engine.holdPlayerDirections(i === 0 ? keys : []);
    engine.tick();
  }
  const p = engine.getPlayer();
  return { chip: [p.x, p.y, p.dir], blocks: engine.getEntities().map((e) => `${e.type}@${e.x},${e.y}`) };
}

describe('CclpEngine: two held keys', () => {
  it('registers its modules without a second rule for any id', () => {
    expect(() => new CclpEngine(SILENT).loadLevel(lynxLevel(['###', '#@#', '###']))).not.toThrow();
    expect(new Set(CCLP_RULE_MODULES.map((m) => m.name)).size).toBe(CCLP_RULE_MODULES.length);
  });

  it('keeps the facing when both keys are open, and slaps the block on the other side', () => {
    expect(play(new CclpEngine(SILENT), SLAP_ROOM, ['E', 'S'])).toEqual({ chip: [2, 3, 'S'], blocks: ['dirt_block@4,2'] });
  });

  it('rule off: the plain Lynx engine takes the first key and pushes the block with Chip', () => {
    expect(play(new LynxEngine(SILENT), SLAP_ROOM, ['E', 'S'])).toEqual({ chip: [3, 2, 'E'], blocks: ['dirt_block@4,2'] });
  });

  it('takes the only open key', () => {
    expect(play(new CclpEngine(SILENT), WALL_SOUTH, ['S', 'E']).chip).toEqual([3, 2, 'E']);
  });

  it('faces the horizontal key when both are blocked', () => {
    expect(play(new CclpEngine(SILENT), BOXED, ['S', 'E']).chip).toEqual([2, 2, 'E']);
  });

  it('reads no direction from an opposing pair or from three keys (Lexy: no move)', () => {
    expect(play(new CclpEngine(SILENT), WALL_SOUTH, ['E', 'W']).chip).toEqual([2, 2, 'S']);
    expect(play(new CclpEngine(SILENT), WALL_SOUTH, ['E', 'N', 'W']).chip).toEqual([2, 2, 'S']);
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(lynxLevel(WALL_SOUTH));
    expect(engine.attemptPlayerMoveHeld(['E', 'W'])).toBe(false);
  });

  it('probes a key the way the decision does: a block on a wall that yields to a push counts as open', () => {
    const level = lynxLevel(YIELD_ROOM, { glyphs: YIELD_GLYPHS });
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(level);
    for (let i = 0; i < STEP_TICKS; i++) {
      engine.holdPlayerDirections(i === 0 ? ['E', 'S'] : []);
      engine.tick();
    }
    // Both keys open, south is the facing: the push goes south, the wall shows itself and Chip stays.
    expect([engine.getPlayer().x, engine.getPlayer().y, engine.getPlayer().dir]).toEqual([2, 2, 'S']);
    expect(engine.getEntities().map((e) => `${e.x},${e.y}`)).toEqual(['2,4']);
    expect(engine.getTerrain()[3][2]).toBe('wall');
    // Rule off: the plain Lynx engine takes the first key and walks east.
    const plain = new LynxEngine(SILENT);
    plain.loadLevel(level);
    for (let i = 0; i < STEP_TICKS; i++) {
      plain.holdPlayerDirections(i === 0 ? ['E', 'S'] : []);
      plain.tick();
    }
    expect([plain.getPlayer().x, plain.getPlayer().y, plain.getPlayer().dir]).toEqual([3, 2, 'E']);
  });

  it('slaps an unmovable block: it turns, Chip takes the other key', () => {
    expect(play(new CclpEngine(SILENT), UNMOVABLE_EAST, ['E', 'S'])).toEqual({ chip: [2, 3, 'S'], blocks: ['dirt_block@3,2', 'dirt_block@2,4'] });
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(lynxLevel(UNMOVABLE_EAST));
    engine.holdPlayerDirections(['E', 'S']);
    engine.tick();
    expect(engine.getEntities().find((e) => e.x === 3 && e.y === 2)?.dir).toBe('E');
  });

  it('turns to the horizontal key when the chosen move fails beside a block', () => {
    expect(play(new CclpEngine(SILENT), FAILS_BESIDE_BLOCK, ['E', 'S'])).toEqual({ chip: [2, 2, 'E'], blocks: ['dirt_block@3,2'] });
  });

  it('keeps riding a force floor when the facing is one of two open keys', () => {
    const level = lynxLevel(FORCE_ROOM, { glyphs: { f: 'force_e' } });
    const run = (engine: LynxEngine): [number, number, Direction] => {
      engine.loadLevel(level);
      for (let t = 0; t < FORCE_TICKS; t++) {
        engine.holdPlayerDirections(t < FORCE_PAIR_FROM ? ['E'] : ['N', 'E']);
        engine.tick();
      }
      return [engine.getPlayer().x, engine.getPlayer().y, engine.getPlayer().dir];
    };
    expect(run(new CclpEngine(SILENT))).toEqual([6, 2, 'E']);
    // Rule off: the plain engine takes the first key (north) and overrides the floor.
    expect(run(new LynxEngine(SILENT))).toEqual([3, 1, 'N']);
  });

  it('lets a single press beat a held pair', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(lynxLevel(SLAP_ROOM));
    engine.holdPlayerDirections(['E', 'S']);
    expect(engine.attemptPlayerMove('N')).toBe(true);
    engine.tick();
    engine.holdPlayerDirections([]);
    for (let i = 1; i < STEP_TICKS; i++) engine.tick();
    expect([engine.getPlayer().x, engine.getPlayer().y]).toEqual([2, 1]);
    expect(engine.getEntities().map((e) => `${e.x},${e.y}`)).toEqual(['3,2']);
  });

  it('forgets a pressed pair on undo', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(lynxLevel(SLAP_ROOM));
    engine.holdPlayerDirections(['W']);
    engine.tick();
    engine.holdPlayerDirections([]);
    // The pair is pressed while Chip is still walking west: it waits for his next decision.
    engine.attemptPlayerMoveHeld(['E', 'S']);
    expect(engine.undo()).toBe(true);
    for (let i = 0; i < STEP_TICKS; i++) engine.tick();
    expect([engine.getPlayer().x, engine.getPlayer().y]).toEqual([2, 2]);
    expect(engine.getEntities().map((e) => `${e.x},${e.y}`)).toEqual(['3,2']);
  });

  it('stores no pair from a press refused while paused', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(lynxLevel(SLAP_ROOM));
    engine.setPaused(true);
    expect(engine.attemptPlayerMoveHeld(['E', 'S'])).toBe(false);
    engine.setPaused(false);
    for (let i = 0; i < STEP_TICKS; i++) engine.tick();
    expect([engine.getPlayer().x, engine.getPlayer().y]).toEqual([2, 2]);
    expect(engine.getEntities().map((e) => `${e.x},${e.y}`)).toEqual(['3,2']);
  });

  it('records a slapping decision with its other key, and replays it the same', () => {
    const engine = new CclpEngine(SILENT);
    engine.loadLevel(lynxLevel(SLAP_ROOM));
    expect(engine.attemptPlayerMoveHeld(['E', 'S'])).toBe(true);
    for (let i = 0; i < STEP_TICKS; i++) engine.tick();
    const history = engine.getTimedMoveHistory();
    expect(history).toEqual([{ tick: 0, dir: 'S', alt: 'E' }]);
    const replay = new CclpEngine(SILENT);
    replay.loadLevel(lynxLevel(SLAP_ROOM));
    for (let tick = 0; tick < STEP_TICKS; tick++) {
      for (const move of history) if (move.tick === tick) applyTimedMove(replay, move);
      replay.tick();
    }
    expect([replay.getPlayer().x, replay.getPlayer().y]).toEqual([2, 3]);
    expect(replay.getEntities().map((e) => `${e.x},${e.y}`)).toEqual(['4,2']);
  });
});

describe('EngineSelector: the CCLP profile', () => {
  it('plays a Lynx level with the cclp profile on the CCLP engine, and any other Lynx level on the Lynx engine', () => {
    const selector = new EngineSelector();
    expect(selector.forLevel({ ruleset: 'lynx', rulesProfile: 'cclp' })).toBeInstanceOf(CclpEngine);
    const plain = selector.forLevel({ ruleset: 'lynx' });
    expect(plain).toBeInstanceOf(LynxEngine);
    expect(plain).not.toBeInstanceOf(CclpEngine);
  });
});
