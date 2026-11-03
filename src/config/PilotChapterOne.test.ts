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

import { GameEngine } from '../core/GameEngine';
import { CompiledLevel, Direction } from '../core/types';
import { PieceSolver } from '../generator/PieceSolver';
import { loadTestConfigs } from '../test/loadTestConfigs';
import { ConfigRegistry } from './ConfigRegistry';

const ORDER_TRAP_LEVEL = 'epoxy_p_4';
/** Walk to the key in the far west, then open the LEFT door (2,3) first. */
const LEFT_FIRST = 'SSWWWWEN';
/** Walk to the key, then open the RIGHT door (8,3) first. */
const RIGHT_FIRST = 'SSWWWWEEEEEEEN';
const DIRECTIONS: Direction[] = ['N', 'E', 'S', 'W'];
const SEARCH_STATE_CAP = 20000;
const LARGE_STATE_CAP = 400000;

const BASKET_LEVEL = 'epoxy_p_8';
/** The red door that closes the three-chip room of level 8. */
const BASKET_DOOR = { x: 7, y: 3 };
const FOOTPRINTS_LEVEL = 'epoxy_p_6';
/** The dirt column above the start of level 6: the one deliberately empty stub. */
const FOOTPRINTS_STUB_X = 6;
const FOOTPRINTS_STUB_ROWS = [1, 2, 3];
const KEYRING_LEVEL = 'epoxy_p_10';
/** Key room doors of level 10 on its east-west hall, from the key at the west end. */
const KEY_TO_HALL = 'WWWWWWN';
const KEYRING_FIRST_ATTIC = `${KEY_TO_HALL}EEEN`;
const KEYRING_FIRST_PLAIN_ROOM = `${KEY_TO_HALL}EEEEEEN`;
const KEYRING_FIRST_FAR_ROOM = `${KEY_TO_HALL}EEEEEEEEEEEEN`;
const KEYRING_FIRST_KEY_ROOM = `${KEY_TO_HALL}EEEEEEEEEN`;
/** From the first attic door: fetch its key, open the inner room, take both keys, and come back to the hall. */
const KEYRING_ATTIC_THEN_INNER = `${KEYRING_FIRST_ATTIC}NNNNWWWEEESSSSS`;
/** Then open the plain room and the far room, which spends both keys. */
const KEYRING_PLAIN_THEN_FAR = `${KEYRING_ATTIC_THEN_INNER}EEENSEEEEEEN`;

function levelById(id: string): CompiledLevel {
  const level = ConfigRegistry.getPilotLevels().find((l) => l.id === id);
  if (!level) throw new Error(`no pilot level ${id}`);
  return level;
}

function engineAfter(level: CompiledLevel, moves: string): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  for (const move of moves) expect(PieceSolver.play(engine, move as Direction), moves).toBe(true);
  return engine;
}

/** Identity of a game state for the exhaustive searches: position, keys held, chips left, terrain and items. */
function stateKey(engine: GameEngine): string {
  const state = engine.captureState();
  const keys = Object.entries(state.player.keys)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([state.player.x, state.player.y, keys, state.chipsRemaining, state.terrain, state.items]);
}

/** Exhaustive search of every state reachable from the engine's current one; true when one wins. */
function canStillWin(engine: GameEngine, stateCap = SEARCH_STATE_CAP): boolean {
  const seen = new Set<string>([stateKey(engine)]);
  const queue = [engine.captureState()];
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    for (const dir of DIRECTIONS) {
      engine.restoreState(from);
      if (!PieceSolver.play(engine, dir)) continue;
      if (engine.isLevelCompleted() && engine.getChipsRemaining() === 0) return true;
      const id = stateKey(engine);
      if (seen.has(id)) continue;
      seen.add(id);
      expect(seen.size).toBeLessThan(stateCap);
      queue.push(engine.captureState());
    }
  }
  return false;
}

describe('pilot chapter 1 order trap', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('keeps the level solvable when the right attic is opened first', () => {
    const engine = engineAfter(levelById(ORDER_TRAP_LEVEL), RIGHT_FIRST);
    expect(canStillWin(engine)).toBe(true);
  });

  it('leaves the level unsolvable once the left door has used the only key in reach', () => {
    const engine = engineAfter(levelById(ORDER_TRAP_LEVEL), LEFT_FIRST);
    expect(engine.getTerrain()[3][2]).toBe('floor');
    expect(canStillWin(engine)).toBe(false);
  });
});

/** Fewest moves of a win from the engine's current state, or null; `accept` can reject a win by its final state. */
function shortestWin(engine: GameEngine, accept: (e: GameEngine) => boolean = () => true): number | null {
  const seen = new Set<string>([stateKey(engine)]);
  let frontier = [engine.captureState()];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next = [];
    for (const from of frontier) {
      for (const dir of DIRECTIONS) {
        engine.restoreState(from);
        if (!PieceSolver.play(engine, dir)) continue;
        if (engine.isLevelCompleted() && engine.getChipsRemaining() === 0 && accept(engine)) return depth;
        if (engine.isLevelCompleted()) continue;
        const id = stateKey(engine);
        if (seen.has(id)) continue;
        seen.add(id);
        expect(seen.size).toBeLessThan(LARGE_STATE_CAP);
        next.push(engine.captureState());
      }
    }
    frontier = next;
  }
  return null;
}

describe('pilot chapter 1 cheapest basket', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('asks for three chips out of nine, with a door in front of three of them', () => {
    const level = levelById(BASKET_LEVEL);
    expect(level.chipsRequired).toBe(3);
    expect(level.items.flat().filter((id) => id === 'chip')).toHaveLength(9);
    expect(level.terrain[BASKET_DOOR.y][BASKET_DOOR.x]).toBe('door_red');
  });

  it('makes the keyed room the cheapest basket, and leaving it shut costs more', () => {
    const level = levelById(BASKET_LEVEL);
    const cheapest = shortestWin(engineAfter(level, ''));
    const doorShut = shortestWin(engineAfter(level, ''), (e) => e.getTerrain()[BASKET_DOOR.y][BASKET_DOOR.x] === 'door_red');
    expect(cheapest).not.toBeNull();
    expect(doorShut).not.toBeNull();
    expect(cheapest).toBeLessThan(doorShut as number);
    expect(cheapest).toBe(level.solution?.length);
  });
});

describe('pilot chapter 1 key ring order', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('keeps the level solvable after the attic room, which gives back the key it takes', () => {
    expect(canStillWin(engineAfter(levelById(KEYRING_LEVEL), KEYRING_FIRST_ATTIC), LARGE_STATE_CAP)).toBe(true);
  });

  it('keeps the level solvable after the room whose key pays for its own door', () => {
    expect(canStillWin(engineAfter(levelById(KEYRING_LEVEL), KEYRING_FIRST_KEY_ROOM), LARGE_STATE_CAP)).toBe(true);
  });

  it.each([
    ['the plain room', KEYRING_FIRST_PLAIN_ROOM],
    ['the far room', KEYRING_FIRST_FAR_ROOM]
  ])('leaves the level unsolvable when %s is opened first and eats the only key', (_name, moves) => {
    const engine = engineAfter(levelById(KEYRING_LEVEL), moves);
    expect(Object.values(engine.captureState().player.keys).every((count) => count === 0)).toBe(true);
    expect(canStillWin(engine, LARGE_STATE_CAP)).toBe(false);
  });

  it('leaves the level unsolvable when both plain rooms are opened before the key room', () => {
    const engine = engineAfter(levelById(KEYRING_LEVEL), KEYRING_PLAIN_THEN_FAR);
    expect(canStillWin(engine, LARGE_STATE_CAP)).toBe(false);
  });
});

describe('pilot chapter 1 footprints', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('leaves only the deliberately empty stub as dirt once the route is walked', () => {
    const level = levelById(FOOTPRINTS_LEVEL);
    const engine = engineAfter(level, level.solution ?? '');
    expect(engine.isLevelCompleted()).toBe(true);
    const dirt: Array<[number, number]> = [];
    engine.getTerrain().forEach((row, y) => row.forEach((id, x) => id === 'dirt' && dirt.push([x, y])));
    expect(dirt).toEqual(FOOTPRINTS_STUB_ROWS.map((y) => [FOOTPRINTS_STUB_X, y]));
  });
});
