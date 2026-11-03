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

/** Red keys the player holds; the green key is never spent, so it does not count. */
function redKeysHeld(engine: GameEngine): number {
  return engine.captureState().player.keys.key_red ?? 0;
}

function terrainAt(engine: GameEngine, x: number, y: number): string {
  return engine.getTerrain()[y][x];
}

/** Doors of a colour, in the order the level's own solution opens them, as "x,y". */
function doorsOpenedBySolution(level: CompiledLevel, doorId: string): string[] {
  const engine = engineAfter(level, '');
  const closed = new Set<string>();
  level.terrain.forEach((row, y) => row.forEach((id, x) => id === doorId && closed.add(`${x},${y}`)));
  const opened: string[] = [];
  for (const move of level.solution ?? '') {
    expect(PieceSolver.play(engine, move as Direction)).toBe(true);
    for (const cell of [...closed]) {
      const [x, y] = cell.split(',').map(Number);
      if (terrainAt(engine, x, y) !== doorId) {
        closed.delete(cell);
        opened.push(cell);
      }
    }
  }
  return opened;
}

function countTerrain(level: CompiledLevel, id: string): number {
  return level.terrain.flat().filter((cell) => cell === id).length;
}

function countItems(level: CompiledLevel, id: string): number {
  return level.items.flat().filter((item) => item === id).length;
}

/** Replays the solution up to the step that opens the socket: the moves left, and the red doors still shut then. */
function afterSocket(level: CompiledLevel): { movesLeft: number; redDoorsShut: number } {
  const socket = level.terrain.flatMap((row, y) => row.map((id, x) => ({ id, x, y }))).find((cell) => cell.id === 'socket');
  if (!socket) throw new Error('no socket');
  const engine = engineAfter(level, '');
  const moves = level.solution ?? '';
  for (let step = 0; step < moves.length; step++) {
    expect(PieceSolver.play(engine, moves[step] as Direction)).toBe(true);
    if (terrainAt(engine, socket.x, socket.y) !== 'socket') {
      return { movesLeft: moves.length - step - 1, redDoorsShut: engine.getTerrain().flat().filter((id) => id === 'door_red').length };
    }
  }
  throw new Error('the socket never opens');
}

const HEDGE_LEVEL = 'epoxy_p_11';
/** The red door set into the hedge, straight ahead of the start, and the two key rooms beyond the hedge. */
const HEDGE_DOOR = { x: 6, y: 6 };
const HEDGE_ROOM_DOORS = [
  { x: 2, y: 4 },
  { x: 10, y: 4 }
];
/** Through the gap in the lower hedge, then east along the lane to the red key. */
const HEDGE_TO_KEY = 'NNNEEEEE';
/** Back to the middle of the lane, then north into the hedge door with the key. */
const HEDGE_SPEND_AT_DOOR = `${HEDGE_TO_KEY}WWWWWN`;
/** West along the lane, then north through the free gap at the west end of the hedge. */
const HEDGE_WALK_AROUND = `${HEDGE_TO_KEY}${'W'.repeat(10)}NN`;

describe('pilot chapter 1 hedge', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('keeps the level solvable when the key is carried round through the free gap', () => {
    const engine = engineAfter(levelById(HEDGE_LEVEL), HEDGE_WALK_AROUND);
    expect(redKeysHeld(engine)).toBe(1);
    expect(canStillWin(engine, LARGE_STATE_CAP)).toBe(true);
  }, 120000);

  it('leaves the level unsolvable once the key is spent on the door in the hedge', () => {
    const level = levelById(HEDGE_LEVEL);
    const engine = engineAfter(level, HEDGE_SPEND_AT_DOOR);
    expect(terrainAt(engine, HEDGE_DOOR.x, HEDGE_DOOR.y)).toBe('floor');
    expect(redKeysHeld(engine)).toBe(0);
    for (const door of HEDGE_ROOM_DOORS) expect(terrainAt(engine, door.x, door.y)).toBe('door_red');
    expect(canStillWin(engine, LARGE_STATE_CAP)).toBe(false);
}, 120000);

  it('needs both key rooms, and never opens the hedge door in its own solution', () => {
    const level = levelById(HEDGE_LEVEL);
    expect(level.chipsRequired).toBe(countItems(level, 'chip'));
    const opened = doorsOpenedBySolution(level, 'door_red');
    expect(opened).not.toContain(`${HEDGE_DOOR.x},${HEDGE_DOOR.y}`);
    expect(opened).toHaveLength(2);
  });
});

const ORCHARD_LEVEL = 'epoxy_p_12';
/** The red door of the three-chip room beside the lane, which the green rooms make unnecessary. */
const ORCHARD_BAIT_DOOR = { x: 2, y: 7 };
/** Fetch the red key in its nook off the stem, return to the lane, walk west and open the three-chip room. */
const ORCHARD_BAIT_FIRST = 'NNEENSWWNNNWWWWS';
/** Spend that key on the first gate of the socket corridor, then take the second key from the far green room and spend it on the bait. */
const ORCHARD_BAIT_SECOND = 'NNEENSWWNNNEEEEEWSNWWWWWWWWWNNNNNSSSSSES';

describe('pilot chapter 1 orchard', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('asks for six chips out of nine, with three green doors and three red doors', () => {
    const level = levelById(ORCHARD_LEVEL);
    expect(level.chipsRequired).toBe(6);
    expect(countItems(level, 'chip')).toBe(9);
    expect(countTerrain(level, 'door_green')).toBe(3);
    expect(countTerrain(level, 'door_red')).toBe(3);
  });

  it('never opens the three-chip room in its own solution', () => {
    const level = levelById(ORCHARD_LEVEL);
    const opened = doorsOpenedBySolution(level, 'door_red');
    expect(opened).not.toContain(`${ORCHARD_BAIT_DOOR.x},${ORCHARD_BAIT_DOOR.y}`);
    expect(opened).toHaveLength(2);
  });

  it.each([
    ['the first key', ORCHARD_BAIT_FIRST],
    ['the second key, after the first gate', ORCHARD_BAIT_SECOND]
  ])('leaves the level unsolvable when %s is spent on the three-chip room', (_name, moves) => {
    const engine = engineAfter(levelById(ORCHARD_LEVEL), moves);
    expect(terrainAt(engine, ORCHARD_BAIT_DOOR.x, ORCHARD_BAIT_DOOR.y)).toBe('floor');
    expect(redKeysHeld(engine)).toBe(0);
    expect(canStillWin(engine, LARGE_STATE_CAP)).toBe(false);
  }, 120000);
});

const ZEN_LEVEL = 'epoxy_p_13';
const ZEN_TERRAIN = new Set(['floor', 'wall', 'dirt', 'hint', 'socket', 'exit']);

describe('pilot chapter 1 zen garden', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('holds nothing that can lock the player out: only dirt, walls, three chips, the socket and the exit', () => {
    const level = levelById(ZEN_LEVEL);
    const terrain = new Set(level.terrain.flat());
    expect([...terrain].filter((id) => !ZEN_TERRAIN.has(id))).toEqual([]);
    expect(terrain.has('dirt')).toBe(true);
    expect(level.items.flat().filter((id) => id !== null && id !== 'chip')).toEqual([]);
    expect(countItems(level, 'chip')).toBe(3);
    expect(level.chipsRequired).toBe(3);
  });

  it('is a short walk', () => {
    const level = levelById(ZEN_LEVEL);
    const engine = engineAfter(level, level.solution ?? '');
    expect(engine.isLevelCompleted()).toBe(true);
    expect(level.solution?.length).toBeGreaterThanOrEqual(25);
    expect(level.solution?.length).toBeLessThanOrEqual(40);
  });
});

const TWINS_LEVEL = 'epoxy_p_14';
/** The red door of the alcove that holds the green key: the only right first door. */
const TWINS_ALCOVE_DOOR = { x: 5, y: 7 };
/** Walk east along the lane to the red key, then the three possible first doors. */
const TWINS_TO_KEY = 'EEEEEE';
const TWINS_ALCOVE_FIRST = `${TWINS_TO_KEY}WWS`;
const TWINS_EAST_ROOM_FIRST = `${TWINS_TO_KEY}S`;
const TWINS_WEST_ROOM_FIRST = `${TWINS_TO_KEY}WWWWWS`;

describe('pilot chapter 1 two key rings', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('opens the alcove door first in its own solution, and keeps the socket in the middle of the work', () => {
    const level = levelById(TWINS_LEVEL);
    expect(doorsOpenedBySolution(level, 'door_red')[0]).toBe(`${TWINS_ALCOVE_DOOR.x},${TWINS_ALCOVE_DOOR.y}`);
    const { movesLeft, redDoorsShut } = afterSocket(level);
    expect(redDoorsShut).toBeGreaterThan(0);
    expect(movesLeft).toBeGreaterThanOrEqual(15);
  });

  it('keeps the level solvable after the alcove door', () => {
    const engine = engineAfter(levelById(TWINS_LEVEL), TWINS_ALCOVE_FIRST);
    expect(terrainAt(engine, TWINS_ALCOVE_DOOR.x, TWINS_ALCOVE_DOOR.y)).toBe('floor');
    expect(canStillWin(engine, LARGE_STATE_CAP)).toBe(true);
}, 120000);

  it.each([
    ['the west chip room', TWINS_WEST_ROOM_FIRST, { x: 2, y: 7 }],
    ['the east chip room', TWINS_EAST_ROOM_FIRST, { x: 7, y: 7 }]
  ])('leaves the level unsolvable when %s is opened first', (_name, moves, door) => {
    const engine = engineAfter(levelById(TWINS_LEVEL), moves);
    expect(terrainAt(engine, door.x, door.y)).toBe('floor');
    expect(redKeysHeld(engine)).toBe(0);
    expect(canStillWin(engine, LARGE_STATE_CAP)).toBe(false);
  }, 120000);
});

const CLOCK_LEVEL = 'epoxy_p_15';
/** From the start to the red key in the north-west corner of the central hall (5,4). */
const CLOCK_TO_KEY = 'NNNNNNNW';
/** The key room, the plain room in the lower hall beside the start, and the two bait rooms. */
const CLOCK_KEY_ROOM_DOOR = { x: 8, y: 5 };
const CLOCK_PLAIN_ROOM_DOOR = { x: 4, y: 11 };
const CLOCK_BAIT_DOORS = [
  { x: 4, y: 8 },
  { x: 8, y: 8 }
];
const CLOCK_BACK_TO_START = 'ESSSSSSS';
/** Trap 1: the key goes into the east bait room before the green key is fetched. */
const CLOCK_BAIT_FIRST = `${CLOCK_TO_KEY}ESSSESE`;
/** Trap 2: the key goes into the plain chip room next to the start, which gives no key back. */
const CLOCK_PLAIN_FIRST = `${CLOCK_TO_KEY}${CLOCK_BACK_TO_START}WW`;
/** Trap 3: the key opens the key room, and the key it returns goes into the plain room instead of the closet. */
const CLOCK_KEY_ROOM_THEN_PLAIN = `${CLOCK_TO_KEY}EESEEEENWWEESWWWWWSSSSSSWW`;
/** Trap 4: closet, then the first green room, then a bait room with the key just fetched. */
const CLOCK_BAIT_LATE = `${CLOCK_TO_KEY}${CLOCK_BACK_TO_START}EEEEENWWEESWWWWWNNNNNNWWWWWNSEEEEESSSWW`;

describe('pilot chapter 1 clockmaker', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('has six red doors, two green doors and fewer chips required than placed', () => {
    const level = levelById(CLOCK_LEVEL);
    expect(countTerrain(level, 'door_red')).toBe(6);
    expect(countTerrain(level, 'door_green')).toBe(2);
    expect(countItems(level, 'key_red')).toBe(6);
    expect(level.chipsRequired).toBeLessThan(countItems(level, 'chip'));
  });

  it('opens the key room first in its own solution, skips both bait rooms, and keeps work behind the socket', () => {
    const level = levelById(CLOCK_LEVEL);
    const opened = doorsOpenedBySolution(level, 'door_red');
    expect(opened[0]).toBe(`${CLOCK_KEY_ROOM_DOOR.x},${CLOCK_KEY_ROOM_DOOR.y}`);
    for (const door of CLOCK_BAIT_DOORS) expect(opened).not.toContain(`${door.x},${door.y}`);
    expect(opened).toContain(`${CLOCK_PLAIN_ROOM_DOOR.x},${CLOCK_PLAIN_ROOM_DOOR.y}`);
    const { movesLeft, redDoorsShut } = afterSocket(level);
    expect(redDoorsShut).toBeGreaterThan(0);
    expect(movesLeft).toBeGreaterThanOrEqual(15);
  });

  it.each([
    ['the east bait room is opened first', CLOCK_BAIT_FIRST, CLOCK_BAIT_DOORS[1]],
    ['the plain chip room is opened first', CLOCK_PLAIN_FIRST, CLOCK_PLAIN_ROOM_DOOR],
    ['the key room is followed by the plain chip room', CLOCK_KEY_ROOM_THEN_PLAIN, CLOCK_PLAIN_ROOM_DOOR],
    ['a bait room is opened after the closet and the first green room', CLOCK_BAIT_LATE, CLOCK_BAIT_DOORS[0]]
  ])('leaves the level unsolvable when %s', (_name, moves, door) => {
    const engine = engineAfter(levelById(CLOCK_LEVEL), moves);
    expect(terrainAt(engine, door.x, door.y)).toBe('floor');
    expect(redKeysHeld(engine)).toBe(0);
    expect(canStillWin(engine, LARGE_STATE_CAP)).toBe(false);
  }, 240000);
});
