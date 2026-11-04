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
import { searchShortestWinLean } from '../test/pilotLeanSearch';
import { pushWinExists } from '../test/pilotPushSearch';
import { applySearchAction, searchActions, searchCanWin, searchShortestWin, searchStateKey } from '../test/pilotSearch';
import { ConfigRegistry } from './ConfigRegistry';

/** Generous search ceilings: a runaway proof fails loudly instead of hanging. */
const SEARCH_STATE_CAP = 3000000;
const TEST_TIMEOUT_MS = 240000;

const DOORKEEPER_LEVEL = 'epoxy_p_26';
const NO_DIG_LEVEL = 'epoxy_p_27';
const SPLASHES_LEVEL = 'epoxy_p_28';
const LOCK_LEVEL = 'epoxy_p_29';
const WORKS_LEVEL = 'epoxy_p_30';

function levelById(id: string): CompiledLevel {
  const level = ConfigRegistry.getPilotLevels().find((l) => l.id === id);
  if (!level) throw new Error(`no pilot level ${id}`);
  return level;
}

function engineFor(level: CompiledLevel): GameEngine {
  const engine = new GameEngine();
  engine.loadLevel(level);
  return engine;
}

function playAll(engine: GameEngine, moves: string): void {
  for (const move of moves) expect(PieceSolver.play(engine, (move === '.' ? 'WAIT' : move) as Direction), `move ${move} of ${moves}`).toBe(true);
}

function engineAfter(level: CompiledLevel, moves: string): GameEngine {
  const engine = engineFor(level);
  playAll(engine, moves);
  return engine;
}

function shortest(engine: GameEngine): number | null {
  return searchShortestWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })?.length ?? null;
}

function blockCells(engine: GameEngine): string[] {
  return engine
    .getEntities()
    .filter((e) => e.type === 'dirt_block')
    .map((e) => `${e.x},${e.y}`)
    .sort();
}

function countTerrain(level: CompiledLevel, id: string): number {
  return level.terrain.flat().filter((t) => t === id).length;
}

function countItems(level: CompiledLevel, id: string): number {
  return level.items.flat().filter((t) => t === id).length;
}

describe('pilot chapter 2 the doorkeeper', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Fetches the free key, walks to the hub, treads the dirt and stands before the chip rooms. */
  const TO_HUB_WEST = 'EWSSSSWWWW';
  /** The stored solution up to the moment the key has opened the block room. */
  const BLOCK_ROOM_OPENED = 16;

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(DOORKEEPER_LEVEL);
    expect(level.solution?.length).toBe(58);
    expect(shortest(engineFor(level))).toBe(58);
  });

  it('holds as many red keys as red doors, one block, one pool', () => {
    const level = levelById(DOORKEEPER_LEVEL);
    expect(countItems(level, 'key_red')).toBe(3);
    expect(countTerrain(level, 'door_red')).toBe(3);
    expect(level.entities.filter((e) => e.type === 'dirt_block')).toHaveLength(1);
    expect(countTerrain(level, 'water')).toBe(1);
  });

  it('is lost by spending the only free key on a chip room: the block room can never be opened', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(DOORKEEPER_LEVEL);
    for (const step of ['N', 'S']) {
      const engine = engineAfter(level, TO_HUB_WEST + step);
      expect(engine.getPlayer().keys.key_red ?? 0).toBe(0);
      expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);
    }
  });

  it('is won from the state where the same key opens the block room instead, in exactly the stored length', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(DOORKEEPER_LEVEL);
    const engine = engineAfter(level, (level.solution ?? '').slice(0, BLOCK_ROOM_OPENED));
    expect(engine.getPlayer().keys.key_red ?? 0).toBe(0);
    expect(shortest(engine)).toBe(58 - BLOCK_ROOM_OPENED);
  });

  it('gives the dirt a job: as plain floor the shortest win drops to 52, and with the dirt kept a block pushed west before it is trodden is wedged for good', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(DOORKEEPER_LEVEL);
    expect(level.terrain[5][5]).toBe('dirt');
    expect(countTerrain(level, 'dirt')).toBe(1);
    const floor = structuredClone(level);
    floor.terrain[5][5] = 'floor';
    expect(shortest(engineFor(floor))).toBe(52);
    // Open the block room without crossing the dirt, then push the block west along the hub: it stops against the fresh dirt.
    const engine = engineAfter(level, 'EWSSSSEEEESEEN' + 'W'.repeat(7));
    expect(blockCells(engine)).toEqual(['6,5']);
    expect(engine.getTerrain()[5][5]).toBe('dirt');
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);
  });
});

describe('pilot chapter 2 do not dig', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Down to the chip cell, then east along row 3 onto the plug, which turns to floor under the player. */
  const DIG = 'SSEEEEE';

  function withoutBall(level: CompiledLevel): CompiledLevel {
    const copy = structuredClone(level);
    copy.entities = copy.entities.filter((e) => e.type !== 'pink_ball');
    return copy;
  }

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(NO_DIG_LEVEL);
    expect(level.solution?.length).toBe(22);
    expect(shortest(engineFor(level))).toBe(22);
  });

  it('starts the player outside a five-cell lane that dirt closes on one side, with a wall closing the other and walls above and below', () => {
    const level = levelById(NO_DIG_LEVEL);
    const ball = level.entities.find((e) => e.type === 'pink_ball');
    expect(ball).toMatchObject({ x: 9, y: 3, dir: 'W' });
    expect(level.terrain[3][6]).toBe('dirt');
    for (let x = 7; x <= 11; x++) {
      expect(level.terrain[3][x]).toBe('floor');
      expect(level.terrain[2][x]).toBe('wall');
      // The lane opens to the exit region only at its east end.
      expect(level.terrain[4][x]).toBe(x === 11 ? 'floor' : 'wall');
    }
    expect(level.terrain[3][12]).toBe('wall');
    expect(level.playerStart.y).toBe(1);
    expect(countItems(level, 'key_red') + countItems(level, 'key_green')).toBe(0);
  });

  it('has no side pocket along row 3: west of the plug the only way in and out is the chip cell at (1,3), the whole row is walled above and below', () => {
    const level = levelById(NO_DIG_LEVEL);
    expect(level.terrain[2].map((id, x) => (id === 'wall' ? null : x)).filter((x) => x !== null)).toEqual([1, 13]);
    for (let x = 1; x <= 10; x++) expect(level.terrain[4][x]).toBe('wall');
    expect(level.items[3][1]).toBe('chip');
  });

  it('keeps the ball in its lane and the plug untouched all along the stored solution', () => {
    const level = levelById(NO_DIG_LEVEL);
    const engine = engineFor(level);
    for (const move of level.solution ?? '') {
      expect(PieceSolver.play(engine, move as Direction)).toBe(true);
      const ball = engine.getEntities().find((e) => e.type === 'pink_ball');
      expect(ball?.y).toBe(3);
      expect(ball?.x).toBeGreaterThanOrEqual(7);
      expect(ball?.x).toBeLessThanOrEqual(11);
      expect(engine.getTerrain()[3][6]).toBe('dirt');
    }
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('makes the ball the only thing that bars the shortcut: without it the shortest win is 18 moves', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(NO_DIG_LEVEL);
    expect(shortest(engineFor(withoutBall(level)))).toBe(18);
  });

  it('cannot be won by dodging: with the top route closed (the lane is then the only way on) no win exists, drops allowed, and without the ball one does', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = structuredClone(levelById(NO_DIG_LEVEL));
    level.terrain[2][13] = 'wall';
    expect(searchCanWin(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);
    // The closed top route leaves the map connected through the lane: without the ball the shortest win is 18 again.
    expect(shortest(engineFor(withoutBall(level)))).toBe(18);
  });

  it('is lost once the plug is trodden before the ball is gone, the walk in being a corridor with no side to step aside to', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = structuredClone(levelById(NO_DIG_LEVEL));
    level.terrain[2][13] = 'wall';
    const engine = engineAfter(level, DIG);
    expect(engine.getTerrain()[3][6]).toBe('floor');
    expect(searchCanWin(engine, { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);
    // With the top route open the finish after digging is a retreat and the safe route: counted here, not claimed as a global proof.
    const open = engineAfter(levelById(NO_DIG_LEVEL), DIG);
    expect(shortest(open)).toBe(25);
  });
});

describe('pilot chapter 2 four splashes', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('is won by its stored solution, and no shorter win exists, drops allowed', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(SPLASHES_LEVEL);
    expect(level.solution?.length).toBe(33);
    expect(shortest(engineFor(level))).toBe(33);
  });

  it('holds four blocks, four pools and four chips, one of each per pocket, and a budget with nothing to spare', () => {
    const level = levelById(SPLASHES_LEVEL);
    expect(level.blockBudget).toEqual({ waters: 4, targets: 0 });
    expect(level.chipsRequired).toBe(4);
    expect(countTerrain(level, 'water')).toBe(4);
    expect(level.entities.filter((e) => e.type === 'dirt_block').map((e) => e.x).sort()).toEqual([2, 4, 6, 8]);
    for (const x of [2, 4, 6, 8]) {
      expect(level.terrain[3][x]).toBe('water');
      expect(level.items[4][x]).toBe('chip');
    }
  });

  it('cannot be won with one block fewer: every pool needs its own block', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = structuredClone(levelById(SPLASHES_LEVEL));
    level.entities = level.entities.slice(0, 3);
    expect(searchCanWin(engineFor(level), { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(false);
  });
});

/** Both chips of the lock's hall (beyond the two pools) are taken. */
function hallChipsTaken(engine: GameEngine): boolean {
  const items = engine.captureState().items;
  return items[2][11] === null && items[4][10] === null;
}

/** The ball chamber of the lock alone: the hall is walled off and the player starts at the head of the shaft, its only way in. */
function lockChamber(level: CompiledLevel, withBlock = true): CompiledLevel {
  const copy = structuredClone(level);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x < copy.terrain[y].length; x++) {
      copy.terrain[y][x] = 'wall';
      copy.items[y][x] = null;
    }
  }
  for (let x = 1; x < copy.terrain[4].length; x++) copy.items[4][x] = null;
  copy.terrain[3][4] = 'floor';
  copy.entities = copy.entities.filter((e) => e.type === 'pink_ball' || (withBlock && e.type === 'dirt_block' && e.x === 4 && e.y === 4));
  copy.playerStart = { ...copy.playerStart, x: 4, y: 3 };
  copy.chipsRequired = 1;
  return copy;
}

/**
 * The hall of the lock alone: no ball, no shaft block, and everything below the hall walled but the
 * pocket of the lower chip. The ball and the chamber play no part in the two hall chips.
 */
function lockHall(level: CompiledLevel): CompiledLevel {
  const copy = structuredClone(level);
  for (let y = 4; y < copy.terrain.length; y++) {
    for (let x = 1; x < copy.terrain[y].length; x++) {
      if (y === 4 && x === 10) continue;
      copy.terrain[y][x] = 'wall';
      copy.items[y][x] = null;
    }
  }
  copy.entities = copy.entities.filter((e) => e.type === 'dirt_block' && e.y <= 3);
  return copy;
}

interface ChamberScan {
  states: number;
  breach: string | null;
  keyStates: number;
}

/** Visits every reachable state of the chamber (drops included) and reports the first one where the player is out of the block's shelter. */
function scanChamber(level: CompiledLevel): ChamberScan {
  const engine = engineFor(level);
  const seen = new Set<string>([searchStateKey(engine)]);
  const queue = [engine.captureState()];
  let breach: string | null = null;
  let keyStates = 0;
  for (let head = 0; head < queue.length && breach === null; head++) {
    for (const action of (engine.restoreState(queue[head]), searchActions(engine, true))) {
      engine.restoreState(queue[head]);
      if (!applySearchAction(engine, action)) continue;
      const player = engine.getPlayer();
      const block = engine.getEntities().find((e) => e.type === 'dirt_block');
      const ball = engine.getEntities().find((e) => e.type === 'pink_ball');
      const holdsKey = (player.keys.key_red ?? 0) > 0;
      if (holdsKey) keyStates++;
      const exposed = (player.y === 8 && player.x >= 5) || player.y >= 9 || holdsKey;
      const sheltered = block !== undefined && block.y === 8 && (player.y === 8 ? block.x > player.x : block.x >= player.x) && ball !== undefined && ball.x > block.x;
      if (exposed && !sheltered) {
        breach = `player ${player.x},${player.y} block ${block?.x},${block?.y} ball ${ball?.x},${ball?.y}`;
        break;
      }
      if (engine.isLevelCompleted()) continue;
      const key = searchStateKey(engine);
      if (seen.has(key)) continue;
      seen.add(key);
      expect(seen.size).toBeLessThan(3000000);
      queue.push(engine.captureState());
    }
  }
  return { states: seen.size, breach, keyStates };
}

describe('pilot chapter 2 the lock', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  /** Hall moves of the stored solution: both pools filled and both hall chips taken. */
  const HALL_PART = 27;

  it('is won by its stored solution, with three blocks for two pools and one ball, and as many keys as doors', () => {
    const level = levelById(LOCK_LEVEL);
    expect(level.solution?.length).toBe(52);
    expect(level.entities.filter((e) => e.type === 'dirt_block')).toHaveLength(3);
    expect(level.entities.filter((e) => e.type === 'pink_ball')).toHaveLength(1);
    expect(countTerrain(level, 'water')).toBe(2);
    expect(countItems(level, 'key_red')).toBe(1);
    expect(countTerrain(level, 'door_red')).toBe(1);
    expect(level.chipsRequired).toBe(3);
    const engine = engineFor(level);
    playAll(engine, level.solution ?? '');
    expect(engine.isLevelCompleted()).toBe(true);
  });

  it('is won in 27 + 25 moves: each part is the shortest for its part, but their sum (52) is not a proven global minimum, the whole level exceeding six million states', { timeout: 1200000 }, () => {
    const level = levelById(LOCK_LEVEL);
    const hallOnly = lockHall(level);
    const hall = searchShortestWinLean(engineFor(hallOnly), {
      stateCap: 6000000,
      allowDrops: true,
      goal: (engine) => hallChipsTaken(engine)
    });
    expect(hall?.length).toBe(HALL_PART);
    const engine = engineAfter(level, (level.solution ?? '').slice(0, HALL_PART));
    expect(engine.getChipsRemaining()).toBe(1);
    const rest = searchShortestWinLean(engine, { stateCap: 6000000, allowDrops: true });
    expect(rest?.length).toBe(25);
  });

  it('is lost when the block that can reach either pool takes the nearer one: the row-bound block then has no pool left, with the ball still to stop (hall only: the chips of the hall do not depend on the ball)', { timeout: 1200000 }, () => {
    const level = levelById(LOCK_LEVEL);
    // Down to the free block, one push north into the top row, then east along it into the top pool.
    const engine = engineAfter(level, 'SEEEEENWNEEEE');
    expect(engine.getTerrain()[1][10]).toBe('dirt');
    expect(blockCells(engine)).toEqual(['3,1', '4,4']);
    // The hall part alone: the ball plays no part in the two hall chips, so it is taken out to keep the search small.
    const copy = lockHall(level);
    const free = engineFor(copy);
    playAll(free, 'SEEEEENWNEEEE');
    const win = searchShortestWinLean(free, { stateCap: 6000000, allowDrops: true, goal: hallChipsTaken });
    expect(win).toBeNull();
    // The same hall from the start does reach both chips, in 27 moves (see the test above).
    expect(searchShortestWinLean(engineFor(copy), { stateCap: 6000000, allowDrops: true, goal: hallChipsTaken })?.length).toBe(27);
  });

  it('has no dodge: in every reachable state of the chamber, drops included, the player stands in the lane or beyond it only behind the block with the ball beyond, and holds the key only there', { timeout: 1200000 }, () => {
    const scan = scanChamber(lockChamber(levelById(LOCK_LEVEL)));
    expect(scan).toEqual({ states: 44653, breach: null, keyStates: 21047 });
  });

  it('would be dodged without the block: the same chamber with the shaft empty lets the player into the lane', { timeout: 1200000 }, () => {
    const empty = lockChamber(levelById(LOCK_LEVEL), false);
    const scan = scanChamber(empty);
    expect(scan).toEqual({ states: 75, breach: 'player 5,8 block undefined,undefined ball 6,8', keyStates: 0 });
    // And the dodge really wins: with nothing in the shaft the chamber can be crossed against the ball.
    expect(searchCanWin(engineFor(empty), { stateCap: SEARCH_STATE_CAP, allowDrops: true })).toBe(true);
  });

  it('picks the key only once the block shelters the player, along the stored solution', () => {
    const level = levelById(LOCK_LEVEL);
    const engine = engineFor(level);
    let picked = false;
    for (const move of level.solution ?? '') {
      expect(PieceSolver.play(engine, move as Direction)).toBe(true);
      const player = engine.getPlayer();
      if ((player.keys.key_red ?? 0) > 0 && !picked) {
        // Documented exception to "no key while the ball is live": the ball is pinned, not gone, and the exhaustive drop scan above shows the key never helps the player past the block.
        picked = true;
        const block = engine.getEntities().find((e) => e.type === 'dirt_block');
        const ball = engine.getEntities().find((e) => e.type === 'pink_ball');
        expect(block?.y).toBe(8);
        expect(ball?.x).toBeGreaterThan(block?.x ?? 99);
      }
    }
    expect(picked).toBe(true);
  });
});

describe('pilot chapter 2 the great works', () => {
  beforeAll(() => {
    loadTestConfigs();
  });

  it('is won by its replayed stored solution: six blocks, three of them sunk, three on targets, 46 pushes and 129 moves, with the budget replayed (neither count is claimed minimal: the exact push search ran out of memory in a normal worker)', () => {
    const level = levelById(WORKS_LEVEL);
    expect(level.winRule).toBe('targets');
    expect(level.blockBudget).toEqual({ waters: 3, targets: 3 });
    expect(level.entities.filter((e) => e.type === 'dirt_block')).toHaveLength(6);
    expect(level.solution?.length).toBe(129);
    const engine = engineFor(level);
    let pushes = 0;
    for (const move of level.solution ?? '') {
      const before = blockCells(engine).join('|');
      expect(PieceSolver.play(engine, move as Direction)).toBe(true);
      if (before !== blockCells(engine).join('|')) pushes++;
    }
    expect(engine.isLevelCompleted()).toBe(true);
    expect(pushes).toBe(46);
  });

  /** The stored solution's first 13 moves sink the first lane's own block and leave the player on its target cell. */
  const FIRST_LANE_DONE = 'NNNNEEEEEEEEE';
  /** Back west and down to the middle row, then north: the block of (2,2) goes up into the first row. */
  const FIRST_UP = 'W'.repeat(10) + 'SSEN';

  it('is lost when both flexible blocks go up into the first lane: it takes one block for its target and strands the other, and the other lanes are short', { timeout: TEST_TIMEOUT_MS }, () => {
    const level = levelById(WORKS_LEVEL);
    const start = (level.entities as Array<{ x: number; y: number }>).map((e) => `${e.x},${e.y}`).sort();
    expect(start).toEqual(['2,2', '2,4', '2,5', '3,1', '6,2', '6,4'].sort());
    expect((level.solution ?? '').startsWith(FIRST_LANE_DONE)).toBe(true);
    // Real play: the first lane's own block is sunk, then both flexible blocks of the second row are pushed north.
    const wrong = engineAfter(level, FIRST_LANE_DONE + FIRST_UP + 'SEEEEN');
    expect(blockCells(wrong)).toEqual(['2,1', '2,4', '2,5', '6,1', '6,4']);
    // Row 0 is wall, so a block in the first row never leaves it: the two stranded blocks can only ever cover the first target.
    expect(level.terrain[0].every((id) => id === 'wall')).toBe(true);
    // The rest of the room without them and without that target: three blocks for two pools and two targets.
    const reduced = (blocks: Array<[number, number]>): GameEngine => {
      const room = structuredClone(level);
      room.terrain[1][10] = 'floor';
      room.terrain[1][11] = 'floor';
      room.playerStart = { ...room.playerStart, x: 1, y: 3 };
      room.entities = blocks.map(([x, y]) => ({ type: 'dirt_block', x, y, dir: 'S' }) as CompiledLevel['entities'][number]);
      return engineFor(room);
    };
    expect(pushWinExists(reduced([[2, 4], [6, 4], [2, 5]]), { stateCap: 8000000 })).toBe(false);
    // The second flexible block goes down into the middle lane instead: four blocks remain for them, and the same play stays winnable.
    const right = engineAfter(level, FIRST_LANE_DONE + FIRST_UP + 'EEENES');
    expect(blockCells(right)).toEqual(['2,1', '2,4', '2,5', '6,3', '6,4']);
    expect(pushWinExists(reduced([[6, 3], [2, 4], [6, 4], [2, 5]]), { stateCap: 8000000 })).toBe(true);
  });
});
