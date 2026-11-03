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

vi.mock('../audio/AudioManager', () => import('./silentAudio'));

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, Direction, EntityPlacement } from '../core/types';
import { PieceSolver } from '../generator/PieceSolver';
import { loadTestConfigs } from './loadTestConfigs';
import {
  applySearchAction,
  dropAction,
  searchActions,
  searchCanWin,
  searchShortestWin,
  searchStateKey
} from './pilotSearch';

const TERRAIN_CODES: Record<string, string> = {
  '#': 'wall',
  '.': 'floor',
  P: 'floor',
  O: 'floor',
  $: 'floor',
  k: 'floor',
  c: 'floor',
  W: 'water',
  S: 'socket',
  E: 'exit'
};
const KEY_ID = 'key_red';
const STATE_CAP = 50000;
/** Ticks a single block push takes the player, for the phase test: any positive count works. */
const SOME_TICKS = 1;

/** Rows: # wall, . floor, P player, O pink ball, $ dirt block, k red key, c chip, W water, S socket, E exit. */
function room(rows: string[], ballDir: Direction = 'E', chipsRequired = 0): CompiledLevel {
  let start = { x: 0, y: 0 };
  const entities: EntityPlacement[] = [];
  const terrain = rows.map((row, y) =>
    [...row].map((ch, x) => {
      if (ch === 'P') start = { x, y };
      if (ch === 'O') entities.push({ type: 'pink_ball', x, y, dir: ballDir });
      if (ch === '$') entities.push({ type: 'dirt_block', x, y, dir: 'S' });
      return TERRAIN_CODES[ch];
    })
  );
  const items = rows.map((row) => [...row].map((ch) => (ch === 'k' ? KEY_ID : ch === 'c' ? 'chip' : null)));
  return {
    id: 'search_room',
    number: 1,
    password: 'TEST',
    timeLimitSeconds: 0,
    chipsRequired,
    playerStart: { ...start, dir: 'E' },
    terrain,
    items,
    entities,
    trapLinks: [],
    cloneLinks: []
  };
}

function engineFor(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

/** A corridor where a pink ball chases the player east, a chip lies beyond the key and the exit hides in a side nook. */
const BALL_CORRIDOR = ['###########', '#.OPk....c#', '#####S#####', '#####E#####', '###########'];
/** The same corridor with the ball too far behind to catch the player. */
const FAR_BALL_CORRIDOR = ['###########', '#O..Pk..c.#', '######S####', '######E####', '###########'];

describe('pilot exhaustive search helpers', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('finds the drop of the key as the only way through a ball corridor', () => {
    const level = room(BALL_CORRIDOR, 'E', 1);
    expect(searchCanWin(engineFor(level), { stateCap: STATE_CAP, allowDrops: false })).toBe(false);
    const win = searchShortestWin(engineFor(level), { stateCap: STATE_CAP });
    expect(win).not.toBeNull();
    expect(win?.actions).toContain(dropAction(KEY_ID));
    expect(win?.length).toBe(win?.actions.length);
  });

  it('does not need the drop when the ball is too far behind to catch the player', () => {
    const level = room(FAR_BALL_CORRIDOR, 'E', 1);
    expect(searchCanWin(engineFor(level), { stateCap: STATE_CAP, allowDrops: false })).toBe(true);
  });

  it('replays the winning actions it returns', () => {
    const level = room(BALL_CORRIDOR, 'E', 1);
    const win = searchShortestWin(engineFor(level), { stateCap: STATE_CAP });
    const engine = engineFor(level);
    for (const action of win?.actions ?? []) expect(applySearchAction(engine, action)).toBe(true);
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('lets the caller reject a win by its final state', () => {
    const level = room(FAR_BALL_CORRIDOR, 'E', 1);
    const rejected = searchCanWin(engineFor(level), { stateCap: STATE_CAP, accept: () => false });
    expect(rejected).toBe(false);
  });

  it('throws when the state cap is exceeded', () => {
    expect(() => searchCanWin(engineFor(room(BALL_CORRIDOR, 'E', 1)), { stateCap: 2 })).toThrow(/exceeded/);
  });

  it('offers a drop only for an item the player holds, and no wait without a moving monster', () => {
    const withBall = engineFor(room(['#####', '#PkO#', '#####']));
    expect(searchActions(withBall)).toContain('WAIT');
    expect(searchActions(withBall).some((a) => a.startsWith('DROP:'))).toBe(false);
    expect(applySearchAction(withBall, 'E')).toBe(true);
    expect(searchActions(withBall)).toContain(dropAction(KEY_ID));
    expect(searchActions(withBall, false)).not.toContain(dropAction(KEY_ID));
    const quiet = engineFor(room(['#####', '#P.$#', '#####']));
    expect(searchActions(quiet)).not.toContain('WAIT');
  });
});

describe('pilot search state key', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('tells apart block positions', () => {
    const engine = engineFor(room(['######', '#P$..#', '######']));
    const before = searchStateKey(engine);
    expect(PieceSolver.play(engine, 'E')).toBe(true);
    expect(searchStateKey(engine)).not.toBe(before);
    const other = engineFor(room(['######', '#P.$.#', '######']));
    expect(searchStateKey(other)).not.toBe(before);
  });

  it('tells apart water filled by a block: the terrain changes under it', () => {
    const level = room(['#######', '#P$W..#', '#######']);
    const engine = engineFor(level);
    const before = searchStateKey(engine);
    expect(PieceSolver.play(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[1][3]).toBe('dirt');
    const filled = searchStateKey(engine);
    expect(filled).not.toBe(before);
    // Stepping on the fresh dirt turns it to floor: another terrain state.
    expect(PieceSolver.play(engine, 'E')).toBe(true);
    expect(engine.getTerrain()[1][3]).toBe('floor');
    expect(searchStateKey(engine)).not.toBe(filled);
  });

  it('tells apart a dropped key, the keys held and the items on the floor', () => {
    const engine = engineFor(room(['#####', '#Pk.#', '#####']));
    expect(applySearchAction(engine, 'E')).toBe(true);
    const held = searchStateKey(engine);
    expect(applySearchAction(engine, dropAction(KEY_ID))).toBe(true);
    expect(searchStateKey(engine)).not.toBe(held);
  });

  it('tells apart the direction of a pink ball and the tick phase of its move', () => {
    const east = searchStateKey(engineFor(room(['#######', '#P..O.#', '#######'], 'E')));
    const west = searchStateKey(engineFor(room(['#######', '#P..O.#', '#######'], 'W')));
    expect(east).not.toBe(west);
    const still = engineFor(room(['#######', '#P..O.#', '#######'], 'E'));
    const later = engineFor(room(['#######', '#P..O.#', '#######'], 'E'));
    for (let i = 0; i < SOME_TICKS; i++) later.tick();
    expect(searchStateKey(later)).not.toBe(searchStateKey(still));
  });
});
